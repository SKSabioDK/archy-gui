// Totaltjek af data actions mellem to orgs: hver action i kilden sat op mod
// målet, og en sammenligning af kontrakterne for dem der hedder det samme.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');

const SRC = [
  { id: 's1', name: 'get_customer', category: 'DaVIS', integrationName: 'DaVIS', integrationType: 'custom-rest-actions' },
  { id: 's2', name: 'get_order',    category: 'Test - GC', integrationName: 'Test - GC', integrationType: 'purecloud-data-actions' },
  { id: 's3', name: 'send_mail',    category: 'Emails', integrationName: 'Emails', integrationType: 'purecloud-data-actions' },
  { id: 's4', name: 'calc_date',    category: 'Staging - Function Data Actions', integrationName: 'Staging - Function Data Actions', integrationType: 'function-data-actions' },
  { id: 's5', name: 'lookup_zip',   category: 'Staging - Function Data Actions', integrationName: 'Staging - Function Data Actions', integrationType: 'function-data-actions' }
];
const TGT = [
  { category: 'DaVIS', name: 'get_customer' },
  { category: 'GC - Flows', name: 'get_order' },
  { category: 'GC - Flows', name: 'send_mail_v2' },
  { category: 'Function Data Actions', name: 'lookup_zip' }
];

test('hver kilde-action får sin status mod målet', () => {
  const rows = s.compareDataActionSets(SRC, TGT, [{ from: { category: 'Emails', name: 'send_mail' }, to: TGT[2] }]);
  assert.deepEqual(rows.map(r => r.status), ['same', 'choose', 'mapped', 'absent', 'choose']);
  assert.deepEqual(rows[1].candidates, [{ category: 'GC - Flows', name: 'get_order' }]);
  assert.deepEqual(rows[2].mappedTo, TGT[2]);
});

test('Function Data Actions markeres, og tælles kun når de mangler', () => {
  const rows = s.compareDataActionSets(SRC, TGT, []);
  assert.deepEqual(rows.map(r => r.fda), [false, false, false, true, true]);
  // lookup_zip findes i målet under en anden kategori — men kategorien er et valg, ikke en match.
  const sum = s.summarizeDataActionRows(rows);
  assert.equal(sum.total, 5);
  assert.equal(sum.same, 1);
  assert.equal(sum.fdaMissing, 2);
});

test('opsummeringen tæller hver status', () => {
  const rows = s.compareDataActionSets(SRC, TGT, [{ from: { category: 'Emails', name: 'send_mail' }, to: TGT[2] }]);
  assert.deepEqual(s.summarizeDataActionRows(rows),
    { total: 5, same: 1, mapped: 1, choose: 2, absent: 1, fdaMissing: 2 });
});

test('et tomt mål gør alt til absent', () => {
  const rows = s.compareDataActionSets(SRC, [], []);
  assert.ok(rows.every(r => r.status === 'absent'));
});

const skema = (props, required = []) => ({ type: 'object', properties: props, required });
const action = (inp, out) => ({ contract: { input: { inputSchema: inp }, output: { successSchema: out } } });

test('ens kontrakter er ens', () => {
  const a = action(skema({ id: { type: 'string' } }, ['id']), skema({ name: { type: 'string' } }));
  assert.deepEqual(s.compareContracts(a, JSON.parse(JSON.stringify(a))), { same: true, diffs: [] });
});

test('kontrakten afslører et felt der mangler, er ekstra eller har en anden type', () => {
  const a = action(skema({ id: { type: 'string' }, ssn: { type: 'string' } }), skema({ total: { type: 'number' } }));
  const b = action(skema({ id: { type: 'integer' }, extra: { type: 'string' } }), skema({ total: { type: 'number' } }));
  const r = s.compareContracts(a, b);
  assert.equal(r.same, false);
  assert.deepEqual(r.diffs, [
    { side: 'input', kind: 'type', name: 'id', from: 'string', to: 'integer' },
    { side: 'input', kind: 'missing-in-target', name: 'ssn' },
    { side: 'input', kind: 'extra-in-target', name: 'extra' }
  ]);
});

test('et felt der er blevet påkrævet, er en forskel', () => {
  const a = action(skema({ id: { type: 'string' } }, []), skema({}));
  const b = action(skema({ id: { type: 'string' } }, ['id']), skema({}));
  assert.deepEqual(s.compareContracts(a, b).diffs, [{ side: 'input', kind: 'required', name: 'id', from: false, to: true }]);
});

test('en action uden kontrakt giver ikke en fejl', () => {
  assert.equal(s.compareContracts({}, {}).same, true);
  assert.equal(s.compareContracts(null, undefined).same, true);
});
