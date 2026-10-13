// En migreret data action oprettes med målintegrationens navn som kategori.
// Et flow slår en data action op på kategori og navn, og kategorien ER
// integrationens navn. Beholdt vi kildens kategori, kunne actionen stå i en
// integration der hedder noget andet, under et navn flowet ikke finder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('kategorien bliver målintegrationens navn', () => {
  assert.equal(s.actionCategoryFor('Test - Genesys Cloud Data Actions', 'Genesys Cloud Data Actions - Flows'),
    'Genesys Cloud Data Actions - Flows');
});

test('kan målintegrationens navn ikke læses, beholdes kildens kategori', () => {
  assert.equal(s.actionCategoryFor('DaVIS', ''), 'DaVIS');
  assert.equal(s.actionCategoryFor('DaVIS', '   '), 'DaVIS');
  assert.equal(s.actionCategoryFor('DaVIS', undefined), 'DaVIS');
});

test('actions/migrate opretter actionen med den udregnede kategori', () => {
  const rute = SERVER.slice(SERVER.indexOf("app.post('/api/actions/migrate'"), SERVER.indexOf("app.post('/api/datatables/migrate'"));
  assert.match(rute, /actionCategoryFor\(published\.category, integrationName\)/);
  assert.ok(!/category:\s+published\.category/.test(rute), 'kildens kategori må ikke sendes direkte videre');
  // Både et valgt og et automatisk fundet mål giver et navn.
  assert.match(rute, /integrationName = ir\.data\.name/);
  assert.match(rute, /integrationName = match\.name/);
});
