// Hvem bruger et flow: afhængige flows, common modules og function data actions.

const axios = require('axios');
const { addLog } = require('./log');
const { loadCustomers } = require('./customers');
const { normType } = require('./conventions');
const { describeApiError } = require('./helpers');
const { orgKeyOf, isDemo, belongsToEnv } = require('./environments');
const { versionLabel } = require('./names');
const { getToken } = require('./token');
const { loadManifest, recordManifest, findManifestEntry } = require('./manifest-file');
const { getOrgId, orgManifestKey, readOrgManifest, writeOrgManifestRow } = require('./manifest');
const { demoDependentsOf } = require('./demo');
const { FUNCTION_INTEGRATION } = require('./dependencies');
const { listIntegrations, listDataActions } = require('./data-action-refs');

// Efter en rollback eller genpublicering står målet på en højere udgave end
// den manifestet noterede ved forfremmelsen. Uden denne opdatering ville tavlen
// melde "ændret uden om pipelinen" om noget vi selv lige har gjort.
async function noteTargetRepublished(env, baseName, flowType, version, publishedAt, kind) {
  try {
    const rows = await readOrgManifest(env);
    const key = orgManifestKey(baseName, flowType);
    const cur = (rows && rows[key]) || null;
    if (cur || isDemo(env)) {
      await writeOrgManifestRow(env, baseName, flowType, {
        ...(cur || {}), version, publishedAt, kind
      });
    }
  } catch (e) {
    addLog('WARN', `Could not update the manifest in ${env.name}: ${describeApiError(e)}`, env.name, 'MANIFEST');
  }
  const all = loadManifest();
  const hit = findManifestEntry(all, { targetOrgId: null, targetId: env.id, flowName: baseName, flowType });
  if (hit) recordManifest({ ...hit, flowName: hit.flowName, targetVersion: version, targetPublishedAt: publishedAt });
}

// Alle flows i en org, med kladdeoplysninger.
async function listAllFlows(customer) {
  const { token, apiBase } = await getToken(customer);
  const acc = [];
  for (let page = 1; ; page++) {
    const r = await axios.get(`${apiBase}/api/v2/flows`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 100, pageNumber: page, includeDraft: true }
    });
    const e = r.data.entities || [];
    acc.push(...e);
    if (e.length < 100) break;
  }
  return acc;
}

// Har flowet noget der er nyere end den publicerede udgave? Så vil en
// genpublicering af den publicerede udgave erstatte det — og det skal man vide.
function flowHasDraft(f) {
  const pub = versionLabel(f.publishedVersion);
  const saved = versionLabel(f.savedVersion);
  const checked = versionLabel(f.checkedInVersion);
  return !!((saved && saved !== pub) || (checked && checked !== pub));
}

// De flows i et miljø der bruger et common module — også gennem et andet
// modul: bruger modul B modul A, og flow C bruger B, skal både B og C
// publiceres igen når A ændres. Moduler står først i listen, så de er
// publiceret før de flows der kalder dem.
async function dependentsOf(env, moduleName) {
  const seen = new Set([moduleName]);
  const out = [];
  const walk = async (name, depth) => {
    if (depth > 5) return;
    const direkte = isDemo(env) ? demoDependentsOf(env, name) : await realDirectDependents(env, name);
    for (const f of direkte) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      out.push({ ...f, via: name === moduleName ? null : name });
      if (normType(f.type) === 'COMMONMODULE') await walk(f.name, depth + 1);
    }
  };
  await walk(moduleName, 0);
  return [
    ...out.filter(f => normType(f.type) === 'COMMONMODULE'),
    ...out.filter(f => normType(f.type) !== 'COMMONMODULE')
  ];
}

// Genesys' egen afhængighedssporing. Den bygges asynkront efter en
// publicering, men de flows der bruger modulet har brugt det længe — de står
// der allerede. Kun flows der hører til MILJØET tages med: i en præfikset org
// bruger TEST_-flowene TEST_-modulet, og dev's flows er ikke vores sag her.
async function consumerIds(env, moduleId, objectType = 'COMMONMODULEFLOW') {
  const { token, apiBase } = await getToken(env);
  const ids = new Set();
  for (let page = 1; page < 50; page++) {
    const r = await axios.get(`${apiBase}/api/v2/architect/dependencytracking/consumingresources`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { id: moduleId, objectType, pageSize: 100, pageNumber: page }
    });
    const e = r.data.entities || [];
    for (const x of e) ids.add(x.id);
    if (e.length < 100) break;
  }
  return ids;
}

