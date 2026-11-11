// Releases: release-log, diff, release notes og grundlaget for rollback.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FLOWS_DIR } = require('../config');
const { addLog } = require('./log');
const { loadCustomers } = require('./customers');
const { normType } = require('./conventions');
const { sanitizeName, describeApiError } = require('./helpers');
const { tenantOf, groupOf, stageOf, isDemo, belongsToEnv, stripEnvPrefix } = require('./environments');
const { baseFlowName } = require('./names');
const { orgManifestKey, readOrgManifest, readOrgManifestRow, putOrgManifestRow } = require('./manifest');
const { demoFlowKey, demoFlowsFor } = require('./demo');
const { normalizeFlowYaml, exportFlowToYaml } = require('./flow-yaml');

// ── Releases: release notes og rollback ──────────────────────────────────────
// Manifestet husker kun den SENESTE forfremmelse pr. flow og mål — nok til at
// se om nogen har rørt ved målet siden. En release-log husker dem alle, med
// hvad målet indeholdt før og efter. Det er det der skal til for at kunne sige
// hvad der blev ændret (release notes), og for at kunne gå tilbage (rollback).
//
// Indholdet gemmes som filer ved siden af, ikke inde i loggen: et stort flow er
// hundredvis af kB, og loggen skal kunne læses hver gang tavlen tegnes.
const RELEASES_FILE = path.join(FLOWS_DIR, '.releases.json');
const RELEASES_DIR  = path.join(FLOWS_DIR, '.releases');

function loadReleases() {
  try { return JSON.parse(fs.readFileSync(RELEASES_FILE, 'utf8')); } catch (_) { return []; }
}
function saveReleases(all) {
  if (!fs.existsSync(FLOWS_DIR)) fs.mkdirSync(FLOWS_DIR, { recursive: true });
  fs.writeFileSync(RELEASES_FILE, JSON.stringify(all, null, 2));
}

// Gemmer ét flows indhold og returnerer den relative sti. Navnet bærer tiden,
// så to releases af samme flow aldrig kan overskrive hinandens snapshot.
function saveSnapshot(envId, name, yaml) {
  if (yaml == null) return null;
  const dir = path.join(RELEASES_DIR, sanitizeName(String(envId)));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const rel = path.join(sanitizeName(String(envId)),
    `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${sanitizeName(name)}.yaml`);
  fs.writeFileSync(path.join(RELEASES_DIR, rel), String(yaml), 'utf8');
  return rel;
}
function readSnapshot(rel) {
  if (!rel) return null;
  const p = path.resolve(RELEASES_DIR, rel);
  if (!p.startsWith(path.resolve(RELEASES_DIR) + path.sep)) return null;
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

// Linje-diff (længste fælles delfølge). Fælles begyndelse og slutning skæres
// fra først — i et flow er ændringen næsten altid et lille stykke midt i en
// lang fil. Er midterstykket stadig for stort til tabellen, meldes det hele
// som fjernet og tilføjet frem for at bruge hundredvis af MB på det.
const DIFF_MAX_CELLS = 4_000_000;
function lineDiff(a, b) {
  const A = String(a ?? '').split('\n'), B = String(b ?? '').split('\n');
  if (a == null || a === '') A.length = 0;
  if (b == null || b === '') B.length = 0;
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const out = A.slice(0, s).map(text => ({ op: ' ', text }));
  const midA = A.slice(s, ea), midB = B.slice(s, eb);
  const n = midA.length, m = midB.length;
  if (n * m > DIFF_MAX_CELLS) {
    for (const text of midA) out.push({ op: '-', text });
    for (const text of midB) out.push({ op: '+', text });
  } else if (n || m) {
    const L = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i * (m + 1) + j] = midA[i] === midB[j]
          ? L[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { out.push({ op: ' ', text: midA[i] }); i++; j++; }
      else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) out.push({ op: '-', text: midA[i++] });
      else out.push({ op: '+', text: midB[j++] });
    }
    while (i < n) out.push({ op: '-', text: midA[i++] });
    while (j < m) out.push({ op: '+', text: midB[j++] });
  }
  for (const text of A.slice(ea)) out.push({ op: ' ', text });
  return out;
}

