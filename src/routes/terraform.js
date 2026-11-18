// Ruter: Terraform — fuld eksport, hurtig startopsætning, redigering, plan og apply.
//
// Hver opsætning er en arbejdsmappe under data/terraform/<fra>[_<til>]/<dato>/ og
// hører til ÉN org: målet, eller kilden når der ikke er valgt et mål. Plan og
// apply kører altid mod den org, så en mappe aldrig kommer til at blande to
// orgs' state. Filerne er almindelige .tf-filer, som kunden kan tage med og
// køre videre i med sin egen terraform.

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ROOT_DIR, FLOWS_DIR, saveSettings } = require('../config');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { sanitizeName, describeApiError, safeFileName } = require('../lib/helpers');
const { getToken } = require('../lib/token');
const { pagedList, orgReadError } = require('../lib/genesys');
const { archyHint } = require('../lib/archy');
const { isDemo, stageOf } = require('../lib/environments');
const CLI = require('../lib/terraform-cli');
const { TERRAFORM_DIR, PROVIDER_DIR } = CLI;

const router = express.Router();

const TERRAFORM = require('../terraform.js');
const HCL = require('../terraform-hcl.js');
const KIT = require('../terraform-kit.js');

// ── Arbejdsmapper ────────────────────────────────────────────────────────────
const META = 'workspace.json';
const PLAN_FILE = 'archy.tfplan';
const PLAN_META = '.archy-plan.json';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-').replace(/-(\d\d)-(\d\d)$/, '_$1$2');
const part = n => sanitizeName(n).trim().replace(/\s+/g, '-').replace(/-{2,}/g, '-');

// "<org>/<dato>" → mappen. Alt andet afvises — også ".." og skjulte mapper.
function wsDir(ws) {
  const m = /^([^/\\]+)\/([^/\\]+)$/.exec(String(ws || ''));
  if (!m || [m[1], m[2]].some(p => p.startsWith('.') || p.includes('..'))) throw httpError(400, 'Invalid folder');
  const dir = path.resolve(TERRAFORM_DIR, m[1], m[2]);
  if (!dir.startsWith(path.resolve(TERRAFORM_DIR) + path.sep)) throw httpError(400, 'Invalid folder');
  if (!fs.existsSync(dir)) throw httpError(404, 'The folder no longer exists');
  return dir;
}
const wsId = dir => path.relative(TERRAFORM_DIR, dir).split(path.sep).join('/');

function httpError(status, msg) { const e = new Error(msg); e.status = status; return e; }

function readMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, META), 'utf8')); } catch (_) { return legacyMeta(dir); }
}

// Mapper fra før v1.82 har ingen workspace.json. Navnet <fra>[_<til>] siger
// hvilke orgs de hører til, når navnene stadig passer med miljøerne.
function legacyMeta(dir) {
  const folder = path.basename(path.dirname(dir));
  const all = loadCustomers();
  for (const s of all) {
    const ps = part(s.name);
    if (folder === ps) return { kind: 'generator', sourceId: s.id, sourceName: s.name, legacy: true };
    if (!folder.startsWith(ps + '_')) continue;
    const t = all.find(c => c.id !== s.id && part(c.name) === folder.slice(ps.length + 1));
    if (t) return { kind: 'generator', sourceId: s.id, sourceName: s.name, targetId: t.id, targetName: t.name, legacy: true };
  }
  return { kind: 'generator', legacy: true };
}
function writeMeta(dir, meta) { fs.writeFileSync(path.join(dir, META), JSON.stringify(meta, null, 2)); }

// Den org mappen hører til: målet, ellers kilden.
function boundEnv(meta) {
  const id = meta.targetId || meta.sourceId;
  return id ? loadCustomers().find(c => c.id === id) || null : null;
}

// Filer GUI'en må vise og rette. State, planer og providerens mappe røres ikke.
const EDITABLE = /\.(tf|tfvars|yaml|yml|md|json|hcl|txt|example)$/i;
const HIDDEN = /(^|\/)\.terraform(\/|$)|\.tfstate(\.backup)?$|\.tfplan$|(^|\/)\.archy-plan\.json$|(^|\/)workspace\.json$|(^|\/)_export(\/|$)/i;

function wsFile(dir, rel, { write = false } = {}) {
  const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!r || r.split('/').some(p => !p || p === '.' || p === '..')) throw httpError(400, 'Invalid file name');
  if (HIDDEN.test(r) || r.endsWith('.terraform.lock.hcl') && write) throw httpError(400, `${r} is managed by Terraform and cannot be edited here`);
  if (!EDITABLE.test(r)) throw httpError(400, `Only text files can be edited here (.tf, .tfvars, .yaml, .md …): ${r}`);
  const f = path.resolve(dir, r);
  if (!f.startsWith(dir + path.sep)) throw httpError(400, 'Invalid file name');
  return { f, r };
}

function listFiles(dir) {
  const out = [];
  const walk = (d, pre) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of names) {
      const rel = pre + e.name;
      if (HIDDEN.test(rel) || e.name === '.terraform') continue;
      if (e.isDirectory()) { walk(path.join(d, e.name), rel + '/'); continue; }
      if (!EDITABLE.test(e.name)) continue;
      const st = fs.statSync(path.join(d, e.name));
      out.push({ path: rel, size: st.size, modified: st.mtimeMs });
    }
  };
  walk(dir, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const tfFiles = dir => listFiles(dir).filter(f => /\.tf$/i.test(f.path));

// ── Ændret siden sidste apply ────────────────────────────────────────────────
// Archy husker de ressourcer man har oprettet, rettet eller slettet her, så
// planen kan begrænses til dem uden at nogen skal huske adresserne.
function touch(dir, addrs) {
  if (!addrs || !addrs.length) return;
  const meta = readMeta(dir);
  const set = new Set(meta.touched || []);
  for (const a of addrs) set.add(a);
  writeMeta(dir, { ...meta, touched: [...set] });
}

function configAddrs(dir) {
  const out = new Set();
  for (const f of tfFiles(dir)) {
    try { for (const r of HCL.resources(fs.readFileSync(path.join(dir, f.path), 'utf8'))) out.add(`${r.type}.${r.name}`); } catch (_) {}
  }
  return out;
}

function stateAddrs(dir) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'terraform.tfstate'), 'utf8'));
    return new Set((st.resources || []).filter(r => r.mode === 'managed' && !r.module).map(r => `${r.type}.${r.name}`));
  } catch (_) { return new Set(); }
}

// Kun det der stadig findes i filerne eller i state — en ressource der blev
// oprettet og slettet igen før et apply, har intet at planlægge.
function touchedNow(dir, meta) {
  const list = meta.touched || [];
  if (!list.length) return [];
  const cfg = configAddrs(dir);
  const missing = list.filter(a => !cfg.has(a));
  const st = missing.length ? stateAddrs(dir) : new Set();
  return list.filter(a => cfg.has(a) || st.has(a));
}

