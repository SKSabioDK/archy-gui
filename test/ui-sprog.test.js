// Brugerfladen skal tale det sprog brugeren har valgt. Alle tekster kommer fra
// LANGS i index.html og hentes med t() — men en hardkodet streng midt i en
// funktion går uden om hele mekanismen og bliver stående på dansk, uanset hvad
// der står i sprogvælgeren.
//
// Det er sket to gange: eksportens slutbesked ("Alle 76 flows eksporteret til
// …") og hele YAML-validatorens udskrift stod på dansk i en engelsk flade.
// Begge steder var nabolinjerne oversat, så det så rigtigt ud i koden.
//
// Testen læser klient-JS'en i index.html og fælder hvis en dansk streng står
// uden for LANGS. Bevidst IKKE fanget:
//   · LANGS selv — dér SKAL der stå dansk
//   · danske kommentarer, som er husets stil
//   · HTML-delen, hvor dansk er den reservetekst der står indtil applyLang()
//     bytter den ud efter data-i18n

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Ord der ikke findes i engelsk, og som derfor afslører dansk uden at fælde
// almindelig engelsk tekst. Samme fremgangsmåde som sprogvagten på systemloggen
// i log-engelsk.test.js.
const DANSKE_ORD = [
  'ikke', 'kunne', 'blev', 'findes', 'fejlede', 'mangler', 'skrevet', 'oprettet',
  'slettet', 'hentet', 'ingen', 'nogen', 'samme', 'flere', 'hver', 'uden',
  'publiceret', 'publicering', 'migreret', 'kopieret', 'omskrevet', 'omdøbt',
  'nulstillet', 'fjernet', 'tjekket', 'sprog', 'kolonner', 'certifikater',
  'ukendt', 'ugyldig', 'oprydning', 'anførselstegn', 'sprunget',
  'vælg', 'vælger', 'valgt', 'gemt', 'gemmer', 'fandt', 'fundet', 'ressourcer',
  'linje', 'kolonne', 'nøgle', 'forventet', 'indhold', 'tomt', 'ugyldigt',
  'syntaks', 'navn', 'kunde', 'kunder', 'slet', 'stoppet', 'afbrudt', 'udgave',
  'trin', 'fejl', 'siden', 'derefter', 'stadig', 'alle', 'eksport', 'eksporteret',
  'klar', 'korrekt', 'gemte', 'vist', 'flowet', 'hentes', 'kører'
];
const NORDISKE = /[æøåÆØÅ]/;

function erDansk(raa) {
  // ${...} er kode, ikke tekst. Et dansk variabelnavn siger intet om hvilket
  // sprog beskeden er på.
  const tekst = String(raa).replace(/\$\{[^}]*\}/g, ' ');
  if (NORDISKE.test(tekst)) return true;
  const ord = tekst.toLowerCase().split(/[^a-zà-ÿ]+/);
  return DANSKE_ORD.some(d => ord.includes(d)) || /\bmilj/i.test(tekst);
}

// Kun <script>-blokkene uden src. Hver blok bærer sin egen startlinje i
// index.html med, så en melding peger på det sted man skal rette.
function scriptBlokke() {
  const ud = [];
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(HTML)) !== null) {
    const foer = HTML.slice(0, m.index + m[0].indexOf('>') + 1);
    ud.push({ kode: m[1], startLinje: foer.split('\n').length });
  }
  return ud;
}

// LANGS blankes ud frem for at klippes væk, så linjenumrene i resten af blokken
// stadig passer med filen.
function udenLangs(js) {
  const i = js.indexOf('const LANGS');
  if (i === -1) return js;
  const start = js.indexOf('{', i);
  let dybde = 0, slut = start;
  for (let j = start; j < js.length; j++) {
    if (js[j] === '{') dybde++;
    else if (js[j] === '}') { dybde--; if (!dybde) { slut = j + 1; break; } }
  }
  return js.slice(0, i) + js.slice(i, slut).replace(/[^\n]/g, ' ') + js.slice(slut);
}

// Et '/' starter kun et regex-litteral hvis der IKKE stod en værdi før. Uden den
// skelnen blev `job.current / job.total` læst som starten på et regex, og
// scanneren løb ud af trit med resten af filen og meldte kodestumper som tekst.
const FOER_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const ORD_FOER_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'delete', 'void', 'new', 'instanceof']);

// Én gennemløbning: kommentarer og regexer springes over, strenge samles.
function strengeI(js) {
  const ud = [];
  let sidsteTegn = '', sidsteOrd = '';
  for (let i = 0; i < js.length; i++) {
    const c = js[i];

    if (c === '/' && js[i + 1] === '/') { while (i < js.length && js[i] !== '\n') i++; continue; }
    if (c === '/' && js[i + 1] === '*') { const e = js.indexOf('*/', i + 2); i = e === -1 ? js.length : e + 1; continue; }

    if (c === '/' && (sidsteTegn === '' || FOER_REGEX.has(sidsteTegn) || ORD_FOER_REGEX.has(sidsteOrd))) {
      let j = i + 1, iKlasse = false;
      while (j < js.length) {
        if (js[j] === '\\') { j += 2; continue; }
        if (js[j] === '[') iKlasse = true;
        else if (js[j] === ']') iKlasse = false;
        else if (js[j] === '/' && !iKlasse) break;
        else if (js[j] === '\n') break;
        j++;
      }
      i = j; sidsteTegn = '/'; sidsteOrd = ''; continue;
    }

    if (c === '`' || c === "'" || c === '"') {
      let j = i + 1;
      while (j < js.length && js[j] !== c) { if (js[j] === '\\') j++; j++; }
      ud.push({ tekst: js.slice(i + 1, j), pos: i });
      i = j; sidsteTegn = c; sidsteOrd = ''; continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < js.length && /[A-Za-z0-9_$]/.test(js[j])) j++;
      sidsteOrd = js.slice(i, j); sidsteTegn = js[j - 1];
      i = j - 1; continue;
    }
    if (!/\s/.test(c)) { sidsteTegn = c; sidsteOrd = ''; }
  }
  return ud;
}

