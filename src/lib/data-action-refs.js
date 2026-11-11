// Data actions i flowet: kategori og navn, kortlægning og totaltjek mellem orgs.

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { FLOWS_DIR } = require('../config');
const { addLog } = require('./log');
const { describeApiError } = require('./helpers');
const { stageOf } = require('./environments');
const { getToken } = require('./token');
const { getOrgId, readOrgManifestRow, putOrgManifestRow } = require('./manifest');
const { FUNCTION_INTEGRATION } = require('./dependencies');

// ── Data actions i flowet: kategori og navn ───────────────────────────────────
//
// Et flow peger på en data action med KATEGORI og NAVN:
//
//     category:
//       Genesys Cloud Data Actions - QM:
//         dataAction:
//           get_order:
//
// Kategorien er integrationens navn, og den er ikke ens fra org til org —
// kunder har fx "Test - Genesys Cloud Data Actions" i test og
// "Genesys Cloud Data Actions - Flows" i prod. Findes navnet i målet, men under
// en anden kategori, ser en tjek på navn alene alt i orden, og importen fejler.
// Derfor slås både kategori og navn op, og brugerens valg huskes pr. org-par.

const DA_REF_RE = () => /(category:[ \t]*\r?\n[ \t]+)([^\r\n]+?)(:[ \t]*\r?\n[ \t]+(?:secureDataAction|dataAction):[ \t]*\r?\n[ \t]+)([^\r\n]+?)(:[ \t]*(?:\r?\n|$))/g;
const daUnquote = s => String(s).trim().replace(/^(["'])(.*)\1$/, '$2');
const daSame = (a, b) => !!a && !!b && a.category === b.category && a.name === b.name;

// De data actions et flow kalder, hver én gang.
function scanDataActionRefs(yaml) {
  const out = [];
  const re = DA_REF_RE();
  let m;
  while ((m = re.exec(String(yaml))) !== null) {
    const ref = { category: daUnquote(m[2]), name: daUnquote(m[4]) };
    if (!out.some(r => daSame(r, ref))) out.push(ref);
  }
  return out;
}

// Ren afgørelse pr. reference:
//   exact   — findes i målet med samme kategori og navn
//   mapped  — et gemt valg peger på en action der findes i målet
//   choose  — navnet findes i målet, men under en anden kategori
//   absent  — navnet findes slet ikke i målet
function classifyDataActionRefs(refs, targetActions, saved) {
  const ta = targetActions || [];
  return (refs || []).map(r => {
    if (ta.some(a => daSame(a, r))) return { ...r, status: 'exact' };
    const sv = (saved || []).find(e => daSame(e.from, r));
    if (sv && ta.some(a => daSame(a, sv.to))) return { ...r, status: 'mapped', mappedTo: sv.to };
    const candidates = ta.filter(a => a.name === r.name).map(a => ({ category: a.category, name: a.name }));
    return { ...r, status: candidates.length ? 'choose' : 'absent', candidates };
  });
}

// En reference der ikke findes i målet, men hvis navn findes under præcis én
// anden kategori, peges over dér. Importen ville ellers fejle med "no matches":
// en migreret action får målintegrationens navn som kategori, ikke kildens.
// Et gemt eller sendt valg går forud; flere kandidater overlades til brugeren.
function autoDataActionEntries(yaml, targetActions, entries) {
  const out = [];
  for (const r of classifyDataActionRefs(scanDataActionRefs(yaml), targetActions, entries)) {
    if (r.status === 'choose' && r.candidates.length === 1) {
      out.push({ from: { category: r.category, name: r.name }, to: { ...r.candidates[0] } });
    }
  }
  return out;
}

// Skriver referencerne om efter en liste af valg. Rører kun en reference der
// IKKE findes i målet, og kun hvis valget peger på en action der gør.
function applyDataActionMap(yaml, entries, targetActions) {
  const changed = [];
  const ta = targetActions || [];
  const wrap = (orig, v) => { const q = String(orig).trim()[0]; return (q === '"' || q === "'") ? q + v + q : v; };
  const out = String(yaml).replace(DA_REF_RE(), (all, h1, cat, h2, name, tail) => {
    const ref = { category: daUnquote(cat), name: daUnquote(name) };
    if (ta.some(a => daSame(a, ref))) return all;
    const e = (entries || []).find(x => daSame(x.from, ref));
    if (!e || !ta.some(a => daSame(a, e.to))) return all;
    const txt = `${ref.category} / ${ref.name} → ${e.to.category} / ${e.to.name}`;
    if (!changed.includes(txt)) changed.push(txt);
    return h1 + wrap(cat, e.to.category) + h2 + wrap(name, e.to.name) + tail;
  });
  return { yaml: out, changed };
}

const validDaEntry = e => !!e && ['from', 'to'].every(k => e[k]
  && typeof e[k].category === 'string' && typeof e[k].name === 'string'
  && e[k].category && e[k].name && e[k].category.length <= 256 && e[k].name.length <= 256);

// over vinder over base, på kilden.
function mergeDaEntries(base, over) {
  const out = (base || []).filter(validDaEntry).map(e => ({ from: { ...e.from }, to: { ...e.to } }));
  for (const e of (over || []).filter(validDaEntry)) {
    const i = out.findIndex(x => daSame(x.from, e.from));
    const neu = { from: { category: e.from.category, name: e.from.name }, to: { category: e.to.category, name: e.to.name } };
    if (i >= 0) out[i] = neu; else out.push(neu);
  }
  return out;
}

// Alle data actions i en org, med kategori.
async function listDataActions(token, apiBase) {
  const H = { headers: { Authorization: `Bearer ${token}` } };
  let all = [], page = 1;
  for (;;) {
    const r = await axios.get(`${apiBase}/api/v2/integrations/actions`, { ...H, params: { pageSize: 100, pageNumber: page } });
    const e = r.data.entities || [];
    all = all.concat(e.map(a => ({ id: a.id, name: a.name, category: a.category, integrationId: a.integrationId })));
    if (e.length < 100) break;
    page++;
  }
  return all;
}

// Valgene gemmes pr. kilde-org og mål-org. I mål-org'ens manifest-tabel, hvis
// den har en — så en kollega på en anden pc ser dem — ellers i en lokal fil.
// Nøglen har ikke noget "|", så tavlen aldrig læser den som et flow.
const DA_MAP_KEY = 'ArchyGUI_DataActionMap';
const DA_MAP_FILE = path.join(FLOWS_DIR, '.data-action-map.json');

function readLocalDaMap() { try { return JSON.parse(fs.readFileSync(DA_MAP_FILE, 'utf8')); } catch (_) { return {}; } }

const daOrgKeys = async (source, target) => ({
  s: (await getOrgId(source)) || source.id,
  t: (await getOrgId(target)) || target.id
});

async function loadDataActionMap(source, target) {
  const k = await daOrgKeys(source, target);
  const local = (readLocalDaMap()[k.t] || {})[k.s] || [];
  let org = [];
  try {
    const row = await readOrgManifestRow(target, DA_MAP_KEY);
    if (row && row.maps) org = row.maps[k.s] || [];
  } catch (_) { /* uden tabel bruges den lokale fil */ }
  return mergeDaEntries(local, org);
}

// replace: entries ER hele listen for org-parret (fra totaltjekket, hvor man
// også kan fjerne et valg). Ellers flettes de ind i det der er gemt.
async function saveDataActionMap(source, target, entries, opts = {}) {
  const k = await daOrgKeys(source, target);
  const all = opts.replace ? mergeDaEntries([], entries)
                           : mergeDaEntries(await loadDataActionMap(source, target), entries);
  // Et løst miljø (intet trin) får ikke skrevet noget i sin org.
  if (stageOf(target)) {
    try {
      const row = (await readOrgManifestRow(target, DA_MAP_KEY));
      if (row !== undefined) {
        const maps = { ...((row && row.maps) || {}), [k.s]: all };
        const r = await putOrgManifestRow(target, DA_MAP_KEY, { schema: 1, maps, at: Date.now() });
        if (r.ok) return { where: 'org', count: all.length };
      }
    } catch (e) {
      addLog('WARN', `Could not save the data action choices in ${target.name}'s manifest: ${describeApiError(e)} — saved locally`, target.name, 'MIGRATE');
    }
  }
  const local = readLocalDaMap();
  local[k.t] = { ...(local[k.t] || {}), [k.s]: all };
  fs.writeFileSync(DA_MAP_FILE, JSON.stringify(local, null, 2));
  return { where: 'local', count: all.length };
}

// ── Totaltjek af data actions mellem to orgs ─────────────────────────────────

// Hver data action i kilden, sat op mod målet. Samme afgørelse som for et enkelt
// flow (exact / mapped / choose / absent), her for hele orgen. Ren, så den kan
// prøves uden en org.
// Genesys' indbyggede actions (id'et starter med "static_") findes i hver orgs
// Genesys Cloud Data Actions og kan hverken oprettes eller migreres. Findes de
// ikke i målet, er det ikke en mangel vi kan rette, så de er ikke med.
const isBuiltInAction = a => String((a && a.id) || '').startsWith('static_');

function compareDataActionSets(srcActions, tgtActions, saved) {
  const cls = classifyDataActionRefs(
    srcActions.map(a => ({ category: a.category, name: a.name })), tgtActions, saved);
  return srcActions.map((a, i) => ({ a, i })).filter(({ a, i }) =>
    !(isBuiltInAction(a) && cls[i].status !== 'exact' && cls[i].status !== 'mapped')).map(({ a, i }) => ({
    id: a.id, name: a.name, category: a.category,
    // Id'et på den action i målet kilden er sat op mod — til kontrakt-sammenligningen.
    targetId: (tgtActions.find(t => daSame(t, cls[i].status === 'mapped' ? cls[i].mappedTo : a)) || {}).id || null,
    integrationName: a.integrationName || '', integrationType: a.integrationType || '',
    status: cls[i].status === 'exact' ? 'same' : cls[i].status,
    candidates: cls[i].candidates || [], mappedTo: cls[i].mappedTo || null,
    // En Function Data Action kan ikke oprettes herfra: mangler den, er det manuelt.
    fda: a.integrationType === FUNCTION_INTEGRATION
  }));
}

function summarizeDataActionRows(rows) {
  const n = s => rows.filter(r => r.status === s).length;
  return {
    total: rows.length, same: n('same'), mapped: n('mapped'), choose: n('choose'), absent: n('absent'),
    // FDA'er der hverken findes eller er peget over på en der gør.
    fdaMissing: rows.filter(r => r.fda && (r.status === 'choose' || r.status === 'absent')).length
  };
}

// Et schemas felter: navn → type og om de er påkrævet.
function schemaFields(schema) {
  const props = (schema && schema.properties) || {};
  const req = (schema && schema.required) || [];
  const out = {};
  for (const [name, def] of Object.entries(props)) {
    const t = def && def.type;
    out[name] = { type: typeof t === 'string' ? t : JSON.stringify(t || ''), required: req.includes(name) };
  }
  return out;
}

// Forskellen på to actions' kontrakter, set fra kilden: hvad kilden har som
// målet ikke har, hvad målet har ekstra, og felter hvor typen eller kravet er
// et andet. En action kan hedde det samme og alligevel ikke passe til flowet.
function compareContracts(srcAction, tgtAction) {
  const diffs = [];
  for (const [side, key] of [['input', 'inputSchema'], ['output', 'successSchema']]) {
    const a = schemaFields(srcAction && srcAction.contract && srcAction.contract[side] && srcAction.contract[side][key]);
    const b = schemaFields(tgtAction && tgtAction.contract && tgtAction.contract[side] && tgtAction.contract[side][key]);
    for (const name of Object.keys(a)) {
      if (!(name in b)) diffs.push({ side, kind: 'missing-in-target', name });
      else if (a[name].type !== b[name].type) diffs.push({ side, kind: 'type', name, from: a[name].type, to: b[name].type });
      else if (a[name].required !== b[name].required) diffs.push({ side, kind: 'required', name, from: a[name].required, to: b[name].required });
    }
    for (const name of Object.keys(b)) if (!(name in a)) diffs.push({ side, kind: 'extra-in-target', name });
  }
  return { same: diffs.length === 0, diffs };
}

// Alle integrationer i en org, med om de er aktive. En inaktiv integration kan
// ikke bruges: en action i den kører ikke.
async function listIntegrations(customer) {
  const { token, apiBase } = await getToken(customer);
  const out = [];
  for (let p = 1; ; p++) {
    const r = await axios.get(`${apiBase}/api/v2/integrations`, {
      headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 100, pageNumber: p } });
    const e = r.data.entities || [];
    for (const i of e) out.push({
      id: i.id, name: i.name, type: i.integrationType?.id || '',
      active: (i.reportedState?.code || '') === 'ACTIVE'
    });
    if (e.length < 100) break;
  }
  return out;
}

// Alle data actions i en org med integrationens navn og type.
async function listDataActionsFull(customer) {
  const { token, apiBase } = await getToken(customer);
  const ints = {};
  for (const i of await listIntegrations(customer)) ints[i.id] = i;
  return (await listDataActions(token, apiBase)).map(a => ({
    ...a, integrationName: (ints[a.integrationId] || {}).name || a.category || '',
    integrationType: (ints[a.integrationId] || {}).type || ''
  }));
}

// ── Setup-forslag: hvor skal de nye data actions hen? ────────────────────────
//
// En integration rummer kun et vist antal actions. Hos en kunde var prod delt
// ud på mange integrationer, og test på få, så "samme integration som i test"
// findes ikke eller er fuld. Forslaget fordeler de actions der mangler i målet
// på de aktive integrationer af samme type, med plads, og holder en
// integrations actions samlet hvor det kan lade sig gøre.
//
//   todo         — [{ id, name, category, integrationName, integrationType }]
//   integrations — målets: [{ id, name, type, active, existing }]
//   capacity     — hvor mange actions en integration højst rummer
//
// Ren funktion, så den kan prøves uden en org.
function planDataActionPlacement(todo, integrations, capacity) {
  const cap = Math.max(1, parseInt(capacity, 10) || 100);
  const free = new Map(integrations.map(i => [i.id, Math.max(0, cap - (i.existing || 0))]));
  const groups = new Map();
  for (const a of todo) {
    const k = a.integrationType + '\u0001' + a.integrationName;
    if (!groups.has(k)) groups.set(k, { integrationName: a.integrationName, integrationType: a.integrationType, actions: [] });
    groups.get(k).actions.push({ id: a.id, name: a.name, category: a.category });
  }
  const placements = [];
  // Store grupper først: de har sværest ved at finde plads samlet.
  for (const g of [...groups.values()].sort((a, b) => b.actions.length - a.actions.length || a.integrationName.localeCompare(b.integrationName))) {
    const eligible = integrations.filter(i => i.active && i.type === g.integrationType)
      .sort((a, b) => (b.name === g.integrationName) - (a.name === g.integrationName)
                    || free.get(b.id) - free.get(a.id) || a.name.localeCompare(b.name));
    const size = g.actions.length;
    const allocations = [];
    let rest = g.actions.slice();
    const whole = eligible.find(i => free.get(i.id) >= size);
    if (whole) {
      allocations.push({ integrationId: whole.id, integrationName: whole.name, actions: rest });
      free.set(whole.id, free.get(whole.id) - size);
      rest = [];
    } else {
      for (const i of [...eligible].sort((a, b) => free.get(b.id) - free.get(a.id) || a.name.localeCompare(b.name))) {
        if (!rest.length) break;
        const take = Math.min(free.get(i.id), rest.length);
        if (take <= 0) continue;
        allocations.push({ integrationId: i.id, integrationName: i.name, actions: rest.slice(0, take) });
        free.set(i.id, free.get(i.id) - take);
        rest = rest.slice(take);
      }
    }
    placements.push({
      integrationName: g.integrationName, integrationType: g.integrationType, count: size, allocations,
      // Det der ikke kunne placeres: enten findes ingen aktiv integration af typen, eller de er fulde.
      unplaced: rest.length ? { count: rest.length, actions: rest, reason: eligible.length ? 'no-capacity' : 'no-integration',
                                suggestedName: g.integrationName } : null
    });
  }
  const planned = new Map();
  for (const p of placements) for (const a of p.allocations) planned.set(a.integrationId, (planned.get(a.integrationId) || 0) + a.actions.length);
  return {
    capacity: cap, placements,
    integrations: integrations.map(i => ({ ...i, planned: planned.get(i.id) || 0, capacity: cap }))
  };
}

module.exports = { listIntegrations, listDataActions, scanDataActionRefs, classifyDataActionRefs,
  autoDataActionEntries, applyDataActionMap, validDaEntry, mergeDaEntries, loadDataActionMap,
  saveDataActionMap, compareDataActionSets, summarizeDataActionRows, compareContracts,
  listDataActionsFull, planDataActionPlacement };
