// Manifestet i org'en: én datatabel pr. miljø der beskriver miljøet selv.

const axios = require('axios');
const os = require('os');
const { addLog } = require('./log');
const { normType } = require('./conventions');
const { wrongOrg, prefixOf, isDemo, rememberOrgId } = require('./environments');
const { baseFlowName } = require('./names');
const { getToken, _mfTableCache, _whoCache } = require('./token');
const { loadDemo, saveDemo } = require('./demo');

// ── Manifest i org'en ────────────────────────────────────────────────────────
// Den lokale fil kan ikke deles: to personer på hver sin pc får hver sin
// historik, og signalet "publiceret uden om pipelinen" ville sige noget
// forskelligt alt efter hvem der kigger.
//
// Derfor ligger manifestet i en datatabel i org'en — og HVER ORG BESKRIVER KUN
// SIG SELV. Kendsgerningen "dev har Velkomst_v10 på v10" skrives kun af den der
// ændrede dev, så to skrivende kan aldrig sige hver sit om samme celle.
// Uenighed er umulig af konstruktion, i stedet for noget vi skal løse bagefter.
// En org der ikke kan nås bliver "ukendt" — præcis som tavlen allerede gør.

const ORG_MANIFEST_BASE = 'ArchyGUI_Manifest';
// Datatabellerne følger samme navnekonvention som flowene: et virtuelt miljø
// har sit præfiks med, prod har ingen. Så har hvert miljø sit eget manifest,
// også når fire af dem deler den samme org.
const manifestTableName = c => prefixOf(c) + ORG_MANIFEST_BASE;

// Nøglen er GRUNDNAVNET plus typen. Flownavnet ændrer sig ved hver forfremmelse
// ("Velkomst" → "_v10" → "_v15"), så nøgles der på det fulde navn, bliver
// rækken forældreløs hver gang. Samme fejl som i den lokale fil før v1.25.0.
// Nøglefeltet i Genesys tager 256 tegn.
function orgManifestKey(flowName, flowType) {
  const k = `${baseFlowName(flowName)}|${normType(flowType)}`;
  return k.length <= 256 ? k : k.slice(0, 256);
}                 // customerId -> { who, at }
const WHO_TTL = 10 * 60 * 1000;

function machineUser() {
  try { return `${os.userInfo().username}@${os.hostname()}`; }
  catch (_) { return 'ukendt'; }
}

