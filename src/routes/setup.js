// Ruter: opsætningen i org'en (find, overtag, tilføj, synkronisér).

const express = require('express');
const { addLog } = require('../lib/log');
const { loadCustomers, saveCustomers } = require('../lib/customers');
const { STAGES } = require('../lib/conventions');
const { GUID, envFieldError } = require('../lib/fields');
const { describeApiError } = require('../lib/helpers');
const { tenantOf, stageOf, prefixOf, orgKeyOf, isDemo } = require('../lib/environments');
const { tokenStore } = require('../lib/sessions');
const { _mfTableCache, _whoCache } = require('../lib/token');
const { prefixClash } = require('../lib/guards');
const { prodSettingsBlock, prodWriteBlock, PROD_GUARDED_FIELDS } = require('../lib/prod-rights');
const { getOrgId, manifestTableName, createOrgManifestTable, readTableRow } = require('../lib/manifest');
const { afterEnvChange, masked, SETUP_KEY, setupInBackground, ensurePipelineIdsSaved,
  writeSetupRow, pipelinePeers, isSetupRow, setupChanges, applyOrgSetup, patchEnv, adoptStages,
  commitOrgSetup, readSetupRow, syncSetup, discoveryResult, orgManifestTables } = require('../lib/setup');

const router = express.Router();

