// Backup-knapperne på siden Migrér ressourcer: ruten må kun læse, og knapperne
// skal have tekst og tooltip på alle fem sprog.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rod = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(rod, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(rod, 'public/index.html'), 'utf8');

test('backup-ruten er en GET og står dermed ikke blandt de skrivende', () => {
  assert.match(server, /app\.get\('\/api\/customers\/:id\/backup'/);
  assert.doesNotMatch(server, /app\.post\('\/api\/customers\/:id\/backup'/);
});

test('backup-knapperne har tekst og tooltip på alle fem sprog', () => {
  for (const key of ['da_backup_btn', 'dt_backup_btn', 'tip_da_backup_btn', 'tip_dt_backup_btn']) {
    const antal = (html.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length;
    assert.equal(antal, 5, `${key} findes ${antal} steder i LANGS, ikke 5`);
  }
});
