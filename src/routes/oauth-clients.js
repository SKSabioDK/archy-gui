// Ruter: OAuth-klienter, integrationer og roller.

const express = require('express');
const axios = require('axios');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { describeApiError } = require('../lib/helpers');
const { getToken } = require('../lib/token');

const router = express.Router();

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
function mapRoleDivisions(roleDivisions, srcRoleName, srcDivName, tgtRoleId, tgtDivId, fallbackDivisionId = null) {
  const mapped = [], missing = [];
  const seen = new Set();
  for (const rd of roleDivisions || []) {
    const roleName = srcRoleName.get(rd.roleId);
    const roleId = roleName ? tgtRoleId.get(roleName) : null;
    if (!roleId) { missing.push(`rolle ${roleName || rd.roleId}`); continue; }
    let divisionId = rd.divisionId;
    if (divisionId !== '*') {
      const dn = srcDivName.get(rd.divisionId);
      divisionId = dn ? tgtDivId.get(dn) : null;
      // Uden den division i målet kan brugeren vælge at samle alt i Home.
      if (!divisionId && fallbackDivisionId) divisionId = fallbackDivisionId;
      if (!divisionId) { missing.push(`division ${dn || rd.divisionId} (rolle ${roleName})`); continue; }
    }
    const nøgle = roleId + '|' + divisionId;
    if (seen.has(nøgle)) continue;
    seen.add(nøgle);
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

router.get('/api/customers/:id/oauthclients', async (req, res) => {
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

// Divisioner som klienternes roller er knyttet til, men som mangler i målet.
function missingDivisionsFor(clients, srcDivs, tgtDivNames) {
  const byId = new Map(srcDivs.map(d => [d.id, d.name]));
  const seen = new Set();
  for (const c of clients) {
    for (const rd of c.roleDivisions || []) {
      const n = rd.divisionId === '*' ? null : byId.get(rd.divisionId);
      if (n && !tgtDivNames.has(n)) seen.add(n);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

router.post('/api/oauthclients/plan', async (req, res) => {
  const { sourceId, targetId, clientIds } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const [srcClients, srcRoles, tgtRoles, srcDivs, tgtDivs] = await Promise.all([
      listAll(srcBase, srcToken, '/api/v2/oauth/clients'),
      listAll(srcBase, srcToken, '/api/v2/authorization/roles'),
      listAll(tgtBase, tgtToken, '/api/v2/authorization/roles'),
      listAll(srcBase, srcToken, '/api/v2/authorization/divisions'),
      listAll(tgtBase, tgtToken, '/api/v2/authorization/divisions'),
    ]);
    const chosen = srcClients.filter(c => (clientIds || []).includes(c.id));
    res.json({ ok: true,
      missingRoles: missingRolesFor(chosen, srcRoles, new Set(tgtRoles.map(r => r.name))),
      missingDivisions: missingDivisionsFor(chosen, srcDivs, new Set(tgtDivs.map(d => d.name))) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

router.post('/api/oauthclients/migrate', async (req, res) => {
  const { sourceId, targetId, clientIds, homeFallback } = req.body;
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
    const homeId      = homeFallback ? (tgtDivs.find(d => d.homeDivision)?.id || null) : null;
    const key = `${sourceId}>${targetId}`;
    if (!migratedClientSecrets.has(key)) migratedClientSecrets.set(key, new Map());

    const results = [];
    for (const id of clientIds) {
      const src = srcClients.find(c => c.id === id);
      if (!src) { results.push({ id, status: 'failed', message: 'Klienten findes ikke i kilden' }); continue; }
      if (tgtNames.has(src.name.toLowerCase())) { results.push({ id, name: src.name, status: 'exists' }); continue; }
      const { mapped, missing } = mapRoleDivisions(src.roleDivisions, srcRoleName, srcDivName, tgtRoleId, tgtDivId, homeId);
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

router.get('/api/customers/:id/integrations', async (req, res) => {
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
router.post('/api/integrations/migrate', async (req, res) => {
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

router.get('/api/customers/:id/roles', async (req, res) => {
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

router.post('/api/roles/migrate', async (req, res) => {
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

module.exports = { router, mapRoleDivisions, buildOauthClientBody, missingRolesFor,
  missingDivisionsFor, buildRolePolicies };
