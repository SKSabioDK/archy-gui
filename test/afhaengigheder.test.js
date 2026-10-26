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

test('Archys TRACE-støj ender ikke i fejlteksten, og tidsgrænsen er ikke 2 minutter', () => {
  const raa = ['TRACE:[architect.tracking] next tracking number', 'flowId: x, flowType: inqueuecall, opName: VALIDATE, opId: 1', 'rigtig fejl'].join('\n');
  assert.equal(s.parseArchyOutput(raa), 'rigtig fejl');
  assert.equal(s.archyTimeoutMs(), 10 * 60 * 1000);
  assert.ok(!/timeout: 120000/.test(SERVER.slice(SERVER.indexOf('function runArchy('))));
});

test('en timeout efter en gennemført publicering regnes ikke for en fejl', () => {
  const commit = SERVER.slice(SERVER.indexOf("app.post('/api/migrate/commit'"));
  assert.ok(commit.includes('importFinishedDespiteTimeout(target, nyName, rodType, cmd, startedAt'), 'commit skal tjekke målet efter en timeout');
  const dep = SERVER.slice(SERVER.indexOf('async function migrateFlowDependency('), SERVER.indexOf('// Opretter en manglende division'));
  assert.ok(dep.includes('importFinishedDespiteTimeout('), 'afhængigheder skal også tjekke målet efter en timeout');
  assert.ok(SERVER.includes('e.timedOut = true'));
});

test('køer og grupper kopieres som definition — uden medlemmer, id\'er og referencer', () => {
  const q = s.queueCreateBody({ id: 'x', name: 'Q', description: 'd', memberCount: 9, queueFlow: { id: 'f' },
    whisperPrompt: { id: 'p' }, mediaSettings: { call: { alertingTimeoutSeconds: 8 } }, division: { id: 'old' } }, 'newDiv');
  assert.deepEqual(q, { name: 'Q', description: 'd', mediaSettings: { call: { alertingTimeoutSeconds: 8 } }, division: { id: 'newDiv' } });
  assert.equal(s.queueCreateBody({ name: 'Q' }, null).division, undefined);
  assert.deepEqual(s.groupCreateBody({ id: 'g', name: 'G', type: 'official', visibility: 'public', rolesEnabled: true, memberCount: 3, owners: [{}] }),
    { name: 'G', type: 'official', visibility: 'public', rolesEnabled: true });
  assert.ok(s.COPYABLE_KINDS.has('queue') && s.COPYABLE_KINDS.has('group'));
});

// Falck: 36 prompts "fandtes" i målet, men uden lyd eller TTS. Flowet kunne ikke
// publiceres ("does not have audio or text to speech for at least one language"),
// mens tjekket sagde at alle afhængigheder fandtes.
test('en prompt uden lyd eller TTS tæller ikke som at den findes', () => {
  assert.equal(s.promptHasContent({ name: 'P1', resources: [] }), false);
  assert.equal(s.promptHasContent({ name: 'P1', resources: [{ language: 'en-gb' }] }), false);
  assert.equal(s.promptHasContent({ name: 'P1', resources: [{ language: 'en-gb', ttsString: 'Hello' }] }), true);
  assert.equal(s.promptHasContent({ name: 'P1', resources: [{ language: 'en-gb', mediaUri: 'https://x' }] }), true);
  assert.equal(s.promptHasContent({ name: 'P1' }), true, 'svarer listen ikke med ressourcer, ved vi det ikke');
  assert.equal(s.countsAsExisting('prompt', { resources: [] }), false);
  assert.equal(s.countsAsExisting('queue', { name: 'Q' }), true);
});

test('et migreret flow fjernes fra valget og tages ikke med af «Vælg alle»', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes("for (const key of [...selectedMigrateFlows])"), 'løkken skal gå over en kopi af valget');
  assert.ok(html.includes("migratedFlows.add(key + '>' + targetId);\n        selectedMigrateFlows.delete(key);".replace(/\n/g, html.includes('\r\n') ? '\r\n' : '\n')));
  assert.ok(html.includes('.filter(f => !migratedFlows.has(migratedKey(f)))'));
});

