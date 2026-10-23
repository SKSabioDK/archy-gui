// Et flow taler pr. sprog med en TTS-motor. Har målet ikke motoren (fx ingen
// Azure-integration), afviste Archy hele importen: "the text to speech engine
// 'Microsoft Azure' is not a valid text to speech engine". Nu opdages det før,
// og motoren kan skiftes til en målet har — med en stemme på samme sprog.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const YAML = [
  'inboundCall:',
  '  name: X',
  '  division: Home',
  '  supportedLanguages:',
  '    da-dk:',
  '      defaultLanguageSkill:',
  '        noValue: true',
  '      textToSpeech:',
  '        Microsoft Azure:',
  '          voice: da-DK-ChristelNeural',
  '    de-de:',
  '      textToSpeech:',
  '        defaultEngine:',
  '          voice: Arabella',
  '    ca-es:',
  '      textToSpeech:',
  '        Microsoft Azure:',
  '          voice: ca-ES-AlbaNeural',
  '    en-us:',
  '      textToSpeech:',
  '        Microsoft Azure:',
  ''
].join('\n');
const MAAL = [
  { name: 'Other TTS', voices: [{ name: 'Andrea', language: 'da-DK' }] },
  { name: 'Genesys TTS', voices: [{ name: 'Mette', language: 'da-DK' }, { name: 'Joanna', language: 'en-US' }] }
];

test('motor og stemme læses pr. sprog', () => {
  assert.deepEqual(s.scanTtsEngines(YAML).map(e => [e.lang, e.engine, e.voice]), [
    ['da-dk', 'Microsoft Azure', 'da-DK-ChristelNeural'],
    ['de-de', 'defaultEngine', 'Arabella'],
    ['ca-es', 'Microsoft Azure', 'ca-ES-AlbaNeural'],
    ['en-us', 'Microsoft Azure', null]
  ]);
});

test('kun motorer målet ikke har, mangler — standardmotoren findes altid', () => {
  assert.deepEqual(s.missingTtsEngines(s.scanTtsEngines(YAML), MAAL), ['Microsoft Azure']);
  assert.deepEqual(s.missingTtsEngines(s.scanTtsEngines(YAML), [{ name: 'microsoft azure' }]), []);
});

test('erstatningen tager Genesys\' motor og en stemme på samme sprog', () => {
  const r = s.replaceTtsEngines(YAML, MAAL);
  const efter = s.scanTtsEngines(r.yaml).map(e => [e.lang, e.engine, e.voice]);
  assert.deepEqual(efter, [
    ['da-dk', 'Genesys TTS', 'Mette'],
    ['de-de', 'defaultEngine', 'Arabella'],          // urørt
    ['ca-es', 'Microsoft Azure', 'ca-ES-AlbaNeural'], // ingen catalansk stemme i målet
    ['en-us', 'Genesys TTS', 'Joanna']                // stemmelinjen sat ind
  ]);
  assert.deepEqual(r.unresolved, [{ lang: 'ca-es', engine: 'Microsoft Azure' }]);
  assert.equal(r.changed.length, 2);
});

test('intet at erstatte giver samme YAML', () => {
  const r = s.replaceTtsEngines(YAML, [{ name: 'Microsoft Azure', voices: [] }]);
  assert.equal(r.yaml, YAML);
});

test('valget når både flowet og modulerne der migreres med', () => {
  assert.match(SERVER, /await migrateFlowDependency\(source, target, hit\.name, hit\.type, visited, depth \+ 1, trail, opts\)/);
  assert.match(SERVER, /migrateFlowDependency\(source, target, flowName, flowType, new Set\(\), 0, trail, \{ ttsReplace: !!ttsReplace \}\)/);
  assert.match(HTML, /migrateOneDep\(d, sourceId, targetId, logBox, \{ ttsReplace \}\)/);
  assert.match(HTML, /alignVersion, actionMap, rememberMap, ttsReplace \}\)/);
});

// ── Tomme skaller fra en fejlet import ───────────────────────────────────────
// Archy opretter flowet før indholdet. Fejlede importen (fx på TTS-motoren),
// lå der en tom, aldrig publiceret skal — og den blev regnet for "findes", så
// modulet aldrig blev migreret.

test('et flow der aldrig er publiceret, findes ikke som reference', () => {
  assert.equal(s.countsAsExisting('commonmodule', { name: 'M', publishedVersion: null }), false);
  assert.equal(s.countsAsExisting('targetflow', { name: 'T' }), false);
  assert.equal(s.countsAsExisting('commonmodule', { name: 'M', publishedVersion: { id: '1' } }), true);
});

test('andre ressourcer kræver ingen publicering', () => {
  assert.equal(s.countsAsExisting('datatable', { name: 'D' }), true);
  assert.equal(s.countsAsExisting('script', { name: 'S' }), true);
});
