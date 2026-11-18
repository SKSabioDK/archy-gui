// terraform.exe: find den, kør den i en arbejdsmappe og hold styr på kørslerne.
//
// Archy GUI giver terraform sit eget login gennem miljøvariablen
// GENESYSCLOUD_ACCESS_TOKEN — det samme token som resten af programmet bruger,
// også et personligt PKCE-login til prod. Der skrives aldrig en secret i
// mappen, så kunden kan tage den over med sit eget login.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');
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
  if (process.platform === 'win32') {
    for (const d of ['C:\\Tools\\Terraform', 'C:\\Program Files\\Terraform']) {
      out.push(path.join(d, EXE));
      // Zip-filen pakkes tit ud i sin egen mappe: C:\Tools\Terraform\terraform_1.17.2_windows_amd64\terraform.exe
      try {
        for (const e of fs.readdirSync(d, { withFileTypes: true }))
          if (e.isDirectory() && /^terraform/i.test(e.name)) out.push(path.join(d, e.name, EXE));
      } catch (_) {}
    }
    out.push('C:\\ProgramData\\chocolatey\\bin\\terraform.exe');
  }
  return out;
}

function findTerraform() {
  for (const c of candidates()) {
    try { if (fs.statSync(c).isFile()) return c; } catch (_) {}
  }
  return null;
}

// Er filen et program, der kan køre på denne pc? En zip-fil omdøbt til .exe, en
// halvt hentet fil eller en ARM64-udgave på en almindelig pc gav før kun
// "spawn UNKNOWN". PE-headerens maskintype siger, hvilken processor filen er til.
const MACHINES = { 0x8664: 'amd64', 0x14c: '386', 0xaa64: 'arm64', 0x1c4: 'arm' };
function inspectExe(file, platform = process.platform, arch = process.arch) {
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    try { buf = Buffer.alloc(4096); buf = buf.subarray(0, fs.readSync(fd, buf, 0, 4096, 0)); } finally { fs.closeSync(fd); }
  } catch (e) { return { problem: 'unreadable', error: e.code || e.message }; }
  if (platform !== 'win32') return { problem: null };
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return { problem: 'zip' };
  if (buf.length < 64 || buf[0] !== 0x4d || buf[1] !== 0x5a) return { problem: 'not_exe' };
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 6 > buf.length || buf.readUInt32LE(pe) !== 0x4550) return { problem: 'not_exe' };
  const machine = MACHINES[buf.readUInt16LE(pe + 4)] || 'unknown';
  const host = arch === 'x64' ? 'amd64' : arch === 'ia32' ? '386' : arch;
  // Windows på ARM kører også amd64 og 386; en x64-pc kører 386, men ikke ARM
  const runs = machine === host || machine === '386' || (host === 'arm64' && machine === 'amd64');
  return { problem: runs ? null : 'arch', machine, host };
}

// Kan terraform startes? version når det kan, ellers hvad der er galt
function checkTerraform(exe) {
  const info = inspectExe(exe);
  if (info.problem) return Promise.resolve({ version: null, ...info });
  return new Promise(resolve => {
    execFile(exe, ['version', '-json'], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      let v = null;
      try { v = JSON.parse(stdout).terraform_version; } catch (_) {}
      if (v) { _versionCache = { exe, v }; return resolve({ version: v, problem: null, machine: info.machine }); }
      resolve({ version: null, problem: 'blocked', machine: info.machine, error: err ? String(err.code || err.message) : 'no output' });
    });
  });
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

// ── Stop ─────────────────────────────────────────────────────────────────────
// terraform.exe starter provideren som sin egen proces. Blev kun terraform.exe
// dræbt, kørte provideren videre — eksporten fortsatte mod Genesys, og den
// holdt mappen låst, så oprydningen fejlede med EPERM. Derfor dræbes hele
// træet: på Windows med taskkill /T, ellers hele procesgruppen.
const active = new Set();

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (_) {} }
  }
}

