// Mappestrukturen (v1.80): kode i src/, kørselsdata i data/, logfiler i logs/.
// Før lå det hele løst i projektmappen, og en ældre installation flyttes på
// plads ved første start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const s = require('../src/server.js');

const rod = path.join(__dirname, '..');
const laes = f => fs.readFileSync(path.join(rod, f), 'utf8');

test('data og logfiler har hver sin mappe under projektmappen', () => {
  assert.equal(s.ROOT_DIR, rod);
  assert.equal(s.LOG_DIR, path.join(rod, 'logs'));
  if (!process.env.ARCHY_DATA_DIR) assert.equal(s.DATA_DIR, path.join(rod, 'data'));
  assert.equal(path.dirname(s.CUSTOMERS_FILE), s.DATA_DIR);
  assert.equal(path.dirname(s.FLOWS_DIR), s.DATA_DIR);
});

test('serveren finder kun projektmappen gennem ROOT_DIR i config.js', () => {
  const { serverFiler, kilde } = require('./kilde.js');
  const brug = serverFiler().flatMap(f => (kilde(f).match(/path\.join\(__dirname[^)]*\)/g) || []).map(m => `${f}: ${m}`));
  assert.deepEqual(brug, ["config.js: path.join(__dirname, '..')"], 'en sti bygges stadig direkte på __dirname');
});

test('start.bat starter src\\server.js og skriver i logs\\', () => {
  const bat = laes('start.bat');
  assert.match(bat, /%~dp0src\\server\.js/);
  assert.match(bat, /-RedirectStandardOutput '%~dp0logs\\server\.log'/);
  assert.match(bat, /mkdir "%~dp0logs"/);
  assert.equal(JSON.parse(laes('package.json')).main, 'src/server.js');
});

test('en gammel installation flyttes til data/ og logs/', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archy-mapper-'));
  try {
    const data = path.join(tmp, 'data'), logs = path.join(tmp, 'logs');
    fs.writeFileSync(path.join(tmp, 'customers.json'), '[1]');
    fs.writeFileSync(path.join(tmp, 'settings.json'), '{"gammel":true}');
    fs.mkdirSync(path.join(tmp, 'flows', 'Kunde'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'flows', 'Kunde', 'Flow_v1-0.yaml'), 'x');
    fs.writeFileSync(path.join(tmp, 'server.log'), 'gammel log');
    // Findes allerede på den nye plads: må ikke overskrives
    fs.mkdirSync(data); fs.writeFileSync(path.join(data, 'settings.json'), '{"ny":true}');
    // En tom data/flows (oprettet af npm test før første start) tæller ikke som flyttet
    fs.mkdirSync(path.join(data, 'flows'));
    // start.bat har allerede åbnet en ny logfil
    fs.mkdirSync(logs); fs.writeFileSync(path.join(logs, 'server.log'), 'ny log');

    const r = s.migrateLegacyLayout({ root: tmp, files: [
      ['customers.json', data], ['settings.json', data], ['flows', data], ['demo-data.json', data], ['server.log', logs],
    ] });

    assert.deepEqual(r.moved.sort(), ['customers.json', 'flows', 'server.log']);
    assert.deepEqual(r.failed, []);
    assert.equal(fs.readFileSync(path.join(data, 'customers.json'), 'utf8'), '[1]');
    assert.equal(fs.readFileSync(path.join(data, 'flows', 'Kunde', 'Flow_v1-0.yaml'), 'utf8'), 'x');
    assert.equal(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'), '{"ny":true}', 'den nye fil blev overskrevet');
    assert.ok(fs.existsSync(path.join(tmp, 'settings.json')), 'den gamle fil skal blive liggende, når den nye findes');
    assert.equal(fs.readFileSync(path.join(logs, 'server.log'), 'utf8'), 'ny log');
    assert.equal(fs.readFileSync(path.join(logs, 'server.old.log'), 'utf8'), 'gammel log');
    assert.ok(!fs.existsSync(path.join(tmp, 'customers.json')));

    // Anden start: intet at flytte
    assert.deepEqual(s.migrateLegacyLayout({ root: tmp, files: [['customers.json', data]] }).moved, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('data/ og logs/ holdes ude af git, også de gamle placeringer', () => {
  const ignore = laes('.gitignore');
  for (const linje of ['/data/', '/logs/', '/customers.json', '/flows/', '/terraform/'])
    assert.ok(ignore.split(/\r?\n/).includes(linje), linje);
});
