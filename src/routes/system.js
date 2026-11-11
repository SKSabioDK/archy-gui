// Ruter: version, interne funktioner, konventioner, trin, log, fejlrapport og README.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { ROOT_DIR, CURRENT_VERSION, loadSettings, saveSettings } = require('../config');
const { addLog, LOG_MAX, logStore } = require('../lib/log');
const { keyMatches, internalUnlocked } = require('../lib/features');
const { STAGES, OAUTH_REDIRECT_URI, VERSION_SUFFIX } = require('../lib/conventions');
const { ENV_COLORS } = require('../lib/fields');
const { PERMISSION_CHECKS } = require('../lib/prod-rights');
const { MAX_ALIGN_PUBLISHES } = require('../lib/flow-yaml');

const router = express.Router();

// ── Version check ────────────────────────────────────────────────────────────

let versionInfo = { current: CURRENT_VERSION, latest: null, updateAvailable: false, checkedAt: null };

// Returnerer >0 hvis a er nyere end b, <0 hvis ældre, 0 hvis ens.
// Sammenligner kun MAJOR.MINOR.PATCH — pre-release-suffiks ignoreres.
function compareVersions(a, b) {
  const parse = v => String(v || '0').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  }
  return 0;
}

function checkForUpdate() {
  // Returns a Promise so callers can await the result.
  // Uses git directly — no token needed, git is already authenticated.
  return new Promise((resolve) => {
    // Step 1: fetch latest remote state (no checkout, no working-tree changes).
    exec('git fetch origin main --quiet', { cwd: ROOT_DIR, shell: 'cmd.exe', timeout: 20000, windowsHide: true }, (fetchErr) => {
      if (fetchErr) {
        versionInfo = { current: CURRENT_VERSION, latest: null, updateAvailable: false, checkedAt: new Date().toISOString() };
        addLog('WARN', `Version check: git fetch failed — ${fetchErr.message.split('\n')[0]}`, null, 'SYSTEM');
        return resolve(versionInfo);
      }
      // Step 2: read package.json from the remote ref — no disk write.
      exec('git show origin/main:package.json', { cwd: ROOT_DIR, shell: 'cmd.exe', timeout: 5000, windowsHide: true }, (showErr, stdout) => {
        if (showErr) {
          versionInfo = { current: CURRENT_VERSION, latest: null, updateAvailable: false, checkedAt: new Date().toISOString() };
          addLog('WARN', `Version check: could not read remote package.json — ${showErr.message.split('\n')[0]}`, null, 'SYSTEM');
          return resolve(versionInfo);
        }
        try {
          const latest = JSON.parse(stdout).version;
          // Sammenlign som semver, ikke med !==. Ellers meldes "opdatering
          // tilgængelig" også når man er FORAN remote (fx lige efter et bump,
          // før man har pushet).
          const updateAvailable = compareVersions(latest, CURRENT_VERSION) > 0;
          versionInfo = { current: CURRENT_VERSION, latest, updateAvailable, checkedAt: new Date().toISOString() };
          if (updateAvailable) {
            addLog('WARN', `Update available: v${latest} (running v${CURRENT_VERSION})`, null, 'SYSTEM');
          } else if (compareVersions(CURRENT_VERSION, latest) > 0) {
            addLog('INFO', `Version check: local v${CURRENT_VERSION} is ahead of origin v${latest}`, null, 'SYSTEM');
          } else {
            addLog('INFO', `Version check: up to date (v${CURRENT_VERSION})`, null, 'SYSTEM');
          }
        } catch (e) {
          versionInfo = { current: CURRENT_VERSION, latest: null, updateAvailable: false, checkedAt: new Date().toISOString() };
          addLog('WARN', `Version check: could not parse remote package.json — ${e.message}`, null, 'SYSTEM');
        }
        resolve(versionInfo);
      });
    });
  });
}

router.get('/api/features', (req, res) => res.json({ internal: internalUnlocked() }));
router.post('/api/features/unlock', (req, res) => {
  const key = String((req.body || {}).key || '').trim();
  if (!keyMatches(key)) {
    addLog('WARN', 'Activation key rejected', null, 'SYSTEM');
    return res.status(400).json({ error: 'Ukendt nøgle' });
  }
  saveSettings({ featureKey: key });
  addLog('INFO', 'Internal features unlocked', null, 'SYSTEM');
  res.json({ internal: true });
});
router.delete('/api/features', (req, res) => {
  saveSettings({ featureKey: null });
  addLog('INFO', 'Internal features locked', null, 'SYSTEM');
  res.json({ internal: false });
});