test('identiske flows springes over i prepare, men aldrig ved versionsudligning', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const fn = SERVER.slice(SERVER.indexOf('async function identicalInTarget('), SERVER.indexOf('// Vagterne før en flytning'));
  // Sammenlignes på det PUBLICEREDE i målet, med miljøpræfikser normaliseret væk
  assert.ok(fn.includes('publishedVersionOf(target, nyName') && fn.includes('flowContentHash(') && fn.includes('stripEnvPrefixesInYaml') === false);
  assert.ok(fn.includes('if (!found || !published) return null;'));
  assert.ok(html.includes("const skipIdentical = !alignVersion && !!document.getElementById('m-skip-identical')?.checked;"));
  assert.ok(SERVER.includes('if (req.body.skipIdentical && analysis.filePath)'));
});

test('serveren genstarter sig selv ved en opdatering — men først når ingen skrivning kører', () => {
  assert.equal(typeof s.watchForUpdates, 'function');
  const fn = SERVER.slice(SERVER.indexOf('function watchForUpdates('), SERVER.indexOf('function retryOnPortBusy('));
  assert.ok(fn.includes("['--check', files[0]]"), 'koden skal kunne parses før genstart');
  assert.ok(fn.includes('inflightWrites > 0'), 'en skrivning i gang skal afvente');
  assert.ok(fn.includes('ARCHY_NO_AUTORESTART'));
  // Tælleren skal sidde FØR første rute, ellers tæller den intet
  assert.ok(SERVER.indexOf('inflightWrites++') < SERVER.search(/app\.(get|post)\('/));
});

// Falck: P1435 fandt i målet med indhold — men ikke på noget af flowets sprog.
test('en prompt skal have indhold på ET AF FLOWETS sprog', () => {
  const y = ['inboundCall:', '  name: F', '  supportedLanguages:', '    da-dk:', '      defaultLanguageSkill:', '        noValue: true', '    en-gb:', '      x: 1', '  startUpRef: y', ''].join('\n');
  const l = s.scanSupportedLanguages(y);
  assert.deepEqual([...l].sort(), ['da-dk', 'en-gb']);
  assert.equal(s.promptHasContent({ resources: [{ language: 'nl-NL', ttsString: 'hej' }] }, l), false, 'kun nl-NL: ingen af flowets sprog');
  assert.equal(s.promptHasContent({ resources: [{ language: 'en-GB', ttsString: 'hello' }] }, l), true);
  assert.equal(s.promptHasContent({ resources: [{ language: 'nl-NL', ttsString: 'hej' }] }, new Set()), true, 'uden kendte sprog filtreres der ikke');
  assert.equal(s.countsAsExisting('prompt', { resources: [{ language: 'nl-NL', ttsString: 'hej' }] }, l), false);
});

test('en åbningstidsgruppe oprettes med målets egne åbningstids-id\'er', () => {
  const full = { id: 'g1', name: 'Åbent', timeZone: 'Europe/Copenhagen', description: 'd',
    openSchedules: [{ id: 'k1', name: 'Hverdage' }], closedSchedules: [{ id: 'k2', name: 'Nat' }],
    holidaySchedules: [{ id: 'k3', name: 'Helligdage' }, { id: 'k4', name: 'Mangler' }], division: { id: 'old' } };
  const body = s.scheduleGroupCreateBody(full, { Hverdage: 'm1', Nat: 'm2', Helligdage: 'm3' }, 'newDiv');
  assert.deepEqual(body, { name: 'Åbent', description: 'd', timeZone: 'Europe/Copenhagen',
    openSchedules: [{ id: 'm1' }], closedSchedules: [{ id: 'm2' }], holidaySchedules: [{ id: 'm3' }], division: { id: 'newDiv' } });
  assert.deepEqual(s.scheduleCreateBody({ id: 'x', name: 'A', start: '2025-01-01T08:00:00.000', end: '2025-01-01T16:00:00.000', rrule: 'FREQ=DAILY', division: { id: 'o' } }, null),
    { name: 'A', start: '2025-01-01T08:00:00.000', end: '2025-01-01T16:00:00.000', rrule: 'FREQ=DAILY' });
  assert.ok(s.COPYABLE_KINDS.has('schedule') && s.COPYABLE_KINDS.has('schedulegroup'));
});

test('en flowtype målets org ikke har produktet til, forklares', () => {
  const m = "the flow type 'inboundshortmessage' is not available. This happens when you are attempting to create a flow";
  const ud = s.archyHint(m);
  assert.ok(ud.startsWith(m) && ud.includes('INBOUNDSHORTMESSAGE') && ud.includes('produkt'));
  assert.equal(s.archyHint('noget andet'), 'noget andet');
});
