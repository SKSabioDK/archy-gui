// Systemloggen skal ALTID være engelsk, uanset hvilket sprog brugerfladen står
// på. Loggen er driftsdata: den bliver kopieret ind i en sag, sendt videre og
// læst af folk der ikke nødvendigvis kører programmet i samme sprog som den
// der lavede migreringen.
//
// Testen læser server.js og fælder hvis en dansk besked er sluppet ind — enten
// direkte i et addLog-kald, eller ad bagvejen gennem en kastet fejl, som ender
// i loggen som ${e.message}.
//
// To ting bliver bevidst IKKE fanget, fordi de ikke er log:
//   · brugerfladens egne tekster, som kommer fra LANGS i index.html
//   · res.json({ error: … }) — vejledning der vises i en dialog for brugeren

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Ord der ikke findes i engelsk, og som derfor afslører dansk uden at fælde
// almindelige engelske sætninger. "for", "er" og "til" står bevidst IKKE her —
// de ville give falske udslag på engelsk tekst.
const DANSKE_ORD = [
  'ikke', 'kunne', 'blev', 'findes', 'fejlede', 'mangler', 'skrevet', 'oprettet',
  'slettet', 'hentet', 'ingen', 'nogen', 'samme', 'flere', 'hver', 'uden',
  'publiceret', 'publicering', 'migreret', 'kopieret', 'omskrevet', 'omdøbt',
  'nulstillet', 'fjernet', 'tjekket', 'sprog', 'kolonner', 'certifikater',
  'ukendt', 'ugyldig', 'oprydning', 'eksport', 'anførselstegn', 'sprunget'
];
const NORDISKE = /[æøåÆØÅ]/;

function erDansk(raa) {
  // ${...} er kode, ikke tekst. Et variabelnavn som ${omskrevet} siger intet
  // om hvilket sprog BESKEDEN er på, og gav før et falsk udslag.
  const tekst = String(raa).replace(/\$\{[^}]*\}/g, " ");
  if (NORDISKE.test(tekst)) return true;
  const ord = tekst.toLowerCase().split(/[^a-zà-ÿ]+/);
  return DANSKE_ORD.some(d => ord.includes(d)) || /\bmilj/i.test(tekst);
}

// Argumentlisten til et kald, fra den åbnende parentes til den matchende
// lukkende. Uden balanceringen løb scanneren videre ind i den næste sætning og
// meldte en dansk res.json-besked som en dansk logbesked.
function argumenter(kilde, fraParentes) {
  let dybde = 0, i = fraParentes;
  for (; i < kilde.length; i++) {
    const c = kilde[i];
    if (c === '`' || c === "'" || c === '"') {           // spring strenge over
      const q = c; i++;
      while (i < kilde.length && kilde[i] !== q) { if (kilde[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '/' && kilde[i + 1] === '/') { while (i < kilde.length && kilde[i] !== '\n') i++; continue; }
    if (c === '(') dybde++;
    else if (c === ')') { dybde--; if (dybde === 0) return kilde.slice(fraParentes + 1, i); }
  }
  return kilde.slice(fraParentes + 1, Math.min(i, fraParentes + 600));
}

// Kommentarlinjer ud, så en dansk kommentar inde i kaldet ikke tæller med.
const udenKommentarer = (t) => t.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

function strengeI(tekst) {
  const ud = [];
  for (let i = 0; i < tekst.length; i++) {
    const q = tekst[i];
    if (q !== '`' && q !== "'" && q !== '"') continue;
    let j = i + 1;
    while (j < tekst.length && tekst[j] !== q) { if (tekst[j] === '\\') j++; j++; }
    ud.push(tekst.slice(i + 1, j));
    i = j;
  }
  return ud;
}

const linjeFor = (pos) => SERVER.slice(0, pos).split('\n').length;

function danskeI(kaldNavn) {
  const ud = [];
  let i = 0;
  while ((i = SERVER.indexOf(kaldNavn, i)) !== -1) {
    const p = SERVER.indexOf('(', i + kaldNavn.length - 1);
    const args = udenKommentarer(argumenter(SERVER, p));
    for (const streng of strengeI(args)) {
      if (erDansk(streng)) { ud.push(`linje ${linjeFor(i)}: ${streng.replace(/\s+/g, ' ').slice(0, 90)}`); break; }
    }
    i = p + 1;
  }
  return ud;
}

test('ingen addLog-besked er på dansk', () => {
  const danske = danskeI('addLog(');
  assert.deepEqual(danske, [], 'danske linjer i systemloggen:\n  ' + danske.join('\n  '));
});

test('ingen kastet fejl er på dansk — de ender i loggen som ${e.message}', () => {
  const danske = [...danskeI('throw new Error('), ...danskeI('reject(new Error(')];
  assert.deepEqual(danske, [], 'danske fejlbeskeder:\n  ' + danske.join('\n  '));
});

test('kontrol: opdageren fælder faktisk dansk', () => {
  // Uden dette kunne de to ovenstående bestå fordi mønstret ikke matcher noget.
  assert.equal(erDansk('Kunne ikke skrive manifest'), true);
  assert.equal(erDansk('Demo-kunde oprettet: 4 miljøer'), true);
  assert.equal(erDansk('Reference omskrevet'), true);
  assert.equal(erDansk('${skipped} sprunget over'), true);
  // …men et dansk VARIABELNAVN er ikke en dansk besked.
  assert.equal(erDansk('Reference rewritten: ${omskrevet}'), false);
  assert.equal(erDansk('Could not write the manifest'), false);
  assert.equal(erDansk('Migration complete: "${nyName}" is now in ${target.name}'), false);
  assert.equal(erDansk('Exported: ${yamlFile} → ${exportDir}'), false);
  assert.equal(erDansk('Baseline set for ${target.name}: ${recorded} flows recorded'), false);
});

test('kontrol: scanneren læser faktisk addLog-kald', () => {
  // En scanner der ikke finder noget ville bestå de to første tests i tavshed.
  let n = 0, i = 0;
  while ((i = SERVER.indexOf('addLog(', i)) !== -1) { n++; i += 7; }
  assert.ok(n > 80, `fandt kun ${n} addLog-kald — scanneren er gået i stå`);
});
