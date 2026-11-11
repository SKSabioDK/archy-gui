// Ruter: pipeline-tavlen og sammenligning af flows.

const express = require('express');
const axios = require('axios');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { stageOrder } = require('../lib/conventions');
const { describeApiError } = require('../lib/helpers');
const { tenantOf, groupOf, stageOf, prefixOf, orgKeyOf, isDemo, belongsToEnv, stripEnvPrefix } = require('../lib/environments');
const { baseFlowName, versionSuffixOf, versionLabel } = require('../lib/names');
const { getToken } = require('../lib/token');
const { getFlowPublishInfo } = require('../lib/genesys');
const { loadManifest, findManifestEntry } = require('../lib/manifest-file');
const { getOrgId, orgManifestKey, readOrgManifest } = require('../lib/manifest');
const { demoFlowsFor } = require('../lib/demo');
const { flowContentHash, normalizeFlowYaml, stripEnvPrefixesInYaml, exportFlowToYaml,
  targetFlowName } = require('../lib/flow-yaml');
const { releaseRef, releasesOfEnv, releasesFor, rollbackCandidate } = require('../lib/releases');

const router = express.Router();

router.get('/api/pipeline', async (req, res) => {
  const { tenant, group } = req.query;
  if (!tenant || !group) return res.status(400).json({ error: 'tenant og group kræves' });

  const envs = loadCustomers()
    .filter(c => tenantOf(c) === tenant && groupOf(c) === group)
    .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.name.localeCompare(b.name));
  if (!envs.length) return res.status(404).json({ error: 'Ingen miljøer i den gruppe' });

  const byFlow = new Map();
  const problems = [];

  // Deler flere miljøer den samme org, hentes flowlisten én gang og deles.
  // Ellers ville fire virtuelle miljøer koste fire fulde gennemløb af samme org.
  const orgFlows = new Map();

  for (const c of envs) {
    const siblings = envs.filter(x => orgKeyOf(x) === orgKeyOf(c));

    // Demo-miljøer ligger kun lokalt — ingen token, intet kald ud af huset.
    if (isDemo(c)) {
      for (const f of demoFlowsFor(c)) {
        if (!belongsToEnv(f.name, c, siblings)) continue;
        const key = `${baseFlowName(stripEnvPrefix(f.name, c))}|${f.type}`;
        if (!byFlow.has(key)) byFlow.set(key, {});
        byFlow.get(key)[c.id] = {
          flowId: `${c.id}:${f.name}`, name: f.name,
          published: f.published, saved: null,
          publishedAt: f.publishedAt, active: true
        };
      }
      continue;
    }
    try {
      const ok = orgKeyOf(c);
      if (!orgFlows.has(ok)) {
        const { token, apiBase } = await getToken(c);
        const acc = [];
        let page = 1;
        for (;;) {
          const r = await axios.get(`${apiBase}/api/v2/flows`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { pageSize: 100, pageNumber: page, includeDraft: true }
          });
          const e = r.data.entities || [];
          acc.push(...e);
          if (e.length < 100) break;
          page++;
        }
        orgFlows.set(ok, acc);
      }
      for (const f of orgFlows.get(ok)) {
        if (!belongsToEnv(f.name, c, siblings)) continue;
        const key = `${baseFlowName(stripEnvPrefix(f.name, c))}|${f.type}`;
        if (!byFlow.has(key)) byFlow.set(key, {});
        byFlow.get(key)[c.id] = {
          flowId: f.id, name: f.name,
          published: versionLabel(f.publishedVersion),
          saved:     versionLabel(f.savedVersion),
          publishedAt: f.publishedVersion?.dateCheckedIn || f.publishedVersion?.dateCreated || null,
          active: !!f.active
        };
      }
    } catch (e) {
      problems.push({ environment: c.name, error: describeApiError(e) });
    }
  }

  // Manifestet er vores eneste nulpunkt: da vi forfremmede, skrev vi ned hvornår
  // målet blev publiceret. Er målet publiceret SENERE end det, er der publiceret
  // igen siden — og det var ikke os.
  //
  // Publiceringsdatoen alene duer ikke som signal: ved en sund forfremmelse
  // bliver det senere trin altid publiceret bagefter det tidligere, præcis som
  // når nogen retter direkte i prod. De to har samme form. Kun sammenholdt med
  // manifestet siger datoen noget — og kun for flows vi selv har forfremmet.
  const manifest = loadManifest();
  const orgIds = {};
  for (const c of envs) orgIds[c.id] = isDemo(c) ? c.id : await getOrgId(c);

  // Ligger manifestet i org'en, er DET nulpunktet — det er delt, så to personer
  // på hver sin pc ser det samme. Den lokale fil bruges kun hvor org'en ikke har
  // en tabel endnu, så intet går tabt undervejs i overgangen.
  const orgManifests = {};
  for (const c of envs) {
    try { orgManifests[c.id] = await readOrgManifest(c); }
    catch (e) {
      orgManifests[c.id] = null;
      addLog('WARN', `Could not read the manifest table in ${c.name}: ${describeApiError(e)}`, c.name, 'MANIFEST');
    }
  }

  const failed = new Set(problems.map(p => p.environment));
  const rows = [];
  // Hele historikken pr. miljø — fra org'ens manifest og den lokale cache —
  // så en release lavet fra en anden pc også kan ses og rulles tilbage her.
  const relByEnv = {};
  for (const c of envs) relByEnv[c.id] = await releasesOfEnv(c, orgManifests[c.id]);
  for (const [key, cells] of byFlow) {
    const [flowName, flowType] = key.split('|');
    rows.push({
      flowName, flowType,
      cells: envs.map(c => {
        const cell = { envId: c.id, unknown: failed.has(c.name), ...(cells[c.id] || { missing: true }) };
        // Release-historik og hvad et klik på rollback vil gå tilbage til.
        // Etiketten er versionsendelsen hvor navnet bærer den (_v5), ellers
        // miljøets egen udgave før releasen (v5).
        if (!cell.missing) {
          const hist = releasesFor(relByEnv[c.id] || [], c.id, flowName, flowType);
          if (hist.length) {
            cell.releaseCount = hist.length;
            const rb = rollbackCandidate(hist);
            if (rb) {
              const suf = versionSuffixOf(rb.fromName);
              cell.rollback = { id: rb.id, ref: releaseRef(rb),
                                label: suf != null ? `_v${suf}` : (rb.prevVersion ? `v${rb.prevVersion}` : ''),
                                toName: rb.fromName || rb.toName };
            }
          }
        }
        // Manifestet slås op så snart cellen har indhold — også hvis der ikke
        // er nogen publiceringsdato, for udgavenummeret alene kan afsløre at
        // miljøet er publiceret videre siden vi forfremmede.
        if (!cell.missing && !cell.unknown) {
          // Org-tabellen først: den beskriver netop dette miljø, og den er delt.
          const om = orgManifests[c.id] && orgManifests[c.id][orgManifestKey(flowName, flowType)];
          if (om) {
            cell.manifestSource = 'org';
            cell.promotedAt = om.publishedAt || om.at || null;
            cell.promotedVersion = om.version || null;
            cell.promotedBy = om.by || null;
            cell.promotedBySource = om.bySource || null;
            cell.promotedFrom = om.promotedFrom || null;
            cell.recordKind = om.kind || null;
            const left = parseInt(String(om.version || '').split('.')[0], 10);
            const nowV = parseInt(String(cell.published || '').split('.')[0], 10);
            // "Uden om pipelinen" gælder kun et miljø der MODTOG flowet fra os.
            // Sendte miljøet det videre (promotedTo), er senere publiceringer
            // helt almindeligt udviklingsarbejde — det er dét dev er til for —
            // og dækkes af "N udgaver ikke forfremmet". Uden den skelnen ville
            // hver eneste dev-org stå rød, så snart nogen rørte den.
            const modtog = !!om.promotedFrom;
            if (modtog && Number.isFinite(left) && Number.isFinite(nowV) && nowV > left)
              cell.changedSincePromotion = true;
            return cell;
          }

          const m = findManifestEntry(manifest, {
            targetOrgId: orgIds[c.id], targetId: c.id, flowName, flowType
          });
          if (m) {
            cell.manifestSource = 'local';
            // Både datoen og udgaven fra dengang vi forfremmede. Udgaven er den
            // stærkeste: er miljøet publiceret videre siden, står tallet højere
            // end det vi selv efterlod det på.
            cell.promotedAt = m.targetPublishedAt || null;
            cell.promotedVersion = m.targetVersion || null;
            const left = parseInt(String(m.targetVersion || '').split('.')[0], 10);
            const nowV = parseInt(String(cell.published || '').split('.')[0], 10);
            const newerVersion = Number.isFinite(left) && Number.isFinite(nowV) && nowV > left;
            const newerDate = m.targetPublishedAt && cell.publishedAt > m.targetPublishedAt;
            if (newerVersion || newerDate) cell.changedSincePromotion = true;
          }
        }
        return cell;
      })
    });
  }
  rows.sort((a, b) => a.flowName.localeCompare(b.flowName));

  res.json({
    ok: true, tenant, group,
    // orgKey lader brugerfladen gruppere kolonnerne under den fysiske org, så
    // man kan se at fire miljøer bor i samme Genesys-org. orgLabel er navnet at
    // sætte over gruppen.
    environments: envs.map(c => ({
      id: c.id, name: c.name, stage: stageOf(c), region: c.region,
      prefix: prefixOf(c) || null,
      orgKey: orgKeyOf(c),
      orgLabel: (c.orgLabel || '').trim() || c.name,
      color: c.color || ''
    })),
    rows, problems
  });
});

