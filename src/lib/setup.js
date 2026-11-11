// Opsætningen i org'en: miljøets egen række i manifest-tabellen, og synkronisering.

const crypto = require('crypto');
const { saveSettings } = require('../config');
const { addLog } = require('./log');
const { loadCustomers, saveCustomers } = require('./customers');
const { STAGES, stageOrder, STAGE_NAME, stageListError, applyStages } = require('./conventions');
const { GUID, envFieldError } = require('./fields');
const { describeApiError, moveCustomerFolder } = require('./helpers');
const { tenantOf, groupOf, stageOf, prefixOf, orgKeyOf, isDemo, withEnvPrefix, sameGroup } = require('./environments');
const { tokenStore } = require('./sessions');
const { listAllTables } = require('./genesys');
const { prefixClash } = require('./guards');
const { prodWriteBlock, PROD_GUARDED_FIELDS } = require('./prod-rights');
const { whoAmI, ORG_MANIFEST_BASE, manifestTableName, readOrgManifestRow, putOrgManifestRow,
  writeOrgManifestRow } = require('./manifest');

// Skriver de to rækker en forfremmelse afstedkommer: én i kilden og én i målet.
// Fejler den ene, siges det højt i loggen — men migreringen rulles ikke tilbage,
// for flowet ER flyttet. Et manglende manifest er en mangel i bogføringen, ikke
// en grund til at påstå at flytningen ikke skete.
// flowName SKAL være grundnavnet uden miljøpræfiks. Rækkerne nøgles på det, og
// tavlen slår også op på det — ellers ville en kilde med præfiks skrive under
// én nøgle og blive læst under en anden.
async function recordOrgManifest(source, target, flowName, flowType, info) {
  const write = async (env, data, hvad) => {
    // Et løst miljø (intet trin) er ikke med i nogen pipeline. Dér skrives der
    // aldrig — kunden har ikke bedt om en ArchyGUI-tabel i sin org.
    if (!env || !stageOf(env)) return;
    try {
      const r = await writeOrgManifestRow(env, flowName, flowType, data);
      if (!r.ok && r.reason === 'no-table')
        addLog('WARN', `${env.name} has no manifest table — ${hvad} was not recorded. Create it from the Pipeline page.`, env.name, 'MANIFEST');
      // Første manifest-skrivning på et miljø fra før opsætningsrækken fandtes:
      // så skrives den også, i baggrunden.
      else if (r.ok && !env.setupAt) setupInBackground([env.id], 'first manifest write');
    } catch (e) {
      addLog('ERROR', `Could not write the manifest in ${env.name}: ${describeApiError(e)}`, env.name, 'MANIFEST');
    }
  };
  // Navnet i rækken er miljøets EGET navn på flowet — nøglen er grundnavnet.
  await write(target, {
    flowName: target ? withEnvPrefix(flowName, target) : flowName, version: info.targetVersion, publishedAt: info.targetPublishedAt,
    promotedFrom: source ? source.name : null, promotedAt: info.targetPublishedAt,
    sourceVersion: info.sourceVersion, hash: info.hash, kind: info.kind || 'migration'
  }, 'the target');
  // Et nulpunkt har ingen kilde — der er ikke flyttet noget, vi noterer blot
  // hvad org'en indeholder lige nu.
  if (!source) return;
  await write(source, {
    flowName: withEnvPrefix(flowName, source), version: info.sourceVersion, publishedAt: info.sourcePublishedAt || null,
    promotedTo: target.name, promotedAt: info.targetPublishedAt,
    hash: info.hash, kind: info.kind || 'migration'
  }, 'kilden');
}

