const express = require('express');
const axios = require('axios');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CURRENT_VERSION = require('./package.json').version;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CUSTOMERS_FILE = path.join(__dirname, 'customers.json');
const FLOWS_DIR = path.join(__dirname, 'flows');

if (!fs.existsSync(FLOWS_DIR)) fs.mkdirSync(FLOWS_DIR, { recursive: true });

// ── OAuth / PKCE stores ───────────────────────────────────────────────────────

// In-memory token store — lost on server restart (by design: no secrets on disk)
const tokenStore = {}; // { [customerId]: { token, expiresAt } }
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

function addLog(level, message, customer = null, action = 'SYSTEM') {
  const entry = {
    ts: new Date().toISOString(),
    level,          // INFO | SUCCESS | WARN | ERROR
    action,         // SYSTEM | CUSTOMER | TEST | FLOWS | EXPORT | IMPORT | MIGRATE
    customer: customer || null,
    message
  };
  logStore.push(entry);
  if (logStore.length > LOG_MAX) logStore.shift();
  // Also mirror to console
  console.log(`[${entry.ts}] [${level}] [${action}]${customer ? ' [' + customer + ']' : ''} ${message}`);
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

// ── Customers CRUD ──────────────────────────────────────────────────────────

function loadCustomers() {
  if (!fs.existsSync(CUSTOMERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8')); }
  catch { return []; }
}

function saveCustomers(customers) {
  fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2));
}

app.get('/api/customers', (req, res) => {
  const customers = loadCustomers().map(c => ({ ...c, clientSecret: '••••••••' }));
  res.json(customers);
});

app.post('/api/customers', (req, res) => {
  const { name, clientId, clientSecret, region, authType } = req.body;
  const isOAuth = authType === 'oauth';
  if (!name || !clientId || !region || (!isOAuth && !clientSecret))
    return res.status(400).json({ error: isOAuth ? 'Name, Client ID and Region required' : 'All fields required' });
  const customers = loadCustomers();
  if (customers.find(c => c.name === name))
    return res.status(400).json({ error: 'Customer name already exists' });
  const customer = {
    id: Date.now().toString(), name, clientId,
    clientSecret: clientSecret || '', region,
    authType: authType || 'credentials'
  };
  customers.push(customer);
  saveCustomers(customers);
  addLog('INFO', `Customer created: ${name} (region: ${region}, auth: ${customer.authType})`, name, 'CUSTOMER');
  res.json({ ...customer, clientSecret: '••••••••' });
});

app.put('/api/customers/:id', (req, res) => {
  const customers = loadCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const updated = { ...customers[idx], ...req.body };
  customers[idx] = updated;
  saveCustomers(customers);
  addLog('INFO', `Customer updated: ${updated.name}`, updated.name, 'CUSTOMER');
  res.json({ ...updated, clientSecret: '••••••••' });
});

app.delete('/api/customers/:id', (req, res) => {
  const customers = loadCustomers();
  const customer = customers.find(c => c.id === req.params.id);
  saveCustomers(customers.filter(c => c.id !== req.params.id));
  addLog('WARN', `Customer deleted: ${customer?.name || req.params.id}`, customer?.name, 'CUSTOMER');
  res.json({ ok: true });
});

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
  const redirectUri = 'http://localhost:3737/auth/callback';
  const url = `${loginBase}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(customer.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&state=${encodeURIComponent(customer.id)}`;

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
  const redirectUri = 'http://localhost:3737/auth/callback';

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
    const expiresAt = Date.now() + ((expires_in || 86400) * 1000) - 60000;
    tokenStore[customer.id] = { token: access_token, expiresAt };
    addLog('SUCCESS', `PKCE OAuth login succeeded for ${customer.name}`, customer.name, 'CUSTOMER');
    page(true, 'Logged in!', 'You can close this window and return to Archy GUI.');
  } catch (e) {
    const msg = e.response?.data?.description || e.response?.data?.error || e.message;
    addLog('ERROR', `PKCE token exchange failed for ${customer.name}: ${msg}`, customer.name, 'CUSTOMER');
    page(false, 'Token exchange failed', String(msg).replace(/</g,'&lt;'));
  }
});

// Token status check
app.get('/api/auth/status/:id', (req, res) => {
  const stored = tokenStore[req.params.id];
  if (!stored) return res.json({ authenticated: false });
  if (Date.now() > stored.expiresAt) {
    delete tokenStore[req.params.id];
    return res.json({ authenticated: false, expired: true });
  }
  res.json({ authenticated: true, expiresIn: Math.floor((stored.expiresAt - Date.now()) / 1000) });
});

