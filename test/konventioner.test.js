// Trin-rækkefølgen og versionsendelsen står ét sted i server.js og hentes af
// klienten som /konventioner.js. Testene her spærrer for at nogen skriver dem
// af igen — det var netop dét der gjorde at de kunne skride fra hinanden.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const KLIENT = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('trin-rækkefølgen står kun ét sted i hele programmet', () => {
  // Listen som kode — ikke som prosa i hjælpeteksterne, der beskriver den.
  const forekomster = (kilde) => (kilde.match(
    /\[\s*(?:['"]['"]\s*,\s*)?['"]dev['"]\s*,\s*['"]test['"]\s*,\s*['"]uat['"]\s*,\s*['"]prod['"]/g) || []).length;
  assert.equal(forekomster(SERVER), 1, 'server.js må kun have STAGES én gang');
  assert.equal(forekomster(KLIENT), 0, 'klienten skal hente listen fra serveren');
});

test('versionsendelsens regel står kun ét sted', () => {
  const forekomster = (kilde) => (kilde.match(/_v\(?\\d\+\)?\$/g) || []).length;
  assert.equal(forekomster(SERVER), 1, 'server.js må kun have VERSION_SUFFIX én gang');
  assert.equal(forekomster(KLIENT), 0, 'klienten skal hente reglen fra serveren');
});

test('klienten indlæser konventionerne før sin egen kode', () => {
  const konv = KLIENT.indexOf('src="/konventioner.js"');
  const egen = KLIENT.indexOf('window.KONVENTIONER');
  assert.ok(konv > 0, 'index.html skal hente /konventioner.js');
  assert.ok(konv < egen, 'scriptet skal stå før koden der bruger det');
});

test('/konventioner.js svarer med det serveren faktisk bruger', async () => {
  // Kører serveren på en ledig port frem for at gætte hvad ruten svarer.
  const srv = await new Promise(res => { const h = s.app.listen(0, '127.0.0.1', () => res(h)); });
  try {
    const port = srv.address().port;
    const svar = await fetch(`http://127.0.0.1:${port}/konventioner.js`);
    assert.equal(svar.status, 200);
    assert.match(svar.headers.get('content-type') || '', /javascript/);

    const tekst = await svar.text();
    const window = {};
    new Function('window', tekst)(window);

    assert.deepEqual(window.KONVENTIONER.stages, s.STAGES);
    assert.equal(window.KONVENTIONER.versionSuffix, s.VERSION_SUFFIX.source);
    assert.equal(window.KONVENTIONER.versionSuffixFlags, s.VERSION_SUFFIX.flags);
  } finally {
    await new Promise(res => srv.close(res));
  }
});

test('klientens regel opfører sig som serverens på de samme navne', () => {
  // Bygger klientens regex ud af det serveren sender, og prøver begge sider på
  // de navne der faktisk optræder — det er dér de to skal give samme svar.
  const klientRegel = new RegExp(s.VERSION_SUFFIX.source, s.VERSION_SUFFIX.flags);
  const klientSuffix = navn => {
    const m = navn ? String(navn).match(klientRegel) : null;
    return m ? parseInt(m[1], 10) : null;
  };
  for (const navn of ['testest', 'testest_v10', 'testest_V15', 'DEV_WeekNumber_v3',
                      'flow_v2_andet', 'Uden endelse', '']) {
    assert.equal(klientSuffix(navn), s.versionSuffixOf(navn), `uenige om "${navn}"`);
  }
});

test('versionSuffixOf og baseFlowName læser den samme endelse', () => {
  assert.equal(s.versionSuffixOf('testest_v10'), 10);
  assert.equal(s.baseFlowName('testest_v10'), 'testest');
  assert.equal(s.versionSuffixOf('testest'), null);
  assert.equal(s.versionSuffixOf('flow_v2_andet'), null);
});

test('serverens egen sortering følger STAGES og ikke en skreven rækkefølge', () => {
  const sorteret = [...s.STAGES].reverse().sort((a, b) => s.stageOrder(a) - s.stageOrder(b));
  assert.deepEqual(sorteret, s.STAGES);
});