// ── Opsætningen i org'en ─────────────────────────────────────────────────────
// customers.json ligger på én pc. En kollega på en anden pc vidste derfor intet
// om de miljøer der allerede var sat op — heller ikke når org'en havde dem.
//
// Hvert pipeline-miljø har sin manifest-tabel i org'en. I den står nu også én
// række der beskriver miljøet selv: navn, kunde, gruppe, trin, præfiks — og de
// andre miljøer i samme pipeline, også dem i andre orgs. Så kan en ny pc logge
// ind, finde tabellerne og bygge miljøerne op igen, og en slettet tabel kan
// genopbygges fra pc'en. Den lokale fil og org'en kan genskabe hinanden.
//
// Reglerne blev aftalt før koden:
//   · org'en vinder for de delte felter. En lokal rettelse skrives derfor
//     straks til org'en; lykkes det ikke, er miljøet "ikke synkroniseret", og
//     rettelsen bliver stående til den kan skrives
//   · rækken skrives automatisk — og i alle pipelinens orgs, også prod, men
//     kun med et login der må skrive dertil (prod-vagten gælder også her)
//   · et løst miljø (intet trin) får aldrig en tabel eller en række
//   · ingen hemmeligheder: hverken secret, token eller andet der giver adgang
const SETUP_KEY = 'ArchyGUI_Setup';
const SETUP_SCHEMA = 1;

// Felterne org'en vinder på. Præfikset står der ikke: det er dét tabellen blev
// fundet på, så det kan ikke være uenigt med sig selv.
const SETUP_SHARED = ['name', 'tenant', 'group', 'stage', 'orgLabel', 'color', 'division',
                      'deployPermission', 'deployGroup'];
// Felter de ANDRE miljøers rækker nævner. Ændres et af dem, skal søskendene
// have deres liste skrevet om.
const SETUP_SIBLING_FIELDS = [...SETUP_SHARED, 'prefix', 'region', 'clientId', 'authType', 'orgId', 'pipelineId'];

const isSetupRow = r => !!(r && r.kind === 'archygui-setup' && r.env && typeof r.env === 'object');

// Miljøerne i samme pipeline som env — env selv iberegnet. pipelineId er den
// faste nøgle; kunde og gruppe er fritekst og kan staves forskelligt på to pc'er.
function pipelinePeers(env, all) {
  if (!env) return [];
  if (!stageOf(env)) return [env];
  return all.filter(c => stageOf(c) && isDemo(c) === isDemo(env) &&
    (c.id === env.id || (env.pipelineId && c.pipelineId === env.pipelineId) || sameGroup(c, env)));
}

// Hvert pipeline-miljø får et pipelineId. Har et miljø i samme kunde og gruppe
// allerede et, arves det; ellers dannes et nyt. Ændrer listen på stedet og
// returnerer id'erne på de miljøer der fik et.
function ensurePipelineIds(all, nyId = () => crypto.randomUUID()) {
  const fik = [];
  for (const c of all) {
    if (!stageOf(c) || c.pipelineId) continue;
    const peer = all.find(x => x !== c && x.pipelineId && stageOf(x) && sameGroup(x, c));
    c.pipelineId = peer ? peer.pipelineId : nyId();
    fik.push(c.id);
  }
  return fik;
}
function ensurePipelineIdsSaved() {
  const all = loadCustomers();
  if (ensurePipelineIds(all).length) saveCustomers(all);
  return all;
}

// Præfikser org'en bruger ud over miljøets eget: dem fra søskende på denne pc
// i samme org, plus dem opdagelsen har set i org'en.
function takenPrefixesFor(env, all) {
  const set = new Set(env.takenPrefixes || []);
  for (const c of all)
    if (c.id !== env.id && orgKeyOf(c) === orgKeyOf(env) && prefixOf(c)) set.add(prefixOf(c));
  set.delete(prefixOf(env));
  set.delete('');
  return [...set].sort();
}

// Det en anden pc skal bruge for at tilføje miljøet — og ikke mere. Client
// ID'et er ikke hemmeligt, men kun en PKCE-klient kan bruges til at logge ind
// med. En client credentials-klient kræver en secret, og den deles aldrig.
function setupSibling(c) {
  return { name: c.name, stage: stageOf(c) || '', prefix: prefixOf(c), region: c.region || '',
           orgId: c.orgId || null, orgLabel: c.orgLabel || '',
           clientId: c.authType === 'oauth' ? (c.clientId || '') : '' };
}