// Lukker serveren, må ingen terraform eller provider blive hængende uden ejer
process.on('exit', () => { for (const c of active) killTree(c); });

// Kører én terraform-kommando. Uddata går til onLine hele linjer ad gangen (en
// linje kan komme i to bidder); tokenet vaskes ud, hvis det skulle stå i en fejl.
function runTerraform(exe, args, { cwd, env, onLine = () => {}, signal } = {}) {
  fs.mkdirSync(PLUGIN_CACHE, { recursive: true });
  return new Promise(resolve => {
    if (signal && signal.aborted) return resolve({ code: -1, out: '', aborted: true });
    const child = spawn(exe, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32' });
    active.add(child);
    const token = env && env.GENESYSCLOUD_ACCESS_TOKEN;
    const clean = t => token ? t.split(token).join('***') : t;
    let out = '';
    const rest = { stdout: '', stderr: '' };
    const feed = which => buf => {
      const text = rest[which] + clean(buf.toString('utf8')).replace(/\x1b\[[0-9;]*m/g, '');
      const lines = text.split(/\r?\n/);
      rest[which] = lines.pop();
      out += text.slice(0, text.length - rest[which].length);
      for (const l of lines) if (l.trim()) onLine(l);
    };
    child.stdout.on('data', feed('stdout'));
    child.stderr.on('data', feed('stderr'));
    let aborted = false;
    const onAbort = () => { aborted = true; killTree(child); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let finished = false;
    const done = code => {
      if (finished) return;
      finished = true;
      active.delete(child);
      if (signal) signal.removeEventListener('abort', onAbort);
      for (const w of ['stdout', 'stderr']) if (rest[w].trim()) { out += rest[w]; onLine(rest[w]); rest[w] = ''; }
      resolve({ code, out, aborted });
    };
    child.on('error', e => { out += '\n' + e.message; done(-1); });
    // 'close' kommer når uddata er læst færdig. Holder en underproces stadig
    // røret åbent, ventes der højst tre sekunder efter 'exit'.
    child.on('close', code => done(code));
    child.on('exit', code => setTimeout(() => done(code), 3000));
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
  // phase: hvad kørslen er i gang med (brugerfladen oversætter koden).
  // elapsed: terraforms "Still creating… [01m10s elapsed]", vist som én linje.
  // skipped: typer eksportøren sprang over, fordi login'et mangler en rettighed.
  const job = { id, ws, kind, status: 'running', lines: [], result: null, error: null, hint: null, started: Date.now(),
    phase: null, elapsed: null, skipped: [], controller: new AbortController() };
  jobs.set(id, job);
  busy.add(ws);
  const log = l => { job.lines.push(l); if (job.lines.length > 4000) job.lines.splice(0, job.lines.length - 4000); };
  Promise.resolve().then(() => fn(job, log)).then(
    result => {
      if (job.controller.signal.aborted) { job.status = 'cancelled'; return; }
      job.result = result || null; job.status = 'done';
    },
    e => {
      if (job.controller.signal.aborted) { job.status = 'cancelled'; job.error = 'Stopped'; return; }
      job.error = e.message || String(e); job.hint = e.hint || null; job.status = 'failed';
    }
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
    result: job.result, error: job.error, hint: job.hint, phase: job.phase, info: job.info || null,
    seconds: Math.round(((job.finished || Date.now()) - job.started) / 1000), elapsed: job.elapsed,
    skipped: job.skipped, retries: job.retries || 0, stopping: job.controller.signal.aborted && job.status === 'running' };
}

// Mappen slettes, også mens Windows endnu ikke har sluppet en fil fra en
// netop dræbt proces (EPERM/EBUSY).
function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

const fileHash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

module.exports = { TERRAFORM_DIR, PLUGIN_CACHE, PROVIDER_DIR, findTerraform, terraformVersion, checkTerraform, inspectExe, terraformEnv,
  runTerraform, captureTerraform, startJob, jobs, jobView, fileHash, killTree, removeDir };
