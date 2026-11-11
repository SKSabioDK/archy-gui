// Mapper, porte og settings.json — det eneste sted programmet finder sine filer.

const fs = require('fs');
const path = require('path');

// ── Mapper ──────────────────────────────────────────────────────────────────
// src/    koden          public/  brugerfladen     docs/  skærmbilleder m.m.
// data/   kørselsdata: kunder, indstillinger, flows, Terraform (aldrig i git)
// logs/   server.log og server.err.log fra start.bat
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = process.env.ARCHY_DATA_DIR || path.join(ROOT_DIR, 'data');
const LOG_DIR  = path.join(ROOT_DIR, 'logs');

// Før v1.80 lå data og logfiler løst i projektmappen. Ved første start flyttes
// de på plads; findes filen allerede på den nye plads, røres den gamle ikke.
// Med ARCHY_DATA_DIR har man selv valgt mappen, så der flyttes intet.
const LEGACY_FILES = [
  ['customers.json', DATA_DIR], ['settings.json', DATA_DIR], ['demo-data.json', DATA_DIR],
  ['.archy-ca.pem', DATA_DIR], ['flows', DATA_DIR], ['terraform', DATA_DIR],
  ['server.log', LOG_DIR], ['server.err.log', LOG_DIR],
];
function migrateLegacyLayout({ root = ROOT_DIR, files = LEGACY_FILES } = {}) {
  const moved = [], failed = [];
  for (const [name, dir] of files) {
    const from = path.join(root, name);
    let to = path.join(dir, name);
    // start.bat har allerede åbnet en ny logfil; den gamle beholdes ved siden af
    if (fs.existsSync(to) && name.endsWith('.log')) to = to.replace(/\.log$/, '.old.log');
    if (!fs.existsSync(from)) continue;
    // En tom mappe på den nye plads (fx data/flows, som serveren eller testene
    // opretter ved indlæsning) er ikke "allerede flyttet"
    try { if (fs.statSync(to).isDirectory() && !fs.readdirSync(to).length) fs.rmdirSync(to); } catch (_) {}
    if (fs.existsSync(to)) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(from, to);
      moved.push(name);
    } catch (e) { failed.push(`${name}: ${e.code || e.message}`); }
  }
  return { moved, failed };
}

const CURRENT_VERSION = require('../package.json').version;

const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const FLOWS_DIR = path.join(DATA_DIR, 'flows');

// Indstillingerne: trin, Archy-mappe, AI og andet der vælges i programmet.
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveSettings(patch) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...loadSettings(), ...patch }, null, 2));
}

const PORT = process.env.PORT || 3737;
// Bind til loopback. Uden vært binder Express til 0.0.0.0, og så kunne enhver
// på netværket liste kunderne og migrere til produktion — der er ingen
// adgangskontrol foran. Sæt HOST hvis den bevidst skal nås udefra.
const HOST = process.env.HOST || '127.0.0.1';

module.exports = { ROOT_DIR, DATA_DIR, LOG_DIR, migrateLegacyLayout, CURRENT_VERSION,
  CUSTOMERS_FILE, FLOWS_DIR, loadSettings, saveSettings, PORT, HOST };