// Er to søskendeposter det samme miljø? Samme præfiks, og samme org — eller,
// før org'en kendes, samme klient i samme region.
function sameSibling(a, b) {
  if (String(a.prefix || '') !== String(b.prefix || '')) return false;
  if (a.orgId && b.orgId) return a.orgId === b.orgId;
  return !!a.clientId && a.clientId === b.clientId && a.region === b.region;
}

// En søskendepost fra org'en er data andre har skrevet. Kun de kendte felter,
// i den form vi selv skriver dem.
function cleanSibling(s) {
  if (!s || typeof s !== 'object') return null;
  const str = (v, max) => String(v ?? '').slice(0, max);
  const ud = { name: str(s.name, 60), stage: str(s.stage, 20).toLowerCase(), prefix: str(s.prefix, 20),
               region: str(s.region, 40), orgId: GUID.test(String(s.orgId || '')) ? String(s.orgId) : null,
               orgLabel: str(s.orgLabel, 60), clientId: GUID.test(String(s.clientId || '')) ? String(s.clientId) : '' };
  return ud.name && (ud.orgId || ud.clientId) ? ud : null;
}

// Rækken som den skal stå i miljøets tabel.
//
// Søskendelisten er IKKE bare de miljøer denne pc har. En pc med kun dev
// tilføjet ville så skrive en tom liste og slette org'ens viden om prod. Listen
// flettes derfor med den der står (previous); denne pc's miljøer erstatter
// deres egne poster, og en post fjernes kun når miljøet har forladt pipelinen
// (forget) — ikke fordi én pc har slettet det fra sin egen liste.
function setupRowFor(env, all, { stages = STAGES, by = null, bySource = null, at = Date.now(), previous = null, forget = [] } = {}) {
  const egne = {};
  for (const k of SETUP_SHARED) egne[k] = String(env[k] ?? '');
  egne.stage = stageOf(env) || '';
  const mig = setupSibling(env);
  const lokale = pipelinePeers(env, all).filter(c => c.id !== env.id).map(setupSibling);
  const siblings = (isSetupRow(previous) && Array.isArray(previous.siblings) ? previous.siblings : [])
    .map(cleanSibling).filter(Boolean)
    .filter(s => !lokale.some(l => sameSibling(l, s)) && !sameSibling(s, mig) && !forget.some(x => sameSibling(x, s)));
  siblings.push(...lokale);
  return {
    kind: 'archygui-setup', schemaVersion: SETUP_SCHEMA,
    env: { ...egne, prefix: prefixOf(env), region: env.region || '', orgId: env.orgId || null },
    pipelineId: env.pipelineId || null,
    stages: [...stages],
    takenPrefixes: takenPrefixesFor(env, all),
    siblings: siblings.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.name.localeCompare(b.name)),
    by, bySource, at
  };
}

// Miljøer der har forladt en pipeline, og som søskendenes rækker skal glemme.
// Listen står på selve miljøet (setupForget) og tømmes først når rækken er
// skrevet — så en org der ikke kan nås nu, eller en server der genstartes
// imens, stadig får besked næste gang man er logget ind dér.
const FORGET_MAX = 20;
function addForget(c, post) {
  const liste = (Array.isArray(c.setupForget) ? c.setupForget : []).filter(x => !sameSibling(x, post));
  liste.push(post);
  c.setupForget = liste.slice(-FORGET_MAX);
}

// To rækker siger det samme, hvis kun hvem og hvornår er forskellige.
const setupComparable = row => { const { by, bySource, at, ...rest } = row || {}; return JSON.stringify(rest); };
const sameSetup = (a, b) => !!a && !!b && setupComparable(a) === setupComparable(b);

