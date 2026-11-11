// Interne funktioner bag en aktiveringsnøgle.

const crypto = require('crypto');
const { loadSettings } = require('../config');

// ── Interne funktioner ────────────────────────────────────────────────────────
// Flow Builder (beta) og Demo-kunden er til internt brug. De er skjult indtil
// der er indtastet en aktiveringsnøgle. Kun nøglens SHA-256 står her — selve
// nøglen står aldrig i koden. Det er funktionsstyring, ikke adgangskontrol:
// den der har koden kan fjerne spærringen.
// Ny nøgle: node -e "console.log(require('crypto').createHash('sha256').update('MIN-NØGLE').digest('hex'))"
const FEATURE_KEY_SHA256 = '61add01651494dfa4b7f4aeb63adb8f5d2749f2844b5d90d1f858b37012f2eee';

function keyMatches(key) {
  if (typeof key !== 'string' || !key) return false;
  const a = Buffer.from(crypto.createHash('sha256').update(key.trim()).digest('hex'));
  return crypto.timingSafeEqual(a, Buffer.from(FEATURE_KEY_SHA256));
}
function internalUnlocked() { return keyMatches(loadSettings().featureKey); }
function requireInternal(req, res, next) {
  if (internalUnlocked()) return next();
  res.status(403).json({ error: 'Funktionen kræver en aktiveringsnøgle' });
}

module.exports = { keyMatches, internalUnlocked, requireInternal };
