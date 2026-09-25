// Miljøer, præfikser, grupper og vagten foran en migrering.
//
// Det er reglerne for hvad der må skrives hvorhen. De kan ikke prøves af mod en
// rigtig org uden at skrive i den — derfor står de her.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');
const { KUNDE, ANDEN, LOES } = require('./fixtures.js');

// ── Virtuelle miljøer i samme org ────────────────────────────────────────────

test('et præfikset miljø tager kun sine egne flows', () => {
  assert.equal(s.belongsToEnv('DEV_Main flow', KUNDE.dev, KUNDE.alle), true);
  assert.equal(s.belongsToEnv('TEST_Main flow', KUNDE.dev, KUNDE.alle), false);
  assert.equal(s.belongsToEnv('Main flow', KUNDE.dev, KUNDE.alle), false);
});

test('prod tager alt der IKKE bærer et søskendepræfiks', () => {
  // Uden søskendetjekket ville prod se hele org'en — dev og test inklusive —
  // og pipelinen ville melde at prod indeholder flows den aldrig har fået.
  assert.equal(s.belongsToEnv('Main flow', KUNDE.prod, KUNDE.alle), true);
  assert.equal(s.belongsToEnv('DEV_Main flow', KUNDE.prod, KUNDE.alle), false);
  assert.equal(s.belongsToEnv('UAT_Main flow', KUNDE.prod, KUNDE.alle), false);
});

test('præfikset tages af og på når flowet skifter miljø', () => {
  assert.equal(s.targetFlowName('DEV_Main flow', KUNDE.dev, KUNDE.test), 'TEST_Main flow');
  assert.equal(s.targetFlowName('DEV_Main flow', KUNDE.dev, KUNDE.prod), 'Main flow');
  assert.equal(s.targetFlowName('Main flow', KUNDE.prod, KUNDE.uat), 'UAT_Main flow');
});

test('stripEnvPrefix rører ikke et navn der bærer et ANDET præfiks', () => {
  assert.equal(s.stripEnvPrefix('TEST_Main flow', KUNDE.dev), 'TEST_Main flow');
});

test('afhængigheder præfikses kun hvor det er konventionen', () => {
  // Datatabeller og flows duplikeres pr. virtuelt miljø. Køer, skills og
  // scripts er fælles for hele org'en — præfikser vi dem, leder vi efter noget
  // der aldrig har eksisteret.
  assert.equal(s.depNameIn('datatable', 'DEV_By Week Routing', KUNDE.prod, KUNDE.dev), 'By Week Routing');
  assert.equal(s.depNameIn('commonmodule', 'DEV_Faelles', KUNDE.uat, KUNDE.dev), 'UAT_Faelles');
  assert.equal(s.depNameIn('queue', 'Support DK', KUNDE.uat, KUNDE.dev), 'Support DK');
  assert.equal(s.depNameIn('skill', 'Dansk', KUNDE.uat, KUNDE.dev), 'Dansk');
});

test('samme credentials og samme region betyder samme fysiske org', () => {
  assert.equal(s.orgKeyOf(KUNDE.dev), s.orgKeyOf(KUNDE.prod));
  assert.notEqual(s.orgKeyOf(KUNDE.dev), s.orgKeyOf({ clientId: 'anden', region: 'mypurecloud.de' }));
});

test('et demo-miljø får sin egen org-nøgle og deler ikke med en rigtig org', () => {
  assert.equal(s.orgKeyOf({ demo: true, id: 'demo-dev' }), 'demo:demo-dev');
});

// ── Divisioner ───────────────────────────────────────────────────────────────

test('uden division på miljøet bruges Home', () => {
  assert.equal(s.divisionOf(KUNDE.prod), 'Home');
  assert.equal(s.divisionOf({ division: '   ' }), 'Home');
  assert.equal(s.divisionOf(null), 'Home');
});

test('division læses med mellemrum trimmet fra', () => {
  assert.equal(s.divisionOf({ division: ' UAT ' }), 'UAT');
});

// ── Grupper ──────────────────────────────────────────────────────────────────

test('to miljøer hører kun sammen når BÅDE kunde og gruppe er ens', () => {
  assert.equal(s.sameGroup(KUNDE.dev, KUNDE.prod), true);
  assert.equal(s.sameGroup(KUNDE.dev, ANDEN), false);
  assert.equal(s.sameGroup(KUNDE.dev, { tenant: 'Kunde A/S', group: 'SE' }), false);
});