// ── Token helper ────────────────────────────────────────────────────────────

async function getToken(customer) {
  const apiBase = REGION_MAP[customer.region] || `https://api.${customer.region}`;

  // OAuth (PKCE) customers — use stored token
  if (customer.authType === 'oauth') {
    const stored = tokenStore[customer.id];
    if (!stored) throw new Error(`OAuth token missing for "${customer.name}" — click the Login button`);
    if (Date.now() > stored.expiresAt) {
      delete tokenStore[customer.id];
      throw new Error(`OAuth token expired for "${customer.name}" — please log in again`);
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
      orgName = me.data.organization?.name || '?';
    } else {
      const org = await axios.get(`${apiBase}/api/v2/organizations/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      orgName = org.data.name || '?';
      name    = '(Client Credentials)';
      // Verify oauth:client:view — Archy requires this for Client Credentials (exit 99 without it).
      try {
        await axios.get(`${apiBase}/api/v2/oauth/clients/${customer.clientId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (e) {
        if (e.response?.status === 403) {
          archyReady = false;
          addLog('WARN', `${customer.name}: missing oauth:client:view permission — Archy will fail (exit 99)`, customer.name, 'TEST');
        }
      }
    }

    // Verify architect:flow:view for ALL auth types — required for import/export.
    try {
      await axios.get(`${apiBase}/api/v2/architect/flows`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 1, pageNumber: 1 }
      });
    } catch (e) {
      if (e.response?.status === 403) {
        archyFlowReady = false;
        addLog('WARN', `${customer.name}: missing architect:flow:view permission — import/export will fail with access denied`, customer.name, 'TEST');
      }
    }

    const warns = [
      ...(archyReady     ? [] : ['missing oauth:client:view']),
      ...(archyFlowReady ? [] : ['missing architect:flow:view']),
    ];
    addLog(
      warns.length ? 'WARN' : 'SUCCESS',
      `Connected to ${customer.name} — ${customer.authType === 'oauth' ? `user: ${name}, ` : ''}org: ${orgName}${warns.length ? ' ⚠ ' + warns.join(', ') : ''}`,
      customer.name, 'TEST'
    );
    res.json({ ok: true, name, org: orgName, archyReady, archyFlowReady });
  } catch (e) {
    const errMsg = e.response?.data?.message || e.message;
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
    const r = await axios.get(`${apiBase}/api/v2/architect/prompts`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 50, sortBy: 'name', sortOrder: 'ASC',
                ...(search ? { name: `*${search}*` } : {}) }
    });
    res.json((r.data.entities || []).map(p => ({ id: p.id, name: p.name })));
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
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
  try {
    const { token, apiBase } = await getToken(customer);
    // When name filter is given, do a single-page search instead of full pagination
    if (nameFilter) {
      const resp = await axios.get(`${apiBase}/api/v2/flows`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 50, pageNumber: 1, includeDraft: true, name: `*${nameFilter}*`,
                  ...(typeFilter ? { type: typeFilter } : {}) }
      });
      const flows = (resp.data.entities || []).map(f => ({
        id: f.id, name: f.name, type: f.type,
        publishedVersion: f.publishedVersion?.name || f.publishedVersion?.commitVersion || null,
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
      allFlows = allFlows.concat(flows.map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        publishedVersion: f.publishedVersion?.name || f.publishedVersion?.commitVersion || null,
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
          `Ingen integration ved navn "${srcIntName}" i ${target.name}; bruger "${match.name}". ` +
          `Vælg mål-integration manuelt hvis migreringen fejler.`,
          source.name, 'MIGRATE');
      }
      integrationId = match.id;
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

    const createRes = await axios.post(
      `${tgtBase}/api/v2/integrations/actions`,
      {
        name:         published.name,
        category:     published.category,
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

    addLog('SUCCESS', `Data Action "${published.name}" migreret til ${target.name}`, source.name, 'MIGRATE');
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
    if ((existing.data.entities || []).some(t => t.name === src.name)) {
      return res.status(409).json({ error: 'already_exists', message: `DataTable "${src.name}" findes allerede` });
    }

    // 3. Match division på navn. Findes den ikke, oprettes tabellen i orgens
    // standarddivision — det er bedre end at fejle, men skal siges højt.
    let divisionId = null, divisionNote = null;
    if (src.division?.name) {
      try {
        const dv = await axios.get(`${tgtBase}/api/v2/authorization/divisions`, {
          headers: { Authorization: `Bearer ${tgtToken}` },
          params: { pageSize: 200 }
        });
        const match = (dv.data.entities || []).find(d => d.name === src.division.name);
        if (match) divisionId = match.id;
        else divisionNote = `Division "${src.division.name}" findes ikke i ${target.name} — tabellen oprettes i standarddivisionen`;
      } catch (e) {
        divisionNote = `Kunne ikke slå divisioner op: ${describeApiError(e)}`;
      }
    }

    // 4. Byg schemaet. datatableId peger på KILDENS tabel og skal væk —
    // ellers bærer den nye tabel en reference til en anden org.
    const schema = { ...src.schema };
    delete schema.datatableId;
    schema.title = src.name;

    const body = { name: src.name, schema };
    if (src.description) body.description = src.description;
    if (divisionId) body.division = { id: divisionId };

    const created = await axios.post(`${tgtBase}/api/v2/flows/datatables`, body, { headers: tgtHeaders });

    if (divisionNote) addLog('WARN', `"${src.name}": ${divisionNote}`, source.name, 'MIGRATE');
    addLog('SUCCESS', `DataTable "${src.name}" migreret til ${target.name} (${Object.keys(schema.properties || {}).length} kolonner)`, source.name, 'MIGRATE');

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
    .join('\n')
    .replace(/_(\d+)\]/g, '_#]')
    .replace(/^(\s*refId:\s*.*?)_(\d+)\s*$/gm, '$1_#')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function flowContentHash(yaml) {
  return crypto.createHash('sha256').update(normalizeFlowYaml(yaml)).digest('hex');
}

// Archy lægger versionen i filnavnet: "Mit Flow_v16-0.yaml" → 16
function versionFromFileName(fileName) {
  const m = String(fileName).match(/_v(\d+)-\d+\.yaml$/i);
  return m ? parseInt(m[1], 10) : null;
}

// Eksporterer ét flow og returnerer { yaml, fileName, version }.
async function exportFlowToYaml(customer, flowName, flowType) {
  const dir = path.join(FLOWS_DIR, sanitizeName(customer.name));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const mt = f => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) { return 0; } };
  const before = new Map(fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => [f, mt(f)]));

  await runArchy(
    `export --flowName "${flowName}" --flowType ${String(flowType).toLowerCase()} --exportType yaml --force --outputDir "${dir}"`,
    customer
  );
  const touched = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))
    .filter(f => !before.has(f) || mt(f) > before.get(f))
    .sort((a, b) => mt(b) - mt(a));
  if (!touched.length) throw new Error(`Eksporten skrev ingen YAML-fil for "${flowName}"`);
  const fileName = touched[0];
  return { yaml: fs.readFileSync(path.join(dir, fileName), 'utf8'), fileName, version: versionFromFileName(fileName) };
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

