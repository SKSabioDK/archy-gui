// Ruter: migrering af et flow med dets afhængigheder, og tjek før forfremmelse.

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { FLOWS_DIR, PORT } = require('../config');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { FLOW_KINDS, normType } = require('../lib/conventions');
const { sanitizeName, describeApiError, insideFlowsDir } = require('../lib/helpers');
const { tenantOf, groupOf, stageOf, prefixOf, orgKeyOf, stripEnvPrefix, depNameIn, divisionOf,
  setFlowDivisionInYaml, prefixDependenciesInYaml, sameGroup } = require('../lib/environments');
const { baseFlowName } = require('../lib/names');
const { getToken } = require('../lib/token');
const { getFlowPublishInfo } = require('../lib/genesys');
const { migrationGuard, publishedVersionOf } = require('../lib/guards');
const { recordManifest } = require('../lib/manifest-file');
const { getOrgId, whoAmI } = require('../lib/manifest');
const { recordOrgManifest } = require('../lib/setup');
const { runArchy, archyArg, archyBareArg, archyVersionFlag, archyHint, archyVerb,
  noteUnavailableType, typeUnavailableHere, importFinishedDespiteTimeout } = require('../lib/archy');
const { renameFlowInYaml, alignmentPlan, flowContentHash, versionFromFileName, publishedVersionFor,
  exportFlowToYaml, targetFlowName } = require('../lib/flow-yaml');
const { recordReleaseEverywhere, saveSnapshot, releaseDiff, releaseRef } = require('../lib/releases');
const { scanYamlDependencies, scanDefaultLanguage, scanSupportedLanguages, lookupExisting,
  functionActionsMissingInTarget } = require('../lib/dependencies');
const { listDataActions, scanDataActionRefs, classifyDataActionRefs, autoDataActionEntries,
  applyDataActionMap, validDaEntry, mergeDaEntries, loadDataActionMap, saveDataActionMap } = require('../lib/data-action-refs');
const { dependentsOf } = require('../lib/dependents');
const { TTS_DEFAULT, scanTtsEngines, missingTtsEngines, replaceTtsEngines, targetTtsEngines,
  applyTtsChoice } = require('../lib/tts');
const { flowOwnDivision, flowDivisionAccess, divisionProblem, divisionDeniedText } = require('../lib/divisions');

const router = express.Router();

// Ressourcer der kopieres hele fra kilden ved navn: user prompts (med lyd) og scripts
const COPYABLE_KINDS = new Set(['prompt', 'script', 'queue', 'group', 'schedule', 'schedulegroup', 'skill', 'utilizationlabel', 'knowledgebase', 'contactlist']);
// Endpoint og navnefelt for hver slags der kopieres ved navn
const COPY_ENDPOINT = {
  prompt: ['/api/prompts/migrate', 'promptName'], script: ['/api/scripts/migrate', 'scriptName'],
  queue: ['/api/queues/migrate', 'name'], group: ['/api/groups/migrate', 'name'],
  schedule: ['/api/schedules/migrate', 'name'], schedulegroup: ['/api/schedulegroups/migrate', 'name'],
  skill: ['/api/skills/migrate', 'name'],
  utilizationlabel: ['/api/resources/create', 'name', 'utilization'], knowledgebase: ['/api/resources/create', 'name', 'knowledgebases'],
  contactlist: ['/api/resources/create', 'name', 'contactlists']
};