test('miljøer uden opsætning hører ikke sammen — heller ikke med hinanden', () => {
  // Ellers ville en manglende opsætning kunne læses som "de hører sammen", og
  // så var gruppespærringen værdiløs netop hvor den skulle virke.
  assert.equal(s.sameGroup(LOES, LOES), false);
  assert.equal(s.sameGroup(LOES, { id: 'anden-loes' }), false);
  assert.equal(s.sameGroup(LOES, KUNDE.dev), false);
});

test('trinnene har en fast rækkefølge, og ukendte trin lægger sig bagest', () => {
  assert.ok(s.stageOrder('dev') < s.stageOrder('test'));
  assert.ok(s.stageOrder('test') < s.stageOrder('uat'));
  assert.ok(s.stageOrder('uat') < s.stageOrder('prod'));
  assert.ok(s.stageOrder('prod') < s.stageOrder(undefined));
  assert.equal(s.stageOrder('DEV'), s.stageOrder('dev'));
});

test('stageOf accepterer kun de fire kendte trin', () => {
  assert.equal(s.stageOf({ stage: 'UAT' }), 'uat');
  assert.equal(s.stageOf({ stage: 'preprod' }), null);
  assert.equal(s.stageOf({}), null);
});

test('buildHierarchy sorterer miljøerne i trin-rækkefølge, ikke alfabetisk', () => {
  const ud = s.buildHierarchy([KUNDE.prod, KUNDE.dev, KUNDE.uat, KUNDE.test]);
  assert.equal(ud.length, 1);
  assert.equal(ud[0].tenant, 'Kunde A/S');
  assert.equal(ud[0].singleGroup, true);
  assert.deepEqual(ud[0].groups[0].environments.map(e => e.stage), ['dev', 'test', 'uat', 'prod']);
});

test('buildHierarchy lægger miljøer uden opsætning i en navnløs bunke til sidst', () => {
  const ud = s.buildHierarchy([LOES, KUNDE.dev]);
  assert.equal(ud[0].named, true);
  assert.equal(ud[ud.length - 1].named, false);
});

// ── Vagten foran en migrering ────────────────────────────────────────────────

test('vagten slipper en almindelig forfremmelse igennem', () => {
  assert.equal(s.migrationGuard(KUNDE.dev, KUNDE.test), null);
});

test('vagten spærrer for at skrive et miljø til sig selv', () => {
  assert.equal(s.migrationGuard(KUNDE.dev, KUNDE.dev).code, 'same-env');
});

test('vagten spærrer på tværs af kunder', () => {
  assert.equal(s.migrationGuard(KUNDE.dev, ANDEN).code, 'cross-group');
});

test('spærringen på tværs kan brydes bevidst, men ikke ved et uheld', () => {
  assert.equal(s.migrationGuard(KUNDE.dev, ANDEN, { allowCrossGroup: true }), null);
});

test('to miljøer helt uden opsætning migrerer som før', () => {
  // Er ingen af dem i en gruppe, er der ingen pipeline at håndhæve. Ellers
  // ville alt stå stille indtil grupperne var sat op.
  assert.equal(s.migrationGuard(LOES, { id: 'andet' }), null);
});

test('prod kræver en udtrykkelig bekræftelse', () => {
  assert.equal(s.migrationGuard(KUNDE.uat, KUNDE.prod).code, 'prod-confirm');
  assert.equal(s.migrationGuard(KUNDE.uat, KUNDE.prod, { confirmProd: true }), null);
});

test('vagten afviser et ukendt miljø frem for at fortsætte', () => {
  assert.equal(s.migrationGuard(null, KUNDE.prod).code, 'unknown-env');
  assert.equal(s.migrationGuard(KUNDE.dev, undefined).code, 'unknown-env');
});

// Et præfiks der ændres, omdøber ikke flowene i org'en. Før man gemmer, skal
// man vide hvor mange der ville stå tilbage med den gamle navngivning — ellers
// dukker "UAT_Betaling" op som sin egen række i et miljø uden præfiks.
test('prefixChangeImpact finder flows med den gamle navngivning', () => {
  const env = (id, stage, prefix) => ({ id, name: id, stage, prefix, tenant: 'K', group: 'G', clientId: 'x', region: 'r' });
  const dev = env('dev', 'dev', 'DEV_'), uat = env('uat', 'uat', 'UAT_');
  const flows = [{ name: 'DEV_Betaling' }, { name: 'UAT_Betaling' }, { name: 'UAT_Hilsen' }, { name: 'Betaling' }];
  // UAT_ → intet: de to UAT_-flows skifter grundnavn.
  const a = s.prefixChangeImpact(uat, '', flows, [dev, uat]);
  assert.deepEqual(a.map(f => f.name).sort(), ['UAT_Betaling', 'UAT_Hilsen']);
  // Uændret præfiks: intet ramt.
  assert.deepEqual(s.prefixChangeImpact(uat, 'UAT_', flows, [dev, uat]), []);
  // intet → UAT_: "Betaling" hører ikke længere til miljøet.
  const u0 = env('uat', 'uat', '');
  const b = s.prefixChangeImpact(u0, 'UAT_', flows, [dev, u0]);
  assert.ok(b.some(f => f.name === 'Betaling' && f.lost));
});