// Hvor er org'ens række uenig med miljøet? apply er det org'en vinder på;
// held er det der IKKE tages automatisk:
//   · et trin denne pc ikke kender
//   · prod-vagtens egne felter på et prod-miljø. Ellers kunne en hvilken som
//     helst række i en datatabel slå vagten fra på alle andre pc'er — sætte
//     trinnet til uat eller fjerne gruppekravet. Ændres de, skal det ske under
//     ⚙ Indstillinger, med det login vagten kræver.
function setupChanges(local, row, stages = STAGES) {
  const org = isSetupRow(row) ? row.env : {};
  const apply = {}, held = [];
  const prodLokalt = stageOf(local) === 'prod' && !isDemo(local);
  for (const k of SETUP_SHARED) {
    if (org[k] === undefined || org[k] === null) continue;
    const fra = String(local[k] ?? ''), til = String(org[k]).trim();
    if (fra === til) continue;
    if (k === 'stage' && til && !stages.includes(til)) { held.push({ field: k, local: fra, org: til, reason: 'unknown-stage' }); continue; }
    if (prodLokalt && PROD_GUARDED_FIELDS.includes(k)) { held.push({ field: k, local: fra, org: til, reason: 'prod-guarded' }); continue; }
    apply[k] = til;
  }
  return { apply, held };
}

// Org'ens trin flettes ind i den lokale liste — de erstatter den aldrig, for
// så ville én kundes trin fjerne en anden kundes. Et nyt trin lægges efter det
// nærmeste trin før det i org'ens liste, og prod bliver stående sidst.
function mergeStages(local, remote) {
  const ud = [...local];
  if (!Array.isArray(remote)) return ud;
  let efter = -1;
  for (const s0 of remote) {
    const s = String(s0 || '').toLowerCase();
    if (!STAGE_NAME.test(s)) continue;
    const i = ud.indexOf(s);
    if (i !== -1) { efter = i; continue; }
    const prod = ud.indexOf('prod');
    let pos = efter + 1;
    if (prod !== -1 && pos > prod) pos = prod;
    ud.splice(pos, 0, s);
    efter = pos;
  }
  return stageListError(ud).stages ? ud : [...local];
}

// Miljøet efter org'ens række er lagt ind. Ren funktion: { env, applied, held }.
function applyOrgSetup(env, row, all, stages = STAGES) {
  if (!isSetupRow(row)) return { env, applied: [], held: [] };
  const { apply, held } = setupChanges(env, row, stages);
  const andre = all.filter(c => c.id !== env.id);
  const applied = [];
  const ud = { ...env };
  for (const [k, v] of Object.entries(apply)) {
    const fejl = envFieldError({ [k]: v }, andre);
    if (fejl) { held.push({ field: k, local: String(env[k] ?? ''), org: v, reason: 'invalid', error: fejl }); continue; }
    applied.push({ field: k, from: String(env[k] ?? ''), to: v });
    ud[k] = v;
  }
  // Ville trin, kunde eller gruppe få miljøet til at støde ind i et andet med
  // samme præfiks i samme org, tages ingen af dem.
  if (applied.length && prefixClash(ud, all.map(c => c.id === env.id ? ud : c))) {
    for (const a of applied) { held.push({ field: a.field, local: a.from, org: a.to, reason: 'clash' }); ud[a.field] = env[a.field]; }
    applied.length = 0;
  }
  if (row.pipelineId && typeof row.pipelineId === 'string' && row.pipelineId.length <= 64) ud.pipelineId = row.pipelineId;
  const taget = new Set([...(ud.takenPrefixes || []), ...(Array.isArray(row.takenPrefixes) ? row.takenPrefixes : [])]);
  taget.delete(prefixOf(ud));
  ud.takenPrefixes = [...taget].filter(p => /^[A-Za-z0-9_\-]{1,20}$/.test(String(p))).sort();
  return { env: ud, applied, held };
}

