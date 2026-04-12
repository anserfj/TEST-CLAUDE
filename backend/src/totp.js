// ── TOTP (RFC 6238) — pure Node.js crypto, no external deps ──────────────────
import crypto from 'crypto';

// Base32 decode
const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(s) {
  s = s.replace(/=+$/, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const c of s) {
    const idx = B32_CHARS.indexOf(c);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 0xff); }
  }
  return Buffer.from(out);
}

// Base32 encode
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; out += B32_CHARS[(value >> bits) & 0x1f]; }
  }
  if (bits > 0) out += B32_CHARS[(value << (5 - bits)) & 0x1f];
  return out;
}

// HOTP
function hotp(key, counter) {
  const keyBuf = base32Decode(key);
  const ctrBuf = Buffer.alloc(8);
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  ctrBuf.writeUInt32BE(hi, 0);
  ctrBuf.writeUInt32BE(lo, 4);
  const hmac = crypto.createHmac('sha1', keyBuf).update(ctrBuf).digest();
  const offset = hmac[19] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24)
             | (hmac[offset + 1] << 16)
             | (hmac[offset + 2] << 8)
             | hmac[offset + 3];
  return String(code % 1000000).padStart(6, '0');
}

// TOTP — verify with ±1 step window (30s)
export function verifyTotp(secret, token) {
  const t = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    if (hotp(secret, t + delta) === String(token).trim()) return true;
  }
  return false;
}

// Generate a new random secret (20 bytes = 160 bits)
export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// Build a provisioning URI (for QR code)
export function totpUri(secret, label = 'Baltimore83', issuer = 'Baltimore83') {
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
