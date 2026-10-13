/**
 * auth/core.mjs
 *
 * The partner's own-password sign-in, shared by the middleware (Edge) and the
 * auth function (Node). Web Crypto only, so it runs in both.
 *
 * - Passwords: PBKDF2-SHA256, 600,000 iterations, random 16-byte salt. Only
 *   the hash is stored; nobody (Hirobius included) can read the password.
 * - Sessions: a stateless cookie `payload.signature`, HMAC-SHA256 with
 *   SESSION_SECRET. Changing SESSION_SECRET signs everyone out.
 */

const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export const SESSION_COOKIE = 'sterling_session';
export const SESSION_DAYS = 14;
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200;

function toB64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(str) {
  const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const hmacKey = (secret) => subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** A signed session token for `role` ("partner" or "admin"). */
export async function signSession(role, secret, { now = Date.now(), days = SESSION_DAYS } = {}) {
  const payload = toB64u(enc.encode(JSON.stringify({ r: role, exp: now + days * 86_400_000 })));
  const sig = await subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return `${payload}.${toB64u(sig)}`;
}

/** The session's role if the token is genuine and unexpired, else null. */
export async function verifySession(token, secret, { now = Date.now() } = {}) {
  if (!token || !secret || typeof token !== 'string') return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const ok = await subtle.verify('HMAC', await hmacKey(secret), fromB64u(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64u(payload)));
    if (typeof data.exp !== 'number' || data.exp <= now) return null;
    return data.r === 'partner' || data.r === 'admin' ? { role: data.r } : null;
  } catch {
    return null;
  }
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The session cookie. `days: null` makes it end when the browser closes. */
export function sessionCookie(token, days = SESSION_DAYS) {
  const life = days === null ? '' : `; Max-Age=${Math.round(days * 86_400)}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${life}`;
}

/** How long a sign-in lasts without "Keep me signed in". */
export const SHORT_SESSION_DAYS = 0.5;
export const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

async function pbkdf2(password, salt, iterations) {
  const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Hash a new password into a storable record. */
export async function hashPassword(password, { iterations = PBKDF2_ITERATIONS } = {}) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return { alg: 'pbkdf2-sha256', iterations, salt: toB64u(salt), hash: toB64u(hash) };
}

/** True if `password` matches the stored record. Constant-time compare. */
export async function verifyPassword(password, record) {
  if (!record || record.alg !== 'pbkdf2-sha256' || typeof password !== 'string') return false;
  const got = await pbkdf2(password, fromB64u(record.salt), record.iterations);
  return sameBytes(got, fromB64u(record.hash));
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function sha256(text) {
  return new Uint8Array(await subtle.digest('SHA-256', enc.encode(String(text ?? ''))));
}
export async function sha256Hex(text) {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare two strings without leaking where they differ. */
export async function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  return sameBytes(await sha256(a), await sha256(b));
}

/** A plain-English problem with a new password, or null if it's fine. */
export function checkNewPassword(password, confirm) {
  const p = String(password ?? '');
  if (p.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (p.length > MAX_PASSWORD) return `Use ${MAX_PASSWORD} characters or fewer.`;
  if (p !== String(confirm ?? '')) return "The two passwords don't match.";
  return null;
}