// Org-id pr. kunde. Slås op én gang og huskes — det ændrer sig ikke.
const orgIdCache = {};
async function getOrgId(customer) {
  if (orgIdCache[customer.id]) return orgIdCache[customer.id];
  try {
    const { token, apiBase } = await getToken(customer);
    const r = await axios.get(`${apiBase}/api/v2/organizations/me`,
      { headers: { Authorization: `Bearer ${token}` } });
    orgIdCache[customer.id] = r.data.id;
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
function findManifestEntry(all, { targetOrgId, targetId, flowName, flowType }) {
  const ft = normType(flowType);
  return all.find(e =>
    e.flowName === flowName && normType(e.flowType) === ft &&
    (e.targetOrgId && targetOrgId ? e.targetOrgId === targetOrgId : e.targetId === targetId));
}

function recordManifest(entry) {
  try {
    const all = loadManifest();
    entry.flowType = normType(entry.flowType);
    // Én linje pr. (mål-org, flow) — den nyeste hændelse er den gældende
    const i = all.findIndex(e =>
      e.flowName === entry.flowName && normType(e.flowType) === entry.flowType &&
      (e.targetOrgId && entry.targetOrgId ? e.targetOrgId === entry.targetOrgId : e.targetId === entry.targetId));
    if (i >= 0) all[i] = { ...all[i], ...entry }; else all.push(entry);
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(all, null, 2));
  } catch (e) {
    addLog('WARN', `Kunne ikke skrive migreringsmanifest: ${e.message}`, null, 'SYSTEM');
  }
}

app.get('/api/migrations', (req, res) => res.json(loadManifest()));

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
      const why = (op.errorDetails || []).map(d => d.errorCode || d.message).filter(Boolean).join('; ') || op.actionStatus;
      addLog('ERROR', `Publicering af "${before.name}" fejlede: ${why}`, customer.name, 'MIGRATE');
      return res.status(500).json({ error: `Publicering fejlede: ${why}` });
    }
    if (!nowPublished) {
      addLog('WARN', `Publicering af "${before.name}" er stadig i gang efter 30 sekunder — tjek i Architect`, customer.name, 'MIGRATE');
      return res.status(202).json({ pending: true,
        error: `Publiceringen af "${before.name}" er sat i gang men er ikke færdig endnu — tjek status i Architect` });
    }

    addLog('SUCCESS', `"${after.name}" publiceret som v${nowPublished} i ${customer.name}`, customer.name, 'MIGRATE');
    res.json({ ok: true, name: after.name, version: nowPublished,
      publishedAt: after.publishedVersion?.dateCheckedIn || null });

  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Kunne ikke publicere "${flowName || flowId}": ${msg}`, customer.name, 'MIGRATE');
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

    addLog('SUCCESS', `Nulpunkt sat for ${target.name}: ${recorded} flows noteret` +
      (skipped ? `, ${skipped} sprunget over (allerede migreret med værktøjet)` : ''), target.name, 'MIGRATE');
    res.json({ ok: true, recorded, skipped, total: all.length, targetOrgId });

  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
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

    const sourceHash = flowContentHash(src.yaml);
    const targetHash = flowContentHash(tgt.yaml);

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
      `Sammenligning "${flowName}": ${source.name} v${src.version} ↔ ${target.name} v${tgt.version} — ` +
      (same ? 'identisk indhold' : `${diffCount} forskelle`), target.name, 'MIGRATE');

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

// Finder de ressourcer et flow-YAML refererer til. Regexerne er skrevet mod
// den form Archy faktisk eksporterer — se README for eksempler.
function scanYamlDependencies(yaml) {
  const uniq = a => [...new Set(a.map(s => (s || '').trim()).filter(Boolean))];
  const grab = (re) => { const out = []; let m; while ((m = re.exec(yaml)) !== null) out.push(m[1]); return uniq(out); };

  return {
    division:   grab(/^[ \t]*division:[ \t]*["']?([^'"\n]+)["']?/gm),
    queue:      grab(/targetQueue:[\s\S]{0,60}?name:[ \t]*["']?([^'"\n]+)["']?/gm),
    datatable:  grab(/dataTable:\s*\n\s+([\w][\w _\-]+):/gm)
                  .filter(n => !['foundOutputs', 'failureOutputs', 'outputs'].includes(n)),
    dataaction: grab(/dataAction:\s*\n\s+([\w][\w _\-()]+):/gm),
    // PromptSystem.* er Genesys' indbyggede systemprompts. De ligger ikke i
    // orgens promptliste og ville derfor altid fremstå som manglende.
    prompt:     grab(/prompt:[ \t]+["']?(?:Prompt\.)?([\w_\-. ]+)["']?/gm)
                  .filter(n => !/^PromptSystem\./i.test(n)),
    // wrapupCode: \n lit: \n name: X
    wrapupcode: grab(/wrapupCode:\s*\n\s*lit:\s*\n\s*name:[ \t]*["']?([^'"\n]+)["']?/gmi),
    // screenPopScript: \n <ScriptNavn>:
    script:     grab(/screenPopScript:\s*\n\s+([\w][\w _\-]+):/gm),
    // Kun statiske skill-navne. FindSkill(Task.Skills) slås op på kørselstidspunktet
    // og kan ikke tjekkes her — det siges eksplicit i rapporten.
    skill:      grab(/FindSkill\(\s*["']([^"']+)["']\s*\)/gm),
    // VOICESURVEY-flows peger på en survey form ved navn
    surveyform: grab(/surveyForm:\s*\n\s*name:[ \t]*["']?([^'"\n]+)["']?/gm),

    // ── Referencer til ANDRE flows ────────────────────────────────────────
    // Bemærk kravet om indrykning (^\s+): på indrykning 0 er 'commonModule:'
    // og 'botFlow:' flowets EGEN type, ikke en reference til et andet flow.
    commonmodule: grab(/^\s+commonModule:\s*\n\s+([\w][\w .\-()]*):/gm).filter(notMeta),
    botflow:      grab(/^\s+botFlow:\s*\n\s+([\w][\w .\-()]*):/gm).filter(notMeta),
    targetflow:   grab(/targetFlow:\s*\n\s*(?:lit:\s*\n\s*)?name:\s*["']?([^'"\n]+)["']?/gm),

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

  if (!parts.length) parts.push(e.message || 'Ukendt fejl');

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

// ── Archy helpers ────────────────────────────────────────────────────────────

// Find archy's own directory at startup (archy.bat uses relative paths so must
// be run from there). We detect it by resolving 'where archy' on cmd.exe.
let ARCHY_DIR = null;
try {
  const { execSync } = require('child_process');
  const archyBat = execSync('where archy', { shell: 'cmd.exe' })
    .toString().split(/\r?\n/)[0].trim();
  ARCHY_DIR = path.dirname(archyBat);
  console.log(`[archy] Found at: ${ARCHY_DIR}`);
} catch (e) {
  console.warn('[archy] Not found in PATH:', e.message);
}

// Build credential flags for archy CLI (no config file needed)
function archyCredFlags(customer) {
  const q = v => `"${String(v).replace(/"/g, '\\"')}"`;

  // OAuth customers: use stored bearer token
  if (customer.authType === 'oauth') {
    const stored = tokenStore[customer.id];
    if (!stored || Date.now() > stored.expiresAt)
      throw new Error(`OAuth token missing or expired for "${customer.name}" — please log in again`);
    return `--authToken ${q(stored.token)} --location ${q(customer.region)}`;
  }

  // Client credentials
  return `--clientId ${q(customer.clientId)} --clientSecret ${q(customer.clientSecret)} --location ${q(customer.region)}`;
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
  return `[... ${lines.length - ARCHY_LOG_TAIL} linjer skjult — viser de sidste ${ARCHY_LOG_TAIL} ...]\n` + tail.join('\n');
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

  // Ved YAML-/importfejl lægger Archy den egentlige årsag i en "Exception:"-linje
  // langt over sin afsluttende opsummering. Den er langt mere brugbar end det
  // der står lige før terminatoren (typisk "Flow Name: '…'").
  const exc = lines.find(l => /^Exception:/i.test(l));
  if (exc) {
    summary = exc
      .replace(/^Exception:\s*-?\s*(ERROR!\s*)?/i, '')
      .replace(/\s*--\s*\[.*$/, '')          // metadata-halen
      .trim();
    // Tag den ramte property og sti med — det er dem man skal rette i YAML'en
    const prop = lines.find(l => /^Property name:/i.test(l))?.replace(/^Property name:\s*/i, '');
    const at   = lines.find(l => /^Path:/i.test(l))?.replace(/^Path:\s*/i, '');
    if (prop) summary += ` (${prop}${at ? ' i ' + at : ''})`;
  }

  // Ellers: Archys egen konklusion lige før "Error(s) [and warning(s)] encountered."
  if (!summary) {
    const noise = /^(\*+|DateTime:|Summary$|Command:|Log:|Flow Name:|Input YAML File:|\||└|┌|-\s*Architect Scripting|An error occurred)/i;
    const end = lines.findIndex(l => /^Error\(s\)(\s+and\s+warning\(s\))?\s+encountered\.?$/i.test(l));
    if (end > 0) {
      for (let i = end - 1; i >= 0 && end - i < 12; i--) {
        const l = lines[i];
        if (l && !noise.test(l) && !/Architect Yaml Flow Processor/i.test(l)) { summary = l; break; }
      }
    }
  }

  // Archy melder en manglende ressource som "find '<type>' by value of '<navn>'
  // - no matches", men opsummerer det som "Architect Scripting session ended in
  // error ( code: 99 )". Den generiske linje siger intet, så vi foretrækker den
  // specifikke.
  if (!summary || /session ended in error/i.test(summary)) {
    const miss = lines.find(l => /find '[^']+' by value of '[^']+'\s*-\s*no matches/i.test(l));
    const m = miss && miss.match(/find '([^']+)' by value of '([^']+)'/i);
    if (m) summary = `${m[1]} "${m[2]}" findes ikke i mål-org'en`;
  }

  // Ved TLS-fejl er Archys egen konklusion ("ugyldige credentials") misvisende,
  // så den underliggende certifikatfejl skal frem i stedet.
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate/i.test(out)) {
    return 'Archy kunne ikke verificere certifikatkæden (UNABLE_TO_VERIFY_LEAF_SIGNATURE) — typisk ' +
           'TLS-inspektion fra Norton eller en firmaproxy. Archy køres med --use-system-ca, så ' +
           'proxyens root-CA skal ligge i Windows\' certifikatlager.' +
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
    addLog('INFO', `CA-bundle til Archy skrevet (${pems.length} certifikater)`, null, 'SYSTEM');
  } catch (e) {
    addLog('WARN', `Kunne ikke bygge CA-bundle til Archy: ${e.message}`, null, 'SYSTEM');
  }
  return ARCHY_CA_BUNDLE;
}

