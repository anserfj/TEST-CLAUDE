import crypto from 'crypto';
import db from './db/database.js';

// In-memory token store: token -> { expiry, lastUsed }
const tokens = new Map();
// Failed login tracking: ip -> { count, lockedUntil }
const failedAttempts = new Map();
// Pending 2FA sessions: tempToken -> { ip, expiry }
const pending2fa = new Map();

const TOKEN_TTL    = 24 * 60 * 60 * 1000; // 24 h
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000;       // 15 min
const TOTP_PENDING_TTL = 5 * 60 * 1000;    // 5 min to complete 2FA

// ── helpers ──────────────────────────────────────────────────────────────────
function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
}

function getIdleTimeoutMs() {
  const min = parseInt(getSetting('session_timeout_minutes')) || 60;
  return min * 60 * 1000;
}

// ── Audit log ─────────────────────────────────────────────────────────────────
export function auditLog(action, details = null, ip = null) {
  try {
    db.prepare('INSERT INTO audit_log (action, details, ip) VALUES (?, ?, ?)').run(action, details ? JSON.stringify(details) : null, ip);
  } catch(e) { console.error('auditLog error:', e.message); }
}

// Clean up expired tokens and pending sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [t, v] of tokens) if (now > v.expiry || now > v.lastUsed + getIdleTimeoutMs()) tokens.delete(t);
  for (const [t, v] of pending2fa) if (now > v.expiry) pending2fa.delete(t);
}, 60 * 60 * 1000);

// ── Token management ──────────────────────────────────────────────────────────
export function generateToken() {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { expiry: Date.now() + TOKEN_TTL, lastUsed: Date.now() });
  return token;
}

export function isTokenValid(token) {
  if (!token) return false;
  const entry = tokens.get(token);
  if (!entry) return false;
  const now = Date.now();
  if (now > entry.expiry) { tokens.delete(token); return false; }
  if (now > entry.lastUsed + getIdleTimeoutMs()) { tokens.delete(token); return false; }
  // Refresh lastUsed
  entry.lastUsed = now;
  return true;
}

export function invalidateToken(token) {
  tokens.delete(token);
}

// ── 2FA pending sessions ──────────────────────────────────────────────────────
export function createPending2fa(ip) {
  const tempToken = crypto.randomBytes(16).toString('hex');
  pending2fa.set(tempToken, { ip, expiry: Date.now() + TOTP_PENDING_TTL });
  return tempToken;
}

export function validatePending2fa(tempToken, ip) {
  const entry = pending2fa.get(tempToken);
  if (!entry) return false;
  if (Date.now() > entry.expiry) { pending2fa.delete(tempToken); return false; }
  if (entry.ip !== ip) return false;
  pending2fa.delete(tempToken);
  return true;
}

// ── Brute force protection ────────────────────────────────────────────────────
export function checkLoginAllowed(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const remaining = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return { allowed: false, remaining };
  }
  return { allowed: true };
}

export function recordFailedAttempt(ip) {
  const entry = failedAttempts.get(ip) || { count: 0, lockedUntil: null };
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failedAttempts.set(ip, entry);
}

export function recordSuccessLogin(ip) {
  failedAttempts.delete(ip);
}

// ── Auth middleware ───────────────────────────────────────────────────────────
export function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!isTokenValid(token)) return res.status(401).json({ error: 'Non authentifié' });
  req._token = token;
  next();
}
