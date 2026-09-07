// Omskrivning, sammenligning og aflæsning af flow-YAML.
//
// Det er her de dyreste fejl har siddet: en forkert omskrivning sender et flow
// af sted under det forkerte navn eller med referencer til det forkerte miljøs
// data, og en forkert sammenligning får en fejlfri kopi til at fremstå som
// afvigende — netop dér hvor man har mest brug for at kunne stole på svaret.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');
const { DEV_FLOW, PROD_FLOW, KUNDE } = require('./fixtures.js');

const linje = (yaml, tekst) => yaml.split('\n').find(l => l.includes(tekst));

// ── Omdøbning ────────────────────────────────────────────────────────────────

test('renameFlowInYaml skriver kun flowets EGET navn om', () => {
  // De dybere name-felter hører til tasks og states. Rørte vi dem, ville
  // startUpRef og referencerne pege på noget der ikke længere findes.
  const ud = s.renameFlowInYaml(DEV_FLOW, 'UAT_WeekNumber');
  assert.equal(linje(ud, 'name:').trim(), 'name: UAT_WeekNumber');
  assert.ok(ud.includes('name: RouteCallByWeekNumber'));
  assert.ok(ud.includes('name: Support DK'));
});

test('renameFlowInYaml beholder anførselstegn hvis navnet stod i dem', () => {
  const y = 'inboundCall:\n  name: "Gammelt navn"\n  division: Home\n';
  assert.ok(s.renameFlowInYaml(y, 'Nyt navn').includes('name: "Nyt navn"'));
});

test('renameFlowInYaml beholder filens linjeskift', () => {
  // Archy læser filen igen bagefter. Blandes CRLF og LF, brækker importen.
  const crlf = DEV_FLOW.replace(/\n/g, '\r\n');
  assert.ok(s.renameFlowInYaml(crlf, 'X').includes('\r\n'));
  assert.ok(!s.renameFlowInYaml(DEV_FLOW, 'X').includes('\r\n'));
});

// ── Division ─────────────────────────────────────────────────────────────────

test('setFlowDivisionInYaml skifter flowets division og kun den', () => {
  const ud = s.setFlowDivisionInYaml(DEV_FLOW, 'UAT');
  assert.equal(linje(ud, 'division:').trim(), 'division: UAT');
  assert.equal((ud.match(/division:/g) || []).length, 1);
});

test('setFlowDivisionInYaml rører ikke et udtryk længere nede i flowet', () => {
  // Task.division er en variabel, ikke flowets division.
  const y = 'inboundCall:\n  name: X\n  division: DEV\n  actions:\n' +
            '    - x:\n        exp: Task.division\n';
  const ud = s.setFlowDivisionInYaml(y, 'UAT');
  assert.ok(ud.includes('division: UAT'));
  assert.ok(ud.includes('exp: Task.division'));
});

// ── Referencer til det præfiksede miljøs egne ressourcer ─────────────────────

test('afhængighederne skrives om til målmiljøets præfiks', () => {
  // Uden dette ville DEV-flowet pege tilbage på prods tabel, og dev og prod
  // ville dele data — lige præcis det man ville undgå.
  const { yaml, changed } = s.prefixDependenciesInYaml(DEV_FLOW, KUNDE.dev, KUNDE.uat);
  assert.ok(yaml.includes('UAT_By Week Routing:'));
  assert.ok(yaml.includes('UAT_Faelles logning:'));
  assert.ok(!yaml.includes('DEV_By Week Routing:'));
  assert.deepEqual(changed, [
    'DEV_By Week Routing → UAT_By Week Routing',
    'DEV_Faelles logning → UAT_Faelles logning'
  ]);
});

test('på vej til prod tages præfikset helt af referencerne', () => {
  const { yaml } = s.prefixDependenciesInYaml(DEV_FLOW, KUNDE.dev, KUNDE.prod);
  assert.ok(yaml.includes('By Week Routing:'));
  assert.ok(!yaml.includes('DEV_By Week Routing:'));
});

test('to miljøer med samme præfiks får YAML\'en urørt', () => {
  const { yaml, changed } = s.prefixDependenciesInYaml(DEV_FLOW, KUNDE.dev, { prefix: 'DEV_' });
  assert.equal(yaml, DEV_FLOW);
  assert.deepEqual(changed, []);
});

// ── Sammenligning på tværs af miljøer ────────────────────────────────────────

test('en fejlfri forfremmelse melder IKKE at indholdet afviger', () => {
  // De to udgaver SKAL være forskellige på navn, division og referencer — det
  // er hele pointen med et præfikset miljø. Tælles de med, er indholdstjekket
  // ubrugeligt.
  assert.equal(
    s.flowContentHash(DEV_FLOW, KUNDE.dev),
    s.flowContentHash(PROD_FLOW, KUNDE.prod)
  );
});

test('en ægte indholdsforskel bliver stadig fanget', () => {
  const ændret = DEV_FLOW.replace('name: Support DK', 'name: Support SE');
  assert.notEqual(
    s.flowContentHash(ændret, KUNDE.dev),
    s.flowContentHash(PROD_FLOW, KUNDE.prod)
  );
});