function runArchy(args, customer) {
  return new Promise((resolve, reject) => {
    if (!ARCHY_DIR) return reject(new Error('archy not found in PATH'));
    const cmd = `archy ${args} ${archyCredFlags(customer)}`;
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

      if (failed)               return reject(new Error(truncateArchyError(archyErrorReason(combined) || parsed || 'Archy fejlede')));
      if (finished || !err)     return resolve(parsed || 'OK');
      reject(new Error(truncateArchyError(archyErrorReason(combined) || parsed || err.message)));
    });
  });
}

// ── Export Flow ──────────────────────────────────────────────────────────────

app.post('/api/export', async (req, res) => {
  const { customerId, flowName, flowType } = req.body;
  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const exportDir = path.join(FLOWS_DIR, sanitizeName(customer.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const flowTypeLower = flowType.toLowerCase();
  addLog('INFO', `Exporting flow "${flowName}" (${flowTypeLower}) from ${customer.name}`, customer.name, 'EXPORT');

  try {
    await runArchy(
      `export --flowName "${flowName}" --flowType ${flowTypeLower} --exportType yaml --force --outputDir "${exportDir}"`,
      customer
    );
    // Find generated file
    const files = fs.readdirSync(exportDir).filter(f => f.endsWith('.yaml'));
    const match = files.find(f => f.toLowerCase().includes(flowName.toLowerCase().replace(/\s+/g, '')));
    const yamlFile = match || files[files.length - 1];
    const content = fs.readFileSync(path.join(exportDir, yamlFile), 'utf8');
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

  // Fetch all flows first
  let allFlows = [];
  try {
    const { token, apiBase } = await getToken(customer);
    let page = 1;
    while (true) {
      const resp = await axios.get(`${apiBase}/api/v2/flows`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 100, pageNumber: page, includeDraft: true }
      });
      const flows = resp.data.entities || [];
      allFlows = allFlows.concat(flows.map(f => ({ name: f.name, type: f.type })));
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
        `export --flowName "${flow.name}" --flowType ${flow.type.toLowerCase()} --exportType yaml --force --outputDir "${exportDir}"`,
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
      `YAML validering mod ${customer.name}: ${checks.length} ressourcer tjekket${missing > 0 ? ', ' + missing + ' mangler' : ' \u2014 alt fundet'}`,
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

  const importDir = path.join(FLOWS_DIR, `import_${customer.id}`);
  if (!fs.existsSync(importDir)) fs.mkdirSync(importDir, { recursive: true });

  const filePath = path.join(importDir, fileName);
  fs.writeFileSync(filePath, yamlContent, 'utf8');

  const cmd = action || 'create';
  addLog('INFO', `Importing "${fileName}" to ${customer.name} (action: ${cmd})`, customer.name, 'IMPORT');

  try {
    const out = await runArchy(`${cmd} --file "${filePath}"`, customer);
    addLog('SUCCESS', `Import ok: "${fileName}" → ${customer.name}`, customer.name, 'IMPORT');
    res.json({ ok: true, output: out });
  } catch (e) {
    const msg = e.message || '';
    addLog('ERROR', `Import failed for "${fileName}" to ${customer.name}: ${msg}`, customer.name, 'IMPORT');
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
  if (depth > 5) return { ok: false, error: `For dybt afhængighedstræ ved "${flowName}"` };

  const exportDir = path.join(FLOWS_DIR, sanitizeName(source.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const mtimes = f => { try { return fs.statSync(path.join(exportDir, f)).mtimeMs; } catch (_) { return 0; } };
  const before = new Map(fs.readdirSync(exportDir).filter(f => f.endsWith('.yaml')).map(f => [f, mtimes(f)]));

  await runArchy(
    `export --flowName "${flowName}" --flowType ${String(flowType).toLowerCase()} --exportType yaml --force --outputDir "${exportDir}"`,
    source
  );
  const touched = fs.readdirSync(exportDir).filter(f => f.endsWith('.yaml'))
    .filter(f => !before.has(f) || mtimes(f) > before.get(f))
    .sort((a, b) => mtimes(b) - mtimes(a));
  if (!touched.length) return { ok: false, error: `Eksporten skrev ingen YAML-fil for "${flowName}"` };
  const filePath = path.join(exportDir, touched[0]);

  // Modulets egne afhængigheder først — ellers fejler dets import af samme
  // grund som flowets ville have gjort.
  const deps = scanYamlDependencies(fs.readFileSync(filePath, 'utf8'));
  const { token: tgtToken, apiBase: tgtBase } = await getToken(target);

  // 1) Tabeller og data actions modulet bruger
  for (const kind of ['datatable', 'dataaction']) {
    const names = deps[kind] || [];
    if (!names.length) continue;
    let existing = new Set();
    try { existing = await lookupExisting(kind, names, tgtToken, tgtBase); } catch (_) {}
    const missing = names.filter(n => !existing.has(n));
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
    let existing = new Set();
    try { existing = await lookupExisting(kind, names, tgtToken, tgtBase); } catch (_) {}
    for (const n of names) {
      if (existing.has(n)) continue;
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

  // Publicér — et modul skal være publiceret for at kunne refereres af et flow
  try {
    await runArchy(`publish --file "${filePath}"`, target);
    addLog('SUCCESS', `Flow-afhængighed "${flowName}" (${flowType}) migreret til ${target.name}`, target.name, 'MIGRATE');
    return { ok: true };
  } catch (e) {
    if (/already exists/i.test(e.message || '')) return { ok: true, skipped: 'exists' };
    return { ok: false, error: e.message };
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
    addLog('SUCCESS', `Division "${name}" oprettet i ${target.name}`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Kunne ikke oprette division "${name}": ${msg}`, target.name, 'MIGRATE');
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
    addLog('SUCCESS', `Survey form "${name}" kopieret til ${target.name}`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Kunne ikke kopiere survey form "${name}": ${msg}`, target.name, 'MIGRATE');
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
      addLog('ERROR', `Flow-afhængighed "${flowName}" fejlede: ${r.error}`, target.name, 'MIGRATE');
      return res.status(500).json({ error: r.error, trail });
    }
    res.json({ ok: true, skipped: r.skipped, trail });
  } catch (e) {
    addLog('ERROR', `Flow-afhængighed "${flowName}" fejlede: ${e.message}`, target.name, 'MIGRATE');
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

  const exportDir = path.join(FLOWS_DIR, sanitizeName(source.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  addLog('INFO', `Migration prepared: "${flowName}" from ${source.name} → ${target.name}`, source.name, 'MIGRATE');

  try {
    // Find den eksporterede fil på hvad eksporten faktisk rørte — ikke på
    // navnelighed. Den gamle heuristik matchede flownavnet mod filnavnet og
    // faldt ellers tilbage på "sidste fil i mappen", hvilket kunne udpege et
    // vilkårligt gammelt eksport og dermed migrere et helt andet flow.
    const mtimes = f => { try { return fs.statSync(path.join(exportDir, f)).mtimeMs; } catch (_) { return 0; } };
    const before = new Map(fs.readdirSync(exportDir).filter(f => f.endsWith('.yaml')).map(f => [f, mtimes(f)]));

    await runArchy(
      `export --flowName "${flowName}" --flowType ${flowType.toLowerCase()} --exportType yaml --force --outputDir "${exportDir}"`,
      source
    );

    const touched = fs.readdirSync(exportDir)
      .filter(f => f.endsWith('.yaml'))
      .filter(f => !before.has(f) || mtimes(f) > before.get(f))
      .sort((a, b) => mtimes(b) - mtimes(a));
    if (!touched.length) throw new Error(`Eksporten skrev ingen YAML-fil for "${flowName}"`);
    const yamlFile = touched[0];
    const filePath = path.join(exportDir, yamlFile);
    const yaml = fs.readFileSync(filePath, 'utf8');
    addLog('SUCCESS', `Eksport ok: ${yamlFile}`, source.name, 'MIGRATE');

    const deps = scanYamlDependencies(yaml);
    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);

    // Kilde-opslag bruges kun til at finde id'er på det der kan auto-migreres
    let srcTables = [], srcActions = [], srcInts = {}, srcFlows = [];
    const needSource = [];
    const results = [];

    for (const kind of Object.keys(deps)) {
      const names = deps[kind];
      if (!names.length) continue;
      let existing;
      try {
        existing = await lookupExisting(kind, names, tgtToken, tgtBase);
      } catch (e) {
        addLog('WARN', `Kunne ikke tjekke ${kind}: ${describeApiError(e)}`, target.name, 'MIGRATE');
        existing = new Set();
      }
      for (const name of names) {
        const ok = existing.has(name);
        results.push({ kind, name, ok });
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
        `Mangler i ${target.name}: ${m.kind} "${m.name}"` +
        (m.canMigrate ? ' — kan migreres herfra' :
         m.manualReason === 'function' ? ' — Function Data Action, skal oprettes manuelt (intet API)' :
         m.manualReason === 'not_in_source' ? ' — findes heller ikke i kilde-org' :
         ' — skal oprettes manuelt'),
        target.name, 'MIGRATE');
    }
    if (!missing.length) addLog('SUCCESS', `Alle afhængigheder for "${flowName}" findes i ${target.name}`, target.name, 'MIGRATE');

    res.json({ ok: true, fileName: yamlFile, filePath, yaml, deps: results, dynamicSkills: /FindSkill\(\s*[A-Za-z]/.test(yaml) });

  } catch (e) {
    addLog('ERROR', `Migration prepare failed for "${flowName}": ${e.message}`, source.name, 'MIGRATE');
    res.status(500).json({ error: e.message });
  }
});

// Fase 2: importér den allerede eksporterede fil til mål-org'en.
app.post('/api/migrate/commit', async (req, res) => {
  const { sourceId, targetId, flowName, filePath, action, divisionMap } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  // filePath kommer fra klienten — hold den inden for FLOWS_DIR
  const resolved = path.resolve(filePath || '');
  if (!resolved.startsWith(path.resolve(FLOWS_DIR) + path.sep) || !fs.existsSync(resolved)) {
    return res.status(400).json({ error: 'Ugyldig filsti' });
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
        if (yaml !== before) addLog('INFO', `Division "${from}" → "${to}" i "${flowName}"`, target.name, 'MIGRATE');
      }
      fs.writeFileSync(resolved, yaml, 'utf8');
    }

    const cmd = action || 'create';
    addLog('INFO', `Importing "${path.basename(resolved)}" to ${target.name} (action: ${cmd})`, target.name, 'MIGRATE');
    const out = await runArchy(`${cmd} --file "${resolved}"`, target);
    addLog('SUCCESS', `Migration complete: "${flowName}" is now in ${target.name}`, target.name, 'MIGRATE');

    // Notér hvad målet blev bygget af, så det senere kan verificeres om kilden
    // eller målet har flyttet sig. Versionsnumrene gemmes til orientering —
    // sammenligningen sker altid på indholds-hashen.
    const importedYaml = fs.readFileSync(resolved, 'utf8');
    // Flowtypen tages fra YAML-roden og normaliseres, så den matcher API'ets
    // form når posten senere slås op.
    const yamlType = (importedYaml.match(/^(\w+):/m) || [])[1] || null;
    const [sourceOrgId, targetOrgId] = await Promise.all([getOrgId(source), getOrgId(target)]);
    const pub = await getFlowPublishInfo(target, flowName, yamlType).catch(() => null);

    recordManifest({
      ts: new Date().toISOString(), kind: 'migration',
      sourceId, sourceOrgId, sourceName: source.name,
      targetId, targetOrgId, targetName: target.name,
      flowName, flowType: yamlType,
      sourceVersion: versionFromFileName(path.basename(resolved)),
      targetVersion: pub?.version || null,
      targetPublishedAt: pub?.publishedAt || null,
      action: cmd,
      hash: flowContentHash(importedYaml)
    });
    res.json({ ok: true, fileName: path.basename(resolved), output: out, yaml: fs.readFileSync(resolved, 'utf8') });
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
      results.push({
        customerId: customer?.id || dir, customerName: customer?.name || dir,
        fileName: f, isImport: isImportDir,
        path: path.join(fullDir, f)
      });
    }
  }
  res.json(results);
});

app.get('/api/files/content', (req, res) => {
  const { filePath } = req.query;
  if (!filePath || !filePath.startsWith(FLOWS_DIR))
    return res.status(400).json({ error: 'Invalid path' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json({ content: fs.readFileSync(filePath, 'utf8') });
});

// ── README ────────────────────────────────────────────────────────────────────

app.get('/api/readme', (req, res) => {
  const readmePath = path.join(__dirname, 'README.md');
  if (!fs.existsSync(readmePath)) return res.status(404).json({ error: 'README.md not found' });
  res.json({ content: fs.readFileSync(readmePath, 'utf8') });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3737;
app.listen(PORT, () => {
  console.log(`Archy GUI running on http://localhost:${PORT}`);
  addLog('INFO', `Archy GUI started on port ${PORT}`, null, 'SYSTEM');
  // Check for updates on startup, then once every 24 hours
  checkForUpdate();
  setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
});
