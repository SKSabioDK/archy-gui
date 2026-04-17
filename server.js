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

async function checkForUpdate() {
  try {
    const r = await axios.get(
      'https://raw.githubusercontent.com/skndkprivat/ArchyGUI/main/package.json',
      { timeout: 7000 }
    );
    const latest = r.data.version;
    const updateAvailable = latest !== CURRENT_VERSION;
    versionInfo = { current: CURRENT_VERSION, latest, updateAvailable, checkedAt: new Date().toISOString() };
    if (updateAvailable) {
      addLog('WARN', `Update available: v${latest} (running v${CURRENT_VERSION})`, null, 'SYSTEM');
    } else {
      addLog('INFO', `Version check: up to date (v${CURRENT_VERSION})`, null, 'SYSTEM');
    }
  } catch (e) {
    versionInfo = { current: CURRENT_VERSION, latest: null, updateAvailable: false, checkedAt: new Date().toISOString(), error: e.message };
    addLog('WARN', `Version check failed: ${e.message}`, null, 'SYSTEM');
  }
}

app.get('/api/version', (req, res) => res.json(versionInfo));

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
    if (customer.authType === 'oauth') {
      const me = await axios.get(`${apiBase}/api/v2/users/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      addLog('SUCCESS', `Connected to ${customer.name} — user: ${me.data.name}, org: ${me.data.organization?.name || '?'}`, customer.name, 'TEST');
      res.json({ ok: true, name: me.data.name, org: me.data.organization?.name });
    } else {
      const org = await axios.get(`${apiBase}/api/v2/organizations/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      addLog('SUCCESS', `Connected to ${customer.name} — org: ${org.data.name || '?'} (Client Credentials)`, customer.name, 'TEST');
      res.json({ ok: true, name: `(Client Credentials)`, org: org.data.name });
    }
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
        params: { pageSize: 200, pageNumber: page, sortBy: 'name', sortOrder: 'ASC' }
      });
      all = all.concat(r.data.entities || []);
      if (all.length >= (r.data.total || 0) || !(r.data.entities || []).length) break;
      page++;
    }
    res.json(all.map(t => ({ id: t.id, name: t.name })));
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
        publishedVersion: f.publishedVersion?.version,
        savedVersion: f.savedVersion?.version,
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
        publishedVersion: f.publishedVersion?.version,
        savedVersion: f.savedVersion?.version,
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
    const r = await axios.get(`${apiBase}/api/v2/flows/datatables/${req.params.tableId}`, {
      headers: { Authorization: `Bearer ${token}` }
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
    // Paginate to load all actions (most orgs have <500)
    let all = [], page = 1;
    while (true) {
      const r = await axios.get(`${apiBase}/api/v2/integrations/actions`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 100, pageNumber: page, sortBy: 'name', sortOrder: 'ASC' }
      });
      const entities = r.data.entities || [];
      all = all.concat(entities.map(a => ({
        id: a.id, name: a.name, category: a.category,
        integrationName: a.integration?.name || a.category || ''
      })));
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function runArchy(args, customer) {
  return new Promise((resolve, reject) => {
    if (!ARCHY_DIR) return reject(new Error('archy not found in PATH'));
    const cmd = `archy ${args} ${archyCredFlags(customer)}`;
    exec(cmd, { cwd: ARCHY_DIR, shell: 'cmd.exe', timeout: 120000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve(stdout);
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
    res.status(500).json({ error: msg });
  }
});

// ── Migrate (export + import in one go) ─────────────────────────────────────

app.post('/api/migrate', async (req, res) => {
  const { sourceId, targetId, flowName, flowType, action } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  const exportDir = path.join(FLOWS_DIR, sanitizeName(source.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  addLog('INFO', `Migration started: "${flowName}" from ${source.name} → ${target.name}`, source.name, 'MIGRATE');

  try {
    // Step 1: export
    addLog('INFO', `Exporting "${flowName}" from ${source.name}`, source.name, 'MIGRATE');
    await runArchy(
      `export --flowName "${flowName}" --flowType ${flowType.toLowerCase()} --exportType yaml --force --outputDir "${exportDir}"`,
      source
    );
    const files = fs.readdirSync(exportDir).filter(f => f.endsWith('.yaml'));
    const match = files.find(f => f.toLowerCase().includes(flowName.toLowerCase().replace(/\s+/g, '')));
    const yamlFile = match || files[files.length - 1];
    const filePath = path.join(exportDir, yamlFile);
    addLog('SUCCESS', `Eksport ok: ${yamlFile}`, source.name, 'MIGRATE');

    // Step 2: import
    const cmd = action || 'create';
    addLog('INFO', `Importing "${yamlFile}" to ${target.name} (action: ${cmd})`, target.name, 'MIGRATE');
    const out = await runArchy(`${cmd} --file "${filePath}"`, target);
    addLog('SUCCESS', `Migration complete: "${flowName}" is now in ${target.name}`, target.name, 'MIGRATE');

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ ok: true, fileName: yamlFile, output: out, yaml: content });
  } catch (e) {
    addLog('ERROR', `Migration failed for "${flowName}": ${e.message}`, source.name, 'MIGRATE');
    res.status(500).json({ error: e.message });
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
