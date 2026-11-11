// Ruter: wrap-up-koder.

const express = require('express');
const axios = require('axios');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { describeApiError } = require('../lib/helpers');
const { getToken } = require('../lib/token');

const router = express.Router();

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

router.get('/api/customers/:id/wrapupcodes', async (req, res) => {
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
router.post('/api/wrapupcodes/migrate', async (req, res) => {
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

module.exports = { router };
