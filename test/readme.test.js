// README'en løb fra programmet: toppen sagde v1.46.1, den engelske del v1.33.0,
// og ingen opdagede det. Versionen står nu fire steder — package.json,
// brugerfladen, CHANGELOG og README — og antallet af tests to steder i README.
// Denne test fælder hvis ét af dem ikke følger med.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rod = path.join(__dirname, '..');
const laes = f => fs.readFileSync(path.join(rod, f), 'utf8');
const VERSION = require('../package.json').version;
const README = laes('README.md');

test('README nævner kun den aktuelle version', () => {
  const alle = [...README.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)].map(m => m[1]);
  assert.ok(alle.length >= 3, `fandt kun ${alle.length} versionsnumre i README`);
  const forkerte = [...new Set(alle.filter(v => v !== VERSION))];
  assert.deepEqual(forkerte, [], `README nævner andre versioner end ${VERSION} (package.json): ${forkerte.join(', ')}`);
  assert.ok(README.split('\n')[0].includes(`v${VERSION}`), 'overskriften har ikke den aktuelle version');
});

test('brugerfladen og CHANGELOG har samme version som package.json', () => {
  const ui = laes('public/index.html').match(/id="app-version">v([\d.]+) · Archy GUI/);
  assert.ok(ui, 'app-version findes ikke i index.html');
  assert.equal(ui[1], VERSION, 'versionen i brugerfladen');
  const log = laes('CHANGELOG.md').match(/^### v([\d.]+)/m);
  assert.ok(log, 'ingen versionsoverskrift i CHANGELOG.md');
  assert.equal(log[1], VERSION, 'den øverste version i CHANGELOG.md');
});

test('antallet af tests i README passer', () => {
  const filer = fs.readdirSync(path.join(rod, 'test')).filter(f => f.endsWith('.test.js'));
  const antal = filer.reduce((n, f) => n + (laes('test/' + f).match(/^\s*test\(/gm) || []).length, 0);
  const da = README.match(/(\d+) enhedstests/), en = README.match(/(\d+) unit tests/);
  assert.ok(da && en, 'README nævner ikke antallet af tests');
  assert.equal(Number(da[1]), antal, 'antal enhedstests i den danske del');
  assert.equal(Number(en[1]), antal, 'antal unit tests i den engelske del');
});
