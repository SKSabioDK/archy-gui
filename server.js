const express = require('express');
const axios = require('axios');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CURRENT_VERSION = require('./package.json').version;

const app = express();

// Standardgrænsen er 100 KB, og et rigtigt Genesys-flow er større end det:
// af de 153 eksporterede YAML-filer her er ni over grænsen, den største på
// 800 KB. Import af dem svarede 413 uden nogen forklaring.
app.use(express.json({ limit: '25mb' }));
// Før alle ruter: skrivning til prod kræver et personligt login med
// rettigheden. Selve vagten står ved OAuth-koden længere nede.
app.use((req, res, next) => prodWriteGate(req, res, next));
app.use(express.static(path.join(__dirname, 'public')));
// Skærmbilleder og infografik som README'en viser — også på README-siden i
// programmet, hvor de ellers ville mangle.
app.use('/docs', express.static(path.join(__dirname, 'docs')));

const CUSTOMERS_FILE = path.join(__dirname, 'customers.json');
const FLOWS_DIR = path.join(__dirname, 'flows');

if (!fs.existsSync(FLOWS_DIR)) fs.mkdirSync(FLOWS_DIR, { recursive: true });

// ── OAuth / PKCE stores ───────────────────────────────────────────────────────

// Login-tokens. Står i hukommelsen; et login der er under SESSION_WINDOW gammelt
// gemmes også i brugerens egen mappe, så en genstart af programmet ikke kræver
// et nyt login med MFA. Hvert login har sin egen frist fra det tidspunkt det
// blev foretaget (loginAt) — den forlænges ikke af at programmet bruges.
const tokenStore = new Proxy({}, {
  set(t, k, v) { t[k] = v; scheduleSessionSave(); return true; },
  deleteProperty(t, k) { const had = k in t; delete t[k]; if (had) scheduleSessionSave(); return true; }
}); // { [customerId]: { token, expiresAt, orgId, orgName, loginAt, deploy? } }

// Hvor længe et login huskes over en genstart. Samme tid som prod-vinduet.
// Sættes til 0 med rememberLoginMinutes i settings.json for ikke at gemme noget.
const SESSION_DIR  = process.env.ARCHY_SESSION_DIR || path.join(os.homedir(), '.archy-gui');
const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
function sessionWindowMs() {
  const m = Number(loadSettings().rememberLoginMinutes);
  return (Number.isFinite(m) && m >= 0 ? m : 30) * 60 * 1000;
}
let _sessionPersist = false;      // slået til når programmet kører som server (ikke i tests)
const setSessionPersist = on => { _sessionPersist = on; };
let _sessionTimer = null;
function scheduleSessionSave() {
  if (!_sessionPersist || _sessionTimer) return;
  _sessionTimer = setTimeout(() => { _sessionTimer = null; saveSessions(); }, 400);
  if (_sessionTimer.unref) _sessionTimer.unref();
}
// Kun friske logins skrives, og kun dem med kendt login-tidspunkt. Er der intet
// at huske, slettes filen — så ligger der ikke gamle tokens.
function saveSessions() {
  if (!_sessionPersist) return;
  try {
    const nu = Date.now(), win = sessionWindowMs(), ud = {};
    for (const [id, st] of Object.entries(tokenStore))
      if (win > 0 && st && st.token && st.loginAt && nu - st.loginAt < win && nu < st.expiresAt) ud[id] = st;
    if (!Object.keys(ud).length) { try { fs.unlinkSync(SESSION_FILE); } catch (_) {} return; }
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(ud), { mode: 0o600 });
  } catch (_) { /* kan ikke skrives — så må man logge ind igen efter en genstart */ }
}
// Ved opstart: hent de logins der stadig er friske, og kun dem der passer til et
// miljø på denne pc (samme org som miljøet). Resten slettes.
function loadSessions(customers) {
  let gemt = {};
  try { gemt = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (_) { return 0; }
  const nu = Date.now(), win = sessionWindowMs();
  let n = 0;
  for (const [id, st] of Object.entries(gemt || {})) {
    const c = customers.find(x => x.id === id);
    if (!c || c.authType !== 'oauth' || !st || !st.token || !st.loginAt || !st.orgId) continue;
    if (win <= 0 || nu - st.loginAt >= win || nu >= st.expiresAt || wrongOrg(c, st.orgId)) continue;
    tokenStore[id] = st; n++;
  }
  return n;
}
const pkceStore  = {}; // { [customerId]: { verifier } }  — temporary during login flow

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

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
    exec('git fetch origin main --quiet', { cwd: __dirname, shell: 'cmd.exe', timeout: 20000 }, (fetchErr) => {
      if (fetchErr) {
        versionInfo = { current: CURRENT_VERSION, latest: null, updateAvailable: false, checkedAt: new Date().toISOString() };
        addLog('WARN', `Version check: git fetch failed — ${fetchErr.message.split('\n')[0]}`, null, 'SYSTEM');
        return resolve(versionInfo);
      }
      // Step 2: read package.json from the remote ref — no disk write.
      exec('git show origin/main:package.json', { cwd: __dirname, shell: 'cmd.exe', timeout: 5000 }, (showErr, stdout) => {
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

app.get('/api/version', (req, res) => res.json(versionInfo));

// Manual trigger — used by the "Check for updates" button in the UI
app.post('/api/version/check', async (req, res) => {
  const result = await checkForUpdate();
  res.json(result);
});

// ── System Log ────────────────────────────────────────────────────────────────

const LOG_MAX = 2000;
const logStore = [];

// ── Maskering af hemmeligheder ────────────────────────────────────────────────
// Archy kaldes med --clientSecret på kommandolinjen, og Node lægger HELE
// kommandoen i err.message når exec fejler ("Command failed: archy …
// --clientSecret \"…\""). Den fejl er tidligere endt både i server.log, i
// systemloggen og i svaret til browseren.
//
// Maskeringen sidder derfor det ene sted alt passerer — addLog — plus på
// fejlvejen i runArchy, så selve Error-objektet også er rent.
let _secretCache = { mtime: 0, secrets: [], ids: [] };
function knownCredentials() {
  try {
    const st = fs.statSync(CUSTOMERS_FILE);
    if (st.mtimeMs !== _secretCache.mtime) {
      const list = loadCustomers();
      _secretCache = {
        mtime: st.mtimeMs,
        secrets: list.map(c => c.clientSecret).filter(x => x && x.length > 6),
        ids:     list.map(c => c.clientId).filter(x => x && x.length > 6)
      };
    }
  } catch (_) { /* ingen kundefil endnu */ }
  return _secretCache;
}

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function redactSecrets(text) {
  if (text == null) return text;
  let s = String(text);

  // Flag på kommandolinjen — uanset om værdien er i anførselstegn
  s = s.replace(/(--clientSecret\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1"***"');
  s = s.replace(/(--authToken\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1"***"');
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-]{10,}/g, '$1***');

  // Kendte værdier fra customers.json — fanger også de steder hvor de dukker
  // op uden et flag foran. Client-id'et forkortes frem for at fjernes helt,
  // så man stadig kan se HVILKEN klient det drejer sig om.
  const { secrets, ids } = knownCredentials();
  for (const sec of secrets) s = s.split(sec).join('***');
  for (const id of ids) s = s.split(id).join(id.slice(0, 8) + '…');

  return s;
}

function addLog(level, message, customer = null, action = 'SYSTEM') {
  const entry = {
    ts: new Date().toISOString(),
    level,          // INFO | SUCCESS | WARN | ERROR
    action,         // SYSTEM | CUSTOMER | TEST | FLOWS | EXPORT | IMPORT | MIGRATE
    customer: customer || null,
    message: redactSecrets(message)
  };
  logStore.push(entry);
  if (logStore.length > LOG_MAX) logStore.shift();
  // Also mirror to console
  console.log(`[${entry.ts}] [${level}] [${action}]${customer ? ' [' + customer + ']' : ''} ${entry.message}`);
}

// Region -> API base URL mapping
const REGION_MAP = {
  'mypurecloud.com':    'https://api.mypurecloud.com',
  'mypurecloud.de':     'https://api.mypurecloud.de',
  'mypurecloud.ie':     'https://api.mypurecloud.ie',
  'mypurecloud.com.au': 'https://api.mypurecloud.com.au',
  'mypurecloud.jp':     'https://api.mypurecloud.jp',
  'usw2.pure.cloud':    'https://api.usw2.pure.cloud',
  'cac1.pure.cloud':    'https://api.cac1.pure.cloud',
  'euw2.pure.cloud':    'https://api.euw2.pure.cloud',
  'apse2.pure.cloud':   'https://api.apse2.pure.cloud',
};

// ── Felter på et miljø ───────────────────────────────────────────────────────
// Navnet bliver til en mappe (flows/<navn>), mappen står på Archys
// kommandolinje gennem cmd.exe, præfikset bliver en del af flownavne og
// manifest-tabellens navn i Genesys, og Client ID og region ender i URL'er.
// En værdi der ikke holder hele vejen, skal afvises når den gemmes — ikke
// opdages midt i en eksport.
//
// "/" er tilladt i navne: "A/S" står i halvdelen af alle danske firmanavne, og
// mappenavnet får "_" i stedet. At to navne så kan give samme mappe, fanges af
// kollisionstjekket nedenfor.

// Ugyldige i Windows-stier (< > : " \ | ? *), udvidet af cmd.exe selv inden
// for anførselstegn (%, !), og tegn der bryder ud af et JS-attribut (' `).
const FORBIDDEN_CHARS = /[<>:"\\|?*%!^`$'\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERMISSION = /^[a-z0-9*\-]+:[a-z0-9*\-]+:[a-z0-9*\-]+$/i;
const FORBIDDEN_LIST = '< > : " \\ | ? * % ! ^ ` $ \'';

// Felterne PUT tager imod. Alt andet — fx "demo": true, som ville få
// prod-vagten til at se bort fra miljøet — ignoreres.
const EDITABLE_FIELDS = ['name', 'tenant', 'group', 'stage', 'prefix', 'orgLabel', 'division',
  'clientId', 'region', 'authType', 'deployPermission', 'deployGroup', 'newClientSecret', 'color'];

// Farven et miljø vises med på tavlen og i sidebjælken. Tomt betyder trinnets
// egen farve (dev grøn, test gul, uat orange, prod rød). Navne, ikke hex-koder,
// så farven følger temaet.
const ENV_COLORS = ['', 'green', 'yellow', 'orange', 'red', 'blue', 'grey'];

function textError(label, v, max) {
  if (v.length > max) return `${label} må højst være ${max} tegn (er ${v.length}).`;
  const bad = v.match(FORBIDDEN_CHARS);
  if (bad) {
    const vis = /[\u0000-\u001f\u007f]/.test(bad[0]) ? 'usynlige kontroltegn' : `tegnet ${bad[0]}`;
    return `${label} må ikke indeholde ${vis}. Disse tegn kan ikke bruges: ${FORBIDDEN_LIST}`;
  }
  return null;
}

// Tjekker de felter der står i `fields` (allerede trimmede). `others` er de
// ANDRE miljøer. Returnerer første fejl som tekst, ellers null.
function envFieldError(fields, others = []) {
  const has = k => fields[k] !== undefined;
  if (has('name')) {
    const n = String(fields.name);
    if (!n) return 'Navnet må ikke være tomt.';
    const e = textError('Navnet', n, 60);
    if (e) return e;
    if (/^\.|\.$/.test(n)) return 'Navnet må ikke begynde eller slutte med et punktum.';
    const mappe = sanitizeName(n);
    if (WINDOWS_RESERVED.test(mappe)) return `"${n}" er et reserveret navn i Windows og kan ikke bruges som mappe.`;
    if (/^import_/i.test(mappe)) return 'Navnet må ikke begynde med "import_" — det er værktøjets egne mapper.';
    // Windows skelner ikke store og små bogstaver, og "A/S" og "A_S" giver
    // samme mappe. To miljøer der deler eksportmappe, blander hinandens flows.
    const hit = others.find(o => sanitizeName(String(o.name || '')).toLowerCase() === mappe.toLowerCase());
    if (hit) return hit.name === n
      ? `Der findes allerede et miljø der hedder "${n}".`
      : `"${n}" ligger for tæt på "${hit.name}" — de ville dele eksportmappe. Vælg et andet navn.`;
  }
  for (const [k, label, max] of [['tenant', 'Kunde', 40], ['group', 'Gruppe', 40], ['orgLabel', 'Org-navn', 60]])
    if (has(k)) { const e = textError(label, String(fields[k]), max); if (e) return e; }
  if (has('color') && !ENV_COLORS.includes(String(fields.color)))
    return `Ukendt farve "${fields.color}" — vælg en af: ${ENV_COLORS.filter(Boolean).join(', ')}.`;
  if (has('prefix')) {
    const p = String(fields.prefix);
    if (p.length > 20) return `Præfikset må højst være 20 tegn (er ${p.length}).`;
    // Præfikset bliver en del af flownavne og manifest-tabellens navn i Genesys.
    if (!/^[A-Za-z0-9_\-]*$/.test(p))
      return `Præfikset må kun bestå af A-Z, 0-9, _ og - (fx "DEV_"). "${p}" indeholder andet.`;
  }
  if (has('clientId') && !GUID.test(String(fields.clientId)))
    return `Client ID skal være et GUID som xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. "${fields.clientId}" er ikke.`;
  if (has('region') && !REGION_MAP[fields.region])
    return `Ukendt region "${fields.region}" — vælg en af: ${Object.keys(REGION_MAP).join(', ')}`;
  if (has('deployPermission') && fields.deployPermission) {
    const bad = String(fields.deployPermission).split(/[,\s]+/).filter(Boolean).find(x => !PERMISSION.test(x));
    if (bad) return `"${bad}" er ikke en rettighed. Formen er domæne:entitet:handling, fx architect:flow:publish.`;
  }
  if (has('deployGroup')) {
    const g = String(fields.deployGroup);
    if (g.length > 100) return `Gruppenavnet må højst være 100 tegn (er ${g.length}).`;
    if (/[\u0000-\u001f\u007f]/.test(g)) return 'Gruppenavnet må ikke indeholde usynlige kontroltegn.';
  }
  return null;
}

// ── Customers CRUD ──────────────────────────────────────────────────────────

function loadCustomers() {
  if (!fs.existsSync(CUSTOMERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8')); }
  catch { return []; }
}

function saveCustomers(customers) {
  fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2));
}

// ── Kunde → gruppe → miljø ───────────────────────────────────────────────────
// Én post i customers.json er ét miljø (én Genesys-org med ét OAuth-sæt).
// Hierarkiet udledes af tre felter, så alle eksisterende opslag virker uændret
// og poster uden felterne blot samler sig i én bunke.

// ── Konventioner ─────────────────────────────────────────────────────────────
// Trin-rækkefølgen og versionsendelsen er REGLER, ikke tilfældige værdier, og de
// stod tre steder: her, i klientens sortering af miljøer, og i klientens
// aflæsning af "_v10" på et flownavn. Ændrede man den ene, opdagede man først de
// to andre når tavlen sorterede forkert — og en tavle der sorterer forkert siger
// noget usandt om hvad der er forfremmet hvorhen.
//
// De står her alene. Klienten henter dem som et script (se /konventioner.js), så
// de er sat før nogen anden kode kører, og der er intet sted at glemme.

const STAGES = ['dev', 'test', 'uat', 'prod'];

// Hvor Genesys sender et PKCE-login tilbage hen. Skal stå på OAuth-klienten.
const OAUTH_REDIRECT_URI = 'http://localhost:3737/auth/callback';
const stageOrder = s => { const i = STAGES.indexOf(String(s || '').toLowerCase()); return i === -1 ? 99 : i; };

// Listen ovenfor er standarden. Kunder der har flere trin — fx staging eller
// preprod — kan rette den under Kunder → Trin; den gemmes i settings.json og
// lægges ind i STAGES ved opstart. Arrayet skiftes ud på stedet, så alle der
// holder på det (også /konventioner.js), ser den nye liste.
//
// Prod er ikke bare et navn: login, deploy-ret og skrivevagten hænger på det.
// Derfor skal "prod" altid findes og altid stå sidst.
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const STAGE_NAME = /^[a-z][a-z0-9-]{0,19}$/;
const MAX_STAGES = 10;

// Ren vurdering af en ny trinliste. Returnerer { stages } eller { error }.
function stageListError(list, customers = []) {
  if (!Array.isArray(list)) return { error: 'Trinlisten skal være en liste.' };
  const stages = list.map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
  if (!stages.length) return { error: 'Der skal være mindst ét trin.' };
  if (stages.length > MAX_STAGES) return { error: `Højst ${MAX_STAGES} trin.` };
  const ugyldig = stages.find(s => !STAGE_NAME.test(s));
  if (ugyldig) return { error: `"${ugyldig}" er ikke et gyldigt trin — brug små bogstaver, tal og bindestreg, højst 20 tegn, og start med et bogstav.` };
  const dobbelt = stages.find((s, i) => stages.indexOf(s) !== i);
  if (dobbelt) return { error: `"${dobbelt}" står to gange.` };
  if (stages[stages.length - 1] !== 'prod')
    return { error: 'Prod skal findes og stå sidst — login, deploy-ret og skrivevagten hænger på det.' };
  // Et trin der er i brug, kan ikke forsvinde — så faldt miljøet ud af pipelinen.
  const iBrug = customers.filter(c => c.stage && !stages.includes(String(c.stage).toLowerCase()));
  if (iBrug.length)
    return { error: `Trinnet "${iBrug[0].stage}" bruges af ${iBrug.map(c => c.name).join(', ')}. Flyt miljøerne til et andet trin først.` };
  return { stages };
}

function applyStages(stages) { STAGES.splice(0, STAGES.length, ...stages); }

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveSettings(patch) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...loadSettings(), ...patch }, null, 2));
}

// Ved opstart: en gemt liste bruges kun hvis den stadig er gyldig.
{
  const gemt = loadSettings().stages;
  if (gemt) {
    const r = stageListError(gemt);
    if (r.stages) applyStages(r.stages);
  }
}

// Endelsen et forfremmet flow bærer: "testtest" publiceret som udgave 10 bliver
// til "testtest_v10". Reglen bruges tre steder — når navnet dannes, når
// grundnavnet skal findes igen, og når tavlen skal se hvor mange udgaver der er
// kommet til siden forfremmelsen — så den må kun findes ét sted.
const VERSION_SUFFIX = /_v(\d+)$/i;

// Konventionerne som et script frem for et API-kald. Et kald ville komme
// asynkront, og så ville den første optegning af tavlen nå at ske uden dem.
// Et <script> i sidehovedet er indlæst før alt andet, og så findes reglerne
// bare — der er ingen rækkefølge at få galt i halsen.
app.get('/konventioner.js', (req, res) => {
  res.type('application/javascript').send(
    '// Genereret af serveren — se STAGES og VERSION_SUFFIX i server.js.\n' +
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

const UNGROUPED = '__ungrouped__';
const tenantOf = c => (c.tenant || '').trim() || UNGROUPED;
const groupOf  = c => (c.group  || '').trim() || UNGROUPED;
const stageOf  = c => { const s = String(c.stage || '').toLowerCase(); return STAGES.includes(s) ? s : null; };

// ── Virtuelle miljøer i samme org ────────────────────────────────────────────
// Nogle kunder har ikke én org pr. miljø, men ÉN org hvor miljøerne kendes på
// et præfiks: "DEV_Main flow", "TEST_Main flow", og prod uden præfiks. Samme
// konvention gælder datatabellerne. Det er et udbredt Genesys-mønster, og det
// findes allerede i jeres egne orgs.
//
// Et miljø er derfor stadig én post i customers.json — flere poster kan blot
// pege på samme org med hvert sit præfiks. Så virker tavlen, forfremmelsen og
// manifestet uændret; kun udvælgelsen af flows skal kende præfikset.
const prefixOf = c => String(c.prefix || '');

// Samme credentials = samme fysiske org. Det kan afgøres uden et opslag, og
// bruges til at hente flowlisten én gang og dele den mellem søskendemiljøer.
//
// Org-id'et fra Genesys er den rigtige nøgle. Client ID + region er kun en
// nødløsning indtil id'et kendes: to miljøer i SAMME org kan sagtens have hver
// sin OAuth-klient — fx dev med client credentials og prod med PKCE — og så
// troede værktøjet at de lå i hver sin org, og prod så dev's flows.
//
// Et PKCE-miljø uden kendt org får sin egen nøgle: klienten kan logge ind i
// flere orgs via trusted orgs, så to miljøer på samme PKCE-klient må ikke dele
// flowliste før org'en er set ved login.
const orgKeyOf = c => isDemo(c) ? `demo:${c.demoOrg || c.id}`
  : c.orgId ? `org:${c.orgId}`
  : c.authType === 'oauth' ? `env:${c.id}` : `${c.clientId}|${c.region}`;

// Et miljø der endnu ikke kender sin org, må ikke tage en org der allerede
// hører til en anden kunde (tenant). Søskende i samme tenant deler gerne org —
// Sabio's dev og prod gør — men en kundes org i Sabio's pipeline er et fejlvalg
// på login-siden.
const orgOwnedElsewhere = (customer, orgId, all) => !customer?.orgId && orgId
  ? all.find(c => c.id !== customer.id && !isDemo(c) && c.orgId === orgId && tenantOf(c) !== tenantOf(customer)) || null
  : null;

// Står et token i en anden org end den miljøet allerede er kendt i? Med PKCE
// vælger BRUGEREN org'en på Genesys' login-side — og med trusted orgs kan en
// Sabio-bruger vælge en kundes org. Klienten binder ikke org'en; det gør kun
// login'et. Et miljø uden kendt org-id kan ikke afsløre noget.
const wrongOrg = (customer, orgId) => !!(customer?.orgId && orgId && customer.orgId !== orgId);

// Kun client credentials er bundet til klientens egen org. Et PKCE-login kan
// lande i en trusted org, så samme klient siger intet om samme org der.
const clientPinsOrg = c => !isDemo(c) && c.authType !== 'oauth';

// Husker org-id'et på miljøet — og på alle miljøer med samme client
// credentials-klient, for de ligger nødvendigvis i samme org. Sker én gang pr.
// miljø. Et kendt org-id overskrives ALDRIG: et login i en anden org gjorde
// før prod til et søskende af kundens org, og så hentedes kundens flows som
// prod's. Skifter et miljø reelt org, ændrer man klient eller region, og så
// nulstilles id'et dér.
function rememberOrgId(customer, orgId) {
  if (!orgId || !customer || isDemo(customer)) return;
  if (wrongOrg(customer, orgId)) {
    addLog('ERROR', `Refused to change the org id of ${customer.name}: known ${customer.orgId}, got ${orgId}`, customer.name, 'SECURITY');
    return;
  }
  customer.orgId = orgId;
  const all = loadCustomers();
  let changed = false;
  for (const c of all) {
    const sameClient = clientPinsOrg(customer) && clientPinsOrg(c) &&
                       c.clientId === customer.clientId && c.region === customer.region;
    if ((c.id === customer.id || sameClient) && !isDemo(c) && !c.orgId) { c.orgId = orgId; changed = true; }
  }
  if (changed) {
    saveCustomers(all);
    addLog('INFO', `Org id recorded for ${customer.name}: ${orgId}`, customer.name, 'CUSTOMER');
  }
}

// Hører flownavnet til dette miljø? Et præfikset miljø tager kun sine egne.
// Prod har intet præfiks og tager alt DER IKKE bærer et søskendepræfiks —
// ellers ville prod se hele orgen, dev og test inklusive.
//
// Søskendene er dem der er tilføjet på DENNE pc. Er UAT uden præfiks tilføjet
// alene, kendte den ikke DEV_ og TEST_, og så var "DEV_Betaling" UAT's flow.
// takenPrefixes er de præfikser org'en selv har vist sig at bruge (fundet ved
// opdagelsen og husket i opsætningsrækken), så de holdes ude uanset hvad der
// er tilføjet lokalt.
function belongsToEnv(name, env, siblings) {
  const p = prefixOf(env);
  const n = String(name || '');
  if (p) return n.startsWith(p);
  const andre = [...siblings.filter(s => s !== env).map(prefixOf), ...(env.takenPrefixes || [])];
  return !andre.some(x => x && n.startsWith(x));
}

function stripEnvPrefix(name, env) {
  const p = prefixOf(env);
  const n = String(name || '');
  return p && n.startsWith(p) ? n.slice(p.length) : n;
}

// Navnet et flow skal have i et givet miljø: præfikset sat på grundnavnet.
const withEnvPrefix = (baseName, env) => prefixOf(env) + String(baseName || '');

// Hvilke ressourcetyper der bærer miljøets præfiks.
//
// Datatabeller gør — det er konventionen i orgen. Flows gør, og et common
// module ER et flow, så det følger med af sig selv. Køer, skills, wrap-up-koder
// og scripts er derimod fælles for hele org'en og duplikeres ikke pr. virtuelt
// miljø; ville man præfikse dem, ledte vi efter noget der aldrig har eksisteret.
//
// Data actions står bevidst udenfor indtil det er afklaret: de hører til en
// integration, og om man duplikerer dem pr. miljø afhænger af opsætningen.
const prefixedKinds = () => new Set(['datatable', ...FLOW_KINDS]);

// Navnet en afhængighed har i et givet miljø.
function depNameIn(kind, name, env, source) {
  if (!prefixedKinds().has(kind)) return name;
  return withEnvPrefix(stripEnvPrefix(name, source), env);
}

// Inde i et præfikset miljø peger flowet på de præfiksede ressourcer. Uden
// denne omskrivning ville DEV_-flowet pege tilbage på prods tabel — og så
// ville dev og prod dele data, hvilket er lige præcis dét man ville undgå.
// Divisionen hører til miljøet, ikke til flowet. Opretter man i division DEV og
// forfremmer til UAT, skal flowet skifte med — ellers ville UAT-udgaven ligge i
// dev's division. Er der ingen division sat på målet, bruges Home.
const divisionOf = c => (c && String(c.division || '').trim()) || 'Home';

// Kun flowets EGEN division (øverste niveau) skrives om. Længere nede kan der
// stå udtryk som Task.division, og de skal stå urørt.
function setFlowDivisionInYaml(yaml, division) {
  let done = false;
  const eol = /\r\n/.test(yaml) ? '\r\n' : '\n';
  return String(yaml).split(/\r?\n/).map(l => {
    if (done) return l;
    const m = l.match(/^([ \t]{2,})division:([ \t]*)(.*)$/);
    if (!m) return l;
    done = true;
    const varQuoted = /^".*"$|^'.*'$/.test(m[3].trim());
    return `${m[1]}division:${m[2] || ' '}${varQuoted ? JSON.stringify(division) : division}`;
  }).join(eol);
}

function prefixDependenciesInYaml(yaml, source, target) {
  if (prefixOf(source) === prefixOf(target)) return { yaml: String(yaml), changed: [] };
  const changed = [];
  let out = String(yaml);
  for (const tag of ['dataTable', 'commonModule', 'botFlow']) {
    // INDRYKNING KRÆVES. På indrykning 0 er 'commonModule:' ikke en reference
    // til et andet modul — det er flowets EGEN type, og linjen under er dets
    // navnefelt. Uden kravet blev
    //
    //     commonModule:
    //       name: Create Logitems
    //
    // til "DEV_name:", flowet mistede sit navn, og Archy afviste importen med
    // "the flow name 'undefined' is invalid". scanYamlDependencies har haft
    // kravet hele tiden — her manglede det.
    const re = new RegExp(`(^[ \\t]+${tag}:[ \\t]*\\r?\\n[ \\t]+)([^\\r\\n:]+)(:)`, 'gm');
    out = out.replace(re, (hele, hoved, navn, hale) => {
      const rent = navn.trim();
      // «botFlow:» kan også stå som flowets eget felt; nøgler som name/lit er ikke et flownavn.
      if (/^(name|lit|id|description)$/.test(rent)) return hele;
      const ny = withEnvPrefix(stripEnvPrefix(rent, source), target);
      if (ny === rent) return hele;
      if (!changed.includes(`${rent} → ${ny}`)) changed.push(`${rent} → ${ny}`);
      return `${hoved}${ny}${hale}`;
    });
  }
  return { yaml: out, changed };
}

// To miljøer må kun sammenlignes og migreres indbyrdes hvis de deler kunde OG
// gruppe. Miljøer uden gruppe hører ikke sammen med noget — heller ikke med
// hinanden — så en manglende opsætning aldrig kan læses som "de hører sammen".
function sameGroup(a, b) {
  if (!a || !b) return false;
  if (tenantOf(a) === UNGROUPED || groupOf(a) === UNGROUPED) return false;
  if (tenantOf(b) === UNGROUPED || groupOf(b) === UNGROUPED) return false;
  return tenantOf(a) === tenantOf(b) && groupOf(a) === groupOf(b);
}

function buildHierarchy(customers) {
  const tenants = new Map();
  for (const c of customers) {
    const t = tenantOf(c), g = groupOf(c);
    if (!tenants.has(t)) tenants.set(t, new Map());
    const groups = tenants.get(t);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({
      id: c.id, name: c.name, region: c.region,
      stage: stageOf(c), authType: c.authType || 'credentials'
    });
  }
  const out = [];
  for (const [tenant, groups] of tenants) {
    const gs = [];
    for (const [group, envs] of groups) {
      envs.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.name.localeCompare(b.name));
      gs.push({ group, named: group !== UNGROUPED, environments: envs });
    }
    gs.sort((a, b) => a.group.localeCompare(b.group));
    out.push({
      tenant, named: tenant !== UNGROUPED, groups: gs,
      // Brugerfladen skjuler gruppeniveauet når kunden kun har én gruppe —
      // gruppen er der stadig, den fylder bare ikke.
      singleGroup: gs.length === 1
    });
  }
  out.sort((a, b) => (a.named === b.named) ? a.tenant.localeCompare(b.tenant) : (a.named ? -1 : 1));
  return out;
}


// ── Demo-kunde ───────────────────────────────────────────────────────────────
// Fire miljøer og et par flows der kun findes lokalt, så hele pipelinen kan
// prøves af uden at røre en rigtig org. Intet demo-miljø har credentials, og
// ingen kode-vej herunder kalder Genesys eller Archy.
const DEMO_FILE = path.join(__dirname, 'demo-data.json');
const isDemo = c => !!(c && c.demo);

// Demoens forfremmelser skrives i det samme manifest som de rigtige. Når demoen
// nulstilles eller fjernes, skal dens linjer med — ellers ville en øvelse
// efterlade spor i den fortegnelse der beskriver rigtige migreringer.
function dropDemoManifest(which) {
  const hit = id => which === '2' ? String(id).startsWith('demo2-')
            : which === '1' ? (String(id).startsWith('demo-') && !String(id).startsWith('demo2-'))
            : String(id).startsWith('demo');
  try {
    const all = loadManifest().filter(e => !hit(e.targetId || ''));
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(all, null, 2));
  } catch (_) { /* intet manifest endnu */ }
}

function loadDemo() {
  try { return JSON.parse(fs.readFileSync(DEMO_FILE, 'utf8')); }
  catch { return { flows: {} }; }
}
function saveDemo(d) { fs.writeFileSync(DEMO_FILE, JSON.stringify(d, null, 2)); }

const DEMO_TENANT = 'Demo A/S';
const DEMO_GROUP  = 'Demo';
const DEMO_ENVS = [
  { suffix: 'dev',  stage: 'dev'  },
  { suffix: 'test', stage: 'test' },
  { suffix: 'uat',  stage: 'uat'  },
  { suffix: 'prod', stage: 'prod' }
];
const demoEnvId = suffix => 'demo-' + suffix;

// Demo 2 er et andet mønster: miljøerne er ikke hver sin org, men kendes på et
// præfiks inde i den samme org — "DEV_Ordreflow", "TEST_Ordreflow" — og prod
// har intet præfiks. Samme konvention gælder datatabellerne. Her ligger de tre
// non-prod-miljøer i én org og prod i en anden, hvilket er den udbredte form.
const DEMO2_TENANT = 'Kunde 2 A/S';
const DEMO2_GROUP  = 'Norden';
const DEMO2_ORG_A  = 'demo2-orgA';
const DEMO2_ORG_B  = 'demo2-orgB';
const DEMO2_ENVS = [
  { suffix: 'dev',  stage: 'dev',  prefix: 'DEV_',  org: DEMO2_ORG_A, orgLabel: 'Fælles non-prod org' },
  { suffix: 'test', stage: 'test', prefix: 'TEST_', org: DEMO2_ORG_A, orgLabel: 'Fælles non-prod org' },
  { suffix: 'uat',  stage: 'uat',  prefix: 'UAT_',  org: DEMO2_ORG_A, orgLabel: 'Fælles non-prod org' },
  { suffix: 'prod', stage: 'prod', prefix: '',      org: DEMO2_ORG_B, orgLabel: 'Prod-org' }
];
const demo2EnvId = suffix => 'demo2-' + suffix;
// Navnet bærer trinnet, ikke præfikset. Præfikset kan ændres under Kunder, og
// så ville "Kunde 2 A/S — UAT_" stå tilbage over et miljø uden præfiks.
// Tavlen viser præfikset for sig selv i kolonnehovedet.
const demo2EnvName = stage => `${DEMO2_TENANT} — ${String(stage).toUpperCase()}`;

// Demoen har sine egne divisioner, så rullelisten kan prøves af uden en org.
const DEMO_DIVISIONS = ['Home', 'DEV', 'TEST', 'UAT', 'PROD'];


// Et flows indhold er bare en tekst her — nok til at hashe og sammenligne.
// Med 'modul' kalder flowet et common module — skrevet som Archy skriver det,
// så afhængighedsscanningen og præfiks-omskrivningen virker på det.
const demoYaml = (name, body, modul) =>
  `inboundCall:\n  name: ${name}\n  division: Home\n  description: "${body}"\n` +
  (modul
    ? `  tasks:\n    - task:\n        name: Start\n        refId: Start_1\n` +
      `        actions:\n          - callCommonModule:\n              name: Hilsen\n              commonModule:\n` +
      `                ${modul}:\n                  ver_latestPublished:\n`
    : '');
const demoModuleYaml = (name, body) =>
  `commonModule:\n  name: ${name}\n  division: Home\n  description: "${body}"\n`;

function seedDemo() {
  const now = Date.now();
  const day = 86400000;
  const flows = {};
  for (const e of DEMO_ENVS) flows[demoEnvId(e.suffix)] = [];

  // 1) Findes overalt med samme indhold — den rolige række.
  for (const [i, e] of DEMO_ENVS.entries())
    flows[demoEnvId(e.suffix)].push({
      name: 'Velkomst', type: 'INBOUNDCALL',
      published: String(4 - i) + '.0',
      publishedAt: now - (40 - i * 9) * day,
      content: demoYaml('Velkomst', 'goddag og velkommen')
    });

  // 2) Findes kun i dev — hele kæden ligger foran.
  flows[demoEnvId('dev')].push({
    name: 'Aabningstider', type: 'INBOUNDCALL',
    published: '10.0', publishedAt: now - 3 * day,
    content: demoYaml('Aabningstider', 'vi har aabent 8-16')
  });

  // 3) Findes overalt, men prod er løbet fra de andre — nogen har rettet
  //    direkte i prod. Det er den række afvigelses-visningen er til for.
  for (const [i, e] of DEMO_ENVS.entries()) {
    const drifted = e.stage === 'prod';
    flows[demoEnvId(e.suffix)].push({
      name: 'Kundeservice', type: 'WORKFLOW',
      published: drifted ? '7.0' : String(3 - Math.min(i, 2)) + '.0',
      publishedAt: now - (drifted ? 2 : 30 - i * 7) * day,
      content: demoYaml('Kundeservice', drifted
        ? 'rettet direkte i prod en fredag eftermiddag'
        : 'stil om til kundeservice')
    });
  }
  // Flet ind i det der allerede ligger. Skrev vi hele filen, ville en
  // nulstilling af demo 1 slette demo 2's flows og begge demoers manifester —
  // og de to skal ikke kunne røre hinanden.
  for (const liste of Object.values(flows)) liste.forEach(demoRemember);
  const d = loadDemo();
  d.flows = { ...(d.flows || {}), ...flows };
  d.seededAt = now;
  if (d.manifest) for (const e of DEMO_ENVS) delete d.manifest[demoEnvId(e.suffix)];
  saveDemo(d);
}

// Flowene ligger under den ORG miljøet hører til. For demo 1 er org og miljø
// det samme; for demo 2 deler flere virtuelle miljøer den samme org, og så
// skal de læse fra samme liste — ellers er der intet præfikset at filtrere i.
const demoFlowKey = c => (typeof c === 'string' ? c : (c.demoOrg || c.id));
function demoFlowsFor(env) { return (loadDemo().flows || {})[demoFlowKey(env)] || []; }

// Demoen efterligner Genesys' versionshistorik: hver publiceret udgave huskes
// på flowet, så en rollback kan hente den — præcis som den ville hente den fra
// en rigtig org med en eksport af den udgave.
const DEMO_VERSIONS_MAX = 30;
function demoRemember(f) {
  f.versions = f.versions || {};
  f.versions[String(f.published)] = f.content;
  const keys = Object.keys(f.versions);
  for (const k of keys.slice(0, Math.max(0, keys.length - DEMO_VERSIONS_MAX))) delete f.versions[k];
}

function seedDemo2() {
  const d = loadDemo();
  d.flows = d.flows || {};
  const now = Date.now(), day = 86400000;
  const A = [], B = [];

  // Præfikserne tages fra miljøernes AKTUELLE opsætning, ikke fra DEMO2_ENVS.
  // Fjerner man UAT_ under Kunder og nulstiller, skal demoen følge med —
  // ellers stod de gamle "UAT_Betaling" tilbage som selvstændige flows i et
  // miljø uden præfiks, én ekstra række pr. flow.
  const envs = loadCustomers();
  const pfx = {};
  for (const e of DEMO2_ENVS) {
    const c = envs.find(x => x.id === demo2EnvId(e.suffix));
    pfx[e.stage] = c ? prefixOf(c) : e.prefix;
  }
  const nonProd = ['dev', 'test', 'uat'];
  const n = (stage, base) => pfx[stage] + base;

  // 1) Findes i alle fire med samme indhold — den rolige række.
  // Ordreflow og Betaling kalder begge det fælles modul "Hilsen". Forfremmes
  // modulet, skal de to publiceres igen i målet for at få den nye udgave med.
  const ord = 'tag imod ordren';
  const ordV = { dev: ['9.0', 30], test: ['2.0', 22], uat: ['2.0', 15] };
  for (const s of nonProd)
    A.push({ name: n(s, 'Ordreflow'), type: 'INBOUNDCALL', published: ordV[s][0],
             publishedAt: now - ordV[s][1] * day, content: demoYaml(n(s, 'Ordreflow'), ord, n(s, 'Hilsen')) });
  B.push({ name: n('prod', 'Ordreflow'), type: 'INBOUNDCALL', published: '1.0',
           publishedAt: now - 8 * day, content: demoYaml(n('prod', 'Ordreflow'), ord, n('prod', 'Hilsen')) });

  // 1b) Det fælles modul. Dev er rettet (ny velkomsttekst); resten er ens.
  const hilV = { dev: ['4.0', 1], test: ['1.0', 22], uat: ['1.0', 15] };
  for (const s of nonProd)
    A.push({ name: n(s, 'Hilsen'), type: 'COMMONMODULE', published: hilV[s][0],
             publishedAt: now - hilV[s][1] * day,
             content: demoModuleYaml(n(s, 'Hilsen'), s === 'dev' ? 'velkommen til Kunde 2 - nu med ny tekst' : 'velkommen til Kunde 2') });
  B.push({ name: n('prod', 'Hilsen'), type: 'COMMONMODULE', published: '1.0',
           publishedAt: now - 8 * day, content: demoModuleYaml(n('prod', 'Hilsen'), 'velkommen til Kunde 2') });

  // 2) Kun i dev — hele kæden ligger foran.
  A.push({ name: n('dev', 'Fejlbesked'), type: 'WORKFLOW', published: '4.0',
           publishedAt: now - 2 * day, content: demoYaml(n('dev', 'Fejlbesked'), 'sig undskyld') });

  // 3) Findes overalt, men prod er løbet fra de andre.
  const bet = 'tag imod betaling';
  const betV = { dev: ['5.0', 26], test: ['2.0', 20], uat: ['2.0', 14] };
  for (const s of nonProd)
    A.push({ name: n(s, 'Betaling'), type: 'INBOUNDCALL', published: betV[s][0],
             publishedAt: now - betV[s][1] * day, content: demoYaml(n(s, 'Betaling'), bet, n(s, 'Hilsen')) });
  B.push({ name: n('prod', 'Betaling'), type: 'INBOUNDCALL', published: '11.0',
           publishedAt: now - 1 * day,
           content: demoYaml(n('prod', 'Betaling'), 'rettet direkte i prod, ingen ved hvorfor', n('prod', 'Hilsen')) });

  // Et efterladt flow uden præfiks i non-prod-org'en. Det hører til INTET
  // miljø — prod bor i en anden org — og skal derfor ikke dukke op på tavlen.
  // Står et non-prod-miljø UDEN præfiks, er flowet dets — så giver det ingen
  // mening som eksempel, og det udelades.
  if (nonProd.every(s => pfx[s]))
    A.push({ name: 'Gammelt forsoeg', type: 'INBOUNDCALL', published: '1.0',
             publishedAt: now - 300 * day, content: demoYaml('Gammelt forsoeg', 'glemt') });

  A.forEach(demoRemember);
  B.forEach(demoRemember);
  d.flows[DEMO2_ORG_A] = A;
  d.flows[DEMO2_ORG_B] = B;
  // Nulstilling giver en ren tavle: demo 2's egne manifestrækker ryddes, og
  // kun dem — demo 1 skal ikke mærke det.
  if (d.manifest) for (const k of Object.keys(d.manifest))
    if (k.startsWith('demo2-')) delete d.manifest[k];
  saveDemo(d);
}

// Navneregel ved forfremmelse.
//
//   "testest"          publiceret 10  ->  "testest_v10"
//   "testcallback_v10" publiceret 34  ->  "testcallback_v34"   (v10 erstattes)
//   "testtest_v10"     publiceret  1  ->  "testtest_v10"       (uændret)
//
// Tallet er kildens udgave, så navnet siger hvor det kom fra. Er kilden kun
// publiceret én gang, er der ikke sket noget i det miljø siden det ankom — så
// bærer navnet stadig den udgave det kom med, og vi rører det ikke.
// Grundnavnet uden versionsendelsen. Tavlen parrer på DET, så "testtest_v10" i
// dev og "testtest_v15" i test stadig er den samme række — ellers ville en
// omdøbning splitte flowet i to og tage både kæden og afvigelses-visningen med sig.
function baseFlowName(name) {
  return String(name || '').replace(VERSION_SUFFIX, '');
}

// Tallet i endelsen, eller null hvis navnet ingen bærer. Tavlen bruger det til
// at se hvor mange udgaver der er publiceret siden forfremmelsen.
function versionSuffixOf(name) {
  const m = String(name || '').match(VERSION_SUFFIX);
  return m ? parseInt(m[1], 10) : null;
}

function promotionName(currentName, sourcePublishedVersion) {
  const n = parseInt(String(sourcePublishedVersion || '').split('.')[0], 10);
  if (!Number.isFinite(n) || n <= 1) return currentName;
  return `${baseFlowName(currentName)}_v${n}`;
}

// Er miljøet det første trin i sin gruppe — dér hvor flowet bygges?
//
// Kun DÉR sætter forfremmelsen et nyt tal på navnet. Længere nede i kæden er
// miljøets egen udgave bare antallet af gange det har modtaget noget: TEST kan
// stå på v3 mens flowet kom fra DEV som v6. Brugte vi TESTs tal, blev
// "TEST_Betaling_v6" forfremmet til UAT som "UAT_Betaling_v3" — og TEST blev
// omdøbt til _v3 med. Endelsen skal fortælle hvilken udviklingsudgave der
// kører, hele vejen til prod.
function isPipelineOrigin(env, all) {
  if (!stageOf(env)) return true;
  const peers = (all || []).filter(c => sameGroup(c, env) && stageOf(c));
  if (!peers.length) return true;
  return stageOrder(env.stage) <= Math.min(...peers.map(c => stageOrder(c.stage)));
}

// Navnet efter forfremmelse. Fra første trin: kildens udgave. Længere nede:
// navnet som det er — endelsen blev sat dengang flowet forlod første trin.
function promotionNameFrom(currentName, sourcePublishedVersion, fromOrigin, flowType) {
  if (flowType && !carriesVersionSuffix(flowType)) return currentName;
  return fromOrigin ? promotionName(currentName, sourcePublishedVersion) : currentName;
}

// Flowtyper der kaldes VED NAVN fra andre flows. Et common module står i
// kalderens YAML som "commonModule: Hilsen:", og et bot flow som "botFlow:".
// Fik de en versionsendelse, ville "Hilsen" blive til "Hilsen_v4", og hvert
// eneste flow der kalder modulet ville pege på et navn der ikke findes længere.
// Et opkaldsflow rammes derimod via sit id (DID, rute), så dér er endelsen ufarlig.
const NAVNGIVNE_KALDEMAAL = new Set(['COMMONMODULE', 'BOT', 'DIGITALBOT']);
function carriesVersionSuffix(flowType) {
  return !NAVNGIVNE_KALDEMAAL.has(normType(flowType));
}

// Forfremmelse inde i demoen. Kopierer indholdet fra kilden til målet under det
// navn reglen giver. Ingen Archy, ingen Genesys — kun den lokale demofil.
app.post('/api/demo/promote', async (req, res) => {
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

// De flows i et demo-miljø der bruger et common module. Demoen har ingen
// afhængighedssporing, så referencerne læses direkte ud af indholdet.
function demoDependentsOf(env, moduleName) {
  const siblings = loadCustomers().filter(c => isDemo(c) && demoFlowKey(c) === demoFlowKey(env));
  const base = baseFlowName(stripEnvPrefix(moduleName, env));
  return demoFlowsFor(env)
    .filter(f => belongsToEnv(f.name, env, siblings) && f.name !== moduleName)
    .filter(f => (scanYamlDependencies(f.content).commonmodule || [])
      .some(n => baseFlowName(stripEnvPrefix(n, env)) === base))
    .map(f => ({ name: f.name, type: f.type, published: f.published, hasDraft: false }));
}

// Simulerer at nogen arbejder videre i et miljø og publicerer igen. Navnet
// røres ikke — det er netop pointen: udgaven stiger, men navnet bliver ved med
// at fortælle hvilken udgave der sidst blev skubbet videre.
app.post('/api/demo/publish', (req, res) => {
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

app.get('/api/demo/status', (req, res) => {
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

app.post('/api/demo/create', (req, res) => {
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

app.post('/api/demo/reset', (req, res) => {
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

app.delete('/api/demo', (req, res) => {
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

// Divisionerne i en org. Bruges til rullelisten, så man kun kan vælge en
// division der faktisk findes — et frit tekstfelt ville før eller siden give
// en stavefejl der først viser sig som en mislykket import.
app.get('/api/customers/:id/divisions', async (req, res) => {
  const c = loadCustomers().find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(c)) return res.json({ ok: true, divisions: DEMO_DIVISIONS });
  try {
    const { token, apiBase } = await getToken(c);
    const r = await axios.get(`${apiBase}/api/v2/authorization/divisions`, {
      headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 200 }
    });
    res.json({ ok: true, divisions: (r.data.entities || []).map(d => d.name).sort() });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Navnet på miljøets OAuth-klient i Genesys. En kunde kan have 20-30 klienter,
// og et GUID er ikke til at finde igen i Admin — navnet er. Svaret bærer en
// kode, så brugerfladen kan sige hvad der mangler på brugerens eget sprog.
const GRANT_NAMES = { 'CODE': 'Code Authorization', 'CLIENT-CREDENTIALS': 'Client Credentials',
                      'TOKEN': 'Token Implicit Grant', 'SAML2-BEARER': 'SAML2 Bearer', 'PASSWORD': 'Password' };
app.get('/api/customers/:id/oauth-client', async (req, res) => {
  const c = loadCustomers().find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(c) || !c.clientId) return res.json({ ok: false, code: 'none' });
  if (c.authType === 'oauth' && !tokenStore[c.id]) return res.json({ ok: false, code: 'login' });
  try {
    const { token, apiBase } = await getToken(c);
    const r = await axios.get(`${apiBase}/api/v2/oauth/clients/${encodeURIComponent(c.clientId)}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const g = r.data.authorizedGrantType;
    res.json({ ok: true, name: r.data.name || c.clientId, grantType: GRANT_NAMES[g] || g || '',
               grantCode: g || '', redirectUris: r.data.registeredRedirectUri || [] });
  } catch (e) {
    const st = e.response?.status;
    if (st === 403) return res.json({ ok: false, code: 'forbidden' });
    if (/OAuth token (missing|expired)|another org/.test(e.message)) return res.json({ ok: false, code: 'login' });
    res.json({ ok: false, code: 'error', error: describeApiError(e) });
  }
});

app.get('/api/stages', (req, res) => {
  const all = loadCustomers();
  const used = {};
  for (const c of all) if (c.stage) (used[String(c.stage).toLowerCase()] ||= []).push(c.name);
  res.json({ ok: true, stages: STAGES, used });
});

app.put('/api/stages', (req, res) => {
  const r = stageListError(req.body?.stages, loadCustomers());
  if (r.error) return res.status(400).json({ error: r.error });
  const foer = STAGES.join(' → ');
  applyStages(r.stages);
  saveSettings({ stages: r.stages });
  addLog('INFO', `Stages changed: ${foer} ⇒ ${r.stages.join(' → ')}`, null, 'CUSTOMER');
  res.json({ ok: true, stages: STAGES });
});

app.get('/api/hierarchy', (req, res) => {
  res.json({ ok: true, stages: STAGES, tenants: buildHierarchy(loadCustomers()) });
});

// Vagt foran enhver skrivning fra ét miljø til et andet. Alt her udledes af
// miljøernes egen opsætning — kun prod-bekræftelsen kommer fra brugeren, og
// den er netop ment som en bevidst handling.
// Returnerer null når det er tilladt, ellers { code, error }.
function migrationGuard(source, target, body = {}) {
  if (!source || !target) return { code: 'unknown-env', error: 'Ukendt miljø.' };
  if (source.id === target.id)
    return { code: 'same-env', error: 'Kilde og mål er det samme miljø.' };

  // Er blot ét af miljøerne sat op i en gruppe, gælder gruppereglen. Er ingen
  // af dem det, er der ingen pipeline at håndhæve, og en løs migrering går
  // igennem som før — ellers ville alt stå stille indtil grupperne er sat op.
  const grouped = c => tenantOf(c) !== UNGROUPED && groupOf(c) !== UNGROUPED;
  if ((grouped(source) || grouped(target)) && !sameGroup(source, target) && !body.allowCrossGroup)
    return { code: 'cross-group',
             error: `"${source.name}" og "${target.name}" er ikke i samme gruppe. Migrering på tværs af grupper er spærret.` };

  if (stageOf(target) === 'prod' && !body.confirmProd)
    return { code: 'prod-confirm',
             error: `"${target.name}" er et prod-miljø. Forfremmelsen skal bekræftes udtrykkeligt.` };

  return null;
}

// Trinnet før: man bygger og publicerer i ét miljø, tester det dér, og
// forfremmer først derefter. En upubliceret kladde er ikke testet.
async function publishedVersionOf(customer, flowName, flowType) {
  const { token, apiBase } = await getToken(customer);
  const r = await axios.get(`${apiBase}/api/v2/flows`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { name: flowName, type: flowType, pageSize: 50 }
  });
  const f = (r.data.entities || []).find(x =>
    x.name.trim().toLowerCase() === String(flowName).trim().toLowerCase());
  if (!f) return { found: false, published: null };
  return { found: true, published: f.publishedVersion?.name || f.publishedVersion?.commitVersion || null };
}

// To miljøer i SAMME org med SAMME præfiks ville gøre krav på de samme flows —
// tavlen kunne ikke skelne dem, og en forfremmelse mellem dem ville skrive
// flowet ovenpå sig selv. Oftest er det to miljøer uden præfiks: fx UAT og
// prod i samme org. UAT uden præfiks er fint, så længe prod bor i en anden org.
function prefixClash(env, all) {
  if (!stageOf(env)) return null;
  const hit = all.find(c => c.id !== env.id && stageOf(c) &&
    orgKeyOf(c) === orgKeyOf(env) && prefixOf(c) === prefixOf(env) &&
    tenantOf(c) === tenantOf(env) && groupOf(c) === groupOf(env));
  if (!hit) return null;
  return prefixOf(env)
    ? `"${hit.name}" bruger allerede præfikset "${prefixOf(env)}" i samme org. Hvert miljø i en org skal have sit eget præfiks.`
    : `"${hit.name}" ligger allerede uden præfiks i samme org. Kun ét miljø pr. org kan være uden præfiks — giv det ene et præfiks (fx UAT_).`;
}

// Hvilke flows i org'en ville skifte betydning hvis miljøet fik et andet
// præfiks? Flows omdøbes ikke af sig selv — i en rigtig org ville Archy lave et
// nyt flow ved siden af — så navnene i org'en står som de er. Ændres præfikset
// fra "UAT_" til intet, ligger "UAT_Betaling" tilbage, og tavlen viser det som
// sit eget flow med grundnavnet "UAT_Betaling". Ændres det fra intet til
// "UAT_", hører "Betaling" slet ikke til miljøet længere.
function prefixChangeImpact(env, newPrefix, flows, all) {
  const efter = { ...env, prefix: String(newPrefix || '').trim() };
  const soeskende = (e) => all.map(c => c.id === env.id ? e : c).filter(c => orgKeyOf(c) === orgKeyOf(env));
  const foer = soeskende(env), nu = soeskende(efter);
  const ramt = [];
  for (const f of flows) {
    const hoerteTil = belongsToEnv(f.name, env, foer);
    if (!hoerteTil) continue;
    const hoererTil = belongsToEnv(f.name, efter, nu);
    const skifter = !hoererTil ||
      baseFlowName(stripEnvPrefix(f.name, env)) !== baseFlowName(stripEnvPrefix(f.name, efter));
    if (skifter) ramt.push({ name: f.name, type: f.type, lost: !hoererTil });
  }
  return ramt;
}

// ── Guidet præfiks-omdøbning ─────────────────────────────────────────────────
// Ændres præfikset, skal flows, datatabeller og manifest-tabellen i org'en have
// nye navne — ellers ligger "UAT_Betaling" tilbage og bliver sit eget flow på
// tavlen, og manifestet peger på en tabel der ikke længere hører til miljøet.
//
// Omdøbningen sker via API'et (PUT på flowets og tabellens id), ikke via Archy:
// Archy finder flows på navnet og ville lave et NYT flow ved siden af. Med
// API'et beholder flowet sit id, alle udgaver får det nye navn, og alt der
// peger på det med id — telefonnumre, andre flows, køer — virker videre.

// Ren plan: hvad skal hedde hvad, og hvad kolliderer. flows/tables er lister af
// { id, name, type? } fra org'en.
function prefixRenamePlan(env, newPrefix, flows, tables, all) {
  const efter = { ...env, prefix: String(newPrefix || '').trim() };
  const soeskende = e => all.map(c => c.id === env.id ? e : c).filter(c => orgKeyOf(c) === orgKeyOf(env));
  const foer = soeskende(env);
  const nytNavn = navn => withEnvPrefix(stripEnvPrefix(navn, env), efter);
  const erManifest = navn => String(navn).endsWith(ORG_MANIFEST_BASE);
  // Moduler og bots kaldes ved NAVN i eksporteret YAML. Det tager vores egen
  // omskrivning sig af ved næste forfremmelse, men eksterne værktøjer og
  // gemte YAML-filer der nævner dem, skal rettes i hånden.
  const kaldesVedNavn = type => ['COMMONMODULE', 'BOT', 'DIGITALBOT'].includes(normType(type));

  const planFlows = [];
  for (const f of flows) {
    if (!belongsToEnv(f.name, env, foer)) continue;
    const to = nytNavn(f.name);
    if (to === f.name) continue;
    const kollision = flows.find(x => x.id !== f.id && x.name === to && normType(x.type) === normType(f.type));
    planFlows.push({ id: f.id, type: f.type, from: f.name, to, conflict: !!kollision, calledByName: kaldesVedNavn(f.type) });
  }
  const planTables = [];
  for (const t of tables) {
    if (erManifest(t.name) || !belongsToEnv(t.name, env, foer)) continue;
    const to = nytNavn(t.name);
    if (to === t.name) continue;
    planTables.push({ id: t.id, from: t.name, to, conflict: tables.some(x => x.id !== t.id && x.name === to) });
  }
  const mFra = manifestTableName(env), mTil = manifestTableName(efter);
  const mTabel = tables.find(t => t.name === mFra);
  const manifest = mTabel && mFra !== mTil
    ? { id: mTabel.id, from: mFra, to: mTil, conflict: tables.some(x => x.name === mTil) }
    : null;
  return { oldPrefix: prefixOf(env), newPrefix: efter.prefix, flows: planFlows, tables: planTables, manifest };
}

async function listAllTables(env) {
  const { token, apiBase } = await getToken(env);
  const acc = [];
  for (let page = 1; ; page++) {
    const r = await axios.get(`${apiBase}/api/v2/flows/datatables`, {
      headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 100, pageNumber: page } });
    acc.push(...(r.data.entities || []).map(t => ({ id: t.id, name: t.name })));
    if (page >= (r.data.pageCount || 1)) break;
  }
  return acc;
}

async function prefixPlanFor(env, newPrefix) {
  const all = loadCustomers();
  const flows = isDemo(env) ? demoFlowsFor(env).map(f => ({ id: `${env.id}:${f.name}`, name: f.name, type: f.type }))
                            : await listAllFlows(env);
  const tables = isDemo(env) ? [] : await listAllTables(env);
  return prefixRenamePlan(env, newPrefix, flows, tables, all);
}

// Prøv præfikset af, før det gemmes: findes det i forvejen, eller er det ugyldigt?
function prefixChangeError(env, newPrefix, all) {
  const fejl = envFieldError({ prefix: newPrefix }, all.filter(c => c.id !== env.id));
  if (fejl) return fejl;
  return prefixClash({ ...env, prefix: newPrefix }, all);
}

app.post('/api/prefix/plan', async (req, res) => {
  const all = loadCustomers();
  const env = all.find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Not found' });
  const newPrefix = String(req.body.prefix || '').trim();
  const fejl = prefixChangeError(env, newPrefix, all);
  if (fejl) return res.status(400).json({ error: fejl });
  try {
    res.json({ ok: true, ...(await prefixPlanFor(env, newPrefix)) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Ét navn ændret i org'en. Hentes først, så PUT bærer resten af objektet
// uændret — et flow skal have sin type med, en tabel sit skema.
async function renameInOrg(env, kind, id, to) {
  const { token, apiBase } = await getToken(env);
  const H = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (kind === 'flow') {
    // Genesys kræver at flowet er tjekket ud af den der omdøber (409 "not
    // locked by client …"). Afprøvet mod Sabio DEV: checkout → PUT → revert.
    // Revert beholder det nye navn, kasserer den kladde checkout lavede og
    // frigiver låsen. Havde flowet en gemt kladde i forvejen, bruges unlock i
    // stedet — revert ville smide den kladde væk.
    const act = a => axios.post(`${apiBase}/api/v2/flows/actions/${a}`, null, { ...H, params: { flow: id } });
    const f = (await axios.get(`${apiBase}/api/v2/flows/${encodeURIComponent(id)}`, H)).data;
    if (f.lockedUser || f.lockedClient)
      throw new Error(`checked out by ${f.lockedUser?.name || f.lockedClient?.name || 'someone else'}`);
    const havdeKladde = !!f.savedVersion;
    await act('checkout');
    try {
      await axios.put(`${apiBase}/api/v2/flows/${encodeURIComponent(id)}`,
        { id: f.id, name: to, type: f.type, description: f.description || '', division: f.division }, H);
    } finally {
      try { await act(havdeKladde ? 'unlock' : 'revert'); }
      catch (_) { try { await act('unlock'); } catch (__) {} }
    }
  } else {
    const t = (await axios.get(`${apiBase}/api/v2/flows/datatables/${encodeURIComponent(id)}`,
      { ...H, params: { expand: 'schema' } })).data;
    await axios.put(`${apiBase}/api/v2/flows/datatables/${encodeURIComponent(id)}`, { ...t, name: to }, H);
  }
}

app.post('/api/prefix/apply', async (req, res) => {
  const all = loadCustomers();
  const env = all.find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Not found' });
  const newPrefix = String(req.body.prefix || '').trim();
  const fejl = prefixChangeError(env, newPrefix, all);
  if (fejl) return res.status(400).json({ error: fejl });

  // Planen regnes ud igen her — klienten vælger kun HVILKE punkter, aldrig
  // navnene. Kolliderende punkter springes altid over.
  let plan;
  try { plan = await prefixPlanFor(env, newPrefix); }
  catch (e) { return res.status(500).json({ error: describeApiError(e) }); }
  const valgteFlows = new Set(req.body.flowIds || []), valgteTabeller = new Set(req.body.tableIds || []);
  const opgaver = [
    ...plan.flows.filter(x => valgteFlows.has(x.id) && !x.conflict).map(x => ({ kind: 'flow', ...x })),
    ...plan.tables.filter(x => valgteTabeller.has(x.id) && !x.conflict).map(x => ({ kind: 'table', ...x })),
    ...(req.body.manifest && plan.manifest && !plan.manifest.conflict ? [{ kind: 'table', manifest: true, ...plan.manifest }] : [])
  ];

  addLog('INFO', `Prefix change for ${env.name}: "${plan.oldPrefix}" → "${newPrefix}" — renaming ${opgaver.length} item(s)`, env.name, 'CUSTOMER');
  const udfoert = [], resultater = [];
  let fejlet = null;
  for (const o of opgaver) {
    try {
      if (isDemo(env)) {
        const d = loadDemo();
        const f = (d.flows[demoFlowKey(env)] || []).find(x => x.name === o.from && x.type === o.type);
        if (!f) throw new Error('not found');
        f.name = o.to; f.content = renameFlowInYaml(f.content, o.to);
        saveDemo(d);
      } else {
        await renameInOrg(env, o.kind, o.id, o.to);
      }
      udfoert.push(o);
      resultater.push({ kind: o.kind, from: o.from, to: o.to, ok: true });
      addLog('SUCCESS', `Renamed ${o.kind} "${o.from}" → "${o.to}"`, env.name, 'CUSTOMER');
    } catch (e) {
      fejlet = { kind: o.kind, from: o.from, to: o.to, ok: false, error: describeApiError(e) };
      resultater.push(fejlet);
      addLog('ERROR', `Could not rename ${o.kind} "${o.from}": ${fejlet.error}`, env.name, 'CUSTOMER');
      break;
    }
  }

  // Fejlede én, rulles de andre tilbage — et halvt omdøbt miljø er værre end
  // et der slet ikke blev rørt. Præfikset ændres kun når alt gik igennem.
  if (fejlet) {
    for (const o of udfoert.reverse()) {
      try {
        if (isDemo(env)) {
          const d = loadDemo();
          const f = (d.flows[demoFlowKey(env)] || []).find(x => x.name === o.to && x.type === o.type);
          if (f) { f.name = o.from; f.content = renameFlowInYaml(f.content, o.from); saveDemo(d); }
        } else await renameInOrg(env, o.kind, o.id, o.from);
        addLog('INFO', `Rolled back ${o.kind} "${o.to}" → "${o.from}"`, env.name, 'CUSTOMER');
      } catch (e) {
        addLog('ERROR', `Rollback failed for ${o.kind} "${o.to}": ${describeApiError(e)} — rename it back by hand`, env.name, 'CUSTOMER');
        resultater.push({ kind: o.kind, from: o.to, to: o.from, ok: false, rollbackFailed: true, error: describeApiError(e) });
      }
    }
    return res.status(502).json({ ok: false, error: fejlet.error, failed: fejlet, results: resultater, rolledBack: true });
  }

  const kunder = loadCustomers();
  const i = kunder.findIndex(c => c.id === env.id);
  kunder[i] = { ...kunder[i], prefix: newPrefix };
  // Miljøer uden præfiks i samme org husker de præfikser org'en bruger. Det
  // gamle er væk nu, det nye er kommet til.
  for (const c of kunder)
    if (c.id !== env.id && !prefixOf(c) && orgKeyOf(c) === orgKeyOf(env) && Array.isArray(c.takenPrefixes))
      c.takenPrefixes = [...new Set([...c.takenPrefixes.filter(p => p !== plan.oldPrefix), newPrefix].filter(Boolean))].sort();
  saveCustomers(kunder);
  delete _mfTableCache[env.id];
  afterEnvChange(env, kunder[i], 'prefix changed');
  addLog('SUCCESS', `Prefix of ${env.name} is now "${newPrefix}" — ${udfoert.length} item(s) renamed`, env.name, 'CUSTOMER');
  res.json({ ok: true, prefix: newPrefix, results: resultater });
});

app.post('/api/customers/:id/prefix-check', async (req, res) => {
  const all = loadCustomers();
  const env = all.find(c => c.id === req.params.id);
  if (!env) return res.status(404).json({ error: 'Not found' });
  const newPrefix = String(req.body.prefix || '').trim();
  if (newPrefix === prefixOf(env)) return res.json({ ok: true, affected: [] });
  try {
    const flows = isDemo(env) ? demoFlowsFor(env) : await listAllFlows(env);
    const affected = prefixChangeImpact(env, newPrefix, flows, all);
    res.json({ ok: true, oldPrefix: prefixOf(env), newPrefix, count: affected.length, affected: affected.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

app.get('/api/customers', (req, res) => {
  const customers = loadCustomers().map(c => ({ ...c, clientSecret: '••••••••' }));
  res.json(customers);
});

app.post('/api/customers', (req, res) => {
  const { clientSecret, authType, stage, division } = req.body;
  const tr = v => String(v ?? '').trim();
  const name = tr(req.body.name), clientId = tr(req.body.clientId), region = tr(req.body.region);
  const tenant = tr(req.body.tenant), group = tr(req.body.group), prefix = tr(req.body.prefix);
  const orgLabel = tr(req.body.orgLabel), color = tr(req.body.color);
  const deployPermission = tr(req.body.deployPermission), deployGroup = tr(req.body.deployGroup);
  const isOAuth = authType === 'oauth';
  if (authType !== undefined && !['credentials', 'oauth'].includes(authType))
    return res.status(400).json({ error: `Ukendt godkendelse "${authType}"` });
  if (!name || !clientId || !region || (!isOAuth && !clientSecret))
    return res.status(400).json({ error: isOAuth ? 'Name, Client ID and Region required' : 'All fields required' });
  if (stage && !STAGES.includes(String(stage).toLowerCase()))
    return res.status(400).json({ error: `Ukendt trin "${stage}" — vælg et af: ${STAGES.join(', ')}` });
  const customers = loadCustomers();
  const fejl = envFieldError({ name, clientId, region, tenant, group, prefix, orgLabel, color,
                               deployPermission, deployGroup }, customers);
  if (fejl) return res.status(400).json({ error: fejl });
  const customer = {
    id: Date.now().toString(), name, clientId,
    clientSecret: clientSecret || '', region,
    authType: authType || 'credentials',
    tenant: (tenant || '').trim(),
    group:  (group  || '').trim(),
    stage:  String(stage || '').toLowerCase() || '',
    prefix:   (prefix   || '').trim(),
    orgLabel: (orgLabel || '').trim(),
    color,
    division: (division || '').trim(),
    deployPermission: (deployPermission || '').trim(),
    deployGroup:      (deployGroup      || '').trim()
  };
  // Et prod-miljø med PKCE skal ikke have en secret liggende — så var der en
  // genvej uden om det personlige login.
  if (customer.stage === 'prod' && customer.authType === 'oauth') customer.clientSecret = '';
  const kendt = clientPinsOrg(customer) &&
    customers.find(c => c.orgId && clientPinsOrg(c) && c.clientId === clientId && c.region === region);
  if (kendt) customer.orgId = kendt.orgId;
  const clash = prefixClash(customer, customers);
  if (clash) return res.status(400).json({ error: clash });
  customers.push(customer);
  saveCustomers(customers);
  addLog('INFO', `Customer created: ${name} (region: ${region}, auth: ${customer.authType})`, name, 'CUSTOMER');
  afterEnvChange(null, customer, 'environment created');
  res.json(masked(loadCustomers().find(c => c.id === customer.id) || customer));
});

app.put('/api/customers/:id', (req, res) => {
  const customers = loadCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const patch = {};
  for (const k of EDITABLE_FIELDS) if (req.body[k] !== undefined) patch[k] = req.body[k];
  // GET udleverer hemmeligheden maskeret. Sendes den værdi tilbage, ville en
  // naiv fletning overskrive den rigtige hemmelighed med prikker og gøre
  // miljøet ubrugeligt. At genkende masken er for skrøbeligt — tegnene kan
  // være forvansket undervejs — så PUT tager slet ikke imod clientSecret.
  // Vil man skifte den, sender man newClientSecret.
  delete patch.clientSecret;
  if (patch.newClientSecret) patch.clientSecret = patch.newClientSecret;
  delete patch.newClientSecret;
  if (patch.stage !== undefined) {
    const s = String(patch.stage || '').toLowerCase();
    if (s && !STAGES.includes(s))
      return res.status(400).json({ error: `Ukendt trin "${patch.stage}" — vælg et af: ${STAGES.join(', ')}` });
    patch.stage = s;
  }
  for (const k of ['name', 'tenant', 'group', 'prefix', 'orgLabel', 'division', 'clientId',
                   'region', 'deployPermission', 'deployGroup', 'color'])
    if (patch[k] !== undefined) patch[k] = String(patch[k] || '').trim();
  if (patch.authType !== undefined && !['credentials', 'oauth'].includes(patch.authType))
    return res.status(400).json({ error: `Ukendt godkendelse "${patch.authType}"` });
  if (patch.clientId === '') delete patch.clientId;

  const before  = customers[idx];
  // Kun det der ÆNDRES, tjekkes. Et ældre navn der ikke ville gå igennem i dag,
  // skal ikke spærre for at man retter præfikset.
  const changed = {};
  for (const k of Object.keys(patch))
    if (String(before[k] ?? '') !== String(patch[k] ?? '')) changed[k] = patch[k];
  const fejl = envFieldError(changed, customers.filter(c => c.id !== before.id));
  if (fejl) return res.status(400).json({ error: fejl });
  const laast = prodSettingsBlock(before, changed, tokenStore[before.id]);
  if (laast) {
    addLog('WARN', `Prod settings change blocked (${laast.code}): ${Object.keys(changed).join(', ')} → ${before.name}`, before.name, 'SECURITY');
    return res.status(403).json({ ...laast, envId: before.id, envName: before.name });
  }
  const updated = { ...before, ...patch };
  if (updated.authType !== 'oauth' && !isDemo(updated) && !updated.clientSecret)
    return res.status(400).json({ error: 'Client credentials kræver en client secret.' });
  // Som ved oprettelse: prod med PKCE har ingen secret på disken.
  if (updated.stage === 'prod' && updated.authType === 'oauth') updated.clientSecret = '';
  // Et login hører til den klient og det miljø det blev givet til. Skifter
  // godkendelsen, klienten, regionen eller trinnet, gælder det ikke længere.
  if (['authType', 'clientId', 'region', 'stage', 'deployPermission', 'deployGroup']
        .some(k => (before[k] || '') !== (updated[k] || ''))) {
    delete tokenStore[updated.id];
    delete _whoCache[updated.id];
  }
  if (['clientId', 'region'].some(k => (before[k] || '') !== (updated[k] || ''))) {
    delete updated.orgId;
    delete orgIdCache[updated.id];
  }
  const clash = prefixClash(updated, customers);
  if (clash) return res.status(400).json({ error: clash });
  customers[idx] = updated;
  saveCustomers(customers);
  if (before.name !== updated.name) {
    addLog('INFO', `Customer renamed: "${before.name}" → "${updated.name}"`, updated.name, 'CUSTOMER');
    moveCustomerFolder(before.name, updated.name);
  }
  addLog('INFO', `Customer updated: ${updated.name}`, updated.name, 'CUSTOMER');
  // Org'en vinder ved næste synkronisering — så en rettelse her skal skrives
  // til org'en med det samme, og søskendenes lister med.
  afterEnvChange(before, updated, 'environment changed');
  res.json(masked(loadCustomers().find(c => c.id === updated.id) || updated));
});

app.delete('/api/customers/:id', (req, res) => {
  const customers = loadCustomers();
  const customer = customers.find(c => c.id === req.params.id);
  saveCustomers(customers.filter(c => c.id !== req.params.id));
  addLog('WARN', `Customer deleted: ${customer?.name || req.params.id}`, customer?.name, 'CUSTOMER');
  // Tabellen i org'en bliver stående — miljøet er kun fjernet fra denne pc.
  // Men søskendene skal ikke længere nævne det.
  if (customer) afterEnvChange(customer, null, 'environment deleted');
  res.json({ ok: true });
});

// ── Skrivning til prod kræver en person med rettigheden ─────────────────────
// Et tjek af en indtastet e-mail beviser kun at DEN e-mail har rettigheden —
// ikke at det er dens ejer der sidder ved tastaturet. Derfor logger man ind i
// Genesys som sig selv (PKCE), og det er DET token der skriver. Genesys
// håndhæver så selv rettighederne, og audit-loggen viser personen.
//
// Et prod-miljø med client credentials kan stadig læses, men ikke skrives til:
// med en secret på disken kunne enhver ved maskinen deploye. Og selv med et
// gyldigt login gælder deploy-retten kun et stykke tid — et token lever et
// døgn, og en pc der står ulåst efter frokost skal ikke kunne deploye.

const PROD_DEPLOY_WINDOW = 30 * 60 * 1000;
const DEFAULT_DEPLOY_PERMISSION = 'architect:flow:publish';

// Hver rute der skriver til en org, og feltet der siger hvilket miljø. En ny
// skrivende rute SKAL stå her — test/prod-rettigheder.test.js fælder ellers.
// Rollback og release-noter finder miljøet via releasen og tjekker selv.
const PROD_WRITE_ROUTES = {
  '/api/import':                  'customerId',
  '/api/flows/publish':           'customerId',
  '/api/flows/republish':         'envId',
  '/api/manifest/create':         'envId',
  '/api/manifest/rebuild':        'envId',
  '/api/flows/baseline':          'targetId',
  '/api/migrate/prepare':         'targetId',
  '/api/migrate/commit':          'targetId',
  '/api/flows/migrate-dependency': 'targetId',
  '/api/actions/migrate':         'targetId',
  '/api/datatables/migrate':      'targetId',
  '/api/wrapupcodes/migrate':     'targetId',
  '/api/oauthclients/migrate':    'targetId',
  '/api/roles/migrate':           'targetId',
  '/api/integrations/migrate':    'targetId',
  '/api/data-actions/map':        'targetId',
  '/api/prompts/migrate':         'targetId',
  '/api/surveyforms/migrate':     'targetId',
  '/api/divisions/create':        'targetId',
  '/api/prefix/apply':            'envId'
};

function deployRequirements(env) {
  const permissions = String(env?.deployPermission || DEFAULT_DEPLOY_PERMISSION)
    .split(/[,\s]+/).filter(Boolean);
  return { permissions, group: String(env?.deployGroup || '').trim() };
}

// "architect:*:*" dækker "architect:flow:publish". Stjernen gælder et helt led.
//
// Genesys skriver rettigheder der gælder pr. division med divisionernes id'er
// som et fjerde led: "architect:flow:publish:<id>,<id>,…". Det er sådan ALLE
// flow-rettigheder ser ud, så med krav om præcis tre led blev selv en Master
// Admin afvist. Divisionerne ses der bort fra her — Genesys håndhæver dem selv,
// når Archy skriver med brugerens token.
function permissionGranted(held, wanted) {
  const h = String(held || '').split(':'), w = String(wanted || '').split(':');
  if (h.length < 3 || h.length > 4 || w.length !== 3) return false;
  return h.slice(0, 3).every((x, i) => x === '*' || x.toLowerCase() === w[i].toLowerCase());
}

// Hvad hver funktion i programmet kræver i Genesys. Forbindelsestesten holder
// miljøets rettigheder op mod listen, så man ser HVILKEN funktion der vil
// fejle — før man står midt i en migrering. credsOnly gælder kun client
// credentials (Archy slår sin egen klient op).
const PERMISSION_CHECKS = [
  // Archy eksporterer og importerer gennem Architects egen brugerflade og
  // fejler uden architect:ui:view — også når API'et gerne viser flowene.
  { area: 'flows_read',    perms: ['architect:flow:view', 'architect:ui:view'] },
  { area: 'flows_write',   perms: ['architect:flow:add', 'architect:flow:edit', 'architect:ui:view'] },
  { area: 'flows_publish', perms: ['architect:flow:publish'] },
  { area: 'archy_client',  perms: ['oauth:client:view'], credsOnly: true },
  { area: 'datatables',    perms: ['architect:datatable:view', 'architect:datatable:add',
                                   'architect:datatableRow:view', 'architect:datatableRow:add', 'architect:datatableRow:edit'] },
  { area: 'dataactions',   perms: ['integrations:integration:view', 'integrations:action:view', 'integrations:action:add'] },
  { area: 'prompts',       perms: ['architect:userPrompt:view', 'architect:userPrompt:add'] },
  { area: 'divisions',     perms: ['authorization:division:view'] },
  { area: 'queues',        perms: ['routing:queue:view'] },
  { area: 'users',         perms: ['directory:user:view'] },
  { area: 'dependencies',  perms: ['architect:dependencyTracking:view'] },
];

// Ren vurdering: held er rettighederne som "domæne:entitet:handling[:division]".
function evaluatePermissions(held, authType) {
  return PERMISSION_CHECKS
    .filter(c => !(c.credsOnly && authType === 'oauth'))
    .map(c => {
      const missing = c.perms.filter(p => !held.some(h => permissionGranted(h, p)));
      return { area: c.area, ok: missing.length === 0, missing };
    });
}

// En rolles permissionPolicies som rettighedsstrenge.
const rolePermissions = role => (role?.permissionPolicies || []).flatMap(p =>
  (p.actionSet || []).map(a => `${p.domain}:${p.entityName}:${a}`));

// Miljøets faktiske rettigheder. En person (PKCE) slås op direkte; en klient
// (client credentials) via sine roller, hvilket kræver oauth:client:view og
// authorization:role:view. Kan de ikke læses, returneres null.
async function heldPermissions(customer, token, apiBase) {
  const H = { headers: { Authorization: `Bearer ${token}` } };
  if (customer.authType === 'oauth') {
    const me = await axios.get(`${apiBase}/api/v2/users/me`, { ...H, params: { expand: 'authorization' } });
    return me.data.authorization?.permissions || [];
  }
  try {
    const cl = await axios.get(`${apiBase}/api/v2/oauth/clients/${encodeURIComponent(customer.clientId)}`, H);
    const roleIds = [...new Set((cl.data.roleDivisions || []).map(r => r.roleId).filter(Boolean))];
    const roles = await Promise.all(roleIds.map(id =>
      axios.get(`${apiBase}/api/v2/authorization/roles/${encodeURIComponent(id)}`, H).then(r => r.data)));
    return roles.flatMap(rolePermissions);
  } catch (_) { return null; }
}

// Uden adgang til rollerne prøves læsningen af i stedet. Skriverettigheder kan
// ikke prøves uden at skrive, så de meldes som ukendte — ikke som i orden.
const READ_PROBES = {
  flows_read:   ['architect:flow:view',             '/api/v2/flows'],
  datatables:   ['architect:datatable:view',        '/api/v2/flows/datatables'],
  dataactions:  ['integrations:action:view',        '/api/v2/integrations/actions'],
  prompts:      ['architect:userPrompt:view',       '/api/v2/architect/prompts'],
  divisions:    ['authorization:division:view',     '/api/v2/authorization/divisions'],
  queues:       ['routing:queue:view',              '/api/v2/routing/queues'],
  users:        ['directory:user:view',             '/api/v2/users'],
};
async function probePermissions(customer, token, apiBase) {
  const H = { headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 1 } };
  const out = [];
  for (const c of PERMISSION_CHECKS) {
    if (c.credsOnly && customer.authType === 'oauth') continue;
    const probe = READ_PROBES[c.area];
    if (c.area === 'archy_client') {
      try { await axios.get(`${apiBase}/api/v2/oauth/clients/${encodeURIComponent(customer.clientId)}`, H);
            out.push({ area: c.area, ok: true, missing: [] }); }
      catch (e) { out.push(e.response?.status === 403
        ? { area: c.area, ok: false, missing: c.perms } : { area: c.area, ok: false, unknown: true, missing: [] }); }
      continue;
    }
    if (!probe) { out.push({ area: c.area, ok: false, unknown: true, missing: [] }); continue; }
    try { await axios.get(apiBase + probe[1], H); out.push({ area: c.area, ok: true, missing: [] }); }
    catch (e) {
      out.push(e.response?.status === 403
        ? { area: c.area, ok: false, missing: [probe[0]] }
        : { area: c.area, ok: false, unknown: true, missing: [] });
    }
  }
  return out;
}

// Ren vurdering af /users/me?expand=authorization,groups mod kravene.
// groupIds er id'erne på grupper med det krævede navn (null = ikke slået op).
function evaluateDeployRights(me, need, groupIds, now = Date.now(), lookupError = null) {
  const held = me?.authorization?.permissions || [];
  const missing = [];
  for (const p of need.permissions)
    if (!held.some(h => permissionGranted(h, p))) missing.push({ kind: 'permission', value: p });
  if (need.group) {
    if (lookupError) missing.push({ kind: 'lookup', value: `${need.group}: ${lookupError}` });
    else {
      const mine = (me?.groups || []).map(g => g.id);
      if (!(groupIds || []).some(id => mine.includes(id))) missing.push({ kind: 'group', value: need.group });
    }
  }
  const who = me?.email || me?.username || me?.name || me?.id || '?';
  return { ok: missing.length === 0, who, missing, checkedAt: now };
}

async function checkDeployRights(env) {
  const { token, apiBase } = await getToken(env);
  const H = { headers: { Authorization: `Bearer ${token}` } };
  const me = (await axios.get(`${apiBase}/api/v2/users/me`,
    { ...H, params: { expand: 'authorization,groups' } })).data;
  const need = deployRequirements(env);
  let groupIds = null, lookupError = null;
  if (need.group) {
    // Kan gruppen ikke slås op, er svaret nej. En vagt der lukker op når den
    // er i tvivl, er ingen vagt.
    try {
      const r = await axios.post(`${apiBase}/api/v2/groups/search`,
        { query: [{ type: 'EXACT', fields: ['name'], value: need.group }] }, H);
      groupIds = (r.data.results || []).map(g => g.id);
    } catch (e) { lookupError = describeApiError(e); }
  }
  return evaluateDeployRights(me, need, groupIds, Date.now(), lookupError);
}

const missingText = m => m.kind === 'permission' ? `rettigheden ${m.value}`
  : m.kind === 'group' ? `medlemskab af gruppen "${m.value}"`
  : `gruppeopslaget (${m.value})`;
const missingLog = m => m.kind === 'lookup' ? `group lookup failed (${m.value})` : `${m.kind} ${m.value}`;

// Returnerer null når skrivningen er tilladt, ellers { code, error }.
function prodWriteBlock(env, stored, now = Date.now()) {
  if (!env || isDemo(env) || stageOf(env) !== 'prod') return null;
  if (env.authType !== 'oauth')
    return { code: 'prod-oauth-required',
             error: `"${env.name}" er et prod-miljø med client credentials. Skrivning til prod kræver at du logger ind som dig selv — skift miljøet til OAuth (PKCE) under Kunder → ⚙ Indstillinger.` };
  if (!stored || now > stored.expiresAt || !stored.deploy)
    return { code: 'prod-login',
             error: `Log ind i "${env.name}" for at skrive til prod, og prøv igen.` };
  const d = stored.deploy;
  if (!d.ok)
    return { code: 'prod-rights',
             error: `${d.who} må ikke skrive til "${env.name}" — mangler ${d.missing.map(missingText).join(' og ')}.` };
  if (now - d.checkedAt > PROD_DEPLOY_WINDOW)
    return { code: 'prod-login',
             error: `Dit prod-login i "${env.name}" gælder ${PROD_DEPLOY_WINDOW / 60000} minutter og er udløbet. Log ind igen, og prøv igen.` };
  return null;
}

// Prod-vagtens egne indstillinger må ikke kunne slås fra af den den vogter.
// Uden dette kunne man sætte trinnet til "uat", skrive, og sætte det tilbage —
// eller fjerne gruppekravet. De felter der afgør OM og HVORDAN vagten gælder,
// kræver derfor samme login som en skrivning.
const PROD_GUARDED_FIELDS = ['stage', 'authType', 'clientId', 'region', 'deployPermission', 'deployGroup'];

function prodSettingsBlock(before, changed, stored, now = Date.now()) {
  if (!before || isDemo(before) || stageOf(before) !== 'prod') return null;
  if (!PROD_GUARDED_FIELDS.some(k => changed[k] !== undefined)) return null;
  // Et prod-miljø med client credentials kan ikke logge ind som en person.
  // Den eneste vej ud er at stramme: skifte til OAuth og blive i prod.
  if (before.authType !== 'oauth') {
    const efter = { ...before, ...changed };
    if (efter.authType === 'oauth' && stageOf(efter) === 'prod') return null;
    return { code: 'prod-oauth-required',
             error: `"${before.name}" er et prod-miljø med client credentials. Det eneste der kan ændres ved godkendelsen, er at skifte til OAuth (PKCE) — trinnet skal blive prod.` };
  }
  const b = prodWriteBlock(before, stored, now);
  if (!b) return null;
  return { ...b, error: `Trin, godkendelse og deploy-krav på et prod-miljø kan kun ændres af en der må deploye dertil. ${b.error}` };
}

function refuseProdWrite(res, env, what) {
  const blocked = prodWriteBlock(env, env && tokenStore[env.id]);
  if (!blocked) return false;
  addLog('WARN', `Write to prod blocked (${blocked.code}): ${what} → ${env.name}`, env.name, 'SECURITY');
  res.status(403).json({ ...blocked, envId: env.id, envName: env.name });
  return true;
}

// Registreres øverst i filen, før ruterne — se app.use(prodWriteGate).
function prodWriteGate(req, res, next) {
  const field = req.method === 'POST' && PROD_WRITE_ROUTES[req.path];
  if (!field) return next();
  const env = loadCustomers().find(c => c.id === req.body?.[field]);
  if (refuseProdWrite(res, env, req.path)) return;
  next();
}

// ── OAuth / PKCE endpoints ───────────────────────────────────────────────────

// Step 1: Generate PKCE challenge and return the Genesys authorization URL
app.get('/api/auth/login/:id', (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  if (customer.authType !== 'oauth') return res.status(400).json({ error: 'Not an OAuth customer' });

  const verifier   = base64url(crypto.randomBytes(32));
  const challenge  = base64url(crypto.createHash('sha256').update(verifier).digest());
  pkceStore[customer.id] = { verifier };

  const apiBase    = REGION_MAP[customer.region] || `https://api.${customer.region}`;
  const loginBase  = apiBase.replace('api.', 'login.');
  const redirectUri = OAUTH_REDIRECT_URI;
  const url = `${loginBase}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(customer.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&state=${encodeURIComponent(customer.id)}` +
    // Er man logget ind i flere orgs, genbrugte Genesys ellers den husket
    // session — og login til miljø nr. 2 landede stille i org nr. 1.
    // prompt=login beder altid om et nyt login; target peger på den org
    // miljøet er kendt i. Callback'en tjekker org'en uanset hvad.
    `&prompt=login` +
    (customer.orgId ? `&target=${encodeURIComponent(customer.orgId)}` : '');

  addLog('INFO', `PKCE login initiated for ${customer.name}`, customer.name, 'CUSTOMER');
  res.json({ url });
});

// Step 2: Genesys redirects here with ?code=...&state=...
// Backend exchanges code for token (PKCE — no client secret needed)
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  const page = (ok, heading, body) => res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Archy GUI — Login</title>
<style>
  body{font-family:sans-serif;background:#0d0f14;color:#e8eaf0;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;flex-direction:column;gap:0}
  .card{background:#131620;border:1px solid #1f2433;border-radius:10px;padding:36px 44px;
        text-align:center;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
  h2{color:${ok?'#2ecc71':'#e74c3c'};margin:0 0 10px;font-size:22px}
  p{color:#6b7394;font-size:14px;margin:0;line-height:1.5}
  .sub{font-size:11px;color:#3a4060;margin-top:14px}
</style></head><body>
<div class="card">
  <div style="font-size:40px;margin-bottom:14px">${ok?'✅':'❌'}</div>
  <h2>${heading}</h2>
  <p>${body}</p>
  <p class="sub">Dette vindue lukker automatisk…</p>
</div>
<script>setTimeout(()=>window.close(),2500)</script>
</body></html>`);

  if (error) return page(false, 'Login failed', String(error).replace(/</g,'&lt;'));
  if (!code || !state) return page(false, 'Invalid response', 'No code or state received.');

  const customer = loadCustomers().find(c => c.id === state);
  if (!customer) return page(false, 'Unknown customer', `State: ${state}`);

  const pkce = pkceStore[state];
  if (!pkce) return page(false, 'Session expired', 'Please start the login again from Archy GUI.');
  delete pkceStore[state];

  const apiBase    = REGION_MAP[customer.region] || `https://api.${customer.region}`;
  const loginBase  = apiBase.replace('api.', 'login.');
  const redirectUri = OAUTH_REDIRECT_URI;

  try {
    const resp = await axios.post(
      `${loginBase}/oauth/token`,
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        code_verifier: pkce.verifier,
        client_id:     customer.clientId,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token, expires_in } = resp.data;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

    // Hvilken org landede login'et i? Det vælger brugeren på Genesys' side, og
    // med trusted orgs kan det være en kundes. Tokenet gemmes først når org'en
    // passer — ellers ville miljøet læse og skrive i den forkerte org.
    const me = await axios.get(`${apiBase}/api/v2/users/me`,
      { headers: { Authorization: `Bearer ${access_token}` }, params: { expand: 'organization' } });
    const org = me.data.organization || {};
    if (!org.id) throw new Error('Genesys did not say which org the login belongs to');
    if (wrongOrg(customer, org.id)) {
      delete tokenStore[customer.id];
      delete _whoCache[customer.id];
      addLog('ERROR', `PKCE login for ${customer.name} refused: ${me.data.name} logged into org "${org.name}" (${org.id}), ` +
        `but the environment belongs to org ${customer.orgId}`, customer.name, 'SECURITY');
      return page(false, 'Wrong organisation',
        `You logged into <b>${esc(org.name || org.id)}</b>, but <b>${esc(customer.name)}</b> belongs to another org ` +
        `(${esc(customer.orgId)}). The login was discarded — nothing was read or written.<br><br>` +
        `Log out of Genesys Cloud (or use a private window) and log in again, choosing the right organisation.`);
    }
    const owner = orgOwnedElsewhere(customer, org.id, loadCustomers());
    if (owner) {
      delete tokenStore[customer.id];
      delete _whoCache[customer.id];
      addLog('ERROR', `PKCE login for ${customer.name} refused: org "${org.name}" (${org.id}) belongs to ${owner.name} ` +
        `(tenant ${tenantOf(owner)}), not tenant ${tenantOf(customer)}`, customer.name, 'SECURITY');
      return page(false, 'Wrong organisation',
        `You logged into <b>${esc(org.name || org.id)}</b>, which is the org of <b>${esc(owner.name)}</b> ` +
        `— another customer than <b>${esc(customer.name)}</b>. The login was discarded — nothing was read or written.<br><br>` +
        `Log in again and choose the right organisation.`);
    }

    const expiresAt = Date.now() + ((expires_in || 86400) * 1000) - 60000;
    tokenStore[customer.id] = { token: access_token, expiresAt, orgId: org.id, orgName: org.name || '', loginAt: Date.now() };
    delete _whoCache[customer.id];
    // Manifest-tabellens id er slået op med det forrige login — måske i en anden org.
    delete _mfTableCache[customer.id];
    orgIdCache[customer.id] = org.id;
    rememberOrgId(customer, org.id);
    addLog('SUCCESS', `PKCE OAuth login succeeded for ${customer.name}: ${me.data.name} in org "${org.name}"`, customer.name, 'CUSTOMER');

    // I prod afgøres deploy-retten her, ved login — og kun her, så den altid
    // hviler på et frisk login og ikke på et døgngammelt token.
    let extra = '';
    if (stageOf(customer) === 'prod' && !isDemo(customer)) {
      let d;
      try { d = await checkDeployRights(customer); }
      catch (e) { d = { ok: false, who: '?', missing: [{ kind: 'lookup', value: describeApiError(e) }], checkedAt: Date.now() }; }
      tokenStore[customer.id].deploy = d;
      scheduleSessionSave();
      addLog(d.ok ? 'SUCCESS' : 'WARN',
        `Prod deploy rights for ${customer.name}: ${d.who} ${d.ok ? 'allowed' : 'denied — missing ' + d.missing.map(missingLog).join(', ')}`,
        customer.name, 'SECURITY');
      extra = d.ok
        ? `<br><br>🔓 ${esc(d.who)} may deploy to prod for ${PROD_DEPLOY_WINDOW / 60000} minutes.`
        : `<br><br>⛔ ${esc(d.who)} may NOT deploy to prod — missing ${esc(d.missing.map(missingLog).join(', '))}.`;
    }
    page(true, 'Logged in!', `Organisation: <b>${esc(org.name || org.id)}</b><br>` +
      'You can close this window and return to Archy GUI.' + extra);
  } catch (e) {
    const msg = e.response?.data?.description || e.response?.data?.error || e.message;
    addLog('ERROR', `PKCE token exchange failed for ${customer.name}: ${msg}`, customer.name, 'CUSTOMER');
    page(false, 'Token exchange failed', String(msg).replace(/</g,'&lt;'));
  }
});

// Status for alle OAuth-miljøer i ét kald. Sidebjælken og kundekortene skal
// vise hvem man er logget ind i, og med 200 kunder er ét kald pr. miljø for
// meget.
app.get('/api/auth/status', (req, res) => {
  const now = Date.now();
  const out = {};
  for (const c of loadCustomers()) {
    if (c.authType !== 'oauth') continue;
    const st = tokenStore[c.id];
    if (!st || now > st.expiresAt) { out[c.id] = { authenticated: false }; continue; }
    const o = { authenticated: true, expiresIn: Math.floor((st.expiresAt - now) / 1000), orgName: st.orgName || '' };
    if (stageOf(c) === 'prod' && st.deploy)
      o.deploy = { ok: st.deploy.ok, who: st.deploy.who, missing: st.deploy.missing,
                   expiresIn: Math.max(0, Math.floor((st.deploy.checkedAt + PROD_DEPLOY_WINDOW - now) / 1000)) };
    out[c.id] = o;
  }
  res.json(out);
});

// Token status check
app.get('/api/auth/status/:id', (req, res) => {
  const stored = tokenStore[req.params.id];
  if (!stored) return res.json({ authenticated: false });
  if (Date.now() > stored.expiresAt) {
    delete tokenStore[req.params.id];
    return res.json({ authenticated: false, expired: true });
  }
  const out = { authenticated: true, expiresIn: Math.floor((stored.expiresAt - Date.now()) / 1000), orgName: stored.orgName || '' };
  const env = loadCustomers().find(c => c.id === req.params.id);
  if (env && stageOf(env) === 'prod' && !isDemo(env) && stored.deploy) {
    const d = stored.deploy;
    out.deploy = { ok: d.ok, who: d.who, missing: d.missing,
                   expiresIn: Math.max(0, Math.floor((d.checkedAt + PROD_DEPLOY_WINDOW - Date.now()) / 1000)) };
  }
  res.json(out);
});

// ── Token helper ────────────────────────────────────────────────────────────

// Det eneste sted et PKCE-token hentes fra — både API-kald og Archy går herigennem.
// Archy fik før tokenet direkte fra tokenStore, uden om org-tjekket.
function oauthToken(customer) {
  const stored = tokenStore[customer.id];
  if (!stored) throw new Error(`OAuth token missing for "${customer.name}" — click the Login button`);
  if (Date.now() > stored.expiresAt) {
    delete tokenStore[customer.id];
    throw new Error(`OAuth token expired for "${customer.name}" — please log in again`);
  }
  // Anden linje i forsvaret: login'et tjekkes ved callback, men miljøets
  // org-id kan være rettet siden. Et token uden kendt org, eller fra en anden
  // org, bruges aldrig.
  if (!stored.orgId || wrongOrg(customer, stored.orgId)) {
    delete tokenStore[customer.id];
    throw new Error(`The login for "${customer.name}" belongs to another org — please log in again`);
  }
  return stored.token;
}

async function getToken(customer) {
  // Et demo-miljø har ingen org. Uden denne vagt endte hvert eneste opslag
  // som "getaddrinfo ENOTFOUND login.demo" — en netværksfejl der intet
  // fortalte om hvorfor. Nu siger den hvad der faktisk er på færde.
  // Det demoen KAN, har sine egne veje; alt andet lander her.
  if (isDemo(customer))
    throw new Error(`"${customer.name}" is a demo environment — it exists only locally, ` +
                    `so this function has no org to ask. Use the Pipeline page to try promotions.`);

  const apiBase = REGION_MAP[customer.region] || `https://api.${customer.region}`;

  // OAuth (PKCE) customers — use stored token
  if (customer.authType === 'oauth') {
    const stored = tokenStore[customer.id];
    if (!stored) throw new Error(`OAuth token missing for "${customer.name}" — click the Login button`);
    if (Date.now() > stored.expiresAt) {
      delete tokenStore[customer.id];
      throw new Error(`OAuth token expired for "${customer.name}" — please log in again`);
    }
    // Anden linje i forsvaret: login'et tjekkes ved callback, men miljøets
    // org-id kan være rettet siden. Et token fra en anden org bruges aldrig.
    if (!stored.orgId || wrongOrg(customer, stored.orgId)) {
      delete tokenStore[customer.id];
      throw new Error(`The login for "${customer.name}" belongs to another org — please log in again`);
    }
    return { token: stored.token, apiBase };
  }

  // Client credentials fallback
  const loginBase = apiBase.replace('api.', 'login.');
  const resp = await axios.post(
    `${loginBase}/oauth/token`,
    'grant_type=client_credentials',
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth: { username: customer.clientId, password: customer.clientSecret }
    }
  );
  return { token: resp.data.access_token, apiBase };
}

app.post('/api/customers/:id/test', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  addLog('INFO', `Testing connection to ${customer.name} (${customer.region})`, customer.name, 'TEST');

  // Der er ingen forbindelse at afprøve til et demo-miljø — det ligger her på
  // maskinen. Det svarer vi ærligt frem for at melde en forbindelsesfejl.
  if (isDemo(customer)) {
    const antal = demoFlowsFor(customer).length;
    return res.json({ ok: true, demo: true, name: customer.name, orgName: 'demo (lokal)',
                      archyReady: true, archyFlowReady: true,
                      note: `Demo-miljø — ingen forbindelse nødvendig. ${antal} flows lokalt.` });
  }

  try {
    const { token, apiBase } = await getToken(customer);
    // /users/me requires a user-context token (PKCE). For Client Credentials we
    // use /organizations/me instead, which works with any token type.
    let name, orgName, archyReady = true, archyFlowReady = true;

    if (customer.authType === 'oauth') {
      const me = await axios.get(`${apiBase}/api/v2/users/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      name    = me.data.name;
      orgName = me.data.organization?.name || tokenStore[customer.id]?.orgName || '?';
    } else {
      const org = await axios.get(`${apiBase}/api/v2/organizations/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      orgName = org.data.name || '?';
      name    = '(Client Credentials)';
    }

    // Rettighederne holdes op mod hver funktion. Kan rollerne ikke læses,
    // prøves læsningen af, og det der ikke kan prøves, meldes som ukendt.
    const held = await heldPermissions(customer, token, apiBase);
    const checks = held ? evaluatePermissions(held, customer.authType)
                        : await probePermissions(customer, token, apiBase);
    const source = customer.authType === 'oauth' ? 'user' : held ? 'roles' : 'probe';
    const missing = checks.filter(c => !c.ok && !c.unknown);
    const unknown = checks.filter(c => c.unknown);
    archyReady     = !missing.some(c => c.area === 'archy_client');
    archyFlowReady = !missing.some(c => c.area === 'flows_read');

    addLog(
      missing.length ? 'WARN' : 'SUCCESS',
      `Connected to ${customer.name} — ${customer.authType === 'oauth' ? `user: ${name}, ` : ''}org: ${orgName}` +
      (missing.length ? ` ⚠ missing ${missing.flatMap(c => c.missing).join(', ')}` : ', all permissions present') +
      (unknown.length ? ` (not verifiable: ${unknown.map(c => c.area).join(', ')})` : ''),
      customer.name, 'TEST'
    );
    res.json({ ok: true, name, org: orgName, archyReady, archyFlowReady, checks, source });
  } catch (e) {
    const errMsg = describeApiError(e);
    addLog('ERROR', `Connection error for ${customer.name}: ${errMsg}`, customer.name, 'TEST');
    res.status(401).json({ error: errMsg });
  }
});

// ── Org Resources (datatables, queues, users) ────────────────────────────────

app.get('/api/customers/:id/datatables', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    let all = [], page = 1;
    while (true) {
      const r = await axios.get(`${apiBase}/api/v2/flows/datatables`, {
        headers: { Authorization: `Bearer ${token}` },
        // expand=schema virker også på listen, så kolonnerne kan vises uden
        // et opslag pr. tabel
        params: { pageSize: 200, pageNumber: page, sortBy: 'name', sortOrder: 'ASC', expand: 'schema' }
      });
      all = all.concat(r.data.entities || []);
      if (all.length >= (r.data.total || 0) || !(r.data.entities || []).length) break;
      page++;
    }
    res.json(all.map(t => ({
      id: t.id,
      name: t.name,
      division: t.division?.name || '',
      columns: Object.keys(t.schema?.properties || {})
    })));
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.get('/api/customers/:id/queues', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const search = (req.query.name || '').trim();
  try {
    const { token, apiBase } = await getToken(customer);
    const r = await axios.get(`${apiBase}/api/v2/routing/queues`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 100, pageNumber: 1, sortBy: 'name', sortOrder: 'ASC',
                ...(search ? { name: `*${search}*` } : {}) }
    });
    res.json((r.data.entities || []).map(q => ({ id: q.id, name: q.name })));
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.get('/api/customers/:id/users', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const search = (req.query.name || '').trim();
  try {
    const { token, apiBase } = await getToken(customer);
    const r = await axios.get(`${apiBase}/api/v2/users`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 100, pageNumber: 1, sortBy: 'name', sortOrder: 'ASC',
                ...(search ? { name: `*${search}*` } : {}) }
    });
    res.json((r.data.entities || []).map(u => ({ id: u.id, name: u.name })));
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.get('/api/customers/:id/groups', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const search = (req.query.name || '').trim();
  try {
    const { token, apiBase } = await getToken(customer);
    const r = await axios.get(`${apiBase}/api/v2/groups`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 100, pageNumber: 1, sortOrder: 'ASC',
                ...(search ? { name: `*${search}*` } : {}) }
    });
    res.json((r.data.entities || []).map(g => ({ id: g.id, name: g.name })));
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.get('/api/customers/:id/prompts', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const search = (req.query.name || '').trim();
  try {
    const { token, apiBase } = await getToken(customer);
    const H = { headers: { Authorization: `Bearer ${token}` } };
    // Uden paginering afkortede den stille ved 50 — org'en kan have flere.
    let all = [], page = 1;
    while (true) {
      const r = await axios.get(`${apiBase}/api/v2/architect/prompts`, {
        ...H,
        params: { pageSize: 100, pageNumber: page, sortBy: 'name', sortOrder: 'ASC',
                  ...(search ? { name: `*${search}*` } : {}) }
      });
      const e = r.data.entities || [];
      all = all.concat(e);
      if (e.length < 100) break;
      page++;
    }
    res.json(all.map(p => ({
      id: p.id, name: p.name, description: p.description || '',
      languages: (p.resources || []).map(r => r.language),
      // Ressourcer med indtalt lyd kræver at selve WAV-filen flyttes med
      withAudio: (p.resources || []).filter(r => r.mediaUri).length,
      resourceCount: (p.resources || []).length
    })));
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// ── List Flows ───────────────────────────────────────────────────────────────

const FLOW_TYPES = ['inboundcall', 'outboundcall', 'inboundshortmessage', 'inboundemail',
                    'workflow', 'digitalbot', 'bot'];

app.get('/api/customers/:id/flows', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const nameFilter = (req.query.name || '').trim();
  const typeFilter = (req.query.type || '').trim();
  addLog('INFO', `Fetching flows for ${customer.name}`, customer.name, 'FLOWS');

  // Demo-miljøer har ingen org at spørge. Flowlisten er kernen i både Flow
  // Browser, Migrer Flow og Export, så den skal virke i demoen — resten af
  // opslagene findes ikke og siger det.
  if (isDemo(customer)) {
    const soeskende = loadCustomers().filter(x => orgKeyOf(x) === orgKeyOf(customer));
    const flows = demoFlowsFor(customer)
      .filter(f => belongsToEnv(f.name, customer, soeskende))
      .filter(f => !nameFilter || f.name.toLowerCase().includes(nameFilter.toLowerCase()))
      .filter(f => !typeFilter || String(f.type).toLowerCase() === typeFilter.toLowerCase())
      .map(f => ({
        id: `${customer.id}:${f.name}`, name: f.name, type: f.type,
        publishedVersion: f.published || null,
        savedVersion: f.published || null,
        checkedOut: false, active: !!f.published
      }));
    return res.json(flows);
  }

  try {
    const { token, apiBase } = await getToken(customer);
    // Deler flere miljøer org'en, skal hvert kun se sine egne flows — ellers
    // viste DEV også prod's, og Export tilbød at eksportere dem.
    await getOrgId(customer);
    const soeskende = loadCustomers().filter(x => orgKeyOf(x) === orgKeyOf(customer));
    const mine = f => belongsToEnv(f.name, customer, soeskende);
    // When name filter is given, do a single-page search instead of full pagination
    if (nameFilter) {
      const resp = await axios.get(`${apiBase}/api/v2/flows`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 50, pageNumber: 1, includeDraft: true, name: `*${nameFilter}*`,
                  ...(typeFilter ? { type: typeFilter } : {}) }
      });
      const flows = (resp.data.entities || []).filter(mine).map(f => ({
        id: f.id, name: f.name, type: f.type,
        publishedVersion: f.publishedVersion?.name || f.publishedVersion?.commitVersion || null,
        publishedAt: f.publishedVersion?.datePublished || null,
        savedVersion: f.checkedInVersion?.name || f.checkedInVersion?.commitVersion || null,
        // savedVersion findes kun mens et flow er tjekket ud, og dens name er et
        // GUID — ikke et versionsnummer. Vi melder det som udtjekket i stedet.
        checkedOut: !!f.lockedUser || (!!f.savedVersion && !f.checkedInVersion),
        active: !!f.publishedVersion
      }));
      return res.json(flows);
    }
    let allFlows = [];
    let page = 1;
    while (true) {
      const resp = await axios.get(`${apiBase}/api/v2/flows`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 100, pageNumber: page, includeDraft: true }
      });
      const flows = resp.data.entities || [];
      allFlows = allFlows.concat(flows.filter(mine).map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        publishedVersion: f.publishedVersion?.name || f.publishedVersion?.commitVersion || null,
        publishedAt: f.publishedVersion?.datePublished || null,
        savedVersion: f.checkedInVersion?.name || f.checkedInVersion?.commitVersion || null,
        // savedVersion findes kun mens et flow er tjekket ud, og dens name er et
        // GUID — ikke et versionsnummer. Vi melder det som udtjekket i stedet.
        checkedOut: !!f.lockedUser || (!!f.savedVersion && !f.checkedInVersion),
        active: !!f.publishedVersion
      })));
      if (flows.length < 100) break;
      page++;
    }
    addLog('SUCCESS', `Fetched ${allFlows.length} flows for ${customer.name}`, customer.name, 'FLOWS');
    res.json(allFlows);
  } catch (e) {
    const errMsg = e.response?.data?.message || e.message;
    addLog('ERROR', `Flows error for ${customer.name}: ${errMsg}`, customer.name, 'FLOWS');
    res.status(500).json({ error: errMsg });
  }
});

app.get('/api/customers/:id/datatables/:tableId', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    // expand=schema er påkrævet — uden den følger 'schema' slet ikke med,
    // og alt herunder faldt tilbage til et tomt objekt.
    const r = await axios.get(`${apiBase}/api/v2/flows/datatables/${req.params.tableId}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { expand: 'schema' }
    });
    const schema = r.data.schema || {};
    const props = schema.properties || {};
    const keyField = props.key || {};
    const keyTitle = keyField.title || 'key';
    const nonKeyFields = Object.entries(props).filter(([k]) => k !== 'key');
    // Genesys Cloud JSON-style data tables always have a column named exactly 'Value'.
    // Any extra schema fields alongside 'Value' (e.g. internal fields) are not valid
    // foundOutputs in Architect — treat the table as JSON regardless of extra columns.
    const hasValueColumn = nonKeyFields.some(([name]) => name === 'Value' || name === 'value');
    const isJsonTable = hasValueColumn || nonKeyFields.length === 1;
    // For JSON tables, columns are empty — 'Value:' is emitted automatically in the YAML.
    // For regular multi-column tables, expose every non-key column for field mapping.
    const columns = isJsonTable
      ? []
      : nonKeyFields.map(([name, def]) => ({
          name, type: def.type || 'string', title: def.title || name
        }));
    res.json({ keyTitle, isJsonTable, columns });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.get('/api/customers/:id/actions', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    const H = { headers: { Authorization: `Bearer ${token}` } };

    // Slå integrationerne op først, så hver action kan få sin RIGTIGE
    // integration med. En org kan have flere data-action-integrationer af
    // samme type (fx fire OAuth'er der grupperer belastningen), og de kan
    // ikke skelnes på kategori alene.
    const ints = {};
    let ip = 1;
    while (true) {
      const r = await axios.get(`${apiBase}/api/v2/integrations`, {
        ...H, params: { pageSize: 100, pageNumber: ip }
      });
      const entities = r.data.entities || [];
      for (const i of entities) ints[i.id] = { name: i.name, type: i.integrationType?.id || '' };
      if (entities.length < 100) break;
      ip++;
    }

    // Paginate to load all actions (most orgs have <500)
    let all = [], page = 1;
    while (true) {
      const r = await axios.get(`${apiBase}/api/v2/integrations/actions`, {
        ...H, params: { pageSize: 100, pageNumber: page, sortBy: 'name', sortOrder: 'ASC' }
      });
      const entities = r.data.entities || [];
      all = all.concat(entities.map(a => {
        // integrationId ligger FLADT på action-objektet — ikke under .integration.
        // Den tidligere a.integration?.name ramte derfor aldrig og faldt altid
        // tilbage til kategorien, så to integrationer med samme kategorinavn
        // var umulige at skelne.
        const i = ints[a.integrationId] || {};
        return {
          id: a.id, name: a.name, category: a.category,
          integrationId:   a.integrationId || '',
          integrationName: i.name || a.category || '',
          integrationType: i.type || ''
        };
      }));
      if (entities.length < 100) break;
      page++;
    }
    res.json(all);
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.get('/api/customers/:id/actions/:actionId/schema', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    // Use expand=contract — far more reliable than the separate /schemas/input|output endpoints
    // which return 404 for many standard Genesys Cloud Data Actions.
    const r = await axios.get(
      `${apiBase}/api/v2/integrations/actions/${req.params.actionId}`,
      { headers: { Authorization: `Bearer ${token}` }, params: { expand: 'contract' } }
    );
    const action = r.data;
    const inSchema  = action.contract?.input?.inputSchema  || {};
    const outSchema = action.contract?.output?.successSchema || {};
    const mapProps = (schema) => {
      const props    = schema?.properties || {};
      const required = schema?.required   || [];
      return Object.entries(props).map(([name, def]) => ({
        name, type: def.type || 'string',
        required: required.includes(name),
        description: def.description || ''
      }));
    };
    res.json({ inputs: mapProps(inSchema), outputs: mapProps(outSchema) });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── Data Action migration ─────────────────────────────────────────────────────
// Export full action definition (config + contract) from a source org.
// Expand=both gives us the config template and the contract in one call.

app.get('/api/customers/:id/actions/:actionId/full', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    const r = await axios.get(
      `${apiBase}/api/v2/integrations/actions/${req.params.actionId}`,
      { headers: { Authorization: `Bearer ${token}` },
        params: { expand: 'contract', includeConfig: true } }
    );
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// List integrations in an org (to find the correct integration to attach to)
app.get('/api/customers/:id/integrations', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    let all = [], page = 1;
    while (true) {
      const r = await axios.get(`${apiBase}/api/v2/integrations`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 100, pageNumber: page }
      });
      const entities = r.data.entities || [];
      all = all.concat(entities.map(i => ({
        id: i.id,
        name: i.name,
        integrationType: i.integrationType?.id || ''
      })));
      if (entities.length < 100) break;
      page++;
    }
    res.json(all);
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// Lokal backup af de valgte data actions eller datatabeller i en org — kun
// læsning, så ingen rettighedsvagt. Actions hentes komplet (contract + config,
// og draft hvis der er en); tabeller med hele schemaet, men uden rækker.
app.get('/api/customers/:id/backup', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const kind = req.query.kind;
  const ids  = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!['actions', 'datatables'].includes(kind) || !ids.length)
    return res.status(400).json({ error: 'kind (actions|datatables) and ids are required' });
  try {
    const { token, apiBase } = await getToken(customer);
    const H = { Authorization: `Bearer ${token}` };
    const items = [];
    for (const id of ids) {
      if (kind === 'datatables') {
        const r = await axios.get(`${apiBase}/api/v2/flows/datatables/${encodeURIComponent(id)}`,
          { headers: H, params: { expand: 'schema' } });
        items.push(r.data);
        continue;
      }
      const base = `${apiBase}/api/v2/integrations/actions/${encodeURIComponent(id)}`;
      const params = { expand: 'contract', includeConfig: true };
      const published = (await axios.get(base, { headers: H, params })).data;
      let draft = null;
      try { draft = (await axios.get(`${base}/draft`, { headers: H, params })).data; }
      catch (e) { if (e.response?.status !== 404) throw e; }
      items.push(draft ? { ...published, draft } : published);
    }
    addLog('INFO', `Backup of ${items.length} ${kind === 'actions' ? 'data action(s)' : 'data table structure(s)'} downloaded`, customer.name, 'MIGRATE');
    res.json({
      archyBackup: 1,
      kind,
      org: customer.name,
      exportedAt: new Date().toISOString(),
      note: kind === 'datatables' ? 'Structure only — rows are not included.' : undefined,
      items
    });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Kategorien en migreret action oprettes med: målintegrationens navn. Kan det
// ikke læses, beholdes kildens — som før.
function actionCategoryFor(sourceCategory, targetIntegrationName) {
  return String(targetIntegrationName || '').trim() || sourceCategory;
}

// Migrate a Data Action from source org to target org
app.post('/api/actions/migrate', async (req, res) => {
  const { sourceId, targetId, actionId, targetIntegrationId } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);

    // 1. Fetch published action. includeConfig=true er påkrævet for at få
    // 'config' med — den følger IKKE med via expand, uanset værdi.
    const publishedRes = await axios.get(
      `${srcBase}/api/v2/integrations/actions/${actionId}`,
      { headers: { Authorization: `Bearer ${srcToken}` },
        params: { expand: 'contract', includeConfig: true } }
    );
    const published = publishedRes.data;

    // 2. Fetch draft hvis der er en — en action uden ventende ændringer har
    // ingen draft og svarer 404. Det er normalt, ikke en fejl.
    let draft = null;
    try {
      const draftRes = await axios.get(
        `${srcBase}/api/v2/integrations/actions/${actionId}/draft`,
        { headers: { Authorization: `Bearer ${srcToken}` },
          params: { expand: 'contract', includeConfig: true } }
      );
      draft = draftRes.data;
    } catch (e) {
      if (e.response?.status !== 404) {
        addLog('WARN', `Draft not available for "${published.name}": ${describeApiError(e)}`, source.name, 'MIGRATE');
      }
    }

    // Use draft if available (more complete), fallback to published
    const source_data = draft || published;

    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);

    // 3. Resolve integration in target org
    let integrationId = targetIntegrationId;
    let integrationName = '';
    if (integrationId) {
      // Kategorien skal være målintegrationens navn, så vi skal bruge navnet.
      try {
        const ir = await axios.get(`${tgtBase}/api/v2/integrations/${encodeURIComponent(integrationId)}`,
          { headers: { Authorization: `Bearer ${tgtToken}` } });
        integrationName = ir.data.name || '';
      } catch (e) {
        addLog('WARN', `Could not read the target integration ${integrationId}: ${describeApiError(e)} — keeping the source category`, target.name, 'MIGRATE');
      }
    }
    if (!integrationId) {
      const srcIntName = published.integration?.name || '';
      const intRes = await axios.get(`${tgtBase}/api/v2/integrations`, {
        headers: { Authorization: `Bearer ${tgtToken}` },
        params: { pageSize: 200 }
      });
      const entities = intRes.data.entities || [];
      const srcType  = published.integration?.integrationType?.id || '';

      // Navnematch skal have forrang. Én .find() med OR ville vælge den første
      // data-actions-integration i listen, også selv om der længere nede lå en
      // med præcis samme navn som kildens.
      const match = entities.find(i => i.name === srcIntName)
                 || (srcType && entities.find(i => i.integrationType?.id === srcType))
                 || entities.find(i => (i.integrationType?.id || '').includes('data-actions'));

      if (!match) {
        return res.status(400).json({
          error: `Ingen passende integration fundet i ${target.name}. Vælg mål-integration manuelt.`,
          needsIntegration: true
        });
      }

      // Gør det synligt i loggen når vi ikke ramte kildens integration præcist
      if (match.name !== srcIntName) {
        addLog('WARN',
          `No integration named "${srcIntName}" in ${target.name}; using "${match.name}". ` +
          `Pick the target integration by hand if the migration fails.`,
          source.name, 'MIGRATE');
      }
      integrationId = match.id;
      integrationName = match.name || '';
    }

    // 4. Create new action shell in target
    const srcContract = source_data.contract || published.contract || {};
    const contract = {
      input:  stripSchemaUris(srcContract.input)  || { inputSchema:   { type: 'object', properties: {} } },
      output: stripSchemaUris(srcContract.output) || { successSchema: { type: 'object', properties: {} } }
    };

    // POST /integrations/actions kræver 'config' — uden den svarer Genesys
    // 400 "Missing element 'config'".
    const srcConfig = source_data.config || published.config || {};
    const { config, warnings: tplWarnings } =
      await inlineActionTemplates(srcConfig, srcBase, srcToken);
    for (const w of tplWarnings) addLog('WARN', `"${published.name}": ${w}`, source.name, 'MIGRATE');

    // requestType og requestUrlTemplate er påkrævede af API'et
    if (!config.request.requestType)        config.request.requestType        = 'GET';
    if (!config.request.requestUrlTemplate) config.request.requestUrlTemplate = '';

    // En actions kategori er integrationens navn: det er den et flow slår den
    // op på. Beholdt vi kildens kategori, kunne en action i en integration der
    // hedder noget andet i målet blive stående under et navn flowet ikke finder.
    const category = actionCategoryFor(published.category, integrationName);
    if (category !== published.category)
      addLog('INFO', `Category of "${published.name}": "${published.category}" → "${category}" (the target integration's name)`, source.name, 'MIGRATE');

    const createRes = await axios.post(
      `${tgtBase}/api/v2/integrations/actions`,
      {
        name:         published.name,
        category,
        integrationId,
        contract,
        config
      },
      { headers: { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' } }
    );
    const newAction = createRes.data;
    addLog('INFO', `Created "${newAction.name}" (${newAction.id}) in ${target.name} — version ${newAction.version}`, source.name, 'MIGRATE');

    // POST /integrations/actions opretter actionen komplet og publiceret
    // (version 1) med contract, config og templates. Der er derfor hverken en
    // draft at opdatere eller noget at publicere bagefter — tidligere forsøgte
    // vi PUT .../draft (som API'et slet ikke understøtter → 405) og
    // POST .../draft/publish (404, da der ingen draft er), hvilket fik en
    // fuldt lykkedes migrering til at fremstå som en fejl.

    addLog('SUCCESS', `Data Action "${published.name}" migrated to ${target.name}`, source.name, 'MIGRATE');
    res.json({ ok: true, newActionId: newAction.id, name: published.name });

  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Data Action migration failed: ${msg}`, source.name, 'MIGRATE');
    if (e.response?.status === 409 || msg.toLowerCase().includes('already exist')) {
      return res.status(409).json({ error: 'already_exists', message: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// Genesys afviser ved oprettelse en minimum/maximum uden for talområdet
// (±9.99…e37), men kan godt returnere sådanne grænser fra en eksisterende
// tabel. Grænser uden for området — og ikke-endelige tal — fjernes, så de
// ikke stopper migreringen; det betyder "ingen grænse" alligevel.
const SCHEMA_LIMIT = 9.99e37;
function sanitizeDatatableSchema(schema) {
  const props = {};
  for (const [navn, def] of Object.entries(schema?.properties || {})) {
    const d = { ...def };
    for (const k of ['minimum', 'maximum']) {
      if (k in d && !(typeof d[k] === 'number' && Math.abs(d[k]) <= SCHEMA_LIMIT)) delete d[k];
    }
    props[navn] = d;
  }
  return { ...schema, properties: props };
}

// Migrate a DataTable's STRUCTURE (schema) from source org to target org.
// Rækkerne migreres bevidst ikke — kun tabeldefinitionen.
app.post('/api/datatables/migrate', async (req, res) => {
  const { sourceId, targetId, tableId } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);

    // 1. Hent tabellen med schema — uden expand følger schemaet ikke med
    const srcRes = await axios.get(`${srcBase}/api/v2/flows/datatables/${tableId}`, {
      headers: { Authorization: `Bearer ${srcToken}` },
      params: { expand: 'schema' }
    });
    const src = srcRes.data;
    if (!src.schema) return res.status(400).json({ error: `Kunne ikke hente schema for "${src.name}"` });

    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const tgtHeaders = { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' };

    // 2. Findes tabellen allerede i målet? Navnet er unikt pr. org.
    const existing = await axios.get(`${tgtBase}/api/v2/flows/datatables`, {
      headers: { Authorization: `Bearer ${tgtToken}` },
      params: { pageSize: 200, pageNumber: 1 }
    });
    // Datatabellerne følger samme præfiks-konvention som flowene. Uden det
    // ville en tabel fra prod lande i DEV_-miljøet under prod-navnet — og bor
    // de to i samme org, er det den samme tabel.
    const tgtName = withEnvPrefix(stripEnvPrefix(src.name, source), target);
    if ((existing.data.entities || []).some(t => t.name === tgtName)) {
      return res.status(409).json({ error: 'already_exists', message: `DataTable "${tgtName}" findes allerede` });
    }

    // 3. Match division på navn. Findes den ikke, oprettes tabellen i orgens
    // standarddivision — det er bedre end at fejle, men skal siges højt.
    // Divisionen følger MILJØET, ikke kildetabellen. Er der sat en division på
    // målmiljøet, er det den der gælder; ellers falder vi tilbage på kildens
    // navn, så opførslen er uændret for de miljøer der ikke har sat noget.
    const oensketDivision = String(target.division || '').trim() || src.division?.name || null;
    let divisionId = null, divisionNote = null;
    if (oensketDivision) {
      try {
        const dv = await axios.get(`${tgtBase}/api/v2/authorization/divisions`, {
          headers: { Authorization: `Bearer ${tgtToken}` },
          params: { pageSize: 200 }
        });
        const match = (dv.data.entities || []).find(d => d.name === oensketDivision);
        if (match) divisionId = match.id;
        else divisionNote = `Division "${oensketDivision}" findes ikke i ${target.name} — tabellen oprettes i standarddivisionen`;
      } catch (e) {
        divisionNote = `Kunne ikke slå divisioner op: ${describeApiError(e)}`;
      }
    }

    // 4. Byg schemaet. datatableId peger på KILDENS tabel og skal væk —
    // ellers bærer den nye tabel en reference til en anden org.
    const schema = sanitizeDatatableSchema(src.schema);
    delete schema.datatableId;
    schema.title = tgtName;

    const body = { name: tgtName, schema };
    if (src.description) body.description = src.description;
    if (divisionId) body.division = { id: divisionId };

    const created = await axios.post(`${tgtBase}/api/v2/flows/datatables`, body, { headers: tgtHeaders });

    if (divisionNote) addLog('WARN', `"${src.name}": ${divisionNote}`, source.name, 'MIGRATE');
    addLog('SUCCESS', `DataTable "${src.name}" migrated to ${target.name} (${Object.keys(schema.properties || {}).length} columns)`, source.name, 'MIGRATE');

    res.json({ ok: true, newTableId: created.data.id, name: src.name, divisionNote });

  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `DataTable migration failed: ${msg}`, source.name, 'MIGRATE');
    if (e.response?.status === 409 || /already exist/i.test(msg)) {
      return res.status(409).json({ error: 'already_exists', message: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// ── Wrap-up-koder ────────────────────────────────────────────────────────────
async function listWrapupCodes(base, token) {
  let all = [], page = 1;
  while (true) {
    const r = await axios.get(`${base}/api/v2/routing/wrapupcodes`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 200, pageNumber: page, sortBy: 'name' }
    });
    const ents = r.data.entities || [];
    all = all.concat(ents);
    if (!ents.length || page >= (r.data.pageCount || 1)) break;
    page++;
  }
  return all;
}

app.get('/api/customers/:id/wrapupcodes', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    const all = await listWrapupCodes(apiBase, token);
    res.json(all.map(w => ({ id: w.id, name: w.name, division: w.division?.name || '' })));
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Migrerer de valgte wrap-up-koder med navn og division. Navnet er unikt pr.
// org, så en kode der findes i målet springes over.
app.post('/api/wrapupcodes/migrate', async (req, res) => {
  const { sourceId, targetId, codeIds } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(codeIds) || !codeIds.length) return res.status(400).json({ error: 'Ingen koder valgt' });
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const srcAll = await listWrapupCodes(srcBase, srcToken);
    const tgtAll = await listWrapupCodes(tgtBase, tgtToken);
    const tgtNames = new Set(tgtAll.map(w => String(w.name).toLowerCase()));
    const divisions = new Map();
    try {
      const dv = await axios.get(`${tgtBase}/api/v2/authorization/divisions`, {
        headers: { Authorization: `Bearer ${tgtToken}` }, params: { pageSize: 200 }
      });
      for (const d of dv.data.entities || []) divisions.set(d.name, d.id);
    } catch (_) { /* uden divisioner lander koderne i standarddivisionen */ }
    const wanted = String(target.division || '').trim();

    const results = [];
    for (const id of codeIds) {
      const src = srcAll.find(w => w.id === id);
      if (!src) { results.push({ id, status: 'failed', message: 'Koden findes ikke i kilden' }); continue; }
      if (tgtNames.has(String(src.name).toLowerCase())) { results.push({ id, name: src.name, status: 'exists' }); continue; }
      const divName = wanted || src.division?.name || '';
      const divisionId = divName ? divisions.get(divName) : null;
      try {
        const body = { name: src.name };
        if (divisionId) body.division = { id: divisionId };
        const r = await axios.post(`${tgtBase}/api/v2/routing/wrapupcodes`, body,
          { headers: { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' } });
        tgtNames.add(String(src.name).toLowerCase());
        results.push({ id, name: src.name, status: 'created', newId: r.data.id,
          divisionNote: divName && !divisionId ? `Division "${divName}" findes ikke i ${target.name} — standarddivisionen bruges` : null });
        addLog('SUCCESS', `Wrap-up code "${src.name}" migrated to ${target.name}`, source.name, 'MIGRATE');
      } catch (e) {
        const msg = describeApiError(e);
        if (e.response?.status === 409 || /already exist/i.test(msg)) results.push({ id, name: src.name, status: 'exists' });
        else {
          results.push({ id, name: src.name, status: 'failed', message: msg });
          addLog('ERROR', `Wrap-up code migration failed: ${msg}`, source.name, 'MIGRATE');
        }
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Wrap-up code migration failed: ${msg}`, source.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

// ── OAuth-klienter og integrationer ──────────────────────────────────────────
// Rækkefølgen i en ny org er: OAuth-klienter → integrationer → data actions.
// Klienternes secrets kan ikke læses ud af Genesys; en migreret klient får en
// NY secret, som kun returneres én gang i svaret. Serveren husker den i
// hukommelsen (aldrig på disk), så integrationerne bagefter kan få deres
// credentials sat op med den nye klient.

// Roller og divisioner har forskellige id'er i hver org. Roller matches på navn,
// divisioner på navn; "*" (alle divisioner) bæres uændret med. Det der ikke kan
// matches, springes over og meldes tilbage — en klient uden roller er stadig
// bedre end en der fejler helt, men brugeren skal vide det.
function mapRoleDivisions(roleDivisions, srcRoleName, srcDivName, tgtRoleId, tgtDivId) {
  const mapped = [], missing = [];
  for (const rd of roleDivisions || []) {
    const roleName = srcRoleName.get(rd.roleId);
    const roleId = roleName ? tgtRoleId.get(roleName) : null;
    if (!roleId) { missing.push(`rolle ${roleName || rd.roleId}`); continue; }
    let divisionId = rd.divisionId;
    if (divisionId !== '*') {
      const dn = srcDivName.get(rd.divisionId);
      divisionId = dn ? tgtDivId.get(dn) : null;
      if (!divisionId) { missing.push(`division ${dn || rd.divisionId} (rolle ${roleName})`); continue; }
    }
    mapped.push({ roleId, divisionId });
  }
  return { mapped, missing };
}

function buildOauthClientBody(src, roleDivisions) {
  const body = {
    name: src.name,
    authorizedGrantType: src.authorizedGrantType,
    accessTokenValiditySeconds: src.accessTokenValiditySeconds,
    registeredRedirectUri: src.registeredRedirectUri || [],
    state: src.state || 'active',
  };
  if (src.description) body.description = src.description;
  if (src.scope && src.scope.length) body.scope = src.scope;
  if (src.allowedIPAddresses && src.allowedIPAddresses.length) body.allowedIPAddresses = src.allowedIPAddresses;
  if (roleDivisions && roleDivisions.length) {
    body.roleDivisions = roleDivisions;
  }
  return body;
}

const migratedClientSecrets = new Map();   // `${sourceId}>${targetId}` → Map(srcClientId → {id, secret})

async function listAll(base, token, urlPath, params = {}) {
  let all = [], page = 1;
  while (true) {
    const r = await axios.get(`${base}${urlPath}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 100, pageNumber: page, ...params }
    });
    const ents = r.data.entities || [];
    all = all.concat(ents);
    if (!ents.length || page >= (r.data.pageCount || 1)) break;
    page++;
  }
  return all;
}

app.get('/api/customers/:id/oauthclients', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    const all = await listAll(apiBase, token, '/api/v2/oauth/clients');
    res.json(all.map(c => ({
      id: c.id, name: c.name, grant: c.authorizedGrantType, state: c.state,
      roles: (c.roleDivisions || []).length,
    })));
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Hvilke roller de valgte klienter bruger, som mangler i målet? Skriver intet.
// Standardroller kan ikke oprettes og meldes med default: true.
function missingRolesFor(clients, srcRoles, tgtRoleNames) {
  const byId = new Map(srcRoles.map(r => [r.id, r]));
  const seen = new Map();
  for (const c of clients) {
    for (const rd of c.roleDivisions || []) {
      const r = byId.get(rd.roleId);
      if (r && !tgtRoleNames.has(r.name) && !seen.has(r.id)) seen.set(r.id, { id: r.id, name: r.name, default: !!r.default });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

app.post('/api/oauthclients/plan', async (req, res) => {
  const { sourceId, targetId, clientIds } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const [srcClients, srcRoles, tgtRoles] = await Promise.all([
      listAll(srcBase, srcToken, '/api/v2/oauth/clients'),
      listAll(srcBase, srcToken, '/api/v2/authorization/roles'),
      listAll(tgtBase, tgtToken, '/api/v2/authorization/roles'),
    ]);
    const chosen = srcClients.filter(c => (clientIds || []).includes(c.id));
    res.json({ ok: true, missingRoles: missingRolesFor(chosen, srcRoles, new Set(tgtRoles.map(r => r.name))) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

app.post('/api/oauthclients/migrate', async (req, res) => {
  const { sourceId, targetId, clientIds } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(clientIds) || !clientIds.length) return res.status(400).json({ error: 'Ingen klienter valgt' });
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const [srcClients, tgtClients, srcRoles, tgtRoles, srcDivs, tgtDivs] = await Promise.all([
      listAll(srcBase, srcToken, '/api/v2/oauth/clients'),
      listAll(tgtBase, tgtToken, '/api/v2/oauth/clients'),
      listAll(srcBase, srcToken, '/api/v2/authorization/roles'),
      listAll(tgtBase, tgtToken, '/api/v2/authorization/roles'),
      listAll(srcBase, srcToken, '/api/v2/authorization/divisions'),
      listAll(tgtBase, tgtToken, '/api/v2/authorization/divisions'),
    ]);
    const srcRoleName = new Map(srcRoles.map(r => [r.id, r.name]));
    const tgtRoleId   = new Map(tgtRoles.map(r => [r.name, r.id]));
    const srcDivName  = new Map(srcDivs.map(d => [d.id, d.name]));
    const tgtDivId    = new Map(tgtDivs.map(d => [d.name, d.id]));
    const tgtNames    = new Set(tgtClients.map(c => c.name.toLowerCase()));
    const key = `${sourceId}>${targetId}`;
    if (!migratedClientSecrets.has(key)) migratedClientSecrets.set(key, new Map());

    const results = [];
    for (const id of clientIds) {
      const src = srcClients.find(c => c.id === id);
      if (!src) { results.push({ id, status: 'failed', message: 'Klienten findes ikke i kilden' }); continue; }
      if (tgtNames.has(src.name.toLowerCase())) { results.push({ id, name: src.name, status: 'exists' }); continue; }
      const { mapped, missing } = mapRoleDivisions(src.roleDivisions, srcRoleName, srcDivName, tgtRoleId, tgtDivId);
      if (src.authorizedGrantType === 'CLIENT-CREDENTIALS' && !mapped.length) {
        // Genesys kræver mindst én rolle på en client-credentials-klient.
        results.push({ id, name: src.name, status: 'failed', missing,
          message: 'No roles could be mapped to the target org — client credentials needs at least one role. Migrate the roles first (Roles tab).' });
        continue;
      }
      try {
        const r = await axios.post(`${tgtBase}/api/v2/oauth/clients`, buildOauthClientBody(src, mapped),
          { headers: { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' } });
        tgtNames.add(src.name.toLowerCase());
        const secret = r.data.secret || null;
        if (secret) migratedClientSecrets.get(key).set(src.id, { id: r.data.id, secret });
        results.push({ id, name: src.name, status: 'created', grant: src.authorizedGrantType,
          newClientId: r.data.id, secret, missing });
        addLog('SUCCESS', `OAuth client "${src.name}" migrated to ${target.name}`, source.name, 'MIGRATE');
      } catch (e) {
        let msg = describeApiError(e);
        if (/bad\.client\.role/.test(msg))
          msg += ' — The logged-in user must hold the roles the client gets. Give the user these roles (or the Admin role) in the target org and try again.';
        results.push({ id, name: src.name, status: 'failed', message: msg });
        addLog('ERROR', `OAuth client migration failed: ${msg}`, source.name, 'MIGRATE');
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `OAuth client migration failed: ${msg}`, source.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

app.get('/api/customers/:id/integrations', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    const all = await listAll(apiBase, token, '/api/v2/integrations');
    res.json(all.map(i => ({ id: i.id, name: i.name, type: i.integrationType?.id || '', state: i.intendedState })));
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Opretter integrationen i målet og kopierer konfigurationen. Credentials kan
// ikke kopieres — secrets kan ikke læses. Er en credential en OAuth-klient der
// netop er migreret i samme kørsel af programmet, oprettes den i målet med
// klientens nye secret; alle andre meldes tilbage som manuelt arbejde. En
// integration aktiveres kun hvis kilden var aktiv og intet mangler.
app.post('/api/integrations/migrate', async (req, res) => {
  const { sourceId, targetId, integrationIds } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(integrationIds) || !integrationIds.length) return res.status(400).json({ error: 'Ingen integrationer valgt' });
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const sh = { Authorization: `Bearer ${srcToken}` };
    const th = { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' };
    const tgtList = await listAll(tgtBase, tgtToken, '/api/v2/integrations');
    const exists = new Set(tgtList.map(i => `${i.integrationType?.id}|${String(i.name).toLowerCase()}`));
    const secrets = migratedClientSecrets.get(`${sourceId}>${targetId}`) || new Map();

    const results = [];
    for (const id of integrationIds) {
      try {
        const srcInt = (await axios.get(`${srcBase}/api/v2/integrations/${id}`, { headers: sh })).data;
        const typeId = srcInt.integrationType?.id;
        if (exists.has(`${typeId}|${String(srcInt.name).toLowerCase()}`)) {
          results.push({ id, name: srcInt.name, status: 'exists' }); continue;
        }
        const cfg = (await axios.get(`${srcBase}/api/v2/integrations/${id}/config/current`, { headers: sh })).data;
        const created = (await axios.post(`${tgtBase}/api/v2/integrations`, { integrationType: { id: typeId } }, { headers: th })).data;

        const todo = [];
        const credentials = {};
        for (const [credKey, ref] of Object.entries(cfg.credentials || {})) {
          let wired = false;
          try {
            const cred = (await axios.get(`${srcBase}/api/v2/integrations/credentials/${ref.id}`, { headers: sh })).data;
            const srcClient = cred.credentialFields?.clientId;
            const hit = srcClient ? secrets.get(srcClient) : null;
            if (hit) {
              const nc = (await axios.post(`${tgtBase}/api/v2/integrations/credentials`, {
                name: cred.name, credentialType: { name: cred.type?.name || credKey },
                credentialFields: { clientId: hit.id, clientSecret: hit.secret },
              }, { headers: th })).data;
              credentials[credKey] = { id: nc.id };
              wired = true;
            }
          } catch (_) { /* meldes nedenfor */ }
          if (!wired) todo.push(`${ref.name || credKey} (${credKey})`);
        }

        const curTgt = (await axios.get(`${tgtBase}/api/v2/integrations/${created.id}/config/current`, { headers: th })).data;
        await axios.put(`${tgtBase}/api/v2/integrations/${created.id}/config/current`, {
          name: srcInt.name, notes: cfg.notes || '', version: curTgt.version,
          properties: cfg.properties || {}, advanced: cfg.advanced || {}, credentials,
        }, { headers: th });

        let activated = false;
        if (srcInt.intendedState === 'ENABLED' && !todo.length) {
          try {
            await axios.patch(`${tgtBase}/api/v2/integrations/${created.id}`, { intendedState: 'ENABLED' }, { headers: th });
            activated = true;
          } catch (_) { /* forbliver deaktiveret */ }
        }
        results.push({ id, name: srcInt.name, status: 'created', type: typeId, newId: created.id, activated, todo });
        addLog('SUCCESS', `Integration "${srcInt.name}" migrated to ${target.name}`, source.name, 'MIGRATE');
      } catch (e) {
        const msg = describeApiError(e);
        results.push({ id, status: 'failed', message: msg });
        addLog('ERROR', `Integration migration failed: ${msg}`, source.name, 'MIGRATE');
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Integration migration failed: ${msg}`, source.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

// ── Roller ───────────────────────────────────────────────────────────────────
// Standardrollerne findes i alle orgs og migreres ikke; kun brugerdefinerede.
// En politik med en ressourcebetingelse peger på id'er fra kilde-org'en (fx en
// division eller kø). Uden betingelsen ville politikken gælde ALT, så sådanne
// politikker springes over og meldes tilbage i stedet for at gøre rollen
// stærkere end kilden.
function buildRolePolicies(policies) {
  const kept = [], skipped = [];
  for (const p of policies || []) {
    const label = `${p.domain}:${p.entityName}`;
    if (p.resourceConditionNode || p.conditionExpression || (p.namedConditions && p.namedConditions.length)) {
      skipped.push(label); continue;
    }
    kept.push({ domain: p.domain, entityName: p.entityName, actionSet: p.actionSet || [], allowConditions: false });
  }
  return { kept, skipped };
}

app.get('/api/customers/:id/roles', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    const all = await listAll(apiBase, token, '/api/v2/authorization/roles');
    res.json(all.filter(r => !r.default).map(r => ({
      id: r.id, name: r.name, policies: (r.permissionPolicies || []).length,
    })));
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

app.post('/api/roles/migrate', async (req, res) => {
  const { sourceId, targetId, roleIds } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(roleIds) || !roleIds.length) return res.status(400).json({ error: 'Ingen roller valgt' });
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const tgtRoles = await listAll(tgtBase, tgtToken, '/api/v2/authorization/roles');
    const tgtNames = new Set(tgtRoles.map(r => String(r.name).toLowerCase()));
    const results = [];
    for (const id of roleIds) {
      try {
        const src = (await axios.get(`${srcBase}/api/v2/authorization/roles/${id}`,
          { headers: { Authorization: `Bearer ${srcToken}` } })).data;
        if (tgtNames.has(String(src.name).toLowerCase())) { results.push({ id, name: src.name, status: 'exists' }); continue; }
        const { kept, skipped } = buildRolePolicies(src.permissionPolicies);
        const body = { name: src.name, permissionPolicies: kept };
        if (src.description) body.description = src.description;
        const r = await axios.post(`${tgtBase}/api/v2/authorization/roles`, body,
          { headers: { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' } });
        tgtNames.add(String(src.name).toLowerCase());
        results.push({ id, name: src.name, status: 'created', newId: r.data.id, missing: skipped });
        addLog('SUCCESS', `Role "${src.name}" migrated to ${target.name}`, source.name, 'MIGRATE');
      } catch (e) {
        const msg = describeApiError(e);
        results.push({ id, status: 'failed', message: msg });
        addLog('ERROR', `Role migration failed: ${msg}`, source.name, 'MIGRATE');
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Role migration failed: ${msg}`, source.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

// ── Indholdssammenligning af flows ────────────────────────────────────────────

// Genesys' versionsnumre er per-org tællere: kilden kan stå på v37 og målet på
// v1 for præcis samme flow. Tallene kan derfor aldrig bruges til at afgøre om
// to flows er ens — det kan kun indholdet.
//
// To slags støj skal ud først, begge Archys egen interne nummerering:
//   trackingId: 12          rene tællere, uden betydning
//   [Initial State_10]      løbenumre i refId og referencer til dem
// Målt på to flowpar: 8 rå forskelle blev til 1 (en ægte logikforskel), og
// 296 blev til 280 (to reelt forskellige flows).
function normalizeFlowYaml(yaml) {
  return String(yaml || '')
    .split(/\r?\n/)
    .filter(l => !/^\s*trackingId:\s*\d+\s*$/.test(l))
    // En TOM beskrivelse betyder det samme som ingen beskrivelse. Archy skriver
    // den ud på et nyoprettet flow, men udelader den på et der aldrig har haft
    // en — så en fejlfri kopi fik én linje mere end kilden og blev meldt som
    // afvigende. En beskrivelse med indhold tæller stadig med.
    .filter(l => !/^\s*description:\s*(""|'')\s*$/.test(l))
    .join('\n')
    .replace(/_(\d+)\]/g, '_#]')
    .replace(/^(\s*refId:\s*.*?)_(\d+)\s*$/gm, '$1_#')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// Ved sammenligning på tværs af miljøer skal præfikset ud af BÅDE flowets eget
// navn og dets referencer. De to linjer skal jo være forskellige — det er hele
// pointen med et præfikset miljø — så uden dette ville en fejlfri forfremmelse
// altid melde "afviger", og indholdstjekket ville være ubrugeligt netop dér
// hvor man har mest brug for det.
function stripEnvPrefixesInYaml(yaml, env) {
  // Divisionen SKAL være forskellig mellem miljøerne — den hører til miljøet,
  // ikke til flowet. Uden dette ville en fejlfri forfremmelse fra DEV til UAT
  // altid melde "afviger" på netop den linje. Den sættes til en fast værdi i
  // begge sider, så den ikke tæller med, men heller ikke forsvinder.
  let out = setFlowDivisionInYaml(String(yaml), '<miljøets division>');

  const p = prefixOf(env);
  if (!p) return out;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let done = false;
  out = out.split(/\r?\n/).map(l => {
    if (done) return l;
    const m = l.match(/^([ \t]{2,})name:([ \t]*)(.*)$/);
    if (!m) return l;
    done = true;
    return `${m[1]}name:${m[2]}${m[3].replace(new RegExp('^(["\']?)' + esc), '$1')}`;
  }).join('\n');

  for (const tag of ['dataTable', 'commonModule'])
    out = out.replace(new RegExp(`(^[ \\t]*${tag}:[ \\t]*\\r?\\n[ \\t]+)${esc}`, 'gm'), '$1');

  return out;
}

function flowContentHash(yaml, env) {
  const rent = env ? stripEnvPrefixesInYaml(yaml, env) : yaml;
  return crypto.createHash('sha256').update(normalizeFlowYaml(rent)).digest('hex');
}

// Archy lægger versionen i filnavnet: "Mit Flow_v16-0.yaml" → 16
// Versionsudligning: hver publicering i Genesys giver én ny udgave, og tælleren
// er pr. org. Efter en forfremmelse står målet derfor typisk lavere end kilden
// (dev v10 → test v3). Vil man have samme nummer begge steder, publiceres målet
// det antal ekstra gange der mangler. Ét antal pr. forfremmelse, og aldrig ned:
// står målet højere, kan det ikke rettes ved at publicere.
const MAX_ALIGN_PUBLISHES = 25;
function alignmentPlan(sourceVersion, targetVersion) {
  const major = v => parseInt(String(v ?? '').split('.')[0], 10);
  const s = major(sourceVersion), t = major(targetVersion);
  if (!Number.isFinite(s) || !Number.isFinite(t)) return { extra: 0, reason: 'unknown' };
  if (t >= s) return { extra: 0, reason: t > s ? 'target_ahead' : 'equal', source: s, target: t };
  if (s - t > MAX_ALIGN_PUBLISHES) return { extra: 0, reason: 'too_many', needed: s - t, source: s, target: t };
  return { extra: s - t, reason: 'ok', source: s, target: t };
}

function versionFromFileName(fileName) {
  const m = String(fileName).match(/_v(\d+)-\d+\.yaml$/i);
  return m ? parseInt(m[1], 10) : null;
}

// Hvilken udgave en migrering skal hente. Archys export tager 'latest' som
// standard, altså den GEMTE kladde — og en kladde er per definition ikke testet.
// Målt på et rigtigt flow: prods ChatGPT var publiceret som 5.0 og havde sin data
// action, mens kladden 7.0 havde mistet den. Vagten i /api/migrate/prepare sagde
// god for flowet, fordi det ER publiceret — og så sendte vi kladden af sted.
//
// Kan udgaven ikke slås op, falder vi tilbage på latest frem for at standse:
// hellere den gamle opførsel end ingen migrering.
async function publishedVersionFor(customer, flowName, flowType, hvorfor) {
  try {
    const { found, published } = await publishedVersionOf(customer, flowName, flowType);
    if (found && published) return published;
    if (found) addLog('WARN', `"${flowName}" has no published version in ${customer.name} — exporting the saved draft`, customer.name, hvorfor);
  } catch (e) {
    addLog('WARN', `Could not look up the published version of "${flowName}" in ${customer.name}: ${describeApiError(e)}`, customer.name, hvorfor);
  }
  return null;
}

// Eksporterer ét flow og returnerer { yaml, fileName, version }.
// version = null betyder Archys standard, 'latest' — den gemte kladde.
async function exportFlowToYaml(customer, flowName, flowType, version) {
  const dir = path.join(FLOWS_DIR, sanitizeName(customer.name));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const mt = f => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) { return 0; } };
  const before = new Map(fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => [f, mt(f)]));

  await runArchy(
    `export --flowName ${archyArg(flowName, 'Flow name')} ` +
    `--flowType ${archyBareArg(String(flowType).toLowerCase(), 'Flow type')} ` +
    archyVersionFlag(version) +
    `--exportType yaml --force --outputDir ${archyArg(dir, 'Directory')}`,
    customer
  );
  const touched = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))
    .filter(f => !before.has(f) || mt(f) > before.get(f))
    .sort((a, b) => mt(b) - mt(a));
  if (!touched.length) throw new Error(`The export wrote no YAML file for "${flowName}"`);
  const fileName = touched[0];
  const yaml = fs.readFileSync(path.join(dir, fileName), 'utf8');
  assertYamlIsFlow(yaml, flowName, fileName);
  return { yaml, fileName, version: versionFromFileName(fileName) };
}

// Sidste kontrol før vi viser eller migrerer indholdet: står der det flownavn i
// YAML'en som brugeren bad om? Kan navnet ikke læses, lader vi det passere —
// vi vil hellere mangle kontrollen end afvise en gyldig eksport.
// Skriver flowets navn om i YAML'en. Det er ØVERSTE navnefelt der er flowets —
// de dybere hører til tasks og states — så kun det første røres.
function renameFlowInYaml(yaml, newName) {
  let done = false;
  const eol = /\r\n/.test(yaml) ? '\r\n' : '\n';
  return String(yaml).split(/\r?\n/).map(l => {
    if (done) return l;
    const m = l.match(/^([ \t]{2,})name:([ \t]*)(.*)$/);
    if (!m) return l;
    done = true;
    const varQuoted = /^".*"$|^'.*'$/.test(m[3].trim());
    return `${m[1]}name:${m[2] || ' '}${varQuoted ? JSON.stringify(newName) : newName}`;
  }).join(eol);
}

// Hvad flowet skal hedde i målmiljøet: kildens præfiks af, målets på.
// Versionsendelsen (_vN) røres IKKE her — den regel kører indtil videre kun i
// demoen, fordi omdøbning af et flow i en rigtig org ikke er afprøvet endnu.
function targetFlowName(flowName, source, target) {
  return withEnvPrefix(stripEnvPrefix(flowName, source), target);
}

// Flowtypen står som første nøgle i Archys YAML ("commonModule:",
// "inboundCall:" …) og navnet som det første indrykkede name:.
function yamlFlowHeader(yaml) {
  const kind = (String(yaml).match(/^([A-Za-z]+):[ \t]*$/m) || [])[1] || null;
  const m = String(yaml).match(/^[ \t]{2,}name:[ \t]*(.+?)[ \t]*$/m);
  return { kind, name: m ? m[1].replace(/^["']|["']$/g, '') : null };
}

function assertYamlIsFlow(yaml, flowName, fileName) {
  const m = String(yaml).match(/^[ \t]{2,}name:[ \t]*(.+?)[ \t]*$/m);
  if (!m) return;
  const got = m[1].replace(/^["']|["']$/g, '');
  const norm = x => String(x).trim().toLowerCase();
  if (norm(got) !== norm(flowName))
    throw new Error(`The export returned the wrong flow: asked for "${flowName}", file ${fileName} contains "${got}"`);
}

// Hvornår blev flowet sidst publiceret, og af hvem? Det er den oplysning der
// afslører om nogen har rettet direkte i mål-org'en efter en migrering.
async function getFlowPublishInfo(customer, flowName, flowType) {
  const { token, apiBase } = await getToken(customer);
  const H = { headers: { Authorization: `Bearer ${token}` } };
  let page = 1, hit = null;
  while (!hit) {
    const r = await axios.get(`${apiBase}/api/v2/flows`, {
      ...H, params: { pageSize: 100, pageNumber: page, type: String(flowType).toLowerCase() }
    });
    const e = r.data.entities || [];
    hit = e.find(f => f.name === flowName) || null;
    if (hit || e.length < 100) break;
    page++;
  }
  if (!hit) return null;

  const pv = hit.publishedVersion;
  // Et flow kan være checked in uden nogensinde at være publiceret. Det er
  // værd at vide: flowet findes i org'en, men er ikke i drift.
  if (!pv) return { version: hit.checkedInVersion?.name || null, publishedAt: null,
                    publishedBy: null, active: !!hit.active };

  let by = null;
  if (pv.createdBy?.id) {
    try {
      const u = await axios.get(`${apiBase}/api/v2/users/${pv.createdBy.id}`, H);
      by = u.data.name || u.data.email || null;
    } catch (_) {
      // 404 = brugeren findes ikke længere. Et rå GUID hjælper ingen.
      by = null;
    }
  }
  return {
    version: pv.name || pv.commitVersion || null,
    publishedAt: pv.dateCheckedIn || pv.dateCreated || null,
    publishedBy: by,
    active: !!hit.active
  };
}

// ── Migreringsmanifest ────────────────────────────────────────────────────────
// Hvad blev migreret hvorhen, og hvilket indhold havde det.
//
// Nøglen er Genesys' EGEN org-id — ikke vores lokale kunde-id. Med ti kunder
// der hver har dev/uat/prod er det afgørende at en post entydigt hører til én
// org: kunde-id'er er lokale tidsstempler der ændrer sig hvis en kunde slettes
// og oprettes igen, mens org-id'et følger organisationen.
const MANIFEST_FILE = path.join(FLOWS_DIR, '.migrations.json');

// ── Manifest i org'en ────────────────────────────────────────────────────────
// Den lokale fil kan ikke deles: to personer på hver sin pc får hver sin
// historik, og signalet "publiceret uden om pipelinen" ville sige noget
// forskelligt alt efter hvem der kigger.
//
// Derfor ligger manifestet i en datatabel i org'en — og HVER ORG BESKRIVER KUN
// SIG SELV. Kendsgerningen "dev har Velkomst_v10 på v10" skrives kun af den der
// ændrede dev, så to skrivende kan aldrig sige hver sit om samme celle.
// Uenighed er umulig af konstruktion, i stedet for noget vi skal løse bagefter.
// En org der ikke kan nås bliver "ukendt" — præcis som tavlen allerede gør.

const ORG_MANIFEST_BASE = 'ArchyGUI_Manifest';
// Datatabellerne følger samme navnekonvention som flowene: et virtuelt miljø
// har sit præfiks med, prod har ingen. Så har hvert miljø sit eget manifest,
// også når fire af dem deler den samme org.
const manifestTableName = c => prefixOf(c) + ORG_MANIFEST_BASE;

// Nøglen er GRUNDNAVNET plus typen. Flownavnet ændrer sig ved hver forfremmelse
// ("Velkomst" → "_v10" → "_v15"), så nøgles der på det fulde navn, bliver
// rækken forældreløs hver gang. Samme fejl som i den lokale fil før v1.25.0.
// Nøglefeltet i Genesys tager 256 tegn.
function orgManifestKey(flowName, flowType) {
  const k = `${baseFlowName(flowName)}|${normType(flowType)}`;
  return k.length <= 256 ? k : k.slice(0, 256);
}

// Hvem der rørte det. Med client-credentials findes der ingen bruger i Genesys,
// så vi noterer hvem der kørte ArchyGUI — det er dét spørgsmålet handler om.
const _whoCache = {};                 // customerId -> { who, at }
const WHO_TTL = 10 * 60 * 1000;

function machineUser() {
  try { return `${os.userInfo().username}@${os.hostname()}`; }
  catch (_) { return 'ukendt'; }
}

// Er miljøet logget ind med OAuth (PKCE), er tokenet en PERSON, og så skal
// rækken bære den person — ikke hvem der tilfældigvis sad ved maskinen.
//
// Med client credentials findes der ingen Genesys-bruger: tokenet tilhører en
// integration, ikke et menneske. Så er pc-brugeren det eneste sande vi kan
// notere — og det skal siges, så det ikke forveksles med en Genesys-identitet.
// Derfor bærer rækken både navnet og hvor det kommer fra.
async function whoAmI(customer) {
  if (!customer || customer.authType !== 'oauth')
    return { by: machineUser(), bySource: 'machine' };

  const hit = _whoCache[customer.id];
  if (hit && Date.now() - hit.at < WHO_TTL) return { by: hit.who, bySource: 'genesys' };
  try {
    const { token, apiBase } = await getToken(customer);
    const r = await axios.get(`${apiBase}/api/v2/users/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const who = r.data.email || r.data.username || r.data.name || r.data.id;
    if (!who) throw new Error('intet brugernavn i svaret');
    _whoCache[customer.id] = { who, at: Date.now() };
    return { by: who, bySource: 'genesys' };
  } catch (_) {
    // Kan brugeren ikke slås op, opdigter vi ikke en — vi falder tilbage og
    // siger hvad det er.
    return { by: machineUser(), bySource: 'machine' };
  }
}

const _mfTableCache = {};   // customerId -> { id, at }
const MF_TABLE_TTL = 5 * 60 * 1000;

async function findOrgManifestTable(customer) {
  const hit = _mfTableCache[customer.id];
  if (hit && Date.now() - hit.at < MF_TABLE_TTL) return hit.id;
  const { token, apiBase } = await getToken(customer);
  let page = 1;
  for (;;) {
    const r = await axios.get(`${apiBase}/api/v2/flows/datatables`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 100, pageNumber: page }
    });
    const found = (r.data.entities || []).find(t => t.name === manifestTableName(customer));
    if (found) { _mfTableCache[customer.id] = { id: found.id, at: Date.now() }; return found.id; }
    if (page++ >= (r.data.pageCount || 1)) break;
  }
  _mfTableCache[customer.id] = { id: null, at: Date.now() };
  return null;
}

async function createOrgManifestTable(customer) {
  const { token, apiBase } = await getToken(customer);
  const body = {
    name: manifestTableName(customer),
    // Står i kundens org, så den er på engelsk som alt andet vi skriver dér.
    description: 'ArchyGUI: what this org contains and when it arrived. Written by ArchyGUI — do not edit rows by hand.',
    schema: {
      $schema: 'http://json-schema.org/draft-04/schema#',
      title: manifestTableName(customer),
      type: 'object',
      required: ['key'],
      additionalProperties: false,
      properties: {
        key:  { title: 'Lookup Key', type: 'string', $id: '/properties/key',
                displayOrder: 0, minLength: 1, maxLength: 256 },
        Data: { title: 'Data', type: 'string', $id: '/properties/Data',
                displayOrder: 1, minLength: 0, maxLength: 262144 }
      }
    }
  };
  const r = await axios.post(`${apiBase}/api/v2/flows/datatables`, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  delete _mfTableCache[customer.id];
  addLog('SUCCESS', `Manifest table "${manifestTableName(customer)}" created`, customer.name, 'MANIFEST');
  return r.data.id;
}

// Demo-miljøer har ingen org — deres "tabel" ligger i demofilen.
function demoManifest(envId) {
  const d = loadDemo();
  return (d.manifest || {})[envId] || {};
}
function demoManifestWrite(envId, key, data) {
  const d = loadDemo();
  d.manifest = d.manifest || {};
  d.manifest[envId] = d.manifest[envId] || {};
  d.manifest[envId][key] = data;
  saveDemo(d);
}

// Kun flowrækker. Opsætningsrækken (SETUP_KEY) står i samme tabel, men den er
// ikke et flow — tavlen, release-historikken og status må aldrig se den.
// Et flows nøgle er altid "grundnavn|TYPE", så en nøgle uden "|" er reserveret.
const isFlowRowKey = k => String(k || '').includes('|');
const onlyFlowRows = rows => Object.fromEntries(Object.entries(rows || {}).filter(([k]) => isFlowRowKey(k)));

async function readOrgManifest(customer) {
  if (isDemo(customer)) return onlyFlowRows(demoManifest(customer.id));
  const tableId = await findOrgManifestTable(customer);
  if (!tableId) return null;                       // ingen tabel = ikke taget i brug
  const { token, apiBase } = await getToken(customer);
  const out = {};
  let page = 1;
  for (;;) {
    let r;
    try {
      r = await axios.get(`${apiBase}/api/v2/flows/datatables/${tableId}/rows`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 100, pageNumber: page, showbrief: false }
      });
    } catch (e) {
      // Tabellens id huskes i fem minutter. Er den slettet i org'en imens, er
      // svaret 404 — og så har miljøet ingen tabel, ikke en fejl.
      if (e.response?.status === 404 && page === 1) { delete _mfTableCache[customer.id]; return null; }
      throw e;
    }
    for (const row of (r.data.entities || [])) {
      if (!isFlowRowKey(row.key)) continue;
      try { out[row.key] = JSON.parse(row.Data || '{}'); }
      catch (_) { /* en række nogen har rettet i hånden — spring den over */ }
    }
    if (page++ >= (r.data.pageCount || 1)) break;
  }
  return out;
}

// Én række, slået op direkte. undefined = ingen tabel, null = ingen række.
async function readOrgManifestRow(customer, key) {
  if (isDemo(customer)) return demoManifest(customer.id)[key] || null;
  const tableId = await findOrgManifestTable(customer);
  if (!tableId) return undefined;
  return readTableRow(customer, tableId, key);
}

// Én række i en bestemt tabel. Opdagelsen læser andre miljøers tabeller i
// samme org — dem kender findOrgManifestTable ikke.
async function readTableRow(customer, tableId, key) {
  const { token, apiBase } = await getToken(customer);
  try {
    const r = await axios.get(`${apiBase}/api/v2/flows/datatables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` }, params: { showbrief: false }
    });
    try { return JSON.parse(r.data.Data || '{}'); } catch (_) { return null; }
  } catch (e) {
    if (e.response?.status === 404) return null;
    throw e;
  }
}

// Skriver rækken præcis som den er — ingen stempel med hvem og hvornår.
async function putOrgManifestRow(customer, key, payload) {
  if (isDemo(customer)) { demoManifestWrite(customer.id, key, payload); return { ok: true, key }; }
  const tableId = await findOrgManifestTable(customer);
  if (!tableId) return { ok: false, reason: 'no-table' };
  const { token, apiBase } = await getToken(customer);
  const H = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  const body = { key, Data: JSON.stringify(payload) };
  const url = `${apiBase}/api/v2/flows/datatables/${tableId}/rows`;
  try {
    await axios.put(`${url}/${encodeURIComponent(key)}`, body, H);
  } catch (e) {
    // Findes rækken ikke endnu, oprettes den. Der er ingen upsert i API'et.
    if (e.response?.status === 404) await axios.post(url, body, H);
    else throw e;
  }
  return { ok: true, key };
}

async function writeOrgManifestRow(customer, flowName, flowType, data) {
  const key = orgManifestKey(flowName, flowType);
  const who = await whoAmI(customer);
  // Release-historikken bor i samme række. En forfremmelse skriver rækken
  // forfra, og uden dette ville den slette historikken hver gang — og dermed
  // muligheden for at rulle tilbage fra en anden pc.
  let releases = data.releases;
  if (releases === undefined) {
    try { releases = ((await readOrgManifestRow(customer, key)) || {}).releases; }
    catch (_) { releases = undefined; }
  }
  const payload = { ...data, by: who.by, bySource: who.bySource, at: Date.now() };
  if (releases) payload.releases = releases;
  return putOrgManifestRow(customer, key, payload);
}

// Skriver de to rækker en forfremmelse afstedkommer: én i kilden og én i målet.
// Fejler den ene, siges det højt i loggen — men migreringen rulles ikke tilbage,
// for flowet ER flyttet. Et manglende manifest er en mangel i bogføringen, ikke
// en grund til at påstå at flytningen ikke skete.
// flowName SKAL være grundnavnet uden miljøpræfiks. Rækkerne nøgles på det, og
// tavlen slår også op på det — ellers ville en kilde med præfiks skrive under
// én nøgle og blive læst under en anden.
async function recordOrgManifest(source, target, flowName, flowType, info) {
  const write = async (env, data, hvad) => {
    // Et løst miljø (intet trin) er ikke med i nogen pipeline. Dér skrives der
    // aldrig — kunden har ikke bedt om en ArchyGUI-tabel i sin org.
    if (!env || !stageOf(env)) return;
    try {
      const r = await writeOrgManifestRow(env, flowName, flowType, data);
      if (!r.ok && r.reason === 'no-table')
        addLog('WARN', `${env.name} has no manifest table — ${hvad} was not recorded. Create it from the Pipeline page.`, env.name, 'MANIFEST');
      // Første manifest-skrivning på et miljø fra før opsætningsrækken fandtes:
      // så skrives den også, i baggrunden.
      else if (r.ok && !env.setupAt) setupInBackground([env.id], 'first manifest write');
    } catch (e) {
      addLog('ERROR', `Could not write the manifest in ${env.name}: ${describeApiError(e)}`, env.name, 'MANIFEST');
    }
  };
  // Navnet i rækken er miljøets EGET navn på flowet — nøglen er grundnavnet.
  await write(target, {
    flowName: target ? withEnvPrefix(flowName, target) : flowName, version: info.targetVersion, publishedAt: info.targetPublishedAt,
    promotedFrom: source ? source.name : null, promotedAt: info.targetPublishedAt,
    sourceVersion: info.sourceVersion, hash: info.hash, kind: info.kind || 'migration'
  }, 'the target');
  // Et nulpunkt har ingen kilde — der er ikke flyttet noget, vi noterer blot
  // hvad org'en indeholder lige nu.
  if (!source) return;
  await write(source, {
    flowName: withEnvPrefix(flowName, source), version: info.sourceVersion, publishedAt: info.sourcePublishedAt || null,
    promotedTo: target.name, promotedAt: info.targetPublishedAt,
    hash: info.hash, kind: info.kind || 'migration'
  }, 'kilden');
}

app.get('/api/manifest/status', async (req, res) => {
  const { tenant, group } = req.query;
  const envs = loadCustomers().filter(c => tenantOf(c) === tenant && groupOf(c) === group)
    .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage));
  if (!envs.length) return res.status(404).json({ error: 'Ingen miljøer i den gruppe' });
  const out = [];
  // Opsætningsrækken: skrevet og i trit, venter på at blive skrevet, eller
  // aldrig skrevet fra denne pc.
  const setupState = c => c.setupPending ? 'pending' : c.setupAt ? 'ok' : 'none';
  // Ét opslag pr. miljø, side om side — rækkefølgen bevares.
  out.push(...await Promise.all(envs.map(async c => {
    if (isDemo(c))
      return { id: c.id, name: c.name, stage: stageOf(c), hasTable: true, setup: setupState(c),
               table: manifestTableName(c),
               rows: Object.keys(onlyFlowRows(demoManifest(c.id))).length, demo: true };
    try {
      const rows = await readOrgManifest(c);
      return { id: c.id, name: c.name, stage: stageOf(c), table: manifestTableName(c), setup: setupState(c),
               hasTable: rows !== null, rows: rows ? Object.keys(rows).length : 0 };
    } catch (e) {
      return { id: c.id, name: c.name, stage: stageOf(c), table: manifestTableName(c), hasTable: false, error: describeApiError(e) };
    }
  })));
  res.json({ ok: true, table: ORG_MANIFEST_BASE, environments: out });
});

// Et fingeraftryk af manifest-tabellerne i en pipeline-gruppe. Brugerfladen
// spørger med jævne mellemrum og tegner tavlen igen, når det ændrer sig — så
// man ser det en kollega på en anden pc har gjort. Kun nøgler og tidspunkter
// indgår, ikke indholdet. Intervallet står i settings.json (pipelineRefreshSeconds,
// 0 = slået fra).
function manifestSignature(rows) {
  if (!rows) return 'none';
  const h = crypto.createHash('sha1');
  for (const k of Object.keys(rows).sort()) {
    const r = rows[k] || {};
    h.update(`${k}|${r.at || ''}|${r.version ?? ''}|${r.publishedAt || ''}|${(r.releases || []).length}\n`);
  }
  return h.digest('hex').slice(0, 12);
}

app.get('/api/manifest/signature', async (req, res) => {
  const { tenant, group } = req.query;
  const envs = loadCustomers().filter(c => tenantOf(c) === tenant && groupOf(c) === group && stageOf(c));
  const n = Number(loadSettings().pipelineRefreshSeconds);
  const sek = Number.isFinite(n) ? (n === 0 ? 0 : Math.max(15, n)) : 60;
  const dele = await Promise.all(envs.map(async c => {
    try { return `${c.id}:${manifestSignature(await readOrgManifest(c))}`; }
    catch (_) { return `${c.id}:?`; }       // ikke logget ind lige nu, eller ingen forbindelse
  }));
  res.json({ ok: true, sig: dele.length ? dele.join(';') : null, intervalSeconds: sek });
});

app.post('/api/manifest/create', async (req, res) => {
  const c = loadCustomers().find(x => x.id === req.body.envId);
  if (!c) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(c)) return res.json({ ok: true, demo: true });
  if (!stageOf(c))
    return res.status(400).json({ error: `"${c.name}" har intet trin og er ikke med i en pipeline — så får org'en ingen ArchyGUI-tabel. Giv miljøet et trin først.` });
  try {
    const existing = await findOrgManifestTable(c);
    if (existing) { setupInBackground([c.id], 'manifest table found'); return res.json({ ok: true, existed: true }); }
    await createOrgManifestTable(c);
    // Tabellen fødes med opsætningsrækken i — så kan en anden pc finde miljøet.
    ensurePipelineIdsSaved();
    let setup;
    try { setup = await writeSetupRow(loadCustomers().find(x => x.id === c.id) || c, null); }
    catch (e) { setup = { ok: false, error: describeApiError(e) }; }
    setupInBackground(pipelinePeers(c, loadCustomers()).map(x => x.id).filter(id => id !== c.id), 'new manifest table');
    res.json({ ok: true, created: true, setup });
  } catch (e) {
    addLog('ERROR', `Could not create the manifest table: ${describeApiError(e)}`, c.name, 'MANIFEST');
    res.status(500).json({ error: describeApiError(e) });
  }
});

// ── Opsætningen i org'en ─────────────────────────────────────────────────────
// customers.json ligger på én pc. En kollega på en anden pc vidste derfor intet
// om de miljøer der allerede var sat op — heller ikke når org'en havde dem.
//
// Hvert pipeline-miljø har sin manifest-tabel i org'en. I den står nu også én
// række der beskriver miljøet selv: navn, kunde, gruppe, trin, præfiks — og de
// andre miljøer i samme pipeline, også dem i andre orgs. Så kan en ny pc logge
// ind, finde tabellerne og bygge miljøerne op igen, og en slettet tabel kan
// genopbygges fra pc'en. Den lokale fil og org'en kan genskabe hinanden.
//
// Reglerne blev aftalt før koden:
//   · org'en vinder for de delte felter. En lokal rettelse skrives derfor
//     straks til org'en; lykkes det ikke, er miljøet "ikke synkroniseret", og
//     rettelsen bliver stående til den kan skrives
//   · rækken skrives automatisk — og i alle pipelinens orgs, også prod, men
//     kun med et login der må skrive dertil (prod-vagten gælder også her)
//   · et løst miljø (intet trin) får aldrig en tabel eller en række
//   · ingen hemmeligheder: hverken secret, token eller andet der giver adgang
const SETUP_KEY = 'ArchyGUI_Setup';
const SETUP_SCHEMA = 1;

// Felterne org'en vinder på. Præfikset står der ikke: det er dét tabellen blev
// fundet på, så det kan ikke være uenigt med sig selv.
const SETUP_SHARED = ['name', 'tenant', 'group', 'stage', 'orgLabel', 'color', 'division',
                      'deployPermission', 'deployGroup'];
// Felter de ANDRE miljøers rækker nævner. Ændres et af dem, skal søskendene
// have deres liste skrevet om.
const SETUP_SIBLING_FIELDS = [...SETUP_SHARED, 'prefix', 'region', 'clientId', 'authType', 'orgId', 'pipelineId'];

const isSetupRow = r => !!(r && r.kind === 'archygui-setup' && r.env && typeof r.env === 'object');

// Miljøerne i samme pipeline som env — env selv iberegnet. pipelineId er den
// faste nøgle; kunde og gruppe er fritekst og kan staves forskelligt på to pc'er.
function pipelinePeers(env, all) {
  if (!env) return [];
  if (!stageOf(env)) return [env];
  return all.filter(c => stageOf(c) && isDemo(c) === isDemo(env) &&
    (c.id === env.id || (env.pipelineId && c.pipelineId === env.pipelineId) || sameGroup(c, env)));
}

// Hvert pipeline-miljø får et pipelineId. Har et miljø i samme kunde og gruppe
// allerede et, arves det; ellers dannes et nyt. Ændrer listen på stedet og
// returnerer id'erne på de miljøer der fik et.
function ensurePipelineIds(all, nyId = () => crypto.randomUUID()) {
  const fik = [];
  for (const c of all) {
    if (!stageOf(c) || c.pipelineId) continue;
    const peer = all.find(x => x !== c && x.pipelineId && stageOf(x) && sameGroup(x, c));
    c.pipelineId = peer ? peer.pipelineId : nyId();
    fik.push(c.id);
  }
  return fik;
}
function ensurePipelineIdsSaved() {
  const all = loadCustomers();
  if (ensurePipelineIds(all).length) saveCustomers(all);
  return all;
}

// Præfikser org'en bruger ud over miljøets eget: dem fra søskende på denne pc
// i samme org, plus dem opdagelsen har set i org'en.
function takenPrefixesFor(env, all) {
  const set = new Set(env.takenPrefixes || []);
  for (const c of all)
    if (c.id !== env.id && orgKeyOf(c) === orgKeyOf(env) && prefixOf(c)) set.add(prefixOf(c));
  set.delete(prefixOf(env));
  set.delete('');
  return [...set].sort();
}

// Det en anden pc skal bruge for at tilføje miljøet — og ikke mere. Client
// ID'et er ikke hemmeligt, men kun en PKCE-klient kan bruges til at logge ind
// med. En client credentials-klient kræver en secret, og den deles aldrig.
function setupSibling(c) {
  return { name: c.name, stage: stageOf(c) || '', prefix: prefixOf(c), region: c.region || '',
           orgId: c.orgId || null, orgLabel: c.orgLabel || '',
           clientId: c.authType === 'oauth' ? (c.clientId || '') : '' };
}

// Er to søskendeposter det samme miljø? Samme præfiks, og samme org — eller,
// før org'en kendes, samme klient i samme region.
function sameSibling(a, b) {
  if (String(a.prefix || '') !== String(b.prefix || '')) return false;
  if (a.orgId && b.orgId) return a.orgId === b.orgId;
  return !!a.clientId && a.clientId === b.clientId && a.region === b.region;
}

// En søskendepost fra org'en er data andre har skrevet. Kun de kendte felter,
// i den form vi selv skriver dem.
function cleanSibling(s) {
  if (!s || typeof s !== 'object') return null;
  const str = (v, max) => String(v ?? '').slice(0, max);
  const ud = { name: str(s.name, 60), stage: str(s.stage, 20).toLowerCase(), prefix: str(s.prefix, 20),
               region: str(s.region, 40), orgId: GUID.test(String(s.orgId || '')) ? String(s.orgId) : null,
               orgLabel: str(s.orgLabel, 60), clientId: GUID.test(String(s.clientId || '')) ? String(s.clientId) : '' };
  return ud.name && (ud.orgId || ud.clientId) ? ud : null;
}

// Rækken som den skal stå i miljøets tabel.
//
// Søskendelisten er IKKE bare de miljøer denne pc har. En pc med kun dev
// tilføjet ville så skrive en tom liste og slette org'ens viden om prod. Listen
// flettes derfor med den der står (previous); denne pc's miljøer erstatter
// deres egne poster, og en post fjernes kun når miljøet har forladt pipelinen
// (forget) — ikke fordi én pc har slettet det fra sin egen liste.
function setupRowFor(env, all, { stages = STAGES, by = null, bySource = null, at = Date.now(), previous = null, forget = [] } = {}) {
  const egne = {};
  for (const k of SETUP_SHARED) egne[k] = String(env[k] ?? '');
  egne.stage = stageOf(env) || '';
  const mig = setupSibling(env);
  const lokale = pipelinePeers(env, all).filter(c => c.id !== env.id).map(setupSibling);
  const siblings = (isSetupRow(previous) && Array.isArray(previous.siblings) ? previous.siblings : [])
    .map(cleanSibling).filter(Boolean)
    .filter(s => !lokale.some(l => sameSibling(l, s)) && !sameSibling(s, mig) && !forget.some(x => sameSibling(x, s)));
  siblings.push(...lokale);
  return {
    kind: 'archygui-setup', schemaVersion: SETUP_SCHEMA,
    env: { ...egne, prefix: prefixOf(env), region: env.region || '', orgId: env.orgId || null },
    pipelineId: env.pipelineId || null,
    stages: [...stages],
    takenPrefixes: takenPrefixesFor(env, all),
    siblings: siblings.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.name.localeCompare(b.name)),
    by, bySource, at
  };
}

// Miljøer der har forladt en pipeline, og som søskendenes rækker skal glemme.
// Listen står på selve miljøet (setupForget) og tømmes først når rækken er
// skrevet — så en org der ikke kan nås nu, eller en server der genstartes
// imens, stadig får besked næste gang man er logget ind dér.
const FORGET_MAX = 20;
function addForget(c, post) {
  const liste = (Array.isArray(c.setupForget) ? c.setupForget : []).filter(x => !sameSibling(x, post));
  liste.push(post);
  c.setupForget = liste.slice(-FORGET_MAX);
}

// To rækker siger det samme, hvis kun hvem og hvornår er forskellige.
const setupComparable = row => { const { by, bySource, at, ...rest } = row || {}; return JSON.stringify(rest); };
const sameSetup = (a, b) => !!a && !!b && setupComparable(a) === setupComparable(b);

// Hvor er org'ens række uenig med miljøet? apply er det org'en vinder på;
// held er det der IKKE tages automatisk:
//   · et trin denne pc ikke kender
//   · prod-vagtens egne felter på et prod-miljø. Ellers kunne en hvilken som
//     helst række i en datatabel slå vagten fra på alle andre pc'er — sætte
//     trinnet til uat eller fjerne gruppekravet. Ændres de, skal det ske under
//     ⚙ Indstillinger, med det login vagten kræver.
function setupChanges(local, row, stages = STAGES) {
  const org = isSetupRow(row) ? row.env : {};
  const apply = {}, held = [];
  const prodLokalt = stageOf(local) === 'prod' && !isDemo(local);
  for (const k of SETUP_SHARED) {
    if (org[k] === undefined || org[k] === null) continue;
    const fra = String(local[k] ?? ''), til = String(org[k]).trim();
    if (fra === til) continue;
    if (k === 'stage' && til && !stages.includes(til)) { held.push({ field: k, local: fra, org: til, reason: 'unknown-stage' }); continue; }
    if (prodLokalt && PROD_GUARDED_FIELDS.includes(k)) { held.push({ field: k, local: fra, org: til, reason: 'prod-guarded' }); continue; }
    apply[k] = til;
  }
  return { apply, held };
}

// Org'ens trin flettes ind i den lokale liste — de erstatter den aldrig, for
// så ville én kundes trin fjerne en anden kundes. Et nyt trin lægges efter det
// nærmeste trin før det i org'ens liste, og prod bliver stående sidst.
function mergeStages(local, remote) {
  const ud = [...local];
  if (!Array.isArray(remote)) return ud;
  let efter = -1;
  for (const s0 of remote) {
    const s = String(s0 || '').toLowerCase();
    if (!STAGE_NAME.test(s)) continue;
    const i = ud.indexOf(s);
    if (i !== -1) { efter = i; continue; }
    const prod = ud.indexOf('prod');
    let pos = efter + 1;
    if (prod !== -1 && pos > prod) pos = prod;
    ud.splice(pos, 0, s);
    efter = pos;
  }
  return stageListError(ud).stages ? ud : [...local];
}

// Miljøet efter org'ens række er lagt ind. Ren funktion: { env, applied, held }.
function applyOrgSetup(env, row, all, stages = STAGES) {
  if (!isSetupRow(row)) return { env, applied: [], held: [] };
  const { apply, held } = setupChanges(env, row, stages);
  const andre = all.filter(c => c.id !== env.id);
  const applied = [];
  const ud = { ...env };
  for (const [k, v] of Object.entries(apply)) {
    const fejl = envFieldError({ [k]: v }, andre);
    if (fejl) { held.push({ field: k, local: String(env[k] ?? ''), org: v, reason: 'invalid', error: fejl }); continue; }
    applied.push({ field: k, from: String(env[k] ?? ''), to: v });
    ud[k] = v;
  }
  // Ville trin, kunde eller gruppe få miljøet til at støde ind i et andet med
  // samme præfiks i samme org, tages ingen af dem.
  if (applied.length && prefixClash(ud, all.map(c => c.id === env.id ? ud : c))) {
    for (const a of applied) { held.push({ field: a.field, local: a.from, org: a.to, reason: 'clash' }); ud[a.field] = env[a.field]; }
    applied.length = 0;
  }
  if (row.pipelineId && typeof row.pipelineId === 'string' && row.pipelineId.length <= 64) ud.pipelineId = row.pipelineId;
  const taget = new Set([...(ud.takenPrefixes || []), ...(Array.isArray(row.takenPrefixes) ? row.takenPrefixes : [])]);
  taget.delete(prefixOf(ud));
  ud.takenPrefixes = [...taget].filter(p => /^[A-Za-z0-9_\-]{1,20}$/.test(String(p))).sort();
  return { env: ud, applied, held };
}

// Gemmer felter på ét miljø. Listen læses og skrives uden et await imellem, så
// to opgaver i baggrunden ikke kan skrive hinandens ændringer over.
function patchEnv(id, patch) {
  const all = loadCustomers();
  const i = all.findIndex(c => c.id === id);
  if (i === -1) return null;
  all[i] = { ...all[i], ...patch };
  saveCustomers(all);
  return all[i];
}

// Lægger org'ens trin til den lokale liste. Returnerer de nye trin.
function adoptStages(remote) {
  const ny = mergeStages(STAGES, remote);
  const tilfoejet = ny.filter(s => !STAGES.includes(s));
  if (!tilfoejet.length) return [];
  applyStages(ny);
  saveSettings({ stages: ny });
  addLog('INFO', `Stages added from the org: ${tilfoejet.join(', ')} — now ${ny.join(' → ')}`, null, 'MANIFEST');
  return tilfoejet;
}

// Gemmer et miljø efter org'en har vundet, og flytter eksportmappen med navnet.
function commitOrgSetup(before, after) {
  const all = loadCustomers();
  const i = all.findIndex(c => c.id === before.id);
  if (i === -1) return null;
  all[i] = { ...all[i], ...after };
  saveCustomers(all);
  if (before.name !== all[i].name) moveCustomerFolder(before.name, all[i].name);
  return all[i];
}

// Skriver miljøets opsætningsrække. current er rækken som den står i org'en
// lige nu (null = ingen), så en uændret række ikke skrives igen.
async function writeSetupRow(env, current) {
  if (!stageOf(env)) return { ok: true, skipped: 'loose' };
  // Også opsætningen er en skrivning i org'en. I prod kræver den samme login
  // som alt andet — ellers bliver den stående til næste gang.
  const blocked = prodWriteBlock(env, tokenStore[env.id]);
  if (blocked) { patchEnv(env.id, { setupPending: true }); return { ok: false, reason: blocked.code }; }
  const all = loadCustomers();
  const nu = all.find(c => c.id === env.id) || env;
  const glem = (Array.isArray(nu.setupForget) ? nu.setupForget : []).map(cleanSibling).filter(Boolean);
  const row = setupRowFor(nu, all, { previous: current, forget: glem });
  if (current && sameSetup(current, row)) {
    patchEnv(env.id, { setupPending: false, setupAt: current.at || null, setupForget: undefined });
    return { ok: true, unchanged: true };
  }
  const who = await whoAmI(nu);
  row.by = who.by; row.bySource = who.bySource;
  const r = await putOrgManifestRow(nu, SETUP_KEY, row);
  if (!r.ok) return r;
  patchEnv(env.id, { setupPending: false, setupAt: row.at, setupForget: undefined });
  return { ok: true, wrote: true };
}

// Læser rækken. undefined = ingen tabel, null = ingen (brugbar) række.
async function readSetupRow(env) {
  const row = await readOrgManifestRow(env, SETUP_KEY);
  if (row === undefined || row === null) return row;
  if (isSetupRow(row)) return row;
  addLog('WARN', `The setup row in ${manifestTableName(env)} (${env.name}) is not in ArchyGUI's format — ignored and rewritten`, env.name, 'MANIFEST');
  return null;
}

// Søskendelisten fra de andre miljøers rækker i pipelinen — de der kan nås nu.
// Bruges når en tabel bygges op igen: den nye række kender ellers kun de
// miljøer denne pc har, og et miljø i en anden org ville forsvinde fra listen.
// Returnerer den række der står (eller en tom, hvis ingen), med listen udvidet.
async function siblingsFromPeers(env, current) {
  const andre = pipelinePeers(env, loadCustomers()).filter(c => c.id !== env.id && !isDemo(c));
  const fundet = [];
  await Promise.all(andre.map(async c => {
    try {
      const r = await readSetupRow(c);
      if (isSetupRow(r)) fundet.push(...(r.siblings || []).map(cleanSibling).filter(Boolean));
    } catch (_) { /* ingen forbindelse dér lige nu — de fletter sig ind ved næste sync */ }
  }));
  if (!fundet.length) return current;
  const basis = isSetupRow(current) ? current : { kind: 'archygui-setup', env: {}, siblings: [] };
  const siblings = [...(basis.siblings || [])];
  for (const f of fundet) if (!siblings.some(x => sameSibling(x, f))) siblings.push(f);
  return { ...basis, siblings };
}

// Skubber miljøets egen opsætning til org'en. Er org'ens række ændret siden vi
// sidst så den, og er den uenig med os, skrives der IKKE ovenpå — så skal
// brugeren vælge, i guiden.
async function pushSetup(envId) {
  const env = loadCustomers().find(c => c.id === envId);
  if (!env || !stageOf(env)) return { ok: true, skipped: 'loose' };
  let row;
  try { row = await readSetupRow(env); }
  catch (e) { patchEnv(envId, { setupPending: true }); return { ok: false, error: describeApiError(e) }; }
  if (row === undefined) return { ok: false, reason: 'no-table' };
  if (row && row.at !== env.setupAt) {
    const { apply, held } = setupChanges(env, row);
    if (Object.keys(apply).length || held.length) { patchEnv(envId, { setupPending: true }); return { ok: false, conflict: true }; }
  }
  return writeSetupRow(env, row);
}

// Henter org'ens opsætning ind (org'en vinder) og skriver bagefter det org'en
// mangler — fx en søskendeliste der er blevet længere.
async function syncSetup(envId) {
  ensurePipelineIdsSaved();
  let env = loadCustomers().find(c => c.id === envId);
  if (!env) return { ok: false, error: 'Ukendt miljø' };
  if (!stageOf(env)) return { ok: true, skipped: 'loose' };
  let row;
  try { row = await readSetupRow(env); }
  catch (e) { return { ok: false, error: describeApiError(e) }; }
  if (row === undefined) return { ok: true, noTable: true };

  const uenighed = () => {
    const { apply, held } = setupChanges(env, row);
    return [...Object.entries(apply).map(([field, org]) => ({ field, local: String(env[field] ?? ''), org })), ...held];
  };
  // Har denne pc en rettelse der ikke er skrevet, og har nogen ændret org'ens
  // række imens, er der to sandheder. Så vælger brugeren.
  if (row && env.setupPending && row.at !== env.setupAt) {
    const fields = uenighed();
    if (fields.length) return { ok: true, conflict: true, fields, orgBy: row.by || null, orgAt: row.at || null };
  }

  let applied = [], stagesAdded = [];
  if (row && !env.setupPending) {
    stagesAdded = adoptStages(row.stages);
    const r = applyOrgSetup(env, row, loadCustomers());
    applied = r.applied;
    // Det org'en ikke fik lov at bestemme, skrives heller ikke ovenpå.
    if (r.held.length)
      return { ok: true, conflict: true, fields: r.held, applied, stagesAdded, orgBy: row.by || null, orgAt: row.at || null };
    env = commitOrgSetup(env, r.env) || env;
    if (applied.length)
      addLog('INFO', `Setup from the org applied to ${env.name}: ${applied.map(a => `${a.field} "${a.from}" → "${a.to}"`).join(', ')}`, env.name, 'MANIFEST');
  }
  const w = await writeSetupRow(env, row);
  if (w.wrote) addLog('INFO', `Setup row written in ${manifestTableName(env)}${row ? ' (updated)' : ' (first write)'}`, env.name, 'MANIFEST');
  return { ok: true, applied, stagesAdded, wrote: !!w.wrote, pending: !w.ok, reason: w.reason || null };
}

// Skubber opsætningen for flere miljøer i baggrunden. Bruges når et miljø er
// oprettet, rettet eller slettet: så har søskendene i pipelinen fået en ny
// liste, og den skal stå i deres orgs også.
function setupInBackground(ids, why) {
  const liste = [...new Set(ids)].filter(Boolean);
  if (!liste.length) return;
  setImmediate(async () => {
    for (const id of liste) {
      const env = loadCustomers().find(c => c.id === id);
      if (!env || !stageOf(env)) continue;
      try {
        const r = await pushSetup(id);
        if (r.wrote) addLog('INFO', `Setup row written in ${manifestTableName(env)} (${why})`, env.name, 'MANIFEST');
        else if (r.conflict) addLog('WARN', `The setup in ${env.name}'s org differs from this PC — open 📋 the setup guide to choose`, env.name, 'MANIFEST');
        else if (!r.ok && r.reason !== 'no-table')
          addLog('INFO', `Setup row for ${env.name} not written yet (${r.reason || r.error}) — it is written at the next login or check`, env.name, 'MANIFEST');
      } catch (e) {
        // Org'en kunne ikke nås (eller afviste skrivningen). Rækken bliver
        // stående som ikke-skrevet og prøves igen ved næste login eller tjek.
        patchEnv(id, { setupPending: true });
        addLog('WARN', `Could not write the setup row for ${env.name}: ${describeApiError(e)} — tried again at the next login or check`, env.name, 'MANIFEST');
      }
    }
  });
}

// Efter et miljø er oprettet, rettet eller slettet: hvem skal have deres
// opsætningsrække skrevet om? before/after er miljøet før og efter (null ved
// oprettelse og sletning).
function afterEnvChange(before, after, why) {
  const relevant = !before || !after || SETUP_SIBLING_FIELDS.some(k => String(before[k] ?? '') !== String(after[k] ?? ''));
  if (!relevant || (!stageOf(before || {}) && !stageOf(after || {}))) return;
  const all = loadCustomers();
  let gem = false;
  // Skifter miljøet kunde eller gruppe her på pc'en, skifter det pipeline — så
  // skal det ikke tage det gamle pipelineId med sig.
  const nu0 = after && all.find(c => c.id === after.id);
  if (before && nu0 && nu0.pipelineId && nu0.pipelineId === before.pipelineId &&
      (tenantOf(before) !== tenantOf(nu0) || groupOf(before) !== groupOf(nu0))) { delete nu0.pipelineId; gem = true; }
  if (ensurePipelineIds(all).length) gem = true;
  const ids = new Set();
  if (after) {
    const nu = all.find(c => c.id === after.id);
    // En rettelse af de delte felter er denne pc's sandhed, til den er skrevet.
    if (nu && before && stageOf(nu) && SETUP_SHARED.some(k => String(before[k] ?? '') !== String(after[k] ?? ''))) {
      nu.setupPending = true; gem = true;
    }
    if (nu) pipelinePeers(nu, all).forEach(c => ids.add(c.id));
  }
  if (before) pipelinePeers(before, all).forEach(c => ids.add(c.id));
  // Har miljøet forladt pipelinen (intet trin, anden kunde/gruppe) eller skiftet
  // identitet (præfiks, org, klient), skal de gamle søskende glemme den gamle
  // post. En sletning tæller IKKE: at fjerne et miljø fra denne pc fjerner det
  // ikke fra pipelinen — en anden pc kan sagtens have det.
  if (before && after && stageOf(before)) {
    const nu = all.find(c => c.id === after.id) || after;
    const forladt = !stageOf(nu) || !(sameGroup(nu, before) || (before.pipelineId && nu.pipelineId === before.pipelineId));
    const gammel = setupSibling(before);
    if (forladt || !sameSibling(gammel, setupSibling(nu)))
      for (const c of pipelinePeers(before, all)) if (c.id !== after.id)
        { addForget(c, gammel); gem = true; }
  }
  if (gem) saveCustomers(all);
  setupInBackground([...ids], why);
}

// Hvad opdagelsen fandt, gjort klar til brugerfladen. Ren funktion.
//   tables: [{ id, name, prefix, setup }] — org'ens manifest-tabeller
// cards er miljøerne i DENNE org; elsewhere er pipelinens miljøer i andre orgs,
// som denne pc ikke har.
function discoveryResult(env, all, orgId, tables) {
  const iOrg = c => !isDemo(c) && (orgId && c.orgId ? c.orgId === orgId : orgKeyOf(c) === orgKeyOf(env));
  const selv = s => !!(env.setupAt || (s && s.env.stage && s.env.stage === stageOf(env)));
  const cards = tables.map(t => {
    const s = t.setup;
    const lokal = all.find(c => iOrg(c) && stageOf(c) && prefixOf(c) === t.prefix);
    return {
      tableId: t.id, table: t.name, prefix: t.prefix,
      setup: s ? { ...s.env, pipelineId: s.pipelineId || null, by: s.by || null, at: s.at || null,
                   siblings: (s.siblings || []).length } : null,
      // Miljøet selv — men kun når det er bekræftet: koblet før (setupAt) eller
      // på samme trin. Et nyt miljø der bare har samme præfiks, er ikke koblet.
      localId: lokal && (lokal.id !== env.id || selv(s)) ? lokal.id : null,
      self: !!(lokal && lokal.id === env.id && selv(s)),
      wrongOrg: !!(s && s.env.orgId && orgId && s.env.orgId !== orgId)
    };
  }).sort((a, b) => stageOrder(a.setup?.stage) - stageOrder(b.setup?.stage) || a.prefix.localeCompare(b.prefix));

  const set = new Set(), elsewhere = [];
  for (const t of tables) for (const sib of (t.setup?.siblings || [])) {
    const pfx = String(sib.prefix || '');
    if (orgId && sib.orgId === orgId) continue;                       // står som kort
    if (!sib.orgId && tables.some(x => x.prefix === pfx) && sib.region === env.region) continue;
    const key = `${sib.orgId || (sib.region + '|' + sib.clientId)}|${pfx}`;
    if (set.has(key)) continue;
    set.add(key);
    const kendt = all.find(c => !isDemo(c) && prefixOf(c) === pfx &&
      (sib.orgId ? c.orgId === sib.orgId : (c.clientId === sib.clientId && c.region === sib.region)));
    if (kendt) continue;
    elsewhere.push({ name: String(sib.name || ''), stage: String(sib.stage || ''), prefix: pfx,
                     region: String(sib.region || ''), orgId: sib.orgId || null, orgLabel: String(sib.orgLabel || ''),
                     clientId: String(sib.clientId || ''),
                     tenant: t.setup.env.tenant || '', group: t.setup.env.group || '',
                     pipelineId: t.setup.pipelineId || null });
  }
  elsewhere.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.name.localeCompare(b.name));
  return { cards, elsewhere };
}

const masked = c => c ? { ...c, clientSecret: '••••••••' } : c;

// org'ens manifest-tabeller med præfiks. Andre tabeller der tilfældigvis ender
// på samme navn, men ikke kan være vores (ugyldigt præfiks), springes over.
async function orgManifestTables(env) {
  return (await listAllTables(env))
    .filter(t => t.name.endsWith(ORG_MANIFEST_BASE))
    .map(t => ({ ...t, prefix: t.name.slice(0, -ORG_MANIFEST_BASE.length) }))
    .filter(t => !envFieldError({ prefix: t.prefix }));
}

app.post('/api/setup/discover', async (req, res) => {
  const env = loadCustomers().find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(env)) return res.json({ ok: true, demo: true, cards: [], elsewhere: [] });
  try {
    const tabeller = await orgManifestTables(env);
    for (const t of tabeller) {
      try { const r = await readTableRow(env, t.id, SETUP_KEY); t.setup = isSetupRow(r) ? r : null; }
      catch (_) { t.setup = null; }
    }
    const orgId = tokenStore[env.id]?.orgId || await getOrgId(env);
    // Scanningen ser hvilke præfikser org'en bruger. De holdes ude af et
    // miljø uden præfiks, også hvis søskendene ikke er tilføjet her.
    const taget = tabeller.map(t => t.prefix).filter(p => p && p !== prefixOf(env)).sort();
    patchEnv(env.id, { takenPrefixes: taget });
    addLog('INFO', `Discovery in ${env.name}'s org: ${tabeller.length} ArchyGUI table(s)` +
      (tabeller.length ? ` (${tabeller.map(t => t.name).join(', ')})` : ''), env.name, 'MANIFEST');
    res.json({ ok: true, orgId, orgName: tokenStore[env.id]?.orgName || '',
               ...discoveryResult(env, loadCustomers(), orgId, tabeller) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Brugerens valg efter opdagelsen:
//   use      — miljøet ER det miljø tabellen beskriver. Skriver intet.
//   template — et nyt miljø i org'en, med en fundet opsætning som skabelon
//   pipeline — et nyt miljø og en ny pipeline (ingen tabel fundet)
//   loose    — kun import/eksport: intet trin, ingen tabel, intet i org'en
app.post('/api/setup/adopt', async (req, res) => {
  const tr = v => String(v ?? '').trim();
  const all = loadCustomers();
  const env = all.find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(env)) return res.status(400).json({ error: 'Demo-miljøer har ingen org.' });
  const mode = tr(req.body.mode), f = req.body.fields || {};
  const andre = all.filter(c => c.id !== env.id);

  if (mode === 'loose') {
    const ud = patchEnv(env.id, { stage: '', setupPending: false });
    afterEnvChange(env, ud, 'environment set to import/export only');
    addLog('INFO', `${env.name} set to import/export only — nothing is written to its org`, env.name, 'MANIFEST');
    return res.json({ ok: true, env: masked(ud) });
  }
  if (!['use', 'template', 'pipeline'].includes(mode)) return res.status(400).json({ error: `Ukendt valg "${mode}"` });
  // Et miljø der allerede er koblet til en tabel, gøres ikke om til et andet:
  // det ville omdøbe det og flytte det til et andet trin. Vil man have flere
  // miljøer i org'en, tilføjes de (add-card), og vil man bygge et nyt, opretter
  // man et nyt miljø først.
  if (stageOf(env) && env.setupAt)
    return res.status(400).json({ error: `"${env.name}" er allerede koblet til sin tabel. Brug «Tilføj som nyt miljø» for at få et af de andre miljøer på denne pc.` });

  // Tabellerne læses igen her — klienten vælger kun HVILKEN.
  let tabeller;
  try { tabeller = await orgManifestTables(env); }
  catch (e) { return res.status(500).json({ error: describeApiError(e) }); }
  const orgPrefikser = tabeller.map(t => t.prefix);
  const orgId = tokenStore[env.id]?.orgId || env.orgId || null;
  const laesSetup = async t => { try { const r = await readTableRow(env, t.id, SETUP_KEY); return isSetupRow(r) ? r : null; } catch (_) { return null; } };

  let ud, applied = [], stagesAdded = [], skriv = false;
  if (mode === 'use') {
    const t = tabeller.find(x => x.id === req.body.tableId);
    if (!t) return res.status(404).json({ error: 'Tabellen findes ikke længere i org\'en — kør Tjek forbindelse igen.' });
    const row = await laesSetup(t);
    if (row && row.env.orgId && orgId && row.env.orgId !== orgId)
      return res.status(400).json({ error: `Tabellen beskriver et miljø i en anden org (${row.env.orgId}). Den er ikke taget i brug.` });
    ud = { ...env, prefix: t.prefix };
    if (row) {
      stagesAdded = adoptStages(row.stages);
      // Et bevidst valg af org'ens miljø: alle delte felter tages, også trinnet.
      const r = applyOrgSetup({ ...ud, stage: '' }, row, all);
      if (r.held.length) return res.status(400).json({ error: `Opsætningen kan ikke tages i brug: ${r.held.map(h => h.error || `${h.field} "${h.org}"`).join('; ')}` });
      ud = { ...r.env };
      applied = r.applied;
      ud.setupAt = row.at || null;
      ud.setupPending = false;
    } else {
      // En tabel fra før opsætningsrækken: trinnet kan ikke gættes — en tabel
      // uden præfiks kan være både UAT og prod. Brugeren vælger.
      const stage = tr(f.stage).toLowerCase();
      if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Tabellen har ingen opsætning endnu — vælg hvilket trin miljøet er.' });
      ud = { ...ud, stage, tenant: tr(f.tenant) || env.tenant || '', group: tr(f.group) || env.group || '', setupPending: true };
      skriv = true;
    }
  } else {
    const stage = tr(f.stage).toLowerCase();
    if (!STAGES.includes(stage)) return res.status(400).json({ error: `Vælg et trin: ${STAGES.join(', ')}` });
    const prefix = tr(f.prefix);
    if (orgPrefikser.includes(prefix))
      return res.status(400).json({ error: prefix ? `Præfikset "${prefix}" er allerede i brug i denne org.` : 'Der findes allerede et miljø uden præfiks i denne org — giv det nye et præfiks (fx UAT_).' });
    ud = { ...env, stage, prefix, name: tr(f.name) || env.name,
           tenant: tr(f.tenant) || env.tenant || '', group: tr(f.group) || env.group || '' };
    // undefined, ikke delete: commitOrgSetup fletter, og et slettet felt ville
    // bare komme igen fra den gemte post. JSON dropper undefined.
    ud.pipelineId = undefined;
    if (mode === 'template') {
      const t = tabeller.find(x => x.id === req.body.tableId);
      if (!t) return res.status(404).json({ error: 'Skabelonen findes ikke længere i org\'en — kør Tjek forbindelse igen.' });
      const row = await laesSetup(t);
      if (row) {
        const e = row.env;
        ud.tenant = tr(f.tenant) || e.tenant || ud.tenant;
        ud.group  = tr(f.group)  || e.group  || ud.group;
        ud.orgLabel = e.orgLabel || ud.orgLabel || '';
        // Deploy-kravene hører til prod; divisionen og farven er miljøets egne.
        if (stage === 'prod') { ud.deployPermission = e.deployPermission || ''; ud.deployGroup = e.deployGroup || ''; }
        if (row.pipelineId) ud.pipelineId = row.pipelineId;
        stagesAdded = adoptStages(row.stages);
      }
    }
    skriv = true;
  }
  ud.takenPrefixes = orgPrefikser.filter(p => p && p !== prefixOf(ud)).sort();

  const changed = {};
  for (const k of ['name', 'tenant', 'group', 'prefix', 'orgLabel', 'color', 'deployPermission', 'deployGroup'])
    if (String(env[k] ?? '') !== String(ud[k] ?? '')) changed[k] = ud[k];
  const fejl = envFieldError(changed, andre) || prefixClash(ud, all.map(c => c.id === env.id ? ud : c));
  if (fejl) return res.status(400).json({ error: fejl });

  const gemt = commitOrgSetup(env, ud);
  ensurePipelineIdsSaved();
  delete _mfTableCache[env.id];
  addLog('INFO', `${gemt.name} ${mode === 'use' ? 'linked to' : 'created next to'} the ArchyGUI table${mode === 'use' ? ' ' + manifestTableName(gemt) : 's'} in its org` +
    (applied.length ? ` — taken from the org: ${applied.map(a => a.field).join(', ')}` : ''), gemt.name, 'MANIFEST');

  let tableCreated = false, blocked = null, writeError = null;
  if (mode !== 'use') {
    // Den nye tabel er en skrivning i org'en — i prod med samme login som alt andet.
    const nu = loadCustomers().find(c => c.id === env.id);
    const b = prodWriteBlock(nu, tokenStore[nu.id]);
    if (b) blocked = b;
    else {
      try {
        await createOrgManifestTable(nu);
        await writeSetupRow(loadCustomers().find(c => c.id === env.id), null);
        tableCreated = true;
      } catch (e) { writeError = describeApiError(e); addLog('ERROR', `Could not create the manifest table for ${nu.name}: ${writeError}`, nu.name, 'MANIFEST'); }
    }
  }
  const nu = loadCustomers().find(c => c.id === env.id);
  // Søskendene får miljøet på deres liste; en gammel tabel får sin række.
  setupInBackground(pipelinePeers(nu, loadCustomers()).map(c => c.id)
    .filter(id => skriv || id !== nu.id).filter(id => !(tableCreated && id === nu.id)), 'environment added from discovery');
  res.json({ ok: true, env: masked(nu), applied, stagesAdded, tableCreated,
             blocked: blocked ? blocked.code : null, blockedError: blocked ? blocked.error : null, error: writeError });
});

// Tilføjer et miljø fra pipelinens søskendeliste — typisk prod i en anden org.
// Org-id'et sættes med det samme, så login'et afvises hvis man vælger en
// anden org på Genesys' side: sådan tjekkes det at listen taler sandt.
app.post('/api/setup/add-sibling', (req, res) => {
  const tr = v => String(v ?? '').trim();
  const all = loadCustomers();
  const fra = all.find(c => c.id === req.body?.fromEnvId);
  if (!fra) return res.status(404).json({ error: 'Ukendt miljø' });
  const s = req.body.sibling || {};
  const env = {
    id: Date.now().toString(), name: tr(req.body.name || s.name), clientId: tr(req.body.clientId || s.clientId),
    clientSecret: '', region: tr(s.region), authType: 'oauth',
    tenant: tr(s.tenant) || fra.tenant || '', group: tr(s.group) || fra.group || '',
    stage: tr(s.stage).toLowerCase(), prefix: tr(s.prefix), orgLabel: tr(s.orgLabel), color: '',
    division: '', deployPermission: '', deployGroup: '',
    pipelineId: tr(s.pipelineId) || fra.pipelineId || undefined
  };
  if (!env.name || !env.clientId) return res.status(400).json({ error: 'Navn og Client ID skal udfyldes.' });
  if (!STAGES.includes(env.stage)) return res.status(400).json({ error: `Ukendt trin "${s.stage}" — tilføj det under Kunder → Trin først.` });
  const fejl = envFieldError({ name: env.name, clientId: env.clientId, region: env.region, tenant: env.tenant,
                               group: env.group, prefix: env.prefix, orgLabel: env.orgLabel }, all);
  if (fejl) return res.status(400).json({ error: fejl });
  if (s.orgId) {
    if (!GUID.test(String(s.orgId))) return res.status(400).json({ error: 'Org-id\'et i søskendelisten er ikke gyldigt.' });
    env.orgId = String(s.orgId);
    const ejer = all.find(c => c.orgId === env.orgId && !isDemo(c) && tenantOf(c) !== tenantOf(env));
    if (ejer) return res.status(400).json({ error: `Org'en hører til "${ejer.name}" hos en anden kunde på denne pc.` });
  }
  const clash = prefixClash(env, all);
  if (clash) return res.status(400).json({ error: clash });
  all.push(env);
  saveCustomers(all);
  addLog('INFO', `Environment added from the pipeline's sibling list: ${env.name} (${env.stage}, region ${env.region}) — log in to confirm the org`, env.name, 'CUSTOMER');
  res.json({ ok: true, env: masked(env) });
});

// Tilføjer et miljø fra et kort i SAMME org som et ekstra miljø på denne pc —
// fx dev, når man starter med prod. Det er miljøet tabellen beskriver, så det
// kobles med det samme (setupAt), og der skrives intet i org'en. Login'et er
// PKCE i den samme org; en client credentials-klient kræver en secret, og den
// deles aldrig, så den må rettes bagefter under ⚙ Indstillinger.
app.post('/api/setup/add-card', async (req, res) => {
  const tr = v => String(v ?? '').trim();
  const all = loadCustomers();
  const fra = all.find(c => c.id === req.body?.fromEnvId);
  if (!fra) return res.status(404).json({ error: 'Ukendt miljø' });
  if (isDemo(fra)) return res.status(400).json({ error: 'Demo-miljøer har ingen org.' });
  try {
    const tabeller = await orgManifestTables(fra);
    const t = tabeller.find(x => x.id === req.body.tableId);
    if (!t) return res.status(404).json({ error: 'Tabellen findes ikke længere i org\'en — kør Tjek forbindelse igen.' });
    const row = await readTableRow(fra, t.id, SETUP_KEY).catch(() => null);
    if (!isSetupRow(row) || !row.env.stage)
      return res.status(400).json({ error: 'Tabellen har ingen opsætning at bygge miljøet af. Brug «Brug dette» og vælg trinnet.' });
    const orgId = tokenStore[fra.id]?.orgId || fra.orgId || null;
    if (row.env.orgId && orgId && row.env.orgId !== orgId)
      return res.status(400).json({ error: `Tabellen beskriver et miljø i en anden org (${row.env.orgId}).` });
    if (all.some(c => c.id !== fra.id && !isDemo(c) && stageOf(c) && prefixOf(c) === t.prefix &&
                      (orgId && c.orgId ? c.orgId === orgId : orgKeyOf(c) === orgKeyOf(fra))))
      return res.status(400).json({ error: 'Miljøet findes allerede på denne pc.' });
    const clientId = tr(req.body.clientId) || (fra.authType === 'oauth' ? fra.clientId : '');
    const e = row.env;
    const env = {
      id: Date.now().toString(), name: tr(e.name), clientId, clientSecret: '', region: tr(e.region) || fra.region,
      authType: 'oauth', tenant: tr(e.tenant) || fra.tenant || '', group: tr(e.group) || fra.group || '',
      stage: tr(e.stage).toLowerCase(), prefix: t.prefix, orgLabel: tr(e.orgLabel), color: tr(e.color),
      division: tr(e.division), deployPermission: tr(e.deployPermission), deployGroup: tr(e.deployGroup),
      orgId: orgId || undefined, setupAt: row.at || null, setupPending: false,
      takenPrefixes: tabeller.map(x => x.prefix).filter(p => p && p !== t.prefix).sort(),
      pipelineId: (typeof row.pipelineId === 'string' && row.pipelineId) || fra.pipelineId || undefined
    };
    if (!env.name || !env.clientId)
      return res.status(400).json({ error: 'Client ID til en PKCE-klient i org\'en skal udfyldes.' });
    if (!STAGES.includes(env.stage)) adoptStages(row.stages);
    if (!STAGES.includes(env.stage)) return res.status(400).json({ error: `Ukendt trin "${e.stage}" — tilføj det under Kunder → Trin først.` });
    const fejl = envFieldError({ name: env.name, clientId: env.clientId, region: env.region, tenant: env.tenant,
                                 group: env.group, prefix: env.prefix, orgLabel: env.orgLabel }, all);
    if (fejl) return res.status(400).json({ error: fejl });
    const clash = prefixClash(env, all);
    if (clash) return res.status(400).json({ error: clash });
    // Listen læses igen lige før den gemmes: adoptStages kan have ændret indstillinger.
    const nu = loadCustomers();
    nu.push(env);
    saveCustomers(nu);
    addLog('INFO', `Environment added from the ArchyGUI table ${t.name}: ${env.name} (${env.stage}) — log in to confirm`, env.name, 'CUSTOMER');
    res.json({ ok: true, env: masked(env) });
  } catch (err) {
    res.status(500).json({ error: describeApiError(err) });
  }
});

app.post('/api/setup/sync', async (req, res) => {
  try { res.json(await syncSetup(String(req.body?.envId || ''))); }
  catch (e) { res.status(500).json({ error: describeApiError(e) }); }
});

// Uenighed mellem pc og org: brugeren vælger hvem der har ret.
//   org   — org'ens række tages. Prod-vagtens felter kun med prod-login.
//   local — denne pc's opsætning skrives til org'en.
app.post('/api/setup/resolve', async (req, res) => {
  const env = loadCustomers().find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Ukendt miljø' });
  const choice = String(req.body.choice || '');
  if (!['org', 'local'].includes(choice)) return res.status(400).json({ error: `Ukendt valg "${choice}"` });
  try {
    const row = await readSetupRow(env);
    if (row === undefined) return res.status(400).json({ error: 'Miljøet har ingen manifest-tabel.' });
    if (choice === 'local' || !row) {
      patchEnv(env.id, { setupAt: row ? row.at || null : null, setupPending: true });
      const w = await writeSetupRow(loadCustomers().find(c => c.id === env.id), row);
      if (!w.ok) return res.status(w.reason === 'prod-login' || w.reason === 'prod-rights' ? 403 : 500)
        .json({ error: prodWriteBlock(env, tokenStore[env.id])?.error || w.error || w.reason });
      addLog('INFO', `Setup conflict for ${env.name} resolved: this PC's setup written to the org`, env.name, 'MANIFEST');
      return res.json({ ok: true, wrote: true });
    }
    const { apply, held } = setupChanges(env, row);
    // Her vælger brugeren org'en bevidst — også det der ellers holdes tilbage.
    const alt = { ...apply };
    for (const h of held) alt[h.field] = h.org;
    const laast = prodSettingsBlock(env, alt, tokenStore[env.id]);
    if (laast) return res.status(403).json(laast);
    if (held.some(h => h.reason === 'unknown-stage')) adoptStages(row.stages);
    if (alt.stage && !STAGES.includes(alt.stage)) return res.status(400).json({ error: `Ukendt trin "${alt.stage}" — tilføj det under Kunder → Trin først.` });
    const fejl = envFieldError(alt, loadCustomers().filter(c => c.id !== env.id));
    if (fejl) return res.status(400).json({ error: fejl });
    const ud = { ...env, ...alt, setupAt: row.at || null, setupPending: false,
                 pipelineId: (typeof row.pipelineId === 'string' && row.pipelineId) || env.pipelineId };
    const clash = prefixClash(ud, loadCustomers().map(c => c.id === env.id ? ud : c));
    if (clash) return res.status(400).json({ error: clash });
    const gemt = commitOrgSetup(env, ud);
    if (Object.keys(alt).some(k => PROD_GUARDED_FIELDS.includes(k))) { delete tokenStore[env.id]; delete _whoCache[env.id]; }
    addLog('INFO', `Setup conflict for ${env.name} resolved: the org's setup taken (${Object.keys(alt).join(', ') || 'no field changes'})`, gemt.name, 'MANIFEST');
    afterEnvChange(env, gemt, 'setup taken from the org');
    res.json({ ok: true, applied: Object.keys(alt) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// ── Genopbygning af manifestet ───────────────────────────────────────────────
// En slettet tabel kan bygges op igen. Hvad org'en indeholder NU, kan altid
// læses i Genesys. Historikken — hvem forfremmede hvad, hvornår, hvorfra — kan
// kun findes på en pc der har den i sine lokale filer. Hver række siger derfor
// hvor den kommer fra (history: 'local' eller 'none'), så tavlen og brugeren
// ikke tror historikken er hel, når den ikke er.
function rebuiltManifestRow(flow, entry, releases = []) {
  const row = entry
    ? { flowName: flow.name, version: entry.targetVersion ?? null, publishedAt: entry.targetPublishedAt ?? null,
        kind: entry.kind || 'migration',
        promotedFrom: entry.kind === 'baseline' ? null : (entry.sourceName || null),
        sourceVersion: entry.sourceVersion ?? null, hash: entry.hash || null }
    : { flowName: flow.name, version: flow.version ?? null, publishedAt: flow.publishedAt ?? null, kind: 'baseline' };
  row.rebuilt = true;
  row.history = entry || releases.length ? 'local' : 'none';
  if (releases.length) row.releases = trimOrgReleases(releases.map(compactRelease), row);
  return row;
}

app.post('/api/manifest/rebuild', async (req, res) => {
  ensurePipelineIdsSaved();
  const env = loadCustomers().find(c => c.id === req.body?.envId);
  if (!env) return res.status(404).json({ error: 'Ukendt miljø' });
  if (!stageOf(env)) return res.status(400).json({ error: `"${env.name}" har intet trin og dermed intet manifest.` });
  // Spørg org'en, ikke hukommelsen: genopbygning sker netop når tabellen er væk.
  delete _mfTableCache[env.id];
  try {
    let created = false;
    if (!isDemo(env) && !(await findOrgManifestTable(env))) { await createOrgManifestTable(env); created = true; }
    const findes = (await readOrgManifest(env)) || {};
    const soeskende = loadCustomers().filter(c => orgKeyOf(c) === orgKeyOf(env));
    const flows = (isDemo(env)
      ? demoFlowsFor(env).map(f => ({ name: f.name, type: f.type, version: f.published ?? null, publishedAt: f.publishedAt ?? null }))
      : (await listAllFlows(env)).map(f => ({ name: f.name, type: f.type,
          version: f.publishedVersion?.name || f.checkedInVersion?.name || null,
          publishedAt: f.publishedVersion?.dateCheckedIn || f.publishedVersion?.dateCreated || null })))
      .filter(f => belongsToEnv(f.name, env, soeskende));
    const lokal = loadManifest(), rels = loadReleases();
    const who = await whoAmI(env);
    let rows = 0, withHistory = 0, kept = 0;
    // Rækkerne skrives nogle ad gangen: et kald pr. række er langsomt ved
    // hundredvis af flows, men for mange på én gang rammer Genesys' grænse.
    const BOLGE = 5;
    const skriv = [];
    for (const f of flows) {
      const base = baseFlowName(stripEnvPrefix(f.name, env));
      const key = orgManifestKey(base, f.type);
      if (findes[key]) { kept++; continue; }        // rækker der står, røres ikke
      const opslag = { targetOrgId: env.orgId || null, targetId: env.id, flowType: f.type };
      const entry = findManifestEntry(lokal, { ...opslag, flowName: base }) || findManifestEntry(lokal, { ...opslag, flowName: f.name });
      const mine = rels.filter(r => r.targetId === env.id && orgManifestKey(r.baseName, r.flowType) === key);
      skriv.push({ key, row: rebuiltManifestRow(f, entry, mine) });
    }
    for (let i = 0; i < skriv.length; i += BOLGE) {
      await Promise.all(skriv.slice(i, i + BOLGE).map(({ key, row }) =>
        putOrgManifestRow(env, key, { ...row, by: who.by, bySource: who.bySource, at: Date.now() })));
    }
    for (const { row } of skriv) { rows++; if (row.history === 'local') withHistory++; }
    // Den nye tabel kender kun de søskende denne pc har. Pipelinens andre orgs
    // har deres egen liste — den hentes ind, så intet af det org'en vidste går tabt.
    const setup = await writeSetupRow(loadCustomers().find(c => c.id === env.id) || env,
      await siblingsFromPeers(env, await readSetupRow(env)));
    addLog('SUCCESS', `Manifest rebuilt in ${env.name}: ${rows} row(s) written (${withHistory} with history from this PC), ` +
      `${kept} kept${created ? ', table created' : ''}`, env.name, 'MANIFEST');
    res.json({ ok: true, created, rows, withHistory, kept, partial: rows > withHistory, setup });
  } catch (e) {
    addLog('ERROR', `Could not rebuild the manifest in ${env.name}: ${describeApiError(e)}`, env.name, 'MANIFEST');
    res.status(500).json({ error: describeApiError(e) });
  }
});



// Org-id pr. kunde. Slås op én gang og huskes — det ændrer sig ikke.
const orgIdCache = {};
async function getOrgId(customer) {
  if (orgIdCache[customer.id]) return orgIdCache[customer.id];
  try {
    const { token, apiBase } = await getToken(customer);
    const r = await axios.get(`${apiBase}/api/v2/organizations/me`,
      { headers: { Authorization: `Bearer ${token}` } });
    if (wrongOrg(customer, r.data.id)) { rememberOrgId(customer, r.data.id); return null; }
    orgIdCache[customer.id] = r.data.id;
    rememberOrgId(customer, r.data.id);
    return r.data.id;
  } catch (_) { return null; }
}

// Flowtyper skrives forskelligt de to steder de kommer fra: API'et siger
// INBOUNDCALL, YAML-roden siger inboundCall. Manifestet gemmer én form.
const normType = t => String(t || '').toUpperCase();

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); } catch (_) { return []; }
}

// Find posten for ét flow i én mål-org. Matcher på org-id når det findes,
// ellers på det lokale kunde-id, så ældre poster stadig kan slås op.
// Sammenlignes på grundnavnet. Et flow skifter navn når det forfremmes
// ("Aabningstider" → "_v10" → "_v15"), og matchede vi på det fulde navn, ville
// hver omdøbning efterlade den gamle linje forældreløs og lave en ny ved siden
// af — så ville vi hverken kunne slå op eller opdatere.
function findManifestEntry(all, { targetOrgId, targetId, flowName, flowType }) {
  const ft = normType(flowType);
  const base = baseFlowName(flowName);
  return all.find(e =>
    baseFlowName(e.flowName) === base && normType(e.flowType) === ft &&
    (e.targetOrgId && targetOrgId ? e.targetOrgId === targetOrgId : e.targetId === targetId));
}

function recordManifest(entry) {
  try {
    const all = loadManifest();
    entry.flowType = normType(entry.flowType);
    // Én linje pr. (mål-org, flow) — den nyeste hændelse er den gældende.
    // Grundnavnet er nøglen, så en omdøbning opdaterer linjen i stedet for at
    // lægge en ny ved siden af.
    const base = baseFlowName(entry.flowName);
    const i = all.findIndex(e =>
      baseFlowName(e.flowName) === base && normType(e.flowType) === entry.flowType &&
      (e.targetOrgId && entry.targetOrgId ? e.targetOrgId === entry.targetOrgId : e.targetId === entry.targetId));
    if (i >= 0) all[i] = { ...all[i], ...entry }; else all.push(entry);
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(all, null, 2));
  } catch (e) {
    addLog('WARN', `Could not write the migration manifest: ${e.message}`, null, 'SYSTEM');
  }
}

app.get('/api/migrations', (req, res) => res.json(loadManifest()));

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

// Listen. Enten ét miljø (evt. ét flow), eller alle miljøer i en gruppe.
app.get('/api/releases', async (req, res) => {
  const { envId, tenant, group, baseName, flowType, limit = '200' } = req.query;
  const all = loadCustomers();
  const envs = envId ? all.filter(c => c.id === envId)
             : all.filter(c => tenant && group && tenantOf(c) === tenant && groupOf(c) === group);
  if (!envs.length) return res.status(404).json({ error: 'Environment not found' });

  let out = [];
  for (const env of envs) {
    let list = await releasesOfEnv(env);
    if (baseName) list = list.filter(r => r.baseName === baseName);
    if (flowType) list = list.filter(r => r.flowType === normType(flowType));
    // Hvilken der kan rulles tilbage — beregnet her, så klienten ikke skal kende reglen.
    const kan = new Set();
    const pr = new Map();
    for (const r of list) {
      const k = `${r.baseName}|${r.flowType}`;
      if (!pr.has(k)) pr.set(k, []);
      pr.get(k).push(r);
    }
    for (const l of pr.values()) { const c = rollbackCandidate(l); if (c) kan.add(c.id); }
    out.push(...list.map(r => ({ ...r, canRollback: kan.has(r.id), ref: releaseRef(r) })));
  }
  out.sort((a, b) => b.at - a.at);
  out = out.slice(0, Math.max(1, Math.min(parseInt(limit, 10) || 200, 2000)));
  res.json({ ok: true, releases: out });
});

app.post('/api/releases/diff', async (req, res) => {
  const f = await findRelease(req.body.ref);
  if (f.error) return res.status(f.status).json({ error: f.error });
  try { res.json({ ok: true, diff: await releaseDiffFor(f.env, f.rel) }); }
  catch (e) {
    addLog('WARN', `Could not build the diff for "${f.rel.toName}" in ${f.env.name}: ${describeApiError(e)}`, f.env.name, 'RELEASE');
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Samlede release notes for flere releases. Mangler en diff, bygges den —
// fejler det, står noten der stadig, bare uden linjerne.
app.post('/api/releases/notes', async (req, res) => {
  const refs = req.body.refs || [];
  if (!refs.length) return res.status(400).json({ error: 'No releases selected' });
  const list = [];
  for (const ref of refs) {
    const f = await findRelease(ref);
    if (f.error) continue;
    let r = f.rel;
    try { r = { ...r, diff: await releaseDiffFor(f.env, r) }; } catch (_) {}
    list.push(r);
  }
  if (!list.length) return res.status(404).json({ error: 'Release not found' });
  list.sort((a, b) => a.at - b.at);
  res.json({ ok: true, markdown: `# Release notes\n\n` + list.map(releaseNoteMarkdown).join('\n\n---\n\n') + '\n' });
});

app.post('/api/releases/note', async (req, res) => {
  const f = await findRelease(req.body.ref);
  if (f.error) return res.status(f.status).json({ error: f.error });
  if (refuseProdWrite(res, f.env, '/api/releases/note')) return;
  const note = String(req.body.note || '').slice(0, 500);
  await mutateRelease(f.env, f.rel.baseName, f.rel.flowType, f.rel.id, r => { r.note = note; });
  res.json({ ok: true });
});

// Efter en rollback eller genpublicering står målet på en højere udgave end
// den manifestet noterede ved forfremmelsen. Uden denne opdatering ville tavlen
// melde "ændret uden om pipelinen" om noget vi selv lige har gjort.
async function noteTargetRepublished(env, baseName, flowType, version, publishedAt, kind) {
  try {
    const rows = await readOrgManifest(env);
    const key = orgManifestKey(baseName, flowType);
    const cur = (rows && rows[key]) || null;
    if (cur || isDemo(env)) {
      await writeOrgManifestRow(env, baseName, flowType, {
        ...(cur || {}), version, publishedAt, kind
      });
    }
  } catch (e) {
    addLog('WARN', `Could not update the manifest in ${env.name}: ${describeApiError(e)}`, env.name, 'MANIFEST');
  }
  const all = loadManifest();
  const hit = findManifestEntry(all, { targetOrgId: null, targetId: env.id, flowName: baseName, flowType });
  if (hit) recordManifest({ ...hit, flowName: hit.flowName, targetVersion: version, targetPublishedAt: publishedAt });
}

// Alle flows i en org, med kladdeoplysninger.
async function listAllFlows(customer) {
  const { token, apiBase } = await getToken(customer);
  const acc = [];
  for (let page = 1; ; page++) {
    const r = await axios.get(`${apiBase}/api/v2/flows`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 100, pageNumber: page, includeDraft: true }
    });
    const e = r.data.entities || [];
    acc.push(...e);
    if (e.length < 100) break;
  }
  return acc;
}

// Har flowet noget der er nyere end den publicerede udgave? Så vil en
// genpublicering af den publicerede udgave erstatte det — og det skal man vide.
function flowHasDraft(f) {
  const pub = versionLabel(f.publishedVersion);
  const saved = versionLabel(f.savedVersion);
  const checked = versionLabel(f.checkedInVersion);
  return !!((saved && saved !== pub) || (checked && checked !== pub));
}

// De flows i et miljø der bruger et common module — også gennem et andet
// modul: bruger modul B modul A, og flow C bruger B, skal både B og C
// publiceres igen når A ændres. Moduler står først i listen, så de er
// publiceret før de flows der kalder dem.
async function dependentsOf(env, moduleName) {
  const seen = new Set([moduleName]);
  const out = [];
  const walk = async (name, depth) => {
    if (depth > 5) return;
    const direkte = isDemo(env) ? demoDependentsOf(env, name) : await realDirectDependents(env, name);
    for (const f of direkte) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      out.push({ ...f, via: name === moduleName ? null : name });
      if (normType(f.type) === 'COMMONMODULE') await walk(f.name, depth + 1);
    }
  };
  await walk(moduleName, 0);
  return [
    ...out.filter(f => normType(f.type) === 'COMMONMODULE'),
    ...out.filter(f => normType(f.type) !== 'COMMONMODULE')
  ];
}

// Genesys' egen afhængighedssporing. Den bygges asynkront efter en
// publicering, men de flows der bruger modulet har brugt det længe — de står
// der allerede. Kun flows der hører til MILJØET tages med: i en præfikset org
// bruger TEST_-flowene TEST_-modulet, og dev's flows er ikke vores sag her.
async function consumerIds(env, moduleId, objectType = 'COMMONMODULEFLOW') {
  const { token, apiBase } = await getToken(env);
  const ids = new Set();
  for (let page = 1; page < 50; page++) {
    const r = await axios.get(`${apiBase}/api/v2/architect/dependencytracking/consumingresources`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { id: moduleId, objectType, pageSize: 100, pageNumber: page }
    });
    const e = r.data.entities || [];
    for (const x of e) ids.add(x.id);
    if (e.length < 100) break;
  }
  return ids;
}

// Et flow binder sig til den udgave af modulet der fandtes da FLOWET blev
// publiceret. Afhængighedssporingen siger ikke hvilken udgave det er — men er
// flowet publiceret før modulet sidst blev det, kører det på en ældre.
const publishedAtMs = f => Date.parse(f?.publishedVersion?.datePublished || '') || null;
function isBehindModule(flow, mod) {
  const a = publishedAtMs(flow), b = publishedAtMs(mod);
  return a !== null && b !== null && a < b;
}

async function realDirectDependents(env, moduleName) {
  const flows = await listAllFlows(env);
  const mod = flows.find(f => f.name === moduleName && normType(f.type) === 'COMMONMODULE');
  if (!mod) throw new Error(`Common module "${moduleName}" was not found in ${env.name}`);
  const ids = await consumerIds(env, mod.id);
  const siblings = loadCustomers().filter(c => orgKeyOf(c) === orgKeyOf(env));
  return flows
    .filter(f => ids.has(f.id) && f.id !== mod.id && belongsToEnv(f.name, env, siblings))
    .map(f => ({ name: f.name, type: f.type, published: versionLabel(f.publishedVersion),
                 hasDraft: flowHasDraft(f), unpublished: !f.publishedVersion,
                 behind: isBehindModule(f, mod) }));
}

// Alle common modules i miljøet der er publiceret EFTER mindst ét af de flows
// der bruger dem. Det er dét man ikke kan se i Architect: modulet er rettet og
// publiceret, men flowene kører videre på den gamle udgave.
async function staleModules(env) {
  if (isDemo(env)) return [];
  await getOrgId(env);
  const flows = await listAllFlows(env);
  const siblings = loadCustomers().filter(c => orgKeyOf(c) === orgKeyOf(env));
  const mine = flows.filter(f => belongsToEnv(f.name, env, siblings));
  const byId = new Map(mine.map(f => [f.id, f]));
  const modules = mine.filter(f => normType(f.type) === 'COMMONMODULE' && f.publishedVersion);
  const out = [];
  // Ét opslag pr. modul, fire ad gangen — en org med 30 moduler skal ikke
  // tage et halvt minut.
  for (let i = 0; i < modules.length; i += 4) {
    await Promise.all(modules.slice(i, i + 4).map(async m => {
      const ids = await consumerIds(env, m.id);
      const behind = [...ids].map(id => byId.get(id))
        .filter(f => f && f.id !== m.id && isBehindModule(f, m))
        .map(f => ({ name: f.name, type: f.type, publishedAt: f.publishedVersion.datePublished,
                     hasDraft: flowHasDraft(f) }));
      if (behind.length)
        out.push({ module: m.name, version: versionLabel(m.publishedVersion),
                   publishedAt: m.publishedVersion.datePublished, behind });
    }));
  }
  return out.sort((a, b) => a.module.localeCompare(b.module));
}

// Hvilke flows bruger en Function Data Action. Genesys' afhængighedssporing kan
// svare på det for én action ad gangen, og der er få FDA'er, så det er billigt.
// Ren sammenlægning, så den kan prøves uden en org: actionNames er FDA'ernes
// navne, idsByAction hvilke flow-id'er hver af dem bruges i.
function groupFdaConsumers(actionNames, idsByAction) {
  const flows = {};
  actionNames.forEach((name, i) => {
    for (const id of (idsByAction[i] || [])) {
      if (!flows[id]) flows[id] = [];
      if (!flows[id].includes(name)) flows[id].push(name);
    }
  });
  for (const id of Object.keys(flows)) flows[id].sort((a, b) => a.localeCompare(b));
  return flows;
}

async function fdaUsage(env) {
  if (isDemo(env)) return { names: [], flows: {} };
  const { token, apiBase } = await getToken(env);
  const fdaInts = new Set((await listIntegrations(env)).filter(i => i.type === FUNCTION_INTEGRATION).map(i => i.id));
  if (!fdaInts.size) return { names: [], flows: {} };
  const actions = (await listDataActions(token, apiBase)).filter(a => fdaInts.has(a.integrationId));
  const idsByAction = [];
  // Fire ad gangen, som ved common modules.
  for (let i = 0; i < actions.length; i += 4) {
    const part = await Promise.all(actions.slice(i, i + 4).map(a => consumerIds(env, a.id, 'DATAACTION')));
    part.forEach((ids, k) => { idsByAction[i + k] = [...ids]; });
  }
  const names = actions.map(a => a.name);
  return { names: [...new Set(names)], flows: groupFdaConsumers(names, idsByAction) };
}

app.get('/api/customers/:id/fda-usage', async (req, res) => {
  const env = loadCustomers().find(c => c.id === req.params.id);
  if (!env) return res.status(404).json({ error: 'Not found' });
  try {
    res.json({ ok: true, ...(await fdaUsage(env)) });
  } catch (e) {
    addLog('WARN', `Could not look up the Function Data Action usage in ${env.name}: ${describeApiError(e)}`, env.name, 'MIGRATE');
    res.status(500).json({ error: describeApiError(e) });
  }
});

app.get('/api/customers/:id/stale-modules', async (req, res) => {
  const env = loadCustomers().find(c => c.id === req.params.id);
  if (!env) return res.status(404).json({ error: 'Not found' });
  try {
    res.json({ ok: true, modules: await staleModules(env) });
  } catch (e) {
    addLog('WARN', `Could not check common modules in ${env.name}: ${describeApiError(e)}`, env.name, 'REPUBLISH');
    res.status(500).json({ error: describeApiError(e) });
  }
});

app.post('/api/flows/dependents', async (req, res) => {
  const { envId, moduleName } = req.body;
  const env = loadCustomers().find(c => c.id === envId);
  if (!env) return res.status(404).json({ error: 'Customer not found' });
  if (!moduleName) return res.status(400).json({ error: 'moduleName required' });
  try {
    res.json({ ok: true, dependents: await dependentsOf(env, moduleName) });
  } catch (e) {
    addLog('ERROR', `Could not find the flows that use "${moduleName}" in ${env.name}: ${describeApiError(e)}`, env.name, 'REPUBLISH');
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Genpublicerer ét flow i sin publicerede udgave, så det tager den nyeste
// udgave af de common modules det kalder med. Indholdet ellers er uændret.
async function republishOne(env, name, type) {
  if (isDemo(env)) {
    const d = loadDemo();
    const f = (d.flows[demoFlowKey(env)] || []).find(x => x.name === name && normType(x.type) === normType(type));
    if (!f) throw new Error(`"${name}" does not exist in ${env.name}`);
    const prevVersion = f.published;
    const cur = parseInt(String(f.published || '0').split('.')[0], 10) || 0;
    f.published = `${cur + 1}.0`;
    f.publishedAt = Date.now();
    demoRemember(f);
    saveDemo(d);
    return { prevVersion, version: f.published, publishedAt: f.publishedAt, yaml: f.content };
  }
  const lower = String(type).toLowerCase();
  const prevVersion = await publishedVersionFor(env, name, lower, 'REPUBLISH');
  if (!prevVersion) throw new Error(`"${name}" has no published version in ${env.name}`);
  const { yaml, fileName } = await exportFlowToYaml(env, name, lower, prevVersion);
  const file = path.join(FLOWS_DIR, sanitizeName(env.name), `.republish-${fileName}`);
  fs.writeFileSync(file, yaml, 'utf8');
  try {
    await runArchy(`publish --file ${archyArg(file, 'File path')}`, env);
  } finally {
    try { fs.unlinkSync(file); } catch (_) {}
  }
  const pub = await getFlowPublishInfo(env, name, lower).catch(() => null);
  return { prevVersion, version: pub?.version || null, publishedAt: pub?.publishedAt || Date.now(), yaml };
}

app.post('/api/flows/republish', async (req, res) => {
  const { envId, flows, moduleName, releaseRef: modulRef, confirmProd } = req.body;
  const env = loadCustomers().find(c => c.id === envId);
  if (!env) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(flows) || !flows.length) return res.status(400).json({ error: 'No flows selected' });
  if (stageOf(env) === 'prod' && !confirmProd)
    return res.status(409).json({ code: 'prod-confirm',
      error: `"${env.name}" er et prod-miljø. Genpubliceringen skal bekræftes udtrykkeligt.` });

  const who = await whoAmI(env);
  const results = [];
  for (const f of flows) {
    try {
      const r = await republishOne(env, f.name, f.type);
      const base = baseFlowName(stripEnvPrefix(f.name, env));
      const snap = saveSnapshot(env.id, f.name, r.yaml);
      await recordReleaseEverywhere(env, {
        kind: 'republish', demo: isDemo(env),
        tenant: tenantOf(env), group: groupOf(env),
        sourceId: null, sourceName: null, targetId: env.id, targetName: env.name,
        targetStage: stageOf(env),
        flowType: f.type, baseName: base, fromName: f.name, toName: f.name,
        prevVersion: r.prevVersion, newVersion: r.version,
        by: who.by, bySource: who.bySource,
        prevSnapshot: snap, newSnapshot: snap,
        note: moduleName ? `Republished to pick up common module "${moduleName}"` : '',
        diff: releaseDiff(r.yaml, r.yaml)
      });
      await noteTargetRepublished(env, base, f.type, r.version, r.publishedAt, 'republish');
      addLog('SUCCESS', `"${f.name}" republished in ${env.name} (v${r.prevVersion} → v${r.version || '?'})` +
        (moduleName ? ` to pick up "${moduleName}"` : ''), env.name, 'REPUBLISH');
      results.push({ name: f.name, type: f.type, ok: true, version: r.version });
    } catch (e) {
      const msg = describeApiError(e);
      addLog('ERROR', `Could not republish "${f.name}" in ${env.name}: ${msg}`, env.name, 'REPUBLISH');
      results.push({ name: f.name, type: f.type, ok: false, error: msg, explain: explainRepublishFailure(msg) });
    }
  }
  // Modulets egen release-note får listen med, så man kan se hvad ændringen
  // trak med sig.
  if (modulRef && modulRef.id && modulRef.envId === env.id) {
    const nye = results.map(x => ({ name: x.name, ok: x.ok, error: x.error || null }));
    await mutateRelease(env, modulRef.baseName, modulRef.flowType, modulRef.id,
      r => { r.cascade = [...(r.cascade || []), ...nye]; });
  }
  res.json({ ok: true, results });
});

// Rollback: målet får det indhold det havde før releasen, publiceret som en ny
// udgave. Genesys kan ikke "af-publicere" til en gammel udgave — historikken
// går kun fremad — så en rollback er en ny publicering af det gamle indhold.
//
// Indholdet hentes fra ORG'ENS egen historik: releasen i manifest-rækken siger
// hvilken udgave målet stod på før, og den udgave eksporteres. Det virker fra
// enhver pc med adgang til org'en. Har denne pc indholdet i cachen, bruges det
// og eksporten spares.
//
// Navnet: i demoen går navnet tilbage med (Betaling_v6 → Betaling_v5), for
// dér bærer navnet versionen. I en rigtig org beholder flowet sit nuværende
// navn — et andet navn i YAML'en ville få Archy til at oprette et NYT flow
// ved siden af, og alt der ruter til det gamle ville pege forkert.
app.post('/api/releases/rollback', async (req, res) => {
  const f = await findRelease(req.body.ref);
  if (f.error) return res.status(f.status).json({ error: f.error });
  const { env, list, rel: r } = f;
  if (refuseProdWrite(res, env, '/api/releases/rollback')) return;

  const cand = rollbackCandidate(list);
  if (!cand || cand.id !== r.id)
    return res.status(409).json({ code: 'not-latest',
      error: 'Kun den nyeste forfremmelse kan rulles tilbage — den er måske allerede rullet tilbage fra en anden pc. Genindlæs tavlen.' });
  if (stageOf(env) === 'prod' && !req.body.confirmProd)
    return res.status(409).json({ code: 'prod-confirm',
      error: `"${env.name}" er et prod-miljø. Rollback skal bekræftes udtrykkeligt.` });

  try {
    // Det vi går tilbage TIL, og det vi går væk FRA (til diff'en).
    let prevYaml = readSnapshot(r.prevSnapshot);
    let kilde = 'cache';
    if (prevYaml == null) {
      prevYaml = await flowVersionContent(env, r.toName, r.flowType, r.prevVersion);
      kilde = 'org';
    }
    let curYaml = readSnapshot(r.newSnapshot);
    if (curYaml == null) {
      try { curYaml = await flowVersionContent(env, r.toName, r.flowType, null); } catch (_) { curYaml = null; }
    }
    addLog('INFO', `Rollback of "${r.toName}" in ${env.name}: content of v${r.prevVersion || '?'} taken from ` +
      (kilde === 'org' ? 'the org\'s version history' : 'the local cache'), env.name, 'ROLLBACK');

    let name, version, publishedAt, published;
    if (isDemo(env)) {
      const d = loadDemo();
      const siblings = loadCustomers().filter(c => isDemo(c) && demoFlowKey(c) === demoFlowKey(env));
      const fl = (d.flows[demoFlowKey(env)] || []).find(x =>
        normType(x.type) === r.flowType && belongsToEnv(x.name, env, siblings) &&
        baseFlowName(stripEnvPrefix(x.name, env)) === r.baseName);
      if (!fl) throw new Error(`"${r.toName}" does not exist in ${env.name} anymore`);
      name = r.fromName || fl.name;
      published = renameFlowInYaml(prevYaml, name);
      const cur = parseInt(String(fl.published || '0').split('.')[0], 10) || 0;
      fl.name = name;
      fl.content = published;
      fl.published = `${cur + 1}.0`;
      fl.publishedAt = Date.now();
      demoRemember(fl);
      version = fl.published; publishedAt = fl.publishedAt;
      saveDemo(d);
    } else {
      name = r.toName;
      published = renameFlowInYaml(prevYaml, name);
      const dir = path.join(FLOWS_DIR, sanitizeName(env.name));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `.rollback-${sanitizeName(name)}-${Date.now()}.yaml`);
      fs.writeFileSync(file, published, 'utf8');
      try {
        await runArchy(`publish --file ${archyArg(file, 'File path')}`, env);
      } finally {
        try { fs.unlinkSync(file); } catch (_) {}
      }
      const pub = await getFlowPublishInfo(env, name, r.flowType.toLowerCase()).catch(() => null);
      version = pub?.version || null; publishedAt = pub?.publishedAt || Date.now();
    }

    const who = await whoAmI(env);
    const rb = await recordReleaseEverywhere(env, {
      kind: 'rollback', demo: isDemo(env),
      tenant: tenantOf(env), group: groupOf(env),
      sourceId: null, sourceName: null, targetId: env.id, targetName: env.name,
      targetStage: stageOf(env),
      flowType: r.flowType, baseName: r.baseName, fromName: r.toName, toName: name,
      prevVersion: r.newVersion, newVersion: version,
      by: who.by, bySource: who.bySource,
      prevSnapshot: saveSnapshot(env.id, r.toName, curYaml),
      newSnapshot: saveSnapshot(env.id, name, published),
      rollbackOf: r.id,
      diff: releaseDiff(curYaml, published)
    });
    // Markér den rullede release — i org'en, så en anden pc ser det samme.
    // Næste klik går så én forfremmelse længere tilbage.
    await mutateRelease(env, r.baseName, r.flowType, r.id, x => { x.rolledBackBy = rb.id; x.rolledBackAt = rb.at; });

    await noteTargetRepublished(env, r.baseName, r.flowType, version, publishedAt, 'rollback');
    addLog('SUCCESS', `Rollback: "${r.toName}" in ${env.name} is back on the content of v${r.prevVersion || '?'}` +
      (name !== r.toName ? ` as "${name}"` : '') + ` (now v${version || '?'})`, env.name, 'ROLLBACK');

    // Et modul der rulles tilbage, er lige så meget en ændring som et der
    // forfremmes — de flows der bruger det skal også publiceres igen.
    let dependents = [];
    if (r.flowType === 'COMMONMODULE') {
      try { dependents = await dependentsOf(env, name); } catch (_) {}
    }
    res.json({ ok: true, name, version, releaseRef: releaseRef(rb), dependents, contentFrom: kilde });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Rollback of "${r.toName}" in ${env.name} failed: ${msg}`, env.name, 'ROLLBACK');
    res.status(500).json({ error: msg });
  }
});

// Publicerer et flow der allerede ligger i org'en — typisk efter en migrering
// med handlingen 'create', som lægger flowet ind som checked-in draft.
//
// Archy kan ikke bruges her: 'archy publish' kræver altid en YAML-fil og ville
// re-importere fra kilden. Genesys' eget endpoint publicerer den version der
// allerede ER i org'en, hvilket er præcis det man vil.
app.post('/api/flows/publish', async (req, res) => {
  const { customerId, flowId, flowName } = req.body;
  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  try {
    const { token, apiBase } = await getToken(customer);
    const H = { headers: { Authorization: `Bearer ${token}` } };

    const before = (await axios.get(`${apiBase}/api/v2/flows/${flowId}`, H)).data;
    const version = before.checkedInVersion?.name || before.checkedInVersion?.commitVersion;
    if (!version) return res.status(400).json({ error: `"${before.name}" har ingen checked-in version at publicere` });
    if (before.publishedVersion && before.publishedVersion.name === version) {
      return res.status(409).json({ error: 'already_published',
        message: `"${before.name}" er allerede publiceret som v${version}` });
    }

    await axios.post(`${apiBase}/api/v2/flows/actions/publish?flow=${flowId}&version=${encodeURIComponent(version)}`,
      {}, { headers: { ...H.headers, 'Content-Type': 'application/json' } });

    // Publicering er ASYNKRON: POST'en svarer 200 med det samme, mens Genesys
    // arbejder videre i baggrunden. Et øjeblikkeligt opslag ser derfor stadig
    // det gamle flow. Vi følger i stedet flowets currentOperation til den er
    // færdig — den bærer både status og eventuelle fejldetaljer.
    //
    // Et 200-svar er i øvrigt heller ikke i sig selv et bevis: endpointet
    // svarer også 200 for en version der ikke findes, uden at gøre noget.
    let after = null, op = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      after = (await axios.get(`${apiBase}/api/v2/flows/${flowId}`, H)).data;
      op = after.currentOperation || null;
      if (op?.actionName === 'PUBLISH' && op.complete) break;
      if (after.publishedVersion && after.publishedVersion.name !== before.publishedVersion?.name) break;
    }

    const nowPublished = after?.publishedVersion?.name || after?.publishedVersion?.commitVersion || null;
    const failed = op?.actionName === 'PUBLISH' && op.complete && op.actionStatus && op.actionStatus !== 'SUCCESS';

    if (failed) {
      // Forklaringen ligger i errorMessage/errorCode på selve operationen.
      // errorDetails[] er som regel tom, så den alene giver kun "FAILURE".
      const why = [
        op.errorMessage,
        op.errorCode ? `(${op.errorCode})` : null,
        (op.errorDetails || []).map(d => d.message || d.errorCode).filter(Boolean).join('; ') || null
      ].filter(Boolean).join(' ') || op.actionStatus;
      addLog('ERROR', `Publishing "${before.name}" failed: ${why}`, customer.name, 'MIGRATE');
      return res.status(500).json({ error: `Publicering fejlede: ${why}` });
    }
    if (!nowPublished) {
      addLog('WARN', `Publishing "${before.name}" is still running after 30 seconds — check in Architect`, customer.name, 'MIGRATE');
      return res.status(202).json({ pending: true,
        error: `Publiceringen af "${before.name}" er sat i gang men er ikke færdig endnu — tjek status i Architect` });
    }

    addLog('SUCCESS', `"${after.name}" published as v${nowPublished} in ${customer.name}`, customer.name, 'MIGRATE');
    res.json({ ok: true, name: after.name, version: nowPublished,
      publishedAt: after.publishedVersion?.dateCheckedIn || null });

  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Could not publish "${flowName || flowId}": ${msg}`, customer.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

// Nulpunkt: noterer hvordan mål-org'ens flows ser ud LIGE NU, så senere
// ændringer kan opdages — også for flows værktøjet aldrig har migreret.
//
// Bevidst kun API-opslag, ingen eksport: publiceringstidspunktet er det der
// skal bruges til at fange en ændring lavet direkte i mål-org'en, og det kan
// hentes for alle flows i ét hug. En indholds-hash ville kræve en Archy-eksport
// pr. flow — 84 flows ville tage over 20 minutter.
app.post('/api/flows/baseline', async (req, res) => {
  const { sourceId, targetId } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!target) return res.status(404).json({ error: 'Customer not found' });

  try {
    const [targetOrgId, sourceOrgId] = await Promise.all([
      getOrgId(target), source ? getOrgId(source) : Promise.resolve(null)
    ]);
    const { token, apiBase } = await getToken(target);
    let all = [], page = 1;
    while (true) {
      const r = await axios.get(`${apiBase}/api/v2/flows`, {
        headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 100, pageNumber: page }
      });
      const e = r.data.entities || [];
      all = all.concat(e);
      if (e.length < 100) break;
      page++;
    }

    const ts = new Date().toISOString();
    let recorded = 0, skipped = 0;
    for (const f of all) {
      const existing = findManifestEntry(loadManifest(), {
        targetOrgId, targetId, flowName: f.name, flowType: f.type });
      // En rigtig migrering må ikke overskrives af et nulpunkt
      if (existing && existing.kind !== 'baseline') { skipped++; continue; }
      recordManifest({
        ts, kind: 'baseline',
        sourceId: source?.id || null, sourceOrgId, sourceName: source?.name || null,
        targetId, targetOrgId, targetName: target.name,
        flowName: f.name, flowType: f.type,
        targetVersion: f.publishedVersion?.name || f.checkedInVersion?.name || null,
        targetPublishedAt: f.publishedVersion?.dateCheckedIn || f.publishedVersion?.dateCreated || null,
        targetActive: !!f.active
      });
      recorded++;
    }

    // Har org'en manifesttabellen, skrives nulpunktet også derind — så kender
    // den sit eget indhold, og afvigelses-signalet gælder alle flows, ikke kun
    // dem værktøjet selv har flyttet. Én skrivning pr. flow, så det tager tid.
    let toOrg = 0, orgErr = null;
    try {
      if (await readOrgManifest(target)) {
        for (const f of all) {
          try {
            await writeOrgManifestRow(target, f.name, f.type, {
              flowName: f.name, kind: 'baseline',
              version: f.publishedVersion?.name || f.checkedInVersion?.name || null,
              publishedAt: f.publishedVersion?.dateCheckedIn || f.publishedVersion?.dateCreated || null
            });
            toOrg++;
          } catch (e) { orgErr = describeApiError(e); break; }
        }
      }
    } catch (e) { orgErr = describeApiError(e); }

    addLog('SUCCESS', `Baseline set for ${target.name}: ${recorded} flows recorded` +
      (skipped ? `, ${skipped} skipped (already migrated with this tool)` : '') +
      (toOrg ? `, ${toOrg} written to the org manifest table` : '') +
      (orgErr ? ` — the manifest table failed: ${orgErr}` : ''), target.name, 'MIGRATE');
    res.json({ ok: true, recorded, skipped, total: all.length, targetOrgId, toOrg, orgError: orgErr });

  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Hvilke flows findes hos flere kunder, og med hvilke versioner?
// Kun API-opslag — ét kald pr. kunde — så oversigten er hurtig. Indholdet
// sammenlignes først når man beder om det, for det kræver en eksport pr. org.
app.get('/api/flows/cross-customer', async (req, res) => {
  const customers = loadCustomers();
  const byFlow = new Map();      // navn|type -> [{customer, version, ...}]
  const problems = [];

  for (const c of customers) {
    // Demo-miljøer har ingen credentials og region "demo". Uden denne gren
    // forsøgte siden at logge ind på login.demo og fyldte listen med
    // "getaddrinfo ENOTFOUND login.demo" — én linje pr. demo-miljø.
    if (isDemo(c)) {
      const soeskende = customers.filter(x => orgKeyOf(x) === orgKeyOf(c));
      for (const f of demoFlowsFor(c)) {
        if (!belongsToEnv(f.name, c, soeskende)) continue;
        const key = `${baseFlowName(stripEnvPrefix(f.name, c))}|${f.type}`;
        if (!byFlow.has(key)) byFlow.set(key, []);
        byFlow.get(key).push({
          customerId: c.id, customerName: c.name,
          flowId: `${c.id}:${f.name}`, flowName: f.name,
          publishedVersion: f.published || null, checkedInVersion: null,
          publishedAt: f.publishedAt || null, active: true
        });
      }
      continue;
    }
    try {
      const { token, apiBase } = await getToken(c);
      let page = 1;
      while (true) {
        const r = await axios.get(`${apiBase}/api/v2/flows`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { pageSize: 100, pageNumber: page, includeDraft: true }
        });
        const e = r.data.entities || [];
        for (const f of e) {
          // Samme nøgle som pipelinen: grundnavnet uden miljøpræfiks, så
          // "DEV_Ordreflow" og "Ordreflow" tæller som det samme flow.
          const key = `${baseFlowName(stripEnvPrefix(f.name, c))}|${f.type}`;
          if (!byFlow.has(key)) byFlow.set(key, []);
          byFlow.get(key).push({
            customerId: c.id, customerName: c.name,
            flowId: f.id, flowName: f.name,
            publishedVersion: f.publishedVersion?.name || f.publishedVersion?.commitVersion || null,
            checkedInVersion: f.checkedInVersion?.name || f.checkedInVersion?.commitVersion || null,
            publishedAt: f.publishedVersion?.dateCheckedIn || f.publishedVersion?.dateCreated || null,
            active: !!f.active
          });
        }
        if (e.length < 100) break;
        page++;
      }
    } catch (e) {
      problems.push({ customer: c.name, error: describeApiError(e) });
    }
  }

  // Kun de flows der optræder hos mere end én kunde
  const rows = [];
  for (const [key, list] of byFlow) {
    if (new Set(list.map(x => x.customerId)).size < 2) continue;
    const [flowName, flowType] = key.split('|');
    const versions = new Set(list.map(x => x.publishedVersion || x.checkedInVersion || '?'));
    rows.push({ flowName, flowType, orgs: list, sameVersion: versions.size === 1 });
  }
  rows.sort((a, b) => a.flowName.localeCompare(b.flowName));

  res.json({ ok: true, customers: customers.map(c => ({ id: c.id, name: c.name })), rows, problems });
});

// ── Pipeline-tavlen ──────────────────────────────────────────────────────────
// Flows som rækker, gruppens miljøer som kolonner i trin-rækkefølge.
// Versionstallet er per-org og kan ikke sammenlignes på tværs — det vises kun
// til orientering. Om indholdet faktisk er ens afgøres af /api/flows/cross-hash,
// som eksporterer og hasher, og derfor kun kaldes for én række ad gangen.
// Genesys navngiver en kladde med et internt id ("saved_version_0d4c8ad4-…").
// Det er ikke et versionsnummer og skal ikke vises som ét.
function versionLabel(v) {
  if (!v) return null;
  for (const cand of [v.commitVersion, v.name]) {
    if (cand && /^\d+(\.\d+)?$/.test(String(cand).trim())) return String(cand).trim();
  }
  return null;
}

app.get('/api/pipeline', async (req, res) => {
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
app.post('/api/flows/cross-hash', async (req, res) => {
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
app.post('/api/flows/compare', async (req, res) => {
  const { sourceId, targetId, flowName, flowType } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  try {
    let src, tgt, missingInTarget = false;
    src = await exportFlowToYaml(source, flowName, flowType);
    try {
      tgt = await exportFlowToYaml(target, flowName, flowType);
    } catch (e) {
      if (/does not exist/i.test(e.message || '')) missingInTarget = true;
      else throw e;
    }

    // Publiceringsoplysninger — hentes uafhængigt af indholdssammenligningen
    const [srcPub, tgtPub] = await Promise.all([
      getFlowPublishInfo(source, flowName, flowType).catch(() => null),
      missingInTarget ? Promise.resolve(null) : getFlowPublishInfo(target, flowName, flowType).catch(() => null)
    ]);

    if (missingInTarget) {
      return res.json({ ok: true, verdict: 'missing', flowName, flowType,
        sourceVersion: src.version, sourceHash: flowContentHash(src.yaml), srcPub });
    }

    const nsrc = normalizeFlowYaml(src.yaml), ntgt = normalizeFlowYaml(tgt.yaml);
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

// ── Afhængigheder i et flow ───────────────────────────────────────────────────

// Tegnene et ressourcenavn må bestå af. \w dækker kun ASCII, og danske navne
// gør ikke: "Åbningstider" blev læst som ingenting, og et flow der slår op i
// den tabel fremstod dermed uden afhængigheder — både i rapporten og når
// migreringen skulle tage dem med. Latin-1's bogstaver dækker æ, ø og å samt
// resten af de vesteuropæiske sprog.
const ORD = '\\wÀ-ÖØ-öø-ÿ';

// Finder de ressourcer et flow-YAML refererer til. Regexerne er skrevet mod
// den form Archy faktisk eksporterer — se README for eksempler.
function scanYamlDependencies(yaml) {
  const uniq = a => [...new Set(a.map(s => (s || '').trim()).filter(Boolean))];
  const grab = (re) => { const out = []; let m; while ((m = re.exec(yaml)) !== null) out.push(m[1]); return uniq(out); };

  return {
    division:   grab(/^[ \t]*division:[ \t]*["']?([^'"\n]+)["']?/gm),
    queue:      grab(/targetQueue:[\s\S]{0,60}?name:[ \t]*["']?([^'"\n]+)["']?/gm),
    datatable:  grab(new RegExp(`dataTable:\\s*\\n\\s+([${ORD}][${ORD} _\\-]+):`, 'gm'))
                  .filter(n => !['foundOutputs', 'failureOutputs', 'outputs'].includes(n)),
    dataaction: grab(new RegExp(`dataAction:\\s*\\n\\s+([${ORD}][${ORD} _\\-()]+):`, 'gm')),
    // PromptSystem.* er Genesys' indbyggede systemprompts. De ligger ikke i
    // orgens promptliste og ville derfor altid fremstå som manglende.
    prompt:     grab(new RegExp(`prompt:[ \\t]+["']?(?:Prompt\\.)?([${ORD}_\\-. ]+)["']?`, 'gm'))
                  .filter(n => !/^PromptSystem\./i.test(n)),
    // wrapupCode: \n lit: \n name: X
    wrapupcode: grab(/wrapupCode:\s*\n\s*lit:\s*\n\s*name:[ \t]*["']?([^'"\n]+)["']?/gmi),
    // screenPopScript: \n <ScriptNavn>:
    script:     grab(new RegExp(`screenPopScript:\\s*\\n\\s+([${ORD}][${ORD} _\\-]+):`, 'gm')),
    // Kun statiske skill-navne. FindSkill(Task.Skills) slås op på kørselstidspunktet
    // og kan ikke tjekkes her — det siges eksplicit i rapporten.
    skill:      grab(/FindSkill\(\s*["']([^"']+)["']\s*\)/gm),
    // VOICESURVEY-flows peger på en survey form ved navn
    surveyform: grab(/surveyForm:\s*\n\s*name:[ \t]*["']?([^'"\n]+)["']?/gm),

    // ── Referencer til ANDRE flows ────────────────────────────────────────
    // Bemærk kravet om indrykning (^\s+): på indrykning 0 er 'commonModule:'
    // og 'botFlow:' flowets EGEN type, ikke en reference til et andet flow.
    commonmodule: grab(new RegExp(`^\\s+commonModule:\\s*\\n\\s+([${ORD}][${ORD} .\\-()]*):`, 'gm')).filter(notMeta),
    botflow:      grab(new RegExp(`^\\s+botFlow:\\s*\\n\\s+([${ORD}][${ORD} .\\-()]*):`, 'gm')).filter(notMeta),
    targetflow:   grab(/targetFlow:\s*\n\s*(?:lit:\s*\n\s*)?name:\s*["']?([^'"\n]+)["']?/gm),

    // ── Brugere ───────────────────────────────────────────────────────────
    // "Transfer to User" med en fast bruger: targetUser: \n lit: \n userName: x@y.
    // En bruger er en person i org'en — findes vedkommende ikke i målet, kan
    // flowet ikke importeres, og vi kan ikke oprette brugeren for dem.
    // Et udtryk (exp:) slås op når flowet kører og kan ikke tjekkes her.
    user:          grab(/targetUser:\s*\n\s*lit:\s*\n\s*userName:[ \t]*["']?([^'"\n]+?)["']?[ \t]*$/gm),

    // ── Åbningstider ──────────────────────────────────────────────────────
    schedule:      grab(/schedule:\s*\n\s*selectedSchedule:\s*\n\s*(?:lit:\s*\n\s*)?name:\s*["']?([^'"\n]+)["']?/gm),
    schedulegroup: grab(/scheduleGroup:\s*\n\s*lit:\s*\n\s*name:\s*["']?([^'"\n]+)["']?/gm),

    // ── Øvrige org-ressourcer ─────────────────────────────────────────────
    knowledgebase: grab(/knowledgeBase:\s*\n\s*name:\s*["']?([^'"\n]+)["']?/gm),
    sttengine:     grab(/speechToText:\s*\n\s*engine:\s*\n\s*name:\s*["']?([^'"\n]+)["']?/gm),
    group:         grab(/targetGroup:\s*\n\s*lit:\s*\n\s*name:\s*["']?([^'"\n]+)["']?/gm)
  };
}

// Strukturelle nøgler der aldrig er ressourcenavne
function notMeta(n) {
  return !['name', 'lit', 'exp', 'noValue', 'division', 'description',
           'ver_latestPublished', 'inputs', 'outputs', 'supportedLanguages'].includes(n);
}

// Hvilke af 'names' findes allerede i org'en? Store lister (758 køer, 350 skills)
// slås op pr. navn; små lister hentes i ét hug.
async function lookupExisting(kind, names, token, apiBase) {
  const found = new Set();
  if (!names.length) return found;
  const H = { headers: { Authorization: `Bearer ${token}` } };

  const bulk = {
    datatable:  { url: '/api/v2/flows/datatables',      size: 200 },
    dataaction: { url: '/api/v2/integrations/actions',  size: 100 },
    script:     { url: '/api/v2/scripts',               size: 100 },
    surveyform: { url: '/api/v2/quality/forms/surveys', size: 100 },
    // Alle tre flow-referencer slås op i den samme flow-liste
    commonmodule: { url: '/api/v2/flows', size: 100 },
    botflow:      { url: '/api/v2/flows', size: 100 },
    targetflow:   { url: '/api/v2/flows', size: 100 },
    knowledgebase:{ url: '/api/v2/knowledge/knowledgebases', size: 100 },
    sttengine:    { url: '/api/v2/integrations/speech/stt/engines', size: 100 },
    group:        { url: '/api/v2/groups', size: 100 }
  };
  if (bulk[kind]) {
    let page = 1;
    while (true) {
      const r = await axios.get(`${apiBase}${bulk[kind].url}`, {
        ...H, params: { pageSize: bulk[kind].size, pageNumber: page }
      });
      const e = r.data.entities || [];
      for (const x of e) if (names.includes(x.name)) found.add(x.name);
      if (e.length < bulk[kind].size) break;
      page++;
    }
    return found;
  }

  // Brugere findes på brugernavnet (login-mailen), ikke på et navnefelt.
  if (kind === 'user') {
    for (const n of names) {
      try {
        const r = await axios.post(`${apiBase}/api/v2/users/search`, {
          pageSize: 5,
          query: [{ type: 'EXACT', fields: ['email'], value: n }]
        }, { headers: { ...H.headers, 'Content-Type': 'application/json' } });
        const lav = String(n).toLowerCase();
        if ((r.data.results || []).some(u =>
          String(u.username || '').toLowerCase() === lav || String(u.email || '').toLowerCase() === lav))
          found.add(n);
      } catch (_) { /* uafklaret — tælles som manglende og markeres i rapporten */ }
    }
    return found;
  }

  const byName = {
    division:      '/api/v2/authorization/divisions',
    queue:         '/api/v2/routing/queues',
    prompt:        '/api/v2/architect/prompts',
    wrapupcode:    '/api/v2/routing/wrapupcodes',
    skill:         '/api/v2/routing/skills',
    schedule:      '/api/v2/architect/schedules',
    schedulegroup: '/api/v2/architect/schedulegroups'
  };
  const url = byName[kind];
  if (!url) return found;
  for (const n of names) {
    try {
      const r = await axios.get(`${apiBase}${url}`, { ...H, params: { pageSize: 50, name: n } });
      if ((r.data.entities || []).some(x => x.name === n)) found.add(n);
    } catch (_) { /* uafklaret — tælles som manglende og markeres i rapporten */ }
  }
  return found;
}

// ── Function Data Actions ─────────────────────────────────────────────────────

const FUNCTION_INTEGRATION = 'function-data-actions';

// En Function Data Action kan ikke oprettes via API'et: dens skabelon er et id
// på en function i kildens org. Mangler den i målet, kan flowet ikke forfremmes
// — og forfremmes det alligevel, ender versionsnummeret og tjekket i Genesys
// ude af trit, når man retter det bagefter direkte i org'en.
//
// Ren afgørelse, så den kan prøves uden en org: hvilke af de manglende navne er
// FDA'er i kilden? Et navn kilden ikke kender, er ikke en FDA vi kan påvise.
function missingFunctionActions(missingNames, sourceActions, integrationTypes) {
  return missingNames.filter(n => {
    const hit = (sourceActions || []).find(a => a.name === n);
    return !!hit && (integrationTypes || {})[hit.integrationId] === FUNCTION_INTEGRATION;
  });
}

// De Function Data Actions flowet bruger, som ikke findes i målet.
async function functionActionsMissingInTarget(source, target, yaml) {
  const names = scanYamlDependencies(yaml).dataaction;
  if (!names.length) return [];
  const { token: tt, apiBase: tb } = await getToken(target);
  const existing = await lookupExisting('dataaction', names, tt, tb);
  const missing = names.filter(n => !existing.has(n));
  if (!missing.length) return [];

  const { token: st, apiBase: sb } = await getToken(source);
  const SH = { headers: { Authorization: `Bearer ${st}` } };
  let actions = [], page = 1;
  for (;;) {
    const r = await axios.get(`${sb}/api/v2/integrations/actions`, { ...SH, params: { pageSize: 100, pageNumber: page } });
    const e = r.data.entities || [];
    actions = actions.concat(e);
    if (e.length < 100) break;
    page++;
  }
  const types = {};
  const ri = await axios.get(`${sb}/api/v2/integrations`, { ...SH, params: { pageSize: 200 } });
  for (const i of ri.data.entities || []) types[i.id] = i.integrationType?.id || '';
  return missingFunctionActions(missing, actions, types);
}

// ── Data actions i flowet: kategori og navn ───────────────────────────────────
//
// Et flow peger på en data action med KATEGORI og NAVN:
//
//     category:
//       Genesys Cloud Data Actions - QM:
//         dataAction:
//           get_order:
//
// Kategorien er integrationens navn, og den er ikke ens fra org til org —
// kunder har fx "Test - Genesys Cloud Data Actions" i test og
// "Genesys Cloud Data Actions - Flows" i prod. Findes navnet i målet, men under
// en anden kategori, ser en tjek på navn alene alt i orden, og importen fejler.
// Derfor slås både kategori og navn op, og brugerens valg huskes pr. org-par.

const DA_REF_RE = () => /(category:[ \t]*\r?\n[ \t]+)([^\r\n]+?)(:[ \t]*\r?\n[ \t]+dataAction:[ \t]*\r?\n[ \t]+)([^\r\n]+?)(:[ \t]*(?:\r?\n|$))/g;
const daUnquote = s => String(s).trim().replace(/^(["'])(.*)\1$/, '$2');
const daSame = (a, b) => !!a && !!b && a.category === b.category && a.name === b.name;

// De data actions et flow kalder, hver én gang.
function scanDataActionRefs(yaml) {
  const out = [];
  const re = DA_REF_RE();
  let m;
  while ((m = re.exec(String(yaml))) !== null) {
    const ref = { category: daUnquote(m[2]), name: daUnquote(m[4]) };
    if (!out.some(r => daSame(r, ref))) out.push(ref);
  }
  return out;
}

// Ren afgørelse pr. reference:
//   exact   — findes i målet med samme kategori og navn
//   mapped  — et gemt valg peger på en action der findes i målet
//   choose  — navnet findes i målet, men under en anden kategori
//   absent  — navnet findes slet ikke i målet
function classifyDataActionRefs(refs, targetActions, saved) {
  const ta = targetActions || [];
  return (refs || []).map(r => {
    if (ta.some(a => daSame(a, r))) return { ...r, status: 'exact' };
    const sv = (saved || []).find(e => daSame(e.from, r));
    if (sv && ta.some(a => daSame(a, sv.to))) return { ...r, status: 'mapped', mappedTo: sv.to };
    const candidates = ta.filter(a => a.name === r.name).map(a => ({ category: a.category, name: a.name }));
    return { ...r, status: candidates.length ? 'choose' : 'absent', candidates };
  });
}

// Skriver referencerne om efter en liste af valg. Rører kun en reference der
// IKKE findes i målet, og kun hvis valget peger på en action der gør.
function applyDataActionMap(yaml, entries, targetActions) {
  const changed = [];
  const ta = targetActions || [];
  const wrap = (orig, v) => { const q = String(orig).trim()[0]; return (q === '"' || q === "'") ? q + v + q : v; };
  const out = String(yaml).replace(DA_REF_RE(), (all, h1, cat, h2, name, tail) => {
    const ref = { category: daUnquote(cat), name: daUnquote(name) };
    if (ta.some(a => daSame(a, ref))) return all;
    const e = (entries || []).find(x => daSame(x.from, ref));
    if (!e || !ta.some(a => daSame(a, e.to))) return all;
    const txt = `${ref.category} / ${ref.name} → ${e.to.category} / ${e.to.name}`;
    if (!changed.includes(txt)) changed.push(txt);
    return h1 + wrap(cat, e.to.category) + h2 + wrap(name, e.to.name) + tail;
  });
  return { yaml: out, changed };
}

const validDaEntry = e => !!e && ['from', 'to'].every(k => e[k]
  && typeof e[k].category === 'string' && typeof e[k].name === 'string'
  && e[k].category && e[k].name && e[k].category.length <= 256 && e[k].name.length <= 256);

// over vinder over base, på kilden.
function mergeDaEntries(base, over) {
  const out = (base || []).filter(validDaEntry).map(e => ({ from: { ...e.from }, to: { ...e.to } }));
  for (const e of (over || []).filter(validDaEntry)) {
    const i = out.findIndex(x => daSame(x.from, e.from));
    const neu = { from: { category: e.from.category, name: e.from.name }, to: { category: e.to.category, name: e.to.name } };
    if (i >= 0) out[i] = neu; else out.push(neu);
  }
  return out;
}

// Alle data actions i en org, med kategori.
async function listDataActions(token, apiBase) {
  const H = { headers: { Authorization: `Bearer ${token}` } };
  let all = [], page = 1;
  for (;;) {
    const r = await axios.get(`${apiBase}/api/v2/integrations/actions`, { ...H, params: { pageSize: 100, pageNumber: page } });
    const e = r.data.entities || [];
    all = all.concat(e.map(a => ({ id: a.id, name: a.name, category: a.category, integrationId: a.integrationId })));
    if (e.length < 100) break;
    page++;
  }
  return all;
}

// Valgene gemmes pr. kilde-org og mål-org. I mål-org'ens manifest-tabel, hvis
// den har en — så en kollega på en anden pc ser dem — ellers i en lokal fil.
// Nøglen har ikke noget "|", så tavlen aldrig læser den som et flow.
const DA_MAP_KEY = 'ArchyGUI_DataActionMap';
const DA_MAP_FILE = path.join(FLOWS_DIR, '.data-action-map.json');

function readLocalDaMap() { try { return JSON.parse(fs.readFileSync(DA_MAP_FILE, 'utf8')); } catch (_) { return {}; } }

const daOrgKeys = async (source, target) => ({
  s: (await getOrgId(source)) || source.id,
  t: (await getOrgId(target)) || target.id
});

async function loadDataActionMap(source, target) {
  const k = await daOrgKeys(source, target);
  const local = (readLocalDaMap()[k.t] || {})[k.s] || [];
  let org = [];
  try {
    const row = await readOrgManifestRow(target, DA_MAP_KEY);
    if (row && row.maps) org = row.maps[k.s] || [];
  } catch (_) { /* uden tabel bruges den lokale fil */ }
  return mergeDaEntries(local, org);
}

// replace: entries ER hele listen for org-parret (fra totaltjekket, hvor man
// også kan fjerne et valg). Ellers flettes de ind i det der er gemt.
async function saveDataActionMap(source, target, entries, opts = {}) {
  const k = await daOrgKeys(source, target);
  const all = opts.replace ? mergeDaEntries([], entries)
                           : mergeDaEntries(await loadDataActionMap(source, target), entries);
  // Et løst miljø (intet trin) får ikke skrevet noget i sin org.
  if (stageOf(target)) {
    try {
      const row = (await readOrgManifestRow(target, DA_MAP_KEY));
      if (row !== undefined) {
        const maps = { ...((row && row.maps) || {}), [k.s]: all };
        const r = await putOrgManifestRow(target, DA_MAP_KEY, { schema: 1, maps, at: Date.now() });
        if (r.ok) return { where: 'org', count: all.length };
      }
    } catch (e) {
      addLog('WARN', `Could not save the data action choices in ${target.name}'s manifest: ${describeApiError(e)} — saved locally`, target.name, 'MIGRATE');
    }
  }
  const local = readLocalDaMap();
  local[k.t] = { ...(local[k.t] || {}), [k.s]: all };
  fs.writeFileSync(DA_MAP_FILE, JSON.stringify(local, null, 2));
  return { where: 'local', count: all.length };
}

// ── Totaltjek af data actions mellem to orgs ─────────────────────────────────

// Hver data action i kilden, sat op mod målet. Samme afgørelse som for et enkelt
// flow (exact / mapped / choose / absent), her for hele orgen. Ren, så den kan
// prøves uden en org.
// Genesys' indbyggede actions (id'et starter med "static_") findes i hver orgs
// Genesys Cloud Data Actions og kan hverken oprettes eller migreres. Findes de
// ikke i målet, er det ikke en mangel vi kan rette, så de er ikke med.
const isBuiltInAction = a => String((a && a.id) || '').startsWith('static_');

function compareDataActionSets(srcActions, tgtActions, saved) {
  const cls = classifyDataActionRefs(
    srcActions.map(a => ({ category: a.category, name: a.name })), tgtActions, saved);
  return srcActions.map((a, i) => ({ a, i })).filter(({ a, i }) =>
    !(isBuiltInAction(a) && cls[i].status !== 'exact' && cls[i].status !== 'mapped')).map(({ a, i }) => ({
    id: a.id, name: a.name, category: a.category,
    // Id'et på den action i målet kilden er sat op mod — til kontrakt-sammenligningen.
    targetId: (tgtActions.find(t => daSame(t, cls[i].status === 'mapped' ? cls[i].mappedTo : a)) || {}).id || null,
    integrationName: a.integrationName || '', integrationType: a.integrationType || '',
    status: cls[i].status === 'exact' ? 'same' : cls[i].status,
    candidates: cls[i].candidates || [], mappedTo: cls[i].mappedTo || null,
    // En Function Data Action kan ikke oprettes herfra: mangler den, er det manuelt.
    fda: a.integrationType === FUNCTION_INTEGRATION
  }));
}

function summarizeDataActionRows(rows) {
  const n = s => rows.filter(r => r.status === s).length;
  return {
    total: rows.length, same: n('same'), mapped: n('mapped'), choose: n('choose'), absent: n('absent'),
    // FDA'er der hverken findes eller er peget over på en der gør.
    fdaMissing: rows.filter(r => r.fda && (r.status === 'choose' || r.status === 'absent')).length
  };
}

// Et schemas felter: navn → type og om de er påkrævet.
function schemaFields(schema) {
  const props = (schema && schema.properties) || {};
  const req = (schema && schema.required) || [];
  const out = {};
  for (const [name, def] of Object.entries(props)) {
    const t = def && def.type;
    out[name] = { type: typeof t === 'string' ? t : JSON.stringify(t || ''), required: req.includes(name) };
  }
  return out;
}

// Forskellen på to actions' kontrakter, set fra kilden: hvad kilden har som
// målet ikke har, hvad målet har ekstra, og felter hvor typen eller kravet er
// et andet. En action kan hedde det samme og alligevel ikke passe til flowet.
function compareContracts(srcAction, tgtAction) {
  const diffs = [];
  for (const [side, key] of [['input', 'inputSchema'], ['output', 'successSchema']]) {
    const a = schemaFields(srcAction && srcAction.contract && srcAction.contract[side] && srcAction.contract[side][key]);
    const b = schemaFields(tgtAction && tgtAction.contract && tgtAction.contract[side] && tgtAction.contract[side][key]);
    for (const name of Object.keys(a)) {
      if (!(name in b)) diffs.push({ side, kind: 'missing-in-target', name });
      else if (a[name].type !== b[name].type) diffs.push({ side, kind: 'type', name, from: a[name].type, to: b[name].type });
      else if (a[name].required !== b[name].required) diffs.push({ side, kind: 'required', name, from: a[name].required, to: b[name].required });
    }
    for (const name of Object.keys(b)) if (!(name in a)) diffs.push({ side, kind: 'extra-in-target', name });
  }
  return { same: diffs.length === 0, diffs };
}

// Alle integrationer i en org, med om de er aktive. En inaktiv integration kan
// ikke bruges: en action i den kører ikke.
async function listIntegrations(customer) {
  const { token, apiBase } = await getToken(customer);
  const out = [];
  for (let p = 1; ; p++) {
    const r = await axios.get(`${apiBase}/api/v2/integrations`, {
      headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 100, pageNumber: p } });
    const e = r.data.entities || [];
    for (const i of e) out.push({
      id: i.id, name: i.name, type: i.integrationType?.id || '',
      active: (i.reportedState?.code || '') === 'ACTIVE'
    });
    if (e.length < 100) break;
  }
  return out;
}

// Alle data actions i en org med integrationens navn og type.
async function listDataActionsFull(customer) {
  const { token, apiBase } = await getToken(customer);
  const ints = {};
  for (const i of await listIntegrations(customer)) ints[i.id] = i;
  return (await listDataActions(token, apiBase)).map(a => ({
    ...a, integrationName: (ints[a.integrationId] || {}).name || a.category || '',
    integrationType: (ints[a.integrationId] || {}).type || ''
  }));
}

// ── Setup-forslag: hvor skal de nye data actions hen? ────────────────────────
//
// En integration rummer kun et vist antal actions. Hos en kunde var prod delt
// ud på mange integrationer, og test på få, så "samme integration som i test"
// findes ikke eller er fuld. Forslaget fordeler de actions der mangler i målet
// på de aktive integrationer af samme type, med plads, og holder en
// integrations actions samlet hvor det kan lade sig gøre.
//
//   todo         — [{ id, name, category, integrationName, integrationType }]
//   integrations — målets: [{ id, name, type, active, existing }]
//   capacity     — hvor mange actions en integration højst rummer
//
// Ren funktion, så den kan prøves uden en org.
function planDataActionPlacement(todo, integrations, capacity) {
  const cap = Math.max(1, parseInt(capacity, 10) || 100);
  const free = new Map(integrations.map(i => [i.id, Math.max(0, cap - (i.existing || 0))]));
  const groups = new Map();
  for (const a of todo) {
    const k = a.integrationType + '\u0001' + a.integrationName;
    if (!groups.has(k)) groups.set(k, { integrationName: a.integrationName, integrationType: a.integrationType, actions: [] });
    groups.get(k).actions.push({ id: a.id, name: a.name, category: a.category });
  }
  const placements = [];
  // Store grupper først: de har sværest ved at finde plads samlet.
  for (const g of [...groups.values()].sort((a, b) => b.actions.length - a.actions.length || a.integrationName.localeCompare(b.integrationName))) {
    const eligible = integrations.filter(i => i.active && i.type === g.integrationType)
      .sort((a, b) => (b.name === g.integrationName) - (a.name === g.integrationName)
                    || free.get(b.id) - free.get(a.id) || a.name.localeCompare(b.name));
    const size = g.actions.length;
    const allocations = [];
    let rest = g.actions.slice();
    const whole = eligible.find(i => free.get(i.id) >= size);
    if (whole) {
      allocations.push({ integrationId: whole.id, integrationName: whole.name, actions: rest });
      free.set(whole.id, free.get(whole.id) - size);
      rest = [];
    } else {
      for (const i of [...eligible].sort((a, b) => free.get(b.id) - free.get(a.id) || a.name.localeCompare(b.name))) {
        if (!rest.length) break;
        const take = Math.min(free.get(i.id), rest.length);
        if (take <= 0) continue;
        allocations.push({ integrationId: i.id, integrationName: i.name, actions: rest.slice(0, take) });
        free.set(i.id, free.get(i.id) - take);
        rest = rest.slice(take);
      }
    }
    placements.push({
      integrationName: g.integrationName, integrationType: g.integrationType, count: size, allocations,
      // Det der ikke kunne placeres: enten findes ingen aktiv integration af typen, eller de er fulde.
      unplaced: rest.length ? { count: rest.length, actions: rest, reason: eligible.length ? 'no-capacity' : 'no-integration',
                                suggestedName: g.integrationName } : null
    });
  }
  const planned = new Map();
  for (const p of placements) for (const a of p.allocations) planned.set(a.integrationId, (planned.get(a.integrationId) || 0) + a.actions.length);
  return {
    capacity: cap, placements,
    integrations: integrations.map(i => ({ ...i, planned: planned.get(i.id) || 0, capacity: cap }))
  };
}

app.post('/api/data-actions/plan', async (req, res) => {
  const { sourceId, targetId, capacity } = req.body || {};
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (source.id === target.id) return res.status(400).json({ error: 'Kilde og mål er det samme miljø.' });
  if (orgKeyOf(source) === orgKeyOf(target)) return res.json({ ok: true, sameOrg: true });
  try {
    const [src, tgt, tgtInts, saved] = await Promise.all([
      listDataActionsFull(source), listDataActionsFull(target), listIntegrations(target), loadDataActionMap(source, target)]);
    const rows = compareDataActionSets(src, tgt, saved);
    // Kun det der mangler helt og kan oprettes herfra. Samme navn under en anden
    // kategori er et valg (totaltjekket), og en FDA kan ikke oprettes herfra.
    const todo = rows.filter(r => r.status === 'absent' && !r.fda);
    const existing = {};
    for (const a of tgt) existing[a.integrationId] = (existing[a.integrationId] || 0) + 1;
    const plan = planDataActionPlacement(todo, tgtInts
      .filter(i => i.type !== FUNCTION_INTEGRATION && /data-actions$|rest-actions$/.test(i.type))
      .map(i => ({ ...i, existing: existing[i.id] || 0 })), capacity);
    addLog('INFO', `Data action setup proposal ${source.name} → ${target.name}: ${todo.length} to place`, source.name, 'MIGRATE');
    res.json({
      ok: true, ...plan, saved,
      summary: { toPlace: todo.length, choose: rows.filter(r => r.status === 'choose').length,
                 fdaMissing: rows.filter(r => r.fda && (r.status === 'absent' || r.status === 'choose')).length,
                 alreadyThere: rows.filter(r => r.status === 'same' || r.status === 'mapped').length },
      manual: rows.filter(r => r.fda && (r.status === 'absent' || r.status === 'choose'))
                  .map(r => ({ name: r.name, category: r.category, integrationName: r.integrationName })),
      choose: rows.filter(r => r.status === 'choose').map(r => ({ name: r.name, category: r.category, candidates: r.candidates }))
    });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

app.post('/api/data-actions/compare', async (req, res) => {
  const { sourceId, targetId } = req.body || {};
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (source.id === target.id) return res.status(400).json({ error: 'Kilde og mål er det samme miljø.' });
  // To miljøer i samme org har de samme data actions. Der er intet at sammenligne.
  if (orgKeyOf(source) === orgKeyOf(target)) return res.json({ ok: true, sameOrg: true });
  try {
    const [src, tgt, saved] = await Promise.all([
      listDataActionsFull(source), listDataActionsFull(target), loadDataActionMap(source, target)]);
    const rows = compareDataActionSets(src, tgt, saved);
    addLog('INFO', `Data action check ${source.name} → ${target.name}: ${rows.length} compared`, source.name, 'MIGRATE');
    res.json({ ok: true, rows, summary: summarizeDataActionRows(rows), saved,
               targetActions: tgt.map(a => ({ category: a.category, name: a.name })) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Sammenligner kontrakterne for op til 20 par ad gangen — klienten tager dem i
// bidder, så en stor org ikke holder forbindelsen oppe i minutter.
app.post('/api/data-actions/contracts', async (req, res) => {
  const { sourceId, targetId, pairs } = req.body || {};
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > 20)
    return res.status(400).json({ error: 'Send mellem 1 og 20 par.' });
  try {
    const { token: st, apiBase: sb } = await getToken(source);
    const { token: tt, apiBase: tb } = await getToken(target);
    const get = (base, token, id) => axios.get(`${base}/api/v2/integrations/actions/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${token}` }, params: { expand: 'contract' } }).then(r => r.data);
    const results = [];
    for (const p of pairs) {
      try {
        const [a, b] = await Promise.all([get(sb, st, p.source), get(tb, tt, p.target)]);
        results.push({ source: p.source, target: p.target, ...compareContracts(a, b) });
      } catch (e) {
        results.push({ source: p.source, target: p.target, error: describeApiError(e) });
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Gemmer hele listen af valg for et org-par — også en fjernelse. Skriver i
// mål-org'ens manifest, så den står i prod-vagten.
app.post('/api/data-actions/map', async (req, res) => {
  const { sourceId, targetId, entries } = req.body || {};
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(entries) || entries.length > 5000) return res.status(400).json({ error: 'Ugyldig liste.' });
  try {
    const r = await saveDataActionMap(source, target, entries.filter(validDaEntry), { replace: true });
    addLog('INFO', `Data action choices for ${source.name} → ${target.name} saved: ${r.count} (${r.where === 'org' ? 'in the target manifest' : 'locally'})`, target.name, 'MIGRATE');
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// ── User prompts ──────────────────────────────────────────────────────────────

// Migrerer én user prompt med alle dens sprogressourcer.
// TTS-tekst kopieres direkte. Har en ressource indtalt lyd, hentes WAV-filen
// fra kilden og lægges op på den nye ressources uploadUri.
app.post('/api/prompts/migrate', async (req, res) => {
  const { sourceId, targetId, promptName } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  const trail = [];
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const SH = { headers: { Authorization: `Bearer ${srcToken}` } };
    const sl = await axios.get(`${srcBase}/api/v2/architect/prompts`, { ...SH, params: { pageSize: 200, name: promptName } });
    const hit = (sl.data.entities || []).find(p => p.name === promptName);
    if (!hit) return res.status(400).json({ error: `Prompt "${promptName}" findes ikke i ${source.name}` });
    const src = (await axios.get(`${srcBase}/api/v2/architect/prompts/${hit.id}`, SH)).data;

    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const TH = { headers: { Authorization: `Bearer ${tgtToken}` } };
    const TJ = { headers: { ...TH.headers, 'Content-Type': 'application/json' } };

    const ex = await axios.get(`${tgtBase}/api/v2/architect/prompts`, { ...TH, params: { pageSize: 200, name: promptName } });
    if ((ex.data.entities || []).some(p => p.name === promptName))
      return res.status(409).json({ error: 'already_exists', message: `Prompt "${promptName}" findes allerede i ${target.name}` });

    const created = (await axios.post(`${tgtBase}/api/v2/architect/prompts`,
      { name: src.name, description: src.description || '' }, TJ)).data;

    let ok = 0, audioOk = 0, audioFail = 0;
    for (const r of src.resources || []) {
      try {
        const nr = (await axios.post(`${tgtBase}/api/v2/architect/prompts/${created.id}/resources`,
          { language: r.language, ttsString: r.ttsString || undefined, text: r.text || undefined }, TJ)).data;
        ok++;

        if (!r.mediaUri) { trail.push(`✓ ${r.language} (TTS)`); continue; }

        // Indtalt lyd: hent WAV'en fra kilden og læg den op på den nye ressource
        if (!nr.uploadUri) { trail.push(`⚠ ${r.language}: lyd kunne ikke uploades (ingen uploadUri)`); audioFail++; continue; }
        const wav = await axios.get(r.mediaUri, { responseType: 'arraybuffer', timeout: 60000 });
        const form = new FormData();
        form.append('file', new Blob([wav.data], { type: 'audio/wav' }), `${r.language}.wav`);
        const up = await fetch(nr.uploadUri, {
          method: 'POST', headers: { Authorization: `Bearer ${tgtToken}` }, body: form
        });
        if (!up.ok) { trail.push(`⚠ ${r.language}: lyd-upload svarede ${up.status}`); audioFail++; }
        else { trail.push(`✓ ${r.language} (lyd, ${Math.round(wav.data.length / 1024)} kB)`); audioOk++; }
      } catch (e) {
        trail.push(`✗ ${r.language}: ${describeApiError(e)}`);
      }
    }

    addLog('SUCCESS', `Prompt "${promptName}" migrated to ${target.name} — ${ok} languages` +
      (audioOk ? `, ${audioOk} with audio` : '') + (audioFail ? `, ${audioFail} audio failed` : ''), source.name, 'MIGRATE');
    res.json({ ok: true, id: created.id, name: created.name, languages: ok, audioOk, audioFail, trail });

  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Prompt "${promptName}" failed: ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg, trail });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Genesys svarer typisk 400 med en intetsigende "Bad Request" i .message, mens
// den egentlige årsag ligger i .code, .details[] og .errors[]. Vi plukkede kun
// .message ud, så loggen sagde reelt ingenting. Denne samler hele svaret til én
// linje — inkl. hvilket kald der fejlede og contextId til Genesys support.
function describeApiError(e) {
  const d = e.response?.data;
  if (!d) return e.message;

  const parts = [];
  const base = d.message || d.error || e.message;
  if (base) parts.push(base);
  if (d.code && d.code !== base) parts.push(`[${d.code}]`);

  // Feltspecifikke valideringsfejl — det er her årsagen som regel står
  const bits = [];
  for (const det of d.details || []) {
    const bit = [det.fieldName, det.entityName, det.errorCode].filter(Boolean).join(' ');
    if (bit) bits.push(bit);
  }
  for (const err of d.errors || []) {
    const bit = err.message || err.code;
    if (bit) bits.push(bit);
  }
  if (bits.length) parts.push('— ' + bits.join('; '));

  // Fandt vi intet brugbart, så vis de felter vi ikke allerede har vist,
  // frem for at tabe dem på gulvet
  if (!bits.length && (!base || /^bad request$/i.test(base))) {
    const shown = ['message', 'error', 'code', 'status', 'contextId', 'details', 'errors', 'messageParams'];
    const rest = Object.fromEntries(Object.entries(d).filter(([k, v]) => !shown.includes(k) && v != null));
    if (Object.keys(rest).length) parts.push('— ' + JSON.stringify(rest).slice(0, 400));
  }

  if (!parts.length) parts.push(e.message || 'Unknown error');

  if (e.response.status) parts.push(`(HTTP ${e.response.status}`);
  else parts.push('(');
  if (e.config?.url) {
    const p = e.config.url.replace(/^https?:\/\/[^/]+/, '');
    parts[parts.length - 1] += ` ${(e.config.method || 'get').toUpperCase()} ${p}`;
  }
  parts[parts.length - 1] += ')';

  if (d.contextId) parts.push(`contextId=${d.contextId}`);

  return parts.join(' ');
}

// En Data Actions config peger på template-FILER hos kilden via
// requestTemplateUri / successTemplateUri, og de URI'er indeholder kildens
// action-id. Kopieres de råt til en anden org, peger de på en action der ikke
// findes der. Vi henter derfor indholdet og sender det som inline templates.
async function inlineActionTemplates(cfg, apiBase, token) {
  const out = {
    request:  { ...(cfg.request  || {}) },
    response: { ...(cfg.response || {}) }
  };
  const warnings = [];
  const jobs = [
    ['request',  'requestTemplateUri', 'requestTemplate'],
    ['response', 'successTemplateUri', 'successTemplate']
  ];
  for (const [section, uriKey, tplKey] of jobs) {
    const uri = out[section][uriKey];
    if (!uri) continue;
    if (out[section][tplKey]) { delete out[section][uriKey]; continue; }
    try {
      const r = await axios.get(`${apiBase}${uri}`, { headers: { Authorization: `Bearer ${token}` } });
      out[section][tplKey] = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      delete out[section][uriKey];
    } catch (e) {
      // Behold URI'en ikke — den ville pege på kildens org
      delete out[section][uriKey];
      warnings.push(`Kunne ikke hente ${tplKey}: ${describeApiError(e)}`);
    }
  }
  return { config: out, warnings };
}

// Kontrakten indeholder både inline-skemaer og *SchemaUri-pegepinde, og
// pegepindene bærer kildens action-id. De ville referere en action der ikke
// findes i målorganisationen, så vi sender kun de inline skemaer.
function stripSchemaUris(section) {
  if (!section || typeof section !== 'object') return section;
  return Object.fromEntries(Object.entries(section).filter(([k]) => !/Uri$/.test(k)));
}

function sanitizeName(name) {
  // Remove Windows-invalid path chars, keep rest as-is
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'unknown';
}

// Et miljøs eksporter ligger i flows/<navn>. Skifter navnet, skal mappen med —
// ellers ser Flow Browser og rollback-cachen en tom mappe og glemmer alt der
// er hentet. Findes den nye mappe allerede, flettes der ikke: så bliver begge
// stående, og loggen siger det.
function moveCustomerFolder(oldName, newName) {
  const from = path.join(FLOWS_DIR, sanitizeName(oldName));
  const to   = path.join(FLOWS_DIR, sanitizeName(newName));
  if (from === to || !fs.existsSync(from)) return;
  // Kun forskel i store/små bogstaver: på Windows ER det den samme mappe.
  if (from.toLowerCase() === to.toLowerCase()) {
    try { fs.renameSync(from, to); } catch (_) {}
    return;
  }
  if (fs.existsSync(to)) {
    addLog('WARN', `Folder not moved: "${path.basename(to)}" already exists — exports stay in "${path.basename(from)}"`, newName, 'CUSTOMER');
    return;
  }
  try { fs.renameSync(from, to); }
  catch (e) { addLog('WARN', `Could not move folder "${path.basename(from)}": ${e.message}`, newName, 'CUSTOMER'); }
}

// ── Felter fra klienten ──────────────────────────────────────────────────────

// Et manglende felt skal give en besked man kan handle på. Uden dette kom
// /api/export ud som
//
//     500 Cannot read properties of undefined (reading 'toLowerCase')
//
// fordi flowType blev brugt før nogen havde set efter om den var der. Det er en
// Node-fejl, ikke en forklaring: den siger hvad koden snublede over, ikke hvad
// man selv har glemt at sende.
//
// Returnerer null når alt er der, ellers en besked der navngiver de felter der
// mangler.
function missingFields(body, felter) {
  const mangler = felter.filter(f => typeof body?.[f] !== 'string' || !body[f].trim());
  if (!mangler.length) return null;
  return mangler.length === 1
    ? `Missing or empty field: ${mangler[0]}`
    : `Missing or empty fields: ${mangler.join(', ')}`;
}

// ── Filstier fra klienten ────────────────────────────────────────────────────

// Ligger stien inden for FLOWS_DIR? path.resolve SKAL med: uden den slipper
// "…\flows\..\customers.json" igennem, fordi strengen jo begynder rigtigt.
// Målt før rettelsen: /api/files/content udleverede hele customers.json med
// alle kunders credentials på den måde.
function insideFlowsDir(p) {
  if (!p) return false;
  const rod = path.resolve(FLOWS_DIR);
  const sti = path.resolve(String(p));
  return sti === rod || sti.startsWith(rod + path.sep);
}

// Et filnavn fra klienten må ikke kunne pege ud af den mappe det hører til.
// path.join(importDir, "../../../fil.yaml") lander uden for FLOWS_DIR, og
// /api/import skrev dér uden at spørge — målt landede filen i C:\Tools\.
// Vi tager derfor kun selve navnet, uden mapper, og renser det. Så er der
// ingenting tilbage at navigere med.
function safeFileName(navn, standard) {
  const kun = path.basename(String(navn || '').replace(/\\/g, '/'));
  const rent = sanitizeName(kun).replace(/^[.\s]+/, '').trim();
  return rent && rent !== 'unknown' ? rent : standard;
}

// ── Archy helpers ────────────────────────────────────────────────────────────

// Find archy's own directory at startup (archy.bat uses relative paths so must
// be run from there). We detect it by resolving 'where archy' on cmd.exe.
let ARCHY_DIR = null;
// Kommandoen der kalder Archy. "archy" når den findes i PATH; ellers den fulde
// sti til archy.bat, så Archy virker uden at være sat i PATH.
let ARCHY_CMD = 'archy';

// Steder Archy typisk pakkes ud, når den ikke ligger i PATH. Rækkefølgen er
// prioriteten; en sti fra settings.json (archyDir) eller miljøvariablen
// ARCHY_DIR vinder over gætene.
function archyCandidateDirs() {
  const home = process.env.USERPROFILE || os.homedir();
  const liste = [
    process.env.ARCHY_DIR,
    (() => { try { return loadSettings().archyDir; } catch (_) { return null; } })(),
    'C:\\Tools\\Archy', 'C:\\Archy', 'C:\\Program Files\\Archy', 'C:\\Program Files (x86)\\Archy',
    path.join(home, 'Archy'), path.join(home, 'archy'),
    path.join(home, 'Downloads', 'archy'), path.join(home, 'Downloads', 'Archy'),
  ];
  return liste.filter(Boolean);
}

// Finder mappen med archy.bat — direkte eller i en undermappe (bin).
function archyDirIn(dir) {
  for (const d of [dir, path.join(dir, 'bin')]) {
    if (fs.existsSync(path.join(d, 'archy.bat'))) return d;
  }
  return null;
}

try {
  const { execSync } = require('child_process');
  const archyBat = execSync('where archy', { shell: 'cmd.exe', stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().split(/\r?\n/)[0].trim();
  ARCHY_DIR = path.dirname(archyBat);
  console.log(`[archy] Found at: ${ARCHY_DIR}`);
} catch (e) {
  for (const kandidat of archyCandidateDirs()) {
    const d = archyDirIn(kandidat);
    if (d) {
      ARCHY_DIR = d;
      ARCHY_CMD = `"${path.join(d, 'archy.bat')}"`;
      console.log(`[archy] Not in PATH — using ${ARCHY_DIR}`);
      break;
    }
  }
  if (!ARCHY_DIR) console.warn('[archy] Not found in PATH or in the usual folders');
}

// ── Værdier på Archys kommandolinje ──────────────────────────────────────────
// runArchy kalder exec med shell: 'cmd.exe'. Inde i en citeret streng kan et
// anførselstegn IKKE escapes i cmd — det afslutter citatet, og resten af
// værdien læses som kommandoer. Målt: et flownavn som
//
//     uskyldigt" & echo naaet-igennem> "fil.txt" & rem
//
// fik echo'et til at køre. Værdien kom fra req.body, så enhver der kunne nå
// serveren kunne køre kommandoer på maskinen.
//
// Der findes ingen escape der virker, så værdien afvises i stedet. Målt på 517
// rigtige flownavne i fire orgs: ingen indeholder et anførselstegn.
function archyArg(vaerdi, felt) {
  const s = String(vaerdi ?? '');
  if (s.includes('"'))
    throw new Error(`${felt} must not contain a double quote: Archy is invoked through cmd.exe, ` +
                    `where the character cannot be escaped. Rename the flow, or export it by hand.`);
  return `"${s}"`;
}

// Værdier UDEN anførselstegn omkring — fx --flowType. Her er selv et mellemrum
// eller et & nok til at bryde ud, så de må kun bestå af de tegn de faktisk har.
function archyBareArg(vaerdi, felt) {
  const s = String(vaerdi ?? '');
  if (!/^[A-Za-z0-9_.\-]+$/.test(s))
    throw new Error(`${felt} "${s}" is not a valid name`);
  return s;
}

// --flowVersion tager formen '5.0'. Tom værdi betyder Archys standard, 'latest'.
function archyVersionFlag(version) {
  if (version === null || version === undefined || version === '') return '';
  const s = String(version).trim();
  if (!/^\d+(\.\d+)?$/.test(s))
    throw new Error(`Invalid flow version "${s}" — expected e.g. 5.0`);
  return `--flowVersion ${archyArg(s.includes('.') ? s : s + '.0', 'Flow version')} `;
}

// Underkommandoen er ikke en værdi — den er et af tre faste ord. Den kom fra
// req.body.action og gik uciteret ind i kommandoen.
const ARCHY_VERBS = new Set(['create', 'update', 'publish']);
function archyVerb(handling) {
  const s = String(handling || 'create');
  if (!ARCHY_VERBS.has(s))
    throw new Error(`Unknown action "${s}" — use create, update or publish`);
  return s;
}

// Build credential flags for archy CLI (no config file needed)
function archyCredFlags(customer) {
  // OAuth customers: use stored bearer token
  if (customer.authType === 'oauth')
    return `--authToken ${archyArg(oauthToken(customer), 'Token')} --location ${archyArg(customer.region, 'Region')}`;

  // Client credentials. Tidligere blev " erstattet med \" — den escape virker i
  // en POSIX-skal, men ikke i cmd.exe, så et secret med et anførselstegn ville
  // være brudt ud på samme måde som flownavnet.
  return `--clientId ${archyArg(customer.clientId, 'Client ID')} ` +
         `--clientSecret ${archyArg(customer.clientSecret, 'Client Secret')} ` +
         `--location ${archyArg(customer.region, 'Region')}`;
}

function parseArchyOutput(raw) {
  if (!raw) return raw;
  const cleaned = raw
    .replace(/\x1B\[[0-9;]*m/g, '')
    .replace(/\[0m/g, '');
  const filtered = cleaned.split(/\r?\n/).filter(line => {
    const t = line.trim();
    if (/^\*{5,}/.test(t)) return false;
    if (/Archy - Architect Yaml Flow Processor/.test(t)) return false;
    if (/^DateTime:/.test(t)) return false;
    if (t === 'Summary') return false;
    if (/^Log:\s/.test(t)) return false;
    if (/^[┌┐└┘]/.test(t)) return false;
    if (/Archy (patch|minor|major) version update available/.test(t)) return false;
    if (/Changelog:.*genesys/.test(t)) return false;
    if (/Run archy version.*to upgrade/.test(t)) return false;
    if (t === 'execution complete.') return false;
    if (/^exit code:/.test(t)) return false;
    return true;
  });
  const result = [];
  let prevBlank = false;
  for (const line of filtered) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue;
    result.push(line);
    prevBlank = isBlank;
  }
  return result.join('\n').trim();
}

const ARCHY_LOG_TAIL = 30; // Max lines shown from Archy error output

function truncateArchyError(raw) {
  if (!raw) return raw;
  const lines = raw.split(/\r?\n/);
  if (lines.length <= ARCHY_LOG_TAIL) return raw;
  const tail = lines.slice(-ARCHY_LOG_TAIL);
  return `[... ${lines.length - ARCHY_LOG_TAIL} lines hidden — showing the last ${ARCHY_LOG_TAIL} ...]\n` + tail.join('\n');
}

// Archy skriver stien til sin egen fulde udskrift i en "Log:"-linje til sidst.
// parseArchyOutput filtrerer den væk som støj — med rette når det gik godt.
//
// Men når det gik galt, er den den eneste pegepind til hele detaljen, og det vi
// selv kan trække ud er nogle gange kun "Architect Scripting session ended in
// error ( code: 99 )". Tre migreringer fejlede sådan, og der var intet at gå
// videre med — mens hele forklaringen lå i en fil vi kendte stien til og smed
// væk. Så hæftes den på fejlen i stedet.
function archyDebugLog(out) {
  const m = String(out || '').match(/^[ \t]*Log:[ \t]*(\S.*?)[ \t]*$/mi);
  return m ? m[1] : null;
}

function withArchyLog(besked, out) {
  const sti = archyDebugLog(out);
  return sti ? `${besked}\n  — full Archy output: ${sti}` : besked;
}

// Fejler et flow valideringen, står den brugbare tekst i "Validation Results"
// — ikke i opsummeringen, som kun TÆLLER. Og opsummeringen sætter warnings
// sidst:
//
//     ERROR - the flow has 1 error(s). (see above)
//     WARNING - the flow has 14 warning(s). (see above)
//     Error(s) and warning(s) encountered.
//
// Baglænssøgningen ramte derfor WARNING-linjen og skjulte fejlen helt. Brugeren
// fik "the flow has 14 warning(s)" og kunne intet stille op med det, mens den
// eneste sætning der forklarede noget — "A data action must be selected." —
// stod hundrede linjer længere oppe.
//
// Blokken ser sådan ud, og både navnet og stien hører med:
//
//     1 -> [Type:'ArchValidationIssue', ErrorCount:1, ArchObject:[…, Name:'Call Data Action', …]]
//     A data action must be selected.
//         ___ Yaml Info ___
//         ref path: /inboundEmail/states/state[Initial State_11]/actions/callData[…]
//
// RollupErrorCount er en optælling af de samme fejl et niveau oppe ("There is
// one action in error within this task") og tages ikke med — den ville
// fordoble hver fejl.
function archyValidationIssues(lines) {
  const start = lines.findIndex(l => /^Validation Results$/i.test(l));
  if (start === -1) return [];
  const ud = [];
  for (let i = start; i < lines.length; i++) {
    const h = lines[i].match(/^\d+\s*->\s*\[Type:'ArchValidationIssue',\s*ErrorCount:\d+/);
    if (!h) continue;
    const navn = (lines[i].match(/Name:'([^']*)'/) || [])[1];
    const efter = lines.slice(i + 1, i + 8);
    const besked = efter.find(x => x && !/^_+\s*Yaml Info|^ref path:|^name:/i.test(x));
    if (!besked) continue;
    const sti = (efter.find(x => /^ref path:/i.test(x)) || '').replace(/^ref path:\s*/i, '').trim();
    const hvor = [navn, sti].filter(Boolean).join(' i ');
    ud.push(hvor ? `${besked} (${hvor})` : besked);
  }
  return ud;
}

// Hvorfor en genpublicering fejlede, i en form brugerfladen kan forklare.
// Genpublicering eksporterer den publicerede udgave og importerer den igen —
// og så valideres flowet mod org'en som den er NU. Peger det på en kø der er
// slettet, eller en TTS-stemme org'en ikke har længere, afviser Archy det,
// selvom flowet kører i dag. Teksten er archyErrorReason's, evt. med stien til
// Archys debug-log på.
const REF_KIND = [
  [/queue/i, 'queue'], [/user/i, 'user'], [/datatable/i, 'datatable'],
  [/dataaction|^action$/i, 'dataaction'], [/prompt|audio/i, 'prompt'],
  [/schedule|emergency/i, 'schedule'], [/flow|module/i, 'flow']
];
function explainRepublishFailure(msg) {
  const tekst = String(msg || '');
  const debugFile = (tekst.match(/full Archy output:\s*(.+?\.txt)/i) || [])[1] || null;
  const reason = tekst.replace(/\s*—\s*full Archy output:.*$/i, '').trim();
  const [, field = null, sti = null] = reason.match(/\('([^']+)' i '([^']+)'\)/) || [];
  // Hvor i flowet: det sidste navngivne element i stien, fx menu[EG_Demo_69].
  // Archys egne løbenavne (_^_archy_…) siger ikke brugeren noget.
  const navngivne = [...String(sti || '').matchAll(/(\w+)\[([^\]]+)\]/g)]
    .filter(m => !m[2].startsWith('_^_archy'));
  const where = navngivne.length ? `${navngivne.at(-1)[1]} "${navngivne.at(-1)[2]}"` : null;
  const ud = { kind: 'other', field, where, path: sti, reason, debugFile };

  let m;
  if ((m = reason.match(/text to speech voice with the name '([^']+)'.*?language '([^']+)'/i)))
    return { ...ud, kind: 'tts-voice', value: m[1], lang: m[2] };
  if ((m = reason.match(/default voice was not found for engine '[^']+' and language '([^']+)'/i)))
    return { ...ud, kind: 'tts-default', lang: m[1] };
  if (/no matches/i.test(reason)) {
    const hit = REF_KIND.find(([re]) => re.test(field || ''));
    return { ...ud, kind: 'missing-ref', what: hit ? hit[1] : 'other' };
  }
  if (/expected an? \w+ but got null/i.test(reason)) return { ...ud, kind: 'empty-field' };
  if (/checked out|locked/i.test(reason)) return { ...ud, kind: 'locked' };
  return ud;
}

// Trækker den forklarende årsag ud af Archys output. Ved TLS-fejl er Archys
// egen konklusion ("ugyldige credentials") misvisende, så den underliggende
// certifikatfejl tages med i stedet.
function archyErrorReason(out) {
  const lines = out.split(/\r?\n/)
    .map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))            // ANSI-farver
    .map(l => l.replace(/^\S+Z:\s*\[[A-Z]+\]\s*/, ''))      // debug-log-præfiks
    .map(l => l.trim());

  let summary = '';
  // Hvor i udskriften årsagen blev fundet. Path: og Property name: står som
  // indrykkede detaljelinjer LIGE UNDER deres overskrift, så de skal hentes
  // dér — ikke med find() gennem hele udskriften. Målt: i et flow med mange
  // variabler blev den første forekomst grebet, og brugeren fik
  // "('stringVariable' i '/inboundEmail/variables/stringVariable')" hængt på en
  // fejl den intet havde med at gøre.
  let summaryIndex = -1;
  // -1 og samtidig et summary betyder: årsagen bærer allerede sin egen sti.
  let harEgenSti = false;

  // Detaljelinjerne der hører til overskriften på linje i.
  const detaljer = (i) => {
    const nær = i >= 0 ? lines.slice(i + 1, i + 4) : [];
    const hent = (re) => (nær.find(l => re.test(l)) || '').replace(re, '').trim();
    return { prop: hent(/^Property name:\s*/i), sti: hent(/^Path:\s*/i) };
  };

  const valideringsfejl = archyValidationIssues(lines);
  if (valideringsfejl.length) {
    summary = valideringsfejl.slice(0, 3).join(' · ');
    if (valideringsfejl.length > 3) summary += ` (+${valideringsfejl.length - 3} more)`;
    harEgenSti = true;
  }

  // Ved YAML-/importfejl lægger Archy den egentlige årsag i en "Exception:"-linje
  // langt over sin afsluttende opsummering. Den er langt mere brugbar end det
  // der står lige før terminatoren (typisk "Flow Name: '…'").
  const excIndex = summary ? -1 : lines.findIndex(l => /^Exception:/i.test(l));
  if (excIndex >= 0) {
    summaryIndex = excIndex;
    summary = lines[excIndex]
      .replace(/^Exception:\s*-?\s*(ERROR!\s*)?/i, '')
      .replace(/\s*--\s*\[.*$/, '')          // metadata-halen
      .trim();
    // Tag den ramte property og sti med — det er dem man skal rette i YAML'en
    const { prop, sti } = detaljer(excIndex);
    if (prop) summary += ` (${prop}${sti ? ' i ' + sti : ''})`;
  }

  // Ellers: Archys egen konklusion lige før "Error(s) [and warning(s)] encountered."
  //
  // Archy skriver fejlen som en overskriftslinje efterfulgt af indrykkede
  // detaljer:
  //
  //     did not find a text to speech voice with the name 'da-DK-Standard-C' …
  //         Path: '/inboundCall/supportedLanguages/textToSpeech'
  //         Property name: 'voice'
  //
  // Detaljerne SKAL tælle som støj når vi leder baglæns efter overskriften —
  // ellers greb vi "Property name: 'voice'" og kastede den eneste brugbare
  // sætning væk. De hægtes i stedet på til sidst.
  if (!summary) {
    const noise = /^(\*+|DateTime:|Summary$|Command:|Log:|Flow Name:|Input YAML File:|Path:|Property name:|Value:|Line:|\||└|┌|-\s*Architect Scripting|An error occurred)/i;
    const end = lines.findIndex(l => /^Error\(s\)(\s+and\s+warning\(s\))?\s+encountered\.?$/i.test(l));
    if (end > 0) {
      // Opsummeringen sætter warnings EFTER errors, så den første linje man
      // møder baglæns er warning-linjen. Har Archy også talt fejl, er det dem
      // der gør at kommandoen mislykkedes — de vinder.
      const fejlLinje = lines.slice(Math.max(0, end - 12), end)
        .find(l => /^ERROR\s*-\s*the flow has/i.test(l));
      if (fejlLinje) summary = fejlLinje;

      for (let i = end - 1; !summary && i >= 0 && end - i < 12; i--) {
        const l = lines[i];
        if (l && !noise.test(l) && !/Architect Yaml Flow Processor/i.test(l)) {
          summary = l; summaryIndex = i; break;
        }
      }
    }
  }

  // Sti og property hører til — det er dem man skal rette i YAML'en. Men kun
  // DEM DER STÅR UNDER den overskrift vi valgte. Tidligere blev de hentet med
  // find() gennem hele udskriften, og så fulgte der en sti med der intet havde
  // med fejlen at gøre.
  if (summary && !harEgenSti && !/\($/.test(summary)) {
    const { prop, sti } = detaljer(summaryIndex);
    if (prop && !summary.includes(prop)) summary += ` (${prop}${sti ? ' i ' + sti : ''})`;
  }

  // Manglende Genesys-rettigheder ender også som den generiske "session ended
  // in error ( code: 99 )". Rettighedens navn står i en linje for sig og er det
  // eneste brugbare — uden det aner man ikke hvad man skal gøre.
  const perm = lines.find(l => /missing permission '[^']+'|the '[^']+' permission is required/i.test(l));
  if (perm && (!summary || /session ended in error/i.test(summary))) {
    const p = perm.match(/'([^']+)'/);
    summary = p
      ? `The OAuth client is missing the '${p[1]}' permission in this org`
      : perm.replace(/\s*--\s*\[.*$/, '');
  }

  // Archy melder en manglende ressource som "find '<type>' by value of '<navn>'
  // - no matches", men opsummerer det som "Architect Scripting session ended in
  // error ( code: 99 )". Den generiske linje siger intet, så vi foretrækker den
  // specifikke.
  if (!summary || /session ended in error/i.test(summary)) {
    const miss = lines.find(l => /find '[^']+' by value of '[^']+'\s*-\s*no matches/i.test(l));
    const m = miss && miss.match(/find '([^']+)' by value of '([^']+)'/i);
    if (m) summary = `${m[1]} "${m[2]}" does not exist in the target org`;
  }

  // Ved TLS-fejl er Archys egen konklusion ("ugyldige credentials") misvisende,
  // så den underliggende certifikatfejl skal frem i stedet.
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate/i.test(out)) {
    return 'Archy could not verify the certificate chain (UNABLE_TO_VERIFY_LEAF_SIGNATURE) — typically ' +
           'TLS inspection by Norton or a corporate proxy. Archy runs with --use-system-ca, so ' +
           'the proxy root CA must be installed in the Windows certificate store.' +
           (summary ? ` [Archy: ${summary}]` : '');
  }
  return summary;
}

// Archy er en kompileret .exe med sin egen indlejrede Node. Den forstår IKKE
// --use-system-ca (flaget kom i Node 22.15, binæren er ældre), så bag TLS-
// inspektion — Norton, firmaproxy — fejler den med UNABLE_TO_VERIFY_LEAF_SIGNATURE
// og rapporterer det misvisende som ugyldige credentials.
//
// NODE_EXTRA_CA_CERTS respekterer den derimod. Vi kan ikke regne med at
// variablen er sat i miljøet, så vi skriver vores eget bundle: Nodes indbyggede
// rødder + Windows' certifikatlager (hvor proxyens root ligger installeret).
// Målt: bundle uden proxyens egen .pem er nok, så løsningen er ikke Norton-specifik.
let ARCHY_CA_BUNDLE = null;
function ensureArchyCaBundle() {
  if (ARCHY_CA_BUNDLE !== null) return ARCHY_CA_BUNDLE;
  ARCHY_CA_BUNDLE = false;
  try {
    const tls = require('tls');
    if (typeof tls.getCACertificates !== 'function') return ARCHY_CA_BUNDLE;  // Node < 22.15
    const seen = new Set(), pems = [];
    for (const kind of ['bundled', 'system', 'extra']) {
      let certs = [];
      try { certs = tls.getCACertificates(kind) || []; } catch (_) {}
      for (const pem of certs) if (pem && !seen.has(pem)) { seen.add(pem); pems.push(pem.trim()); }
    }
    if (!pems.length) return ARCHY_CA_BUNDLE;
    const file = path.join(__dirname, '.archy-ca.pem');
    fs.writeFileSync(file, pems.join('\n') + '\n');
    ARCHY_CA_BUNDLE = file;
    addLog('INFO', `CA bundle for Archy written (${pems.length} certificates)`, null, 'SYSTEM');
  } catch (e) {
    addLog('WARN', `Could not build the CA bundle for Archy: ${e.message}`, null, 'SYSTEM');
  }
  return ARCHY_CA_BUNDLE;
}

function runArchy(args, customer) {
  return new Promise((resolve, reject) => {
    // Samme vagt som i getToken. Archy-vejene går ikke gennem getToken, så et
    // demo-miljø nåede helt frem til Archy og fik en uforståelig fejl om at
    // "demo" ikke er en gyldig Genesys-region.
    if (isDemo(customer))
      return reject(new Error(`"${customer.name}" is a demo environment — it exists only locally, ` +
        `so there is no org to run Archy against. Use the Pipeline page to try promotions.`));
    if (!ARCHY_DIR) return reject(new Error("Archy was not found. Add Archy to PATH, or put the folder holding archy.bat in \"archyDir\" in settings.json, then restart with start.bat."));
    const cmd = `${ARCHY_CMD} ${args} ${archyCredFlags(customer)}`;
    const bundle = ensureArchyCaBundle();
    const env = { ...process.env };
    if (bundle) env.NODE_EXTRA_CA_CERTS = bundle;
    exec(cmd, {
      cwd: ARCHY_DIR, shell: 'cmd.exe', timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,      // Archys debug-output kan være stort
      env
    }, (err, stdout, stderr) => {
      const combined = (stdout || '') + '\n' + (stderr || '');
      const parsed   = parseArchyOutput(combined) || '';

      // Archy afslutter med et banner: "… - Finish" ved succes, "… - Failure"
      // ved fejl. Det er det eneste pålidelige signal. De tidligere heuristikker
      // matchede ALTID: "execution complete." printes ved begge udfald, og
      // fejl-output indeholder "did not fetch versions successfully" — så enhver
      // rigtig Archy-fejl blev slugt og fremstod som en succes.
      const failed   = /Architect Yaml Flow Processor[^\n]*-\s*Failure/i.test(combined);
      const finished = /Architect Yaml Flow Processor[^\n]*-\s*Finish/i.test(combined);

      // redactSecrets: err.message fra exec indeholder hele kommandolinjen,
      // inkl. --clientSecret. Den Error her ender også i svaret til browseren.
      // Stien hæftes på EFTER afkortningen, så den ikke selv bliver skrevet væk.
      const afvis = (grund) =>
        reject(new Error(redactSecrets(withArchyLog(truncateArchyError(grund), combined))));

      if (failed)               return afvis(archyErrorReason(combined) || parsed || 'Archy failed');
      if (finished || !err)     return resolve(parsed || 'OK');
      afvis(archyErrorReason(combined) || parsed || err.message);
    });
  });
}

// ── Export Flow ──────────────────────────────────────────────────────────────

app.post('/api/export', async (req, res) => {
  const { customerId, flowName, flowType } = req.body;
  const mangler = missingFields(req.body, ['flowName', 'flowType']);
  if (mangler) return res.status(400).json({ error: mangler });

  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const exportDir = path.join(FLOWS_DIR, sanitizeName(customer.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const flowTypeLower = flowType.trim().toLowerCase();
  addLog('INFO', `Exporting flow "${flowName}" (${flowTypeLower}) from ${customer.name}`, customer.name, 'EXPORT');

  try {
    // Tidligere gættede vi filnavnet ud fra flownavnet og faldt tilbage på
    // "sidste fil i mappen". Navnet fik fjernet mellemrum, filnavnene beholdt
    // dem — så ethvert flernavnsflow ramte forbi og viste et fremmed flow.
    const { yaml: content, fileName: yamlFile } =
      await exportFlowToYaml(customer, flowName, flowTypeLower);
    addLog('SUCCESS', `Exported: ${yamlFile} → ${exportDir}`, customer.name, 'EXPORT');
    res.json({ ok: true, fileName: yamlFile, content, savedTo: exportDir });
  } catch (e) {
    addLog('ERROR', `Export failed for "${flowName}": ${e.message}`, customer.name, 'EXPORT');
    res.status(500).json({ error: e.message });
  }
});

// ── Export All Flows ─────────────────────────────────────────────────────────

// In-memory job store for export-all progress tracking
const exportJobs = {};

// Note: /api/validate-yaml endpoint is defined below (before /api/import)
// See the Cross-org YAML resource validation section

app.post('/api/export-all', async (req, res) => {
  const { customerId } = req.body;
  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const jobId = Date.now().toString();
  exportJobs[jobId] = { status: 'starting', current: 0, total: 0, succeeded: 0, failed: 0, results: [], savedTo: '', done: false, cancelled: false };

  // Return jobId immediately so client can start polling
  res.json({ ok: true, jobId });

  const job = exportJobs[jobId];
  const exportDir = path.join(FLOWS_DIR, sanitizeName(customer.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  job.savedTo = exportDir;

  addLog('INFO', `Starting export of ALL flows for ${customer.name}`, customer.name, 'EXPORT');

  // Fetch all flows first — kun miljøets egne, som i Flow Browser og Export.
  let allFlows = [];
  try {
    const { token, apiBase } = await getToken(customer);
    await getOrgId(customer);
    const soeskende = loadCustomers().filter(x => orgKeyOf(x) === orgKeyOf(customer));
    let page = 1;
    while (true) {
      const resp = await axios.get(`${apiBase}/api/v2/flows`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 100, pageNumber: page, includeDraft: true }
      });
      const flows = resp.data.entities || [];
      allFlows = allFlows.concat(flows.filter(f => belongsToEnv(f.name, customer, soeskende))
        .map(f => ({ name: f.name, type: f.type })));
      if (flows.length < 100) break;
      page++;
    }
  } catch (e) {
    const errMsg = e.response?.data?.message || e.message;
    addLog('ERROR', `Could not fetch flows for ${customer.name}: ${errMsg}`, customer.name, 'EXPORT');
    job.status = 'error'; job.error = errMsg; job.done = true;
    return;
  }

  job.total = allFlows.length;
  job.status = 'running';
  addLog('INFO', `Found ${allFlows.length} flows — starting export to ${exportDir}`, customer.name, 'EXPORT');

  // Export each flow sequentially — check cancelled flag before each flow
  for (const flow of allFlows) {
    if (job.cancelled) {
      addLog('WARN', `Export cancelled by user after ${job.current}/${job.total} flows`, customer.name, 'EXPORT');
      break;
    }
    try {
      await runArchy(
        `export --flowName ${archyArg(flow.name, 'Flow name')} ` +
        `--flowType ${archyBareArg(flow.type.toLowerCase(), 'Flow type')} ` +
        `--exportType yaml --force --outputDir ${archyArg(exportDir, 'Directory')}`,
        customer
      );
      job.results.push({ name: flow.name, type: flow.type.toLowerCase(), ok: true });
      job.succeeded++;
      addLog('SUCCESS', `Exported: "${flow.name}" (${flow.type.toLowerCase()})`, customer.name, 'EXPORT');
    } catch (e) {
      job.results.push({ name: flow.name, type: flow.type.toLowerCase(), ok: false, error: e.message });
      job.failed++;
      addLog('ERROR', `Error exporting "${flow.name}": ${e.message}`, customer.name, 'EXPORT');
    }
    job.current++;
  }

  job.done = true;
  job.status = job.cancelled ? 'cancelled' : 'done';
  addLog(job.cancelled ? 'WARN' : job.failed === 0 ? 'SUCCESS' : 'WARN',
    job.cancelled
      ? `Export stopped: ${job.succeeded} flows saved to "${exportDir}"`
      : `Export all completed for ${customer.name}: ${job.succeeded}/${job.total} flows ok`,
    customer.name, 'EXPORT');

  // Clean up job after 5 minutes
  setTimeout(() => { delete exportJobs[jobId]; }, 5 * 60 * 1000);
});

app.get('/api/export-all/progress/:jobId', (req, res) => {
  const job = exportJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/api/export-all/cancel/:jobId', (req, res) => {
  const job = exportJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.done) return res.json({ ok: true, alreadyDone: true });
  job.cancelled = true;
  res.json({ ok: true });
});

// ── Import Flow ──────────────────────────────────────────────────────────────

app.post('/api/validate-yaml', async (req, res) => {
  const { customerId, yamlContent } = req.body;
  if (!customerId || !yamlContent)
    return res.status(400).json({ error: 'customerId og yamlContent er påkrævet' });

  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Kunde ikke fundet' });

  const checks = [];

  try {
    const { token, apiBase } = await getToken(customer);
    const headers = { Authorization: `Bearer ${token}` };

    // 1. Division check
    const divRe = /^\s*division:\s*["']?([^'"\n]+)["']?/gm;
    const divNames = [];
    let dm;
    while ((dm = divRe.exec(yamlContent)) !== null) {
      const v = dm[1].trim();
      if (v) divNames.push(v);
    }
    for (const div of [...new Set(divNames)]) {
      try {
        const r = await axios.get(`${apiBase}/api/v2/authorization/divisions`, {
          headers, params: { pageSize: 50, name: div }
        });
        const found = (r.data.entities || []).some(d => d.name === div);
        checks.push({ type: 'division', name: div, ok: found,
          message: found ? `Division "${div}" fundet` : `\u26a0 Division "${div}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'division', name: div, ok: null, message: `Kunne ikke tjekke division "${div}"` });
      }
    }

    // 2. Queue checks
    const tqRe = /targetQueue:[\s\S]{0,60}?name:\s*["']?([^'"\n]+)["']?/gm;
    const targetQueues = [];
    let tqm;
    while ((tqm = tqRe.exec(yamlContent)) !== null) targetQueues.push(tqm[1].trim());
    for (const qName of [...new Set(targetQueues)]) {
      try {
        const r = await axios.get(`${apiBase}/api/v2/routing/queues`, {
          headers, params: { pageSize: 25, name: qName }
        });
        const found = (r.data.entities || []).some(q => q.name === qName);
        checks.push({ type: 'queue', name: qName, ok: found,
          message: found ? `K\u00f8 "${qName}" fundet` : `\u26a0 K\u00f8 "${qName}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'queue', name: qName, ok: null, message: `Kunne ikke tjekke k\u00f8 "${qName}"` });
      }
    }

    // 3. DataTable checks
    const dtRe = /dataTable:\s*\n\s+([\w][\w _\-]+):/gm;
    const dtNames = [];
    let dtm;
    while ((dtm = dtRe.exec(yamlContent)) !== null) {
      const n = dtm[1].trim();
      if (n && !['foundOutputs','failureOutputs','outputs'].includes(n)) dtNames.push(n);
    }
    const uniqueDts = [...new Set(dtNames)];
    if (uniqueDts.length) {
      try {
        let allDts = [], page = 1;
        while (true) {
          const r = await axios.get(`${apiBase}/api/v2/flows/datatables`, {
            headers, params: { pageSize: 200, pageNumber: page }
          });
          allDts = allDts.concat(r.data.entities || []);
          if (allDts.length >= (r.data.total || 0) || !(r.data.entities || []).length) break;
          page++;
        }
        const dtSet = new Set(allDts.map(t => t.name));
        for (const n of uniqueDts)
          checks.push({ type: 'datatable', name: n, ok: dtSet.has(n),
            message: dtSet.has(n) ? `DataTable "${n}" fundet` : `\u26a0 DataTable "${n}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'datatable', name: '(alle)', ok: null, message: 'Kunne ikke hente datatables: ' + e.message });
      }
    }

    // 4. Data Action checks
    const daRe = /dataAction:\s*\n\s+([\w][\w _\-()]+):/gm;
    const daNames = [];
    let dam;
    while ((dam = daRe.exec(yamlContent)) !== null) {
      const n = dam[1].trim();
      if (n) daNames.push(n);
    }
    const uniqueDas = [...new Set(daNames)];
    if (uniqueDas.length) {
      try {
        let allDas = [], daPage = 1;
        while (true) {
          const r = await axios.get(`${apiBase}/api/v2/integrations/actions`, {
            headers, params: { pageSize: 100, pageNumber: daPage }
          });
          allDas = allDas.concat(r.data.entities || []);
          if ((r.data.entities || []).length < 100) break;
          daPage++;
        }
        const daSet = new Set(allDas.map(a => a.name));
        for (const n of uniqueDas)
          checks.push({ type: 'dataaction', name: n, ok: daSet.has(n),
            message: daSet.has(n) ? `Data Action "${n}" fundet` : `\u26a0 Data Action "${n}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'dataaction', name: '(alle)', ok: null, message: 'Kunne ikke hente Data Actions: ' + e.message });
      }
    }

    // 5. Prompt checks
    const promptRe = /prompt:\s*["']?(?:Prompt\.)?([\w_\-. ]+)["']?/gm;
    const promptNames = [];
    let pm;
    while ((pm = promptRe.exec(yamlContent)) !== null) {
      const n = pm[1].trim();
      if (n && !['true','false','noValue'].includes(n)) promptNames.push(n);
    }
    for (const pName of [...new Set(promptNames)]) {
      try {
        const r = await axios.get(`${apiBase}/api/v2/architect/prompts`, {
          headers, params: { pageSize: 25, name: pName }
        });
        const found = (r.data.entities || []).some(p => p.name === pName);
        checks.push({ type: 'prompt', name: pName, ok: found,
          message: found ? `Prompt "${pName}" fundet` : `\u26a0 Prompt "${pName}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'prompt', name: pName, ok: null, message: `Kunne ikke tjekke prompt "${pName}"` });
      }
    }

    const missing = checks.filter(c => c.ok === false).length;
    addLog(
      missing > 0 ? 'WARN' : 'SUCCESS',
      `YAML validation against ${customer.name}: ${checks.length} resources checked${missing > 0 ? ', ' + missing + ' missing' : ' \u2014 all found'}`,
      customer.name, 'IMPORT'
    );
    res.json({ ok: missing === 0, checks });

  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.post('/api/import', async (req, res) => {
  const { customerId, yamlContent, fileName, action } = req.body;
  // action: 'create' | 'update' | 'publish'
  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  // Uden dette faldt et manglende felt igennem til fs.writeFileSync og kom ud
  // som 'The "data" argument must be of type string' — en Node-fejl der intet
  // fortæller den der skal rette noget.
  if (typeof yamlContent !== 'string' || !yamlContent.trim())
    return res.status(400).json({ error: 'Ingen YAML at importere' });

  const importDir = path.join(FLOWS_DIR, `import_${safeFileName(customer.id, 'ukendt')}`);
  if (!fs.existsSync(importDir)) fs.mkdirSync(importDir, { recursive: true });

  // Navnet er kun et navn. Kom det med mapper eller ".." med, er de skrællet af.
  const trygtNavn = safeFileName(fileName, 'import.yaml');
  const filePath = path.join(importDir, trygtNavn);
  if (!insideFlowsDir(filePath))
    return res.status(400).json({ error: 'Ugyldigt filnavn' });

  let cmd;
  try { cmd = archyVerb(action); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  fs.writeFileSync(filePath, yamlContent, 'utf8');
  addLog('INFO', `Importing "${trygtNavn}" to ${customer.name} (action: ${cmd})`, customer.name, 'IMPORT');

  try {
    const out = await runArchy(`${cmd} --file ${archyArg(filePath, 'File path')}`, customer);
    addLog('SUCCESS', `Import ok: "${trygtNavn}" → ${customer.name}`, customer.name, 'IMPORT');
    // Et publiceret common module slår først igennem når de flows der kalder
    // det, publiceres igen. Samme tilbud som efter en forfremmelse.
    const hoved = yamlFlowHeader(yamlContent);
    let dependents = [];
    if (cmd === 'publish' && hoved.kind === 'commonModule' && hoved.name) {
      try { dependents = await dependentsOf(customer, hoved.name); }
      catch (e) { addLog('WARN', `Could not find the flows that use "${hoved.name}": ${describeApiError(e)}`, customer.name, 'REPUBLISH'); }
    }
    res.json({ ok: true, output: out, moduleName: hoved.name, dependents });
  } catch (e) {
    const msg = e.message || '';
    addLog('ERROR', `Import failed for "${trygtNavn}" to ${customer.name}: ${msg}`, customer.name, 'IMPORT');
    // Archy exit 108 — flow already exists with 'create' action
    if (msg.toLowerCase().includes('already exists')) {
      return res.status(409).json({ error: 'already_exists', message: msg });
    }
    // 403 / Access Denied — missing architect:flow:edit permission
    if (/403|access.?denied|forbidden|not.*authoriz|do not have.*access|insufficient.*perm/i.test(msg)) {
      return res.status(403).json({ error: 'access_denied', message: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// ── Migrate (export + import in one go) ─────────────────────────────────────

// Referencer der peger på et andet FLOW. De kan migreres med samme maskineri
// som alt andet — et common module er bare et flow af typen COMMONMODULE.
const FLOW_KINDS = new Set(['commonmodule', 'botflow', 'targetflow']);

// Migrerer ét flow som afhængighed af et andet. Modulet kan selv have
// afhængigheder — også andre common modules — så de tages først, nedefra og op.
// 'visited' bryder cirkler, og dybden er begrænset for en sikkerheds skyld.
async function migrateFlowDependency(source, target, flowName, flowType, visited, depth, trail) {
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
  const deps = scanYamlDependencies(fs.readFileSync(filePath, 'utf8'));
  const { token: tgtToken, apiBase: tgtBase } = await getToken(target);

  // 1) Tabeller og data actions modulet bruger
  for (const kind of ['datatable', 'dataaction']) {
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
    try { existing = await lookupExisting(kind, wanted, tgtToken, tgtBase); }
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
      if (kind === 'datatable') {
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
    try { existing = await lookupExisting(kind, wanted, tgtToken, tgtBase); }
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
      const sub = await migrateFlowDependency(source, target, hit.name, hit.type, visited, depth + 1, trail);
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
  if (prefixOf(source) !== prefixOf(target) || divisionOf(source) !== nyDivision) {
    let yaml = fs.readFileSync(filePath, 'utf8');
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
    await runArchy(`publish --file ${archyArg(importFile, 'File path')}`, target);
    addLog('SUCCESS', `Flow dependency "${nyName}" (${flowType}) migrated to ${target.name}`, target.name, 'MIGRATE');
    return { ok: true };
  } catch (e) {
    if (/already exists/i.test(e.message || '')) return { ok: true, skipped: 'exists' };
    return { ok: false, error: e.message };
  } finally {
    if (importFile !== filePath) { try { fs.unlinkSync(importFile); } catch (_) {} }
  }
}

// Opretter en manglende division i mål-org'en.
app.post('/api/divisions/create', async (req, res) => {
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

// Kopierer en survey forms definition fra kilde- til mål-org.
app.post('/api/surveyforms/migrate', async (req, res) => {
  const { sourceId, targetId, name } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const SH = { headers: { Authorization: `Bearer ${srcToken}` } };
    const list = await axios.get(`${srcBase}/api/v2/quality/forms/surveys`, { ...SH, params: { pageSize: 200 } });
    const hit = (list.data.entities || []).find(f => f.name === name);
    if (!hit) return res.status(400).json({ error: `Survey form "${name}" findes ikke i ${source.name}` });
    const full = (await axios.get(`${srcBase}/api/v2/quality/forms/surveys/${hit.id}`, SH)).data;

    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const TH = { headers: { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' } };
    const ex = await axios.get(`${tgtBase}/api/v2/quality/forms/surveys`,
      { headers: { Authorization: `Bearer ${tgtToken}` }, params: { pageSize: 200 } });
    if ((ex.data.entities || []).some(f => f.name === name))
      return res.status(409).json({ error: 'already_exists', message: `Survey form "${name}" findes allerede` });

    // id/contextId/selfUri/modifiedDate hører til kildens form og skal ikke med
    const body = {
      name: full.name,
      language: full.language,
      published: full.published,
      disabled: full.disabled,
      questionGroups: stripFormIds(full.questionGroups || [])
    };
    const r = await axios.post(`${tgtBase}/api/v2/quality/forms/surveys`, body, TH);
    addLog('SUCCESS', `Survey form "${name}" copied to ${target.name}`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Could not copy survey form "${name}": ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

// Fjerner id'er fra en formdefinition — de peger på kildens form.
function stripFormIds(node) {
  if (Array.isArray(node)) return node.map(stripFormIds);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'id' || k === 'contextId' || k === 'selfUri') continue;
      out[k] = stripFormIds(v);
    }
    return out;
  }
  return node;
}

app.post('/api/flows/migrate-dependency', async (req, res) => {
  const { sourceId, targetId, flowName, flowType } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  const trail = [];
  try {
    const r = await migrateFlowDependency(source, target, flowName, flowType, new Set(), 0, trail);
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
app.post('/api/migrate/prepare', async (req, res) => {
  const { sourceId, targetId, flowName, flowType } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  const pre = await migrationPreflight(source, target, flowName, flowType, req.body);
  if (pre.refused) return res.status(pre.refused.status).json(pre.refused.body);

  addLog('INFO', `Migration prepared: "${flowName}" from ${source.name} → ${target.name}`, source.name, 'MIGRATE');
  try {
    res.json({ ok: true, ...(await analyzeFlowForMigration(source, target, flowName, flowType, pre.kildeVersion)) });
  } catch (e) {
    addLog('ERROR', `Migration prepare failed for "${flowName}": ${e.message}`, source.name, 'MIGRATE');
    res.status(500).json({ error: e.message });
  }
});

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
        existing = await lookupExisting(kind, wanted, tgtToken, tgtBase);
      } catch (e) {
        addLog('WARN', `Could not check ${kind}: ${describeApiError(e)}`, target.name, 'MIGRATE');
        existing = new Set();
      }
      for (const name of names) {
        const iMaal = depNameIn(kind, name, target, source);
        const ok = existing.has(iMaal);
        results.push({ kind, name, ok, targetName: iMaal !== name ? iMaal : undefined });
        if (!ok && (kind === 'datatable' || kind === 'dataaction' || FLOW_KINDS.has(kind))) needSource.push(kind);
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

    // Marker hvad der kan migreres automatisk og hvad der kræver håndarbejde
    for (const r of results) {
      if (r.ok) continue;
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
        r.manualReason = 'manual_only';  // køer, skills, wrapup, scripts, prompts, divisioner
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
    return { fileName: yamlFile, filePath, yaml, deps: results, actionRefs, targetActions,
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
    else if (d.needsChoice) warnings.push({ ...item, code: 'needs-choice' });
    else warnings.push({ ...item, code: d.manualReason === 'not_in_source' ? 'not-in-source' : 'manual' });
  }
  for (const r of analysis.actionRefs || []) {
    if (r.status === 'choose') decisions.push({ kind: 'dataaction', name: r.name, category: r.category, candidates: r.candidates || [] });
    else if (r.status === 'mapped') ok++;
  }
  return { blockers, decisions, warnings, ok, canPromote: blockers.length === 0 };
}

app.post('/api/migrate/check', async (req, res) => {
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
app.post('/api/migrate/commit', async (req, res) => {
  const { sourceId, targetId, flowName, filePath, action, divisionMap } = req.body;
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
    if (skalOmskrives || daRew.changed.length) {
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
    try {
      out = await runArchy(`${cmd} --file ${archyArg(importFile, 'File path')}`, target);
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
    addLog('ERROR', `Migration failed for "${flowName}": ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

// ── Log API ───────────────────────────────────────────────────────────────────

app.get('/api/logs', (req, res) => {
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

app.get('/api/logs/stats', (req, res) => {
  const stats = { total: logStore.length, INFO: 0, SUCCESS: 0, WARN: 0, ERROR: 0 };
  for (const e of logStore) if (stats[e.level] !== undefined) stats[e.level]++;
  res.json(stats);
});

app.post('/api/logs/clear', (req, res) => {
  logStore.length = 0;
  addLog('INFO', 'Log cleared by user', null, 'SYSTEM');
  res.json({ ok: true });
});

// ── Stored YAML files ────────────────────────────────────────────────────────

// Archy navngiver eksporter <Flownavn>_v<major>-<minor>.yaml. Vi splitter det ad,
// så listen kan vise flow, version og type frem for et filnavn man skal tyde.
function parseFlowFileName(fileName) {
  const m = fileName.match(/^(.*)_v(\d+)-(\d+)\.yaml$/i);
  if (!m) return { flowName: fileName.replace(/\.yaml$/i, ''), version: null, major: null };
  return { flowName: m[1], version: `${m[2]}.${m[3]}`, major: parseInt(m[2], 10) };
}

// Flowtypen står som YAML-roden. Vi læser kun starten af filen.
function flowTypeFromFile(p) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    const head = buf.slice(0, n).toString('utf8');
    const t = head.match(/^([A-Za-z]\w*):/m);
    return t ? t[1] : null;
  } catch (_) { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
}

app.get('/api/files', (req, res) => {
  const results = [];
  if (!fs.existsSync(FLOWS_DIR)) return res.json([]);
  const customers = loadCustomers();
  for (const dir of fs.readdirSync(FLOWS_DIR)) {
    const fullDir = path.join(FLOWS_DIR, dir);
    if (!fs.statSync(fullDir).isDirectory()) continue;
    const isImportDir = dir.startsWith('import_');
    let customer;
    if (isImportDir) {
      const customerId = dir.replace('import_', '');
      customer = customers.find(c => c.id === customerId);
    } else {
      customer = customers.find(c => sanitizeName(c.name) === dir);
    }
    const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      const p = path.join(fullDir, f);
      let st = null;
      try { st = fs.statSync(p); } catch (_) {}
      const parsed = parseFlowFileName(f);
      results.push({
        customerId: customer?.id || dir, customerName: customer?.name || dir,
        fileName: f, isImport: isImportDir, path: p,
        flowName: parsed.flowName, version: parsed.version, major: parsed.major,
        flowType: flowTypeFromFile(p),
        size: st ? st.size : null,
        modified: st ? st.mtime.toISOString() : null
      });
    }
  }
  // Nyeste først
  results.sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));
  res.json(results);
});

// Rydder op i eksporterede YAML-filer: behold de nyeste N versioner af hvert
// flow pr. kunde, slet resten.
//
// Kaldes altid først med dryRun, så brugeren kan se præcis hvad der ryger.
// Filer uden versionsnummer i navnet står alene i deres egen gruppe og røres
// derfor aldrig.
app.post('/api/files/cleanup', (req, res) => {
  const keep = Math.max(1, Math.min(20, parseInt(req.body?.keep, 10) || 2));
  const dryRun = req.body?.dryRun !== false;   // slet kun når der udtrykkeligt bedes om det

  if (!fs.existsSync(FLOWS_DIR)) return res.json({ ok: true, keep, dryRun, toDelete: [], freed: 0 });

  try {
    const customers = loadCustomers();
    const groups = new Map();   // kunde|flownavn -> [filer]

    for (const dir of fs.readdirSync(FLOWS_DIR)) {
      const fullDir = path.join(FLOWS_DIR, dir);
      if (!fs.statSync(fullDir).isDirectory()) continue;
      const isImportDir = dir.startsWith('import_');
      const customer = isImportDir
        ? customers.find(c => c.id === dir.replace('import_', ''))
        : customers.find(c => sanitizeName(c.name) === dir);
      const customerName = customer?.name || dir;

      for (const f of fs.readdirSync(fullDir).filter(x => x.endsWith('.yaml'))) {
        const p = path.join(fullDir, f);
        let st; try { st = fs.statSync(p); } catch (_) { continue; }
        const parsed = parseFlowFileName(f);
        // Grupper pr. mappe, ikke kun pr. kunde: en eksport og en fil lagt op
        // til import er to forskellige ting og skal ikke udkonkurrere hinanden.
        const key = `${dir}|${parsed.flowName}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({
          path: p, fileName: f, dir, customerName, isImport: isImportDir,
          flowName: parsed.flowName, version: parsed.version, major: parsed.major,
          size: st.size, modified: st.mtime.toISOString()
        });
      }
    }

    const toDelete = [];
    for (const files of groups.values()) {
      if (files.length <= keep) continue;
      // Nyeste først: højeste version, ellers senest ændret
      files.sort((a, b) => (b.major ?? -1) !== (a.major ?? -1)
        ? (b.major ?? -1) - (a.major ?? -1)
        : String(b.modified).localeCompare(String(a.modified)));
      toDelete.push(...files.slice(keep));
    }
    const freed = toDelete.reduce((n, f) => n + f.size, 0);

    if (dryRun) return res.json({ ok: true, keep, dryRun: true, toDelete, freed });

    let deleted = 0;
    for (const f of toDelete) {
      // Bliv inden for FLOWS_DIR uanset hvad
      const resolved = path.resolve(f.path);
      if (!insideFlowsDir(resolved)) continue;
      try { fs.unlinkSync(resolved); deleted++; } catch (_) {}
    }
    addLog('SUCCESS', `Cleanup: ${deleted} old YAML files deleted (kept ${keep} per flow, ${Math.round(freed / 1024)} kB freed)`, null, 'SYSTEM');
    res.json({ ok: true, keep, dryRun: false, deleted, freed, toDelete });

  } catch (e) {
    addLog('ERROR', `Cleanup failed: ${e.message}`, null, 'SYSTEM');
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/content', (req, res) => {
  const { filePath } = req.query;
  // Tjekket var før en ren strengsammenligning uden path.resolve, og så slap
  // "…\flows\..\customers.json" igennem — hele kundefilen med credentials kunne
  // hentes gennem dette endpoint. insideFlowsDir opløser stien først.
  if (!insideFlowsDir(filePath))
    return res.status(400).json({ error: 'Ugyldig filsti — kun filer under flows/' });
  const resolved = path.resolve(String(filePath));
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Not found' });
  res.json({ content: fs.readFileSync(resolved, 'utf8') });
});

// ── README ────────────────────────────────────────────────────────────────────

app.get('/api/readme', (req, res) => {
  const readmePath = path.join(__dirname, 'README.md');
  if (!fs.existsSync(readmePath)) return res.status(404).json({ error: 'README.md not found' });
  res.json({ content: fs.readFileSync(readmePath, 'utf8') });
});

// ── Start ─────────────────────────────────────────────────────────────────────

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

const PORT = process.env.PORT || 3737;
// Bind til loopback. Uden vært binder Express til 0.0.0.0, og så kunne enhver
// på netværket liste kunderne og migrere til produktion — der er ingen
// adgangskontrol foran. Sæt HOST hvis den bevidst skal nås udefra.
const HOST = process.env.HOST || '127.0.0.1';

// Kun når filen KØRES. Bliver den i stedet indlæst med require — det gør
// testene — må den hverken lytte på porten eller sætte et døgn-interval i gang;
// så ville `node --test` aldrig afslutte af sig selv.
if (require.main === module) {
  _sessionPersist = true;
  const huskede = loadSessions(loadCustomers());
  saveSessions();      // rydder det der er udløbet
  setInterval(saveSessions, 60 * 1000).unref();
  if (huskede) setTimeout(() => addLog('INFO', `${huskede} login(s) from the last session restored — no new login needed`, null, 'SYSTEM'), 0);
  app.listen(PORT, HOST, () => {
    console.log(`Archy GUI running on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
    addLog('INFO', `Archy GUI started on ${HOST}:${PORT}`, null, 'SYSTEM');
    // Check for updates on startup, then once every 24 hours
    checkForUpdate();
    setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
  });
}

// ── Til testene ──────────────────────────────────────────────────────────────
// De rene funktioner — dem uden netværk, uden disk og uden Archy. De har hver
// især haft mindst én fejl der nåede ud til brugeren, og de er samtidig de
// eneste der kan efterprøves uden en rigtig org. Se test/*.test.js.
module.exports = {
  sanitizeDatatableSchema, mapRoleDivisions, buildOauthClientBody, buildRolePolicies, missingRolesFor,
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
  scanDataActionRefs, classifyDataActionRefs, applyDataActionMap, mergeDaEntries, validDaEntry,
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
  parseArchyOutput, truncateArchyError, archyErrorReason, describeApiError,
  archyDebugLog, withArchyLog,
  explainRepublishFailure,
  archyCredFlags, archyArg, archyBareArg, archyVerb, archyVersionFlag,
  // filstier fra klienten
  insideFlowsDir, safeFileName, missingFields, FLOWS_DIR, moveCustomerFolder,
  envFieldError, EDITABLE_FIELDS,
  // eksport af den rigtige udgave
  publishedVersionOf, publishedVersionFor, exportFlowToYaml,
  // maskering
  redactSecrets,
  // prod kræver et personligt login med rettigheden
  PROD_WRITE_ROUTES, PROD_DEPLOY_WINDOW, DEFAULT_DEPLOY_PERMISSION,
  deployRequirements, permissionGranted, evaluateDeployRights, evaluatePermissions, rolePermissions, PERMISSION_CHECKS, prodWriteBlock, prodSettingsBlock
};
