// Brugerfladen genkender "dette miljø mangler login" på serverens egen tekst
// fra getToken, og viser så en Log ind-knap uanset hvilken side man står på.
// Ændres teksten det ene sted og ikke det andet, forsvinder knappen stille.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function klientensMoenster() {
  const m = HTML.match(/const LOGIN_NEEDED = \/(.+)\/g;/);
  assert.ok(m, 'LOGIN_NEEDED findes ikke længere i index.html');
  return new RegExp(m[1]);
}

test('manglende login genkendes af brugerfladen', async () => {
  const env = { id: 'login-test-x', name: 'Kunde A/S — PROD', authType: 'oauth', region: 'mypurecloud.de', clientId: 'c' };
  delete s.tokenStore[env.id];
  const fejl = await s.getToken(env).then(() => null, e => e.message);
  const m = String(fejl).match(klientensMoenster());
  assert.ok(m, `blev ikke genkendt: ${fejl}`);
  assert.equal(m[1], env.name);
});

test('udløbet login genkendes også', async () => {
  const env = { id: 'login-test-y', name: 'Kunde PROD', authType: 'oauth', region: 'mypurecloud.de', clientId: 'c' };
  s.tokenStore[env.id] = { token: 't', expiresAt: Date.now() - 1000 };
  const fejl = await s.getToken(env).then(() => null, e => e.message);
  assert.match(String(fejl), klientensMoenster());
});

test('hver login-fejltekst i server.js passer til mønsteret', () => {
  const tekster = [...SERVER.matchAll(/`(OAuth token [^`]*)`/g)].map(m => m[1].replace(/\$\{[^}]+\}/g, 'X'));
  assert.ok(tekster.length >= 3, `fandt kun ${tekster.length}`);
  for (const t of tekster) assert.match(t, klientensMoenster(), t);
});
