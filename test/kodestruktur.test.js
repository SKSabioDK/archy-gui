// Kodens opbygning (v1.81): src/server.js er kun indgangen. Ruterne står i
// routes/ (ét område pr. fil), hjælperne i lib/, og config.js finder mapperne.
// Testene her holder den opdeling: ingen ruter i server.js eller lib/, hver
// rute-fil er sat på, og ingen ring af require mellem filerne — en ring giver
// i CommonJS et halvt indlæst modul, hvor en funktion stille er undefined.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { serverFiler, kilde } = require('./kilde.js');

const RUTE = /^(?:app|router)\.(get|post|put|delete|patch)\(/m;

test('server.js har ingen ruter selv, og hver fil i routes/ er sat på', () => {
  const server = kilde('server.js');
  assert.ok(!RUTE.test(server), 'en rute står i server.js — den hører til i routes/');
  const ruteFiler = serverFiler().filter(f => f.startsWith('routes/'));
  assert.ok(ruteFiler.length >= 15, 'fandt kun ' + ruteFiler.length + ' rute-filer');
  for (const f of ruteFiler) {
    assert.ok(RUTE.test(kilde(f)), `${f} har ingen ruter`);
    assert.ok(server.includes(`app.use(require('./${f.replace(/\.js$/, '')}').router);`), `${f} er ikke sat på i server.js`);
  }
});

test('lib/ og config.js har ingen ruter og kræver aldrig routes/', () => {
  for (const f of serverFiler().filter(f => f.startsWith('lib/') || f === 'config.js')) {
    const kode = kilde(f);
    assert.ok(!RUTE.test(kode), `${f} har en rute`);
    assert.ok(!/require\('\.\.?\/routes\//.test(kode), `${f} kræver en rute-fil`);
  }
});

test('ingen ring af require mellem serverens filer', () => {
  const filer = serverFiler();
  const kanter = new Map(filer.map(f => {
    const dir = path.posix.dirname(f);
    const til = [...kilde(f).matchAll(/require\('(\.\.?\/[^']+)'\)/g)]
      .map(m => path.posix.normalize(path.posix.join(dir, m[1])).replace(/(\.js)?$/, '.js'))
      .filter(t => filer.includes(t));
    return [f, til];
  }));
  assert.ok(kanter.get('server.js').length > 20, 'scanneren fandt ikke server.js\' require');
  const status = new Map();
  const besoeg = (f, sti) => {
    if (status.get(f) === 'færdig') return;
    assert.notEqual(status.get(f), 'i gang', 'ring: ' + [...sti, f].join(' → '));
    status.set(f, 'i gang');
    for (const t of kanter.get(f)) besoeg(t, [...sti, f]);
    status.set(f, 'færdig');
  };
  for (const f of filer) besoeg(f, []);
});
