// Skrivning til prod kræver at man er logget ind som sig selv (PKCE), og at
// Genesys siger at man har rettigheden — som standard architect:flow:publish,
// og eventuelt medlemskab af en bestemt gruppe.
//
// Vagten er kun så god som listen over ruter den står foran. Den sidste test
// her fælder hvis en ny skrivende rute dukker op uden at være taget stilling til.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const PROD  = { id: 'p1', name: 'Kunde — PROD', stage: 'prod', authType: 'oauth' };
const NU    = 1_800_000_000_000;
const login = (deploy, udloeber = NU + 3600e3) => ({ token: 'x', expiresAt: udloeber, deploy });
const ja    = { ok: true, who: 'a@b.dk', missing: [], checkedAt: NU - 60e3 };

// ── Rettighederne ────────────────────────────────────────────────────────────

test('en rettighed dækkes af sig selv og af stjerner', () => {
  assert.equal(s.permissionGranted('architect:flow:publish', 'architect:flow:publish'), true);
  assert.equal(s.permissionGranted('architect:flow:*', 'architect:flow:publish'), true);
  assert.equal(s.permissionGranted('*:*:*', 'architect:flow:publish'), true);
  assert.equal(s.permissionGranted('architect:flow:view', 'architect:flow:publish'), false);
  assert.equal(s.permissionGranted('architect:*', 'architect:flow:publish'), false);
  assert.equal(s.permissionGranted('', 'architect:flow:publish'), false);
});

test('uden opsætning kræves architect:flow:publish, og flere kan kræves', () => {
  assert.deepEqual(s.deployRequirements({}).permissions, [s.DEFAULT_DEPLOY_PERMISSION]);
  assert.deepEqual(s.deployRequirements({ deployPermission: 'a:b:c, d:e:f' }).permissions, ['a:b:c', 'd:e:f']);
});

test('vurderingen siger præcis hvad der mangler', () => {
  const need = { permissions: ['architect:flow:publish'], group: 'Prod Deployers' };
  const me = { email: 'a@b.dk', authorization: { permissions: ['architect:flow:view'] }, groups: [{ id: 'g1' }] };

  const nej = s.evaluateDeployRights(me, need, ['g2'], NU);
  assert.equal(nej.ok, false);
  assert.deepEqual(nej.missing.map(m => m.kind), ['permission', 'group']);

  const me2 = { ...me, authorization: { permissions: ['architect:*:*'] } };
  assert.equal(s.evaluateDeployRights(me2, need, ['g1'], NU).ok, true);
});

test('kan gruppen ikke slås op, er svaret nej', () => {
  // En vagt der lukker op når den er i tvivl, er ingen vagt.
  const me = { authorization: { permissions: ['*:*:*'] }, groups: [{ id: 'g1' }] };
  const r = s.evaluateDeployRights(me, { permissions: ['a:b:c'], group: 'X' }, null, NU, '403');
  assert.equal(r.ok, false);
  assert.equal(r.missing[0].kind, 'lookup');
});

// ── Vagten ───────────────────────────────────────────────────────────────────

test('andre trin og demoen er ikke omfattet', () => {
  assert.equal(s.prodWriteBlock({ ...PROD, stage: 'uat' }, null, NU), null);
  assert.equal(s.prodWriteBlock({ ...PROD, demo: true, authType: 'demo' }, null, NU), null);
});

test('prod med client credentials kan ikke skrives til', () => {
  // Med en secret på disken kunne enhver ved maskinen deploye.
  assert.equal(s.prodWriteBlock({ ...PROD, authType: 'credentials' }, null, NU).code, 'prod-oauth-required');
});

test('prod kræver et login med rettigheden', () => {
  assert.equal(s.prodWriteBlock(PROD, null, NU).code, 'prod-login');
  assert.equal(s.prodWriteBlock(PROD, login(undefined), NU).code, 'prod-login');
  assert.equal(s.prodWriteBlock(PROD, login(ja, NU - 1), NU).code, 'prod-login');
  const nej = { ok: false, who: 'a@b.dk', missing: [{ kind: 'permission', value: 'architect:flow:publish' }], checkedAt: NU };
  const r = s.prodWriteBlock(PROD, login(nej), NU);
  assert.equal(r.code, 'prod-rights');
  assert.match(r.error, /a@b\.dk/);
  assert.match(r.error, /architect:flow:publish/);
  assert.equal(s.prodWriteBlock(PROD, login(ja), NU), null);
});

test('deploy-retten udløber før tokenet', () => {
  // Et token lever et døgn. En pc der står ulåst efter frokost skal ikke
  // kunne deploye på formiddagens login.
  const gammel = { ...ja, checkedAt: NU - s.PROD_DEPLOY_WINDOW - 1 };
  assert.equal(s.prodWriteBlock(PROD, login(gammel), NU).code, 'prod-login');
});

// ── Ruterne ──────────────────────────────────────────────────────────────────

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Ruter der ikke skriver til en org — eller tjekker selv.
const SKRIVER_IKKE_TIL_ORG = new Set([
  '/api/version/check', '/api/customers', '/api/customers/:id', '/api/customers/:id/test',
  '/api/customers/:id/prefix-check',
  '/api/demo/promote', '/api/demo/publish', '/api/demo/create', '/api/demo/reset', '/api/demo',
  '/api/releases/diff', '/api/releases/notes', '/api/flows/dependents',
  '/api/flows/cross-hash', '/api/flows/compare',
  '/api/export', '/api/export-all', '/api/export-all/cancel/:jobId', '/api/validate-yaml',
  '/api/logs/clear', '/api/files/cleanup'
]);
const TJEKKER_SELV = ['/api/releases/rollback', '/api/releases/note'];

test('hver skrivende rute står foran vagten', () => {
  const ruter = [...SERVER.matchAll(/app\.(post|put|delete|patch)\('([^']+)'/g)].map(m => m[2]);
  const glemt = ruter.filter(r => !s.PROD_WRITE_ROUTES[r] && !SKRIVER_IKKE_TIL_ORG.has(r) && !TJEKKER_SELV.includes(r));
  assert.deepEqual(glemt, [], 'nye ruter — skriver de til en org, skal de i PROD_WRITE_ROUTES:\n  ' + glemt.join('\n  '));
  for (const r of Object.keys(s.PROD_WRITE_ROUTES)) assert.ok(ruter.includes(r), `${r} findes ikke længere`);
});

test('rollback og noter tjekker selv', () => {
  for (const r of TJEKKER_SELV)
    assert.ok(SERVER.includes(`refuseProdWrite(res, `) && SERVER.includes(`'${r}')) return;`), r);
});

test('vagten registreres før den første rute', () => {
  const vagt = SERVER.indexOf('app.use((req, res, next) => prodWriteGate(');
  const foerste = SERVER.search(/app\.(get|post|put|delete)\('/);
  assert.ok(vagt > 0 && vagt < foerste);
});