function wsSummary(dir) {
  const meta = readMeta(dir);
  const files = tfFiles(dir);
  let resources = 0;
  for (const f of files) {
    try { resources += (fs.readFileSync(path.join(dir, f.path), 'utf8').match(/^\s*resource\s+"/gm) || []).length; } catch (_) {}
  }
  const env = boundEnv(meta);
  let plan = null;
  try { plan = JSON.parse(fs.readFileSync(path.join(dir, PLAN_META), 'utf8')); } catch (_) {}
  return {
    ws: wsId(dir), absolute: dir, kind: meta.kind || 'generator', created: meta.created || fs.statSync(dir).mtime.toISOString(),
    sourceId: meta.sourceId || null, sourceName: meta.sourceName || null,
    targetId: meta.targetId || null, targetName: meta.targetName || null,
    bound: env ? { id: env.id, name: env.name, stage: stageOf(env), demo: isDemo(env) } : null,
    includeState: !!meta.includeState, copiedFrom: meta.copiedFrom || null,
    files: files.length, resources,
    hasState: fs.existsSync(path.join(dir, 'terraform.tfstate')),
    initialized: fs.existsSync(path.join(dir, '.terraform')),
    lastPlan: plan && fs.existsSync(path.join(dir, PLAN_FILE)) ? { created: plan.created, envId: plan.envId, summary: plan.summary, planHash: plan.hash } : null,
    lastApply: meta.lastApply || null,
    touched: touchedNow(dir, meta),
    exportErrors: exportErrors(dir),
    flowCheck: meta.flowCheck || null,
  };
}

function listWorkspaces() {
  const out = [];
  let orgs = [];
  try { orgs = fs.readdirSync(TERRAFORM_DIR, { withFileTypes: true }); } catch (_) { return out; }
  for (const o of orgs) {
    if (!o.isDirectory() || o.name.startsWith('.')) continue;
    let runs = [];
    try { runs = fs.readdirSync(path.join(TERRAFORM_DIR, o.name), { withFileTypes: true }); } catch (_) { continue; }
    for (const r of runs) {
      if (!r.isDirectory() || r.name.startsWith('.')) continue;
      try { out.push(wsSummary(path.join(TERRAFORM_DIR, o.name, r.name))); } catch (_) {}
    }
  }
  return out.sort((a, b) => String(b.created || b.ws).localeCompare(String(a.created || a.ws)));
}

// Fejl fra en rute: kendte terraform-fejl får en kode, som brugerfladen forklarer.
function sendError(res, e) {
  const status = e.status || (e.response && e.response.status === 404 ? 404 : 500);
  res.status(status).json({ error: archyHint(describeApiError(e)), hint: e.hint || HCL.errorHint(e.message) });
}

function needTerraform() {
  const exe = CLI.findTerraform();
  if (!exe) throw Object.assign(httpError(400, 'terraform.exe was not found. Install Terraform or enter its path in the Terraform tab'), { hint: 'no_cli' });
  return exe;
}

async function envLogin(env) {
  if (!env) throw httpError(404, 'The org this folder belongs to no longer exists in Archy GUI');
  if (isDemo(env)) throw httpError(400, `"${env.name}" is a demo environment — it has no org for Terraform to talk to`);
  const { token, apiBase } = await getToken(env);
  const region = TERRAFORM.awsRegion(env.region);
  if (!region) throw httpError(400, `Unknown region for "${env.name}": ${env.region}`);
  return { token, region, apiBase };
}

// Scopes PKCE-klienten mangler til en eksport. Kan klienten ikke slås op (fx
// uden oauth:client:view), tjekkes der ikke — eksporten viser det så selv.
async function missingClientScopes(env, token, apiBase) {
  if (env.authType !== 'oauth' || !env.clientId) return [];
  try {
    const r = await axios.get(`${apiBase}/api/v2/oauth/clients/${encodeURIComponent(env.clientId)}`, { headers: { Authorization: `Bearer ${token}` } });
    return HCL.missingExportScopes(r.data && r.data.scope);
  } catch (_) { return []; }
}

// En terraform-kommando i et job. Uddata går gennem logFilter: ventelinjer bliver
// til job.elapsed, og rettighedsfejl til job.skipped. Fejler den, bærer fejlen
// en forklaringskode. stoppable: false for apply, som ikke afbrydes halvvejs.
async function tfStep(exe, args, cwd, env, log, job, { exportRun = false, stoppable = true } = {}) {
  log(`$ terraform ${args.join(' ')}`);
  const filter = HCL.logFilter({ exportRun });
  const onLine = l => {
    const f = filter(l);
    if (f.elapsed) { if (job) job.elapsed = f.elapsed; }
    else if (f.skipped) { if (job) HCL.addSkipped(job.skipped, f.skipped); else log(l); }
    else if (f.log) log(f.log);
  };
  if (job) job.elapsed = null;
  const r = await CLI.runTerraform(exe, args, { cwd, env, onLine, signal: job && stoppable ? job.controller.signal : null });
  if (r.aborted) throw new Error('Stopped');
  if (r.code !== 0) {
    const tail = r.out.split(/\r?\n/).filter(l => l.trim()).slice(-6).join('\n');
    throw Object.assign(new Error(`terraform ${args[0]} failed (exit ${r.code})${tail ? ':\n' + tail : ''}`), { hint: HCL.errorHint(r.out), output: r.out });
  }
  return r;
}

// ── terraform.exe ────────────────────────────────────────────────────────────
const cliStatus = async () => {
  const exe = CLI.findTerraform();
  return exe ? { found: true, path: exe, ...(await CLI.checkTerraform(exe)) } : { found: false, path: null, version: null };
};

router.get('/api/terraform/cli', async (req, res) => res.json(await cliStatus()));

router.post('/api/terraform/cli', async (req, res) => {
  const p = String(req.body.path || '').trim().replace(/^"|"$/g, '');
  if (p && !(fs.existsSync(p) && fs.statSync(p).isFile() && /terraform(\.exe)?$/i.test(p)))
    return res.status(400).json({ error: `Not a terraform executable: ${p}` });
  saveSettings({ terraformPath: p || null });
  res.json(await cliStatus());
});

// ── Providerens schema (felterne i formularerne) ─────────────────────────────
// Hentes én gang og deles af samtidige kald. Fejler det, huskes fejlen i to
// minutter — ellers startede hver formular en ny terraform-kørsel på 20 sek.
let _schema = null, _schemaRun = null, _schemaFail = null;
function providerSchema() {
  if (_schema) return Promise.resolve(_schema);
  if (_schemaFail && Date.now() - _schemaFail.at < 120e3) return Promise.reject(_schemaFail.err);
  if (!_schemaRun) _schemaRun = loadSchema().then(
    s => { _schema = s; _schemaFail = null; return s; },
    e => { _schemaFail = { at: Date.now(), err: e }; throw e; }
  ).finally(() => { _schemaRun = null; });
  return _schemaRun;
}

async function loadSchema() {
  const cached = path.join(PROVIDER_DIR, 'schema.trimmed.json');
  try { const c = JSON.parse(fs.readFileSync(cached, 'utf8')); if (Object.keys(c.types || {}).length) return c; } catch (_) {}
  const exe = needTerraform();
  fs.mkdirSync(PROVIDER_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROVIDER_DIR, 'main.tf'),
    'terraform {\n  required_providers {\n    genesyscloud = {\n      source = "mypurecloud/genesyscloud"\n    }\n  }\n}\n');
  const env = CLI.terraformEnv();
  if (!fs.existsSync(path.join(PROVIDER_DIR, '.terraform'))) {
    const r = await CLI.runTerraform(exe, ['init', '-input=false', '-no-color'], { cwd: PROVIDER_DIR, env });
    if (r.code !== 0) throw Object.assign(new Error('terraform init failed: ' + r.out.trim().split('\n').slice(-4).join(' ')), { hint: HCL.errorHint(r.out) });
  }
  const r = await CLI.captureTerraform(exe, ['providers', 'schema', '-json'], { cwd: PROVIDER_DIR, env });
  if (r.code !== 0) throw Object.assign(new Error('terraform providers schema failed: ' + r.err.trim().split('\n').slice(-4).join(' ')), { hint: HCL.errorHint(r.err) });
  const trimmed = HCL.trimSchema(r.out);
  let version = null;
  try { version = (/version\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(PROVIDER_DIR, '.terraform.lock.hcl'), 'utf8')) || [])[1] || null; } catch (_) {}
  const out = { version, types: trimmed.types };
  fs.writeFileSync(cached, JSON.stringify(out));
  return out;
}

