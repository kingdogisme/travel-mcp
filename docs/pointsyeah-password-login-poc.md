# PointsYeah Free: local email/password re-login experiment

Goal: $0 added cost. Run this on the user's own NAS (or local PC), NEVER in
ChatGPT, public GitHub Actions with credentials, or a Vercel function.

## How it works
- Launches a NEW, isolated Playwright Chromium context.
- Opens https://www.pointsyeah.com/landing?route=signIn
- Finds the normal email/password form and submits YOUR OWN credentials.
- Collects only matching Cognito refreshToken cookies/localStorage (not the
  rest of the website's browser data).
- Calls AWS Cognito REFRESH_TOKEN_AUTH to verify the newly obtained token.
- Optionally saves the verified token to a mode-0600 file OUTSIDE this repo.
- Prints success/failure categories only, NEVER usernames, passwords or tokens.

No OAuth, CAPTCHA or MFA bypass. User-facing interactive verification can
prevent unattended login. Site structure may change. No site account has
been used during development.

## Anonymous page check
Requires Node 22 and locally available Chromium:
  npm ci --legacy-peer-deps
  npx playwright install chromium
  node scripts/pointsyeah-password-login.mjs --check-ui

Expected: POINTSYEAH_LOGIN_UI: FORM_FOUND (no credentials submitted)
An error means the login page, selectors or network were not compatible.
It does not imply the user's password is wrong.

## Local-only password test
Store credentials in a PRIVATE local env file OUTSIDE this repository,
chmod 0600; its directory must be chmod 0700. Node 22+ supports --env-file.

Required environment variables (placeholder examples only):
  POINTSYEAH_LOGIN_EMAIL=your-email
  POINTSYEAH_LOGIN_PASSWORD=your-password

Invoke without writing the token:
  node --env-file=/ABSOLUTE/PRIVATE/PATH/pointsyeah-login.env scripts/pointsyeah-password-login.mjs

Or write a verified token to a private location:
  node --env-file=/ABSOLUTE/PRIVATE/PATH/pointsyeah-login.env scripts/pointsyeah-password-login.mjs --output /ABSOLUTE/PRIVATE/PATH/refresh-token.txt

Use --headed on a machine with a graphical display for visual debugging.
Stop on MFA/captcha. Do not brute force accounts or bypass verification.
Do not put the account password in chat, git history, screenshots, logs,
a public CI job or a cloud deployment's environment variables.

## Test results vs remaining limitations
Deterministic unit tests verify the correct client cookie, URL, Cognito
refresh handshake, secure output mode and rejection of repo-internal
secret files.

The branch-only, no-credentials GitHub canary tries to locate the login UI.
That is NOT an authenticated integration test.

A real email/password login and live Cognito validation remain unverified
until the user executes the script on their own device.

## Next milestone (not implemented in this PR)
ONLY after normal email/password login works:
  1. Validate a freshly issued token.
  2. Use a tightly scoped Vercel API credential on NAS to update the
     POINTSYEAH_REFRESH_TOKEN Secret (never the account password).
  3. Redeploy the existing version.
  4. Run a lightweight MCP authentication smoke test.
  5. Roll back/alert if verification fails, preserving the last good secret.

Keep password handling entirely on the NAS and never send it to
ChatGPT / GitHub / Vercel. No automatic secret rotation is included yet.
