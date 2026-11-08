#!/usr/bin/env node
/**
 * LOCAL / NAS ONLY: PointsYeah email/password login proof-of-concept.
 *
 * This script never sends credentials to GitHub/Vercel or logs them.
 * It only interacts with the public PointsYeah login UI and the AWS Cognito
 * refresh endpoint. Do not put account credentials on the Vercel server.
 *
 * Usage:
 *   node scripts/pointsyeah-password-login.mjs --check-ui
 *   node scripts/pointsyeah-password-login.mjs
 *   node scripts/pointsyeah-password-login.mjs --output /secure/path/token.txt
 *
 * Required for login: POINTSYEAH_LOGIN_EMAIL, POINTSYEAH_LOGIN_PASSWORD
 * No account values are needed for --check-ui.
 */
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { lstat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';

const CLIENT_ID = '3im8jrentts1pguuouv5s57gfu';
const LOGIN_URL = 'https://www.pointsyeah.com/landing?route=signIn';
const COGNITO_URL = 'https://cognito-idp.us-east-1.amazonaws.com/';
const TOKEN_PREFIX = 'CognitoIdentityServiceProvider.' + CLIENT_ID + '.';

export function findRefreshToken(cookies = [], localStorageEntries = []) {
  const validCookie = cookies.find(c =>
    typeof c.name === 'string' &&
    c.name.startsWith(TOKEN_PREFIX) &&
    c.name.endsWith('.refreshToken') &&
    /(^|\.)pointsyeah\.com$/.test(c.domain || '') &&
    typeof c.value === 'string' && c.value.length > 80
  );
  if (validCookie) return validCookie.value;
  const entry = localStorageEntries.find(e =>
    typeof e.key === 'string' &&
    e.key.startsWith(TOKEN_PREFIX) &&
    e.key.endsWith('.refreshToken') &&
    typeof e.value === 'string' && e.value.length > 80
  );
  return entry?.value ?? null;
}

export async function validateRefreshToken(token, fetcher = fetch) {
  if (typeof token !== 'string' || token.length < 80) {
    throw new Error('NO_REFRESH_TOKEN');
  }
  const response = await fetcher(COGNITO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: token },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('COGNITO_REFRESH_REJECTED');
  const data = await response.json();
  if (!data?.AuthenticationResult?.IdToken ||
      !data?.AuthenticationResult?.AccessToken) {
    throw new Error('COGNITO_REFRESH_MISSING_SESSION');
  }
  return true;
}

export async function secureSaveToken(filePath, token, cwd = process.cwd()) {
  if (typeof filePath !== 'string' || !filePath.startsWith('/')) {
    throw new Error('OUTPUT_MUST_BE_ABSOLUTE');
  }
  const dest = resolve(filePath), root = resolve(cwd);
  if (dest === root || dest.startsWith(root + '/')) {
    throw new Error('REFUSING_TO_WRITE_SECRET_INSIDE_GIT_REPOSITORY');
  }
  const dir = dirname(dest);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new Error('SECRET_DIRECTORY_MUST_BE_PRIVATE_0700');
  }
  const tmp = join(dir, '.pointsyeah-token-' + process.pid + '-' + Date.now());
  try {
    await writeFile(tmp, token + '\n', { flag: 'wx', mode: 0o600 });
    await rename(tmp, dest);
  } catch {
    await unlink(tmp).catch(() => {});
    throw new Error('COULD_NOT_SAVE_TOKEN_SECURELY');
  }
  return true;
}

async function locateForm(page) {
  const password = page.locator('input[type="password"]:visible').first();
  if (await password.count() === 0) {
    const login = page.getByRole('button', { name: /^(log\s?in|sign\s?in|登录|登入)$/i }).first();
    if (await login.count() > 0) await login.click({ timeout: 5000 }).catch(() => {});
  }
  await password.waitFor({ state: 'visible', timeout: 15000 });
  const emailSelectors = [
    'input[type="email"]:visible',
    'input[autocomplete="username"]:visible',
    'input[name*="email" i]:visible',
    'input[placeholder*="email" i]:visible',
    'input[type="text"]:visible',
  ];
  for (const selector of emailSelectors) {
    const email = page.locator(selector).first();
    if (await email.count()) return { email, password };
  }
  throw new Error('EMAIL_INPUT_NOT_FOUND');
}