router.get('/api/terraform/schema', async (req, res) => {
  try {
    const s = await providerSchema();
    if (req.query.type) {
      const t = s.types[req.query.type];
      if (!t) return res.status(404).json({ error: `Unknown resource type: ${req.query.type}` });
      return res.json({ type: req.query.type, ...t });
    }
    res.json({ version: s.version, types: Object.keys(s.types).sort().map(k => ({ type: k, description: s.types[k].description.slice(0, 160) })) });
  } catch (e) { sendError(res, e); }
});

// ── Hurtig startopsætning (egen generator) ───────────────────────────────────
// Nyeste version af hvert flow i orgens mappe: "Navn_v5-0.yaml" → navn "Navn"
function latestFlowFiles(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => /\.ya?ml$/i.test(f) && !f.startsWith('.')); } catch (_) { return []; }
  const best = new Map();
  for (const f of names) {
    const m = f.match(/^(.*)_v(\d+)(?:-(\d+))?\.ya?ml$/i);
    const base = m ? m[1] : f.replace(/\.ya?ml$/i, '');
    const ver = m ? Number(m[2]) * 1000 + Number(m[3] || 0) : 0;
    if (!best.has(base) || ver > best.get(base).ver) best.set(base, { name: base, file: f, ver });
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function tfFetchKind(apiBase, token, k) {
  const list = await pagedList(apiBase, k.list, token, k.params || {});
  if (!k.detail) return list;
  const out = [];
  for (let i = 0; i < list.length; i += 5) {
    const chunk = await Promise.all(list.slice(i, i + 5).map(async x => {
      const d = k.detail(x);
      try {
        const r = await axios.get(`${apiBase}${d.path}`, { headers: { Authorization: `Bearer ${token}` }, params: d.params });
        return r.data;
      } catch (e) { return x; }
    }));
    out.push(...chunk);
  }
  return out;
}

router.get('/api/terraform/kinds', (req, res) => {
  res.json([...TERRAFORM.KINDS.map(k => ({ id: k.id, label: k.label })), { id: 'flows', label: 'Flows' }]);
});

function newWsDir(source, target, suffix = '') {
  const base = path.join(TERRAFORM_DIR, part(source.name) + (target ? '_' + part(target.name) : ''));
  let dir = path.join(base, stamp() + suffix), i = 2;
  while (fs.existsSync(dir)) dir = path.join(base, `${stamp()}${suffix}-${i++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

router.post('/api/terraform/generate', async (req, res) => {
  const source = loadCustomers().find(c => c.id === req.body.sourceId);
  if (!source) return res.status(404).json({ error: 'Customer not found' });
  const ids = new Set([...TERRAFORM.KINDS.map(k => k.id), 'flows']);
  const include = (Array.isArray(req.body.include) ? req.body.include : [...ids]).filter(i => ids.has(i));
  if (!include.length) return res.status(400).json({ error: 'Intet valgt' });
  try {
    const { token, apiBase } = await getToken(source);
    const data = {}, errors = {};
    for (const k of TERRAFORM.KINDS.filter(k => include.includes(k.id))) {
      try { data[k.id] = await tfFetchKind(apiBase, token, k); }
      catch (e) { errors[k.id] = orgReadError(e); }
    }
    // Til referencer: alle roller og divisioner, også når de ikke er valgt
    const lookup = {};
    for (const [name, url, have] of [['roles', '/api/v2/authorization/roles', data.roles], ['divisions', '/api/v2/authorization/divisions', data.divisions]]) {
      try { lookup[name] = have || await pagedList(apiBase, url, token); } catch (_) { lookup[name] = []; }
    }
    const flowDir = path.join(FLOWS_DIR, sanitizeName(source.name));
    const flows = include.includes('flows') ? latestFlowFiles(flowDir) : [];
    // Målet er valgfrit: det giver mappen navnet <fra>_<til> og providerens region som standard
    const target = loadCustomers().find(c => c.id === req.body.targetId && c.id !== source.id) || null;
    const lang = /^[a-z]{2}$/.test(String(req.body.lang || '')) ? req.body.lang : 'en';
    const result = TERRAFORM.build(data, { include, lookup, errors, orgName: source.name, targetName: target && target.name, targetRegion: target && target.region, lang, flows });

    const dir = newWsDir(source, target);
    const rel = path.relative(ROOT_DIR, dir);
    for (const [name, text] of Object.entries(result.files)) fs.writeFileSync(path.join(dir, safeFileName(name, 'fil.tf')), text, 'utf8');
    if (flows.length) {
      fs.mkdirSync(path.join(dir, TERRAFORM.FLOW_DIR), { recursive: true });
      for (const f of flows) fs.copyFileSync(path.join(flowDir, f.file), path.join(dir, TERRAFORM.FLOW_DIR, safeFileName(f.file, 'flow.yaml')));
    }
    writeKit(dir, target || source, lang);
    writeMeta(dir, { kind: 'generator', created: new Date().toISOString(), sourceId: source.id, sourceName: source.name,
      targetId: target ? target.id : null, targetName: target ? target.name : null, includeState: false, lang });
    const written = result.summary.reduce((n, s) => n + s.written, 0);
    addLog('SUCCESS', `Terraform setup written for ${source.name}${target ? ' → ' + target.name : ''}: ${written} objects in ${rel}`, source.name, 'TERRAFORM');
    res.json({ ok: true, ws: wsId(dir), dir: rel.replace(/\\/g, '/'), absolute: dir, files: Object.keys(result.files).sort(), flowsCopied: flows.length,
      summary: result.summary, notes: result.notes, errors });
  } catch (e) { res.status(500).json({ error: archyHint(describeApiError(e)) }); }
});

// ── Fuld eksport (Genesys' eksportør) ────────────────────────────────────────
const README_TEXT = {
  da: (src, tgt, state) => `# Terraform — ${src}${tgt ? ' → ' + tgt : ''}

Fuld eksport lavet med Genesys' egen eksportør (\`genesyscloud_tf_export\`) fra Archy GUI.
Filerne er almindelig Terraform og kan bruges uden Archy GUI.

${state
    ? `**Samme org:** \`terraform.tfstate\` kom med fra eksporten, så Terraform styrer allerede objekterne i ${src}. \`terraform plan\` bør vise 0 ændringer, indtil filerne rettes.`
    : `**Til en anden org:** der er ingen state, så \`terraform apply\` opretter objekterne i ${tgt || 'mål-org\'en'}. Prøv i en test-org først.`}
`,
  en: (src, tgt, state) => `# Terraform — ${src}${tgt ? ' → ' + tgt : ''}

Full export made with Genesys' own exporter (\`genesyscloud_tf_export\`) from Archy GUI.
The files are plain Terraform and work without Archy GUI.

${state
    ? `**Same org:** \`terraform.tfstate\` came with the export, so Terraform already manages the objects in ${src}. \`terraform plan\` should show 0 changes until the files are edited.`
    : `**To another org:** there is no state, so \`terraform apply\` creates the objects in ${tgt || 'the target org'}. Try it in a test org first.`}
`,
};
const exportReadme = (lang, src, tgt, state) => (README_TEXT[lang] || README_TEXT.en)(src, tgt, state);

const TYPE_RE = /^genesyscloud_[a-z0-9_]+(::.+)?$/;

// Ubrugte data-opslag fjernes fra .tf-filerne og gemmes i en tekstfil ved
// siden af, så intet går tabt. → antal fjernede
const PRUNED_FILE = 'archy-removed-data.txt';
function pruneUnusedData(dir) {
  const files = {};
  for (const f of tfFiles(dir)) { try { files[f.path] = fs.readFileSync(path.join(dir, f.path), 'utf8'); } catch (_) {} }
  const unused = HCL.unusedDataBlocks(files);
  if (!unused.length) return 0;
  const changed = {};
  for (const u of unused) changed[u.file] = HCL.removeDataBlock(changed[u.file] ?? files[u.file], u.type, u.name);
  for (const [f, text] of Object.entries(changed)) fs.writeFileSync(path.join(dir, f), text, 'utf8');
  const note = '# Data lookups removed by Archy GUI because nothing used them. They change nothing in the org;\n' +
    '# ambiguous ones (same action name in two integrations) made terraform plan fail. Paste one back if you need it.\n\n';
  fs.appendFileSync(path.join(dir, PRUNED_FILE), (fs.existsSync(path.join(dir, PRUNED_FILE)) ? '\n' : note) +
    unused.map(u => `# ${u.file}\n${u.text.trim()}\n`).join('\n'));
  return unused.length;
}

// Data-opslag fjernes fra state (se HCL.stripStateData); terraform.tfstate.backup
// får den gamle. → antal fjernede
function stripStateData(dir) {
  const f = path.join(dir, 'terraform.tfstate');
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (_) { return 0; }
  const r = HCL.stripStateData(text);
  if (!r.removed) return 0;
  fs.writeFileSync(f + '.backup', text, 'utf8');
  fs.writeFileSync(f, r.text, 'utf8');
  return r.removed;
}

// Eksportørens egen fejlliste (export_errors.json) samlet pr. manglende scope
// eller rettighed, med de typer der ikke kom (helt) med.
function exportErrors(dir) {
  try {
    const written = new Set(tfFiles(dir).map(f => path.basename(f.path, '.tf')));
    return HCL.summarizeExportErrors(fs.readFileSync(path.join(dir, 'export_errors.json'), 'utf8'), written);
  } catch (_) { return []; }
}

router.post('/api/terraform/export', async (req, res) => {
  try {
    const all = loadCustomers();
    const source = all.find(c => c.id === req.body.sourceId);
    if (!source) return res.status(404).json({ error: 'Customer not found' });
    const target = all.find(c => c.id === req.body.targetId && c.id !== source.id) || null;
    const include = (Array.isArray(req.body.include) ? req.body.include : []).map(String).filter(t => TYPE_RE.test(t));
    const exclude = (Array.isArray(req.body.exclude) ? req.body.exclude : []).map(String).filter(t => TYPE_RE.test(t));
    const lang = /^[a-z]{2}$/.test(String(req.body.lang || '')) ? req.body.lang : 'en';
    const exe = needTerraform();
    const { token, region, apiBase } = await envLogin(source);
    // Først: mangler OAuth-klienten scopes? Eksportøren melder dem ét ad gangen
    // og taber stille hele typer (Falck US: alle brugere og grupper på voicemail).
    const missingScopes = await missingClientScopes(source, token, apiBase);
    if (missingScopes.length && req.body.ignoreScopes !== true)
      return res.status(409).json({ error: `The OAuth client of ${source.name} lacks ${missingScopes.length} scope(s) the export reads with`,
        hint: 'missing_scopes', missingScopes, clientId: source.clientId });
    // Uden mål styrer mappen kilden selv: state kommer med, så plan viser 0 ændringer.
    const includeState = !target;
    const dir = newWsDir(source, target, '_full');
    const ws = wsId(dir);
    const job = CLI.startJob(ws, 'export', async (job, log) => {
      job.info = { source: source.name, target: target ? target.name : null, region };
      const work = path.join(dir, '_export');
      fs.mkdirSync(work, { recursive: true });
      fs.writeFileSync(path.join(work, 'main.tf'), HCL.exportMainTf({ includeState, include, exclude, dependencies: !!req.body.dependencies }));
      const env = CLI.terraformEnv({ token, region });
      try {
        log(`Read-only export of ${source.name} (${region})${target ? ' for ' + target.name : ''}. Nothing is changed in any org; files are written to this machine.`);
        job.phase = 'init';
        await tfStep(exe, ['init', '-input=false', '-no-color'], work, env, log, job, { exportRun: true });
        // "apply" opretter kun eksportørens hjælpe-ressource i en lokal state
        job.phase = 'export';
        // Mangler OAuth-klienten et scope til en type, stopper eksportøren helt.
        // Typen udelades så, står på listen over sprungne typer, og eksporten
        // startes forfra — højst 40 gange, så en ukendt fejl ikke kører i ring.
        const noScope = [];
        for (let forsoeg = 1; ; forsoeg++) {
          try {
            await tfStep(exe, ['apply', '-auto-approve', '-input=false', '-no-color'], work, env, log, job, { exportRun: true });
            break;
          } catch (e) {
            if (e.message === 'Stopped') throw e;
            const fails = HCL.exportFailures(e.output).filter(f => !noScope.includes(f.type) && !exclude.includes(f.type));
            if (!fails.length || forsoeg >= 40) throw e;
            // Fejler et opslag i et andet område (brugeres voicemail-politik), må
            // typen ikke udelades — så forsvandt alle brugere. Stop og sig hvad der mangler.
            const foreign = fails.filter(f => !HCL.isOwnRead(f.type, f.path));
            if (foreign.length)
              throw Object.assign(new Error(foreign.map(f => `${f.type} needs ${f.perm} (${f.path})`).join('; ') +
                ' — add it to the OAuth client and log in again'), { hint: 'missing_scope', output: e.output });
            for (const f of fails) { noScope.push(f.type); HCL.addSkipped(job.skipped, { perm: f.perm, what: f.type }); }
            log(`Skipped ${fails.map(f => `${f.type} (${f.perm})`).join(', ')} — the login cannot read it. Starting the export again without it …`);
            job.retries = forsoeg;
            // Forfra: uden den halve uddata og uden den fejlede hjælpe-ressource i state
            for (const n of ['out', 'terraform.tfstate', 'terraform.tfstate.backup']) {
              try { CLI.removeDir(path.join(work, n)); } catch (_) {}
            }
            fs.writeFileSync(path.join(work, 'main.tf'), HCL.exportMainTf({ includeState, include, exclude: [...exclude, ...noScope], dependencies: !!req.body.dependencies }));
          }
        }
        job.phase = 'save';
        const out = path.join(work, 'out');
        if (!fs.existsSync(out)) throw new Error('The exporter wrote no files');
        for (const name of fs.readdirSync(out)) fs.renameSync(path.join(out, name), path.join(dir, name));
      } finally {
        try { CLI.removeDir(work); } catch (e) { log(`Could not remove ${work}: ${e.code || e.message}`); }
      }
      const pruned = pruneUnusedData(dir);
      if (pruned) log(`Removed ${pruned} unused data lookups (kept in ${PRUNED_FILE}) — they change nothing in the org, and ambiguous ones stopped plan`);
      if (!fs.existsSync(path.join(dir, 'README.md'))) fs.writeFileSync(path.join(dir, 'README.md'), exportReadme(lang, source.name, target && target.name, includeState));
      writeKit(dir, target || source, lang);
      writeMeta(dir, { kind: 'export', created: new Date().toISOString(), sourceId: source.id, sourceName: source.name,
        targetId: target ? target.id : null, targetName: target ? target.name : null, includeState, lang, include, exclude,
        skipped: job.skipped, errors: exportErrors(dir) });
      // Med state skal mappen kunne planlægges med det samme
      if (includeState) {
        job.phase = 'init_ws';
        try { await tfStep(exe, ['init', '-input=false', '-no-color'], dir, env, log, job, { exportRun: true }); }
        catch (e) { if (e.message === 'Stopped') throw e; log('terraform init in the folder failed — run Init under Plan & apply'); }
      }
      try {
        const fc = await checkFlows(dir);
        if (fc.missing.length) log(`Flow check: ${fc.exported} of ${fc.total} flows exported — ${fc.missing.length} missing (see the folder)`);
      } catch (e) { log(`Flow check failed: ${describeApiError(e)}`); }
      job.phase = 'done';
      const s = wsSummary(dir);
      addLog('SUCCESS', `Terraform full export of ${source.name}${target ? ' (for ' + target.name + ')' : ''}: ${s.resources} resources in ${path.relative(ROOT_DIR, dir)}` +
        (job.skipped.length ? `; skipped for missing permissions: ${job.skipped.map(x => x.perm).join(', ')}` : ''), source.name, 'TERRAFORM');
      return { ws, resources: s.resources, files: s.files, skipped: job.skipped, errors: exportErrors(dir) };
    });
    // En fejlet eller stoppet eksport efterlader ingen halv mappe
    const watch = setInterval(() => {
      if (job.status === 'running') return;
      clearInterval(watch);
      if (job.status === 'done') return;
      if (job.status === 'cancelled') addLog('INFO', `Terraform full export of ${source.name} stopped by the user`, source.name, 'TERRAFORM');
      else addLog('ERROR', `Terraform full export of ${source.name} failed: ${job.error.split('\n')[0]}`, source.name, 'TERRAFORM');
      try { CLI.removeDir(dir); } catch (e) { addLog('WARN', `Could not remove ${path.relative(ROOT_DIR, dir)}: ${e.code || e.message}`, source.name, 'TERRAFORM'); }
      const parent = path.dirname(dir);
      try { if (!fs.readdirSync(parent).length) fs.rmdirSync(parent); } catch (_) {}
    }, 500);
    res.json({ ok: true, jobId: job.id, ws });
  } catch (e) { sendError(res, e); }
});

// ── Kørsler ──────────────────────────────────────────────────────────────────
router.get('/api/terraform/job/:id', (req, res) => {
  const job = CLI.jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job' });
  res.json(CLI.jobView(job, Number(req.query.from) || 0));
});

router.post('/api/terraform/job/:id/cancel', (req, res) => {
  const job = CLI.jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job' });
  // Et apply afbrydes ikke midt i: org'en og state kunne komme ud af trit
  if (job.kind === 'apply') return res.status(400).json({ error: 'An apply cannot be stopped halfway' });
  job.controller.abort();
  res.json({ ok: true });
});

// ── Arbejdsmapperne ──────────────────────────────────────────────────────────
router.get('/api/terraform/workspaces', (req, res) => {
  res.json(listWorkspaces());
});

router.get('/api/terraform/workspace', (req, res) => {
  try { res.json(wsSummary(wsDir(req.query.ws))); } catch (e) { sendError(res, e); }
});

// ── Flow-tjek efter eksporten ────────────────────────────────────────────────
// Eksportøren siger ikke, hvilke flows den springer over. Her sammenholdes
// org'ens flowliste med de flows, der kom med (id'et står i YAML-filens navn
// og i genesyscloud_flow's filepath), og hvert manglende flow får det, vi kan
// se om det: Genesys' eget standardflow, aldrig publiceret, låst af en bruger,
// eller udeladt af et filter på eksporten.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

function exportedFlowIds(dir) {
  const ids = new Set();
  try { for (const n of fs.readdirSync(path.join(dir, TERRAFORM.FLOW_DIR))) for (const m of n.match(UUID_RE) || []) ids.add(m.toLowerCase()); } catch (_) {}
  for (const f of tfFiles(dir)) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f.path), 'utf8'); } catch (_) { continue; }
    if (!text.includes('genesyscloud_flow"')) continue;
    for (const m of text.matchAll(/filepath\s*=\s*"([^"]*)"/g)) for (const id of m[1].match(UUID_RE) || []) ids.add(id.toLowerCase());
  }
  return ids;
}

