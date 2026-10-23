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
  assert.match(fn, /url = kind === 'prompt' \? '\/api\/prompts\/migrate' : '\/api\/scripts\/migrate'/);
});