// Diff'en til en release note. Begge sider er fra SAMME miljø — før og efter —
// så præfiks og division er ens og skal stå som de er. Kun det der skifter ved
// hver eksport (trackingId'er, refId-numre, tomme beskrivelser) renses væk, så
// noten viser det der faktisk er ændret og ikke hundrede linjer støj.
// Hunks med 3 linjers kontekst; en meget stor ændring skæres af og siger det.
const DIFF_CONTEXT = 3, DIFF_MAX_LINES = 600;
function releaseDiff(prevYaml, newYaml) {
  const rens = y => normalizeFlowYaml(y);
  if (prevYaml == null) {
    const lines = rens(newYaml).split('\n');
    return { noPrevious: true, added: lines.length, removed: 0, hunks: [], truncated: false };
  }
  const d = lineDiff(rens(prevYaml), rens(newYaml));
  const added = d.filter(x => x.op === '+').length;
  const removed = d.filter(x => x.op === '-').length;
  const hunks = [];
  let cur = null, lastChange = -Infinity, shown = 0, truncated = false;
  d.forEach((x, idx) => {
    if (x.op === ' ') return;
    const from = Math.max(0, idx - DIFF_CONTEXT);
    if (!cur || from > lastChange + DIFF_CONTEXT + 1) {
      if (cur) hunks.push(cur);
      cur = { start: from, end: from };
    }
    lastChange = idx;
    cur.end = Math.min(d.length, idx + DIFF_CONTEXT + 1);
  });
  if (cur) hunks.push(cur);
  const ud = [];
  for (const h of hunks) {
    if (shown >= DIFF_MAX_LINES) { truncated = true; break; }
    const lines = d.slice(h.start, h.end).map(x => x.op + ' ' + x.text);
    const left = DIFF_MAX_LINES - shown;
    if (lines.length > left) truncated = true;
    ud.push({ line: h.start + 1, lines: lines.slice(0, left) });
    shown += Math.min(lines.length, left);
  }
  return { noPrevious: false, added, removed, hunks: ud, truncated };
}

// ── Hvor releases bor ────────────────────────────────────────────────────────
// Sandheden ligger i ORG'EN, i manifest-rækken for flowet: en kort historik
// (seneste ORG_RELEASES_MAX) med udgaverne før og efter, hvem, hvornår og noten.
// Indholdet gemmes IKKE dér — Genesys har allerede hver publiceret udgave, så
// en rollback henter bare den udgave målet stod på før, direkte fra org'en.
// Derfor kan man forfremme fra én pc og rulle tilbage fra en anden.
//
// Den lokale fil er en cache: den har diff'en og indholdet klar, så man slipper
// for en eksport, og den er det eneste sted historikken findes for et miljø
// uden manifest-tabel.
const ORG_RELEASES_MAX = 20;
const ORG_ROW_MAX_CHARS = 60000;   // langt under tabellens grænse; en række skal kunne læses hurtigt

function recordRelease(entry) {
  const all = loadReleases();
  const rel = {
    id: entry.id || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    at: entry.at || Date.now(),
    ...entry,
    flowType: normType(entry.flowType)
  };
  const i = all.findIndex(x => x.id === rel.id && x.targetId === rel.targetId);
  if (i >= 0) all[i] = { ...all[i], ...rel }; else all.push(rel);
  // Loggen må ikke vokse uden ende. Snapshots der ikke længere har en post,
  // ryddes med — ellers ville mappen blive ved med at vokse alligevel.
  const MAX = 2000;
  if (all.length > MAX) {
    for (const old of all.splice(0, all.length - MAX))
      for (const s of [old.prevSnapshot, old.newSnapshot]) {
        if (!s) continue;
        try { fs.unlinkSync(path.resolve(RELEASES_DIR, s)); } catch (_) {}
      }
  }
  saveReleases(all);
  return rel;
}

// Det der kommer med i org'en: alt undtagen indhold og diff-linjer.
function compactRelease(r) {
  const d = r.diff || {};
  const c = {
    id: r.id, at: r.at, kind: r.kind, action: r.action || null,
    sourceName: r.sourceName || null, sourceVersion: r.sourceVersion ?? null,
    fromName: r.fromName || null, toName: r.toName,
    prevVersion: r.prevVersion ?? null, newVersion: r.newVersion ?? null,
    by: r.by || null, bySource: r.bySource || null,
    note: r.note || '', rollbackOf: r.rollbackOf || null,
    rolledBackBy: r.rolledBackBy || null, rolledBackAt: r.rolledBackAt || null,
    references: r.references || [], cascade: r.cascade || [],
    diffSummary: { added: d.added ?? r.diffSummary?.added ?? null,
                   removed: d.removed ?? r.diffSummary?.removed ?? null,
                   noPrevious: d.noPrevious ?? r.diffSummary?.noPrevious ?? false }
  };
  return c;
}