// Gemmer felter på ét miljø. Listen læses og skrives uden et await imellem, så
// to opgaver i baggrunden ikke kan skrive hinandens ændringer over.
function patchEnv(id, patch) {
  const all = loadCustomers();
  const i = all.findIndex(c => c.id === id);
  if (i === -1) return null;
  all[i] = { ...all[i], ...patch };
  saveCustomers(all);
  return all[i];
}

// Lægger org'ens trin til den lokale liste. Returnerer de nye trin.
function adoptStages(remote) {
  const ny = mergeStages(STAGES, remote);
  const tilfoejet = ny.filter(s => !STAGES.includes(s));
  if (!tilfoejet.length) return [];
  applyStages(ny);
  saveSettings({ stages: ny });
  addLog('INFO', `Stages added from the org: ${tilfoejet.join(', ')} — now ${ny.join(' → ')}`, null, 'MANIFEST');
  return tilfoejet;
}

// Gemmer et miljø efter org'en har vundet, og flytter eksportmappen med navnet.
function commitOrgSetup(before, after) {
  const all = loadCustomers();
  const i = all.findIndex(c => c.id === before.id);
  if (i === -1) return null;
  all[i] = { ...all[i], ...after };
  saveCustomers(all);
  if (before.name !== all[i].name) moveCustomerFolder(before.name, all[i].name);
  return all[i];
}

// Skriver miljøets opsætningsrække. current er rækken som den står i org'en
// lige nu (null = ingen), så en uændret række ikke skrives igen.
async function writeSetupRow(env, current) {
  if (!stageOf(env)) return { ok: true, skipped: 'loose' };
  // Også opsætningen er en skrivning i org'en. I prod kræver den samme login
  // som alt andet — ellers bliver den stående til næste gang.
  const blocked = prodWriteBlock(env, tokenStore[env.id]);
  if (blocked) { patchEnv(env.id, { setupPending: true }); return { ok: false, reason: blocked.code }; }
  const all = loadCustomers();
  const nu = all.find(c => c.id === env.id) || env;
  const glem = (Array.isArray(nu.setupForget) ? nu.setupForget : []).map(cleanSibling).filter(Boolean);
  const row = setupRowFor(nu, all, { previous: current, forget: glem });
  if (current && sameSetup(current, row)) {
    patchEnv(env.id, { setupPending: false, setupAt: current.at || null, setupForget: undefined });
    return { ok: true, unchanged: true };
  }
  const who = await whoAmI(nu);
  row.by = who.by; row.bySource = who.bySource;
  const r = await putOrgManifestRow(nu, SETUP_KEY, row);
  if (!r.ok) return r;
  patchEnv(env.id, { setupPending: false, setupAt: row.at, setupForget: undefined });
  return { ok: true, wrote: true };
}

// Læser rækken. undefined = ingen tabel, null = ingen (brugbar) række.
async function readSetupRow(env) {
  const row = await readOrgManifestRow(env, SETUP_KEY);
  if (row === undefined || row === null) return row;
  if (isSetupRow(row)) return row;
  addLog('WARN', `The setup row in ${manifestTableName(env)} (${env.name}) is not in ArchyGUI's format — ignored and rewritten`, env.name, 'MANIFEST');
  return null;
}

// Søskendelisten fra de andre miljøers rækker i pipelinen — de der kan nås nu.
// Bruges når en tabel bygges op igen: den nye række kender ellers kun de
// miljøer denne pc har, og et miljø i en anden org ville forsvinde fra listen.
// Returnerer den række der står (eller en tom, hvis ingen), med listen udvidet.
async function siblingsFromPeers(env, current) {
  const andre = pipelinePeers(env, loadCustomers()).filter(c => c.id !== env.id && !isDemo(c));
  const fundet = [];
  await Promise.all(andre.map(async c => {
    try {
      const r = await readSetupRow(c);
      if (isSetupRow(r)) fundet.push(...(r.siblings || []).map(cleanSibling).filter(Boolean));
    } catch (_) { /* ingen forbindelse dér lige nu — de fletter sig ind ved næste sync */ }
  }));
  if (!fundet.length) return current;
  const basis = isSetupRow(current) ? current : { kind: 'archygui-setup', env: {}, siblings: [] };
  const siblings = [...(basis.siblings || [])];
  for (const f of fundet) if (!siblings.some(x => sameSibling(x, f))) siblings.push(f);
  return { ...basis, siblings };
}

