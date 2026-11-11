// Archy GUI — indgangen. Her sættes Express op (middleware, ruter, fejl som JSON),
// og serveren startes. Koden bor i config.js, lib/ (hjælpere uden ruter) og
// routes/ (ét område pr. fil). module.exports nederst er det testene bruger.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { ROOT_DIR, DATA_DIR, LOG_DIR, migrateLegacyLayout, CUSTOMERS_FILE, FLOWS_DIR, PORT, HOST } = require('./config');

// Skal køre før noget opretter data/flows, ellers ser flows/ ud til at være flyttet.
// Kun når serveren startes — ikke når testene indlæser modulet.
const legacyMigration = require.main === module && !process.env.ARCHY_DATA_DIR ? migrateLegacyLayout() : { moved: [], failed: [] };

if (!fs.existsSync(FLOWS_DIR)) fs.mkdirSync(FLOWS_DIR, { recursive: true });

const { addLog, redactSecrets, logLevelFor } = require('./lib/log');
const { loadCustomers } = require('./lib/customers');
const { keyMatches } = require('./lib/features');
const { STAGES, stageOrder, stageListError, VERSION_SUFFIX, normType } = require('./lib/conventions');
const { EDITABLE_FIELDS, envFieldError } = require('./lib/fields');
const { sanitizeName, missingFields, describeApiError, moveCustomerFolder, stripSchemaUris,
  safeFileName, insideFlowsDir } = require('./lib/helpers');
const { wrongOrg, tenantOf, groupOf, stageOf, prefixOf, orgKeyOf, orgOwnedElsewhere, clientPinsOrg,
  rememberOrgId, belongsToEnv, stripEnvPrefix, withEnvPrefix, depNameIn, divisionOf,
  setFlowDivisionInYaml, prefixDependenciesInYaml, sameGroup, buildHierarchy } = require('./lib/environments');
const { baseFlowName, versionSuffixOf, promotionName, isPipelineOrigin, promotionNameFrom,
  carriesVersionSuffix, versionLabel } = require('./lib/names');
const { tokenStore, SESSION_FILE, setSessionPersist, saveSessions, loadSessions } = require('./lib/sessions');
const { getToken, credentialChangeError, forgetLogin, dropRejectedLogin } = require('./lib/token');
const { migrationGuard, publishedVersionOf, prefixClash, prefixChangeImpact } = require('./lib/guards');
const { prodWriteGate, PERMISSION_CHECKS, prodSettingsBlock, keepsOrgOnClientChange,
  PROD_DEPLOY_WINDOW, DEFAULT_DEPLOY_PERMISSION, PROD_WRITE_ROUTES, deployRequirements,
  permissionGranted, applyClientScopes, evaluatePermissions, rolePermissions, LIVE_PROBES,
  liveProbeResult, evaluateDeployRights, prodWriteBlock } = require('./lib/prod-rights');
const { findManifestEntry } = require('./lib/manifest-file');
const { orgManifestKey, isFlowRowKey, onlyFlowRows } = require('./lib/manifest');
const { SETUP_KEY, ensurePipelineIds, pipelinePeers, SETUP_SHARED, takenPrefixesFor, sameSibling,
  cleanSibling, setupRowFor, addForget, sameSetup, setupChanges, mergeStages, applyOrgSetup,
  siblingsFromPeers, discoveryResult } = require('./lib/setup');
const { archyArg, archyBareArg, archyVersionFlag, explainRepublishFailure, archyHint, archyVerb,
  archyCredFlags, parseArchyOutput, noteUnavailableType, typeUnavailableHere, truncateArchyError,
  archyDebugLog, withArchyLog, archyErrorReason, archyTimeoutMs } = require('./lib/archy');
const { MAX_ALIGN_PUBLISHES, renameFlowInYaml, alignmentPlan, flowContentHash, normalizeFlowYaml,
  stripEnvPrefixesInYaml, versionFromFileName, publishedVersionFor, exportFlowToYaml,
  assertYamlIsFlow, targetFlowName, yamlFlowHeader } = require('./lib/flow-yaml');
