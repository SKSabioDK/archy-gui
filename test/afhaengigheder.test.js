// Afhængigheder (bot flows, common modules) ved migrering mellem to miljøer i
// samme org, hver med sit præfiks.
//
// Fejlen: afhængigheden blev publiceret under KILDENS navn. Bor kilde og mål i
// samme org, er det kildens eget flow der fik en ny udgave — prods bot flow
// "JO_Schedule_callback" gik fra v1.0 til v2.0 ved en migrering til dev, og dev
// fik aldrig sin DEV_-udgave.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');
const { KUNDE } = require('./fixtures.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const BANK_BOT = [
  'inboundCall:',
  '  name: Bank bot',
  '  division: Home',
  '  startUpRef: "/inboundCall/tasks/task[Main_1]"',
  '  tasks:',
  '    - task:',
  '        name: Main',
  '        actions:',
  '          - callBotFlow:',
  '              name: Kald bot',
  '              botFlow:',
  '                JO_Schedule_callback:',
  '                  inputs: {}',
  ''
].join('\n');

test('en reference til et bot flow får målets præfiks, som tabeller og common modules', () => {
  const { yaml, changed } = s.prefixDependenciesInYaml(BANK_BOT, KUNDE.prod, KUNDE.dev);
  assert.ok(yaml.includes('DEV_JO_Schedule_callback:'), 'bot flow-referencen skal have DEV_');
  assert.deepEqual(changed, ['JO_Schedule_callback → DEV_JO_Schedule_callback']);
  // Flowets eget navn og de øvrige name-felter er urørt.
  assert.ok(yaml.includes('name: Bank bot'));
  assert.ok(yaml.includes('name: Kald bot'));
});

test('et bot flows EGEN type-linje tages ikke for en reference', () => {
  const botFlow = ['botFlow:', '  name: JO_Schedule_callback', '  division: Home', ''].join('\n');
  const { yaml, changed } = s.prefixDependenciesInYaml(botFlow, KUNDE.prod, KUNDE.dev);
  assert.equal(yaml, botFlow);
  assert.deepEqual(changed, []);
});

test('en afhængighed migreres aldrig under kildens eget navn i samme org', () => {
  const start = SERVER.indexOf('async function migrateFlowDependency(');
  const slut = SERVER.indexOf('\n}\n', start);
  const fn = SERVER.slice(start, slut);
  assert.ok(fn.length > 500, 'fandt ikke migrateFlowDependency');
  assert.ok(fn.includes('targetFlowName('), 'afhængigheden skal have målets navn');
  assert.ok(fn.includes('orgKeyOf(source) === orgKeyOf(target) && nyName === flowName'),
    'der skal være en vagt mod at publicere ovenpå kilden selv');
  assert.ok(fn.includes('prefixDependenciesInYaml('), 'det afhængigheden peger på skal omskrives');
  assert.ok(fn.includes('depNameIn('), 'opslaget efter underafhængigheder skal bruge målets navne');
  // Publiceringen går via den omskrevne fil, ikke den eksporterede.
  assert.ok(/publish --file \$\{archyArg\(importFile,/.test(fn), 'der skal publiceres fra den omskrevne fil');
  assert.ok(!/publish --file \$\{archyArg\(filePath,/.test(fn), 'den eksporterede fil må ikke publiceres direkte');
});