test('en tom beskrivelse tæller ikke som en forskel', () => {
  // Archy skriver description: "" på et nyoprettet flow, men udelader den på et
  // der aldrig har haft en. Kopien fik dermed én linje mere end kilden.
  const uden = PROD_FLOW.replace('  description: ""\n', '');
  assert.equal(s.flowContentHash(uden, KUNDE.prod), s.flowContentHash(PROD_FLOW, KUNDE.prod));
});

test('en beskrivelse MED indhold tæller stadig med', () => {
  const med = PROD_FLOW.replace('description: ""', 'description: "Ny tekst"');
  assert.notEqual(s.flowContentHash(med, KUNDE.prod), s.flowContentHash(PROD_FLOW, KUNDE.prod));
});

test('Archys interne løbenumre tæller ikke som en forskel', () => {
  const a = 'x:\n  refId: Initial State_10\n  trackingId: 42\n  ref: "[Initial State_10]"\n';
  const b = 'x:\n  refId: Initial State_77\n  trackingId: 91\n  ref: "[Initial State_77]"\n';
  assert.equal(s.normalizeFlowYaml(a), s.normalizeFlowYaml(b));
});

test('normalizeFlowYaml ser bort fra mellemrum i slutningen af en linje', () => {
  assert.equal(s.normalizeFlowYaml('a: 1   \nb: 2'), s.normalizeFlowYaml('a: 1\nb: 2'));
});

// ── Sidste kontrol før indholdet vises eller migreres ────────────────────────

test('assertYamlIsFlow fanger at eksporten gav det forkerte flow', () => {
  // Det var netop denne fejl: valgt "Notify Flow Error", fik "WeekNumber".
  assert.throws(
    () => s.assertYamlIsFlow(DEV_FLOW, 'Notify Flow Error', 'DEV_WeekNumber_v2-0.yaml'),
    /forkerte flow/
  );
});

test('assertYamlIsFlow lader det rigtige flow passere', () => {
  assert.doesNotThrow(() => s.assertYamlIsFlow(DEV_FLOW, 'DEV_WeekNumber', 'f.yaml'));
  assert.doesNotThrow(() => s.assertYamlIsFlow(DEV_FLOW, '  dev_weeknumber ', 'f.yaml'));
});

test('assertYamlIsFlow afviser ikke en eksport hvor navnet ikke kan læses', () => {
  // Hellere mangle kontrollen end afvise en gyldig eksport.
  assert.doesNotThrow(() => s.assertYamlIsFlow('ingen navnelinje her', 'Hvad som helst', 'f.yaml'));
});

// ── Afhængigheder ────────────────────────────────────────────────────────────

test('scanYamlDependencies finder de ressourcer flowet faktisk peger på', () => {
  const d = s.scanYamlDependencies(DEV_FLOW);
  assert.deepEqual(d.datatable, ['DEV_By Week Routing']);
  assert.deepEqual(d.commonmodule, ['DEV_Faelles logning']);
  assert.deepEqual(d.queue, ['Support DK']);
  assert.deepEqual(d.division, ['DEV']);
});

test('scanYamlDependencies læser danske ressourcenavne', () => {
  // \w er kun ASCII, så "Åbningstider" blev læst som ingenting, og flowet
  // fremstod uden afhængigheder — også når migreringen skulle tage dem med.
  const y = 'inboundCall:\n  name: X\n  tasks:\n    - t:\n        dataTable:\n' +
            '          Åbningstider:\n            foundOutputs:\n              a: 1\n' +
            '    - u:\n        commonModule:\n          Fælles logning:\n' +
            '            inputs:\n              b: 2\n';
  const d = s.scanYamlDependencies(y);
  assert.deepEqual(d.datatable, ['Åbningstider']);
  assert.deepEqual(d.commonmodule, ['Fælles logning']);
});

test('strukturelle nøgler tæller ikke som ressourcenavne', () => {
  assert.equal(s.notMeta('foundOutputs'), true);   // filtreres separat for datatable
  assert.equal(s.notMeta('name'), false);
  assert.equal(s.notMeta('division'), false);
  assert.equal(s.notMeta('Mit modul'), true);
});

test('dataTable-opslagets egne udgangsfelter regnes ikke som tabeller', () => {
  assert.ok(!s.scanYamlDependencies(DEV_FLOW).datatable.includes('foundOutputs'));
  assert.ok(!s.scanYamlDependencies(DEV_FLOW).datatable.includes('failureOutputs'));
});

// ── Kopiering af definitioner mellem orgs ────────────────────────────────────

test('stripFormIds fjerner kildens id\'er i hele træet', () => {
  const ind = { id: '1', name: 'Form', pages: [{ id: '2', selfUri: '/u', q: [{ contextId: '3', t: 'x' }] }] };
  assert.deepEqual(s.stripFormIds(ind), { name: 'Form', pages: [{ q: [{ t: 'x' }] }] });
});

test('stripSchemaUris fjerner pegepinde til kildens action, men beholder skemaerne', () => {
  assert.deepEqual(
    s.stripSchemaUris({ requestTemplate: 'a', requestTemplateUri: '/x', successTemplateUri: '/y', andet: 1 }),
    { requestTemplate: 'a', andet: 1 }
  );
});
