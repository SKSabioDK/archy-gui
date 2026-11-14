// terraform.exe: find den, kør den i en arbejdsmappe og hold styr på kørslerne.
//
// Archy GUI giver terraform sit eget login gennem miljøvariablen
// GENESYSCLOUD_ACCESS_TOKEN — det samme token som resten af programmet bruger,
// også et personligt PKCE-login til prod. Der skrives aldrig en secret i
// mappen, så kunden kan tage den over med sit eget login.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { DATA_DIR, loadSettings } = require('../config');

const TERRAFORM_DIR = path.join(DATA_DIR, 'terraform');
const PLUGIN_CACHE = path.join(TERRAFORM_DIR, '.plugin-cache');
const PROVIDER_DIR = path.join(TERRAFORM_DIR, '.provider');

// ── Find terraform.exe ───────────────────────────────────────────────────────
const EXE = process.platform === 'win32' ? 'terraform.exe' : 'terraform';

function candidates() {
  const out = [];
  const s = loadSettings().terraformPath;
  if (s) out.push(s);
  for (const d of String(process.env.PATH || '').split(path.delimiter)) if (d) out.push(path.join(d.replace(/^"|"$/g, ''), EXE));
  if (process.platform === 'win32') out.push('C:\\Tools\\Terraform\\terraform.exe', 'C:\\Program Files\\Terraform\\terraform.exe');
  return out;
}

function findTerraform() {
  for (const c of candidates()) {
    try { if (fs.statSync(c).isFile()) return c; } catch (_) {}
  }
  return null;
}

let _versionCache = null;
function terraformVersion(exe) {
  if (_versionCache && _versionCache.exe === exe) return Promise.resolve(_versionCache.v);
  return new Promise(resolve => {
    execFile(exe, ['version', '-json'], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      let v = null;
      try { v = JSON.parse(stdout).terraform_version; } catch (_) {}
      if (v) _versionCache = { exe, v };
      resolve(err && !v ? null : v);
    });
  });
}

// ── Kørsel ───────────────────────────────────────────────────────────────────
// Miljøet terraform får: login, region og den fælles cache til provideren
// (~90 MB — hentes én gang, ikke pr. mappe). Klientoplysninger fra Windows'
// eget miljø fjernes, så det altid er Archy GUI's valgte org der svares for.
function terraformEnv({ token, region } = {}) {
  // TF_LOG=ERROR: når provideren ikke vil starte, siger kun loggen hvorfor (fx
  // "x509: certificate signed by unknown authority" fra et antivirusprogram).
  const env = { ...process.env, TF_IN_AUTOMATION: '1', CHECKPOINT_DISABLE: '1', TF_PLUGIN_CACHE_DIR: PLUGIN_CACHE,
    TF_INPUT: '0', TF_LOG: 'ERROR' };
  for (const k of Object.keys(env)) if (/^GENESYSCLOUD_/i.test(k)) delete env[k];
  if (token) env.GENESYSCLOUD_ACCESS_TOKEN = token;
  if (region) env.GENESYSCLOUD_REGION = region;
  return env;
}

// Kører én terraform-kommando. Uddata går til onLine linje for linje; tokenet
// vaskes ud, hvis det skulle stå i en fejl.
function runTerraform(exe, args, { cwd, env, onLine = () => {}, signal } = {}) {
  fs.mkdirSync(PLUGIN_CACHE, { recursive: true });
  return new Promise(resolve => {
    const child = spawn(exe, args, { cwd, env, windowsHide: true });
    const token = env && env.GENESYSCLOUD_ACCESS_TOKEN;
    const clean = t => token ? t.split(token).join('***') : t;
    let out = '';
    const feed = buf => {
      const text = clean(buf.toString('utf8')).replace(/\x1b\[[0-9;]*m/g, '');
      out += text;
      for (const l of text.split(/\r?\n/)) if (l.trim()) onLine(l);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    if (signal) signal.addEventListener('abort', () => { try { child.kill(); } catch (_) {} }, { once: true });
    child.on('error', e => resolve({ code: -1, out: out + '\n' + e.message }));
    child.on('close', code => resolve({ code, out }));
  });
}

// Uddata der skal læses som helhed (show -json, providers schema -json).
function captureTerraform(exe, args, { cwd, env } = {}) {
  return new Promise(resolve => {
    execFile(exe, args, { cwd, env, windowsHide: true, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      const plain = t => String(t || '').replace(/\x1b\[[0-9;]*m/g, '');
      resolve({ code: err ? (err.code || 1) : 0, out: stdout, err: plain(stderr || (err && err.message)) });
    });
  });
}

// ── Kørsler i baggrunden ─────────────────────────────────────────────────────
// En eksport tager minutter. Brugerfladen spørger efter jobbet hvert sekund.
const jobs = new Map();
const busy = new Set();   // arbejdsmapper med en kørsel i gang

function startJob(ws, kind, fn) {
  if (busy.has(ws)) throw new Error('Terraform is already running in this folder — wait for it to finish');
  const id = crypto.randomUUID();
  const job = { id, ws, kind, status: 'running', lines: [], result: null, error: null, hint: null, started: Date.now(),
    controller: new AbortController() };
  jobs.set(id, job);
  busy.add(ws);
  const log = l => { job.lines.push(l); if (job.lines.length > 4000) job.lines.splice(0, job.lines.length - 4000); };
  Promise.resolve().then(() => fn(job, log)).then(
    result => { job.result = result || null; job.status = 'done'; },
    e => { job.error = e.message || String(e); job.hint = e.hint || null; job.status = 'failed'; }
  ).finally(() => {
    busy.delete(ws);
    job.finished = Date.now();
    // Gamle kørsler glemmes efter en time
    for (const [k, j] of jobs) if (j.finished && Date.now() - j.finished > 3600e3) jobs.delete(k);
  });
  return job;
}

function jobView(job, from = 0) {
  return { id: job.id, ws: job.ws, kind: job.kind, status: job.status, lines: job.lines.slice(from), total: job.lines.length,
    result: job.result, error: job.error, hint: job.hint };
}

const fileHash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

module.exports = { TERRAFORM_DIR, PLUGIN_CACHE, PROVIDER_DIR, findTerraform, terraformVersion, terraformEnv,
  runTerraform, captureTerraform, startJob, jobs, jobView, fileHash };
