// Datatabel-schemaet må ikke bære grænser Genesys afviser ved oprettelse, og
// wrap-up-fanen skal have tekst på alle seks sprog og en rute der er beskyttet.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sanitizeDatatableSchema } = require('../server.js');

const rod = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(rod, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(rod, 'public/index.html'), 'utf8');

test('grænser uden for talområdet fjernes fra schemaet', () => {
  const s = sanitizeDatatableSchema({ title: 'x', properties: {
    a: { type: 'number', minimum: -1e39, maximum: 1e39 },
    b: { type: 'integer', minimum: -5, maximum: 10 },
    c: { type: 'string' },
  } });
  assert.deepEqual(s.properties.a, { type: 'number' });
  assert.deepEqual(s.properties.b, { type: 'integer', minimum: -5, maximum: 10 });
  assert.deepEqual(s.properties.c, { type: 'string' });
});

test('schemaet i kilden ændres ikke', () => {
  const kilde = { properties: { a: { type: 'number', minimum: -1e39 } } };
  sanitizeDatatableSchema(kilde);
  assert.equal(kilde.properties.a.minimum, -1e39);
});

test('wrap-up-migrering er en skrivende rute med målbeskyttelse', () => {
  assert.match(server, /'\/api\/wrapupcodes\/migrate':\s+'targetId'/);
  assert.match(server, /app\.get\('\/api\/customers\/:id\/wrapupcodes'/);
});

test('wrap-up-fanen har tekst på alle seks sprog', () => {
  for (const key of ['da_tab_wrapup', 'wu_codes', 'wu_search_ph', 'wu_migrate_btn', 'wu_loading', 'wu_none', 'wu_exists', 'tip_wu_migrate_btn']) {
    const antal = (html.match(new RegExp(`^[ \\t]*${key}:`, 'gm')) || []).length;
    assert.equal(antal, 6, `${key} findes ${antal} steder i LANGS, ikke 6`);
  }
});