async function collectStorage(page) {
  // Read only our own application's auth keys, not other localStorage data.
  return page.evaluate(prefix => {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix) && key.endsWith('.refreshToken')) {
        entries.push({ key, value: localStorage.getItem(key) });
      }
    }
    return entries;
  }, TOKEN_PREFIX);
}

async function waitForSession(context, page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://www.pointsyeah.com');
    const token = findRefreshToken(cookies, await collectStorage(page).catch(() => []));
    if (token) return token;
    await page.waitForTimeout(1000);
  }
  throw new Error('LOGIN_DID_NOT_CREATE_SESSION_OR_INTERACTIVE_VERIFICATION_REQUIRED');
}

async function run() {
  const args = process.argv.slice(2);
  const checkUi = args.includes('--check-ui');
  const headed = args.includes('--headed');
  const outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  if (outputIndex >= 0 && !output) throw new Error('MISSING_OUTPUT_PATH');
  if (checkUi && output) throw new Error('CHECK_UI_MUST_NOT_WRITE_TOKEN');
  const email = process.env.POINTSYEAH_LOGIN_EMAIL;
  const password = process.env.POINTSYEAH_LOGIN_PASSWORD;
  if (!checkUi && (!email || !password)) throw new Error('LOGIN_CREDENTIALS_NOT_CONFIGURED');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: !headed });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto(LOGIN_URL, {
      waitUntil: 'domcontentloaded', timeout: 35000,
    });
    if (!response?.ok()) throw new Error('LOGIN_PAGE_UNAVAILABLE');
    const { email: emailInput, password: passwordInput } = await locateForm(page);
    if (checkUi) {
      console.log('POINTSYEAH_LOGIN_UI: FORM_FOUND (no credentials submitted)');
      return;
    }
    await emailInput.fill(email);
    await passwordInput.fill(password);
    const parentForm = passwordInput.locator('xpath=ancestor::form[1]');
    let submit = parentForm.locator('button[type="submit"]:visible').first();
    if (!(await submit.count())) {
      submit = page.getByRole('button', { name: /^(log\s?in|sign\s?in|登录|登入)$/i }).last();
    }
    if (!(await submit.count())) throw new Error('LOGIN_SUBMIT_BUTTON_NOT_FOUND');
    await submit.click({ timeout: 12000 });
    const newToken = await waitForSession(context, page, 45000);
    await validateRefreshToken(newToken);
    if (output) await secureSaveToken(output, newToken);
    console.log('POINTSYEAH_PASSWORD_LOGIN: SUCCESS (Cognito refresh verified)');
    console.log(output
      ? 'POINTSYEAH_SECRET_SAVE: SUCCESS (token stored locally, no Vercel change)'
      : 'POINTSYEAH_SECRET_SAVE: SKIPPED (no token printed or persisted)');
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch(error => {
    const code = typeof error?.message === 'string' ? error.message : 'UNKNOWN_ERROR';
    // Whitelisted error categories only; never include account details,
    // plaintext tokens, password, URLs with session data or remote body.
    const safe = new Set([
      'MISSING_OUTPUT_PATH', 'CHECK_UI_MUST_NOT_WRITE_TOKEN',
      'LOGIN_CREDENTIALS_NOT_CONFIGURED', 'LOGIN_PAGE_UNAVAILABLE',
      'EMAIL_INPUT_NOT_FOUND', 'LOGIN_SUBMIT_BUTTON_NOT_FOUND',
      'LOGIN_DID_NOT_CREATE_SESSION_OR_INTERACTIVE_VERIFICATION_REQUIRED',
      'NO_REFRESH_TOKEN', 'COGNITO_REFRESH_REJECTED',
      'COGNITO_REFRESH_MISSING_SESSION', 'OUTPUT_MUST_BE_ABSOLUTE',
      'REFUSING_TO_WRITE_SECRET_INSIDE_GIT_REPOSITORY',
      'SECRET_DIRECTORY_MUST_BE_PRIVATE_0700',
      'COULD_NOT_SAVE_TOKEN_SECURELY',
    ]);
    console.error('POINTSYEAH_PASSWORD_LOGIN: FAILED (' +
      (safe.has(code) ? code : 'BROWSER_OR_NETWORK_ERROR') + ')');
    process.exitCode = 1;
  });
}