// Migrerer ét flow som afhængighed af et andet. Modulet kan selv have
// afhængigheder — også andre common modules — så de tages først, nedefra og op.
// 'visited' bryder cirkler, og dybden er begrænset for en sikkerheds skyld.
async function migrateFlowDependency(source, target, flowName, flowType, visited, depth, trail, opts = {}) {
  const key = `${flowType}|${flowName}`;
  if (visited.has(key)) return { ok: true, skipped: 'cycle' };
  visited.add(key);
  if (depth > 5) return { ok: false, error: `Dependency tree too deep at "${flowName}"` };

  const exportDir = path.join(FLOWS_DIR, sanitizeName(source.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const mtimes = f => { try { return fs.statSync(path.join(exportDir, f)).mtimeMs; } catch (_) { return 0; } };
  const before = new Map(fs.readdirSync(exportDir).filter(f => f.endsWith('.yaml')).map(f => [f, mtimes(f)]));

  // Også for en afhængighed: den udgave der er i drift, ikke nogens kladde.
  const depVersion = await publishedVersionFor(source, flowName, flowType, 'MIGRATE');

  await runArchy(
    `export --flowName ${archyArg(flowName, 'Flow name')} ` +
    `--flowType ${archyBareArg(String(flowType).toLowerCase(), 'Flow type')} ` +
    archyVersionFlag(depVersion) +
    `--exportType yaml --force --outputDir ${archyArg(exportDir, 'Directory')}`,
    source
  );
  const touched = fs.readdirSync(exportDir).filter(f => f.endsWith('.yaml'))
    .filter(f => !before.has(f) || mtimes(f) > before.get(f))
    .sort((a, b) => mtimes(b) - mtimes(a));
  if (!touched.length) return { ok: false, error: `The export wrote no YAML file for "${flowName}"` };
  const filePath = path.join(exportDir, touched[0]);

  // Modulets egne afhængigheder først — ellers fejler dets import af samme
  // grund som flowets ville have gjort.
  const depYaml = fs.readFileSync(filePath, 'utf8');
  const deps = scanYamlDependencies(depYaml);
  const ctx = { languages: scanSupportedLanguages(depYaml), defaultLanguage: scanDefaultLanguage(depYaml) };
  const { token: tgtToken, apiBase: tgtBase } = await getToken(target);

  // 1) Tabeller, data actions, prompts og scripts modulet bruger
  for (const kind of ['datatable', 'dataaction', 'surveyform', ...COPYABLE_KINDS]) {
    const names = deps[kind] || [];
    if (!names.length) continue;
    // Uvished er ikke det samme som fravær. Fejlen her blev før slugt, og den
    // tomme mængde betød "alt mangler" — så oprettede vi tabeller og data
    // actions i mål-org'en som allerede lå der. Et udløbet token eller en
    // manglende rettighed var nok: opslaget svarer 401 og kaster.
    // Bærer typen miljøets præfiks, er det DET navn der skal findes — ellers
    // ser en tabel i prod (samme org) ud som om den allerede var i dev.
    const wanted = names.map(n => depNameIn(kind, n, target, source));
    let existing;
    try { existing = await lookupExisting(kind, wanted, tgtToken, tgtBase, ctx); }
    catch (e) {
      const besked = `Could not look up ${kind} in "${target.name}": ${describeApiError(e)}`;
      trail.push(`✗ ${besked}`);
      return { ok: false, error: besked };
    }
    const missing = names.filter((n, i) => !existing.has(wanted[i]));
    if (!missing.length) continue;

    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const SH = { headers: { Authorization: `Bearer ${srcToken}` } };
    for (const n of missing) {
      let url, body;
      if (kind === 'surveyform') {
        url = '/api/surveyforms/migrate';
        body = { sourceId: source.id, targetId: target.id, name: n };
      } else if (COPYABLE_KINDS.has(kind)) {
        // Kopieres ved navn — endpointet slår selv kilden op
        const [ep, felt, resKind] = COPY_ENDPOINT[kind];
        url = ep;
        body = { sourceId: source.id, targetId: target.id, [felt]: n, ...(resKind ? { kind: resKind } : {}) };
      } else if (kind === 'datatable') {
        const r = await axios.get(`${srcBase}/api/v2/flows/datatables`, { ...SH, params: { pageSize: 200 } });
        const hit = (r.data.entities || []).find(t => t.name === n);
        if (!hit) { trail.push(`⚠ tabel "${n}" findes ikke i kilde-org`); continue; }
        url = '/api/datatables/migrate';
        body = { sourceId: source.id, targetId: target.id, tableId: hit.id };
      } else {
        let all = [], p = 1;
        while (true) {
          const r = await axios.get(`${srcBase}/api/v2/integrations/actions`, { ...SH, params: { pageSize: 100, pageNumber: p } });
          const e = r.data.entities || []; all = all.concat(e);
          if (e.length < 100) break; p++;
        }
        const hit = all.find(a => a.name === n);
        if (!hit) { trail.push(`⚠ action "${n}" findes ikke i kilde-org`); continue; }
        url = '/api/actions/migrate';
        body = { sourceId: source.id, targetId: target.id, actionId: hit.id, targetIntegrationId: '' };
      }
      // Kald vores egne, allerede gennemtestede endpoints internt frem for at
      // duplikere deres logik her.
      const resp = await fetch(`http://127.0.0.1:${PORT}${url}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(r => r.json()).catch(e => ({ error: e.message }));

      if (resp.error === 'already_exists') { trail.push(`· ${kind} "${n}" fandtes allerede`); continue; }
      if (resp.error) {
        trail.push(`✗ ${kind} "${n}": ${resp.error}`);
        return { ok: false, error: `${kind} "${n}" kunne ikke migreres: ${resp.error}` };
      }
      trail.push(`✓ ${kind} "${n}"`);
    }
  }

  // 2) Modulets egne flow-referencer
  for (const kind of FLOW_KINDS) {
    const names = deps[kind] || [];
    if (!names.length) continue;
    // Samme som ovenfor: fejler opslaget, ved vi ikke om flowet er der, og så
    // migrerer vi ikke oveni i blinde.
    const wanted = names.map(n => depNameIn(kind, n, target, source));
    let existing;
    try { existing = await lookupExisting(kind, wanted, tgtToken, tgtBase, ctx); }
    catch (e) {
      const besked = `Could not look up ${kind} in "${target.name}": ${describeApiError(e)}`;
      trail.push(`✗ ${besked}`);
      return { ok: false, error: besked };
    }
    for (const [i, n] of names.entries()) {
      if (existing.has(wanted[i])) continue;
      const { token: srcToken, apiBase: srcBase } = await getToken(source);
      const fr = await axios.get(`${srcBase}/api/v2/flows`, {
        headers: { Authorization: `Bearer ${srcToken}` }, params: { pageSize: 100, name: n }
      });
      const hit = (fr.data.entities || []).find(f => f.name === n);
      if (!hit) { trail.push(`⚠ "${n}" findes ikke i kilde-org — springes over`); continue; }
      const sub = await migrateFlowDependency(source, target, hit.name, hit.type, visited, depth + 1, trail, opts);
      trail.push((sub.ok ? '✓ ' : '✗ ') + `${hit.name} (${hit.type})` + (sub.error ? ': ' + sub.error : ''));
      if (!sub.ok) return { ok: false, error: `Underafhængighed "${hit.name}" fejlede: ${sub.error}` };
    }
  }

  // Samme omskrivning som for selve flowet: målets præfiks på navnet og på det
  // flowet peger på, og målets division. Uden den blev afhængigheden publiceret
  // under KILDENS navn — og bor kilde og mål i samme org (dev og prod med hvert
  // sit præfiks), er det kildens eget flow der fik en ny udgave.
  const nyName = targetFlowName(flowName, source, target);
  if (orgKeyOf(source) === orgKeyOf(target) && nyName === flowName) {
    const besked = `"${flowName}" would be published over the source flow itself: ${source.name} and ${target.name} share an org and the name would not change`;
    trail.push(`✗ ${besked}`);
    addLog('ERROR', `Flow dependency refused: ${besked}`, target.name, 'MIGRATE');
    return { ok: false, error: besked };
  }
  let importFile = filePath;
  const nyDivision = divisionOf(target);
  let omskriv = prefixOf(source) !== prefixOf(target) || divisionOf(source) !== nyDivision;
  // Divisionen modulet oprettes i. Mangler den i målet, lægges modulet i
  // målmiljøets division (Home, hvis der ingen er) — samme regel som for
  // tabeller og wrap-up-koder. Må login'et ikke oprette flows dér, stopper vi
  // før importen med en besked, der siger hvad der skal gøres.
  try {
    const access = await flowDivisionAccess(target);
    const egen = omskriv ? nyDivision : flowOwnDivision(fs.readFileSync(filePath, 'utf8'));
    let problem = divisionProblem(egen, access);
    if (problem === 'missing' && !omskriv) {
      trail.push(`⚠ ${flowName}: divisionen "${egen}" findes ikke i ${target.name} — lægges i "${nyDivision}"`);
      addLog('WARN', `Division "${egen}" does not exist in ${target.name} — "${flowName}" goes into "${nyDivision}"`, target.name, 'MIGRATE');
      omskriv = true;
      problem = divisionProblem(nyDivision, access);
    }
    const blokeret = problem === 'denied' ? (omskriv ? nyDivision : egen) : null;
    if (blokeret) {
      addLog('ERROR', `Flow dependency "${flowName}" refused: the login may not create flows in division "${blokeret}" in ${target.name}`, target.name, 'MIGRATE');
      return { ok: false, error: divisionDeniedText(blokeret, target) };
    }
  } catch (e) {
    addLog('WARN', `Could not check the divisions in ${target.name}: ${describeApiError(e)}`, target.name, 'MIGRATE');
  }
  // Valgte brugeren at skifte TTS-motorer målet ikke har, gælder det også moduler.
  let ttsYaml = null;
  if (opts.ttsReplace) {
    try {
      const raa = fs.readFileSync(filePath, 'utf8');
      const ny = await applyTtsChoice(raa, target, flowName, trail);
      if (ny !== raa) ttsYaml = ny;
    } catch (e) { addLog('WARN', `Could not read the TTS engines in ${target.name}: ${describeApiError(e)}`, target.name, 'MIGRATE'); }
  }
  if (ttsYaml && !omskriv) {
    importFile = path.join(path.dirname(filePath), `.import-${sanitizeName(target.name)}-${path.basename(filePath)}`);
    fs.writeFileSync(importFile, ttsYaml, 'utf8');
  }
  if (omskriv) {
    let yaml = ttsYaml || fs.readFileSync(filePath, 'utf8');
    yaml = setFlowDivisionInYaml(yaml, nyDivision);
    if (nyName !== flowName) yaml = renameFlowInYaml(yaml, nyName);
    const pre = prefixDependenciesInYaml(yaml, source, target);
    yaml = pre.yaml;
    for (const omskrevet of pre.changed) addLog('INFO', `Reference rewritten: ${omskrevet}`, target.name, 'MIGRATE');
    if (nyName !== flowName) addLog('INFO', `Renamed for the target environment: "${flowName}" → "${nyName}"`, target.name, 'MIGRATE');
    importFile = path.join(path.dirname(filePath), `.import-${sanitizeName(target.name)}-${path.basename(filePath)}`);
    fs.writeFileSync(importFile, yaml, 'utf8');
  }

  // Publicér — et modul skal være publiceret for at kunne refereres af et flow
  try {
    const startedAt = Date.now();
    try {
      await runArchy(`publish --file ${archyArg(importFile, 'File path')}`, target);
    } catch (e) {
      if (!(e.timedOut && await importFinishedDespiteTimeout(target, nyName, flowType, 'publish', startedAt, false))) throw e;
      addLog('WARN', `Archy timed out on dependency "${nyName}" but it is published in ${target.name} — treated as migrated`, target.name, 'MIGRATE');
    }
    addLog('SUCCESS', `Flow dependency "${nyName}" (${flowType}) migrated to ${target.name}`, target.name, 'MIGRATE');
    return { ok: true };
  } catch (e) {
    if (/already exists/i.test(e.message || '')) return { ok: true, skipped: 'exists' };
    return { ok: false, error: archyHint(e.message) };
  } finally {
    if (importFile !== filePath) { try { fs.unlinkSync(importFile); } catch (_) {} }
  }
}

// Opretter en manglende division i mål-org'en.
router.post('/api/divisions/create', async (req, res) => {
  const { targetId, name } = req.body;
  const target = loadCustomers().find(c => c.id === targetId);
  if (!target) return res.status(404).json({ error: 'Customer not found' });
  try {
    const { token, apiBase } = await getToken(target);
    const H = { headers: { Authorization: `Bearer ${token}` } };
    const ex = await axios.get(`${apiBase}/api/v2/authorization/divisions`, { ...H, params: { pageSize: 200 } });
    if ((ex.data.entities || []).some(d => d.name === name))
      return res.status(409).json({ error: 'already_exists', message: `Division "${name}" findes allerede` });

    const r = await axios.post(`${apiBase}/api/v2/authorization/divisions`, { name },
      { headers: { ...H.headers, 'Content-Type': 'application/json' } });
    addLog('SUCCESS', `Division "${name}" created in ${target.name}`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Could not create division "${name}": ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

router.post('/api/flows/migrate-dependency', async (req, res) => {
  const { sourceId, targetId, flowName, flowType, ttsReplace } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  const trail = [];
  try {
    const r = await migrateFlowDependency(source, target, flowName, flowType, new Set(), 0, trail, { ttsReplace: !!ttsReplace });
    if (!r.ok) {
      addLog('ERROR', `Flow dependency "${flowName}" failed: ${r.error}`, target.name, 'MIGRATE');
      return res.status(500).json({ error: r.error, trail });
    }
    res.json({ ok: true, skipped: r.skipped, trail });
  } catch (e) {
    addLog('ERROR', `Flow dependency "${flowName}" failed: ${e.message}`, target.name, 'MIGRATE');
    res.status(500).json({ error: e.message, trail });
  }
});

// Fase 1 af en flow-migrering: eksportér fra kilden og undersøg om alt flowet
// bruger findes i mål-org'en. Der importeres IKKE her — mål-org'en røres ikke
// før brugeren har set rapporten og bekræftet.
router.post('/api/migrate/prepare', async (req, res) => {
  const { sourceId, targetId, flowName, flowType } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  const pre = await migrationPreflight(source, target, flowName, flowType, req.body);
  if (pre.refused) return res.status(pre.refused.status).json(pre.refused.body);

  if (typeUnavailableHere(target, flowType)) {
    addLog('WARN', `"${flowName}" not prepared: ${String(flowType).toUpperCase()} was refused by ${target.name} earlier`, target.name, 'MIGRATE');
    return res.status(409).json({ code: 'type-unavailable', error:
      `${String(flowType).toUpperCase()} blev afvist af ${target.name} for lidt siden — målet mangler det produkt, typen kræver. ` +
      `Intet er migreret for dette flow. Aktivér produktet og prøv igen (spærringen udløber af sig selv efter en halv time, eller ved genstart).` });
  }
  addLog('INFO', `Migration prepared: "${flowName}" from ${source.name} → ${target.name}`, source.name, 'MIGRATE');
  try {
    const analysis = await analyzeFlowForMigration(source, target, flowName, flowType, pre.kildeVersion);
    // Før der migreres noget med: ellers blev tabeller og moduler lagt i målet
    // for et flow, der alligevel ikke måtte oprettes.
    if (analysis.divisionDenied)
      return res.status(409).json({ code: 'division-denied', division: analysis.divisionDenied,
                                    error: divisionDeniedText(analysis.divisionDenied, target) });
    // Står målet allerede på samme indhold, er der intet at migrere. Sparer
    // tjek af afhængigheder, import og publicering — og undgår en ny version
    // i målet uden at noget har ændret sig.
    let identical = null;
    if (req.body.skipIdentical && analysis.filePath) {
      try { identical = await identicalInTarget(source, target, flowName, flowType, analysis.filePath); }
      catch (e) { addLog('WARN', `Could not compare "${flowName}" with ${target.name}: ${describeApiError(e)} — migrating normally`, target.name, 'MIGRATE'); }
      if (identical) addLog('INFO', `"${flowName}" is identical in ${target.name} (v${identical.version}) — skipped`, target.name, 'MIGRATE');
    }
    res.json({ ok: true, ...analysis, identical });
  } catch (e) {
    addLog('ERROR', `Migration prepare failed for "${flowName}": ${e.message}`, source.name, 'MIGRATE');
    res.status(500).json({ error: e.message });
  }
});

// Har målet allerede en PUBLICERET udgave med samme indhold som den eksporterede
// fil? Samme sammenligning som pipelinen bruger: miljøpræfikser og division
// normaliseres væk, så DEV_Main og Main kan kendes som samme flow. Alt andet
// end et sikkert ja giver null — så migreres der som sædvanligt.
async function identicalInTarget(source, target, flowName, flowType, filePath) {
  const nyName = targetFlowName(flowName, source, target);
  const { found, published } = await publishedVersionOf(target, nyName, flowType);
  if (!found || !published) return null;
  const tgt = await exportFlowToYaml(target, nyName, flowType, published);
  const same = flowContentHash(fs.readFileSync(filePath, 'utf8'), source) === flowContentHash(tgt.yaml, target);
  return same ? { version: published, name: nyName } : null;
}

// Vagterne før en flytning, og hvilken udgave der skal eksporteres. Delt mellem
// prepare og tjekket, så de to aldrig er uenige om hvad der må lade sig gøre.
async function migrationPreflight(source, target, flowName, flowType, body) {
  const blocked = migrationGuard(source, target, body);
  if (blocked) {
    addLog('WARN', `Migration blocked (${blocked.code}): "${flowName}" ${source.name} → ${target.name}`, source.name, 'MIGRATE');
    return { refused: { status: 409, body: blocked } };
  }
  // Indenfor en gruppe er dette en forfremmelse, og så gælder rækkefølgen:
  // publicér og test i kilden, forfrem derefter.
  //
  // Samme opslag afgør nu OGSÅ hvilken udgave der eksporteres. Før sagde vagten
  // god for flowet fordi det var publiceret, mens eksporten tog 'latest' — altså
  // kladden. Vi lovede ét og sendte noget andet af sted.
  let kildeVersion = null;
  try {
    const { found, published } = await publishedVersionOf(source, flowName, flowType);
    if (found && !published && sameGroup(source, target)) {
      const msg = `"${flowName}" er ikke publiceret i ${source.name}. Publicér og test det dér, før du forfremmer.`;
      // Vejledningen til brugeren står på dansk i svaret; loggen skal være engelsk.
      addLog('WARN', `Migration blocked (unpublished-source): "${flowName}" is not published in ${source.name}`, source.name, 'MIGRATE');
      return { refused: { status: 409, body: { code: 'unpublished-source', error: msg } } };
    }
    kildeVersion = published;
    if (found && !published)
      addLog('WARN', `"${flowName}" has no published version in ${source.name} — exporting the saved draft`, source.name, 'MIGRATE');
  } catch (e) {
    // Kan vi ikke slå det op, standser vi ikke migreringen på et gæt.
    addLog('WARN', `Could not check the published version in ${source.name}: ${describeApiError(e)}`, source.name, 'MIGRATE');
  }
  return { kildeVersion };
}

// Eksportér flowet fra kilden og undersøg alt det refererer til i målet.
// Skriver intet i mål-org'en.
async function analyzeFlowForMigration(source, target, flowName, flowType, kildeVersion) {
  const exportDir = path.join(FLOWS_DIR, sanitizeName(source.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  {
    // Find den eksporterede fil på hvad eksporten faktisk rørte — ikke på
    // navnelighed. Den gamle heuristik matchede flownavnet mod filnavnet og
    // faldt ellers tilbage på "sidste fil i mappen", hvilket kunne udpege et
    // vilkårligt gammelt eksport og dermed migrere et helt andet flow.
    const mtimes = f => { try { return fs.statSync(path.join(exportDir, f)).mtimeMs; } catch (_) { return 0; } };
    const before = new Map(fs.readdirSync(exportDir).filter(f => f.endsWith('.yaml')).map(f => [f, mtimes(f)]));

    await runArchy(
      `export --flowName ${archyArg(flowName, 'Flow name')} ` +
      `--flowType ${archyBareArg(String(flowType).toLowerCase(), 'Flow type')} ` +
      archyVersionFlag(kildeVersion) +
      `--exportType yaml --force --outputDir ${archyArg(exportDir, 'Directory')}`,
      source
    );

    const touched = fs.readdirSync(exportDir)
      .filter(f => f.endsWith('.yaml'))
      .filter(f => !before.has(f) || mtimes(f) > before.get(f))
      .sort((a, b) => mtimes(b) - mtimes(a));
    if (!touched.length) throw new Error(`The export wrote no YAML file for "${flowName}"`);
    const yamlFile = touched[0];
    const filePath = path.join(exportDir, yamlFile);
    const yaml = fs.readFileSync(filePath, 'utf8');
    addLog('SUCCESS', `Export ok: ${yamlFile}`, source.name, 'MIGRATE');

    const deps = scanYamlDependencies(yaml);
    const ctx = { languages: scanSupportedLanguages(yaml), defaultLanguage: scanDefaultLanguage(yaml) };
    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);

    // Kilde-opslag bruges kun til at finde id'er på det der kan auto-migreres
    let srcTables = [], srcActions = [], srcInts = {}, srcFlows = [];
    const needSource = [];
    const results = [];

    for (const kind of Object.keys(deps)) {
      const names = deps[kind];
      if (!names.length) continue;
      // Bærer typen miljøets præfiks, skal vi lede efter DET navn. Ellers sagde
      // tjekket "alt findes" fordi prods tabel ligger i samme org — og flowet
      // blev importeret pegende på prods data.
      const wanted = names.map(n => depNameIn(kind, n, target, source));
      let existing;
      try {
        existing = await lookupExisting(kind, wanted, tgtToken, tgtBase, ctx);
      } catch (e) {
        // Kunne målet ikke læses (fx et manglende scope på OAuth-klienten), ved
        // vi ikke om ressourcen mangler. Før blev den regnet for manglende og
        // tilbudt migreret — og hver migrering fejlede så på samme opslag.
        const checkError = describeApiError(e);
        addLog('WARN', `Could not check ${kind} in ${target.name}: ${checkError}`, target.name, 'MIGRATE');
        for (const name of names) {
          const iMaal = depNameIn(kind, name, target, source);
          results.push({ kind, name, ok: false, unchecked: true, manualReason: 'unchecked', checkError,
                         targetName: iMaal !== name ? iMaal : undefined });
        }
        continue;
      }
      for (const name of names) {
        const iMaal = depNameIn(kind, name, target, source);
        const ok = existing.has(iMaal);
        results.push({ kind, name, ok, targetName: iMaal !== name ? iMaal : undefined });
        if (!ok && (kind === 'datatable' || kind === 'dataaction' || COPYABLE_KINDS.has(kind) || FLOW_KINDS.has(kind))) needSource.push(kind);
      }
    }

    // Et common module / bot flow / transfer-mål ER et flow, så det kan
    // migreres med præcis samme maskineri som alt andet. Vi slår det op i
    // kilden for at få dets rigtige flowtype med.
    if (needSource.some(k => FLOW_KINDS.has(k))) {
      const { token: srcToken, apiBase: srcBase } = await getToken(source);
      let page = 1;
      while (true) {
        const r = await axios.get(`${srcBase}/api/v2/flows`, {
          headers: { Authorization: `Bearer ${srcToken}` },
          params: { pageSize: 100, pageNumber: page }
        });
        const e = r.data.entities || [];
        srcFlows = srcFlows.concat(e);
        if (e.length < 100) break;
        page++;
      }
    }

    // Slå kun kilden op hvis der faktisk mangler noget vi kan migrere
    if (needSource.includes('datatable') || needSource.includes('dataaction')) {
      const { token: srcToken, apiBase: srcBase } = await getToken(source);
      const SH = { headers: { Authorization: `Bearer ${srcToken}` } };
      if (needSource.includes('datatable')) {
        const r = await axios.get(`${srcBase}/api/v2/flows/datatables`, { ...SH, params: { pageSize: 200 } });
        srcTables = r.data.entities || [];
      }
      if (needSource.includes('dataaction')) {
        let page = 1;
        while (true) {
          const r = await axios.get(`${srcBase}/api/v2/integrations/actions`, { ...SH, params: { pageSize: 100, pageNumber: page } });
          const e = r.data.entities || [];
          srcActions = srcActions.concat(e);
          if (e.length < 100) break;
          page++;
        }
        const ri = await axios.get(`${srcBase}/api/v2/integrations`, { ...SH, params: { pageSize: 200 } });
        for (const i of ri.data.entities || []) srcInts[i.id] = i.integrationType?.id || '';
      }
    }

    // Prompts og scripts kopieres hele, så det eneste vi skal vide er om
    // kilden har dem under samme navn.
    const inSource = {};
    for (const kind of COPYABLE_KINDS) {
      const names = results.filter(r => r.kind === kind && !r.ok).map(r => r.name);
      if (!names.length) continue;
      const { token: srcToken, apiBase: srcBase } = await getToken(source);
      try { inSource[kind] = await lookupExisting(kind, names, srcToken, srcBase, ctx); }
      catch (e) {
        const checkError = describeApiError(e);
        addLog('WARN', `Could not look up ${kind} in ${source.name}: ${checkError}`, source.name, 'MIGRATE');
        inSource[kind] = { error: checkError };
      }
    }

    // Marker hvad der kan migreres automatisk og hvad der kræver håndarbejde
    for (const r of results) {
      if (r.ok || r.unchecked) continue;
      if (r.kind === 'datatable') {
        const hit = srcTables.find(t => t.name === r.name);
        if (hit) { r.canMigrate = true; r.sourceRefId = hit.id; }
        else r.manualReason = 'not_in_source';
      } else if (r.kind === 'dataaction') {
        const hit = srcActions.find(a => a.name === r.name);
        if (!hit) r.manualReason = 'not_in_source';
        else if (srcInts[hit.integrationId] === 'function-data-actions') {
          r.manualReason = 'function';   // functionen kan ikke oprettes via API
          r.integrationType = 'function-data-actions';
          r.blocking = true;             // flowet kan ikke forfremmes før den findes i målet
        } else { r.canMigrate = true; r.sourceRefId = hit.id; r.integrationType = srcInts[hit.integrationId] || ''; }
      } else if (FLOW_KINDS.has(r.kind)) {
        const hit = srcFlows.find(f => f.name === r.name);
        if (!hit) r.manualReason = 'not_in_source';
        else { r.canMigrate = true; r.flowName = hit.name; r.flowType = hit.type; }
      } else if (COPYABLE_KINDS.has(r.kind)) {
        const src = inSource[r.kind];
        if (src?.error) { r.unchecked = true; r.manualReason = 'unchecked'; r.checkError = src.error; }
        else if (src?.has(r.name)) r.canMigrate = true;
        else r.manualReason = 'not_in_source';
      } else if (r.kind === 'division') {
        // En manglende division kan enten oprettes, eller flowet kan lægges i
        // Home i stedet. Begge dele er indgreb, så brugeren skal vælge.
        r.needsChoice = true;
        r.choices = ['create', 'useHome', 'skip'];
      } else if (r.kind === 'surveyform') {
        // Survey forms har en fuld definition der kan kopieres
        r.needsChoice = true;
        r.choices = ['copy', 'skip'];
      } else {
        r.manualReason = 'manual_only';  // køer, skills, wrapup-koder, brugere m.m.
      }
    }

    // Alt der mangler skal kunne findes igen i systemloggen
    const missing = results.filter(r => !r.ok);
    for (const m of missing) {
      addLog('WARN',
        `Missing in ${target.name}: ${m.kind} "${m.name}"` +
        (m.canMigrate ? ' — can be migrated from here' :
         m.manualReason === 'function' ? ' — Function Data Action, must be created by hand (no API)' :
         m.manualReason === 'not_in_source' ? ' — does not exist in the source org either' :
         m.manualReason === 'unchecked' ? ' — could not be checked, see the warning above' :
         ' — must be created by hand'),
        target.name, 'MIGRATE');
    }
    if (!missing.length) addLog('SUCCESS', `All dependencies for "${flowName}" exist in ${target.name}`, target.name, 'MIGRATE');

    // Hvilke data actions flowet kalder, og hvordan de står i målet: samme
    // kategori og navn, et gemt valg, samme navn under en anden kategori, eller
    // slet ikke. Kun navnet blev tjekket før, og det overså en anden kategori.
    let actionRefs = [], targetActions = [];
    try {
      const refs = scanDataActionRefs(yaml);
      if (refs.length) {
        const all = await listDataActions(tgtToken, tgtBase);
        const saved = await loadDataActionMap(source, target);
        actionRefs = classifyDataActionRefs(refs, all, saved);
        // Et gemt valg gør at navnet ikke mangler, selv om det ikke står i målet.
        for (const ref of actionRefs.filter(r => r.status === 'mapped'))
          for (const d of results.filter(x => x.kind === 'dataaction' && x.name === ref.name && !x.ok)) {
            d.ok = true; d.mappedTo = ref.mappedTo;
            delete d.canMigrate; delete d.manualReason; delete d.blocking;
          }
        if (actionRefs.some(r => r.status !== 'exact'))
          targetActions = all.map(a => ({ category: a.category, name: a.name }));
      }
    } catch (e) {
      addLog('WARN', `Could not compare the data actions of "${flowName}" with ${target.name}: ${describeApiError(e)}`, target.name, 'MIGRATE');
    }
    // TTS-motorer flowet taler med, som målet ikke har
    try {
      const tts = scanTtsEngines(yaml);
      if (tts.some(e => e.engine !== TTS_DEFAULT)) {
        const motorer = await targetTtsEngines(target);
        const udenStemme = replaceTtsEngines(yaml, motorer).unresolved;
        for (const engine of missingTtsEngines(tts, motorer)) {
          const sprog = tts.filter(e => e.engine === engine).map(e => e.lang);
          results.push({ kind: 'tts', name: engine, ok: false, needsChoice: true, choices: ['replace', 'skip'], languages: sprog,
                         noVoice: udenStemme.filter(u => u.engine === engine).map(u => u.lang) });
          addLog('WARN', `Missing in ${target.name}: TTS engine "${engine}" (${sprog.join(', ')}) — can be replaced`, target.name, 'MIGRATE');
        }
      }
    } catch (e) {
      addLog('WARN', `Could not check the TTS engines in ${target.name}: ${describeApiError(e)}`, target.name, 'MIGRATE');
    }

    // Må login'et oprette flows i den division flowet lander i? En division der
    // mangler, står allerede blandt afhængighederne med et valg.
    let divisionDenied = null;
    try {
      const omskriv = prefixOf(source) !== prefixOf(target) || divisionOf(source) !== divisionOf(target);
      const egen = omskriv ? divisionOf(target) : flowOwnDivision(yaml);
      if (divisionProblem(egen, await flowDivisionAccess(target)) === 'denied') {
        divisionDenied = egen;
        addLog('WARN', `"${flowName}" would be created in division "${egen}", where the login in ${target.name} may not create flows`, target.name, 'MIGRATE');
      }
    } catch (e) {
      addLog('WARN', `Could not check the divisions in ${target.name}: ${describeApiError(e)}`, target.name, 'MIGRATE');
    }
    return { fileName: yamlFile, filePath, yaml, deps: results, actionRefs, targetActions, divisionDenied,
             dynamicSkills: /FindSkill\(\s*[A-Za-z]/.test(yaml) };
  }
}

// ── Tjek før forfremmelse ────────────────────────────────────────────────────
//
// Det samme som første fase af en forfremmelse, uden at noget importeres, og
// uden dialogerne: hvad står i vejen, hvad kræver et valg, og hvad klarer
// forfremmelsen selv. Ren afgørelse, så den kan prøves uden en org.
//
//   blockers  — forfremmelsen kan ikke gennemføres, før det er løst
//   decisions — en data action findes under en anden kategori: der skal vælges
//   warnings  — håndteres under forfremmelsen eller i hånden, men standser den ikke
function buildMigrationVerdict(analysis) {
  const blockers = [], decisions = [], warnings = [];
  let ok = 0;
  for (const d of analysis.deps || []) {
    if (d.ok) { ok++; continue; }
    const item = { kind: d.kind, name: d.name };
    if (d.blocking) blockers.push({ ...item, code: 'fda' });
    // En data action der ikke findes i nogen af de to orgs, kan hverken oprettes eller peges over på.
    else if (d.kind === 'dataaction' && d.manualReason === 'not_in_source') blockers.push({ ...item, code: 'action-nowhere' });
    else if (d.canMigrate) warnings.push({ ...item, code: 'will-migrate' });
    else if (d.unchecked) warnings.push({ ...item, code: 'unchecked' });
    else if (d.needsChoice) warnings.push({ ...item, code: 'needs-choice' });
    else warnings.push({ ...item, code: d.manualReason === 'not_in_source' ? 'not-in-source' : 'manual' });
  }
  if (analysis.divisionDenied) blockers.push({ kind: 'division', name: analysis.divisionDenied, code: 'division-denied' });
  for (const r of analysis.actionRefs || []) {
    if (r.status === 'choose') decisions.push({ kind: 'dataaction', name: r.name, category: r.category, candidates: r.candidates || [] });
    else if (r.status === 'mapped') ok++;
  }
  return { blockers, decisions, warnings, ok, canPromote: blockers.length === 0 };
}

router.post('/api/migrate/check', async (req, res) => {
  const { sourceId, targetId, flowName, flowType } = req.body || {};
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  const pre = await migrationPreflight(source, target, flowName, flowType, req.body);
  if (pre.refused) return res.status(pre.refused.status).json(pre.refused.body);
  try {
    const verdict = buildMigrationVerdict(await analyzeFlowForMigration(source, target, flowName, flowType, pre.kildeVersion));
    addLog(verdict.canPromote ? 'INFO' : 'WARN',
      `Pre-promotion check "${flowName}" ${source.name} → ${target.name}: ${verdict.blockers.length} blocking, ${verdict.decisions.length} to decide, ${verdict.warnings.length} warning(s)`,
      source.name, 'MIGRATE');
    res.json({ ok: true, flowName, verdict });
  } catch (e) {
    addLog('ERROR', `Pre-promotion check failed for "${flowName}": ${e.message}`, source.name, 'MIGRATE');
    res.status(500).json({ error: e.message });
  }
});

// Fase 2: importér den allerede eksporterede fil til mål-org'en.
router.post('/api/migrate/commit', async (req, res) => {
  const { sourceId, targetId, flowName, filePath, action, divisionMap, ttsReplace } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  // Samme vagt som i prepare. Commit er den der faktisk skriver, så den må ikke
  // stole på at klienten kom forbi prepare først.
  const blocked = migrationGuard(source, target, req.body);
  if (blocked) {
    addLog('WARN', `Migration blocked (${blocked.code}): "${flowName}" ${source.name} → ${target.name}`, source.name, 'MIGRATE');
    return res.status(409).json(blocked);
  }

  // filePath kommer fra klienten — hold den inden for FLOWS_DIR
  const resolved = path.resolve(filePath || '');
  if (!insideFlowsDir(resolved) || !fs.existsSync(resolved)) {
    return res.status(400).json({ error: 'Ugyldig filsti' });
  }

  // Hård port: en Function Data Action der mangler i målet, kan ikke oprettes
  // herfra. Commit er den der skriver, så vagten står her og ikke kun i
  // dialogen. Kan vi ikke slå det op, standser vi ikke på et gæt.
  //
  // Valgene til data actions (gemte og dem brugeren lige har truffet) anvendes
  // først: en Function Data Action der er peget over på en der findes i målet,
  // mangler ikke længere.
  const sendt = (Array.isArray(req.body.actionMap) ? req.body.actionMap : []).filter(validDaEntry);
  let daEntries = [], daTarget = [];
  try {
    if (scanDataActionRefs(fs.readFileSync(resolved, 'utf8')).length) {
      const { token: tt, apiBase: tb } = await getToken(target);
      daTarget = await listDataActions(tt, tb);
      daEntries = mergeDaEntries(await loadDataActionMap(source, target), sendt);
      daEntries = mergeDaEntries(autoDataActionEntries(fs.readFileSync(resolved, 'utf8'), daTarget, daEntries), daEntries);
    }
  } catch (e) {
    addLog('WARN', `Could not look up the data action choices for "${flowName}": ${describeApiError(e)}`, target.name, 'MIGRATE');
  }
  let fdaMangler = [];
  try {
    const mapped = applyDataActionMap(fs.readFileSync(resolved, 'utf8'), daEntries, daTarget).yaml;
    fdaMangler = await functionActionsMissingInTarget(source, target, mapped);
  } catch (e) {
    addLog('WARN', `Could not check Function Data Actions for "${flowName}": ${describeApiError(e)}`, target.name, 'MIGRATE');
  }
  if (fdaMangler.length) {
    addLog('WARN', `Migration blocked (fda-missing): "${flowName}" needs ${fdaMangler.join(', ')} in ${target.name}`, target.name, 'MIGRATE');
    return res.status(409).json({
      code: 'fda-missing', missing: fdaMangler,
      error: `${fdaMangler.length === 1 ? 'Function Data Action' : 'Function Data Actions'} "${fdaMangler.join('", "')}" ` +
             `findes ikke i ${target.name} og kan ikke oprettes herfra. Opret ${fdaMangler.length === 1 ? 'den' : 'dem'} i Genesys og forfrem derefter igen.`
    });
  }

  try {
    // Valgte brugeren "brug Home" for en manglende division, skrives det om i
    // YAML'en før importen. Kun de navngivne divisioner røres.
    if (divisionMap && Object.keys(divisionMap).length) {
      let yaml = fs.readFileSync(resolved, 'utf8');
      for (const [from, to] of Object.entries(divisionMap)) {
        const re = new RegExp('^([ \\t]*division:[ \\t]*["\']?)' +
          from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(["\']?[ \\t]*)$', 'gm');
        const before = yaml;
        yaml = yaml.replace(re, `$1${to}$2`);
        if (yaml !== before) addLog('INFO', `Division "${from}" → "${to}" in "${flowName}"`, target.name, 'MIGRATE');
      }
      fs.writeFileSync(resolved, yaml, 'utf8');
    }

    // Har målmiljøet et præfiks, skal flowet hedde noget andet dér. Uden det
    // ville et flow fra prod lande i DEV_-miljøet under prod-navnet — og bor de
    // to i samme org, kolliderer det med det flow det kom fra.
    //
    // Den omdøbte udgave skrives til en SIDEFIL. Den eksporterede fil er vores
    // lokale kopi af kildens flow; skrev vi ovenpå den, ville kopien af kilden
    // stille og roligt blive til noget andet.
    let importFile = resolved;
    let omskrevneRefs = [];
    const nyName = targetFlowName(flowName, source, target);
    const nyDivision = divisionOf(target);
    const skalOmskrives = prefixOf(source) !== prefixOf(target) ||
                          divisionOf(source) !== nyDivision;
    // Data actions peget over på det de hedder i målet. Samme sidefil som
    // præfiksomskrivningen — kildens egen kopi røres aldrig.
    const daRew = applyDataActionMap(fs.readFileSync(resolved, 'utf8'), daEntries, daTarget);
    // TTS-motorer målet ikke har, skiftes hvis brugeren valgte det
    let ttsSkiftet = false;
    if (ttsReplace) {
      try {
        const ny = await applyTtsChoice(daRew.yaml, target, flowName, null);
        if (ny !== daRew.yaml) { daRew.yaml = ny; ttsSkiftet = true; }
      } catch (e) { addLog('WARN', `Could not read the TTS engines in ${target.name}: ${describeApiError(e)}`, target.name, 'MIGRATE'); }
    }
    if (skalOmskrives || daRew.changed.length || ttsSkiftet) {
      let yaml = daRew.yaml;
      for (const omskrevet of daRew.changed) {
        omskrevneRefs.push(omskrevet);
        addLog('INFO', `Data action reference rewritten: ${omskrevet}`, target.name, 'MIGRATE');
      }
    if (skalOmskrives) {
      // Divisionen følger miljøet. Er der ingen sat på målet, er det Home.
      const gammelDivision = (yaml.match(/^[ \t]{2,}division:[ \t]*(.+?)[ \t]*$/m) || [])[1];
      yaml = setFlowDivisionInYaml(yaml, nyDivision);
      if (gammelDivision && gammelDivision.replace(/^["']|["']$/g, '') !== nyDivision)
        addLog('INFO', `Division changed: ${gammelDivision} → ${nyDivision}`, target.name, 'MIGRATE');
      if (nyName !== flowName) {
        yaml = renameFlowInYaml(yaml, nyName);
        addLog('INFO', `Renamed for the target environment: "${flowName}" → "${nyName}"`, target.name, 'MIGRATE');
      }
      // Og de ressourcer flowet peger på. Uden dette ville DEV_-flowet slå op i
      // prods tabel, og de to miljøer ville dele data.
      const dep = prefixDependenciesInYaml(yaml, source, target);
      yaml = dep.yaml;
      omskrevneRefs = omskrevneRefs.concat(dep.changed);
      for (const omskrevet of dep.changed)
        addLog('INFO', `Reference rewritten: ${omskrevet}`, target.name, 'MIGRATE');
    }

      importFile = path.join(path.dirname(resolved),
        `.import-${sanitizeName(target.name)}-${path.basename(resolved)}`);
      fs.writeFileSync(importFile, yaml, 'utf8');
    }

    const cmd = archyVerb(action);

    // Til release-noten og en senere rollback: hvad målet kører LIGE NU, før
    // vi skriver ovenpå. Det koster en eksport, men uden den ved vi hverken
    // hvad der blev ændret, eller hvad vi skal tilbage til. Fejler det, går
    // forfremmelsen stadig igennem — noten siger så at "før" ikke kendes.
    const importYaml = fs.readFileSync(importFile, 'utf8');
    const rodType = ((importYaml.match(/^(\w+):/m) || [])[1] || '').toLowerCase();
    let prevYaml = null, prevVersion = null;
    if (rodType) {
      try {
        const { found, published } = await publishedVersionOf(target, nyName, rodType);
        if (found && published) {
          prevVersion = published;
          prevYaml = (await exportFlowToYaml(target, nyName, rodType, published)).yaml;
        }
      } catch (e) {
        addLog('WARN', `Could not read what ${target.name} had before the release of "${nyName}": ${describeApiError(e)}`, target.name, 'RELEASE');
      }
    }

    addLog('INFO', `Importing "${path.basename(importFile)}" to ${target.name} (action: ${cmd})`, target.name, 'MIGRATE');
    // finally: fejler importen, skal sidefilen alligevel væk. Uden den ligger
    // der en ".import-…"-fil tilbage i eksportmappen efter hver mislykket
    // migrering.
    let out;
    const startedAt = Date.now();
    try {
      out = await runArchy(`${cmd} --file ${archyArg(importFile, 'File path')}`, target);
    } catch (e) {
      if (!(e.timedOut && await importFinishedDespiteTimeout(target, nyName, rodType, cmd, startedAt, !!prevVersion))) throw e;
      out = '';
      addLog('WARN', `Archy timed out on "${nyName}" but the flow is in ${target.name} — treated as migrated`, target.name, 'MIGRATE');
    } finally {
      if (importFile !== resolved) { try { fs.unlinkSync(importFile); } catch (_) {} }
    }
    addLog('SUCCESS', `Migration complete: "${nyName}" is now in ${target.name}`, target.name, 'MIGRATE');

    // Brugerens valg huskes først nu, hvor de har vist sig at holde — og kun de
    // der faktisk blev brugt. Så ligger der aldrig et valg der aldrig virkede.
    const brugt = sendt.filter(e => daRew.changed.includes(`${e.from.category} / ${e.from.name} → ${e.to.category} / ${e.to.name}`));
    if (brugt.length && req.body.rememberMap !== false) {
      try {
        const r = await saveDataActionMap(source, target, brugt);
        addLog('INFO', `Saved ${brugt.length} data action choice(s) for ${source.name} → ${target.name} (${r.where === 'org' ? 'in the target manifest' : 'locally'})`, target.name, 'MIGRATE');
      } catch (e) {
        addLog('WARN', `Could not save the data action choices: ${describeApiError(e)}`, target.name, 'MIGRATE');
      }
    }

    // Notér hvad målet blev bygget af, så det senere kan verificeres om kilden
    // eller målet har flyttet sig. Versionsnumrene gemmes til orientering —
    // sammenligningen sker altid på indholds-hashen.
    const importedYaml = fs.readFileSync(resolved, 'utf8');
    // Flowtypen tages fra YAML-roden og normaliseres, så den matcher API'ets
    // form når posten senere slås op.
    const yamlType = (importedYaml.match(/^(\w+):/m) || [])[1] || null;
    const [sourceOrgId, targetOrgId] = await Promise.all([getOrgId(source), getOrgId(target)]);
    // Slå målet op under DETS navn — ellers finder vi intet og noterer null.
    let pub = await getFlowPublishInfo(target, nyName, yamlType).catch(() => null);

    // Versionsudligning: publicér det importerede flow igen, til målets nummer
    // matcher kildens. Samme indhold hver gang — kun tælleren flytter sig.
    let aligned = null;
    if (req.body.alignVersion && cmd === 'publish') {
      const plan = alignmentPlan(versionFromFileName(path.basename(resolved)), pub?.version);
      aligned = { ...plan, done: 0 };
      if (plan.extra > 0) {
        const alignFile = path.join(path.dirname(resolved), `.align-${sanitizeName(target.name)}-${path.basename(resolved)}`);
        fs.writeFileSync(alignFile, importYaml, 'utf8');
        try {
          for (let k = 1; k <= plan.extra; k++) {
            await runArchy(`publish --file ${archyArg(alignFile, 'File path')}`, target);
            aligned.done = k;
          }
        } catch (e) {
          addLog('ERROR', `Version alignment of "${nyName}" stopped after ${aligned.done} of ${plan.extra} publishes: ${e.message}`, target.name, 'MIGRATE');
          aligned.error = e.message;
        } finally {
          try { fs.unlinkSync(alignFile); } catch (_) {}
        }
        pub = await getFlowPublishInfo(target, nyName, yamlType).catch(() => pub);
        addLog(aligned.error ? 'WARN' : 'SUCCESS',
          `Version aligned: "${nyName}" in ${target.name} published ${aligned.done} extra time(s) → v${pub?.version || '?'} (source v${plan.source})`,
          target.name, 'MIGRATE');
      } else if (plan.reason !== 'equal') {
        addLog('INFO', `Version not aligned for "${nyName}" (${plan.reason}${plan.needed ? ', ' + plan.needed + ' needed' : ''})`, target.name, 'MIGRATE');
      }
      aligned.version = pub?.version || null;
    }

    recordManifest({
      ts: new Date().toISOString(), kind: 'migration',
      sourceId, sourceOrgId, sourceName: source.name,
      targetId, targetOrgId, targetName: target.name,
      flowName: stripEnvPrefix(flowName, source), flowType: yamlType,
      sourceVersion: versionFromFileName(path.basename(resolved)),
      targetVersion: pub?.version || null,
      targetPublishedAt: pub?.publishedAt || null,
      action: cmd,
      hash: flowContentHash(importedYaml)
    });

    // Og i org'ens eget manifest, hvis den har tabellen. Uden dette ville en
    // oprettet tabel stå tom for evigt, og delingen var kun på papiret.
    await recordOrgManifest(source, target, stripEnvPrefix(flowName, source), yamlType, {
      sourceVersion: versionFromFileName(path.basename(resolved)),
      targetVersion: pub?.version || null,
      targetPublishedAt: pub?.publishedAt || Date.now(),
      sourcePublishedAt: null,
      hash: flowContentHash(importedYaml)
    });

    // Release-noten. Den skrives også for 'create' og 'update', hvor flowet
    // kun ligger som kladde — men så siger noten det, for så er intet i drift.
    const who = await whoAmI(target);
    const baseName = baseFlowName(stripEnvPrefix(nyName, target));
    let release = null;
    try {
      release = await recordReleaseEverywhere(target, {
        kind: 'promotion', demo: false, action: cmd,
        tenant: tenantOf(target), group: groupOf(target),
        sourceId, sourceName: source.name, targetId, targetName: target.name,
        targetStage: stageOf(target),
        flowType: yamlType, baseName, fromName: prevVersion ? nyName : null, toName: nyName,
        prevVersion, newVersion: pub?.version || null,
        sourceVersion: versionFromFileName(path.basename(resolved)),
        by: who.by, bySource: who.bySource,
        prevSnapshot: saveSnapshot(targetId, nyName, prevYaml),
        newSnapshot: saveSnapshot(targetId, nyName, importYaml),
        references: omskrevneRefs,
        note: cmd === 'publish' ? '' : `Imported with "${cmd}" — not published yet`,
        diff: releaseDiff(prevYaml, importYaml)
      });
    } catch (e) {
      addLog('WARN', `Could not write the release log: ${e.message}`, target.name, 'RELEASE');
    }

    // Et common module slår først igennem i de flows der kalder det, når de
    // publiceres igen. Kun når modulet selv ER publiceret — ligger det som
    // kladde, ville en genpublicering bare hente den gamle udgave igen.
    let dependents = [];
    if (normType(yamlType) === 'COMMONMODULE' && cmd === 'publish') {
      try { dependents = await dependentsOf(target, nyName); }
      catch (e) { addLog('WARN', `Could not find the flows that use "${nyName}" in ${target.name}: ${describeApiError(e)}`, target.name, 'RELEASE'); }
    }

    res.json({ ok: true, fileName: path.basename(resolved), output: out, yaml: fs.readFileSync(resolved, 'utf8'),
      targetName: nyName, releaseRef: release ? releaseRef(release) : null,
      diff: release ? { added: release.diff.added, removed: release.diff.removed, noPrevious: release.diff.noPrevious } : null,
      dependents, aligned });
  } catch (e) {
    let msg = e.message || '';
    // "create" fejler når flowet allerede findes i mål-org'en. Archy foreslår
    // --recreate, men i praksis vil man vælge update eller publish i stedet.
    if (/already exists/i.test(msg) && (action || 'create') === 'create') {
      msg += ' — vælg "update" eller "publish" i Handling for at overskrive det eksisterende flow.';
    }
    noteUnavailableType(target, msg);
    msg = archyHint(msg);
    addLog('ERROR', `Migration failed for "${flowName}": ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

module.exports = { router, COPYABLE_KINDS, identicalInTarget, buildMigrationVerdict };
