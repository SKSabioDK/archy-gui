// Data actions i et flow: kategori og navn, og valgene til når de to orgs ikke
// bruger samme navne. Kunden i sagen har "Test - Genesys Cloud Data Actions" i
// test og "Genesys Cloud Data Actions - Flows" i prod — et tjek på navn alene
// siger "findes", og importen fejler.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const YAML = [
  'inboundCall:',
  '  name: Ordrestatus',
  '  tasks:',
  '    - task:',
  '        actions:',
  '          - callData:',
  '              name: Hent ordre',
  '              category:',
  '                Test - Genesys Cloud Data Actions:',
  '                  dataAction:',
  '                    get_order:',
  '                      inputs:',
  '                        id:',
  '                          lit: "1"',
  '          - callData:',
  '              name: Hent kunde',
  '              category:',
  '                "DaVIS Web Services Data Actions":',
  '                  dataAction:',
  '                    "get customer (v2)":',
  '                      inputs: {}',
  ''
].join('\n');

const REFS = [
  { category: 'Test - Genesys Cloud Data Actions', name: 'get_order' },
  { category: 'DaVIS Web Services Data Actions', name: 'get customer (v2)' }
];

const MAAL = [
  { category: 'Genesys Cloud Data Actions - Flows', name: 'get_order' },
  { category: 'DaVIS Web Services Data Actions', name: 'get customer (v2)' },
  { category: 'Genesys Cloud Data Actions - QM', name: 'andet' }
];

test('flowets data actions læses med kategori og navn, også med citationstegn', () => {
  assert.deepEqual(s.scanDataActionRefs(YAML), REFS);
});

test('samme reference to steder tælles én gang', () => {
  assert.equal(s.scanDataActionRefs(YAML + YAML.slice(YAML.indexOf('          - callData:'))).length, 2);
});

test('ingen data actions giver ingen referencer', () => {
  assert.deepEqual(s.scanDataActionRefs('inboundCall:\n  name: X\n'), []);
});

test('samme navn under en anden kategori er et valg, ikke "findes"', () => {
  const r = s.classifyDataActionRefs(REFS, MAAL, []);
  assert.equal(r[0].status, 'choose');
  assert.deepEqual(r[0].candidates, [{ category: 'Genesys Cloud Data Actions - Flows', name: 'get_order' }]);
  assert.equal(r[1].status, 'exact');
});

test('et navn der ikke findes i målet, er absent', () => {
  const r = s.classifyDataActionRefs([{ category: 'X', name: 'findes_ikke' }], MAAL, []);
  assert.equal(r[0].status, 'absent');
  assert.deepEqual(r[0].candidates, []);
});

test('et gemt valg gælder kun hvis målet stadig har den action', () => {
  const gemt = [{ from: REFS[0], to: MAAL[0] }];
  assert.equal(s.classifyDataActionRefs([REFS[0]], MAAL, gemt)[0].status, 'mapped');
  assert.equal(s.classifyDataActionRefs([REFS[0]], MAAL.slice(1), gemt)[0].status, 'absent');
});

test('findes referencen præcist i målet, vinder det over et gemt valg', () => {
  const gemt = [{ from: REFS[1], to: MAAL[2] }];
  assert.equal(s.classifyDataActionRefs([REFS[1]], MAAL, gemt)[0].status, 'exact');
});

test('omskrivningen retter kategori og navn og rører intet andet', () => {
  const r = s.applyDataActionMap(YAML, [{ from: REFS[0], to: MAAL[0] }], MAAL);
  assert.deepEqual(r.changed, ['Test - Genesys Cloud Data Actions / get_order → Genesys Cloud Data Actions - Flows / get_order']);
  assert.match(r.yaml, /Genesys Cloud Data Actions - Flows:\n\s+dataAction:\n\s+get_order:/);
  assert.doesNotMatch(r.yaml, /Test - Genesys/);
  // Den anden reference findes allerede i målet og står uændret, med citationstegn.
  assert.match(r.yaml, /"DaVIS Web Services Data Actions":\n\s+dataAction:\n\s+"get customer \(v2\)":/);
});

test('omskrivningen kan pege et navn over på et andet navn', () => {
  const r = s.applyDataActionMap(YAML, [{ from: REFS[0], to: MAAL[2] }], MAAL);
  assert.match(r.yaml, /Genesys Cloud Data Actions - QM:\n\s+dataAction:\n\s+andet:/);
});

test('et valg der peger på noget målet ikke har, skrives aldrig ind', () => {
  const r = s.applyDataActionMap(YAML, [{ from: REFS[0], to: { category: 'Findes ikke', name: 'x' } }], MAAL);
  assert.equal(r.yaml, YAML);
  assert.deepEqual(r.changed, []);
});

test('uden valg er teksten uændret', () => {
  assert.equal(s.applyDataActionMap(YAML, [], MAAL).yaml, YAML);
});

test('valg flettes på kilden, og det nyeste vinder', () => {
  const a = [{ from: REFS[0], to: MAAL[0] }];
  const b = [{ from: REFS[0], to: MAAL[2] }, { from: REFS[1], to: MAAL[1] }];
  const m = s.mergeDaEntries(a, b);
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].to, MAAL[2]);
});

test('ugyldige valg sorteres fra', () => {
  assert.equal(s.validDaEntry({ from: REFS[0], to: MAAL[0] }), true);
  assert.equal(s.validDaEntry({ from: REFS[0] }), false);
  assert.equal(s.validDaEntry({ from: { category: '', name: 'x' }, to: MAAL[0] }), false);
  assert.equal(s.validDaEntry(null), false);
  assert.deepEqual(s.mergeDaEntries([{ nonsens: 1 }], [null]), []);
});

test('commit anvender og husker valgene først efter en vellykket import', () => {
  const commit = SERVER.slice(SERVER.indexOf("app.post('/api/migrate/commit'"));
  const omskriv = commit.indexOf('applyDataActionMap');
  const importer = commit.indexOf('runArchy(');
  const husk = commit.indexOf('saveDataActionMap');
  assert.ok(omskriv > 0 && omskriv < importer, 'omskrivningen kommer før importen');
  assert.ok(husk > importer, 'valgene gemmes først efter importen');
  // Den lokale kopi af kildens flow må ikke skrives ovenpå.
  assert.match(commit, /\.import-\$\{sanitizeName\(target\.name\)\}/);
});

test('nøglen til de gemte valg er ikke en flowrække', () => {
  // Nøgler med "|" er flows. Den må ikke ende på tavlen.
  assert.ok(!SERVER.match(/const DA_MAP_KEY = '[^']*\|/));
});
