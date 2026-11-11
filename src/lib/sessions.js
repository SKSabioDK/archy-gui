// Login-tokens i hukommelsen og deres kopi i brugerens egen mappe (overlever en genstart).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadSettings } = require('../config');
const { wrongOrg } = require('./environments');

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

module.exports = { tokenStore, scheduleSessionSave, SESSION_DIR, SESSION_FILE, setSessionPersist,
  saveSessions, loadSessions, pkceStore, base64url };