// Et flow binder sig til den udgave af modulet der fandtes da FLOWET blev
// publiceret. Afhængighedssporingen siger ikke hvilken udgave det er — men er
// flowet publiceret før modulet sidst blev det, kører det på en ældre.
const publishedAtMs = f => Date.parse(f?.publishedVersion?.datePublished || '') || null;
function isBehindModule(flow, mod) {
  const a = publishedAtMs(flow), b = publishedAtMs(mod);
  return a !== null && b !== null && a < b;
}

async function realDirectDependents(env, moduleName) {
  const flows = await listAllFlows(env);
  const mod = flows.find(f => f.name === moduleName && normType(f.type) === 'COMMONMODULE');
  if (!mod) throw new Error(`Common module "${moduleName}" was not found in ${env.name}`);
  const ids = await consumerIds(env, mod.id);
  const siblings = loadCustomers().filter(c => orgKeyOf(c) === orgKeyOf(env));
  return flows
    .filter(f => ids.has(f.id) && f.id !== mod.id && belongsToEnv(f.name, env, siblings))
    .map(f => ({ name: f.name, type: f.type, published: versionLabel(f.publishedVersion),
                 hasDraft: flowHasDraft(f), unpublished: !f.publishedVersion,
                 behind: isBehindModule(f, mod) }));
}

// Alle common modules i miljøet der er publiceret EFTER mindst ét af de flows
// der bruger dem. Det er dét man ikke kan se i Architect: modulet er rettet og
// publiceret, men flowene kører videre på den gamle udgave.
async function staleModules(env) {
  if (isDemo(env)) return [];
  await getOrgId(env);
  const flows = await listAllFlows(env);
  const siblings = loadCustomers().filter(c => orgKeyOf(c) === orgKeyOf(env));
  const mine = flows.filter(f => belongsToEnv(f.name, env, siblings));
  const byId = new Map(mine.map(f => [f.id, f]));
  const modules = mine.filter(f => normType(f.type) === 'COMMONMODULE' && f.publishedVersion);
  const out = [];
  // Ét opslag pr. modul, fire ad gangen — en org med 30 moduler skal ikke
  // tage et halvt minut.
  for (let i = 0; i < modules.length; i += 4) {
    await Promise.all(modules.slice(i, i + 4).map(async m => {
      const ids = await consumerIds(env, m.id);
      const behind = [...ids].map(id => byId.get(id))
        .filter(f => f && f.id !== m.id && isBehindModule(f, m))
        .map(f => ({ name: f.name, type: f.type, publishedAt: f.publishedVersion.datePublished,
                     hasDraft: flowHasDraft(f) }));
      if (behind.length)
        out.push({ module: m.name, version: versionLabel(m.publishedVersion),
                   publishedAt: m.publishedVersion.datePublished, behind });
    }));
  }
  return out.sort((a, b) => a.module.localeCompare(b.module));
}

// Hvilke flows bruger en Function Data Action. Genesys' afhængighedssporing kan
// svare på det for én action ad gangen, og der er få FDA'er, så det er billigt.
// Ren sammenlægning, så den kan prøves uden en org: actionNames er FDA'ernes
// navne, idsByAction hvilke flow-id'er hver af dem bruges i.
function groupFdaConsumers(actionNames, idsByAction) {
  const flows = {};
  actionNames.forEach((name, i) => {
    for (const id of (idsByAction[i] || [])) {
      if (!flows[id]) flows[id] = [];
      if (!flows[id].includes(name)) flows[id].push(name);
    }
  });
  for (const id of Object.keys(flows)) flows[id].sort((a, b) => a.localeCompare(b));
  return flows;
}

async function fdaUsage(env) {
  if (isDemo(env)) return { names: [], flows: {} };
  const { token, apiBase } = await getToken(env);
  const fdaInts = new Set((await listIntegrations(env)).filter(i => i.type === FUNCTION_INTEGRATION).map(i => i.id));
  if (!fdaInts.size) return { names: [], flows: {} };
  const actions = (await listDataActions(token, apiBase)).filter(a => fdaInts.has(a.integrationId));
  const idsByAction = [];
  // Fire ad gangen, som ved common modules.
  for (let i = 0; i < actions.length; i += 4) {
    const part = await Promise.all(actions.slice(i, i + 4).map(a => consumerIds(env, a.id, 'DATAACTION')));
    part.forEach((ids, k) => { idsByAction[i + k] = [...ids]; });
  }
  const names = actions.map(a => a.name);
  return { names: [...new Set(names)], flows: groupFdaConsumers(names, idsByAction) };
}

module.exports = { listAllFlows, noteTargetRepublished, flowHasDraft, dependentsOf, isBehindModule,
  staleModules, groupFdaConsumers, fdaUsage };
