// Ruter: guidet præfiks-omdøbning.

const express = require('express');
const axios = require('axios');
const { addLog } = require('../lib/log');
const { loadCustomers, saveCustomers } = require('../lib/customers');
const { normType } = require('../lib/conventions');
const { envFieldError } = require('../lib/fields');
const { describeApiError } = require('../lib/helpers');
const { prefixOf, orgKeyOf, isDemo, belongsToEnv, stripEnvPrefix, withEnvPrefix } = require('../lib/environments');
const { getToken, _mfTableCache } = require('../lib/token');
const { listAllTables } = require('../lib/genesys');
const { prefixClash, prefixChangeImpact } = require('../lib/guards');
const { ORG_MANIFEST_BASE, manifestTableName } = require('../lib/manifest');
const { loadDemo, saveDemo, demoFlowKey, demoFlowsFor } = require('../lib/demo');
const { afterEnvChange } = require('../lib/setup');
const { renameFlowInYaml } = require('../lib/flow-yaml');
const { listAllFlows } = require('../lib/dependents');

const router = express.Router();

// ── Guidet præfiks-omdøbning ─────────────────────────────────────────────────
// Ændres præfikset, skal flows, datatabeller og manifest-tabellen i org'en have
// nye navne — ellers ligger "UAT_Betaling" tilbage og bliver sit eget flow på
// tavlen, og manifestet peger på en tabel der ikke længere hører til miljøet.
//
// Omdøbningen sker via API'et (PUT på flowets og tabellens id), ikke via Archy:
// Archy finder flows på navnet og ville lave et NYT flow ved siden af. Med
// API'et beholder flowet sit id, alle udgaver får det nye navn, og alt der
// peger på det med id — telefonnumre, andre flows, køer — virker videre.

// Ren plan: hvad skal hedde hvad, og hvad kolliderer. flows/tables er lister af
// { id, name, type? } fra org'en.
function prefixRenamePlan(env, newPrefix, flows, tables, all) {
  const efter = { ...env, prefix: String(newPrefix || '').trim() };
  const soeskende = e => all.map(c => c.id === env.id ? e : c).filter(c => orgKeyOf(c) === orgKeyOf(env));
  const foer = soeskende(env);
  const nytNavn = navn => withEnvPrefix(stripEnvPrefix(navn, env), efter);
  const erManifest = navn => String(navn).endsWith(ORG_MANIFEST_BASE);
  // Moduler og bots kaldes ved NAVN i eksporteret YAML. Det tager vores egen
  // omskrivning sig af ved næste forfremmelse, men eksterne værktøjer og
  // gemte YAML-filer der nævner dem, skal rettes i hånden.
  const kaldesVedNavn = type => ['COMMONMODULE', 'BOT', 'DIGITALBOT'].includes(normType(type));

  const planFlows = [];
  for (const f of flows) {
    if (!belongsToEnv(f.name, env, foer)) continue;
    const to = nytNavn(f.name);
    if (to === f.name) continue;
    const kollision = flows.find(x => x.id !== f.id && x.name === to && normType(x.type) === normType(f.type));
    planFlows.push({ id: f.id, type: f.type, from: f.name, to, conflict: !!kollision, calledByName: kaldesVedNavn(f.type) });
  }
  const planTables = [];
  for (const t of tables) {
    if (erManifest(t.name) || !belongsToEnv(t.name, env, foer)) continue;
    const to = nytNavn(t.name);
    if (to === t.name) continue;
    planTables.push({ id: t.id, from: t.name, to, conflict: tables.some(x => x.id !== t.id && x.name === to) });
  }
  const mFra = manifestTableName(env), mTil = manifestTableName(efter);
  const mTabel = tables.find(t => t.name === mFra);
  const manifest = mTabel && mFra !== mTil
    ? { id: mTabel.id, from: mFra, to: mTil, conflict: tables.some(x => x.name === mTil) }
    : null;
  return { oldPrefix: prefixOf(env), newPrefix: efter.prefix, flows: planFlows, tables: planTables, manifest };
}