// flows: org'ens flowliste (id, name, type, system, publishedVersion, lockedUser, lockedClient)
// filter: { include, exclude } fra eksporten
function compareFlows(flows, exported, filter = {}) {
  const inc = (filter.include || []).map(String), exc = (filter.exclude || []).map(String);
  const flowFilter = inc.filter(x => x.startsWith('genesyscloud_flow::'));
  const typeOff = (inc.length && !inc.some(x => x === 'genesyscloud_flow' || x.startsWith('genesyscloud_flow::'))) || exc.includes('genesyscloud_flow');
  const missing = [];
  let found = 0;
  for (const f of flows || []) {
    if (exported.has(String(f.id || '').toLowerCase())) { found++; continue; }
    const reason = typeOff ? 'filter'
      : f.system ? 'system'
      : !f.publishedVersion ? 'unpublished'
      : (f.lockedUser || f.lockedClient) ? 'locked'
      : flowFilter.length ? 'filter'
      : 'unknown';
    missing.push({ id: f.id, name: f.name, type: f.type, reason });
  }
  const order = ['unknown', 'locked', 'unpublished', 'filter', 'system'];
  missing.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || String(a.name).localeCompare(String(b.name)));
  return { total: (flows || []).length, exported: found, missing, flowsOff: typeOff };
}