// Skubber miljøets egen opsætning til org'en. Er org'ens række ændret siden vi
// sidst så den, og er den uenig med os, skrives der IKKE ovenpå — så skal
// brugeren vælge, i guiden.
async function pushSetup(envId) {
  const env = loadCustomers().find(c => c.id === envId);
  if (!env || !stageOf(env)) return { ok: true, skipped: 'loose' };
  let row;
  try { row = await readSetupRow(env); }
  catch (e) { patchEnv(envId, { setupPending: true }); return { ok: false, error: describeApiError(e) }; }
  if (row === undefined) return { ok: false, reason: 'no-table' };
  if (row && row.at !== env.setupAt) {
    const { apply, held } = setupChanges(env, row);
    if (Object.keys(apply).length || held.length) { patchEnv(envId, { setupPending: true }); return { ok: false, conflict: true }; }
  }
  return writeSetupRow(env, row);
}

// Henter org'ens opsætning ind (org'en vinder) og skriver bagefter det org'en
// mangler — fx en søskendeliste der er blevet længere.
async function syncSetup(envId) {
  ensurePipelineIdsSaved();
  let env = loadCustomers().find(c => c.id === envId);
  if (!env) return { ok: false, error: 'Ukendt miljø' };
  if (!stageOf(env)) return { ok: true, skipped: 'loose' };
  let row;
  try { row = await readSetupRow(env); }
  catch (e) { return { ok: false, error: describeApiError(e) }; }
  if (row === undefined) return { ok: true, noTable: true };

  const uenighed = () => {
    const { apply, held } = setupChanges(env, row);
    return [...Object.entries(apply).map(([field, org]) => ({ field, local: String(env[field] ?? ''), org })), ...held];
  };
  // Har denne pc en rettelse der ikke er skrevet, og har nogen ændret org'ens
  // række imens, er der to sandheder. Så vælger brugeren.
  if (row && env.setupPending && row.at !== env.setupAt) {
    const fields = uenighed();
    if (fields.length) return { ok: true, conflict: true, fields, orgBy: row.by || null, orgAt: row.at || null };
  }

  let applied = [], stagesAdded = [];
  if (row && !env.setupPending) {
    stagesAdded = adoptStages(row.stages);
    const r = applyOrgSetup(env, row, loadCustomers());
    applied = r.applied;
    // Det org'en ikke fik lov at bestemme, skrives heller ikke ovenpå.
    if (r.held.length)
      return { ok: true, conflict: true, fields: r.held, applied, stagesAdded, orgBy: row.by || null, orgAt: row.at || null };
    env = commitOrgSetup(env, r.env) || env;
    if (applied.length)
      addLog('INFO', `Setup from the org applied to ${env.name}: ${applied.map(a => `${a.field} "${a.from}" → "${a.to}"`).join(', ')}`, env.name, 'MANIFEST');
  }
  const w = await writeSetupRow(env, row);
  if (w.wrote) addLog('INFO', `Setup row written in ${manifestTableName(env)}${row ? ' (updated)' : ' (first write)'}`, env.name, 'MANIFEST');
  return { ok: true, applied, stagesAdded, wrote: !!w.wrote, pending: !w.ok, reason: w.reason || null };
}