// Holder historikken inden for rammerne: de nyeste ORG_RELEASES_MAX, og
// færre hvis rækken ellers bliver for stor. Nyeste står sidst.
function trimOrgReleases(list, rowWithout) {
  let out = list.slice(-ORG_RELEASES_MAX);
  const base = JSON.stringify(rowWithout || {}).length;
  while (out.length > 1 && base + JSON.stringify(out).length > ORG_ROW_MAX_CHARS) out = out.slice(1);
  return out;
}

// Læs rækken, lad fn ændre historikken, skriv den tilbage. Rækkens øvrige
// felter (versionen manifestet noterede, hvem der forfremmede) røres ikke.
async function updateOrgReleases(env, baseName, flowType, fn) {
  const key = orgManifestKey(baseName, flowType);
  const row = await readOrgManifestRow(env, key);
  if (row === undefined) return { ok: false, reason: 'no-table' };
  const cur = (row && row.releases) || [];
  const { releases: _, ...rest } = row || {};
  const next = trimOrgReleases(fn(cur.slice()) || cur, rest);
  return putOrgManifestRow(env, key, { ...rest, releases: next });
}

// Skriver releasen begge steder. Fejler org'en, står den stadig lokalt — og
// det siges i loggen, for så kan en anden pc ikke se den.
async function recordReleaseEverywhere(env, entry) {
  const rel = recordRelease(entry);
  if (!stageOf(env)) return rel;          // løst miljø: kun på denne pc
  try {
    const r = await updateOrgReleases(env, rel.baseName, rel.flowType, list => [...list, compactRelease(rel)]);
    if (!r.ok && r.reason === 'no-table')
      addLog('WARN', `${env.name} has no manifest table — the release of "${rel.toName}" is only stored on this PC`, env.name, 'RELEASE');
  } catch (e) {
    addLog('WARN', `Could not write the release of "${rel.toName}" to the manifest in ${env.name}: ${describeApiError(e)} — it is only stored on this PC`, env.name, 'RELEASE');
  }
  return rel;
}

// Ændrer én release begge steder (note, rullet tilbage, kaskade).
async function mutateRelease(env, baseName, flowType, id, fn) {
  const all = loadReleases();
  const lokal = all.find(x => x.id === id && x.targetId === env.id);
  if (lokal) { fn(lokal); saveReleases(all); }
  try {
    await updateOrgReleases(env, baseName, flowType, list => {
      const hit = list.find(x => x.id === id);
      if (hit) fn(hit);
      else if (lokal) list.push(compactRelease(lokal));   // kun lokalt indtil nu — send den med
      return list;
    });
  } catch (e) {
    addLog('WARN', `Could not update the release in the manifest in ${env.name}: ${describeApiError(e)}`, env.name, 'RELEASE');
  }
}

