// Navne og versionsnumre.
//
// Hver test herunder svarer til en fejl der er nået ud til brugeren. De er
// skrevet som spærringer, ikke som dokumentation: går en af dem i stykker, er
// det en fejl vi allerede har haft én gang.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');

test('promotionName sætter kildens udgave på navnet', () => {
  assert.equal(s.promotionName('testest', '10'), 'testest_v10');
  assert.equal(s.promotionName('testest', '10.0'), 'testest_v10');
});

test('promotionName ERSTATTER den gamle endelse i stedet for at lægge en til', () => {
  // Ellers hed flowet "testest_v10_v15" efter to forfremmelser.
  assert.equal(s.promotionName('testest_v10', '15'), 'testest_v15');
  assert.equal(s.promotionName('testest_V10', '15'), 'testest_v15');
});

test('promotionName lader navnet stå når kilden kun er publiceret én gang', () => {
  // Version 1 betyder at intet er sket i miljøet siden flowet ankom.
  assert.equal(s.promotionName('testest', '1'), 'testest');
  assert.equal(s.promotionName('testest', ''), 'testest');
  assert.equal(s.promotionName('testest', null), 'testest');
  assert.equal(s.promotionName('testest', 'saved_version_0d4c'), 'testest');
});

test('baseFlowName parrer to miljøer med hver sin versionsendelse', () => {
  // Tavlen parrer rækker på grundnavnet. Uden dette blev "testest_v10" i dev og
  // "testest_v15" i test til to rækker, og både kæden og afvigelsen forsvandt.
  assert.equal(s.baseFlowName('testest_v10'), s.baseFlowName('testest_v15'));
  assert.equal(s.baseFlowName('testest_v10'), 'testest');
});

test('baseFlowName rører kun endelsen, ikke et _v midt i navnet', () => {
  assert.equal(s.baseFlowName('flow_v2_andet'), 'flow_v2_andet');
  assert.equal(s.baseFlowName('WeekNumber'), 'WeekNumber');
});

test('orgManifestKey er den samme før og efter en omdøbning', () => {
  // Rækken i ArchyGUI_Manifest skal genfindes efter forfremmelsen. Nøgles der
  // på det fulde navn, bliver den forældreløs hver gang navnet skifter.
  assert.equal(
    s.orgManifestKey('WeekNumber_v10', 'inboundCall'),
    s.orgManifestKey('WeekNumber', 'INBOUNDCALL')
  );
});

test('orgManifestKey holder sig inden for Genesys\' 256 tegn i nøglefeltet', () => {
  assert.equal(s.orgManifestKey('x'.repeat(400), 'inboundCall').length, 256);
});

test('versionFromFileName læser Archys filnavn', () => {
  assert.equal(s.versionFromFileName('Mit Flow_v16-0.yaml'), 16);
  assert.equal(s.versionFromFileName('Uden version.yaml'), null);
});

test('parseFlowFileName deler filnavnet i flow, version og major', () => {
  assert.deepEqual(s.parseFlowFileName('Mit Flow_v16-3.yaml'),
    { flowName: 'Mit Flow', version: '16.3', major: 16 });
  assert.deepEqual(s.parseFlowFileName('Bare navn.yaml'),
    { flowName: 'Bare navn', version: null, major: null });
});

test('versionLabel viser ikke Genesys\' interne kladde-id som et versionsnummer', () => {
  assert.equal(s.versionLabel({ commitVersion: '7.0' }), '7.0');
  assert.equal(s.versionLabel({ name: '12' }), '12');
  assert.equal(s.versionLabel({ name: 'saved_version_0d4c8ad4-1111-2222' }), null);
  assert.equal(s.versionLabel(null), null);
});

test('compareVersions afgør nyere/ældre, ikke bare forskellig', () => {
  // Med !== meldte den "opdatering tilgængelig" også når man var FORAN remote.
  assert.ok(s.compareVersions('1.33.0', '1.9.0') > 0);
  assert.ok(s.compareVersions('1.9.0', '1.33.0') < 0);
  assert.equal(s.compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(s.compareVersions('1.2.3-beta', '1.2.3'), 0);
});

test('sanitizeName fjerner de tegn Windows ikke tillader i et filnavn', () => {
  assert.equal(s.sanitizeName('Kunde A/S: DEV'), 'Kunde A_S_ DEV');
  assert.equal(s.sanitizeName('   '), 'unknown');
});
