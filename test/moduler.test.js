// Falck US: to moduler fejlede med "Error details: no matches". Archy ledte
// efter et screen pop-script og en secure data action, som modulmigreringen
// aldrig tog med — scriptet fordi moduler kun fik tabeller og data actions, og
// actionen fordi "secureDataAction:" slet ikke blev genkendt.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const YAML = [
  'commonModule:',
  '  name: M',
  '  tasks:',
  '    - task:',
  '        actions:',
  '          - callSecureAction:',
  '              category:',
  '                EA P&S API Integration:',
  '                  secureDataAction:',
  '                    EA Ws-payment retrieveinfobloom Modified 20241119:',
  '                      inputs:',
  '          - callData:',
  '              category:',
  '                Web Services:',
  '                  dataAction:',
  '                    Get Customer:',
  '                      inputs:',
  '          - screenPop:',
  '              screenPopScript:',
  '                CardEligibility_Falck:',
  '                  inputs:',
  ''
].join('\n');

test('secure data actions findes som afhængigheder', () => {
  assert.deepEqual(s.scanYamlDependencies(YAML).dataaction,
    ['EA Ws-payment retrieveinfobloom Modified 20241119', 'Get Customer']);
});

test('secure data actions kan peges over på et andet navn i målet', () => {
  assert.deepEqual(s.scanDataActionRefs(YAML).map(r => r.name),
    ['EA Ws-payment retrieveinfobloom Modified 20241119', 'Get Customer']);
});

test('secure-flaget følger med, når en data action migreres', () => {
  const route = SERVER.slice(SERVER.indexOf("app.post('/api/actions/migrate'"), SERVER.indexOf("app.post('/api/datatables/migrate'"));
  assert.match(route, /secure:\s+!!published\.secure/);
});

test('moduler tager prompts og scripts med', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function migrateFlowDependency('), SERVER.indexOf("app.post('/api/divisions/create'"));
  assert.match(fn, /for \(const kind of \['datatable', 'dataaction', \.\.\.COPYABLE_KINDS\]\)/);
  assert.match(fn, /const \[ep, felt, resKind\] = COPY_ENDPOINT\[kind\]/);
  assert.ok(SERVER.includes("prompt: ['/api/prompts/migrate', 'promptName']") && SERVER.includes("queue: ['/api/queues/migrate', 'name']"));
});

// Falck US: den migrerede action fik målintegrationens navn som kategori, men
// flowet pegede stadig på kildens kategori — importen fejlede med "no matches".
test('en action der ligger under én anden kategori peges over automatisk', () => {
  const yaml = YAML;
  const ta = [{ category: 'Genesys Cloud Survey Data Actions', name: 'EA Ws-payment retrieveinfobloom Modified 20241119' }];
  const e = s.autoDataActionEntries(yaml, ta, []);
  assert.equal(e.length, 1);
  assert.equal(e[0].to.category, 'Genesys Cloud Survey Data Actions');
  const r = s.applyDataActionMap(yaml, e, ta);
  assert.match(r.yaml, /Genesys Cloud Survey Data Actions:\s*\n\s+secureDataAction:/);
});

test('flere kandidater overlades til brugeren', () => {
  const n = 'EA Ws-payment retrieveinfobloom Modified 20241119';
  const ta = [{ category: 'A', name: n }, { category: 'B', name: n }];
  assert.deepEqual(s.autoDataActionEntries(YAML, ta, []), []);
});

// Falck US: "Set Utilization Label" pegede på en label målet ikke havde, men den
// blev ikke regnet som en afhængighed — så tjekket meldte "alt findes".
test('utilization labels findes som afhængigheder', () => {
  const y = [
    '- setUtilizationLabel:',
    '    name: Set Utilization Label',
    '    utilizationLabel:',
    '      lit:',
    '        name: Emergency Call',
    '- setUtilizationLabel:',
    '    utilizationLabel:',
    '      exp: Task.Label',
    ''
  ].join('\n');
  assert.deepEqual(s.scanYamlDependencies(y).utilizationlabel, ['Emergency Call']);
});
