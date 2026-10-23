// Med PKCE afgør brugerens roller OG OAuth-klientens scopes hvad et kald må.
// Falck US fik et nyt PKCE-login, men klienten manglede scopet scripts, og
// 🔌 Test sagde intet. Og da org'ens inaktivitets-timeout dræbte tokenet, blev
// miljøet ved med at stå som logget ind, mens hvert kald fik 401.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');

const CHECKS = [
  { area: 'flows_write', ok: true, missing: [] },
  { area: 'scripts', ok: true, missing: [] },
  { area: 'queues', ok: true, missing: [] }
];

test('et manglende scope gør funktionen rød, selv med rollerne i orden', () => {
  const r = s.applyClientScopes(CHECKS, ['architect', 'routing:readonly']);
  assert.deepEqual(r.find(c => c.area === 'scripts'), { area: 'scripts', ok: false, unknown: false, missing: ['scope scripts'] });
  assert.equal(r.find(c => c.area === 'flows_write').ok, true);
});

test('læseadgang er nok hvor der kun læses', () => {
  assert.equal(s.applyClientScopes(CHECKS, ['routing:readonly', 'architect', 'scripts']).every(c => c.ok), true);
  // ... men ikke hvor der skrives
  assert.equal(s.applyClientScopes(CHECKS, ['architect:readonly', 'scripts', 'routing']).find(c => c.area === 'flows_write').ok, false);
});

test('en klient uden scope-liste begrænser ikke', () => {
  assert.deepEqual(s.applyClientScopes(CHECKS, []), CHECKS);
  assert.deepEqual(s.applyClientScopes(CHECKS, undefined), CHECKS);
});

test('et login Genesys afviser med 401, glemmes', () => {
  s.tokenStore['afvist-1'] = { token: 'dødt-token', expiresAt: Date.now() + 1e6, orgId: 'o', loginAt: Date.now() };
  const err = { response: { status: 401 }, config: { headers: { Authorization: 'Bearer dødt-token' } } };
  assert.equal(s.dropRejectedLogin(err), 'afvist-1');
  assert.equal(s.tokenStore['afvist-1'], undefined);
});

test('andre fejl og ukendte tokens rører ikke login\'et', () => {
  s.tokenStore['levende-1'] = { token: 'godt-token', expiresAt: Date.now() + 1e6, orgId: 'o', loginAt: Date.now() };
  assert.equal(s.dropRejectedLogin({ response: { status: 403 }, config: { headers: { Authorization: 'Bearer godt-token' } } }), null);
  assert.equal(s.dropRejectedLogin({ response: { status: 401 }, config: { headers: { Authorization: 'Bearer et-andet' } } }), null);
  assert.ok(s.tokenStore['levende-1']);
  delete s.tokenStore['levende-1'];
});