function danskeStrenge() {
  const ud = [];
  for (const { kode, startLinje } of scriptBlokke()) {
    const js = udenLangs(kode);
    for (const { tekst, pos } of strengeI(js)) {
      if (!erDansk(tekst)) continue;
      const linje = startLinje + js.slice(0, pos).split('\n').length - 1;
      ud.push(`index.html:${linje}: ${tekst.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  return ud;
}

test('ingen tekst i brugerfladen er hardkodet på dansk — den skal komme fra t()', () => {
  const danske = danskeStrenge();
  assert.deepEqual(danske, [], 'dansk uden om LANGS:\n  ' + danske.join('\n  '));
});

// ── Kontroller, så en scanner der er gået i stå ikke består i tavshed ─────────

test('kontrol: scanneren læser faktisk klient-JS\'en', () => {
  const blokke = scriptBlokke();
  assert.ok(blokke.length >= 2, `fandt kun ${blokke.length} script-blokke`);
  const antal = blokke.reduce((n, b) => n + strengeI(udenLangs(b.kode)).length, 0);
  assert.ok(antal > 1000, `fandt kun ${antal} strenge — scanneren er gået i stå`);
});

test('kontrol: LANGS bliver faktisk blanket ud', () => {
  // Uden dette ville hele ordbogen tælle med som fund, og testen ovenfor kunne
  // aldrig bestå — eller, hvis udblankningen tog for meget, aldrig fælde.
  const stor = scriptBlokke().find(b => b.kode.includes('const LANGS'));
  assert.ok(stor, 'fandt ikke LANGS i nogen script-blok');
  const efter = udenLangs(stor.kode);
  assert.equal(efter.length, stor.kode.length, 'udblankningen ændrede længden');
  assert.ok(!efter.includes('Ingen YAML i feltet'), 'LANGS blev ikke blanket ud');
  assert.ok(efter.includes('function applyLang'), 'udblankningen tog for meget');
});

test('kontrol: opdageren fælder faktisk dansk', () => {
  assert.equal(erDansk('Alle 76 flows eksporteret til "Transcom"'), true);
  assert.equal(erDansk('Indhold under "${flowType}:" er tomt eller ugyldigt'), true);
  assert.equal(erDansk('(findes ikke i org\'en)'), true);
  assert.equal(erDansk('Mangler "startUpRef:"'), true);
  // Uden 'klar' og 'korrekt' i ordlisten slap denne igennem — den har hverken
  // æ, ø, å eller et af de andre ord, og den var en af de fire rigtige fejl.
  assert.equal(erDansk('Alt ser korrekt ud — klar til import'), true);
  // …men engelsk skal slippe igennem, også med et dansk variabelnavn i.
  assert.equal(erDansk('All 76 flows exported to "Transcom"'), false);
  assert.equal(erDansk('Missing "{field}:"'), false);
  assert.equal(erDansk('Saved in ${valgtMiljoe}'), false);
  assert.equal(erDansk('rgba(255,107,53,.35)'), false);
});

// ── Ordbøgerne skal have de samme nøgler ──────────────────────────────────────
//
// Mangler en nøgle i ét sprog, falder t() tilbage på dansk — altså præcis den
// fejl resten af filen her handler om, bare gemt i ordbogen i stedet.

const SPROG = ['da', 'en', 'fr', 'nl', 'es'];

function noeglerFor(sprog) {
  const start = HTML.indexOf(`\n  ${sprog}: {`);
  assert.notEqual(start, -1, `fandt ikke sprogblokken ${sprog}`);
  // es er den sidste blok og lukkes af '};' i stedet for '  },' — uden den
  // grænse løb læsningen videre ned i koden efter LANGS og fandt "nøgler" dér.
  const kandidater = [HTML.indexOf('\n  },', start), HTML.indexOf('\n};', start)]
    .filter(i => i !== -1);
  const slut = kandidater.length ? Math.min(...kandidater) : HTML.length;
  const blok = HTML.slice(start, slut);
  return blok.split('\n')
    .map(l => (l.match(/^    ([a-zA-Z_][a-zA-Z0-9_]*)\s*:/) || [])[1])
    .filter(Boolean);
}

test('alle fem sprog har de samme nøgler', () => {
  const da = noeglerFor('da');
  assert.ok(da.length > 300, `fandt kun ${da.length} nøgler i da — læsningen er gået i stå`);
  const facit = new Set(da);
  const problemer = [];
  for (const sprog of SPROG.slice(1)) {
    const har = new Set(noeglerFor(sprog));
    for (const k of facit) if (!har.has(k)) problemer.push(`${sprog} mangler ${k}`);
    for (const k of har) if (!facit.has(k)) problemer.push(`${sprog} har ${k}, som da ikke har`);
  }
  assert.deepEqual(problemer, [], 'ujævne sprogblokke:\n  ' + problemer.join('\n  '));
});

test('ingen nøgle står to gange i samme sprog', () => {
  const dubletter = [];
  for (const sprog of SPROG) {
    const set = new Set();
    for (const k of noeglerFor(sprog)) {
      if (set.has(k)) dubletter.push(`${sprog}: ${k}`);
      set.add(k);
    }
  }
  assert.deepEqual(dubletter, [], 'nøgler der står to gange:\n  ' + dubletter.join('\n  '));
});
