// Ruter: demo-kunden (forfremmelse, publicering, oprettelse og nulstilling).

const express = require('express');
const { addLog } = require('../lib/log');
const { loadCustomers, saveCustomers } = require('../lib/customers');
const { requireInternal } = require('../lib/features');
const { normType } = require('../lib/conventions');
const { missingFields } = require('../lib/helpers');
const { tenantOf, groupOf, stageOf, isDemo, belongsToEnv, stripEnvPrefix, withEnvPrefix,
  divisionOf, setFlowDivisionInYaml, prefixDependenciesInYaml } = require('../lib/environments');
const { baseFlowName, isPipelineOrigin, promotionNameFrom } = require('../lib/names');
const { migrationGuard } = require('../lib/guards');
const { recordManifest } = require('../lib/manifest-file');
const { whoAmI } = require('../lib/manifest');
const { dropDemoManifest, loadDemo, saveDemo, DEMO_TENANT, DEMO_GROUP, DEMO_ENVS, demoEnvId,
  DEMO2_TENANT, DEMO2_GROUP, DEMO2_ORG_A, DEMO2_ORG_B, DEMO2_ENVS, demo2EnvId, demo2EnvName,
  seedDemo, demoRemember, demoFlowKey, seedDemo2, demoDependentsOf } = require('../lib/demo');
const { recordOrgManifest } = require('../lib/setup');
const { renameFlowInYaml, alignmentPlan, flowContentHash } = require('../lib/flow-yaml');
const { recordReleaseEverywhere, saveSnapshot, releaseDiff, releaseRef, dropDemoReleases } = require('../lib/releases');

const router = express.Router();

