// Google service-account auth without dependencies: sign a JWT with the account's
// private key (RS256) and exchange it for an access token.
import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let cached = null; // { token, exp, email }

export function readServiceAccount(env = process.env) {
  let creds = null;
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    try {
      creds = JSON.parse(text);
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (paste the whole key file, or base64 of it).');
    }
  } else if (env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY) {
    creds = { client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: env.GOOGLE_PRIVATE_KEY };
  }
  if (!creds || !creds.client_email || !creds.private_key) return null;
  return {
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    tokenUri: env.GOOGLE_TOKEN_URI || creds.token_uri || 'https://oauth2.googleapis.com/token',
  };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export async function getAccessToken(sa) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && cached.email === sa.email && cached.exp - 60 > nowSec) return cached.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.email, scope: SCOPE, aud: sa.tokenUri, iat: nowSec, exp: nowSec + 3600 }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(sa.key))}`;
  const res = await fetch(sa.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google sign-in failed (${res.status}): ${body.error_description || body.error || 'unknown error'}`);
  }
  cached = { token: body.access_token, exp: nowSec + (body.expires_in || 3600), email: sa.email };
  return cached.token;
}
