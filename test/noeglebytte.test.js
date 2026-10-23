// Skifter man nøglen på et miljø, må intet fra den gamle hænge ved. Et nyt
// client id med den gamle secret gav invalid_client på hvert kald — og et
// login eller opslag fra før skiftet blev ved med at blive brugt.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const CC = { id: 'c1', name: 'Kunde', authType: 'credentials', clientId: 'gammel-id', clientSecret: 'gammel-secret' };

test('nyt client id uden ny secret afvises på client credentials', () => {
  const fejl = s.credentialChangeError(CC, { ...CC, clientId: 'ny-id' }, false);
  assert.match(fejl, /ny(e)? client secret/);
});

test('nyt client id med ny secret går igennem', () => {
  assert.equal(s.credentialChangeError(CC, { ...CC, clientId: 'ny-id', clientSecret: 'ny' }, true), null);
});

test('kun en ny secret går igennem', () => {
  assert.equal(s.credentialChangeError(CC, { ...CC, clientSecret: 'ny' }, true), null);
});

test('OAuth (PKCE) har ingen secret og kan skifte client id frit', () => {
  const o = { ...CC, authType: 'oauth', clientSecret: '' };
  assert.equal(s.credentialChangeError(o, { ...o, clientId: 'ny-id' }, false), null);
});

test('skift fra OAuth til client credentials kræver en secret', () => {
  const o = { ...CC, authType: 'oauth' };
  assert.ok(s.credentialChangeError(o, { ...o, authType: 'credentials' }, false));
});

test('forgetLogin glemmer tokenet', () => {
  s.tokenStore.x1 = { token: 't', expiresAt: Date.now() + 1e6, orgId: 'o', loginAt: Date.now() };
  s.forgetLogin('x1');
  assert.equal(s.tokenStore.x1, undefined);
});

test('en ny secret glemmer login og opslag fra den gamle nøgle', () => {
  const put = SERVER.slice(SERVER.indexOf("app.put('/api/customers/:id'"), SERVER.indexOf('// ── Token helper'));
  const keys = put.indexOf("['authType', 'clientId', 'clientSecret', 'region'");
  const forget = put.indexOf('forgetLogin(updated.id)');
  assert.ok(keys > 0 && forget > keys && forget - keys < 200, 'en ny secret skal glemme login\'et');
  const fn = SERVER.slice(SERVER.indexOf('function forgetLogin('), SERVER.indexOf('function credentialChangeError('));
  for (const c of ['tokenStore', '_whoCache', '_mfTableCache', 'pkceStore'])
    assert.ok(fn.includes(`delete ${c}[id]`), `${c} glemmes ikke`);
});
