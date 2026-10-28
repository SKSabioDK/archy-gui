// 🔌 Test skal også kende de nyere funktioner — org-indstillinger, Terraform, roller,
// OAuth, vidensbaser m.fl. — ellers siger den "alt i orden", mens en fane fejler på et
// manglende scope. De prøves ved at læse listen med brugerens eget login.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('et manglende scope bliver til "scope x", så man ved hvad der skal tilføjes på OAuth-klienten', () => {
  const r = s.liveProbeResult('presence', 403, { message: 'App not authorized to use scope [presence, presence:readonly] [app.not.authorized.for.scope]' });
  assert.deepEqual(r, { area: 'presence', ok: false, missing: ['scope presence'] });
});

test('en manglende rettighed nævnes, og andre fejl er ukendt — ikke "i orden"', () => {
  assert.deepEqual(s.liveProbeResult('queues', 403, { message: 'You are missing the following permission(s): [routing:queue:view]' }).missing, ['routing:queue:view']);
  assert.deepEqual(s.liveProbeResult('x', 403, {}).missing, ['HTTP 403']);
  assert.equal(s.liveProbeResult('x', 500).unknown, true);
  assert.equal(s.liveProbeResult('x', 500).ok, false);
  assert.deepEqual(s.liveProbeResult('x'), { area: 'x', ok: true, missing: [] });
});

test('testen prøver de nyere områder og springer dem over, den allerede har tjekket', () => {
  const areas = s.LIVE_PROBES.map(([a]) => a);
  for (const a of ['presence', 'orgset', 'roles', 'oauth', 'knowledgebases', 'contactlists', 'wrapup', 'integ'])
    assert.ok(areas.includes(a), a);
  assert.equal(new Set(areas).size, areas.length, 'ingen dubletter');
  assert.ok(s.LIVE_PROBES.every(([, p]) => /^\/api\/v2\//.test(p)));
  assert.match(SERVER, /checks = checks\.concat\(await liveProbes\(apiBase, token, new Set\(checks\.map\(c => c\.area\)\)\)\)/);
});

test('hvert nyt område har en tekst i brugerfladen, lånt fra fanens navn', () => {
  assert.match(HTML, /function permAreaLabel\(area\)/);
  assert.match(HTML, /permAreaLabel\(c\.area\)/);
  assert.ok(!HTML.includes("t('perm_area_' + c.area)"), 'gamle opslag er erstattet');
  for (const [a] of s.LIVE_PROBES) {
    const nogle = a === 'presence' ? 'os_sec_presence' : 'da_tab_' + a;
    assert.equal(HTML.split(nogle + ':').length - 1, 6, `${a} (${nogle}) skal stå på alle seks sprog`);
  }
});
