// Hver handling i systemloggen har et mærke og står i filteret. Kom der en ny
// kategori til på serveren — SECURITY, REPUBLISH, MANIFEST … — stod den som
// almindelig tekst og kunne ikke filtreres. Denne test finder alle kategorier
// serveren bruger og kræver at brugerfladen kender dem.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Den sidste strengkonstant i hvert addLog(...)-kald er kategorien.
function kategorier() {
  const ud = new Set();
  let i = 0;
  while ((i = SERVER.indexOf('addLog(', i)) !== -1) {
    if (SERVER.slice(i - 9, i) === 'function ') { i += 7; continue; }
    let dybde = 0, j = i + 6, streng = null;
    for (; j < SERVER.length; j++) {
      const c = SERVER[j];
      if (streng) { if (c === '\\') j++; else if (c === streng) streng = null; continue; }
      if (c === '"' || c === "'" || c === '`') { streng = c; continue; }
      if (c === '(') dybde++;
      else if (c === ')' && --dybde === 0) break;
    }
    const m = SERVER.slice(i, j + 1).match(/,\s*'([A-Z_]+)'\s*\)$/);
    if (m) ud.add(m[1]);
    i = j;
  }
  return [...ud].sort();
}

test('hver log-kategori har et mærke og står i filteret', () => {
  const alle = kategorier();
  assert.ok(alle.length >= 10, `fandt kun ${alle.length} kategorier: ${alle.join(', ')}`);
  const maerker = HTML.match(/const ACTION_BADGE = \{([\s\S]*?)\};/)[1];
  const filter = HTML.match(/<select id="sl-action"[\s\S]*?<\/select>/)[0];
  const udenMaerke = alle.filter(k => !new RegExp(`\\b${k}:`).test(maerker));
  const udenFilter = alle.filter(k => !filter.includes(`value="${k}"`));
  assert.deepEqual(udenMaerke, [], 'kategorier uden mærke i ACTION_BADGE');
  assert.deepEqual(udenFilter, [], 'kategorier der mangler i filteret');
});
