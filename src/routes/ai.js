// Ruter: AI-udbydere og chat-assistenten (beta).

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { loadSettings, saveSettings, PORT, HOST } = require('../config');
const { setAiSecrets, addLog, redactSecrets } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { internalUnlocked, requireInternal } = require('../lib/features');
const { isDemo } = require('../lib/environments');
const { tokenStore, SESSION_DIR } = require('../lib/sessions');
const { prodWriteBlock } = require('../lib/prod-rights');
const { yamlFlowHeader } = require('../lib/flow-yaml');
const { scanYamlDependencies } = require('../lib/dependencies');
const { dependentsOf } = require('../lib/dependents');
const { flowOwnDivision, flowDivisionAccess, divisionProblem } = require('../lib/divisions');

const router = express.Router();

// ── AI-udbydere med EU-hosting (beta) ────────────────────────────────────────
// Nøglerne gemmes kun her på serveren, krypteret (se ai-providers.js), og
// sendes aldrig tilbage til browseren — kun "sat / ikke sat". Funktionen er
// slået fra som standard og kræver aktiveringsnøglen. Hverken prompts eller
// svar logges; loggen får kun hvilken udbyder og hvordan det gik.
const AI = require('../ai-providers.js');
const aiStore = AI.createStore(SESSION_DIR);
{
  let cache = { mtime: -1, keys: [] };
  setAiSecrets(() => {
    const m = aiStore.mtime();
    if (m !== cache.mtime) { cache = { mtime: m, keys: m ? aiStore.secrets() : [] }; }
    return cache.keys;
  });
}
const aiOn = () => internalUnlocked() && loadSettings().aiEnabled === true;
function requireAi(req, res, next) {
  if (aiOn()) return next();
  res.status(403).json({ error: 'AI-funktionen er slået fra — slå den til under Kunder → AI-udbydere' });
}

function aiOverview() {
  const s = loadSettings();
  return {
    enabled: aiOn(),
    selected: AI.PROVIDERS[s.aiProvider] ? s.aiProvider : null,
    keyLost: aiStore.lost(),
    awsRegions: AI.EU_AWS_REGIONS, azureRegions: AI.AZURE_EU_REGIONS, azureApiVersion: AI.AZURE_API_VERSION,
    providers: Object.keys(AI.PROVIDERS).map(id => AI.providerStatus(id, aiStore.get(id)))
  };
}

router.get('/api/ai/providers', requireInternal, (req, res) => res.json(aiOverview()));

router.put('/api/ai/enabled', requireInternal, (req, res) => {
  const on = (req.body || {}).enabled === true;
  saveSettings({ aiEnabled: on });
  addLog('INFO', `AI assistant ${on ? 'switched on' : 'switched off'}`, null, 'AI');
  res.json(aiOverview());
});

router.put('/api/ai/selected', requireInternal, (req, res) => {
  const id = (req.body || {}).providerId;
  if (id && !AI.PROVIDERS[id]) return res.status(400).json({ error: 'Ukendt udbyder' });
  saveSettings({ aiProvider: id || null });
  res.json(aiOverview());
});

router.put('/api/ai/providers/:id', requireInternal, (req, res) => {
  if (!AI.PROVIDERS[req.params.id]) return res.status(404).json({ error: 'Ukendt udbyder' });
  const b = req.body || {};
  try {
    aiStore.set(req.params.id, b.config || {}, { dpaConfirmed: typeof b.dpaConfirmed === 'boolean' ? b.dpaConfirmed : undefined });
  } catch (e) { return res.status(400).json({ error: e.message }); }
  // Selve nøglen står ikke i loggen — kun at den er ændret
  addLog('INFO', `AI provider ${req.params.id} saved${b.config && b.config.apiKey ? ' (new key)' : ''}`, null, 'AI');
  res.json(aiOverview());
});

router.delete('/api/ai/providers/:id/key', requireInternal, (req, res) => {
  if (!AI.PROVIDERS[req.params.id]) return res.status(404).json({ error: 'Ukendt udbyder' });
  aiStore.clearKey(req.params.id);
  addLog('INFO', `AI provider ${req.params.id}: key deleted`, null, 'AI');
  res.json(aiOverview());
});

// Test: sender kun ordet "ping" og intet fra nogen org. dryRun viser blot hvad der ville blive sendt.
const AI_PING = [{ role: 'user', content: 'ping' }];
router.post('/api/ai/providers/:id/test', requireAi, async (req, res) => {
  const id = req.params.id;
  if (!AI.PROVIDERS[id]) return res.status(404).json({ error: 'Ukendt udbyder' });
  const cfg = aiStore.get(id);
  if (req.body && req.body.dryRun) return res.json({ preview: AI.previewRequest(id, cfg, { messages: AI_PING, maxTokens: 8 }) });
  const t0 = Date.now();
  try {
    await AI.callProvider({ id, cfg, messages: AI_PING, maxTokens: 8 });
    addLog('SUCCESS', `AI test ok: ${id} (${Date.now() - t0} ms)`, null, 'AI');
    res.json({ ok: true, ms: Date.now() - t0 });
  } catch (e) {
    addLog('WARN', `AI test failed: ${id} — ${e.message}`, null, 'AI');
    res.status(502).json({ error: e.message });
  }
});

// ── Chat-assistenten (beta) ──────────────────────────────────────────────────
// Serveren kører værktøjsløkken (ai-agent.js) mod den valgte udbyder og sender
// hændelserne til browseren som Server-Sent Events. Værktøjerne kalder appens
// egne ruter på loopback — dermed gælder prod-vagten (prodWriteGate), og en
// skrivning sker kun efter brugerens klik (POST /api/ai/answer).
const AGENT = require('../ai-agent.js');
const aiRuns = {};     // runId → { pending: Map(id → { resolve, kind }), ac }