const { releaseDiff, trimOrgReleases, compactRelease, lineDiff, ORG_RELEASES_MAX, mergeReleases,
  releasesFor, rollbackCandidate, releaseNoteMarkdown } = require('./lib/releases');
const { scanYamlDependencies, FUNCTION_INTEGRATION, notMeta, promptHasContent, scanDefaultLanguage,
  scanSupportedLanguages, countsAsExisting, missingFunctionActions } = require('./lib/dependencies');
const { scanDataActionRefs, classifyDataActionRefs, autoDataActionEntries, applyDataActionMap,
  validDaEntry, mergeDaEntries, compareDataActionSets, summarizeDataActionRows, compareContracts,
  planDataActionPlacement } = require('./lib/data-action-refs');
const { flowHasDraft, isBehindModule, staleModules, groupFdaConsumers } = require('./lib/dependents');
const { scanTtsEngines, missingTtsEngines, replaceTtsEngines } = require('./lib/tts');
const { flowOwnDivision, divisionProblem } = require('./lib/divisions');
const { nodeSecurityStatus } = require('./lib/node-version');
const { compareVersions, checkForUpdate, ISSUE_REPO_RE, issueRepo } = require('./routes/system');
const { presenceLabel, presenceKeep, presenceCreateBody, languagePutBody, settingText,
  orgSettingRows } = require('./routes/orgsettings');
const { appsBaseOf, queueCreateBody, groupCreateBody, scheduleCreateBody, scheduleGroupCreateBody,
  RESOURCE_KINDS, RESOURCE_MIGRATE, SIMPLE_CREATE, stripFormIds } = require('./routes/resources');
const { COPYABLE_KINDS, identicalInTarget, buildMigrationVerdict } = require('./routes/migrate');
const { actionCategoryFor, sanitizeDatatableSchema } = require('./routes/data-actions');
const { mapRoleDivisions, buildOauthClientBody, missingRolesFor, missingDivisionsFor,
  buildRolePolicies } = require('./routes/oauth-clients');
const { prefixRenamePlan } = require('./routes/prefix');
const { parseFlowFileName } = require('./routes/files');
const { manifestSignature, rebuiltManifestRow } = require('./routes/manifest');
const { aiStore, aiOverview } = require('./routes/ai');

const app = express();

// Standardgrænsen er 100 KB, og et rigtigt Genesys-flow er større end det:
// af de 153 eksporterede YAML-filer her er ni over grænsen, den største på
// 800 KB. Import af dem svarede 413 uden nogen forklaring.
app.use(express.json({ limit: '25mb' }));
// Før alle ruter: skrivning til prod kræver et personligt login med
// rettigheden. Selve vagten står i lib/prod-rights.js.
// Tæller skrivninger i gang, så en selv-genstart (se watchForUpdates) venter på dem.
let inflightWrites = 0;
app.use((req, res, next) => {
  if (req.method === 'GET') return next();
  inflightWrites++;
  let talt = false;
  const frem = () => { if (!talt) { talt = true; inflightWrites--; } };
  res.on('finish', frem); res.on('close', frem);
  next();
});

app.use((req, res, next) => prodWriteGate(req, res, next));
app.use(express.static(path.join(ROOT_DIR, 'public')));
// Skærmbilleder og infografik som README'en viser — også på README-siden i
// programmet, hvor de ellers ville mangle.
app.use('/docs', express.static(path.join(ROOT_DIR, 'docs')));

