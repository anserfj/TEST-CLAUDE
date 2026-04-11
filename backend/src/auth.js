import crypto from 'crypto';

// In-memory token store: token -> expiry timestamp
const tokens = new Map();
// Failed login tracking: ip -> { count, lockedUntil }
const failedAttempts = new Map();

const TOKEN_TTL    = 24 * 60 * 60 * 1000; // 24 h
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000;       // 15 min

// Clean up expired tokens every hour
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of tokens) if (now > exp) tokens.delete(t);
}, 60 * 60 * 1000);

export function generateToken() {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL);
  return token;
}

export function isTokenValid(token) {
  if (!token) return false;
  const expiry = tokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) { tokens.delete(token); return false; }
  return true;
}

export function invalidateToken(token) {
  tokens.delete(token);
}

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

export function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!isTokenValid(token)) return res.status(401).json({ error: 'Non authentifié' });
  next();
}