router.post('/api/setup/discover', async (req, res) => {
  const env = loadCustomers().find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(env)) return res.json({ ok: true, demo: true, cards: [], elsewhere: [] });
  try {
    const tabeller = await orgManifestTables(env);
    for (const t of tabeller) {
      try { const r = await readTableRow(env, t.id, SETUP_KEY); t.setup = isSetupRow(r) ? r : null; }
      catch (_) { t.setup = null; }
    }
    const orgId = tokenStore[env.id]?.orgId || await getOrgId(env);
    // Scanningen ser hvilke præfikser org'en bruger. De holdes ude af et
    // miljø uden præfiks, også hvis søskendene ikke er tilføjet her.
    const taget = tabeller.map(t => t.prefix).filter(p => p && p !== prefixOf(env)).sort();
    patchEnv(env.id, { takenPrefixes: taget });
    addLog('INFO', `Discovery in ${env.name}'s org: ${tabeller.length} ArchyGUI table(s)` +
      (tabeller.length ? ` (${tabeller.map(t => t.name).join(', ')})` : ''), env.name, 'MANIFEST');
    res.json({ ok: true, orgId, orgName: tokenStore[env.id]?.orgName || '',
               ...discoveryResult(env, loadCustomers(), orgId, tabeller) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Brugerens valg efter opdagelsen:
//   use      — miljøet ER det miljø tabellen beskriver. Skriver intet.
//   template — et nyt miljø i org'en, med en fundet opsætning som skabelon
//   pipeline — et nyt miljø og en ny pipeline (ingen tabel fundet)
//   loose    — kun import/eksport: intet trin, ingen tabel, intet i org'en
router.post('/api/setup/adopt', async (req, res) => {
  const tr = v => String(v ?? '').trim();
  const all = loadCustomers();
  const env = all.find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(env)) return res.status(400).json({ error: 'Demo-miljøer har ingen org.' });
  const mode = tr(req.body.mode), f = req.body.fields || {};
  const andre = all.filter(c => c.id !== env.id);

  if (mode === 'loose') {
    const ud = patchEnv(env.id, { stage: '', setupPending: false });
    afterEnvChange(env, ud, 'environment set to import/export only');
    addLog('INFO', `${env.name} set to import/export only — nothing is written to its org`, env.name, 'MANIFEST');
    return res.json({ ok: true, env: masked(ud) });
  }
  if (!['use', 'template', 'pipeline'].includes(mode)) return res.status(400).json({ error: `Ukendt valg "${mode}"` });
  // Et miljø der allerede er koblet til en tabel, gøres ikke om til et andet:
  // det ville omdøbe det og flytte det til et andet trin. Vil man have flere
  // miljøer i org'en, tilføjes de (add-card), og vil man bygge et nyt, opretter
  // man et nyt miljø først.
  if (stageOf(env) && env.setupAt)
    return res.status(400).json({ error: `"${env.name}" er allerede koblet til sin tabel. Brug «Tilføj som nyt miljø» for at få et af de andre miljøer på denne pc.` });

  // Tabellerne læses igen her — klienten vælger kun HVILKEN.
  let tabeller;
  try { tabeller = await orgManifestTables(env); }
  catch (e) { return res.status(500).json({ error: describeApiError(e) }); }
  const orgPrefikser = tabeller.map(t => t.prefix);
  const orgId = tokenStore[env.id]?.orgId || env.orgId || null;
  const laesSetup = async t => { try { const r = await readTableRow(env, t.id, SETUP_KEY); return isSetupRow(r) ? r : null; } catch (_) { return null; } };

  let ud, applied = [], stagesAdded = [], skriv = false;
  if (mode === 'use') {
    const t = tabeller.find(x => x.id === req.body.tableId);
    if (!t) return res.status(404).json({ error: 'Tabellen findes ikke længere i org\'en — kør Tjek forbindelse igen.' });
    const row = await laesSetup(t);
    if (row && row.env.orgId && orgId && row.env.orgId !== orgId)
      return res.status(400).json({ error: `Tabellen beskriver et miljø i en anden org (${row.env.orgId}). Den er ikke taget i brug.` });
    ud = { ...env, prefix: t.prefix };
    if (row) {
      stagesAdded = adoptStages(row.stages);
      // Et bevidst valg af org'ens miljø: alle delte felter tages, også trinnet.
      const r = applyOrgSetup({ ...ud, stage: '' }, row, all);
      if (r.held.length) return res.status(400).json({ error: `Opsætningen kan ikke tages i brug: ${r.held.map(h => h.error || `${h.field} "${h.org}"`).join('; ')}` });
      ud = { ...r.env };
      applied = r.applied;
      ud.setupAt = row.at || null;
      ud.setupPending = false;
    } else {
      // En tabel fra før opsætningsrækken: trinnet kan ikke gættes — en tabel
      // uden præfiks kan være både UAT og prod. Brugeren vælger.
      const stage = tr(f.stage).toLowerCase();
      if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Tabellen har ingen opsætning endnu — vælg hvilket trin miljøet er.' });
      ud = { ...ud, stage, tenant: tr(f.tenant) || env.tenant || '', group: tr(f.group) || env.group || '', setupPending: true };
      skriv = true;
    }
  } else {
    const stage = tr(f.stage).toLowerCase();
    if (!STAGES.includes(stage)) return res.status(400).json({ error: `Vælg et trin: ${STAGES.join(', ')}` });
    const prefix = tr(f.prefix);
    if (orgPrefikser.includes(prefix))
      return res.status(400).json({ error: prefix ? `Præfikset "${prefix}" er allerede i brug i denne org.` : 'Der findes allerede et miljø uden præfiks i denne org — giv det nye et præfiks (fx UAT_).' });
    ud = { ...env, stage, prefix, name: tr(f.name) || env.name,
           tenant: tr(f.tenant) || env.tenant || '', group: tr(f.group) || env.group || '' };
    // undefined, ikke delete: commitOrgSetup fletter, og et slettet felt ville
    // bare komme igen fra den gemte post. JSON dropper undefined.
    ud.pipelineId = undefined;
    if (mode === 'template') {
      const t = tabeller.find(x => x.id === req.body.tableId);
      if (!t) return res.status(404).json({ error: 'Skabelonen findes ikke længere i org\'en — kør Tjek forbindelse igen.' });
      const row = await laesSetup(t);
      if (row) {
        const e = row.env;
        ud.tenant = tr(f.tenant) || e.tenant || ud.tenant;
        ud.group  = tr(f.group)  || e.group  || ud.group;
        ud.orgLabel = e.orgLabel || ud.orgLabel || '';
        // Deploy-kravene hører til prod; divisionen og farven er miljøets egne.
        if (stage === 'prod') { ud.deployPermission = e.deployPermission || ''; ud.deployGroup = e.deployGroup || ''; }
        if (row.pipelineId) ud.pipelineId = row.pipelineId;
        stagesAdded = adoptStages(row.stages);
      }
    }
    skriv = true;
  }
  ud.takenPrefixes = orgPrefikser.filter(p => p && p !== prefixOf(ud)).sort();

  const changed = {};
  for (const k of ['name', 'tenant', 'group', 'prefix', 'orgLabel', 'color', 'deployPermission', 'deployGroup'])
    if (String(env[k] ?? '') !== String(ud[k] ?? '')) changed[k] = ud[k];
  const fejl = envFieldError(changed, andre) || prefixClash(ud, all.map(c => c.id === env.id ? ud : c));
  if (fejl) return res.status(400).json({ error: fejl });

  const gemt = commitOrgSetup(env, ud);
  ensurePipelineIdsSaved();
  delete _mfTableCache[env.id];
  addLog('INFO', `${gemt.name} ${mode === 'use' ? 'linked to' : 'created next to'} the ArchyGUI table${mode === 'use' ? ' ' + manifestTableName(gemt) : 's'} in its org` +
    (applied.length ? ` — taken from the org: ${applied.map(a => a.field).join(', ')}` : ''), gemt.name, 'MANIFEST');

  let tableCreated = false, blocked = null, writeError = null;
  if (mode !== 'use') {
    // Den nye tabel er en skrivning i org'en — i prod med samme login som alt andet.
    const nu = loadCustomers().find(c => c.id === env.id);
    const b = prodWriteBlock(nu, tokenStore[nu.id]);
    if (b) blocked = b;
    else {
      try {
        await createOrgManifestTable(nu);
        await writeSetupRow(loadCustomers().find(c => c.id === env.id), null);
        tableCreated = true;
      } catch (e) { writeError = describeApiError(e); addLog('ERROR', `Could not create the manifest table for ${nu.name}: ${writeError}`, nu.name, 'MANIFEST'); }
    }
  }
  const nu = loadCustomers().find(c => c.id === env.id);
  // Søskendene får miljøet på deres liste; en gammel tabel får sin række.
  setupInBackground(pipelinePeers(nu, loadCustomers()).map(c => c.id)
    .filter(id => skriv || id !== nu.id).filter(id => !(tableCreated && id === nu.id)), 'environment added from discovery');
  res.json({ ok: true, env: masked(nu), applied, stagesAdded, tableCreated,
             blocked: blocked ? blocked.code : null, blockedError: blocked ? blocked.error : null, error: writeError });
});

// Tilføjer et miljø fra pipelinens søskendeliste — typisk prod i en anden org.
// Org-id'et sættes med det samme, så login'et afvises hvis man vælger en
// anden org på Genesys' side: sådan tjekkes det at listen taler sandt.
router.post('/api/setup/add-sibling', (req, res) => {
  const tr = v => String(v ?? '').trim();
  const all = loadCustomers();
  const fra = all.find(c => c.id === req.body?.fromEnvId);
  if (!fra) return res.status(404).json({ error: 'Ukendt miljø' });
  const s = req.body.sibling || {};
  const env = {
    id: Date.now().toString(), name: tr(req.body.name || s.name), clientId: tr(req.body.clientId || s.clientId),
    clientSecret: '', region: tr(s.region), authType: 'oauth',
    tenant: tr(s.tenant) || fra.tenant || '', group: tr(s.group) || fra.group || '',
    stage: tr(s.stage).toLowerCase(), prefix: tr(s.prefix), orgLabel: tr(s.orgLabel), color: '',
    division: '', deployPermission: '', deployGroup: '',
    pipelineId: tr(s.pipelineId) || fra.pipelineId || undefined
  };
  if (!env.name || !env.clientId) return res.status(400).json({ error: 'Navn og Client ID skal udfyldes.' });
  if (!STAGES.includes(env.stage)) return res.status(400).json({ error: `Ukendt trin "${s.stage}" — tilføj det under Kunder → Trin først.` });
  const fejl = envFieldError({ name: env.name, clientId: env.clientId, region: env.region, tenant: env.tenant,
                               group: env.group, prefix: env.prefix, orgLabel: env.orgLabel }, all);
  if (fejl) return res.status(400).json({ error: fejl });
  if (s.orgId) {
    if (!GUID.test(String(s.orgId))) return res.status(400).json({ error: 'Org-id\'et i søskendelisten er ikke gyldigt.' });
    env.orgId = String(s.orgId);
    const ejer = all.find(c => c.orgId === env.orgId && !isDemo(c) && tenantOf(c) !== tenantOf(env));
    if (ejer) return res.status(400).json({ error: `Org'en hører til "${ejer.name}" hos en anden kunde på denne pc.` });
  }
  const clash = prefixClash(env, all);
  if (clash) return res.status(400).json({ error: clash });
  all.push(env);
  saveCustomers(all);
  addLog('INFO', `Environment added from the pipeline's sibling list: ${env.name} (${env.stage}, region ${env.region}) — log in to confirm the org`, env.name, 'CUSTOMER');
  res.json({ ok: true, env: masked(env) });
});

// Tilføjer et miljø fra et kort i SAMME org som et ekstra miljø på denne pc —
// fx dev, når man starter med prod. Det er miljøet tabellen beskriver, så det
// kobles med det samme (setupAt), og der skrives intet i org'en. Login'et er
// PKCE i den samme org; en client credentials-klient kræver en secret, og den
// deles aldrig, så den må rettes bagefter under ⚙ Indstillinger.
router.post('/api/setup/add-card', async (req, res) => {
  const tr = v => String(v ?? '').trim();
  const all = loadCustomers();
  const fra = all.find(c => c.id === req.body?.fromEnvId);
  if (!fra) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(fra)) return res.status(400).json({ error: 'Demo-miljøer har ingen org.' });
  try {
    const tabeller = await orgManifestTables(fra);
    const t = tabeller.find(x => x.id === req.body.tableId);
    if (!t) return res.status(404).json({ error: 'Tabellen findes ikke længere i org\'en — kør Tjek forbindelse igen.' });
    const row = await readTableRow(fra, t.id, SETUP_KEY).catch(() => null);
    if (!isSetupRow(row) || !row.env.stage)
      return res.status(400).json({ error: 'Tabellen har ingen opsætning at bygge miljøet af. Brug «Brug dette» og vælg trinnet.' });
    const orgId = tokenStore[fra.id]?.orgId || fra.orgId || null;
    if (row.env.orgId && orgId && row.env.orgId !== orgId)
      return res.status(400).json({ error: `Tabellen beskriver et miljø i en anden org (${row.env.orgId}).` });
    if (all.some(c => c.id !== fra.id && !isDemo(c) && stageOf(c) && prefixOf(c) === t.prefix &&
                      (orgId && c.orgId ? c.orgId === orgId : orgKeyOf(c) === orgKeyOf(fra))))
      return res.status(400).json({ error: 'Miljøet findes allerede på denne pc.' });
    const clientId = tr(req.body.clientId) || (fra.authType === 'oauth' ? fra.clientId : '');
    const e = row.env;
    const env = {
      id: Date.now().toString(), name: tr(e.name), clientId, clientSecret: '', region: tr(e.region) || fra.region,
      authType: 'oauth', tenant: tr(e.tenant) || fra.tenant || '', group: tr(e.group) || fra.group || '',
      stage: tr(e.stage).toLowerCase(), prefix: t.prefix, orgLabel: tr(e.orgLabel), color: tr(e.color),
      division: tr(e.division), deployPermission: tr(e.deployPermission), deployGroup: tr(e.deployGroup),
      orgId: orgId || undefined, setupAt: row.at || null, setupPending: false,
      takenPrefixes: tabeller.map(x => x.prefix).filter(p => p && p !== t.prefix).sort(),
      pipelineId: (typeof row.pipelineId === 'string' && row.pipelineId) || fra.pipelineId || undefined
    };
    if (!env.name || !env.clientId)
      return res.status(400).json({ error: 'Client ID til en PKCE-klient i org\'en skal udfyldes.' });
    if (!STAGES.includes(env.stage)) adoptStages(row.stages);
    if (!STAGES.includes(env.stage)) return res.status(400).json({ error: `Ukendt trin "${e.stage}" — tilføj det under Kunder → Trin først.` });
    const fejl = envFieldError({ name: env.name, clientId: env.clientId, region: env.region, tenant: env.tenant,
                                 group: env.group, prefix: env.prefix, orgLabel: env.orgLabel }, all);
    if (fejl) return res.status(400).json({ error: fejl });
    const clash = prefixClash(env, all);
    if (clash) return res.status(400).json({ error: clash });
    // Listen læses igen lige før den gemmes: adoptStages kan have ændret indstillinger.
    const nu = loadCustomers();
    nu.push(env);
    saveCustomers(nu);
    addLog('INFO', `Environment added from the ArchyGUI table ${t.name}: ${env.name} (${env.stage}) — log in to confirm`, env.name, 'CUSTOMER');
    res.json({ ok: true, env: masked(env) });
  } catch (err) {
    res.status(500).json({ error: describeApiError(err) });
  }
});

router.post('/api/setup/sync', async (req, res) => {
  try { res.json(await syncSetup(String(req.body?.envId || ''))); }
  catch (e) { res.status(500).json({ error: describeApiError(e) }); }
});

// Uenighed mellem pc og org: brugeren vælger hvem der har ret.
//   org   — org'ens række tages. Prod-vagtens felter kun med prod-login.
//   local — denne pc's opsætning skrives til org'en.
router.post('/api/setup/resolve', async (req, res) => {
  const env = loadCustomers().find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Ukendt miljø' });
  const choice = String(req.body.choice || '');
  if (!['org', 'local'].includes(choice)) return res.status(400).json({ error: `Ukendt valg "${choice}"` });
  try {
    const row = await readSetupRow(env);
    if (row === undefined) return res.status(400).json({ error: 'Miljøet har ingen manifest-tabel.' });
    if (choice === 'local' || !row) {
      patchEnv(env.id, { setupAt: row ? row.at || null : null, setupPending: true });
      const w = await writeSetupRow(loadCustomers().find(c => c.id === env.id), row);
      if (!w.ok) return res.status(w.reason === 'prod-login' || w.reason === 'prod-rights' ? 403 : 500)
        .json({ error: prodWriteBlock(env, tokenStore[env.id])?.error || w.error || w.reason });
      addLog('INFO', `Setup conflict for ${env.name} resolved: this PC's setup written to the org`, env.name, 'MANIFEST');
      return res.json({ ok: true, wrote: true });
    }
    const { apply, held } = setupChanges(env, row);
    // Her vælger brugeren org'en bevidst — også det der ellers holdes tilbage.
    const alt = { ...apply };
    for (const h of held) alt[h.field] = h.org;
    const laast = prodSettingsBlock(env, alt, tokenStore[env.id]);
    if (laast) return res.status(403).json(laast);
    if (held.some(h => h.reason === 'unknown-stage')) adoptStages(row.stages);
    if (alt.stage && !STAGES.includes(alt.stage)) return res.status(400).json({ error: `Ukendt trin "${alt.stage}" — tilføj det under Kunder → Trin først.` });
    const fejl = envFieldError(alt, loadCustomers().filter(c => c.id !== env.id));
    if (fejl) return res.status(400).json({ error: fejl });
    const ud = { ...env, ...alt, setupAt: row.at || null, setupPending: false,
                 pipelineId: (typeof row.pipelineId === 'string' && row.pipelineId) || env.pipelineId };
    const clash = prefixClash(ud, loadCustomers().map(c => c.id === env.id ? ud : c));
    if (clash) return res.status(400).json({ error: clash });
    const gemt = commitOrgSetup(env, ud);
    if (Object.keys(alt).some(k => PROD_GUARDED_FIELDS.includes(k))) { delete tokenStore[env.id]; delete _whoCache[env.id]; }
    addLog('INFO', `Setup conflict for ${env.name} resolved: the org's setup taken (${Object.keys(alt).join(', ') || 'no field changes'})`, gemt.name, 'MANIFEST');
    afterEnvChange(env, gemt, 'setup taken from the org');
    res.json({ ok: true, applied: Object.keys(alt) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

module.exports = { router };