// Forfremmelse inde i demoen. Kopierer indholdet fra kilden til målet under det
// navn reglen giver. Ingen Archy, ingen Genesys — kun den lokale demofil.
router.post('/api/demo/promote', async (req, res) => {
  const { sourceId, targetId, flowName, flowType } = req.body;
  const mangler = missingFields(req.body, ['flowName', 'flowType']);
  if (mangler) return res.status(400).json({ error: mangler });

  const all = loadCustomers();
  const source = all.find(c => c.id === sourceId);
  const target = all.find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Ukendt miljø' });
  if (!isDemo(source) || !isDemo(target))
    return res.status(400).json({ error: 'Kun demo-miljøer' });

  const blocked = migrationGuard(source, target, req.body);
  if (blocked) return res.status(409).json(blocked);

  const d = loadDemo();
  const srcKey = demoFlowKey(source), tgtKey = demoFlowKey(target);
  const src = (d.flows[srcKey] || []).find(f => f.name === flowName && f.type === flowType);
  if (!src) return res.status(404).json({ error: `"${flowName}" findes ikke i ${source.name}` });

  // Navnet regnes ud på GRUNDNAVNET uden miljøpræfiks, og præfikset sættes
  // derefter på hver side for sig. Ellers ville "DEV_Velkomst" forfremmet til
  // test hedde "DEV_Velkomst_v10" i test-miljøet — altså bære afsenderens
  // præfiks ind i modtageren.
  //
  // Endelsen sættes kun fra pipelinens første trin — se isPipelineOrigin.
  const bare       = stripEnvPrefix(src.name, source);
  const bareNew    = promotionNameFrom(bare, src.published, isPipelineOrigin(source, all), flowType);
  const newName    = withEnvPrefix(bareNew, target);   // navnet i målet
  const srcNewName = withEnvPrefix(bareNew, source);   // og i kilden
  const base       = baseFlowName(bareNew);
  d.flows[tgtKey] = d.flows[tgtKey] || [];
  const now = Date.now();

  // Indholdet gør det samme som en rigtig import: navnet i YAML'en skal være
  // målets navn, referencerne skal pege på målets præfiksede ressourcer, og
  // divisionen følger miljøet. Før blev kildens tekst kopieret som den var —
  // så UAT-udgaven stod med "name: DEV_Betaling" indeni.
  let tgtContent = renameFlowInYaml(src.content, newName);
  tgtContent = setFlowDivisionInYaml(tgtContent, divisionOf(target));
  const dep = prefixDependenciesInYaml(tgtContent, source, target);
  tgtContent = dep.yaml;

  // Målet kan allerede have flowet under et ældre versionsnavn. Det er stadig
  // det samme flow, så det omdøbes og opdateres — der laves ikke et nyt ved
  // siden af. Dermed beholder det sit id i målet, og alt der ruter til det
  // bliver ved med at gøre det.
  //
  // Kun flows der hører til MÅLMILJØET. Har målet intet præfiks og deler org
  // med præfiksede søskende, ville "DEV_Betaling" ellers kunne udpeges som
  // målets flow, fordi grundnavnet efter et tomt præfiks er hele navnet.
  const tgtSiblings = all.filter(c => isDemo(c) && demoFlowKey(c) === tgtKey);
  const existing = d.flows[tgtKey].find(f =>
    f.type === flowType && belongsToEnv(f.name, target, tgtSiblings) &&
    baseFlowName(stripEnvPrefix(f.name, target)) === base);

  const prevContent = existing ? existing.content : null;
  const prevName    = existing ? existing.name : null;
  const prevVersion = existing ? existing.published : null;

  let action, renamedTarget = null;
  if (existing) {
    if (existing.name !== newName) renamedTarget = existing.name;
    const cur = parseInt(String(existing.published || '0').split('.')[0], 10) || 0;
    existing.name = newName;
    existing.published = `${cur + 1}.0`;
    existing.publishedAt = now;
    existing.content = tgtContent;
    demoRemember(existing);
    action = 'update';
  } else {
    const ny = { name: newName, type: flowType, published: '1.0', publishedAt: now, content: tgtContent };
    demoRemember(ny);
    d.flows[tgtKey].push(ny);
    action = 'create';
  }

  // Kilden omdøbes med. Det er dét der gør at man i dev kan se hvilken udgave
  // der sidst blev skubbet videre: arbejder man videre og publicerer 15 gange,
  // hedder den stadig _v10 indtil den bliver forfremmet igen.
  const renamedSource = src.name !== srcNewName ? src.name : null;
  src.name = srcNewName;
  src.content = renameFlowInYaml(src.content, srcNewName);
  demoRemember(src);

  // Versionsudligning, som ved en rigtig forfremmelse: målet springer frem til
  // kildens nummer, hvis det står lavere og man har bedt om det.
  let aligned = null;
  const tgtFlow = existing || d.flows[tgtKey].find(x => x.name === newName && x.type === flowType);
  if (req.body.alignVersion && tgtFlow) {
    const plan = alignmentPlan(src.published, tgtFlow.published);
    aligned = { ...plan, done: plan.extra };
    if (plan.extra > 0) {
      tgtFlow.published = `${plan.source}.0`;
      demoRemember(tgtFlow);
    }
    aligned.version = tgtFlow.published;
  }

  saveDemo(d);
  const targetVersion = existing ? existing.published : (tgtFlow ? tgtFlow.published : '1.0');

  recordManifest({
    ts: new Date().toISOString(), kind: 'migration',
    sourceId, sourceOrgId: sourceId, sourceName: source.name,
    targetId, targetOrgId: targetId, targetName: target.name,
    flowName: bareNew, flowType,
    sourceVersion: src.published, targetVersion,
    targetPublishedAt: now, action,
    hash: flowContentHash(src.content, source)
  });

  // To rækker, én i hver org, og hver beskriver kun sig selv. Kilden er også
  // ændret — den blev omdøbt — så dens egen række skal med.
  // Grundnavnet UDEN præfiks — det er dét tavlen slår op på. Sendte vi det
  // præfiksede navn, blev rækken skrevet under en nøgle der aldrig læses.
  await recordOrgManifest(source, target, bareNew, flowType, {
    sourceVersion: src.published,
    targetVersion,
    targetPublishedAt: now,
    sourcePublishedAt: src.publishedAt,
    hash: flowContentHash(src.content, source)
  });

  // Release-noten: hvad målet indeholdt før, og hvad det indeholder nu.
  const who = await whoAmI(target);
  const release = await recordReleaseEverywhere(target, {
    kind: 'promotion', demo: true,
    tenant: tenantOf(target), group: groupOf(target),
    sourceId, sourceName: source.name, targetId, targetName: target.name,
    targetStage: stageOf(target),
    flowType, baseName: base, fromName: prevName, toName: newName,
    prevVersion, newVersion: targetVersion, sourceVersion: src.published,
    by: who.by, bySource: who.bySource,
    prevSnapshot: saveSnapshot(targetId, prevName || newName, prevContent),
    newSnapshot: saveSnapshot(targetId, newName, tgtContent),
    references: dep.changed,
    diff: releaseDiff(prevContent, tgtContent)
  });

  // Et common module der ændres, slår først igennem i de flows der bruger det,
  // når de publiceres igen. Vi finder dem og lader brugeren tage stilling.
  const dependents = normType(flowType) === 'COMMONMODULE'
    ? demoDependentsOf(target, newName) : [];

  const renamed = !!renamedSource || !!renamedTarget;
  addLog('SUCCESS',
    `Demo: "${renamedSource || newName}" ${source.name} → ${target.name}` +
    (renamed ? ` as "${newName}" (also renamed in ${source.name})` : ' (name unchanged)'),
    target.name, 'DEMO');
  res.json({ ok: true, fromName: flowName, toName: newName,
             renamed, renamedSource, renamedTarget, action,
             releaseRef: releaseRef(release),
             diff: { added: release.diff.added, removed: release.diff.removed, noPrevious: release.diff.noPrevious },
             dependents, aligned });
});

