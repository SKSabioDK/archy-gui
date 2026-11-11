// Ruter: miljøer (opret, ret, slet), forbindelsestest og hierarki.

const express = require('express');
const axios = require('axios');
const { saveSettings } = require('../config');
const { addLog } = require('../lib/log');
const { loadCustomers, saveCustomers } = require('../lib/customers');
const { STAGES, stageListError, applyStages } = require('../lib/conventions');
const { EDITABLE_FIELDS, envFieldError } = require('../lib/fields');
const { describeApiError, moveCustomerFolder } = require('../lib/helpers');
const { stageOf, isDemo, clientPinsOrg, buildHierarchy } = require('../lib/environments');
const { tokenStore } = require('../lib/sessions');
const { getToken, credentialChangeError, forgetLogin } = require('../lib/token');
const { prefixClash } = require('../lib/guards');
const { prodSettingsBlock, keepsOrgOnClientChange, applyClientScopes, evaluatePermissions,
  heldPermissions, liveProbes, probePermissions } = require('../lib/prod-rights');
const { orgIdCache } = require('../lib/manifest');
const { DEMO_DIVISIONS, demoFlowsFor } = require('../lib/demo');
const { afterEnvChange, masked } = require('../lib/setup');

const router = express.Router();

// Divisionerne i en org. Bruges til rullelisten, så man kun kan vælge en
// division der faktisk findes — et frit tekstfelt ville før eller siden give
// en stavefejl der først viser sig som en mislykket import.
router.get('/api/customers/:id/divisions', async (req, res) => {
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
router.get('/api/customers/:id/oauth-client', async (req, res) => {
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
    if (st === 401 && c.authType === 'oauth') return res.json({ ok: false, code: 'login' });
    if (/OAuth token (missing|expired)|another org/.test(e.message)) return res.json({ ok: false, code: 'login' });
    res.json({ ok: false, code: 'error', error: describeApiError(e) });
  }
});

router.get('/api/stages', (req, res) => {
  const all = loadCustomers();
  const used = {};
  for (const c of all) if (c.stage) (used[String(c.stage).toLowerCase()] ||= []).push(c.name);
  res.json({ ok: true, stages: STAGES, used });
});

router.put('/api/stages', (req, res) => {
  const r = stageListError(req.body?.stages, loadCustomers());
  if (r.error) return res.status(400).json({ error: r.error });
  const foer = STAGES.join(' → ');
  applyStages(r.stages);
  saveSettings({ stages: r.stages });
  addLog('INFO', `Stages changed: ${foer} ⇒ ${r.stages.join(' → ')}`, null, 'CUSTOMER');
  res.json({ ok: true, stages: STAGES });
});

router.get('/api/hierarchy', (req, res) => {
  res.json({ ok: true, stages: STAGES, tenants: buildHierarchy(loadCustomers()) });
});

router.get('/api/customers', (req, res) => {
  const customers = loadCustomers().map(c => ({ ...c, clientSecret: '••••••••' }));
  res.json(customers);
});

router.post('/api/customers', (req, res) => {
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

router.put('/api/customers/:id', (req, res) => {
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
  // Et tomt secret-felt betyder "behold den gamle". Ved et nyt client id hører
  // den gamle secret til den gamle klient, så Genesys afviste hvert kald med
  // invalid_client — som om de gamle indstillinger stadig gjaldt.
  const credKey = credentialChangeError(before, updated, !!patch.clientSecret);
  if (credKey) return res.status(400).json({ error: credKey });
  // Som ved oprettelse: prod med PKCE har ingen secret på disken.
  if (updated.stage === 'prod' && updated.authType === 'oauth') updated.clientSecret = '';
  // Et login hører til den klient og det miljø det blev givet til. Skifter
  // godkendelsen, klienten, nøglen, regionen eller trinnet, gælder det ikke længere.
  if (['authType', 'clientId', 'clientSecret', 'region', 'stage', 'deployPermission', 'deployGroup']
        .some(k => (before[k] || '') !== (updated[k] || ''))) forgetLogin(updated.id);
  if (['clientId', 'region'].some(k => (before[k] || '') !== (updated[k] || ''))) {
    if (!keepsOrgOnClientChange(before, updated)) delete updated.orgId;
    delete orgIdCache[updated.id];
  }
  if ((before.clientId || '') !== (updated.clientId || '') && stageOf(before) === 'prod')
    addLog('WARN', `Client id changed on prod ${updated.name}: ${before.clientId || '—'} → ${updated.clientId || '—'}` +
      (updated.orgId ? ` — still pinned to org ${updated.orgId}, log in again` : ' — log in again'), updated.name, 'SECURITY');
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

router.delete('/api/customers/:id', (req, res) => {
  const customers = loadCustomers();
  const customer = customers.find(c => c.id === req.params.id);
  saveCustomers(customers.filter(c => c.id !== req.params.id));
  addLog('WARN', `Customer deleted: ${customer?.name || req.params.id}`, customer?.name, 'CUSTOMER');
  // Tabellen i org'en bliver stående — miljøet er kun fjernet fra denne pc.
  // Men søskendene skal ikke længere nævne det.
  if (customer) afterEnvChange(customer, null, 'environment deleted');
  res.json({ ok: true });
});

router.post('/api/customers/:id/test', async (req, res) => {
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
    let checks = held ? evaluatePermissions(held, customer.authType)
                      : await probePermissions(customer, token, apiBase);
    if (customer.authType === 'oauth') {
      try {
        const cl = await axios.get(`${apiBase}/api/v2/oauth/clients/${encodeURIComponent(customer.clientId)}`,
          { headers: { Authorization: `Bearer ${token}` } });
        checks = applyClientScopes(checks, cl.data.scope);
      } catch (e) {
        addLog('WARN', `Could not read the scopes of the OAuth client for ${customer.name}: ${describeApiError(e)}`, customer.name, 'TEST');
      }
    }
    checks = checks.concat(await liveProbes(apiBase, token, new Set(checks.map(c => c.area))));
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

module.exports = { router };
