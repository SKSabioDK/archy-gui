// Ruter: flows på tværs af miljøer (afhængige, genpublicering, rollback, publicering, baseline).

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { FLOWS_DIR } = require('../config');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { normType } = require('../lib/conventions');
const { sanitizeName, describeApiError } = require('../lib/helpers');
const { tenantOf, groupOf, stageOf, orgKeyOf, isDemo, belongsToEnv, stripEnvPrefix } = require('../lib/environments');
const { baseFlowName } = require('../lib/names');
const { getToken } = require('../lib/token');
const { getFlowPublishInfo } = require('../lib/genesys');
const { refuseProdWrite } = require('../lib/prod-rights');
const { loadManifest, recordManifest, findManifestEntry } = require('../lib/manifest-file');
const { getOrgId, whoAmI, readOrgManifest, writeOrgManifestRow } = require('../lib/manifest');
const { loadDemo, saveDemo, demoRemember, demoFlowKey, demoFlowsFor } = require('../lib/demo');
const { runArchy, archyArg, explainRepublishFailure } = require('../lib/archy');
const { renameFlowInYaml, publishedVersionFor, exportFlowToYaml } = require('../lib/flow-yaml');
const { recordReleaseEverywhere, saveSnapshot, releaseDiff, releaseRef, readSnapshot,
  mutateRelease, rollbackCandidate, flowVersionContent, findRelease } = require('../lib/releases');
const { noteTargetRepublished, dependentsOf, staleModules, fdaUsage } = require('../lib/dependents');

const router = express.Router();

router.get('/api/customers/:id/fda-usage', async (req, res) => {
  const env = loadCustomers().find(c => c.id === req.params.id);
  if (!env) return res.status(404).json({ error: 'Not found' });
  try {
    res.json({ ok: true, ...(await fdaUsage(env)) });
  } catch (e) {
    addLog('WARN', `Could not look up the Function Data Action usage in ${env.name}: ${describeApiError(e)}`, env.name, 'MIGRATE');
    res.status(500).json({ error: describeApiError(e) });
  }
});

router.get('/api/customers/:id/stale-modules', async (req, res) => {
  const env = loadCustomers().find(c => c.id === req.params.id);
  if (!env) return res.status(404).json({ error: 'Not found' });
  try {
    res.json({ ok: true, modules: await staleModules(env) });
  } catch (e) {
    addLog('WARN', `Could not check common modules in ${env.name}: ${describeApiError(e)}`, env.name, 'REPUBLISH');
    res.status(500).json({ error: describeApiError(e) });
  }
});

