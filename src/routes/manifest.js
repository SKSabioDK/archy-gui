// Ruter: manifestet i org'en (status, oprettelse, genopbygning) og den lokale historik.

const express = require('express');
const crypto = require('crypto');
const { loadSettings } = require('../config');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { stageOrder } = require('../lib/conventions');
const { describeApiError } = require('../lib/helpers');
const { tenantOf, groupOf, stageOf, orgKeyOf, isDemo, belongsToEnv, stripEnvPrefix } = require('../lib/environments');
const { baseFlowName } = require('../lib/names');
const { _mfTableCache } = require('../lib/token');
const { loadManifest, findManifestEntry } = require('../lib/manifest-file');
const { whoAmI, ORG_MANIFEST_BASE, manifestTableName, orgManifestKey, findOrgManifestTable,
  createOrgManifestTable, demoManifest, onlyFlowRows, readOrgManifest, putOrgManifestRow } = require('../lib/manifest');
const { demoFlowsFor } = require('../lib/demo');
const { setupInBackground, ensurePipelineIdsSaved, writeSetupRow, pipelinePeers, readSetupRow,
  siblingsFromPeers } = require('../lib/setup');
const { trimOrgReleases, compactRelease, loadReleases } = require('../lib/releases');
const { listAllFlows } = require('../lib/dependents');

const router = express.Router();

router.get('/api/manifest/status', async (req, res) => {
  const { tenant, group } = req.query;
  const envs = loadCustomers().filter(c => tenantOf(c) === tenant && groupOf(c) === group)
    .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage));
  if (!envs.length) return res.status(404).json({ error: 'Ingen miljøer i den gruppe' });
  const out = [];
  // Opsætningsrækken: skrevet og i trit, venter på at blive skrevet, eller
  // aldrig skrevet fra denne pc.
  const setupState = c => c.setupPending ? 'pending' : c.setupAt ? 'ok' : 'none';
  // Ét opslag pr. miljø, side om side — rækkefølgen bevares.
  out.push(...await Promise.all(envs.map(async c => {
    if (isDemo(c))
      return { id: c.id, name: c.name, stage: stageOf(c), hasTable: true, setup: setupState(c),
               table: manifestTableName(c),
               rows: Object.keys(onlyFlowRows(demoManifest(c.id))).length, demo: true };
    try {
      const rows = await readOrgManifest(c);
      return { id: c.id, name: c.name, stage: stageOf(c), table: manifestTableName(c), setup: setupState(c),
               hasTable: rows !== null, rows: rows ? Object.keys(rows).length : 0 };
    } catch (e) {
      return { id: c.id, name: c.name, stage: stageOf(c), table: manifestTableName(c), hasTable: false, error: describeApiError(e) };
    }
  })));
  res.json({ ok: true, table: ORG_MANIFEST_BASE, environments: out });
});

// Et fingeraftryk af manifest-tabellerne i en pipeline-gruppe. Brugerfladen
// spørger med jævne mellemrum og tegner tavlen igen, når det ændrer sig — så
// man ser det en kollega på en anden pc har gjort. Kun nøgler og tidspunkter
// indgår, ikke indholdet. Intervallet står i settings.json (pipelineRefreshSeconds,
// 0 = slået fra).
function manifestSignature(rows) {
  if (!rows) return 'none';
  const h = crypto.createHash('sha1');
  for (const k of Object.keys(rows).sort()) {
    const r = rows[k] || {};
    h.update(`${k}|${r.at || ''}|${r.version ?? ''}|${r.publishedAt || ''}|${(r.releases || []).length}\n`);
  }
  return h.digest('hex').slice(0, 12);
}

router.get('/api/manifest/signature', async (req, res) => {
  const { tenant, group } = req.query;
  const envs = loadCustomers().filter(c => tenantOf(c) === tenant && groupOf(c) === group && stageOf(c));
  const n = Number(loadSettings().pipelineRefreshSeconds);
  const sek = Number.isFinite(n) ? (n === 0 ? 0 : Math.max(15, n)) : 60;
  const dele = await Promise.all(envs.map(async c => {
    try { return `${c.id}:${manifestSignature(await readOrgManifest(c))}`; }
    catch (_) { return `${c.id}:?`; }       // ikke logget ind lige nu, eller ingen forbindelse
  }));
  res.json({ ok: true, sig: dele.length ? dele.join(';') : null, intervalSeconds: sek });
});

router.post('/api/manifest/create', async (req, res) => {
  const c = loadCustomers().find(x => x.id === req.body.envId);
  if (!c) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(c)) return res.json({ ok: true, demo: true });
  if (!stageOf(c))
    return res.status(400).json({ error: `"${c.name}" har intet trin og er ikke med i en pipeline — så får org'en ingen ArchyGUI-tabel. Giv miljøet et trin først.` });
  try {
    const existing = await findOrgManifestTable(c);
    if (existing) { setupInBackground([c.id], 'manifest table found'); return res.json({ ok: true, existed: true }); }
    await createOrgManifestTable(c);
    // Tabellen fødes med opsætningsrækken i — så kan en anden pc finde miljøet.
    ensurePipelineIdsSaved();
    let setup;
    try { setup = await writeSetupRow(loadCustomers().find(x => x.id === c.id) || c, null); }
    catch (e) { setup = { ok: false, error: describeApiError(e) }; }
    setupInBackground(pipelinePeers(c, loadCustomers()).map(x => x.id).filter(id => id !== c.id), 'new manifest table');
    res.json({ ok: true, created: true, setup });
  } catch (e) {
    addLog('ERROR', `Could not create the manifest table: ${describeApiError(e)}`, c.name, 'MANIFEST');
    res.status(500).json({ error: describeApiError(e) });
  }
});