// Simulerer at nogen arbejder videre i et miljø og publicerer igen. Navnet
// røres ikke — det er netop pointen: udgaven stiger, men navnet bliver ved med
// at fortælle hvilken udgave der sidst blev skubbet videre.
router.post('/api/demo/publish', (req, res) => {
  const { envId, flowName, flowType, times } = req.body;
  const mangler = missingFields(req.body, ['flowName', 'flowType']);
  if (mangler) return res.status(400).json({ error: mangler });

  const env = loadCustomers().find(c => c.id === envId);
  if (!env || !isDemo(env)) return res.status(400).json({ error: 'Kun demo-miljøer' });

  const d = loadDemo();
  const f = (d.flows[demoFlowKey(env)] || []).find(x => x.name === flowName && x.type === flowType);
  if (!f) return res.status(404).json({ error: `"${flowName}" findes ikke i ${env.name}` });

  const n = Math.max(1, Math.min(parseInt(times, 10) || 1, 50));
  const cur = parseInt(String(f.published || '0').split('.')[0], 10) || 0;
  f.published = `${cur + n}.0`;
  f.publishedAt = Date.now();
  // Indholdet ændrer sig — ellers ville et indholdstjek stadig sige "i trit".
  f.content = f.content.replace(/\s*# udgave \d+$/, '') + `\n  # udgave ${cur + n}`;
  demoRemember(f);
  saveDemo(d);

  addLog('INFO', `Demo: "${flowName}" published ${n} time(s) in ${env.name} → v${f.published}`, env.name, 'DEMO');
  res.json({ ok: true, published: f.published, name: f.name });
});

router.get('/api/demo/status', requireInternal, (req, res) => {
  const all = loadCustomers();
  const one = all.filter(c => demoIs(c, '1'));
  const two = all.filter(c => demoIs(c, '2'));
  res.json({ ok: true,
    exists: one.length > 0, environments: one.length,
    demos: [
      { which: '1', tenant: DEMO_TENANT,  group: DEMO_GROUP,  exists: one.length > 0,
        environments: one.length, kind: 'org-pr-miljø' },
      { which: '2', tenant: DEMO2_TENANT, group: DEMO2_GROUP, exists: two.length > 0,
        environments: two.length, kind: 'præfiks i samme org' }
    ] });
});

// which: '1' = én org pr. miljø, '2' = virtuelle miljøer på præfiks.
// De to kan være oprettet samtidig — de rører ikke hinanden.
function demoIs(c, which) {
  return isDemo(c) && (which === '2' ? String(c.id).startsWith('demo2-')
                                     : String(c.id).startsWith('demo-'));
}

router.post('/api/demo/create', requireInternal, (req, res) => {
  const which = String(req.body?.which || '1');
  const customers = loadCustomers().filter(c => !demoIs(c, which));
  if (which === '2') {
    for (const e of DEMO2_ENVS) customers.push({
      id: demo2EnvId(e.suffix),
      name: demo2EnvName(e.stage),
      clientId: '', clientSecret: '', region: 'demo',
      authType: 'demo', demo: true, demoOrg: e.org, orgLabel: e.orgLabel,
      prefix: e.prefix,
      tenant: DEMO2_TENANT, group: DEMO2_GROUP, stage: e.stage
    });
    saveCustomers(customers);
    seedDemo2();
    addLog('INFO', 'Demo 2 created: 4 virtual environments across 2 orgs, 3 flows', DEMO2_TENANT, 'DEMO');
    return res.json({ ok: true, tenant: DEMO2_TENANT, group: DEMO2_GROUP });
  }
  for (const e of DEMO_ENVS) customers.push({
    id: demoEnvId(e.suffix),
    name: `${DEMO_TENANT} — ${e.stage.toUpperCase()}`,
    clientId: '', clientSecret: '', region: 'demo',
    authType: 'demo', demo: true,
    tenant: DEMO_TENANT, group: DEMO_GROUP, stage: e.stage
  });
  saveCustomers(customers);
  seedDemo();
  addLog('INFO', 'Demo customer created: 4 environments, 3 flows — touches no real org', DEMO_TENANT, 'DEMO');
  res.json({ ok: true, tenant: DEMO_TENANT, group: DEMO_GROUP });
});

router.post('/api/demo/reset', requireInternal, (req, res) => {
  const which = String(req.body?.which || '1');
  if (!loadCustomers().some(c => demoIs(c, which)))
    return res.status(404).json({ error: 'Ingen demo-kunde' });
  dropDemoManifest(which);
  dropDemoReleases(which);
  if (which === '2') {
    // Ældre demoer hed "— DEV_", "— UAT_" osv. Navnene rettes til trinnet, så
    // de ikke lyver når præfikset er ændret. Manifest og releases er lige
    // ryddet, så intet peger på de gamle navne.
    const alle = loadCustomers();
    let rettet = false;
    for (const c of alle) if (demoIs(c, '2') && stageOf(c) && c.name !== demo2EnvName(stageOf(c))) {
      c.name = demo2EnvName(stageOf(c)); rettet = true;
    }
    if (rettet) saveCustomers(alle);
    seedDemo2();
  } else seedDemo();
  addLog('INFO', 'Demo reset', which === '2' ? DEMO2_TENANT : DEMO_TENANT, 'DEMO');
  res.json({ ok: true });
});

router.delete('/api/demo', requireInternal, (req, res) => {
  const which = String(req.query.which || '1');
  saveCustomers(loadCustomers().filter(c => !demoIs(c, which)));
  const d = loadDemo();
  if (which === '2') { delete (d.flows||{})[DEMO2_ORG_A]; delete (d.flows||{})[DEMO2_ORG_B]; }
  else for (const e of DEMO_ENVS) delete (d.flows||{})[demoEnvId(e.suffix)];
  for (const k of Object.keys(d.manifest || {}))
    if (which === '2' ? k.startsWith('demo2-') : (k.startsWith('demo-') && !k.startsWith('demo2-')))
      delete d.manifest[k];
  saveDemo(d);
  dropDemoManifest(which);
  dropDemoReleases(which);
  addLog('INFO', 'Demo removed', which === '2' ? DEMO2_TENANT : DEMO_TENANT, 'DEMO');
  res.json({ ok: true });
});

module.exports = { router };
