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

// Main_26_Dev pegede på et in-queue-flow via overrideInQueueFlow. Det blev hverken
// læst som afhængighed eller omskrevet, så Archy afviste importen med
// «flow name "InQueue_26_Dev" does not exist in the target org».
const ACD = [
  'inboundCall:',
  '  name: Main',
  '  tasks:',
  '    - task:',
  '        actions:',
  '          - transferToAcd:',
  '              overrideInQueueFlow:',
  '                name: InQueue_26',
  '              targetFlow:',
  '                lit:',
  '                  name: "Videre"',
  ''
].join('\n');

test('overrideInQueueFlow læses som en flow-afhængighed', () => {
  const d = s.scanYamlDependencies(ACD);
  assert.deepEqual(d.inqueueflow, ['InQueue_26']);
  assert.deepEqual(d.targetflow, ['Videre']);
});

test('overrideInQueueFlow og targetFlow får målets præfiks', () => {
  const { yaml, changed } = s.prefixDependenciesInYaml(ACD, KUNDE.prod, KUNDE.dev);
  assert.ok(yaml.includes('name: DEV_InQueue_26'));
  assert.ok(yaml.includes('name: "DEV_Videre"'));
  assert.deepEqual(changed, ['Videre → DEV_Videre', 'InQueue_26 → DEV_InQueue_26'].sort((a, b) => changed.indexOf(a) - changed.indexOf(b)));
  assert.ok(yaml.includes('name: Main'), 'flowets eget navn er urørt');
});

test('et prompt i et udtryk læses som afhængighed', () => {
  const yaml = ['audio:', '  exp: AudioPlaybackOptions(Prompt.P11356, true)', '  prompt: Prompt.P2', ''].join('\n');
  assert.deepEqual(s.scanYamlDependencies(yaml).prompt.sort(), ['P11356', 'P2']);
});

test('uden præfiks på begge miljøer omskrives intet — heller ikke InQueue_26_Dev', () => {
  const a = { name: 'A', prefix: '' }, b = { name: 'B', prefix: '' };
  const yaml = ACD.replace('InQueue_26', 'InQueue_26_Dev');
  const r = s.prefixDependenciesInYaml(yaml, a, b);
  assert.equal(r.yaml, yaml);
  assert.deepEqual(r.changed, []);
  assert.equal(s.depNameIn('inqueueflow', 'InQueue_26_Dev', b, a), 'InQueue_26_Dev');
  assert.equal(s.targetFlowName('Main_26_Dev', a, b), 'Main_26_Dev');
});