// Indholds-hash for ét flow hos flere kunder. Eksporterer pr. org, så det
// tager tid — kaldes kun for én række ad gangen.
router.post('/api/flows/cross-hash', async (req, res) => {
  // namesByCustomer: efter en forfremmelse kan det samme flow hedde noget
  // forskelligt i hvert miljø ("testtest_v10" i test, "testtest_v15" i dev).
  // Uden det ville vi lede efter et navn der ikke findes og fejlagtigt melde
  // "kunne ikke tjekkes".
  const { flowName, flowType, customerIds, namesByCustomer } = req.body;
  const customers = loadCustomers().filter(c => (customerIds || []).includes(c.id));
  if (!customers.length) return res.status(400).json({ error: 'Ingen kunder valgt' });
  const nameFor = c => (namesByCustomer && namesByCustomer[c.id]) || flowName;

  const results = [];
  for (const c of customers) {
    try {
      if (isDemo(c)) {
        const f = demoFlowsFor(c).find(x => x.name === nameFor(c) && x.type === flowType);
        if (!f) throw new Error(`"${nameFor(c)}" does not exist in ${c.name}`);
        results.push({ customerId: c.id, customerName: c.name,
                       version: f.published, hash: flowContentHash(f.content, c) });
        continue;
      }
      const { yaml, version } = await exportFlowToYaml(c, nameFor(c), flowType);
      results.push({ customerId: c.id, customerName: c.name, version, hash: flowContentHash(yaml, c) });
    } catch (e) {
      results.push({ customerId: c.id, customerName: c.name, error: e.message });
    }
  }
  // Et flow kan kun kaldes identisk hvis ALLE orgs faktisk gav en hash.
  // Fejler en eksport, ved vi ikke hvad der står i den org — og "identisk
  // overalt" ville være direkte forkert.
  const gotHash = results.filter(r => r.hash);
  const failed  = results.filter(r => r.error);
  const hashes  = new Set(gotHash.map(r => r.hash));

  const verdict = failed.length ? 'partial'
                : gotHash.length < 2 ? 'insufficient'
                : hashes.size === 1 ? 'identical' : 'different';

  addLog(failed.length ? 'WARN' : 'INFO',
    `Content comparison of "${flowName}" across ${results.length} customers — ` +
    (verdict === 'identical'    ? 'identical'
     : verdict === 'different'  ? `${hashes.size} different variants`
     : verdict === 'partial'    ? `incomplete: ${failed.length} of ${results.length} customers could not be exported`
     : 'too few results to compare'),
    null, 'MIGRATE');

  res.json({ ok: true, flowName, flowType, results, verdict,
    distinct: hashes.size, compared: gotHash.length, failed: failed.length });
});

