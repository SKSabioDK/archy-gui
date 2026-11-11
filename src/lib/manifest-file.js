// Det lokale migreringsmanifest (data/flows/.migrations.json).

const fs = require('fs');
const path = require('path');
const { FLOWS_DIR } = require('../config');
const { addLog } = require('./log');
const { normType } = require('./conventions');
const { baseFlowName } = require('./names');

// ── Migreringsmanifest ────────────────────────────────────────────────────────
// Hvad blev migreret hvorhen, og hvilket indhold havde det.
//
// Nøglen er Genesys' EGEN org-id — ikke vores lokale kunde-id. Med ti kunder
// der hver har dev/uat/prod er det afgørende at en post entydigt hører til én
// org: kunde-id'er er lokale tidsstempler der ændrer sig hvis en kunde slettes
// og oprettes igen, mens org-id'et følger organisationen.
const MANIFEST_FILE = path.join(FLOWS_DIR, '.migrations.json');

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); } catch (_) { return []; }
}

// Find posten for ét flow i én mål-org. Matcher på org-id når det findes,
// ellers på det lokale kunde-id, så ældre poster stadig kan slås op.
// Sammenlignes på grundnavnet. Et flow skifter navn når det forfremmes
// ("Aabningstider" → "_v10" → "_v15"), og matchede vi på det fulde navn, ville
// hver omdøbning efterlade den gamle linje forældreløs og lave en ny ved siden
// af — så ville vi hverken kunne slå op eller opdatere.
function findManifestEntry(all, { targetOrgId, targetId, flowName, flowType }) {
  const ft = normType(flowType);
  const base = baseFlowName(flowName);
  return all.find(e =>
    baseFlowName(e.flowName) === base && normType(e.flowType) === ft &&
    (e.targetOrgId && targetOrgId ? e.targetOrgId === targetOrgId : e.targetId === targetId));
}

function recordManifest(entry) {
  try {
    const all = loadManifest();
    entry.flowType = normType(entry.flowType);
    // Én linje pr. (mål-org, flow) — den nyeste hændelse er den gældende.
    // Grundnavnet er nøglen, så en omdøbning opdaterer linjen i stedet for at
    // lægge en ny ved siden af.
    const base = baseFlowName(entry.flowName);
    const i = all.findIndex(e =>
      baseFlowName(e.flowName) === base && normType(e.flowType) === entry.flowType &&
      (e.targetOrgId && entry.targetOrgId ? e.targetOrgId === entry.targetOrgId : e.targetId === entry.targetId));
    if (i >= 0) all[i] = { ...all[i], ...entry }; else all.push(entry);
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(all, null, 2));
  } catch (e) {
    addLog('WARN', `Could not write the migration manifest: ${e.message}`, null, 'SYSTEM');
  }
}

module.exports = { loadManifest, MANIFEST_FILE, recordManifest, findManifestEntry };
