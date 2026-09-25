// Genpublicering eksporterer den publicerede udgave og importerer den igen, og
// så valideres flowet mod org'en som den er NU. Fejlene herunder er de rigtige
// fra Sabio's prod-org 2026-09-25 — hver skal kunne forklares for brugeren.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');

const DEBUG = String.raw`C:\Tools\Archy\archyHome\debug\archy-debug-2026-09-25T22.05.49.125Z.txt`;

test('en TTS-stemme org\'en ikke har', () => {
  const e = s.explainRepublishFailure(
    `did not find a text to speech voice with the name 'nb-NO-Standard-A' for engine 'Genesys Enhanced TTS' in language 'nb-no'. ('voice' i '/inboundCall/textToSpeech') — full Archy output: ${DEBUG}`);
  assert.equal(e.kind, 'tts-voice');
  assert.equal(e.value, 'nb-NO-Standard-A');
  assert.equal(e.lang, 'nb-no');
  assert.equal(e.debugFile, DEBUG);
  assert.ok(!e.reason.includes('full Archy output'));
});

test('ingen standardstemme for sproget', () => {
  const e = s.explainRepublishFailure(
    `a default voice was not found for engine 'Genesys Enhanced TTS' and language 'da-DK'. ('textToSpeech' i '/inqueueCall/supportedLanguages')`);
  assert.equal(e.kind, 'tts-default');
  assert.equal(e.lang, 'da-DK');
});

test('en kø der ikke findes, og hvor i flowet', () => {
  const e = s.explainRepublishFailure(
    `Error details: no matches ('targetQueue' i '/inboundCall/menus/menu[EG_Demo_69]/choices/menuTransferToAcd[_^_archy_menuTransferToAcd_3__]')`);
  assert.equal(e.kind, 'missing-ref');
  assert.equal(e.what, 'queue');
  assert.equal(e.field, 'targetQueue');
  // Archys eget løbenavn springes over — menuen er det brugeren kan finde.
  assert.equal(e.where, 'menu "EG_Demo_69"');
});

test('et felt der skal udfyldes, er tomt', () => {
  const e = s.explainRepublishFailure(`expected a object but got null ('initialGreeting' i '/inboundCall')`);
  assert.equal(e.kind, 'empty-field');
  assert.equal(e.field, 'initialGreeting');
  assert.equal(e.where, null);
});

test('en ukendt fejl beholder Archys egen tekst', () => {
  const e = s.explainRepublishFailure('noget helt andet');
  assert.equal(e.kind, 'other');
  assert.equal(e.reason, 'noget helt andet');
});