async function orgFlowList(env) {
  if (isDemo(env)) {
    const { demoFlowsFor } = require('../lib/demo');
    return demoFlowsFor(env).map(f => ({ id: f.id || f.name, name: f.name, type: f.type, publishedVersion: f.published ? { name: f.published } : null }));
  }
  const { token, apiBase } = await getToken(env);
  const out = [];
  for (let page = 1; ; page++) {
    const r = await axios.get(`${apiBase}/api/v2/flows`, { headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 100, pageNumber: page } });
    const e = r.data.entities || [];
    out.push(...e.map(f => ({ id: f.id, name: f.name, type: f.type, system: !!f.system, publishedVersion: f.publishedVersion || null,
      lockedUser: f.lockedUser ? (f.lockedUser.name || f.lockedUser.id) : null, lockedClient: f.lockedClient ? (f.lockedClient.name || f.lockedClient.id) : null })));
    if (e.length < 100 || page >= (r.data.pageCount || page)) break;
  }
  return out;
}

async function checkFlows(dir) {
  const meta = readMeta(dir);
  const env = loadCustomers().find(c => c.id === meta.sourceId);
  if (!env) throw httpError(400, 'The org the folder was exported from is no longer in Archy GUI');
  const result = { at: new Date().toISOString(), envId: env.id, envName: env.name,
    ...compareFlows(await orgFlowList(env), exportedFlowIds(dir), { include: meta.include, exclude: meta.exclude }) };
  writeMeta(dir, { ...readMeta(dir), flowCheck: result });
  return result;
}

