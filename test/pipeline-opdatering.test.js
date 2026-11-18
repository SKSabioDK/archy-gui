// Tavlen følger med de andre pc'er ved at spørge til et fingeraftryk af
// manifest-tabellen. Det skal ændre sig når en række ændres — og kun da.

const test = require('node:test');
const assert = require('node:assert/strict');
const { manifestSignature } = require('../src/server.js');

const rows = () => ({
  'Betaling|INBOUNDCALL': { flowName: 'Betaling', version: '5.0', publishedAt: 100, at: 1000 },
  'Velkomst|INBOUNDCALL': { flowName: 'Velkomst', version: '2.0', publishedAt: 200, at: 2000, releases: [{ id: 'a' }] }
});

test('samme rækker giver samme fingeraftryk, uanset rækkefølge', () => {
  const a = rows();
  const b = {}; for (const k of Object.keys(a).reverse()) b[k] = a[k];
  assert.equal(manifestSignature(a), manifestSignature(b));
});

test('en ny udgave, en ny række eller en ny release ændrer fingeraftrykket', () => {
  const grund = manifestSignature(rows());
  const ny = rows(); ny['Betaling|INBOUNDCALL'].version = '6.0'; ny['Betaling|INBOUNDCALL'].at = 3000;
  assert.notEqual(manifestSignature(ny), grund);
  const flere = rows(); flere['Ny|BOT'] = { flowName: 'Ny', version: '1.0', at: 4000 };
  assert.notEqual(manifestSignature(flere), grund);
  const rel = rows(); rel['Velkomst|INBOUNDCALL'].releases.push({ id: 'b' });
  assert.notEqual(manifestSignature(rel), grund);
});

test('ingen tabel har sit eget fingeraftryk', () => {
  assert.equal(manifestSignature(null), 'none');
  assert.notEqual(manifestSignature({}), 'none');
});

// ── Publiceringer uden om Archy GUI (v1.86.0) ────────────────────────────────
// Kundens egen pipeline skriver ikke i manifest-tabellen, så tavlen spørger
// også til udgaverne i Genesys — og man kan godkende en udgave som nyt udgangspunkt.

const fs = require('fs');
const path = require('path');
const { versionSignature } = require('../src/routes/pipeline.js');
const { acceptedRow } = require('../src/routes/manifest.js');

const flows = () => new Map([
  ['Betaling|INBOUNDCALL', { dev: { flowId: 'a', published: '7.0', saved: '8.0', publishedAt: 't1' }, prod: { flowId: 'b', published: '5.0', saved: '5.0', publishedAt: 't0' } }],
  ['Velkomst|INBOUNDCALL', { prod: { flowId: 'c', published: '2.0', saved: '2.0', publishedAt: 't2' } }]
]);

test('fingeraftrykket af udgaverne ændrer sig ved en publicering i prod — og ikke ellers', () => {
  const grund = versionSignature(flows());
  assert.equal(versionSignature(flows()), grund, 'samme udgaver, samme aftryk');
  const omvendt = new Map([...flows()].reverse());
  assert.equal(versionSignature(omvendt), grund, 'rækkefølgen er ligegyldig');
  const pub = flows(); pub.get('Betaling|INBOUNDCALL').prod = { flowId: 'b', published: '6.0', saved: '6.0', publishedAt: 't3' };
  assert.notEqual(versionSignature(pub), grund, 'kundens publicering i prod ses');
  const nyt = flows(); nyt.set('Ny|INBOUNDCALL', { prod: { flowId: 'd', published: '1.0' } });
  assert.notEqual(versionSignature(nyt), grund, 'et nyt flow ses');
  assert.notEqual(versionSignature(flows(), [{ environment: 'PROD' }]), grund, 'et miljø der ikke kunne læses, tæller med');
});

test('en godkendelse sætter udgangspunktet til miljøets udgave og bevarer hvor flowet kom fra', () => {
  const før = { flowName: 'Betaling', version: '5.0', publishedAt: 't0', promotedFrom: 'Kunde TEST', kind: 'migration', releases: [{ id: 'r1' }] };
  const efter = acceptedRow(før, { version: '6.0', publishedAt: 't3' }, 42);
  assert.equal(efter.version, '6.0');
  assert.equal(efter.publishedAt, 't3');
  assert.equal(efter.promotedFrom, 'Kunde TEST', 'ellers ville næste publicering udenom ikke blive opdaget');
  assert.deepEqual(efter.releases, [{ id: 'r1' }], 'release-historikken bevares');
  assert.deepEqual(efter.accepted, { fromVersion: '5.0', fromPublishedAt: 't0', at: 42 });
  assert.equal(før.version, '5.0', 'den gamle række ændres ikke');
});

test('godkend-ruten står bag prod-vagten, og tavlen har knappen og tjekket af Genesys', () => {
  const { PROD_WRITE_ROUTES } = require('../src/lib/prod-rights.js');
  assert.equal(PROD_WRITE_ROUTES['/api/manifest/accept'], 'envId');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('onclick="event.stopPropagation(); pipelineAccept('), 'knappen i cellen');
  assert.ok(html.includes("fetch('/api/manifest/accept'"), 'knappen kalder ruten');
  assert.ok(html.includes('/api/pipeline/versions?tenant='), 'tavlen spørger til udgaverne');
  assert.ok(html.includes('pipelineVSig = r.versionSig'), 'indlæsningen er nulpunktet for tjekket');
  assert.ok(html.includes("t('pl_refreshed_genesys')"), 'brugeren får at vide hvorfor tavlen blev tegnet igen');
});
