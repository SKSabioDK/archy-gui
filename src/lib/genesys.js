// Fælles opslag i Genesys' API: sidevise lister, datatabeller og publiceringsinfo.

const axios = require('axios');
const { describeApiError } = require('./helpers');
const { getToken } = require('./token');

async function listAllTables(env) {
  const { token, apiBase } = await getToken(env);
  const acc = [];
  for (let page = 1; ; page++) {
    const r = await axios.get(`${apiBase}/api/v2/flows/datatables`, {
      headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 100, pageNumber: page } });
    acc.push(...(r.data.entities || []).map(t => ({ id: t.id, name: t.name })));
    if (page >= (r.data.pageCount || 1)) break;
  }
  return acc;
}

// Hvornår blev flowet sidst publiceret, og af hvem? Det er den oplysning der
// afslører om nogen har rettet direkte i mål-org'en efter en migrering.
async function getFlowPublishInfo(customer, flowName, flowType) {
  const { token, apiBase } = await getToken(customer);
  const H = { headers: { Authorization: `Bearer ${token}` } };
  let page = 1, hit = null;
  while (!hit) {
    const r = await axios.get(`${apiBase}/api/v2/flows`, {
      ...H, params: { pageSize: 100, pageNumber: page, type: String(flowType).toLowerCase() }
    });
    const e = r.data.entities || [];
    hit = e.find(f => f.name === flowName) || null;
    if (hit || e.length < 100) break;
    page++;
  }
  if (!hit) return null;

  const pv = hit.publishedVersion;
  // Et flow kan være checked in uden nogensinde at være publiceret. Det er
  // værd at vide: flowet findes i org'en, men er ikke i drift.
  if (!pv) return { version: hit.checkedInVersion?.name || null, publishedAt: null,
                    publishedBy: null, active: !!hit.active };

  let by = null;
  if (pv.createdBy?.id) {
    try {
      const u = await axios.get(`${apiBase}/api/v2/users/${pv.createdBy.id}`, H);
      by = u.data.name || u.data.email || null;
    } catch (_) {
      // 404 = brugeren findes ikke længere. Et rå GUID hjælper ingen.
      by = null;
    }
  }
  return {
    version: pv.name || pv.commitVersion || null,
    publishedAt: pv.dateCheckedIn || pv.dateCreated || null,
    publishedBy: by,
    active: !!hit.active
  };
}

async function pagedList(base, url, token, params = {}) {
  const all = [], seen = new Set();
  for (let page = 1; page <= 200; page++) {
    const r = await axios.get(`${base}${url}`, { headers: { Authorization: `Bearer ${token}` }, params: { ...params, pageSize: 100, pageNumber: page } });
    const e = r.data.entities || [];
    // En liste med cursor ignorerer pageNumber og giver side 1 igen — så tager vi kun det nye
    const nye = e.filter(x => !x.id || !seen.has(x.id));
    nye.forEach(x => x.id && seen.add(x.id));
    all.push(...nye);
    if (e.length < 100 || !nye.length) return all;
  }
  return all;
}

// Hvorfor et område ikke kunne læses: statuskoden og Genesys' egen forklaring (manglende rettighed eller scope).
function orgReadError(e) {
  const st = e.response && e.response.status ? `HTTP ${e.response.status}` : '';
  const why = e.response ? String(describeApiError(e)).slice(0, 200) : e.message;
  return [st, why].filter(Boolean).join(' — ');
}

module.exports = { listAllTables, getFlowPublishInfo, pagedList, orgReadError };
