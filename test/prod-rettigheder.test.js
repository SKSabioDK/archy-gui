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

test('en rettighed pr. division tæller med', () => {
  // Sådan står den i /users/me for en Master Admin i Sabio-org'en. Med krav om
  // præcis tre led blev den afvist.
  const held = 'architect:flow:publish:00000000-0000-0000-0000-000000000000,24b89025-2695-4e97-ba60-38e2cad34622';
  assert.equal(s.permissionGranted(held, 'architect:flow:publish'), true);
  assert.equal(s.permissionGranted('architect:flow:view:00000000-0000-0000-0000-000000000000', 'architect:flow:publish'), false);
  assert.equal(s.permissionGranted('admin', 'architect:flow:publish'), false);
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
  '/api/customers/:id/prefix-check', '/api/stages',
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

// ── Vagtens egne indstillinger ───────────────────────────────────────────────

test('trin og krav på et prod-miljø kan ikke ændres uden prod-login', () => {
  // Ellers: sæt trinnet til "uat", skriv, sæt det tilbage.
  for (const changed of [{ stage: 'uat' }, { deployGroup: '' }, { deployPermission: 'architect:flow:view' }, { authType: 'credentials' }])
    assert.equal(s.prodSettingsBlock(PROD, changed, null, NU).code, 'prod-login', JSON.stringify(changed));
  assert.equal(s.prodSettingsBlock(PROD, { stage: 'uat' }, login(ja), NU), null);
});

test('navn og præfiks på prod kan ændres uden login', () => {
  assert.equal(s.prodSettingsBlock(PROD, { name: 'Nyt navn', prefix: '', orgLabel: 'x' }, null, NU), null);
});

test('prod med client credentials kan kun strammes til OAuth', () => {
  const creds = { ...PROD, authType: 'credentials' };
  assert.equal(s.prodSettingsBlock(creds, { authType: 'oauth', clientId: 'x' }, null, NU), null);
  assert.equal(s.prodSettingsBlock(creds, { stage: 'uat' }, null, NU).code, 'prod-oauth-required');
  assert.equal(s.prodSettingsBlock(creds, { authType: 'oauth', stage: 'uat' }, null, NU).code, 'prod-oauth-required');
});

test('at gøre et miljø TIL prod kræver intet login', () => {
  assert.equal(s.prodSettingsBlock({ ...PROD, stage: 'uat' }, { stage: 'prod' }, null, NU), null);
  assert.equal(s.prodSettingsBlock({ ...PROD, demo: true }, { stage: 'uat' }, null, NU), null);
});

// ── Forbindelsestesten: hvilke funktioner vil fejle ─────────────────────────

test('forbindelsestesten navngiver hver funktion der mangler rettigheder', () => {
  // Før tjekkede testen kun to rettigheder og meldte "i orden" selvom fx
  // Data Actions eller datatabeller ville fejle.
  const held = ['architect:flow:view', 'architect:ui:view', 'architect:flow:add', 'architect:flow:edit', 'oauth:client:view'];
  const r = s.evaluatePermissions(held, 'credentials');
  const af = a => r.find(c => c.area === a);
  assert.equal(af('flows_read').ok, true);
  assert.equal(af('flows_publish').ok, false);
  assert.deepEqual(af('flows_publish').missing, ['architect:flow:publish']);
  assert.equal(af('dataactions').ok, false);
  assert.ok(af('dataactions').missing.includes('integrations:action:view'));
  // Alle områder er med, så intet falder stille ud af testen.
  assert.equal(r.length, s.PERMISSION_CHECKS.length);
});

test('eksport kræver architect:ui:view — ellers fejler Archy trods adgang til API\'et', () => {
  // Vattenfall DE Test: testen meldte ✓ for eksport, men Archy fejlede med
  // "missing the 'architect:ui:view' permission".
  const r = s.evaluatePermissions(['architect:flow:view', 'oauth:client:view', 'routing:queue:view'], 'credentials');
  const read = r.find(c => c.area === 'flows_read');
  assert.equal(read.ok, false);
  assert.deepEqual(read.missing, ['architect:ui:view']);
  assert.ok(r.find(c => c.area === 'flows_write').missing.includes('architect:ui:view'));
});

test('wildcards og divisionsrettigheder tæller med', () => {
  const r = s.evaluatePermissions(['architect:*:*', 'integrations:*:*:div-1', '*:*:*'], 'credentials');
  assert.ok(r.every(c => c.ok));
});

test('Archys klientopslag kræves kun ved client credentials', () => {
  assert.ok(s.evaluatePermissions([], 'credentials').some(c => c.area === 'archy_client'));
  assert.ok(!s.evaluatePermissions([], 'oauth').some(c => c.area === 'archy_client'));
});

test('en rolles politikker bliver til rettighedsstrenge', () => {
  const role = { permissionPolicies: [
    { domain: 'architect', entityName: 'flow', actionSet: ['view', 'publish'] },
    { domain: 'routing', entityName: 'queue', actionSet: ['*'] } ] };
  assert.deepEqual(s.rolePermissions(role),
    ['architect:flow:view', 'architect:flow:publish', 'routing:queue:*']);
  assert.deepEqual(s.rolePermissions(null), []);
});