router.post('/api/terraform/workspace/flowcheck', async (req, res) => {
  try {
    const dir = wsDir(req.body.ws);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Folder not found' });
    const meta = readMeta(dir);
    if (meta.kind === 'generator') return res.status(400).json({ error: 'The quick setup copies the local YAML files — there is no export to check' });
    const r = await checkFlows(dir);
    addLog(r.missing.length ? 'WARN' : 'INFO', `Flow check of ${wsId(dir)}: ${r.exported} of ${r.total} flows in ${r.envName} were exported` +
      (r.missing.length ? `; missing: ${r.missing.slice(0, 10).map(m => `${m.name} (${m.reason})`).join(', ')}${r.missing.length > 10 ? ' …' : ''}` : ''), r.envName, 'TERRAFORM');
    res.json({ ok: true, flowCheck: r });
  } catch (e) { sendError(res, e); }
});

// ── Kundepakken ──────────────────────────────────────────────────────────────
// Login-skabelon, kør-scripts, .gitignore og README-afsnittet, så kunden kan
// køre mappen på sin egen pc med sin egen OAuth-klient. Skrives igen ved hver
// eksport, kopi og zip, så regionen følger mappens org. login.ps1/login.sh røres aldrig.
function writeKit(dir, env, lang) {
  const region = env ? TERRAFORM.awsRegion(env.region) : null;
  for (const [name, text] of Object.entries(KIT.kitFiles({ region }))) fs.writeFileSync(path.join(dir, name), text, 'utf8');
  // Uden required_providers leder terraform init efter hashicorp/genesyscloud, som ikke findes
  const tfs = fs.readdirSync(dir).filter(n => n.endsWith('.tf'));
  if (!tfs.some(n => KIT.declaresProvider(fs.readFileSync(path.join(dir, n), 'utf8')))) fs.writeFileSync(path.join(dir, 'versions.tf'), KIT.VERSIONS_TF, 'utf8');
  const f = path.join(dir, 'README.md');
  const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  fs.writeFileSync(f, KIT.withKitReadme(old, lang, { region, hasState: fs.existsSync(path.join(dir, 'terraform.tfstate')) }), 'utf8');
}

function zipEntries(dir, top) {
  const out = [];
  const walk = (d, pre) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = pre + e.name;
      if (e.isSymbolicLink() || KIT.ZIP_SKIP.test(rel)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full, rel + '/'); continue; }
      if (!e.isFile()) continue;
      out.push({ name: top + '/' + rel, data: fs.readFileSync(full), mtime: fs.statSync(full).mtime });
    }
  };
  walk(dir, '');
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Mappen som zip til kunden — med kundepakken, uden Archy GUI's egne filer og uden login
router.get('/api/terraform/workspace/zip', (req, res) => {
  try {
    const dir = wsDir(req.query.ws);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Folder not found' });
    const meta = readMeta(dir);
    writeKit(dir, boundEnv(meta), meta.lang || 'en');
    const top = part(wsId(dir).replace('/', '_')) || 'terraform';
    const buf = KIT.zip(zipEntries(dir, top));
    addLog('INFO', `Terraform folder ${wsId(dir)} downloaded as zip for the customer (${Math.round(buf.length / 1024)} KB)`, meta.targetName || meta.sourceName || null, 'TERRAFORM');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${top}.zip"`);
    res.send(buf);
  } catch (e) { sendError(res, e); }
});

// Kopi til en anden org: filerne uden state, plan og provider-mappe.
router.post('/api/terraform/workspace/copy', (req, res) => {
  try {
    const from = wsDir(req.body.ws);
    const meta = readMeta(from);
    const all = loadCustomers();
    const target = all.find(c => c.id === req.body.targetId);
    if (!target) return res.status(404).json({ error: 'Choose the org the copy is for' });
    const source = all.find(c => c.id === meta.sourceId) || { name: meta.sourceName || 'kilde' };
    const dir = newWsDir(source, target);
    for (const f of listFiles(from)) {
      if (f.path === 'README.md' || f.path.endsWith('.terraform.lock.hcl')) continue;
      fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
      fs.copyFileSync(path.join(from, f.path), path.join(dir, f.path));
    }
    if (fs.existsSync(path.join(from, 'README.md'))) fs.copyFileSync(path.join(from, 'README.md'), path.join(dir, 'README.md'));
    writeKit(dir, target, meta.lang);
    writeMeta(dir, { ...meta, kind: 'copy', created: new Date().toISOString(), targetId: target.id, targetName: target.name,
      includeState: false, copiedFrom: wsId(from), lastApply: null, touched: [] });
    addLog('INFO', `Terraform folder ${wsId(from)} copied for ${target.name}: ${wsId(dir)}`, target.name, 'TERRAFORM');
    res.json({ ok: true, ws: wsId(dir) });
  } catch (e) { sendError(res, e); }
});

// Ubrugte data-opslag i en mappe fra før v1.82.5 (eller efter egne rettelser)
router.post('/api/terraform/workspace/prune', (req, res) => {
  try {
    const dir = wsDir(req.body.ws);
    const removed = pruneUnusedData(dir);
    if (removed) addLog('INFO', `Terraform folder ${wsId(dir)}: removed ${removed} unused data lookups (kept in ${PRUNED_FILE})`, null, 'TERRAFORM');
    res.json({ ok: true, removed });
  } catch (e) { sendError(res, e); }
});