// Org'ens historik og den lokale cache flettet på id. Org'en vinder på det
// andre kan have ændret (note, rullet tilbage, kaskade); cachen bidrager med
// diff-linjer og indhold. Poster der kun findes lokalt (miljø uden tabel, eller
// ældre end org'ens historik) tages med.
function mergeReleases(orgList, localList, ctx) {
  const byId = new Map();
  for (const l of localList) byId.set(l.id, { ...l, source: 'local' });
  for (const o of orgList || []) {
    const l = byId.get(o.id);
    byId.set(o.id, {
      ...(l || {}), ...o,
      targetId: ctx.env.id, targetName: ctx.env.name, targetStage: stageOf(ctx.env),
      tenant: tenantOf(ctx.env), group: groupOf(ctx.env),
      baseName: ctx.baseName, flowType: normType(ctx.flowType),
      diff: l && l.diff && l.diff.hunks ? l.diff : null,
      prevSnapshot: l ? l.prevSnapshot : null, newSnapshot: l ? l.newSnapshot : null,
      source: l ? 'org+local' : 'org'
    });
  }
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

// Hele historikken for ét miljø: org-rækkerne (hvis tabellen findes) + cachen.
// rows kan gives med, så tavlen ikke læser tabellen to gange.
async function releasesOfEnv(env, rows) {
  if (rows === undefined) {
    try { rows = await readOrgManifest(env); }
    catch (e) {
      rows = null;
      addLog('WARN', `Could not read the manifest in ${env.name}: ${describeApiError(e)} — showing releases stored on this PC only`, env.name, 'RELEASE');
    }
  }
  const local = loadReleases().filter(r => r.targetId === env.id);
  const keys = new Set([
    ...Object.keys(rows || {}),
    ...local.map(r => orgManifestKey(r.baseName, r.flowType))
  ]);
  const out = [];
  for (const key of keys) {
    const [baseName, flowType] = key.split('|');
    const org = rows && rows[key] ? rows[key].releases || [] : [];
    const lok = local.filter(r => orgManifestKey(r.baseName, r.flowType) === key);
    if (!org.length && !lok.length) continue;
    out.push(...mergeReleases(org, lok, { env, baseName, flowType }));
  }
  return out.sort((a, b) => b.at - a.at);
}

// Demoens releases ryddes sammen med demoen, ligesom dens manifestrækker.
function dropDemoReleases(which) {
  const hit = id => which === '2' ? String(id).startsWith('demo2-')
            : which === '1' ? (String(id).startsWith('demo-') && !String(id).startsWith('demo2-'))
            : String(id).startsWith('demo');
  const all = loadReleases();
  const keep = [];
  for (const r of all) {
    if (!hit(r.targetId || '')) { keep.push(r); continue; }
    for (const s of [r.prevSnapshot, r.newSnapshot]) {
      if (!s) continue;
      try { fs.unlinkSync(path.resolve(RELEASES_DIR, s)); } catch (_) {}
    }
  }
  if (keep.length !== all.length) saveReleases(keep);
}

// Releases for ét flow i ét miljø, nyeste først. Grundnavnet er nøglen, så en
// omdøbning fra _v5 til _v6 stadig er samme historik.
function releasesFor(all, envId, baseName, flowType) {
  const ft = normType(flowType);
  return all.filter(r => r.targetId === envId && r.baseName === baseName && r.flowType === ft)
            .sort((a, b) => b.at - a.at);
}

// Den release der kan rulles tilbage: den nyeste FORFREMMELSE, som ikke selv
// er rullet tilbage, og som har et "før" at gå tilbage til. Rollbacks og
// genpubliceringer springes over — de ændrer ikke hvad der blev leveret, så
// næste klik efter en rollback går én forfremmelse længere tilbage (_v6 → _v5
// → _v4). En release der oprettede flowet har intet før at gå tilbage til.
//
// "Et før" er udgaven målet stod på (hentes fra org'en) — eller indholdet i
// cachen, hvis udgaven af en eller anden grund ikke blev noteret.
function rollbackCandidate(list) {
  const top = list.find(r => r.kind === 'promotion' && !r.rolledBackBy);
  if (!top || !(top.prevVersion || top.prevSnapshot)) return null;
  return top;
}

// Indholdet af én bestemt udgave af et flow — fra org'ens egen historik.
// version null = den gemte kladde (bruges kun når en release aldrig blev
// publiceret). Demoen har sin egen historik pr. flow.
async function flowVersionContent(env, name, flowType, version) {
  if (isDemo(env)) {
    const siblings = loadCustomers().filter(c => isDemo(c) && demoFlowKey(c) === demoFlowKey(env));
    const base = baseFlowName(stripEnvPrefix(name, env));
    const f = demoFlowsFor(env).find(x => normType(x.type) === normType(flowType) &&
      belongsToEnv(x.name, env, siblings) && baseFlowName(stripEnvPrefix(x.name, env)) === base);
    if (!f) throw new Error(`"${name}" does not exist in ${env.name}`);
    if (version == null || String(version) === String(f.published)) return f.content;
    const hit = (f.versions || {})[String(version)];
    if (hit == null) throw new Error(`Version ${version} of "${name}" is no longer in ${env.name}`);
    return hit;
  }
  const { yaml } = await exportFlowToYaml(env, name, String(flowType).toLowerCase(), version);
  return yaml;
}

// Find én release ud fra { envId, baseName, flowType, id }.
async function findRelease(ref) {
  const env = loadCustomers().find(c => c.id === (ref && ref.envId));
  if (!env) return { error: 'Environment not found', status: 404 };
  let rows;
  try { rows = await readOrgManifest(env); } catch (_) { rows = null; }
  const key = orgManifestKey(ref.baseName, ref.flowType);
  const org = rows && rows[key] ? rows[key].releases || [] : [];
  const lok = loadReleases().filter(r => r.targetId === env.id && orgManifestKey(r.baseName, r.flowType) === key);
  const list = mergeReleases(org, lok, { env, baseName: ref.baseName, flowType: ref.flowType });
  const rel = list.find(r => r.id === ref.id);
  if (!rel) return { error: 'Release not found', status: 404 };
  return { env, list, rel };
}

// Diff'en for en release: fra cachen, ellers bygget af de to udgaver i org'en
// og lagt i cachen, så det kun koster eksporten én gang.
async function releaseDiffFor(env, rel) {
  if (rel.diff && rel.diff.hunks) return rel.diff;
  const s = rel.diffSummary || {};
  if (rel.kind === 'republish' || (s.added === 0 && s.removed === 0))
    return { noPrevious: false, added: 0, removed: 0, hunks: [], truncated: false };
  let prev = readSnapshot(rel.prevSnapshot), neu = readSnapshot(rel.newSnapshot);
  const navn = rel.toName;
  if (prev == null && rel.prevVersion) prev = await flowVersionContent(env, navn, rel.flowType, rel.prevVersion);
  if (neu == null) neu = await flowVersionContent(env, navn, rel.flowType, rel.newVersion || null);
  const diff = releaseDiff(prev, neu);
  recordRelease({
    ...rel, diff,
    prevSnapshot: rel.prevSnapshot || saveSnapshot(env.id, navn, prev),
    newSnapshot: rel.newSnapshot || saveSnapshot(env.id, navn, neu)
  });
  return diff;
}

// Release-noten som markdown — til at sætte ind i en change request eller mail.
function releaseNoteMarkdown(r) {
  const dato = new Date(r.at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const kind = { promotion: 'Promotion', rollback: 'Rollback', republish: 'Republish (common module)' }[r.kind] || r.kind;
  const l = [];
  l.push(`## ${r.toName} — ${r.targetName}`);
  l.push('');
  l.push(`- **Type:** ${kind}`);
  l.push(`- **Flow:** ${r.baseName} (${r.flowType})`);
  if (r.sourceName) l.push(`- **From:** ${r.sourceName}${r.sourceVersion ? ` (v${r.sourceVersion})` : ''}`);
  l.push(`- **To:** ${r.targetName}${r.prevVersion ? ` — v${r.prevVersion} → v${r.newVersion || '?'}` : r.newVersion ? ` — v${r.newVersion}` : ''}`);
  if (r.fromName && r.fromName !== r.toName) l.push(`- **Renamed:** ${r.fromName} → ${r.toName}`);
  l.push(`- **When:** ${dato}`);
  if (r.by) l.push(`- **By:** ${r.by}${r.bySource === 'machine' ? ' (PC user)' : ''}`);
  if (r.note) l.push(`- **Note:** ${r.note}`);
  if (r.rollbackOf) l.push(`- **Rolls back:** release ${r.rollbackOf}`);
  if (r.rolledBackBy) l.push(`- **Rolled back** by release ${r.rolledBackBy}`);
  if ((r.references || []).length) l.push(`- **References rewritten:** ${r.references.join(', ')}`);
  if ((r.cascade || []).length) {
    l.push(`- **Dependent flows republished:**`);
    for (const c of r.cascade) l.push(`  - ${c.ok ? '✓' : '✗'} ${c.name}${c.error ? ` — ${c.error}` : ''}`);
  }
  l.push('');
  const d = r.diff || r.diffSummary || {};
  if (d.noPrevious) l.push(`_New in ${r.targetName} — no previous version to compare with._`);
  else if (!d.added && !d.removed) l.push(d.added == null ? '_Changes not available._' : '_No content changes._');
  else {
    l.push(`**Changes:** +${d.added} / −${d.removed} lines`);
    if (d.hunks) {
      l.push('');
      l.push('```diff');
      for (const h of d.hunks) { l.push(`@@ line ${h.line} @@`); l.push(...h.lines); }
      if (d.truncated) l.push('… (truncated)');
      l.push('```');
    }
  }
  return l.join('\n');
}

// Til brugerfladen: det klienten skal bruge for at pege på en release igen.
const releaseRef = r => ({ envId: r.targetId, baseName: r.baseName, flowType: r.flowType, id: r.id });

module.exports = { recordReleaseEverywhere, saveSnapshot, releaseDiff, releaseRef,
  dropDemoReleases, trimOrgReleases, compactRelease, loadReleases, readSnapshot, lineDiff,
  ORG_RELEASES_MAX, mutateRelease, mergeReleases, releasesOfEnv, releasesFor, rollbackCandidate,
  flowVersionContent, findRelease, releaseDiffFor, releaseNoteMarkdown };