// Skubber opsætningen for flere miljøer i baggrunden. Bruges når et miljø er
// oprettet, rettet eller slettet: så har søskendene i pipelinen fået en ny
// liste, og den skal stå i deres orgs også.
function setupInBackground(ids, why) {
  const liste = [...new Set(ids)].filter(Boolean);
  if (!liste.length) return;
  setImmediate(async () => {
    for (const id of liste) {
      const env = loadCustomers().find(c => c.id === id);
      if (!env || !stageOf(env)) continue;
      try {
        const r = await pushSetup(id);
        if (r.wrote) addLog('INFO', `Setup row written in ${manifestTableName(env)} (${why})`, env.name, 'MANIFEST');
        else if (r.conflict) addLog('WARN', `The setup in ${env.name}'s org differs from this PC — open 📋 the setup guide to choose`, env.name, 'MANIFEST');
        else if (!r.ok && r.reason !== 'no-table')
          addLog('INFO', `Setup row for ${env.name} not written yet (${r.reason || r.error}) — it is written at the next login or check`, env.name, 'MANIFEST');
      } catch (e) {
        // Org'en kunne ikke nås (eller afviste skrivningen). Rækken bliver
        // stående som ikke-skrevet og prøves igen ved næste login eller tjek.
        patchEnv(id, { setupPending: true });
        addLog('WARN', `Could not write the setup row for ${env.name}: ${describeApiError(e)} — tried again at the next login or check`, env.name, 'MANIFEST');
      }
    }
  });
}

// Efter et miljø er oprettet, rettet eller slettet: hvem skal have deres
// opsætningsrække skrevet om? before/after er miljøet før og efter (null ved
// oprettelse og sletning).
function afterEnvChange(before, after, why) {
  const relevant = !before || !after || SETUP_SIBLING_FIELDS.some(k => String(before[k] ?? '') !== String(after[k] ?? ''));
  if (!relevant || (!stageOf(before || {}) && !stageOf(after || {}))) return;
  const all = loadCustomers();
  let gem = false;
  // Skifter miljøet kunde eller gruppe her på pc'en, skifter det pipeline — så
  // skal det ikke tage det gamle pipelineId med sig.
  const nu0 = after && all.find(c => c.id === after.id);
  if (before && nu0 && nu0.pipelineId && nu0.pipelineId === before.pipelineId &&
      (tenantOf(before) !== tenantOf(nu0) || groupOf(before) !== groupOf(nu0))) { delete nu0.pipelineId; gem = true; }
  if (ensurePipelineIds(all).length) gem = true;
  const ids = new Set();
  if (after) {
    const nu = all.find(c => c.id === after.id);
    // En rettelse af de delte felter er denne pc's sandhed, til den er skrevet.
    if (nu && before && stageOf(nu) && SETUP_SHARED.some(k => String(before[k] ?? '') !== String(after[k] ?? ''))) {
      nu.setupPending = true; gem = true;
    }
    if (nu) pipelinePeers(nu, all).forEach(c => ids.add(c.id));
  }
  if (before) pipelinePeers(before, all).forEach(c => ids.add(c.id));
  // Har miljøet forladt pipelinen (intet trin, anden kunde/gruppe) eller skiftet
  // identitet (præfiks, org, klient), skal de gamle søskende glemme den gamle
  // post. En sletning tæller IKKE: at fjerne et miljø fra denne pc fjerner det
  // ikke fra pipelinen — en anden pc kan sagtens have det.
  if (before && after && stageOf(before)) {
    const nu = all.find(c => c.id === after.id) || after;
    const forladt = !stageOf(nu) || !(sameGroup(nu, before) || (before.pipelineId && nu.pipelineId === before.pipelineId));
    const gammel = setupSibling(before);
    if (forladt || !sameSibling(gammel, setupSibling(nu)))
      for (const c of pipelinePeers(before, all)) if (c.id !== after.id)
        { addForget(c, gammel); gem = true; }
  }
  if (gem) saveCustomers(all);
  setupInBackground([...ids], why);
}