async function prefixPlanFor(env, newPrefix) {
  const all = loadCustomers();
  const flows = isDemo(env) ? demoFlowsFor(env).map(f => ({ id: `${env.id}:${f.name}`, name: f.name, type: f.type }))
                            : await listAllFlows(env);
  const tables = isDemo(env) ? [] : await listAllTables(env);
  return prefixRenamePlan(env, newPrefix, flows, tables, all);
}

// Prøv præfikset af, før det gemmes: findes det i forvejen, eller er det ugyldigt?
function prefixChangeError(env, newPrefix, all) {
  const fejl = envFieldError({ prefix: newPrefix }, all.filter(c => c.id !== env.id));
  if (fejl) return fejl;
  return prefixClash({ ...env, prefix: newPrefix }, all);
}

router.post('/api/prefix/plan', async (req, res) => {
  const all = loadCustomers();
  const env = all.find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Not found' });
  const newPrefix = String(req.body.prefix || '').trim();
  const fejl = prefixChangeError(env, newPrefix, all);
  if (fejl) return res.status(400).json({ error: fejl });
  try {
    res.json({ ok: true, ...(await prefixPlanFor(env, newPrefix)) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Ét navn ændret i org'en. Hentes først, så PUT bærer resten af objektet
// uændret — et flow skal have sin type med, en tabel sit skema.
async function renameInOrg(env, kind, id, to) {
  const { token, apiBase } = await getToken(env);
  const H = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (kind === 'flow') {
    // Genesys kræver at flowet er tjekket ud af den der omdøber (409 "not
    // locked by client …"). Afprøvet mod Sabio DEV: checkout → PUT → revert.
    // Revert beholder det nye navn, kasserer den kladde checkout lavede og
    // frigiver låsen. Havde flowet en gemt kladde i forvejen, bruges unlock i
    // stedet — revert ville smide den kladde væk.
    const act = a => axios.post(`${apiBase}/api/v2/flows/actions/${a}`, null, { ...H, params: { flow: id } });
    const f = (await axios.get(`${apiBase}/api/v2/flows/${encodeURIComponent(id)}`, H)).data;
    if (f.lockedUser || f.lockedClient)
      throw new Error(`checked out by ${f.lockedUser?.name || f.lockedClient?.name || 'someone else'}`);
    const havdeKladde = !!f.savedVersion;
    await act('checkout');
    try {
      await axios.put(`${apiBase}/api/v2/flows/${encodeURIComponent(id)}`,
        { id: f.id, name: to, type: f.type, description: f.description || '', division: f.division }, H);
    } finally {
      try { await act(havdeKladde ? 'unlock' : 'revert'); }
      catch (_) { try { await act('unlock'); } catch (__) {} }
    }
  } else {
    const t = (await axios.get(`${apiBase}/api/v2/flows/datatables/${encodeURIComponent(id)}`,
      { ...H, params: { expand: 'schema' } })).data;
    await axios.put(`${apiBase}/api/v2/flows/datatables/${encodeURIComponent(id)}`, { ...t, name: to }, H);
  }
}

router.post('/api/prefix/apply', async (req, res) => {
  const all = loadCustomers();
  const env = all.find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Not found' });
  const newPrefix = String(req.body.prefix || '').trim();
  const fejl = prefixChangeError(env, newPrefix, all);
  if (fejl) return res.status(400).json({ error: fejl });

  // Planen regnes ud igen her — klienten vælger kun HVILKE punkter, aldrig
  // navnene. Kolliderende punkter springes altid over.
  let plan;
  try { plan = await prefixPlanFor(env, newPrefix); }
  catch (e) { return res.status(500).json({ error: describeApiError(e) }); }
  const valgteFlows = new Set(req.body.flowIds || []), valgteTabeller = new Set(req.body.tableIds || []);
  const opgaver = [
    ...plan.flows.filter(x => valgteFlows.has(x.id) && !x.conflict).map(x => ({ kind: 'flow', ...x })),
    ...plan.tables.filter(x => valgteTabeller.has(x.id) && !x.conflict).map(x => ({ kind: 'table', ...x })),
    ...(req.body.manifest && plan.manifest && !plan.manifest.conflict ? [{ kind: 'table', manifest: true, ...plan.manifest }] : [])
  ];

  addLog('INFO', `Prefix change for ${env.name}: "${plan.oldPrefix}" → "${newPrefix}" — renaming ${opgaver.length} item(s)`, env.name, 'CUSTOMER');
  const udfoert = [], resultater = [];
  let fejlet = null;
  for (const o of opgaver) {
    try {
      if (isDemo(env)) {
        const d = loadDemo();
        const f = (d.flows[demoFlowKey(env)] || []).find(x => x.name === o.from && x.type === o.type);
        if (!f) throw new Error('not found');
        f.name = o.to; f.content = renameFlowInYaml(f.content, o.to);
        saveDemo(d);
      } else {
        await renameInOrg(env, o.kind, o.id, o.to);
      }
      udfoert.push(o);
      resultater.push({ kind: o.kind, from: o.from, to: o.to, ok: true });
      addLog('SUCCESS', `Renamed ${o.kind} "${o.from}" → "${o.to}"`, env.name, 'CUSTOMER');
    } catch (e) {
      fejlet = { kind: o.kind, from: o.from, to: o.to, ok: false, error: describeApiError(e) };
      resultater.push(fejlet);
      addLog('ERROR', `Could not rename ${o.kind} "${o.from}": ${fejlet.error}`, env.name, 'CUSTOMER');
      break;
    }
  }

  // Fejlede én, rulles de andre tilbage — et halvt omdøbt miljø er værre end
  // et der slet ikke blev rørt. Præfikset ændres kun når alt gik igennem.
  if (fejlet) {
    for (const o of udfoert.reverse()) {
      try {
        if (isDemo(env)) {
          const d = loadDemo();
          const f = (d.flows[demoFlowKey(env)] || []).find(x => x.name === o.to && x.type === o.type);
          if (f) { f.name = o.from; f.content = renameFlowInYaml(f.content, o.from); saveDemo(d); }
        } else await renameInOrg(env, o.kind, o.id, o.from);
        addLog('INFO', `Rolled back ${o.kind} "${o.to}" → "${o.from}"`, env.name, 'CUSTOMER');
      } catch (e) {
        addLog('ERROR', `Rollback failed for ${o.kind} "${o.to}": ${describeApiError(e)} — rename it back by hand`, env.name, 'CUSTOMER');
        resultater.push({ kind: o.kind, from: o.to, to: o.from, ok: false, rollbackFailed: true, error: describeApiError(e) });
      }
    }
    return res.status(502).json({ ok: false, error: fejlet.error, failed: fejlet, results: resultater, rolledBack: true });
  }

  const kunder = loadCustomers();
  const i = kunder.findIndex(c => c.id === env.id);
  kunder[i] = { ...kunder[i], prefix: newPrefix };
  // Miljøer uden præfiks i samme org husker de præfikser org'en bruger. Det
  // gamle er væk nu, det nye er kommet til.
  for (const c of kunder)
    if (c.id !== env.id && !prefixOf(c) && orgKeyOf(c) === orgKeyOf(env) && Array.isArray(c.takenPrefixes))
      c.takenPrefixes = [...new Set([...c.takenPrefixes.filter(p => p !== plan.oldPrefix), newPrefix].filter(Boolean))].sort();
  saveCustomers(kunder);
  delete _mfTableCache[env.id];
  afterEnvChange(env, kunder[i], 'prefix changed');
  addLog('SUCCESS', `Prefix of ${env.name} is now "${newPrefix}" — ${udfoert.length} item(s) renamed`, env.name, 'CUSTOMER');
  res.json({ ok: true, prefix: newPrefix, results: resultater });
});

router.post('/api/customers/:id/prefix-check', async (req, res) => {
  const all = loadCustomers();
  const env = all.find(c => c.id === req.params.id);
  if (!env) return res.status(404).json({ error: 'Not found' });
  const newPrefix = String(req.body.prefix || '').trim();
  if (newPrefix === prefixOf(env)) return res.json({ ok: true, affected: [] });
  try {
    const flows = isDemo(env) ? demoFlowsFor(env) : await listAllFlows(env);
    const affected = prefixChangeImpact(env, newPrefix, flows, all);
    res.json({ ok: true, oldPrefix: prefixOf(env), newPrefix, count: affected.length, affected: affected.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

module.exports = { router, prefixRenamePlan };
