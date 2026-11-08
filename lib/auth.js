// Three fixed accounts. Login is a password only: which password matches decides the account.
import crypto from 'node:crypto';

const COOKIE = 'pl_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function accounts(env = process.env) {
  return [
    { id: 'coach1', role: 'coach', name: env.COACH1_NAME || 'Coach A', password: env.COACH1_PASSWORD },
    { id: 'coach2', role: 'coach', name: env.COACH2_NAME || 'Coach B', password: env.COACH2_PASSWORD },
    { id: 'student', role: 'student', name: env.STUDENT_NAME || 'Student', password: env.STUDENT_PASSWORD },
  ];
}

/** Returns a list of problems with the auth configuration (empty = fine). */
export function authProblems(env = process.env) {
  const problems = [];
  const list = accounts(env);
  for (const a of list) {
    if (!a.password) problems.push(`${a.id.toUpperCase()}_PASSWORD is not set`);
    else if (a.password.length < 8) problems.push(`${a.id.toUpperCase()}_PASSWORD must be at least 8 characters`);
  }
  const pw = list.map((a) => a.password).filter(Boolean);
  if (new Set(pw).size !== pw.length) problems.push('The three passwords must all be different');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) problems.push('SESSION_SECRET must be set (at least 16 characters)');
  return problems;
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export function matchPassword(password, env = process.env) {
  let found = null;
  for (const a of accounts(env)) {
    if (a.password && safeEqual(password, a.password)) found = a; // no early exit: constant work
  }
  return found;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function makeSessionCookie(account, { secure, env = process.env } = {}) {
  const payload = Buffer.from(JSON.stringify({ u: account.id, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
  const value = `${payload}.${sign(payload, env.SESSION_SECRET)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie({ secure } = {}) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Account for the request's session cookie, or null. */
export function sessionAccount(cookieHeader, env = process.env) {
  const raw = parseCookies(cookieHeader)[COOKIE];
  if (!raw || !env.SESSION_SECRET) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload, env.SESSION_SECRET))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  const acct = accounts(env).find((a) => a.id === data.u);
  if (!acct || !acct.password) return null;
  return { id: acct.id, role: acct.role, name: acct.name };
}