// Er miljøet logget ind med OAuth (PKCE), er tokenet en PERSON, og så skal
// rækken bære den person — ikke hvem der tilfældigvis sad ved maskinen.
//
// Med client credentials findes der ingen Genesys-bruger: tokenet tilhører en
// integration, ikke et menneske. Så er pc-brugeren det eneste sande vi kan
// notere — og det skal siges, så det ikke forveksles med en Genesys-identitet.
// Derfor bærer rækken både navnet og hvor det kommer fra.
async function whoAmI(customer) {
  if (!customer || customer.authType !== 'oauth')
    return { by: machineUser(), bySource: 'machine' };

  const hit = _whoCache[customer.id];
  if (hit && Date.now() - hit.at < WHO_TTL) return { by: hit.who, bySource: 'genesys' };
  try {
    const { token, apiBase } = await getToken(customer);
    const r = await axios.get(`${apiBase}/api/v2/users/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const who = r.data.email || r.data.username || r.data.name || r.data.id;
    if (!who) throw new Error('intet brugernavn i svaret');
    _whoCache[customer.id] = { who, at: Date.now() };
    return { by: who, bySource: 'genesys' };
  } catch (_) {
    // Kan brugeren ikke slås op, opdigter vi ikke en — vi falder tilbage og
    // siger hvad det er.
    return { by: machineUser(), bySource: 'machine' };
  }
}   // customerId -> { id, at }
const MF_TABLE_TTL = 5 * 60 * 1000;

async function findOrgManifestTable(customer) {
  const hit = _mfTableCache[customer.id];
  if (hit && Date.now() - hit.at < MF_TABLE_TTL) return hit.id;
  const { token, apiBase } = await getToken(customer);
  let page = 1;
  for (;;) {
    const r = await axios.get(`${apiBase}/api/v2/flows/datatables`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 100, pageNumber: page }
    });
    const found = (r.data.entities || []).find(t => t.name === manifestTableName(customer));
    if (found) { _mfTableCache[customer.id] = { id: found.id, at: Date.now() }; return found.id; }
    if (page++ >= (r.data.pageCount || 1)) break;
  }
  _mfTableCache[customer.id] = { id: null, at: Date.now() };
  return null;
}

async function createOrgManifestTable(customer) {
  const { token, apiBase } = await getToken(customer);
  const body = {
    name: manifestTableName(customer),
    // Står i kundens org, så den er på engelsk som alt andet vi skriver dér.
    description: 'ArchyGUI: what this org contains and when it arrived. Written by ArchyGUI — do not edit rows by hand.',
    schema: {
      $schema: 'http://json-schema.org/draft-04/schema#',
      title: manifestTableName(customer),
      type: 'object',
      required: ['key'],
      additionalProperties: false,
      properties: {
        key:  { title: 'Lookup Key', type: 'string', $id: '/properties/key',
                displayOrder: 0, minLength: 1, maxLength: 256 },
        Data: { title: 'Data', type: 'string', $id: '/properties/Data',
                displayOrder: 1, minLength: 0, maxLength: 262144 }
      }
    }
  };
  const r = await axios.post(`${apiBase}/api/v2/flows/datatables`, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  delete _mfTableCache[customer.id];
  addLog('SUCCESS', `Manifest table "${manifestTableName(customer)}" created`, customer.name, 'MANIFEST');
  return r.data.id;
}

// Demo-miljøer har ingen org — deres "tabel" ligger i demofilen.
function demoManifest(envId) {
  const d = loadDemo();
  return (d.manifest || {})[envId] || {};
}
function demoManifestWrite(envId, key, data) {
  const d = loadDemo();
  d.manifest = d.manifest || {};
  d.manifest[envId] = d.manifest[envId] || {};
  d.manifest[envId][key] = data;
  saveDemo(d);
}

// Kun flowrækker. Opsætningsrækken (SETUP_KEY) står i samme tabel, men den er
// ikke et flow — tavlen, release-historikken og status må aldrig se den.
// Et flows nøgle er altid "grundnavn|TYPE", så en nøgle uden "|" er reserveret.
const isFlowRowKey = k => String(k || '').includes('|');
const onlyFlowRows = rows => Object.fromEntries(Object.entries(rows || {}).filter(([k]) => isFlowRowKey(k)));

async function readOrgManifest(customer) {
  if (isDemo(customer)) return onlyFlowRows(demoManifest(customer.id));
  const tableId = await findOrgManifestTable(customer);
  if (!tableId) return null;                       // ingen tabel = ikke taget i brug
  const { token, apiBase } = await getToken(customer);
  const out = {};
  let page = 1;
  for (;;) {
    let r;
    try {
      r = await axios.get(`${apiBase}/api/v2/flows/datatables/${tableId}/rows`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 100, pageNumber: page, showbrief: false }
      });
    } catch (e) {
      // Tabellens id huskes i fem minutter. Er den slettet i org'en imens, er
      // svaret 404 — og så har miljøet ingen tabel, ikke en fejl.
      if (e.response?.status === 404 && page === 1) { delete _mfTableCache[customer.id]; return null; }
      throw e;
    }
    for (const row of (r.data.entities || [])) {
      if (!isFlowRowKey(row.key)) continue;
      try { out[row.key] = JSON.parse(row.Data || '{}'); }
      catch (_) { /* en række nogen har rettet i hånden — spring den over */ }
    }
    if (page++ >= (r.data.pageCount || 1)) break;
  }
  return out;
}

// Én række, slået op direkte. undefined = ingen tabel, null = ingen række.
async function readOrgManifestRow(customer, key) {
  if (isDemo(customer)) return demoManifest(customer.id)[key] || null;
  const tableId = await findOrgManifestTable(customer);
  if (!tableId) return undefined;
  return readTableRow(customer, tableId, key);
}

// Én række i en bestemt tabel. Opdagelsen læser andre miljøers tabeller i
// samme org — dem kender findOrgManifestTable ikke.
async function readTableRow(customer, tableId, key) {
  const { token, apiBase } = await getToken(customer);
  try {
    const r = await axios.get(`${apiBase}/api/v2/flows/datatables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` }, params: { showbrief: false }
    });
    try { return JSON.parse(r.data.Data || '{}'); } catch (_) { return null; }
  } catch (e) {
    if (e.response?.status === 404) return null;
    throw e;
  }
}

// Skriver rækken præcis som den er — ingen stempel med hvem og hvornår.
async function putOrgManifestRow(customer, key, payload) {
  if (isDemo(customer)) { demoManifestWrite(customer.id, key, payload); return { ok: true, key }; }
  const tableId = await findOrgManifestTable(customer);
  if (!tableId) return { ok: false, reason: 'no-table' };
  const { token, apiBase } = await getToken(customer);
  const H = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  const body = { key, Data: JSON.stringify(payload) };
  const url = `${apiBase}/api/v2/flows/datatables/${tableId}/rows`;
  try {
    await axios.put(`${url}/${encodeURIComponent(key)}`, body, H);
  } catch (e) {
    // Findes rækken ikke endnu, oprettes den. Der er ingen upsert i API'et.
    if (e.response?.status === 404) await axios.post(url, body, H);
    else throw e;
  }
  return { ok: true, key };
}

async function writeOrgManifestRow(customer, flowName, flowType, data) {
  const key = orgManifestKey(flowName, flowType);
  const who = await whoAmI(customer);
  // Release-historikken bor i samme række. En forfremmelse skriver rækken
  // forfra, og uden dette ville den slette historikken hver gang — og dermed
  // muligheden for at rulle tilbage fra en anden pc.
  let releases = data.releases;
  if (releases === undefined) {
    try { releases = ((await readOrgManifestRow(customer, key)) || {}).releases; }
    catch (_) { releases = undefined; }
  }
  const payload = { ...data, by: who.by, bySource: who.bySource, at: Date.now() };
  if (releases) payload.releases = releases;
  return putOrgManifestRow(customer, key, payload);
}

// Org-id pr. kunde. Slås op én gang og huskes — det ændrer sig ikke.
const orgIdCache = {};
async function getOrgId(customer) {
  if (orgIdCache[customer.id]) return orgIdCache[customer.id];
  try {
    const { token, apiBase } = await getToken(customer);
    const r = await axios.get(`${apiBase}/api/v2/organizations/me`,
      { headers: { Authorization: `Bearer ${token}` } });
    if (wrongOrg(customer, r.data.id)) { rememberOrgId(customer, r.data.id); return null; }
    orgIdCache[customer.id] = r.data.id;
    rememberOrgId(customer, r.data.id);
    return r.data.id;
  } catch (_) { return null; }
}

module.exports = { getOrgId, whoAmI, ORG_MANIFEST_BASE, manifestTableName, orgIdCache,
  orgManifestKey, findOrgManifestTable, createOrgManifestTable, demoManifest, isFlowRowKey,
  onlyFlowRows, readOrgManifest, readOrgManifestRow, readTableRow, putOrgManifestRow,
  writeOrgManifestRow };
