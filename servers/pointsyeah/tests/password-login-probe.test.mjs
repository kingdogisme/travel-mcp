import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findRefreshToken, validateRefreshToken, secureSaveToken,
} from '../../../scripts/pointsyeah-password-login.mjs';

const prefix = 'CognitoIdentityServiceProvider.3im8jrentts1pguuouv5s57gfu.user-id.';
const sample = 'sample-fake-refresh-token-' + 'x'.repeat(100);

describe('PointsYeah password-login PoC safety', () => {
  it('accepts only PointsYeah Cognito refresh-token cookies for the correct app client', () => {
    const cookies = [
      { name: prefix + 'accessToken', value: sample, domain: '.pointsyeah.com' },
      { name: 'CognitoIdentityServiceProvider.other.user-id.refreshToken', value: sample, domain: '.pointsyeah.com' },
      { name: prefix + 'refreshToken', value: sample, domain: '.attacker.com' },
      { name: prefix + 'refreshToken', value: sample, domain: '.pointsyeah.com' },
    ];
    expect(findRefreshToken(cookies, [])).toBe(sample);
    expect(findRefreshToken(cookies.slice(0, 3), [])).toBe(null);
  });

  it('uses localStorage fallback only for the matching client ID', () => {
    const storage = [
      { key: prefix + 'accessToken', value: sample },
      { key: prefix + 'refreshToken', value: sample },
    ];
    expect(findRefreshToken([], storage)).toBe(sample);
    expect(findRefreshToken([], [{ key: 'other.refreshToken', value: sample }])).toBeNull();
  });

  it('validates a new refresh token with Cognito without sending a password', async () => {
    let observed;
    const fetcher = async (url, init) => {
      observed = { url, ...init };
      return {
        ok: true,
        json: async () => ({
          AuthenticationResult: { AccessToken: 'access', IdToken: 'id', ExpiresIn: 3600 },
        }),
      };
    };
    await expect(validateRefreshToken(sample, fetcher)).resolves.toBe(true);
    expect(observed.url).toBe('https://cognito-idp.us-east-1.amazonaws.com/');
    const payload = JSON.parse(observed.body);
    expect(payload.AuthFlow).toBe('REFRESH_TOKEN_AUTH');
    expect(payload.AuthParameters.REFRESH_TOKEN).toBe(sample);
    expect(payload.AuthParameters.PASSWORD).toBeUndefined();
  });

  it('rejects revoked and incomplete Cognito responses', async () => {
    await expect(validateRefreshToken(sample, async () => ({ ok: false })))
      .rejects.toThrow('COGNITO_REFRESH_REJECTED');
    await expect(validateRefreshToken(sample, async () => ({
      ok: true, json: async () => ({ AuthenticationResult: { AccessToken: 'a' } }),
    }))).rejects.toThrow('COGNITO_REFRESH_MISSING_SESSION');
  });

  it('writes only a private file outside the repo; output is not printed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pointsyeah-test-'));
    try {
      const file = join(root, 'token.txt');
      await secureSaveToken(file, sample);
      const mode = (await stat(file)).mode & 0o777;
      expect(mode).toBe(0o600);
      expect(await readFile(file, 'utf8')).toBe(sample + '\n');
      await expect(secureSaveToken(join(process.cwd(), 'unsafe.txt'), sample))
        .rejects.toThrow('REFUSING_TO_WRITE_SECRET_INSIDE_GIT_REPOSITORY');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