router.post('/api/terraform/workspace/delete', (req, res) => {
  try {
    const dir = wsDir(req.body.ws);
    if (fs.existsSync(path.join(dir, 'terraform.tfstate')) && req.body.confirmState !== true)
      return res.status(409).json({ error: 'The folder has a terraform.tfstate — the objects in the org are not deleted, but Terraform forgets that it manages them', needsConfirm: true });
    fs.rmSync(dir, { recursive: true, force: true });
    const parent = path.dirname(dir);
    try { if (!fs.readdirSync(parent).length) fs.rmdirSync(parent); } catch (_) {}
    addLog('INFO', `Terraform folder deleted: ${req.body.ws}`, null, 'TERRAFORM');
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// ── Filer ────────────────────────────────────────────────────────────────────
router.get('/api/terraform/files', (req, res) => {
  try { res.json(listFiles(wsDir(req.query.ws))); } catch (e) { sendError(res, e); }
});

router.get('/api/terraform/file', (req, res) => {
  try {
    const { f, r } = wsFile(wsDir(req.query.ws), req.query.path);
    if (!fs.existsSync(f)) return res.status(404).json({ error: `${r} does not exist` });
    if (fs.statSync(f).size > 5 * 1024 * 1024) return res.status(413).json({ error: `${r} is too large to edit here` });
    res.json({ path: r, content: fs.readFileSync(f, 'utf8') });
  } catch (e) { sendError(res, e); }
});

router.post('/api/terraform/file', (req, res) => {
  try {
    const dir = wsDir(req.body.ws);
    const { f, r } = wsFile(dir, req.body.path, { write: true });
    if (req.body.create && fs.existsSync(f)) return res.status(409).json({ error: `${r} already exists` });
    if (typeof req.body.content !== 'string') return res.status(400).json({ error: 'Missing content' });
    const before = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, req.body.content, 'utf8');
    if (/\.tf$/i.test(r)) touch(dir, HCL.changedResources(before, req.body.content));
    res.json({ ok: true, path: r });
  } catch (e) { sendError(res, e); }
});

router.post('/api/terraform/file/delete', (req, res) => {
  try {
    const dir = wsDir(req.body.ws);
    const { f, r } = wsFile(dir, req.body.path, { write: true });
    if (!fs.existsSync(f)) return res.status(404).json({ error: `${r} does not exist` });
    const before = /\.tf$/i.test(r) ? fs.readFileSync(f, 'utf8') : '';
    fs.unlinkSync(f);
    touch(dir, HCL.changedResources(before, ''));
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// ── Ressourcer ───────────────────────────────────────────────────────────────
router.get('/api/terraform/resources', (req, res) => {
  try {
    const dir = wsDir(req.query.ws);
    const out = [];
    for (const f of tfFiles(dir)) {
      let text;
      try { text = fs.readFileSync(path.join(dir, f.path), 'utf8'); } catch (_) { continue; }
      for (const r of HCL.resources(text)) {
        const nameEntry = r.entries.find(e => e.key === 'name' && e.literal);
        out.push({ file: f.path, type: r.type, name: r.name, label: nameEntry ? String(nameEntry.literal.value) : null });
      }
    }
    res.json(out);
  } catch (e) { sendError(res, e); }
});

router.get('/api/terraform/resource', (req, res) => {
  try {
    const { f } = wsFile(wsDir(req.query.ws), req.query.file);
    const r = HCL.resources(fs.readFileSync(f, 'utf8')).find(x => x.type === req.query.type && x.name === req.query.name);
    if (!r) return res.status(404).json({ error: 'The resource is no longer in the file' });
    res.json({ file: req.query.file, ...r });
  } catch (e) { sendError(res, e); }
});

// op: create | update | delete. Kun den ene ressource i filen ændres.
router.post('/api/terraform/resource', (req, res) => {
  try {
    const dir = wsDir(req.body.ws);
    const { type, name, op } = req.body;
    let file = req.body.file;
    if (op === 'create' && !file) {
      // I filen der allerede har ressourcer af typen — ellers <type>.tf
      const hit = tfFiles(dir).find(x => {
        try { return HCL.resources(fs.readFileSync(path.join(dir, x.path), 'utf8')).some(r => r.type === type); } catch (_) { return false; }
      });
      file = hit ? hit.path : `${type}.tf`;
    }
    const { f, r } = wsFile(dir, file, { write: true });
    if (!/\.tf$/i.test(r)) return res.status(400).json({ error: 'Resources live in .tf files' });
    const before = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    let after;
    if (op === 'create') {
      const attrs = Object.entries(req.body.set || {});
      after = HCL.addResource(before, type, name, attrs, req.body.add || []);
    } else if (op === 'update') {
      after = HCL.editResource(before, type, name, { set: req.body.set || {}, remove: req.body.remove || [], add: req.body.add || [] });
    } else if (op === 'delete') {
      after = HCL.removeResource(before, type, name);
    } else return res.status(400).json({ error: 'Unknown operation' });
    fs.writeFileSync(f, after, 'utf8');
    touch(dir, [`${type}.${name}`]);
    res.json({ ok: true, file: r });
  } catch (e) { e.status = e.status || 400; sendError(res, e); }
});

// ── Opgaver ──────────────────────────────────────────────────────────────────
// Flere ressourcer af samme type på én gang, fx 5 køer. Med en skabelon
// kopieres alt undtagen navn og medlemmer. → { addresses, file }
router.post('/api/terraform/task/create', async (req, res) => {
  try {
    const dir = wsDir(req.body.ws);
    const type = String(req.body.type || '');
    if (!/^genesyscloud_[a-z0-9_]+$/.test(type)) return res.status(400).json({ error: `Invalid resource type: ${type}` });
    const names = [...new Set((Array.isArray(req.body.names) ? req.body.names : []).map(n => String(n).trim()).filter(Boolean))];
    if (!names.length) return res.status(400).json({ error: 'Enter at least one name' });
    if (names.length > 50) return res.status(400).json({ error: 'At most 50 at a time' });
    const tooLong = names.find(n => n.length > 200);
    if (tooLong) return res.status(400).json({ error: `Name too long: ${tooLong.slice(0, 40)}…` });

    // Hvad findes i forvejen: lokale navne og visningsnavne af typen
    const texts = {};
    for (const x of tfFiles(dir)) { try { texts[x.path] = fs.readFileSync(path.join(dir, x.path), 'utf8'); } catch (_) {} }
    const taken = new Set(), labels = new Map();
    let typeFile = null;
    for (const [file, text] of Object.entries(texts)) {
      for (const r of HCL.resources(text)) {
        if (r.type !== type) continue;
        taken.add(r.name);
        typeFile = typeFile || file;
        const n = r.entries.find(e => e.key === 'name' && e.literal);
        if (n) labels.set(String(n.literal.value).toLowerCase(), r.name);
      }
    }
    const dup = names.filter(n => labels.has(n.toLowerCase()));
    if (dup.length) return res.status(409).json({ error: `Already in the folder: ${dup.join(', ')}` });

    const from = req.body.from && req.body.from.name ? req.body.from : null;
    let file, template = null;
    if (from) {
      file = String(from.file || '');
      if (!(file in texts)) return res.status(404).json({ error: 'The template is no longer in the folder' });
      template = texts[file];
    } else {
      // Uden skabelon skal typen kunne nøjes med et navn
      try {
        const sch = (await providerSchema()).types[type];
        if (!sch) return res.status(400).json({ error: `Unknown resource type: ${type}` });
        const req2 = Object.entries(sch.attrs).filter(([k, a]) => a.required && k !== 'name').map(([k]) => k);
        const reqB = Object.entries(sch.blocks).filter(([, b]) => b.min > 0).map(([k]) => k);
        if (req2.length || reqB.length) return res.status(400).json({ error: `${type} also needs ${[...req2, ...reqB].join(', ')} — choose an existing one to copy settings from` });
      } catch (_) { /* uden schema: validate fanger det */ }
      file = typeFile || `${type}.tf`;
    }
    const { f, r: rel } = wsFile(dir, file, { write: true });
    const blocks = [], addresses = [];
    for (const label of names) {
      const local = HCL.localName(label, taken);
      blocks.push(template ? HCL.cloneResource(template, type, from.name, local, label)
        : HCL.newResourceText(type, local, [['name', { string: label }]]));
      addresses.push(`${type}.${local}`);
    }
    const before = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    fs.writeFileSync(f, (before.trim() ? before.replace(/\s*$/, '') + '\n\n' : '') + blocks.join('\n'), 'utf8');
    touch(dir, addresses);
    res.json({ ok: true, file: rel, addresses });
  } catch (e) { e.status = e.status || 400; sendError(res, e); }
});

// ── Init, validate, fmt og plan ──────────────────────────────────────────────
// envId skal være mappens egen org. Brugerfladen sender den med, så den org
// brugeren ser, også er den der køres mod — og prod-vagten kan læse den.
function checkBound(dir, envId) {
  const meta = readMeta(dir);
  const env = boundEnv(meta);
  if (!env) throw httpError(404, 'The org this folder belongs to no longer exists in Archy GUI');
  if (envId !== env.id) throw httpError(409, `This folder belongs to ${env.name} — Terraform only runs against that org`);
  return { meta, env };
}

router.post('/api/terraform/run', async (req, res) => {
  try {
    const dir = wsDir(req.body.ws);
    const action = String(req.body.action || '');
    if (!['init', 'validate', 'fmt', 'plan'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
    // Plan kun for de ressourcer man har rørt (-target). En fuld eksport giver
    // ikke en mappe uden afvigelser: Falck US' første plan ville ændre 245
    // objekter, bl.a. secrets eksportøren kun kender som pladsholdere.
    const targets = (Array.isArray(req.body.targets) ? req.body.targets : []).map(t => String(t).trim()).filter(Boolean);
    const bad = targets.filter(t => !HCL.TARGET_RE.test(t));
    if (bad.length) return res.status(400).json({ error: `Not a resource address: ${bad.join(', ')} — use type.name, e.g. genesyscloud_group.testtest` });
    if (targets.length > 50) return res.status(400).json({ error: 'At most 50 resources in a targeted plan' });
    const exe = needTerraform();
    let env = CLI.terraformEnv();
    let bound = null;
    if (action === 'plan') {
      bound = checkBound(dir, req.body.envId).env;
      env = CLI.terraformEnv(await envLogin(bound));
    }
    const job = CLI.startJob(wsId(dir), action, async (job, log) => {
      const needInit = !fs.existsSync(path.join(dir, '.terraform'));
      if (action === 'init' || ((action === 'validate' || action === 'plan') && needInit))
        await tfStep(exe, ['init', '-input=false', '-no-color'], dir, env, log, job);
      if (action === 'init') return { action };
      if (action === 'fmt') { await tfStep(exe, ['fmt', '-no-color'], dir, env, log, job); return { action }; }
      if (action === 'validate') { await tfStep(exe, ['validate', '-no-color'], dir, env, log, job); return { action, valid: true }; }
      for (const f of [PLAN_FILE, PLAN_META]) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
      const stripped = stripStateData(dir);
      if (stripped) log(`Removed ${stripped} data lookups from terraform.tfstate (they are read again on every plan; the old state is in terraform.tfstate.backup)`);
      await tfStep(exe, ['plan', '-input=false', '-no-color', `-out=${PLAN_FILE}`, ...targets.map(t => `-target=${t}`)], dir, env, log, job);
      const show = await CLI.captureTerraform(exe, ['show', '-json', PLAN_FILE], { cwd: dir, env });
      if (show.code !== 0) throw new Error('terraform show failed: ' + show.err.trim().split('\n').slice(-3).join(' '));
      const summary = { ...HCL.summarizePlan(show.out), targets };
      // Ændringer af hemmeligheder: eksportøren kender dem ikke og skriver pladsholdere
      summary.secrets = summary.items.filter(i => HCL.SECRET_TYPES.includes(i.type) && i.action !== 'create').map(i => i.address);
      const planHash = CLI.fileHash(path.join(dir, PLAN_FILE));
      fs.writeFileSync(path.join(dir, PLAN_META), JSON.stringify({ created: new Date().toISOString(), envId: bound.id, hash: planHash, summary }));
      addLog('INFO', `Terraform plan for ${bound.name} (${wsId(dir)})${targets.length ? ' limited to ' + targets.join(', ') : ''}: +${summary.create} ~${summary.update} -${summary.delete} ±${summary.replace}`, bound.name, 'TERRAFORM');
      return { action, summary, planHash, envId: bound.id };
    });
    res.json({ ok: true, jobId: job.id });
  } catch (e) { sendError(res, e); }
});

// ── Apply ────────────────────────────────────────────────────────────────────
// Kun den plan brugeren har set: hashen fra plan skal passe med filen. Står
// i PROD_WRITE_ROUTES, så prod kræver et gyldigt personligt prod-login.
router.post('/api/terraform/apply', async (req, res) => {
  try {
    const dir = wsDir(req.body.ws);
    const { env: bound, meta } = checkBound(dir, req.body.targetId);
    const planFile = path.join(dir, PLAN_FILE);
    let pm = null;
    try { pm = JSON.parse(fs.readFileSync(path.join(dir, PLAN_META), 'utf8')); } catch (_) {}
    if (!pm || !fs.existsSync(planFile)) return res.status(409).json({ error: 'Run Plan first — apply only carries out a plan you have seen' });
    if (pm.envId !== bound.id || pm.hash !== req.body.planHash || CLI.fileHash(planFile) !== pm.hash)
      return res.status(409).json({ error: 'The plan has changed since you saw it — run Plan again' });
    // En plan der ændrer hemmeligheder, kræver et udtrykkeligt ja
    if ((pm.summary.secrets || []).length && req.body.confirmSecrets !== true)
      return res.status(409).json({ error: `The plan changes secrets the exporter only knows as placeholders: ${pm.summary.secrets.slice(0, 5).join(', ')}${pm.summary.secrets.length > 5 ? ' …' : ''}`,
        hint: 'secrets', secrets: pm.summary.secrets });
    const exe = needTerraform();
    const env = CLI.terraformEnv(await envLogin(bound));
    const s = pm.summary;
    const job = CLI.startJob(wsId(dir), 'apply', async (job, log) => {
      try {
        await tfStep(exe, ['apply', '-input=false', '-no-color', PLAN_FILE], dir, env, log, job, { stoppable: false });
      } finally {
        try { fs.unlinkSync(planFile); fs.unlinkSync(path.join(dir, PLAN_META)); } catch (_) {}
      }
      // Det der nu er anvendt, venter ikke længere — en plan uden mål dækkede alt
      const now = readMeta(dir);
      const done = s.targets || [];
      const touched = done.length ? (now.touched || []).filter(a => !done.includes(a)) : [];
      writeMeta(dir, { ...now, touched, lastApply: { at: new Date().toISOString(), envId: bound.id, summary: { create: s.create, update: s.update, delete: s.delete, replace: s.replace } } });
      addLog('SUCCESS', `Terraform apply to ${bound.name} (${wsId(dir)}): +${s.create} ~${s.update} -${s.delete} ±${s.replace}`, bound.name, 'TERRAFORM');
      return { action: 'apply', summary: s };
    });
    const watch = setInterval(() => {
      if (job.status === 'running') return;
      clearInterval(watch);
      if (job.status === 'failed') addLog('ERROR', `Terraform apply to ${bound.name} (${wsId(dir)}) failed: ${job.error.split('\n')[0]}`, bound.name, 'TERRAFORM');
    }, 1000);
    res.json({ ok: true, jobId: job.id });
  } catch (e) { sendError(res, e); }
});

module.exports = { router, _test: { wsFile, wsDir, exportReadme, pruneUnusedData, stripStateData, writeKit, zipEntries, compareFlows, exportedFlowIds } };