router.post('/api/flows/dependents', async (req, res) => {
  const { envId, moduleName } = req.body;
  const env = loadCustomers().find(c => c.id === envId);
  if (!env) return res.status(404).json({ error: 'Customer not found' });
  if (!moduleName) return res.status(400).json({ error: 'moduleName required' });
  try {
    res.json({ ok: true, dependents: await dependentsOf(env, moduleName) });
  } catch (e) {
    addLog('ERROR', `Could not find the flows that use "${moduleName}" in ${env.name}: ${describeApiError(e)}`, env.name, 'REPUBLISH');
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Genpublicerer ét flow i sin publicerede udgave, så det tager den nyeste
// udgave af de common modules det kalder med. Indholdet ellers er uændret.
async function republishOne(env, name, type) {
  if (isDemo(env)) {
    const d = loadDemo();
    const f = (d.flows[demoFlowKey(env)] || []).find(x => x.name === name && normType(x.type) === normType(type));
    if (!f) throw new Error(`"${name}" does not exist in ${env.name}`);
    const prevVersion = f.published;
    const cur = parseInt(String(f.published || '0').split('.')[0], 10) || 0;
    f.published = `${cur + 1}.0`;
    f.publishedAt = Date.now();
    demoRemember(f);
    saveDemo(d);
    return { prevVersion, version: f.published, publishedAt: f.publishedAt, yaml: f.content };
  }
  const lower = String(type).toLowerCase();
  const prevVersion = await publishedVersionFor(env, name, lower, 'REPUBLISH');
  if (!prevVersion) throw new Error(`"${name}" has no published version in ${env.name}`);
  const { yaml, fileName } = await exportFlowToYaml(env, name, lower, prevVersion);
  const file = path.join(FLOWS_DIR, sanitizeName(env.name), `.republish-${fileName}`);
  fs.writeFileSync(file, yaml, 'utf8');
  try {
    await runArchy(`publish --file ${archyArg(file, 'File path')}`, env);
  } finally {
    try { fs.unlinkSync(file); } catch (_) {}
  }
  const pub = await getFlowPublishInfo(env, name, lower).catch(() => null);
  return { prevVersion, version: pub?.version || null, publishedAt: pub?.publishedAt || Date.now(), yaml };
}

router.post('/api/flows/republish', async (req, res) => {
  const { envId, flows, moduleName, releaseRef: modulRef, confirmProd } = req.body;
  const env = loadCustomers().find(c => c.id === envId);
  if (!env) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(flows) || !flows.length) return res.status(400).json({ error: 'No flows selected' });
  if (stageOf(env) === 'prod' && !confirmProd)
    return res.status(409).json({ code: 'prod-confirm',
      error: `"${env.name}" er et prod-miljø. Genpubliceringen skal bekræftes udtrykkeligt.` });

  const who = await whoAmI(env);
  const results = [];
  for (const f of flows) {
    try {
      const r = await republishOne(env, f.name, f.type);
      const base = baseFlowName(stripEnvPrefix(f.name, env));
      const snap = saveSnapshot(env.id, f.name, r.yaml);
      await recordReleaseEverywhere(env, {
        kind: 'republish', demo: isDemo(env),
        tenant: tenantOf(env), group: groupOf(env),
        sourceId: null, sourceName: null, targetId: env.id, targetName: env.name,
        targetStage: stageOf(env),
        flowType: f.type, baseName: base, fromName: f.name, toName: f.name,
        prevVersion: r.prevVersion, newVersion: r.version,
        by: who.by, bySource: who.bySource,
        prevSnapshot: snap, newSnapshot: snap,
        note: moduleName ? `Republished to pick up common module "${moduleName}"` : '',
        diff: releaseDiff(r.yaml, r.yaml)
      });
      await noteTargetRepublished(env, base, f.type, r.version, r.publishedAt, 'republish');
      addLog('SUCCESS', `"${f.name}" republished in ${env.name} (v${r.prevVersion} → v${r.version || '?'})` +
        (moduleName ? ` to pick up "${moduleName}"` : ''), env.name, 'REPUBLISH');
      results.push({ name: f.name, type: f.type, ok: true, version: r.version });
    } catch (e) {
      const msg = describeApiError(e);
      addLog('ERROR', `Could not republish "${f.name}" in ${env.name}: ${msg}`, env.name, 'REPUBLISH');
      results.push({ name: f.name, type: f.type, ok: false, error: msg, explain: explainRepublishFailure(msg) });
    }
  }
  // Modulets egen release-note får listen med, så man kan se hvad ændringen
  // trak med sig.
  if (modulRef && modulRef.id && modulRef.envId === env.id) {
    const nye = results.map(x => ({ name: x.name, ok: x.ok, error: x.error || null }));
    await mutateRelease(env, modulRef.baseName, modulRef.flowType, modulRef.id,
      r => { r.cascade = [...(r.cascade || []), ...nye]; });
  }
  res.json({ ok: true, results });
});

// Rollback: målet får det indhold det havde før releasen, publiceret som en ny
// udgave. Genesys kan ikke "af-publicere" til en gammel udgave — historikken
// går kun fremad — så en rollback er en ny publicering af det gamle indhold.
//
// Indholdet hentes fra ORG'ENS egen historik: releasen i manifest-rækken siger
// hvilken udgave målet stod på før, og den udgave eksporteres. Det virker fra
// enhver pc med adgang til org'en. Har denne pc indholdet i cachen, bruges det
// og eksporten spares.
//
// Navnet: i demoen går navnet tilbage med (Betaling_v6 → Betaling_v5), for
// dér bærer navnet versionen. I en rigtig org beholder flowet sit nuværende
// navn — et andet navn i YAML'en ville få Archy til at oprette et NYT flow
// ved siden af, og alt der ruter til det gamle ville pege forkert.
router.post('/api/releases/rollback', async (req, res) => {
  const f = await findRelease(req.body.ref);
  if (f.error) return res.status(f.status).json({ error: f.error });
  const { env, list, rel: r } = f;
  if (refuseProdWrite(res, env, '/api/releases/rollback')) return;

  const cand = rollbackCandidate(list);
  if (!cand || cand.id !== r.id)
    return res.status(409).json({ code: 'not-latest',
      error: 'Kun den nyeste forfremmelse kan rulles tilbage — den er måske allerede rullet tilbage fra en anden pc. Genindlæs tavlen.' });
  if (stageOf(env) === 'prod' && !req.body.confirmProd)
    return res.status(409).json({ code: 'prod-confirm',
      error: `"${env.name}" er et prod-miljø. Rollback skal bekræftes udtrykkeligt.` });

  try {
    // Det vi går tilbage TIL, og det vi går væk FRA (til diff'en).
    let prevYaml = readSnapshot(r.prevSnapshot);
    let kilde = 'cache';
    if (prevYaml == null) {
      prevYaml = await flowVersionContent(env, r.toName, r.flowType, r.prevVersion);
      kilde = 'org';
    }
    let curYaml = readSnapshot(r.newSnapshot);
    if (curYaml == null) {
      try { curYaml = await flowVersionContent(env, r.toName, r.flowType, null); } catch (_) { curYaml = null; }
    }
    addLog('INFO', `Rollback of "${r.toName}" in ${env.name}: content of v${r.prevVersion || '?'} taken from ` +
      (kilde === 'org' ? 'the org\'s version history' : 'the local cache'), env.name, 'ROLLBACK');

    let name, version, publishedAt, published;
    if (isDemo(env)) {
      const d = loadDemo();
      const siblings = loadCustomers().filter(c => isDemo(c) && demoFlowKey(c) === demoFlowKey(env));
      const fl = (d.flows[demoFlowKey(env)] || []).find(x =>
        normType(x.type) === r.flowType && belongsToEnv(x.name, env, siblings) &&
        baseFlowName(stripEnvPrefix(x.name, env)) === r.baseName);
      if (!fl) throw new Error(`"${r.toName}" does not exist in ${env.name} anymore`);
      name = r.fromName || fl.name;
      published = renameFlowInYaml(prevYaml, name);
      const cur = parseInt(String(fl.published || '0').split('.')[0], 10) || 0;
      fl.name = name;
      fl.content = published;
      fl.published = `${cur + 1}.0`;
      fl.publishedAt = Date.now();
      demoRemember(fl);
      version = fl.published; publishedAt = fl.publishedAt;
      saveDemo(d);
    } else {
      name = r.toName;
      published = renameFlowInYaml(prevYaml, name);
      const dir = path.join(FLOWS_DIR, sanitizeName(env.name));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `.rollback-${sanitizeName(name)}-${Date.now()}.yaml`);
      fs.writeFileSync(file, published, 'utf8');
      try {
        await runArchy(`publish --file ${archyArg(file, 'File path')}`, env);
      } finally {
        try { fs.unlinkSync(file); } catch (_) {}
      }
      const pub = await getFlowPublishInfo(env, name, r.flowType.toLowerCase()).catch(() => null);
      version = pub?.version || null; publishedAt = pub?.publishedAt || Date.now();
    }

    const who = await whoAmI(env);
    const rb = await recordReleaseEverywhere(env, {
      kind: 'rollback', demo: isDemo(env),
      tenant: tenantOf(env), group: groupOf(env),
      sourceId: null, sourceName: null, targetId: env.id, targetName: env.name,
      targetStage: stageOf(env),
      flowType: r.flowType, baseName: r.baseName, fromName: r.toName, toName: name,
      prevVersion: r.newVersion, newVersion: version,
      by: who.by, bySource: who.bySource,
      prevSnapshot: saveSnapshot(env.id, r.toName, curYaml),
      newSnapshot: saveSnapshot(env.id, name, published),
      rollbackOf: r.id,
      diff: releaseDiff(curYaml, published)
    });
    // Markér den rullede release — i org'en, så en anden pc ser det samme.
    // Næste klik går så én forfremmelse længere tilbage.
    await mutateRelease(env, r.baseName, r.flowType, r.id, x => { x.rolledBackBy = rb.id; x.rolledBackAt = rb.at; });

    await noteTargetRepublished(env, r.baseName, r.flowType, version, publishedAt, 'rollback');
    addLog('SUCCESS', `Rollback: "${r.toName}" in ${env.name} is back on the content of v${r.prevVersion || '?'}` +
      (name !== r.toName ? ` as "${name}"` : '') + ` (now v${version || '?'})`, env.name, 'ROLLBACK');

    // Et modul der rulles tilbage, er lige så meget en ændring som et der
    // forfremmes — de flows der bruger det skal også publiceres igen.
    let dependents = [];
    if (r.flowType === 'COMMONMODULE') {
      try { dependents = await dependentsOf(env, name); } catch (_) {}
    }
    res.json({ ok: true, name, version, releaseRef: releaseRef(rb), dependents, contentFrom: kilde });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Rollback of "${r.toName}" in ${env.name} failed: ${msg}`, env.name, 'ROLLBACK');
    res.status(500).json({ error: msg });
  }
});

// Publicerer et flow der allerede ligger i org'en — typisk efter en migrering
// med handlingen 'create', som lægger flowet ind som checked-in draft.
//
// Archy kan ikke bruges her: 'archy publish' kræver altid en YAML-fil og ville
// re-importere fra kilden. Genesys' eget endpoint publicerer den version der
// allerede ER i org'en, hvilket er præcis det man vil.
router.post('/api/flows/publish', async (req, res) => {
  const { customerId, flowId, flowName } = req.body;
  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  try {
    const { token, apiBase } = await getToken(customer);
    const H = { headers: { Authorization: `Bearer ${token}` } };

    const before = (await axios.get(`${apiBase}/api/v2/flows/${flowId}`, H)).data;
    const version = before.checkedInVersion?.name || before.checkedInVersion?.commitVersion;
    if (!version) return res.status(400).json({ error: `"${before.name}" har ingen checked-in version at publicere` });
    if (before.publishedVersion && before.publishedVersion.name === version) {
      return res.status(409).json({ error: 'already_published',
        message: `"${before.name}" er allerede publiceret som v${version}` });
    }

    await axios.post(`${apiBase}/api/v2/flows/actions/publish?flow=${flowId}&version=${encodeURIComponent(version)}`,
      {}, { headers: { ...H.headers, 'Content-Type': 'application/json' } });

    // Publicering er ASYNKRON: POST'en svarer 200 med det samme, mens Genesys
    // arbejder videre i baggrunden. Et øjeblikkeligt opslag ser derfor stadig
    // det gamle flow. Vi følger i stedet flowets currentOperation til den er
    // færdig — den bærer både status og eventuelle fejldetaljer.
    //
    // Et 200-svar er i øvrigt heller ikke i sig selv et bevis: endpointet
    // svarer også 200 for en version der ikke findes, uden at gøre noget.
    let after = null, op = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      after = (await axios.get(`${apiBase}/api/v2/flows/${flowId}`, H)).data;
      op = after.currentOperation || null;
      if (op?.actionName === 'PUBLISH' && op.complete) break;
      if (after.publishedVersion && after.publishedVersion.name !== before.publishedVersion?.name) break;
    }

    const nowPublished = after?.publishedVersion?.name || after?.publishedVersion?.commitVersion || null;
    const failed = op?.actionName === 'PUBLISH' && op.complete && op.actionStatus && op.actionStatus !== 'SUCCESS';

    if (failed) {
      // Forklaringen ligger i errorMessage/errorCode på selve operationen.
      // errorDetails[] er som regel tom, så den alene giver kun "FAILURE".
      const why = [
        op.errorMessage,
        op.errorCode ? `(${op.errorCode})` : null,
        (op.errorDetails || []).map(d => d.message || d.errorCode).filter(Boolean).join('; ') || null
      ].filter(Boolean).join(' ') || op.actionStatus;
      addLog('ERROR', `Publishing "${before.name}" failed: ${why}`, customer.name, 'MIGRATE');
      return res.status(500).json({ error: `Publicering fejlede: ${why}` });
    }
    if (!nowPublished) {
      addLog('WARN', `Publishing "${before.name}" is still running after 30 seconds — check in Architect`, customer.name, 'MIGRATE');
      return res.status(202).json({ pending: true,
        error: `Publiceringen af "${before.name}" er sat i gang men er ikke færdig endnu — tjek status i Architect` });
    }

    addLog('SUCCESS', `"${after.name}" published as v${nowPublished} in ${customer.name}`, customer.name, 'MIGRATE');
    res.json({ ok: true, name: after.name, version: nowPublished,
      publishedAt: after.publishedVersion?.dateCheckedIn || null });

  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Could not publish "${flowName || flowId}": ${msg}`, customer.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

// Nulpunkt: noterer hvordan mål-org'ens flows ser ud LIGE NU, så senere
// ændringer kan opdages — også for flows værktøjet aldrig har migreret.
//
// Bevidst kun API-opslag, ingen eksport: publiceringstidspunktet er det der
// skal bruges til at fange en ændring lavet direkte i mål-org'en, og det kan
// hentes for alle flows i ét hug. En indholds-hash ville kræve en Archy-eksport
// pr. flow — 84 flows ville tage over 20 minutter.
router.post('/api/flows/baseline', async (req, res) => {
  const { sourceId, targetId } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!target) return res.status(404).json({ error: 'Customer not found' });

  try {
    const [targetOrgId, sourceOrgId] = await Promise.all([
      getOrgId(target), source ? getOrgId(source) : Promise.resolve(null)
    ]);
    const { token, apiBase } = await getToken(target);
    let all = [], page = 1;
    while (true) {
      const r = await axios.get(`${apiBase}/api/v2/flows`, {
        headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 100, pageNumber: page }
      });
      const e = r.data.entities || [];
      all = all.concat(e);
      if (e.length < 100) break;
      page++;
    }

    const ts = new Date().toISOString();
    let recorded = 0, skipped = 0;
    for (const f of all) {
      const existing = findManifestEntry(loadManifest(), {
        targetOrgId, targetId, flowName: f.name, flowType: f.type });
      // En rigtig migrering må ikke overskrives af et nulpunkt
      if (existing && existing.kind !== 'baseline') { skipped++; continue; }
      recordManifest({
        ts, kind: 'baseline',
        sourceId: source?.id || null, sourceOrgId, sourceName: source?.name || null,
        targetId, targetOrgId, targetName: target.name,
        flowName: f.name, flowType: f.type,
        targetVersion: f.publishedVersion?.name || f.checkedInVersion?.name || null,
        targetPublishedAt: f.publishedVersion?.dateCheckedIn || f.publishedVersion?.dateCreated || null,
        targetActive: !!f.active
      });
      recorded++;
    }

    // Har org'en manifesttabellen, skrives nulpunktet også derind — så kender
    // den sit eget indhold, og afvigelses-signalet gælder alle flows, ikke kun
    // dem værktøjet selv har flyttet. Én skrivning pr. flow, så det tager tid.
    let toOrg = 0, orgErr = null;
    try {
      if (await readOrgManifest(target)) {
        for (const f of all) {
          try {
            await writeOrgManifestRow(target, f.name, f.type, {
              flowName: f.name, kind: 'baseline',
              version: f.publishedVersion?.name || f.checkedInVersion?.name || null,
              publishedAt: f.publishedVersion?.dateCheckedIn || f.publishedVersion?.dateCreated || null
            });
            toOrg++;
          } catch (e) { orgErr = describeApiError(e); break; }
        }
      }
    } catch (e) { orgErr = describeApiError(e); }

    addLog('SUCCESS', `Baseline set for ${target.name}: ${recorded} flows recorded` +
      (skipped ? `, ${skipped} skipped (already migrated with this tool)` : '') +
      (toOrg ? `, ${toOrg} written to the org manifest table` : '') +
      (orgErr ? ` — the manifest table failed: ${orgErr}` : ''), target.name, 'MIGRATE');
    res.json({ ok: true, recorded, skipped, total: all.length, targetOrgId, toOrg, orgError: orgErr });

  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Hvilke flows findes hos flere kunder, og med hvilke versioner?
// Kun API-opslag — ét kald pr. kunde — så oversigten er hurtig. Indholdet
// sammenlignes først når man beder om det, for det kræver en eksport pr. org.
router.get('/api/flows/cross-customer', async (req, res) => {
  const customers = loadCustomers();
  const byFlow = new Map();      // navn|type -> [{customer, version, ...}]
  const problems = [];

  for (const c of customers) {
    // Demo-miljøer har ingen credentials og region "demo". Uden denne gren
    // forsøgte siden at logge ind på login.demo og fyldte listen med
    // "getaddrinfo ENOTFOUND login.demo" — én linje pr. demo-miljø.
    if (isDemo(c)) {
      const soeskende = customers.filter(x => orgKeyOf(x) === orgKeyOf(c));
      for (const f of demoFlowsFor(c)) {
        if (!belongsToEnv(f.name, c, soeskende)) continue;
        const key = `${baseFlowName(stripEnvPrefix(f.name, c))}|${f.type}`;
        if (!byFlow.has(key)) byFlow.set(key, []);
        byFlow.get(key).push({
          customerId: c.id, customerName: c.name,
          flowId: `${c.id}:${f.name}`, flowName: f.name,
          publishedVersion: f.published || null, checkedInVersion: null,
          publishedAt: f.publishedAt || null, active: true
        });
      }
      continue;
    }
    try {
      const { token, apiBase } = await getToken(c);
      let page = 1;
      while (true) {
        const r = await axios.get(`${apiBase}/api/v2/flows`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { pageSize: 100, pageNumber: page, includeDraft: true }
        });
        const e = r.data.entities || [];
        for (const f of e) {
          // Samme nøgle som pipelinen: grundnavnet uden miljøpræfiks, så
          // "DEV_Ordreflow" og "Ordreflow" tæller som det samme flow.
          const key = `${baseFlowName(stripEnvPrefix(f.name, c))}|${f.type}`;
          if (!byFlow.has(key)) byFlow.set(key, []);
          byFlow.get(key).push({
            customerId: c.id, customerName: c.name,
            flowId: f.id, flowName: f.name,
            publishedVersion: f.publishedVersion?.name || f.publishedVersion?.commitVersion || null,
            checkedInVersion: f.checkedInVersion?.name || f.checkedInVersion?.commitVersion || null,
            publishedAt: f.publishedVersion?.dateCheckedIn || f.publishedVersion?.dateCreated || null,
            active: !!f.active
          });
        }
        if (e.length < 100) break;
        page++;
      }
    } catch (e) {
      problems.push({ customer: c.name, error: describeApiError(e) });
    }
  }

  // Kun de flows der optræder hos mere end én kunde
  const rows = [];
  for (const [key, list] of byFlow) {
    if (new Set(list.map(x => x.customerId)).size < 2) continue;
    const [flowName, flowType] = key.split('|');
    const versions = new Set(list.map(x => x.publishedVersion || x.checkedInVersion || '?'));
    rows.push({ flowName, flowType, orgs: list, sameVersion: versions.size === 1 });
  }
  rows.sort((a, b) => a.flowName.localeCompare(b.flowName));

  res.json({ ok: true, customers: customers.map(c => ({ id: c.id, name: c.name })), rows, problems });
});

module.exports = { router };
