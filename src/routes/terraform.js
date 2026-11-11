// Ruter: Terraform-eksport.

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ROOT_DIR, DATA_DIR, FLOWS_DIR } = require('../config');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { sanitizeName, describeApiError, safeFileName } = require('../lib/helpers');
const { getToken } = require('../lib/token');
const { pagedList, orgReadError } = require('../lib/genesys');
const { archyHint } = require('../lib/archy');

const router = express.Router();

// ── Terraform ─────────────────────────────────────────────────────────────────
// Laver en Terraform-opsætning (genesyscloud-provideren) ud fra en orgs objekter og
// gemmer den under terraform/<org>/<dato>/. Kunden kører selv terraform apply mod
// den org, der skal ændres. Generatoren ligger i terraform.js. Ruterne læser kun
// fra Genesys og skriver kun lokale filer.
const TERRAFORM = require('../terraform.js');
const TERRAFORM_DIR = path.join(DATA_DIR, 'terraform');

// Nyeste version af hvert flow i orgens mappe: "Navn_v5-0.yaml" → navn "Navn"
function latestFlowFiles(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => /\.ya?ml$/i.test(f) && !f.startsWith('.')); } catch (_) { return []; }
  const best = new Map();
  for (const f of names) {
    const m = f.match(/^(.*)_v(\d+)(?:-(\d+))?\.ya?ml$/i);
    const base = m ? m[1] : f.replace(/\.ya?ml$/i, '');
    const ver = m ? Number(m[2]) * 1000 + Number(m[3] || 0) : 0;
    if (!best.has(base) || ver > best.get(base).ver) best.set(base, { name: base, file: f, ver });
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function tfFetchKind(apiBase, token, k) {
  const list = await pagedList(apiBase, k.list, token, k.params || {});
  if (!k.detail) return list;
  const out = [];
  for (let i = 0; i < list.length; i += 5) {
    const chunk = await Promise.all(list.slice(i, i + 5).map(async x => {
      const d = k.detail(x);
      try {
        const r = await axios.get(`${apiBase}${d.path}`, { headers: { Authorization: `Bearer ${token}` }, params: d.params });
        return r.data;
      } catch (e) { return x; }
    }));
    out.push(...chunk);
  }
  return out;
}

router.get('/api/terraform/kinds', (req, res) => {
  res.json([...TERRAFORM.KINDS.map(k => ({ id: k.id, label: k.label })), { id: 'flows', label: 'Flows' }]);
});

router.post('/api/terraform/generate', async (req, res) => {
  const source = loadCustomers().find(c => c.id === req.body.sourceId);
  if (!source) return res.status(404).json({ error: 'Customer not found' });
  const ids = new Set([...TERRAFORM.KINDS.map(k => k.id), 'flows']);
  const include = (Array.isArray(req.body.include) ? req.body.include : [...ids]).filter(i => ids.has(i));
  if (!include.length) return res.status(400).json({ error: 'Intet valgt' });
  try {
    const { token, apiBase } = await getToken(source);
    const data = {}, errors = {};
    for (const k of TERRAFORM.KINDS.filter(k => include.includes(k.id))) {
      try { data[k.id] = await tfFetchKind(apiBase, token, k); }
      catch (e) { errors[k.id] = orgReadError(e); }
    }
    // Til referencer: alle roller og divisioner, også når de ikke er valgt
    const lookup = {};
    for (const [name, url, have] of [['roles', '/api/v2/authorization/roles', data.roles], ['divisions', '/api/v2/authorization/divisions', data.divisions]]) {
      try { lookup[name] = have || await pagedList(apiBase, url, token); } catch (_) { lookup[name] = []; }
    }
    const flowDir = path.join(FLOWS_DIR, sanitizeName(source.name));
    const flows = include.includes('flows') ? latestFlowFiles(flowDir) : [];
    // Målet er valgfrit: det giver mappen navnet <fra>_<til> og providerens region som standard
    const target = loadCustomers().find(c => c.id === req.body.targetId && c.id !== source.id) || null;
    const lang = /^[a-z]{2}$/.test(String(req.body.lang || '')) ? req.body.lang : 'en';
    const result = TERRAFORM.build(data, { include, lookup, errors, orgName: source.name, targetName: target && target.name, targetRegion: target && target.region, lang, flows });

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-').replace(/-(\d\d)-(\d\d)$/, '_$1$2');
    const part = n => sanitizeName(n).trim().replace(/\s+/g, '-').replace(/-{2,}/g, '-');
    const dir = path.join(TERRAFORM_DIR, part(source.name) + (target ? '_' + part(target.name) : ''), stamp);
    const rel = path.relative(ROOT_DIR, dir);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(result.files)) fs.writeFileSync(path.join(dir, safeFileName(name, 'fil.tf')), text, 'utf8');
    if (flows.length) {
      fs.mkdirSync(path.join(dir, TERRAFORM.FLOW_DIR), { recursive: true });
      for (const f of flows) fs.copyFileSync(path.join(flowDir, f.file), path.join(dir, TERRAFORM.FLOW_DIR, safeFileName(f.file, 'flow.yaml')));
    }
    const written = result.summary.reduce((n, s) => n + s.written, 0);
    addLog('SUCCESS', `Terraform setup written for ${source.name}${target ? ' → ' + target.name : ''}: ${written} objects in ${rel}`, source.name, 'TERRAFORM');
    res.json({ ok: true, dir: rel.replace(/\\/g, '/'), absolute: dir, files: Object.keys(result.files).sort(), flowsCopied: flows.length,
      summary: result.summary, notes: result.notes, errors });
  } catch (e) { res.status(500).json({ error: archyHint(describeApiError(e)) }); }
});

module.exports = { router };
