// Krav til Node.js-versionen (sikkerhedsrettelserne fra 21. oktober 2026).

// ── Node.js-version ──────────────────────────────────────────────────────────
// Sikkerhedsrettelserne fra 21. oktober 2026 (bl.a. Brotli-dekoderen og TLS-
// certifikattjek) ligger i disse versioner og nyere i hver linje. Ældre linjer
// (18, 20, 25) får ingen rettelser. Opdater listen, når Node udgiver nye.
const NODE_MIN_PATCHED = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };

function nodeSecurityStatus(version) {
  const v = String(version || '').replace(/^v/, '').split('.').map(Number);
  const min = NODE_MIN_PATCHED[v[0]];
  if (!min) {
    const nyere = v[0] > Math.max(...Object.keys(NODE_MIN_PATCHED).map(Number));
    return { ok: nyere, minimum: Object.values(NODE_MIN_PATCHED).map(m => m.join('.')).join(' / ') };
  }
  const ok = v[1] > min[1] || (v[1] === min[1] && v[2] >= min[2]);
  return { ok, minimum: min.join('.') };
}

{
  const st = nodeSecurityStatus(process.versions.node);
  if (!st.ok) console.warn(`[node] v${process.versions.node} mangler sikkerhedsrettelserne fra 21. oktober 2026 — opdater til mindst ${st.minimum}`);
}

module.exports = { nodeSecurityStatus };