router.get('/api/version', (req, res) => res.json(versionInfo));

// Manual trigger — used by the "Check for updates" button in the UI
router.post('/api/version/check', async (req, res) => {
  const result = await checkForUpdate();
  res.json(result);
});

// Konventionerne som et script frem for et API-kald. Et kald ville komme
// asynkront, og så ville den første optegning af tavlen nå at ske uden dem.
// Et <script> i sidehovedet er indlæst før alt andet, og så findes reglerne
// bare — der er ingen rækkefølge at få galt i halsen.
router.get('/konventioner.js', (req, res) => {
  res.type('application/javascript').send(
    '// Genereret af serveren — se STAGES og VERSION_SUFFIX i src/lib/conventions.js.\n' +
    'window.KONVENTIONER = ' + JSON.stringify({
      stages: STAGES,
      envColors: ENV_COLORS,
      maxAlignPublishes: MAX_ALIGN_PUBLISHES,
      redirectUri: OAUTH_REDIRECT_URI,
      permissionChecks: PERMISSION_CHECKS,
      versionSuffix: VERSION_SUFFIX.source,
      versionSuffixFlags: VERSION_SUFFIX.flags
    }) + ';\n'
  );
});

// ── Log API ───────────────────────────────────────────────────────────────────

router.get('/api/logs', (req, res) => {
  const { from, to, level, action, customer, search, limit = '500' } = req.query;
  let entries = [...logStore].reverse(); // newest first

  if (from)     entries = entries.filter(e => e.ts >= from);
  if (to)       entries = entries.filter(e => e.ts <= to);
  if (level && level !== 'ALL')   entries = entries.filter(e => e.level === level);
  if (action && action !== 'ALL') entries = entries.filter(e => e.action === action);
  if (customer) entries = entries.filter(e => e.customer === customer);
  if (search)   entries = entries.filter(e => e.message.toLowerCase().includes(search.toLowerCase()));

  const maxItems = Math.min(parseInt(limit, 10) || 500, LOG_MAX);
  res.json(entries.slice(0, maxItems));
});

// ── Fejlrapport og ønsker ─────────────────────────────────────────────────────
// Rapporten oprettes som en GitHub-issue i brugerens egen browser: appen bygger
// en forudfyldt adresse og åbner den. Der gemmes intet token i appen, og
// skærmbilleder indsættes direkte i GitHubs editor. Loggen er allerede renset for
// hemmeligheder af addLog; den kan dog indeholde kundenavne.
const DEFAULT_ISSUE_REPO = 'skndkprivat/ArchyGUI';
const ISSUE_REPO_RE = /^(?!\.+\/)[A-Za-z0-9_.-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/;

function issueRepo() {
  const r = loadSettings().issueRepo;
  return typeof r === 'string' && ISSUE_REPO_RE.test(r) ? r : DEFAULT_ISSUE_REPO;
}

router.get('/api/report-info', (req, res) => {
  const tail = logStore.slice(-80).map(e => `${e.ts} [${e.level}] [${e.action}]${e.customer ? ' [' + e.customer + ']' : ''} ${e.message}`);
  res.json({
    repo: issueRepo(),
    version: CURRENT_VERSION,
    node: process.versions.node,
    os: `${process.platform} ${require('os').release()}`,
    log: tail,
  });
});

router.get('/api/logs/stats', (req, res) => {
  const stats = { total: logStore.length, INFO: 0, SUCCESS: 0, WARN: 0, ERROR: 0 };
  for (const e of logStore) if (stats[e.level] !== undefined) stats[e.level]++;
  res.json(stats);
});

router.post('/api/logs/clear', (req, res) => {
  logStore.length = 0;
  addLog('INFO', 'Log cleared by user', null, 'SYSTEM');
  res.json({ ok: true });
});

// ── README ────────────────────────────────────────────────────────────────────

router.get('/api/readme', (req, res) => {
  const readmePath = path.join(ROOT_DIR, 'README.md');
  if (!fs.existsSync(readmePath)) return res.status(404).json({ error: 'README.md not found' });
  res.json({ content: fs.readFileSync(readmePath, 'utf8') });
});

module.exports = { router, compareVersions, checkForUpdate, ISSUE_REPO_RE, issueRepo };