// ── Omdøbning af et miljø ────────────────────────────────────────────────────

test('omdøbes et miljø, flytter dets eksportmappe med', () => {
  const fs = require('fs'), path = require('path');
  const tag = 'zz-omdoeb-' + process.pid;
  const fra = path.join(s.FLOWS_DIR, tag + '-gammel'), til = path.join(s.FLOWS_DIR, tag + '-ny');
  try {
    fs.mkdirSync(fra, { recursive: true });
    fs.writeFileSync(path.join(fra, 'Flow_v1-0.yaml'), 'x');
    s.moveCustomerFolder(tag + '-gammel', tag + '-ny');
    assert.equal(fs.existsSync(fra), false);
    assert.equal(fs.readFileSync(path.join(til, 'Flow_v1-0.yaml'), 'utf8'), 'x');
  } finally {
    fs.rmSync(fra, { recursive: true, force: true });
    fs.rmSync(til, { recursive: true, force: true });
  }
});

test('findes den nye mappe allerede, flettes der ikke', () => {
  // To miljøers eksporter blandet sammen kan ikke skilles ad igen.
  const fs = require('fs'), path = require('path');
  const tag = 'zz-omdoeb2-' + process.pid;
  const fra = path.join(s.FLOWS_DIR, tag + '-a'), til = path.join(s.FLOWS_DIR, tag + '-b');
  try {
    fs.mkdirSync(fra, { recursive: true }); fs.writeFileSync(path.join(fra, 'a.yaml'), 'a');
    fs.mkdirSync(til, { recursive: true }); fs.writeFileSync(path.join(til, 'b.yaml'), 'b');
    s.moveCustomerFolder(tag + '-a', tag + '-b');
    assert.equal(fs.existsSync(path.join(fra, 'a.yaml')), true);
    assert.equal(fs.existsSync(path.join(til, 'a.yaml')), false);
  } finally {
    fs.rmSync(fra, { recursive: true, force: true });
    fs.rmSync(til, { recursive: true, force: true });
  }
});

// ── Hvilken org et miljø ligger i ────────────────────────────────────────────

test('to miljøer med hver sin klient i samme org ses som samme org', () => {
  // Dev med client credentials og prod med PKCE har hver sin OAuth-klient.
  // Med Client ID som nøgle troede værktøjet de lå i hver sin org, og prod
  // så dev's flows.
  const dev  = { id: 'd', clientId: 'a', region: 'mypurecloud.de', prefix: 'DEV_', orgId: 'org1' };
  const prod = { id: 'p', clientId: 'b', region: 'mypurecloud.de', prefix: '',     orgId: 'org1' };
  assert.equal(s.orgKeyOf(dev), s.orgKeyOf(prod));
  assert.equal(s.belongsToEnv('DEV_Hilsen', prod, [dev, prod]), false);
  assert.equal(s.belongsToEnv('Hilsen', prod, [dev, prod]), true);
});

test('uden org-id falder nøglen tilbage på klient og region', () => {
  assert.equal(s.orgKeyOf({ clientId: 'a', region: 'r' }), s.orgKeyOf({ clientId: 'a', region: 'r' }));
  assert.notEqual(s.orgKeyOf({ clientId: 'a', region: 'r' }), s.orgKeyOf({ clientId: 'b', region: 'r' }));
});

// ── Common modules nyere end flowene der bruger dem ──────────────────────────

test('et flow publiceret før modulet kører på den gamle udgave', () => {
  const pub = d => ({ publishedVersion: { datePublished: d } });
  assert.equal(s.isBehindModule(pub('2026-09-01T10:00:00Z'), pub('2026-09-02T10:00:00Z')), true);
  assert.equal(s.isBehindModule(pub('2026-09-03T10:00:00Z'), pub('2026-09-02T10:00:00Z')), false);
  // Uden datoer ved vi det ikke — og så påstår vi intet.
  assert.equal(s.isBehindModule({}, pub('2026-09-02T10:00:00Z')), false);
});