async function aiLocalCall(method, url, body) {
  const host = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  const r = await axios({ method, url: `http://${host}:${PORT}${url}`, data: body, validateStatus: () => true, timeout: 20 * 60 * 1000 });
  return { status: r.status, data: r.data };
}

function aiToolDeps() {
  const loggedIn = c => c.authType !== 'oauth' || isDemo(c) || !!(tokenStore[c.id] && Date.now() < tokenStore[c.id].expiresAt);
  return {
    customers: () => loadCustomers().map(c => ({ id: c.id, name: c.name, tenant: c.tenant, group: c.group, stage: c.stage, region: c.region, authType: c.authType })),
    isLoggedIn: c => loggedIn(loadCustomers().find(x => x.id === c.id) || c),
    // Samme vurdering som ruterne selv foretager; her bruges den kun til at undgå et meningsløst klik
    prodBlock: c => prodWriteBlock(loadCustomers().find(x => x.id === c.id), tokenStore[c.id]),
    localCall: aiLocalCall,
    yamlHeader: yamlFlowHeader,
    scanDeps: scanYamlDependencies,
    dependentsOf: (c, name) => dependentsOf(loadCustomers().find(x => x.id === c.id) || c, name),
    divisionCheck: async (c, yaml) => {
      const env = loadCustomers().find(x => x.id === c.id);
      const own = flowOwnDivision(yaml);
      if (!env || !own || isDemo(env)) return null;
      return divisionProblem(own, await flowDivisionAccess(env));
    }
  };
}

function aiChatHistory(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 60) return null;
  const out = raw.map(m => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String((m && m.content) || '').slice(0, 20000) }));
  return out[out.length - 1].role === 'user' && out[out.length - 1].content.trim() ? out : null;
}

function aiSelectedReady(res) {
  const id = loadSettings().aiProvider;
  if (!AI.PROVIDERS[id]) { res.status(400).json({ error: 'Vælg en AI-udbyder under Kunder → AI-udbydere' }); return null; }
  const cfg = aiStore.get(id);
  try { AI.assertReady(id, cfg); } catch (e) { res.status(400).json({ error: e.message }); return null; }
  return { id, cfg };
}

// Præcis det første kald ville sende (adresse og indhold, aldrig nøglen) — også systemprompten og værktøjerne.
router.post('/api/ai/preview', requireAi, (req, res) => {
  const history = aiChatHistory((req.body || {}).messages);
  if (!history) return res.status(400).json({ error: 'Skriv en besked først' });
  const id = loadSettings().aiProvider;
  if (!AI.PROVIDERS[id]) return res.status(400).json({ error: 'Vælg en AI-udbyder under Kunder → AI-udbydere' });
  const messages = history.map(m => ({ role: m.role, content: redactSecrets(m.content) }));
  res.json({ provider: id, preview: AI.previewRequest(id, aiStore.get(id), { system: AGENT.SYSTEM_PROMPT, messages, tools: AGENT.TOOLS }) });
});

router.post('/api/ai/chat', requireAi, async (req, res) => {
  const ready = aiSelectedReady(res);
  if (!ready) return;
  const history = aiChatHistory((req.body || {}).messages);
  if (!history) return res.status(400).json({ error: 'Skriv en besked først' });
  const review = (req.body || {}).review !== false;

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  const runId = crypto.randomUUID();
  const run = { pending: new Map(), ac: new AbortController() };
  aiRuns[runId] = run;
  const emit = ev => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
  const ask = (kind, payload) => new Promise(resolve => {
    if (run.ac.signal.aborted) return resolve(false);
    run.pending.set(payload.id, { resolve, kind });
    emit({ type: kind, runId, ...payload });
  });
  res.on('close', () => {
    run.ac.abort();
    for (const p of run.pending.values()) p.resolve(false);
    run.pending.clear();
    delete aiRuns[runId];
  });
  emit({ type: 'start', runId, provider: ready.id });
  addLog('INFO', `AI chat started (${ready.id}, data review ${review ? 'on' : 'off'})`, null, 'AI');
  try {
    await AGENT.runAgent({
      providerId: ready.id, cfg: ready.cfg, history, review, emit, ask, signal: run.ac.signal,
      toolset: AGENT.createToolset(aiToolDeps(), (req.body || {}).draft), redact: redactSecrets,
      log: m => addLog('INFO', `AI chat ${m}`, null, 'AI')
    });
  } catch (e) {
    emit({ type: 'error', message: e.message });
  }
  addLog('INFO', 'AI chat finished', null, 'AI');
  res.end();
});

// Brugerens klik: godkend eller afvis en ventende bekræftelse eller dataforhåndsvisning.
router.post('/api/ai/answer', requireAi, (req, res) => {
  const { runId, id, approve } = req.body || {};
  const run = aiRuns[runId], p = run && run.pending.get(id);
  if (!p) return res.status(404).json({ error: 'Spørgsmålet findes ikke længere' });
  run.pending.delete(id);
  if (p.kind === 'confirm') addLog(approve === true ? 'INFO' : 'WARN', `AI write ${approve === true ? 'approved' : 'declined'} by the user`, null, 'AI');
  p.resolve(approve === true);
  res.json({ ok: true });
});

router.post('/api/ai/stop', requireAi, (req, res) => {
  const run = aiRuns[(req.body || {}).runId];
  if (run) { run.ac.abort(); for (const p of run.pending.values()) p.resolve(false); run.pending.clear(); }
  res.json({ ok: true });
});

module.exports = { router, aiStore, aiOverview };