// ── Ruter ────────────────────────────────────────────────────────────────────
// Ét område pr. fil i routes/. Rækkefølgen er den ruterne blev registreret i.
app.use(require('./routes/system').router);
app.use(require('./routes/demo').router);
app.use(require('./routes/customers').router);
app.use(require('./routes/prefix').router);
app.use(require('./routes/auth').router);
app.use(require('./routes/org-resources').router);
app.use(require('./routes/data-actions').router);
app.use(require('./routes/wrapup').router);
app.use(require('./routes/oauth-clients').router);
app.use(require('./routes/manifest').router);
app.use(require('./routes/setup').router);
app.use(require('./routes/releases').router);
app.use(require('./routes/flows').router);
app.use(require('./routes/pipeline').router);
app.use(require('./routes/resources').router);
app.use(require('./routes/terraform').router);
app.use(require('./routes/orgsettings').router);
app.use(require('./routes/files').router);
app.use(require('./routes/migrate').router);
app.use(require('./routes/ai').router);

// ── Fejl som JSON ────────────────────────────────────────────────────────────
// Skal stå EFTER alle ruter. Uden dette svarede Express med sin egen HTML-side,
// mens hele brugerfladen kalder .json() — så en fejl blev vist som
// "Unexpected token '<'" i stedet for det der gik galt.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Ukendt endpoint: ${req.method} /api${req.path}` });
});

// Fire parametre: sådan genkender Express en fejlhåndterer.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // For stor krop har sin egen kode og fortjener en forklaring man kan handle på
  const forStor = err.type === 'entity.too.large' || err.status === 413;
  const status = forStor ? 413 : (err.status || err.statusCode || 500);
  const besked = forStor
    ? 'Indholdet er for stort til at sendes til serveren.'
    : (err.message || 'Ukendt serverfejl');
  addLog('ERROR', `${req.method} ${req.originalUrl}: ${besked}`, null, 'SYSTEM');
  res.status(status).json({ error: besked });
});

// ── Genstart af sig selv ved en opdatering ──────────────────────────────────
// Ændres en kodefil under src/ eller package.json på disken (git pull, en ny
// version), starter serveren sig selv op igen — man skal ikke køre start.bat.
// Logins huskes på tværs af en genstart, så ingen skal logge ind igen.
//
// Tre sikkerheder: koden skal kunne parses (en halvt gemt fil må ikke tage
// serveren ned), der må ikke køre en skrivning (en migrering må ikke dræbes
// midtvejs — den afventer), og den nye proces overtager de samme logfiler.
// Slås fra med ARCHY_NO_AUTORESTART=1.

// Alle .js-filer under src/ — server.js er kun indgangen; ruterne og
// hjælperne ligger i routes/ og lib/.
function sourceFiles(dir = __dirname) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(f));
    else if (e.name.endsWith('.js')) out.push(f);
  }
  return out.sort();
}

