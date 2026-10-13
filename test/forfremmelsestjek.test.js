// Tjek før forfremmelse: det samme som første fase af en forfremmelse, uden at
// noget importeres. Afgørelsen er ren, og tjekket og forfremmelsen deler
// vagterne og analysen, så de aldrig er uenige.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const dep = (kind, name, o = {}) => ({ kind, name, ok: false, ...o });

test('alt findes: intet blokerer, og alt tælles som i orden', () => {
  const v = s.buildMigrationVerdict({ deps: [{ kind: 'queue', name: 'Q', ok: true }, { kind: 'datatable', name: 'T', ok: true }], actionRefs: [] });
  assert.deepEqual(v, { blockers: [], decisions: [], warnings: [], ok: 2, canPromote: true });
});

test('en Function Data Action der mangler, blokerer', () => {
  const v = s.buildMigrationVerdict({ deps: [dep('dataaction', 'calc', { manualReason: 'function', blocking: true })], actionRefs: [] });
  assert.equal(v.canPromote, false);
  assert.deepEqual(v.blockers, [{ kind: 'dataaction', name: 'calc', code: 'fda' }]);
});

test('en data action der ikke findes i nogen af orgs, blokerer', () => {
  const v = s.buildMigrationVerdict({ deps: [dep('dataaction', 'spøgelse', { manualReason: 'not_in_source' })], actionRefs: [] });
  assert.equal(v.blockers[0].code, 'action-nowhere');
});

test('det forfremmelsen selv kan migrere, er en advarsel og blokerer ikke', () => {
  const v = s.buildMigrationVerdict({ deps: [dep('datatable', 'T', { canMigrate: true }), dep('dataaction', 'a', { canMigrate: true })], actionRefs: [] });
  assert.equal(v.canPromote, true);
  assert.deepEqual(v.warnings.map(w => w.code), ['will-migrate', 'will-migrate']);
});

test('det der skal oprettes i hånden, er en advarsel, ikke en blokering', () => {
  const v = s.buildMigrationVerdict({ deps: [dep('queue', 'Q', { manualReason: 'manual_only' }), dep('queue', 'R', { manualReason: 'not_in_source' }), dep('division', 'D', { needsChoice: true })], actionRefs: [] });
  assert.equal(v.canPromote, true);
  assert.deepEqual(v.warnings.map(w => w.code), ['manual', 'not-in-source', 'needs-choice']);
});

test('en data action under en anden kategori er et valg, ikke en blokering', () => {
  const v = s.buildMigrationVerdict({ deps: [], actionRefs: [
    { category: 'Test', name: 'get_order', status: 'choose', candidates: [{ category: 'Flows', name: 'get_order' }] },
    { category: 'X', name: 'ok', status: 'exact' }, { category: 'Y', name: 'gemt', status: 'mapped' }] });
  assert.equal(v.canPromote, true);
  assert.equal(v.decisions.length, 1);
  assert.deepEqual(v.decisions[0].candidates, [{ category: 'Flows', name: 'get_order' }]);
  assert.equal(v.ok, 1);            // den gemte; en præcis match tælles allerede som afhængighed
});

test('en tom analyse giver et tomt svar', () => {
  assert.deepEqual(s.buildMigrationVerdict({}), { blockers: [], decisions: [], warnings: [], ok: 0, canPromote: true });
});

test('tjek og forfremmelse deler vagterne og analysen', () => {
  const prepare = SERVER.slice(SERVER.indexOf("app.post('/api/migrate/prepare'"), SERVER.indexOf('async function migrationPreflight'));
  const check = SERVER.slice(SERVER.indexOf("app.post('/api/migrate/check'"), SERVER.indexOf("app.post('/api/migrate/commit'"));
  for (const part of [prepare, check]) {
    assert.match(part, /migrationPreflight\(/);
    assert.match(part, /analyzeFlowForMigration\(/);
  }
  // Tjekket importerer aldrig noget.
  assert.ok(!/runArchy\(/.test(check), 'tjekket må ikke skrive');
  assert.ok(!check.includes('/commit'));
});
