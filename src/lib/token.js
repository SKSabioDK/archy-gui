// Tokens til Genesys: hent, forny og glem et login.

const axios = require('axios');
const { addLog } = require('./log');
const { loadCustomers } = require('./customers');
const { REGION_MAP } = require('./fields');
const { wrongOrg, isDemo } = require('./environments');
const { tokenStore, pkceStore } = require('./sessions');

// ── Token helper ────────────────────────────────────────────────────────────

// Et PKCE-token kan dø før sin udløbstid: org'ens inaktivitets-timeout eller en
// tilbagekaldelse. Genesys svarer så 401 bad.credentials, mens vi blev ved med
// at kalde miljøet "logget ind" — og hvert kald fejlede. Svarer Genesys 401 på
// et token vi har gemt, glemmes login'et, så brugerfladen beder om et nyt.
function dropRejectedLogin(err) {
  if (err?.response?.status !== 401) return null;
  const h = err.config?.headers;
  const auth = h && (typeof h.get === 'function' ? h.get('Authorization') : (h.Authorization || h.authorization));
  const token = /^Bearer\s+(.+)$/.exec(String(auth || ''))?.[1];
  if (!token) return null;
  const id = Object.keys(tokenStore).find(k => tokenStore[k]?.token === token);
  if (!id) return null;
  forgetLogin(id);
  const env = loadCustomers().find(c => c.id === id);
  addLog('WARN', `Genesys no longer accepts the login for ${env?.name || id} (401) — expired, revoked or the org's idle timeout. Log in again`,
    env?.name, 'CUSTOMER');
  return id;
}
axios.interceptors.response.use(null, err => { dropRejectedLogin(err); return Promise.reject(err); });

// Glemmer alt der er slået op med miljøets forrige login eller nøgle: tokenet,
// hvem man er, manifest-tabellens id og et påbegyndt PKCE-login.
function forgetLogin(id) {
  delete tokenStore[id];
  delete _whoCache[id];
  delete _mfTableCache[id];
  delete pkceStore[id];
}

// Et nyt client id på et miljø med client credentials skal have den nye
// secret med. Ren funktion, så den kan prøves uden en server.
function credentialChangeError(before, after, newSecretGiven) {
  if (after.authType === 'oauth' || isDemo(after)) return null;
  const nyKlient = (before.clientId || '') !== (after.clientId || '') ||
                   (before.authType || '') !== (after.authType || '');
  if (nyKlient && !newSecretGiven)
    return 'Et nyt client id kræver også den nye client secret — den gamle hører til den gamle klient. Indtast den nye secret og gem igen.';
  return null;
}

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

// Hvem der rørte det. Med client-credentials findes der ingen bruger i Genesys,
// så vi noterer hvem der kørte ArchyGUI — det er dét spørgsmålet handler om.
const _whoCache = {};

const _mfTableCache = {};

module.exports = { getToken, _mfTableCache, credentialChangeError, forgetLogin, _whoCache,
  dropRejectedLogin, oauthToken };
