// Migreringsrapporten samler hvad der gik godt og ikke på tværs af faner og flows.
// Testen sikrer at hver migrering faktisk skriver rækker, og at teksterne findes
// på alle seks sprog.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function funktion(navn) {
  const start = HTML.indexOf(navn);
  assert.notEqual(start, -1, navn + ' findes ikke');
  return HTML.slice(start, HTML.indexOf('\n}\n', start));
}

test('hver migrering starter og afslutter en rapport og skriver rækker', () => {
  for (const navn of ['async function daMigrateSelected()', 'async function prMigrateSelected()', 'async function scMigrateSelected()',
    'async function dtMigrateSelected()', 'async function wuMigrateSelected()', 'async function mlMigrate(k)',
    'async function dpMigrate()', 'async function _runMigration()']) {
    const f = funktion(navn);
    assert.match(f, /migStart\(/, navn + ' mangler migStart');
    assert.match(f, /migEnd\(\)/, navn + ' mangler migEnd');
    assert.match(f, /migRec\(/, navn + ' mangler migRec');
  }
  assert.match(funktion('async function migrateOneDep('), /migRec\(dep\.name/, 'afhængigheder skal med');
});

test('flowkørslen registrerer alle fire udfald: lykkedes, sprunget over, fejlet og undtagelse', () => {
  const f = funktion('async function _runMigration()');
  assert.match(f, /migRec\(name, 'ok'/);
  assert.match(f, /migRec\(name, 'skipped'/);
  assert.match(f, /migRec\(name, 'failed', prep\.error\)/);
  assert.match(f, /migRec\(name, 'failed', data\.error\)/);
  assert.match(f, /migRec\(name, 'failed', e\.message\)/);
});

test('rapporten indeholder aldrig secrets', () => {
  const f = funktion('async function mlMigrate(k)');
  const rapport = f.match(/migRec\([^;]*;/g).join('\n');
  assert.ok(!/secret/i.test(rapport), 'secret må ikke ende i migRec');
});

test('begge sider har bjælken, og teksterne findes på alle seks sprog', () => {
  assert.equal((HTML.match(/class="mig-bar"/g) || []).length, 2);
  for (const k of ['mig_auto', 'mig_download', 'mig_clear', 'mig_clear_confirm', 'mig_st_ok', 'mig_st_skipped', 'mig_st_failed', 'mig_file', 'mig_type_flow', 'mig_tip'])
    assert.equal(HTML.split(k + ':').length - 1, 6, k);
});
