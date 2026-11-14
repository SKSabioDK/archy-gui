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
  const { token } = await getToken(env);
  const region = TERRAFORM.awsRegion(env.region);
  if (!region) throw httpError(400, `Unknown region for "${env.name}": ${env.region}`);
  return { token, region };
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
    throw Object.assign(new Error(`terraform ${args[0]} failed (exit ${r.code})${tail ? ':\n' + tail : ''}`), { hint: HCL.errorHint(r.out) });
  }
  return r;
}

// ── terraform.exe ────────────────────────────────────────────────────────────
router.get('/api/terraform/cli', async (req, res) => {
  const exe = CLI.findTerraform();
  res.json({ found: !!exe, path: exe, version: exe ? await CLI.terraformVersion(exe) : null });
});

router.post('/api/terraform/cli', async (req, res) => {
  const p = String(req.body.path || '').trim().replace(/^"|"$/g, '');
  if (p && !(fs.existsSync(p) && fs.statSync(p).isFile() && /terraform(\.exe)?$/i.test(p)))
    return res.status(400).json({ error: `Not a terraform executable: ${p}` });
  saveSettings({ terraformPath: p || null });
  const exe = CLI.findTerraform();
  res.json({ found: !!exe, path: exe, version: exe ? await CLI.terraformVersion(exe) : null });
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

## Sådan kører du den selv

1. Installér Terraform (https://developer.hashicorp.com/terraform/install).
2. Giv provideren et login til den org, der skal ændres — enten et token eller en OAuth-klient (client credentials):
   - \`GENESYSCLOUD_ACCESS_TOKEN\` og \`GENESYSCLOUD_REGION\` (fx \`eu-central-1\`), eller
   - \`GENESYSCLOUD_OAUTHCLIENT_ID\`, \`GENESYSCLOUD_OAUTHCLIENT_SECRET\` og \`GENESYSCLOUD_REGION\`.
3. \`terraform init\`, derefter \`terraform plan -out=plan\` og læs planen, så \`terraform apply plan\`.

Hemmeligheder (fx klient-secrets og adgangskoder til integrationer) eksporteres ikke; eksportøren skriver variabler til dem i \`terraform.tfvars\`.
`,
  en: (src, tgt, state) => `# Terraform — ${src}${tgt ? ' → ' + tgt : ''}

Full export made with Genesys' own exporter (\`genesyscloud_tf_export\`) from Archy GUI.
The files are plain Terraform and work without Archy GUI.

${state
    ? `**Same org:** \`terraform.tfstate\` came with the export, so Terraform already manages the objects in ${src}. \`terraform plan\` should show 0 changes until the files are edited.`
    : `**To another org:** there is no state, so \`terraform apply\` creates the objects in ${tgt || 'the target org'}. Try it in a test org first.`}

## Running it yourself

1. Install Terraform (https://developer.hashicorp.com/terraform/install).
2. Give the provider a login for the org that should change — a token or an OAuth client (client credentials):
   - \`GENESYSCLOUD_ACCESS_TOKEN\` and \`GENESYSCLOUD_REGION\` (e.g. \`eu-central-1\`), or
   - \`GENESYSCLOUD_OAUTHCLIENT_ID\`, \`GENESYSCLOUD_OAUTHCLIENT_SECRET\` and \`GENESYSCLOUD_REGION\`.
3. \`terraform init\`, then \`terraform plan -out=plan\` and read the plan, then \`terraform apply plan\`.

Secrets (e.g. client secrets and integration passwords) are not exported; the exporter writes variables for them in \`terraform.tfvars\`.
`,
};
const exportReadme = (lang, src, tgt, state) => (README_TEXT[lang] || README_TEXT.en)(src, tgt, state);

const TYPE_RE = /^genesyscloud_[a-z0-9_]+(::.+)?$/;

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
    const { token, region } = await envLogin(source);
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
        await tfStep(exe, ['apply', '-auto-approve', '-input=false', '-no-color'], work, env, log, job, { exportRun: true });
        job.phase = 'save';
        const out = path.join(work, 'out');
        if (!fs.existsSync(out)) throw new Error('The exporter wrote no files');
        for (const name of fs.readdirSync(out)) fs.renameSync(path.join(out, name), path.join(dir, name));
      } finally {
        try { CLI.removeDir(work); } catch (e) { log(`Could not remove ${work}: ${e.code || e.message}`); }
      }
      if (!fs.existsSync(path.join(dir, 'README.md'))) fs.writeFileSync(path.join(dir, 'README.md'), exportReadme(lang, source.name, target && target.name, includeState));
      writeMeta(dir, { kind: 'export', created: new Date().toISOString(), sourceId: source.id, sourceName: source.name,
        targetId: target ? target.id : null, targetName: target ? target.name : null, includeState, lang, include, exclude,
        skipped: job.skipped });
      // Med state skal mappen kunne planlægges med det samme
      if (includeState) {
        job.phase = 'init_ws';
        try { await tfStep(exe, ['init', '-input=false', '-no-color'], dir, env, log, job, { exportRun: true }); }
        catch (e) { if (e.message === 'Stopped') throw e; log('terraform init in the folder failed — run Init under Plan & apply'); }
      }
      job.phase = 'done';
      const s = wsSummary(dir);
      addLog('SUCCESS', `Terraform full export of ${source.name}${target ? ' (for ' + target.name + ')' : ''}: ${s.resources} resources in ${path.relative(ROOT_DIR, dir)}` +
        (job.skipped.length ? `; skipped for missing permissions: ${job.skipped.map(x => x.perm).join(', ')}` : ''), source.name, 'TERRAFORM');
      return { ws, resources: s.resources, files: s.files, skipped: job.skipped };
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
    writeMeta(dir, { ...meta, kind: 'copy', created: new Date().toISOString(), targetId: target.id, targetName: target.name,
      includeState: false, copiedFrom: wsId(from), lastApply: null });
    addLog('INFO', `Terraform folder ${wsId(from)} copied for ${target.name}: ${wsId(dir)}`, target.name, 'TERRAFORM');
    res.json({ ok: true, ws: wsId(dir) });
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
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, req.body.content, 'utf8');
    res.json({ ok: true, path: r });
  } catch (e) { sendError(res, e); }
});

