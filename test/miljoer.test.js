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