// ── Genopbygning af manifestet ───────────────────────────────────────────────
// En slettet tabel kan bygges op igen. Hvad org'en indeholder NU, kan altid
// læses i Genesys. Historikken — hvem forfremmede hvad, hvornår, hvorfra — kan
// kun findes på en pc der har den i sine lokale filer. Hver række siger derfor
// hvor den kommer fra (history: 'local' eller 'none'), så tavlen og brugeren
// ikke tror historikken er hel, når den ikke er.
function rebuiltManifestRow(flow, entry, releases = []) {
  const row = entry
    ? { flowName: flow.name, version: entry.targetVersion ?? null, publishedAt: entry.targetPublishedAt ?? null,
        kind: entry.kind || 'migration',
        promotedFrom: entry.kind === 'baseline' ? null : (entry.sourceName || null),
        sourceVersion: entry.sourceVersion ?? null, hash: entry.hash || null }
    : { flowName: flow.name, version: flow.version ?? null, publishedAt: flow.publishedAt ?? null, kind: 'baseline' };
  row.rebuilt = true;
  row.history = entry || releases.length ? 'local' : 'none';
  if (releases.length) row.releases = trimOrgReleases(releases.map(compactRelease), row);
  return row;
}

router.post('/api/manifest/rebuild', async (req, res) => {
  ensurePipelineIdsSaved();
  const env = loadCustomers().find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Ukendt miljø' });
  if (!stageOf(env)) return res.status(400).json({ error: `"${env.name}" har intet trin og dermed intet manifest.` });
  // Spørg org'en, ikke hukommelsen: genopbygning sker netop når tabellen er væk.
  delete _mfTableCache[env.id];
  try {
    let created = false;
    if (!isDemo(env) && !(await findOrgManifestTable(env))) { await createOrgManifestTable(env); created = true; }
    const findes = (await readOrgManifest(env)) || {};
    const soeskende = loadCustomers().filter(c => orgKeyOf(c) === orgKeyOf(env));
    const flows = (isDemo(env)
      ? demoFlowsFor(env).map(f => ({ name: f.name, type: f.type, version: f.published ?? null, publishedAt: f.publishedAt ?? null }))
      : (await listAllFlows(env)).map(f => ({ name: f.name, type: f.type,
          version: f.publishedVersion?.name || f.checkedInVersion?.name || null,
          publishedAt: f.publishedVersion?.dateCheckedIn || f.publishedVersion?.dateCreated || null })))
      .filter(f => belongsToEnv(f.name, env, soeskende));
    const lokal = loadManifest(), rels = loadReleases();
    const who = await whoAmI(env);
    let rows = 0, withHistory = 0, kept = 0;
    // Rækkerne skrives nogle ad gangen: et kald pr. række er langsomt ved
    // hundredvis af flows, men for mange på én gang rammer Genesys' grænse.
    const BOLGE = 5;
    const skriv = [];
    for (const f of flows) {
      const base = baseFlowName(stripEnvPrefix(f.name, env));
      const key = orgManifestKey(base, f.type);
      if (findes[key]) { kept++; continue; }        // rækker der står, røres ikke
      const opslag = { targetOrgId: env.orgId || null, targetId: env.id, flowType: f.type };
      const entry = findManifestEntry(lokal, { ...opslag, flowName: base }) || findManifestEntry(lokal, { ...opslag, flowName: f.name });
      const mine = rels.filter(r => r.targetId === env.id && orgManifestKey(r.baseName, r.flowType) === key);
      skriv.push({ key, row: rebuiltManifestRow(f, entry, mine) });
    }
    for (let i = 0; i < skriv.length; i += BOLGE) {
      await Promise.all(skriv.slice(i, i + BOLGE).map(({ key, row }) =>
        putOrgManifestRow(env, key, { ...row, by: who.by, bySource: who.bySource, at: Date.now() })));
    }
    for (const { row } of skriv) { rows++; if (row.history === 'local') withHistory++; }
    // Den nye tabel kender kun de søskende denne pc har. Pipelinens andre orgs
    // har deres egen liste — den hentes ind, så intet af det org'en vidste går tabt.
    const setup = await writeSetupRow(loadCustomers().find(c => c.id === env.id) || env,
      await siblingsFromPeers(env, await readSetupRow(env)));
    addLog('SUCCESS', `Manifest rebuilt in ${env.name}: ${rows} row(s) written (${withHistory} with history from this PC), ` +
      `${kept} kept${created ? ', table created' : ''}`, env.name, 'MANIFEST');
    res.json({ ok: true, created, rows, withHistory, kept, partial: rows > withHistory, setup });
  } catch (e) {
    addLog('ERROR', `Could not rebuild the manifest in ${env.name}: ${describeApiError(e)}`, env.name, 'MANIFEST');
    res.status(500).json({ error: describeApiError(e) });
  }
});

router.get('/api/migrations', (req, res) => res.json(loadManifest()));

module.exports = { router, manifestSignature, rebuiltManifestRow };