router.post('/api/terraform/file/delete', (req, res) => {
  try {
    const { f, r } = wsFile(wsDir(req.body.ws), req.body.path, { write: true });
    if (!fs.existsSync(f)) return res.status(404).json({ error: `${r} does not exist` });
    fs.unlinkSync(f);
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
    res.json({ ok: true, file: r });
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
      try { fs.unlinkSync(path.join(dir, PLAN_FILE)); fs.unlinkSync(path.join(dir, PLAN_META)); } catch (_) {}
      await tfStep(exe, ['plan', '-input=false', '-no-color', `-out=${PLAN_FILE}`], dir, env, log, job);
      const show = await CLI.captureTerraform(exe, ['show', '-json', PLAN_FILE], { cwd: dir, env });
      if (show.code !== 0) throw new Error('terraform show failed: ' + show.err.trim().split('\n').slice(-3).join(' '));
      const summary = HCL.summarizePlan(show.out);
      const planHash = CLI.fileHash(path.join(dir, PLAN_FILE));
      fs.writeFileSync(path.join(dir, PLAN_META), JSON.stringify({ created: new Date().toISOString(), envId: bound.id, hash: planHash, summary }));
      addLog('INFO', `Terraform plan for ${bound.name} (${wsId(dir)}): +${summary.create} ~${summary.update} -${summary.delete} ±${summary.replace}`, bound.name, 'TERRAFORM');
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
    const exe = needTerraform();
    const env = CLI.terraformEnv(await envLogin(bound));
    const s = pm.summary;
    const job = CLI.startJob(wsId(dir), 'apply', async (job, log) => {
      try {
        await tfStep(exe, ['apply', '-input=false', '-no-color', PLAN_FILE], dir, env, log, job, { stoppable: false });
      } finally {
        try { fs.unlinkSync(planFile); fs.unlinkSync(path.join(dir, PLAN_META)); } catch (_) {}
      }
      writeMeta(dir, { ...meta, lastApply: { at: new Date().toISOString(), envId: bound.id, summary: { create: s.create, update: s.update, delete: s.delete, replace: s.replace } } });
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

module.exports = { router, _test: { wsFile, wsDir, exportReadme } };
