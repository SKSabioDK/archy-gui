// Ruter: releases, diff og release notes.

const express = require('express');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { normType } = require('../lib/conventions');
const { describeApiError } = require('../lib/helpers');
const { tenantOf, groupOf } = require('../lib/environments');
const { refuseProdWrite } = require('../lib/prod-rights');
const { releaseRef, mutateRelease, releasesOfEnv, rollbackCandidate, findRelease, releaseDiffFor,
  releaseNoteMarkdown } = require('../lib/releases');

const router = express.Router();

// Listen. Enten ét miljø (evt. ét flow), eller alle miljøer i en gruppe.
router.get('/api/releases', async (req, res) => {
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

router.post('/api/releases/diff', async (req, res) => {
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
router.post('/api/releases/notes', async (req, res) => {
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

router.post('/api/releases/note', async (req, res) => {
  const f = await findRelease(req.body.ref);
  if (f.error) return res.status(f.status).json({ error: f.error });
  if (refuseProdWrite(res, f.env, '/api/releases/note')) return;
  const note = String(req.body.note || '').slice(0, 500);
  await mutateRelease(f.env, f.rel.baseName, f.rel.flowType, f.rel.id, r => { r.note = note; });
  res.json({ ok: true });
});

module.exports = { router };