// Sammenligner ét flow i to orgs på indhold — ikke på versionsnummer.
router.post('/api/flows/compare', async (req, res) => {
  const { sourceId, targetId, flowName, flowType } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  // Flowet hedder noget andet i et miljø med præfiks (DEV_Main ↔ Main)
  const tName = req.body.targetName || targetFlowName(flowName, source, target);

  try {
    let src, tgt, missingInTarget = false;
    src = await exportFlowToYaml(source, flowName, flowType);
    try {
      tgt = await exportFlowToYaml(target, tName, flowType);
    } catch (e) {
      if (/does not exist/i.test(e.message || '')) missingInTarget = true;
      else throw e;
    }

    // Publiceringsoplysninger — hentes uafhængigt af indholdssammenligningen
    const [srcPub, tgtPub] = await Promise.all([
      getFlowPublishInfo(source, flowName, flowType).catch(() => null),
      missingInTarget ? Promise.resolve(null) : getFlowPublishInfo(target, tName, flowType).catch(() => null)
    ]);

    if (missingInTarget) {
      return res.json({ ok: true, verdict: 'missing', flowName, flowType,
        sourceVersion: src.version, sourceHash: flowContentHash(src.yaml), srcPub });
    }

    // Miljøpræfiks og division normaliseres væk på begge sider — samme regel som
    // hashen og pipelinen, så DEV_Main og Main kan kendes som samme flow.
    const nsrc = normalizeFlowYaml(stripEnvPrefixesInYaml(src.yaml, source)),
          ntgt = normalizeFlowYaml(stripEnvPrefixesInYaml(tgt.yaml, target));
    const same = nsrc === ntgt;

    // Første håndfuld reelle forskelle, så man kan se hvad der adskiller dem
    const A = nsrc.split('\n'), B = ntgt.split('\n');
    const diffs = [];
    for (let i = 0; i < Math.max(A.length, B.length) && diffs.length < 8; i++) {
      if (A[i] !== B[i]) diffs.push({ line: i + 1, source: (A[i] || '').trim().slice(0, 120), target: (B[i] || '').trim().slice(0, 120) });
    }
    let diffCount = 0;
    for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) diffCount++;

    const sourceHash = flowContentHash(src.yaml, source);
    const targetHash = flowContentHash(tgt.yaml, target);

    // Kender vi dette flow fra en migrering eller et nulpunkt, kan vi sige
    // HVAD der har flyttet sig siden.
    const targetOrgId = await getOrgId(target);
    const rec = findManifestEntry(loadManifest(), { targetOrgId, targetId, flowName, flowType });
    let drift = null;
    if (rec?.hash) {
      const targetChanged = rec.hash !== targetHash;
      const sourceChanged = rec.hash !== sourceHash;
      drift = targetChanged && sourceChanged ? 'both'
            : targetChanged ? 'target'
            : sourceChanged ? 'source' : 'none';
    }

    addLog(same ? 'SUCCESS' : 'INFO',
      `Comparison "${flowName}": ${source.name} v${src.version} ↔ ${target.name} v${tgt.version} — ` +
      (same ? 'identical content' : `${diffCount} differences`), target.name, 'MIGRATE');

    // Er målet publiceret EFTER vi migrerede det, har nogen rettet direkte i
    // mål-org'en. Det er den situation man ikke opdager ved at kigge på
    // versionsnumre — og præcis den man vil fange.
    // Foretræk det publiceringstidspunkt der blev noteret dengang: det er
    // Genesys' eget ur på begge sider af sammenligningen. Vores egen ts bruges
    // kun hvis posten ikke har et — den afhænger af maskinens ur.
    let publishedAfterMigration = null;
    if (tgtPub?.publishedAt) {
      if (rec?.targetPublishedAt != null) publishedAfterMigration = tgtPub.publishedAt > rec.targetPublishedAt;
      else if (rec?.ts) publishedAfterMigration = tgtPub.publishedAt > new Date(rec.ts).getTime();
    } else if (rec?.targetPublishedAt != null) {
      publishedAfterMigration = false;   // var publiceret, er det ikke længere
    }

    res.json({ ok: true, verdict: same ? 'identical' : 'different', flowName, flowType,
      sourceVersion: src.version, targetVersion: tgt.version,
      sourceHash, targetHash, diffCount, diffs, drift,
      migratedAt: rec?.ts || null, recordKind: rec?.kind || (rec ? 'migration' : null),
      // Herkomst fra manifestet, så dialogen kan sige hvad målet er bygget af
      manifestSourceName: rec?.sourceName || null,
      manifestSourceVersion: rec?.sourceVersion ?? null,
      manifestAction: rec?.action || null,
      srcPub, tgtPub, publishedAfterMigration });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router };
