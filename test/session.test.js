// Et PKCE-login huskes over en genstart, så man ikke skal gennem MFA igen
// hver gang programmet startes om — men kun kort, kun på denne maskine, og kun
// for de miljøer og den org logget ind var til.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Før serveren indlæses: sessionsfilen skal ligge i en midlertidig mappe, ikke
// i den rigtige brugers.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'archy-session-'));
process.env.ARCHY_SESSION_DIR = DIR;
const s = require('../server.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const ANDEN = '22222222-2222-2222-2222-222222222222';
const MIN = 60 * 1000;
const miljoe = (id, extra = {}) => ({ id, name: id, authType: 'oauth', orgId: ORG, tenant: 'T', group: 'G', stage: 'dev', ...extra });
const login = (alder, extra = {}) => ({ token: 'tok-' + alder, orgId: ORG, orgName: 'Org', loginAt: Date.now() - alder * MIN,
                                         expiresAt: Date.now() + 600 * MIN, ...extra });
const ryd = () => { for (const k of Object.keys(s.tokenStore)) delete s.tokenStore[k]; };
const fil = () => { try { return JSON.parse(fs.readFileSync(s.SESSION_FILE, 'utf8')); } catch (_) { return null; } };

test.after(() => { s.setSessionPersist(false); fs.rmSync(DIR, { recursive: true, force: true }); });

test('et frisk login gemmes — et gammelt eller udløbet gør ikke', () => {
  ryd(); s.setSessionPersist(true);
  s.tokenStore.frisk = login(5);
  s.tokenStore.gammelt = login(45);
  s.tokenStore.udloebet = login(5, { expiresAt: Date.now() - 1000 });
  s.tokenStore.udenTid = { token: 'x', orgId: ORG, expiresAt: Date.now() + 10 * MIN };
  s.saveSessions();
  assert.deepEqual(Object.keys(fil()), ['frisk']);
});

test('er der intet at huske, ligger der ingen fil', () => {
  ryd(); s.setSessionPersist(true);
  s.tokenStore.gammelt = login(45);
  s.saveSessions();
  assert.equal(fs.existsSync(s.SESSION_FILE), false);
});

test('efter en genstart hentes friske logins tilbage til de rigtige miljøer', () => {
  ryd(); s.setSessionPersist(true);
  s.tokenStore.a = login(10);
  s.saveSessions();
  ryd();
  assert.equal(s.loadSessions([miljoe('a')]), 1);
  assert.equal(s.tokenStore.a.token, 'tok-10');
});

test('et login hentes ikke tilbage til et miljø i en anden org, et ukendt miljø eller et client credentials-miljø', () => {
  ryd(); s.setSessionPersist(true);
  s.tokenStore.forkert = login(10);
  s.tokenStore.ukendt = login(10);
  s.tokenStore.cc = login(10);
  s.saveSessions();
  ryd();
  const n = s.loadSessions([miljoe('forkert', { orgId: ANDEN }), miljoe('cc', { authType: 'credentials' })]);
  assert.equal(n, 0);
  assert.deepEqual(Object.keys(s.tokenStore), []);
});

test('et login der blev for gammelt mens programmet var lukket, hentes ikke', () => {
  ryd(); s.setSessionPersist(true);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(s.SESSION_FILE, JSON.stringify({ a: login(31) }));
  assert.equal(s.loadSessions([miljoe('a')]), 0);
});

test('en ødelagt sessionsfil giver bare ingen logins', () => {
  ryd();
  fs.writeFileSync(s.SESSION_FILE, '{ikke json');
  assert.equal(s.loadSessions([miljoe('a')]), 0);
});

test('i testene skrives der aldrig en sessionsfil af sig selv', () => {
  ryd(); s.setSessionPersist(false);
  try { fs.unlinkSync(s.SESSION_FILE); } catch (_) {}
  s.tokenStore.a = login(1);
  s.saveSessions();
  assert.equal(fs.existsSync(s.SESSION_FILE), false);
});