function watchForUpdates(httpServer, { intervalMs = 2000, maxWaitMs = 15 * 60 * 1000 } = {}) {
  if (process.env.ARCHY_NO_AUTORESTART) return;
  // Listen dannes igen ved hvert tjek, så en ny fil fra en opdatering også ses
  const watched = () => [...sourceFiles(), path.join(ROOT_DIR, 'package.json')];
  const stamp = f => { try { const st = fs.statSync(f); return `${st.mtimeMs}:${st.size}`; } catch (_) { return ''; } };
  const seen = new Map(watched().map(f => [f, stamp(f)]));
  let pending = false;

  const restart = () => {
    addLog('INFO', 'Update on disk — restarting the server', null, 'SYSTEM');
    httpServer.close(() => {
      try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const out = fs.openSync(path.join(LOG_DIR, 'server.log'), 'a');
        const err = fs.openSync(path.join(LOG_DIR, 'server.err.log'), 'a');
        const child = require('child_process').spawn(process.execPath,
          [...process.execArgv, ...process.argv.slice(1)],
          { cwd: process.cwd(), env: process.env, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
        child.unref();
      } catch (e) { console.error('Could not restart:', e.message); }
      process.exit(0);
    });
    if (httpServer.closeAllConnections) httpServer.closeAllConnections();
  };

  const tryRestart = (waited = 0) => {
    if (inflightWrites > 0 && waited < maxWaitMs) return setTimeout(() => tryRestart(waited + intervalMs), intervalMs);
    restart();
  };

  // Hver ændret .js-fil skal kunne parses; den første der ikke kan, stopper genstarten
  const checkAll = (files, done) => {
    if (!files.length) return done(null);
    require('child_process').execFile(process.execPath, ['--check', files[0]], { windowsHide: true }, (e) => {
      if (e) return done(e, files[0]);
      checkAll(files.slice(1), done);
    });
  };

  setInterval(() => {
    if (pending) return;
    const files = watched();
    const changed = files.filter(f => stamp(f) !== seen.get(f));
    if (!changed.length) return;
    pending = true;
    // Vent til filerne er skrevet færdig, og tjek at de kan parses
    setTimeout(() => {
      checkAll(changed.filter(f => f.endsWith('.js')), (e, bad) => {
        for (const f of watched()) seen.set(f, stamp(f));
        pending = false;
        if (e) return addLog('WARN', `${path.relative(ROOT_DIR, bad)} changed but does not parse — not restarting: ${String(e.message).slice(0, 200)}`, null, 'SYSTEM');
        tryRestart();
      });
    }, 1500);
  }, intervalMs).unref();
}

// Den nye proces kan nå at starte før den gamle har sluppet porten
function retryOnPortBusy(httpServer, tries = 20) {
  httpServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries-- > 0) setTimeout(() => httpServer.listen(PORT, HOST), 500);
    else throw e;
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
// Kun når filen KØRES. Bliver den i stedet indlæst med require — det gør
// testene — må den hverken lytte på porten eller sætte et døgn-interval i gang;
// så ville `node --test` aldrig afslutte af sig selv.
if (require.main === module) {
  const flyttet = legacyMigration;
  if (flyttet.moved.length) setTimeout(() => addLog('INFO', `Moved to data/ and logs/: ${flyttet.moved.join(', ')}`, null, 'SYSTEM'), 0);
  if (flyttet.failed.length) setTimeout(() => addLog('WARN', `Could not move to data/ or logs/: ${flyttet.failed.join('; ')}`, null, 'SYSTEM'), 0);
  setSessionPersist(true);
  const huskede = loadSessions(loadCustomers());
  saveSessions();      // rydder det der er udløbet
  setInterval(saveSessions, 60 * 1000).unref();
  if (huskede) setTimeout(() => addLog('INFO', `${huskede} login(s) from the last session restored — no new login needed`, null, 'SYSTEM'), 0);
  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`Archy GUI running on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
    watchForUpdates(httpServer);
    addLog('INFO', `Archy GUI started on ${HOST}:${PORT}`, null, 'SYSTEM');
    // Check for updates on startup, then once every 24 hours
    checkForUpdate();
    setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
  });
  retryOnPortBusy(httpServer);
}

// ── Til testene ──────────────────────────────────────────────────────────────
// De rene funktioner — dem uden netværk, uden disk og uden Archy. De har hver
// især haft mindst én fejl der nåede ud til brugeren, og de er samtidig de
// eneste der kan efterprøves uden en rigtig org. Se test/*.test.js.
module.exports = {
  sourceFiles, logLevelFor, keyMatches, liveProbeResult, LIVE_PROBES, issueRepo, ISSUE_REPO_RE, presenceLabel, presenceKeep, presenceCreateBody, languagePutBody, orgSettingRows, settingText,
  nodeSecurityStatus, countsAsExisting, scanTtsEngines, missingTtsEngines, replaceTtsEngines, applyClientScopes, dropRejectedLogin, flowOwnDivision, divisionProblem, appsBaseOf, COPYABLE_KINDS, RESOURCE_KINDS, RESOURCE_MIGRATE, SIMPLE_CREATE, noteUnavailableType, typeUnavailableHere, scanDefaultLanguage, archyHint, scheduleCreateBody, scheduleGroupCreateBody, scanSupportedLanguages, watchForUpdates, identicalInTarget, promptHasContent, queueCreateBody, groupCreateBody, credentialChangeError, forgetLogin, keepsOrgOnClientChange,
  sanitizeDatatableSchema, mapRoleDivisions, buildOauthClientBody, buildRolePolicies, missingRolesFor, missingDivisionsFor,
  app, tokenStore, getToken, loadSessions, saveSessions, setSessionPersist, SESSION_FILE,
  // konventioner
  STAGES, VERSION_SUFFIX, stageListError, alignmentPlan, MAX_ALIGN_PUBLISHES, prefixRenamePlan,
  // navne og versioner
  compareVersions, baseFlowName, versionSuffixOf, promotionName, versionFromFileName,
  isPipelineOrigin, promotionNameFrom, carriesVersionSuffix, prefixClash, prefixChangeImpact,
  // releases
  lineDiff, releaseDiff, rollbackCandidate, releasesFor, releaseNoteMarkdown, flowHasDraft,
  compactRelease, trimOrgReleases, mergeReleases, ORG_RELEASES_MAX,
  parseFlowFileName, versionLabel, sanitizeName, normType,
  // function data actions
  missingFunctionActions, FUNCTION_INTEGRATION,
  // data actions i flowet
  scanDataActionRefs, classifyDataActionRefs, applyDataActionMap, autoDataActionEntries, mergeDaEntries, validDaEntry,
  compareDataActionSets, summarizeDataActionRows, compareContracts, actionCategoryFor, planDataActionPlacement,
  buildMigrationVerdict, groupFdaConsumers,
  // miljøer og præfikser
  prefixOf, orgKeyOf, rememberOrgId, wrongOrg, clientPinsOrg, orgOwnedElsewhere, belongsToEnv, stripEnvPrefix, withEnvPrefix, depNameIn,
  targetFlowName, prefixDependenciesInYaml, divisionOf,
  // hierarki og vagt
  tenantOf, groupOf, stageOf, stageOrder, sameGroup, buildHierarchy, migrationGuard,
  // YAML
  renameFlowInYaml, setFlowDivisionInYaml, assertYamlIsFlow, yamlFlowHeader, normalizeFlowYaml,
  stripEnvPrefixesInYaml, flowContentHash, scanYamlDependencies, notMeta,
  stripFormIds, stripSchemaUris,
  // manifest
  orgManifestKey, findManifestEntry, isFlowRowKey, onlyFlowRows, rebuiltManifestRow,
  // opsætningen i org'en
  manifestSignature,
  SETUP_KEY, SETUP_SHARED, setupRowFor, setupChanges, sameSetup, mergeStages, applyOrgSetup,
  ensurePipelineIds, pipelinePeers, takenPrefixesFor, discoveryResult, sameSibling, cleanSibling, addForget, siblingsFromPeers,
  // common modules
  isBehindModule, staleModules,
  // Archy og fejltekster
  archyTimeoutMs, parseArchyOutput, truncateArchyError, archyErrorReason, describeApiError,
  archyDebugLog, withArchyLog,
  explainRepublishFailure,
  archyCredFlags, archyArg, archyBareArg, archyVerb, archyVersionFlag,
  // filstier fra klienten
  insideFlowsDir, safeFileName, missingFields, FLOWS_DIR, moveCustomerFolder,
  ROOT_DIR, DATA_DIR, LOG_DIR, CUSTOMERS_FILE, migrateLegacyLayout,
  envFieldError, EDITABLE_FIELDS,
  // eksport af den rigtige udgave
  publishedVersionOf, publishedVersionFor, exportFlowToYaml,
  // maskering
  redactSecrets,
  // AI-udbydere
  aiStore, aiOverview,
  // prod kræver et personligt login med rettigheden
  PROD_WRITE_ROUTES, PROD_DEPLOY_WINDOW, DEFAULT_DEPLOY_PERMISSION,
  deployRequirements, permissionGranted, evaluateDeployRights, evaluatePermissions, rolePermissions, PERMISSION_CHECKS, prodWriteBlock, prodSettingsBlock
};
