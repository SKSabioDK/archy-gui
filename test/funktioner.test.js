// Flow Builder (beta) og Demo-kunden er interne. De er skjult indtil der er
// indtastet en aktiveringsnøgle, og serverens demo-ruter afviser kald uden den.
// Testen holder de tre ting sammen: nøgletjekket, spærringen og de skjulte steder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const laes = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SERVER = laes('server.js');
const HTML = laes('public/index.html');

test('en tom eller forkert nøgle åbner ikke', () => {
  for (const k of ['', '   ', null, undefined, 42, 'ARCHY', 'archy-8b832b-6356ad-485a50'])
    assert.equal(s.keyMatches(k), false, String(k));
});

test('nøglen står ikke i koden — kun dens hash', () => {
  assert.ok(!SERVER.includes('ARCHY-8B832B'), 'selve nøglen må ikke stå i server.js');
  assert.match(SERVER, /FEATURE_KEY_SHA256 = '[0-9a-f]{64}'/);
});

test('hver demo-rute, der opretter, nulstiller, fjerner eller viser, kræver nøglen', () => {
  for (const r of ["app.get('/api/demo/status'", "app.post('/api/demo/create'", "app.post('/api/demo/reset'", "app.delete('/api/demo'"]) {
    const i = SERVER.indexOf(r);
    assert.notEqual(i, -1, r);
    assert.match(SERVER.slice(i, i + 80), /requireInternal/, `${r} mangler requireInternal`);
  }
});

test('Flow Builder, hjælpeknappen og demo-kortet skjules uden nøgle', () => {
  assert.match(HTML, /body:not\(\.internal\) \[data-internal\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(HTML, /<button data-internal [^>]*onclick="openYamlWizard\(\)"/);
  assert.match(HTML, /<button data-internal [^>]*showHelp\('flowbuilder'/);
  assert.match(HTML, /<details class="card" id="demoCard" data-internal>/);
  // …og selve funktionerne gør intet, hvis de kaldes alligevel.
  assert.match(HTML, /function openYamlWizard\(\) \{\s*if \(!features\.internal\) return;/);
  assert.match(HTML, /async function renderDemoButtons\(\) \{[^]*?if \(!features\.internal\)/);
});
