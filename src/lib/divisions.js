// Divisionen et flow oprettes i, og om login'et må oprette flows dér.

const axios = require('axios');
const { addLog } = require('./log');
const { describeApiError } = require('./helpers');
const { getToken } = require('./token');

// ── Divisionen et flow oprettes i ────────────────────────────────────────────
// Archy opretter flowet i den division YAML'en siger. Findes den ikke i målet,
// eller må login'et ikke oprette flows dér, fejlede importen først i Archy —
// efter tabeller, prompts og moduler var migreret.

// Flowets EGEN division: den første indrykkede division-linje, samme som
// setFlowDivisionInYaml skriver om.
function flowOwnDivision(yaml) {
  const m = String(yaml).match(/^[ 	]{2,}division:[ 	]*(.+?)[ 	]*$/m);
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

// Divisionerne i målet, og dem login'et må oprette flows i. Kan det sidste
// ikke slås op (fx for en client credentials-klient), er permitted null, og
// så afgør Archy det.
async function flowDivisionAccess(target) {
  const { token, apiBase } = await getToken(target);
  const H = { headers: { Authorization: `Bearer ${token}` } };
  const pages = async (url, params) => {
    const ud = new Set();
    for (let page = 1; ; page++) {
      const r = await axios.get(`${apiBase}${url}`, { ...H, params: { ...params, pageSize: 100, pageNumber: page } });
      const e = r.data.entities || [];
      for (const d of e) if (d.name) ud.add(d.name);
      if (e.length < 100) break;
    }
    return ud;
  };
  const names = await pages('/api/v2/authorization/divisions', {});
  let permitted = null;
  try { permitted = await pages('/api/v2/authorization/divisionspermitted/paged/me', { permission: 'architect:flow:add' }); }
  catch (e) { addLog('WARN', `Could not look up which divisions the login in ${target.name} may create flows in: ${describeApiError(e)}`, target.name, 'MIGRATE'); }
  return { names, permitted };
}

// null, 'missing' eller 'denied'. Ren funktion.
function divisionProblem(division, access) {
  if (!division || !access) return null;
  if (!access.names.has(division)) return 'missing';
  if (access.permitted && !access.permitted.has(division)) return 'denied';
  return null;
}

const divisionDeniedText = (division, target) =>
  `Du må ikke oprette flows i divisionen "${division}" i ${target.name}. Giv din rolle (eller OAuth-klientens) ` +
  `architect:flow:add/edit/view i den division under Admin → Roles, og log ind igen — eller sæt en division på ` +
  `målmiljøet under ⚙ Indstillinger, så flowet lægges dér.`;

module.exports = { flowOwnDivision, flowDivisionAccess, divisionProblem, divisionDeniedText };
