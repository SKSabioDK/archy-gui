// Ruter: lister fra org'en (datatabeller, køer, brugere, flows, data actions, backup).

const express = require('express');
const axios = require('axios');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { describeApiError } = require('../lib/helpers');
const { orgKeyOf, isDemo, belongsToEnv } = require('../lib/environments');
const { getToken } = require('../lib/token');
const { getOrgId } = require('../lib/manifest');
const { demoFlowsFor } = require('../lib/demo');

const router = express.Router();

// ── Org Resources (datatables, queues, users) ────────────────────────────────

router.get('/api/customers/:id/datatables', async (req, res) => {
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

router.get('/api/customers/:id/queues', async (req, res) => {
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

router.get('/api/customers/:id/users', async (req, res) => {
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

router.get('/api/customers/:id/groups', async (req, res) => {
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

router.get('/api/customers/:id/prompts', async (req, res) => {
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

router.get('/api/customers/:id/flows', async (req, res) => {
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

router.get('/api/customers/:id/datatables/:tableId', async (req, res) => {
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

router.get('/api/customers/:id/actions', async (req, res) => {
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

router.get('/api/customers/:id/actions/:actionId/schema', async (req, res) => {
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

router.get('/api/customers/:id/actions/:actionId/full', async (req, res) => {
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
router.get('/api/customers/:id/integrations', async (req, res) => {
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
router.get('/api/customers/:id/backup', async (req, res) => {
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

module.exports = { router };
