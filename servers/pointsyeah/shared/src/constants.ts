/**
 * PointsYeah Cognito configuration.
 * These are public values from the PointsYeah web app.
 */
export const COGNITO_USER_POOL_REGION = 'us-east-1';
export const COGNITO_CLIENT_ID = '3im8jrentts1pguuouv5s57gfu';
export const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_USER_POOL_REGION}.amazonaws.com/`;

/**
 * PointsYeah API base URL.
 */
export const API2_BASE = 'https://api2.pointsyeah.com';

/**
 * Default fetch timeout in milliseconds.
 */
export const FETCH_TIMEOUT_MS = 30_000;

/**
 * PointsYeah account/live API base URL.
 *
 * The website's account features (price alerts, preferences, wallet, the
 * transfer-bonus catalog) live on api.pointsyeah.com under /v2/live, a
 * different host from the search API above. It accepts the same Cognito ID
 * token as the rest of the app.
 */
export const LIVE_BASE = 'https://api.pointsyeah.com/v2/live';

/**
 * Default set of transferable bank currencies, matching the website defaults.
 */
export const DEFAULT_BANKS = ['Amex', 'Bilt', 'Capital One', 'Chase', 'Citi', 'WF'];

/**
 * Default cabin set used when creating a price alert, matching the website.
 */
export const DEFAULT_ALERT_CABINS = ['Economy', 'Premium Economy', 'Business', 'First'];