// Hvad opdagelsen fandt, gjort klar til brugerfladen. Ren funktion.
//   tables: [{ id, name, prefix, setup }] — org'ens manifest-tabeller
// cards er miljøerne i DENNE org; elsewhere er pipelinens miljøer i andre orgs,
// som denne pc ikke har.
function discoveryResult(env, all, orgId, tables) {
  const iOrg = c => !isDemo(c) && (orgId && c.orgId ? c.orgId === orgId : orgKeyOf(c) === orgKeyOf(env));
  const selv = s => !!(env.setupAt || (s && s.env.stage && s.env.stage === stageOf(env)));
  const cards = tables.map(t => {
    const s = t.setup;
    const lokal = all.find(c => iOrg(c) && stageOf(c) && prefixOf(c) === t.prefix);
    return {
      tableId: t.id, table: t.name, prefix: t.prefix,
      setup: s ? { ...s.env, pipelineId: s.pipelineId || null, by: s.by || null, at: s.at || null,
                   siblings: (s.siblings || []).length } : null,
      // Miljøet selv — men kun når det er bekræftet: koblet før (setupAt) eller
      // på samme trin. Et nyt miljø der bare har samme præfiks, er ikke koblet.
      localId: lokal && (lokal.id !== env.id || selv(s)) ? lokal.id : null,
      self: !!(lokal && lokal.id === env.id && selv(s)),
      wrongOrg: !!(s && s.env.orgId && orgId && s.env.orgId !== orgId)
    };
  }).sort((a, b) => stageOrder(a.setup?.stage) - stageOrder(b.setup?.stage) || a.prefix.localeCompare(b.prefix));

  const set = new Set(), elsewhere = [];
  for (const t of tables) for (const sib of (t.setup?.siblings || [])) {
    const pfx = String(sib.prefix || '');
    if (orgId && sib.orgId === orgId) continue;                       // står som kort
    if (!sib.orgId && tables.some(x => x.prefix === pfx) && sib.region === env.region) continue;
    const key = `${sib.orgId || (sib.region + '|' + sib.clientId)}|${pfx}`;
    if (set.has(key)) continue;
    set.add(key);
    const kendt = all.find(c => !isDemo(c) && prefixOf(c) === pfx &&
      (sib.orgId ? c.orgId === sib.orgId : (c.clientId === sib.clientId && c.region === sib.region)));
    if (kendt) continue;
    elsewhere.push({ name: String(sib.name || ''), stage: String(sib.stage || ''), prefix: pfx,
                     region: String(sib.region || ''), orgId: sib.orgId || null, orgLabel: String(sib.orgLabel || ''),
                     clientId: String(sib.clientId || ''),
                     tenant: t.setup.env.tenant || '', group: t.setup.env.group || '',
                     pipelineId: t.setup.pipelineId || null });
  }
  elsewhere.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.name.localeCompare(b.name));
  return { cards, elsewhere };
}

const masked = c => c ? { ...c, clientSecret: '••••••••' } : c;

// org'ens manifest-tabeller med præfiks. Andre tabeller der tilfældigvis ender
// på samme navn, men ikke kan være vores (ugyldigt præfiks), springes over.
async function orgManifestTables(env) {
  return (await listAllTables(env))
    .filter(t => t.name.endsWith(ORG_MANIFEST_BASE))
    .map(t => ({ ...t, prefix: t.name.slice(0, -ORG_MANIFEST_BASE.length) }))
    .filter(t => !envFieldError({ prefix: t.prefix }));
}

module.exports = { recordOrgManifest, afterEnvChange, masked, SETUP_KEY, setupInBackground,
  ensurePipelineIdsSaved, ensurePipelineIds, writeSetupRow, pipelinePeers, SETUP_SHARED,
  isSetupRow, takenPrefixesFor, sameSibling, cleanSibling, setupRowFor, addForget, sameSetup,
  setupChanges, mergeStages, applyOrgSetup, patchEnv, adoptStages, commitOrgSetup, readSetupRow,
  siblingsFromPeers, syncSetup, discoveryResult, orgManifestTables };
