// AI-udbydere med EU-hosting (beta, bag aktiveringsnøglen).
//
// Ét lag med samme grænseflade for alle udbydere:
//   buildRequest(id, cfg, { system, messages, tools, maxTokens }) → { url, headers, body }
//   parseResponse(id, data)                                      → { text, toolCalls, stop }
//   callProvider({ id, cfg, ..., http })                         → { text, toolCalls, stop }
//
// Beskederne har ét fælles format (OpenAI-lignende), adapteren oversætter:
//   { role: 'user' | 'assistant' | 'tool', content, toolCalls?: [{ id, name, args }], toolCallId? }
//
// Nøgler gemmes kun her, krypteret med AES-256-GCM. Den krypterede fil og
// nøglen til den ligger i brugerens profilmappe — aldrig i projektmappen. Det
// beskytter mod at filen kopieres eller committes; det beskytter IKKE mod en
// der har adgang til Windows-kontoen, for dér ligger nøglen til filen også.
//
// Ingen prompts eller svar skrives nogen steder herfra.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

// ── Udbydere ─────────────────────────────────────────────────────────────────
// Endpoints og autentificering er slået op i udbydernes dokumentation
// (kontrolleret 2026-10-28):
//   Mistral: POST https://api.eu.mistral.ai/v1/chat/completions, Bearer. Mistrals
//     "Regional inference": det regionale endpoint behandler i EU; det globale
//     api.mistral.ai binder sig ikke til en placering — derfor bruges kun EU-hosten.
//   Azure OpenAI: POST {ressource}/openai/deployments/{deployment}/chat/completions
//     ?api-version=…, header "api-key". Regionen afgøres af hvor ressourcen og
//     udrulningen ligger i Azure — det kan Archy ikke se, så den er brugerens
//     egen erklæring.
//   Amazon Bedrock: POST https://bedrock-runtime.{region}.amazonaws.com/model/{id}/converse,
//     "Authorization: Bearer <Bedrock API-nøgle>". Et geografisk inference profile
//     (eu.…) holder sig til EU's regioner.
//   Egen endpoint: en OpenAI-kompatibel chat/completions-URL.

const EU_AWS_REGIONS = ['eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'eu-south-1', 'eu-south-2', 'eu-central-2'];
const AZURE_EU_REGIONS = ['swedencentral', 'francecentral', 'germanywestcentral', 'northeurope', 'westeurope', 'norwayeast', 'polandcentral', 'italynorth', 'spaincentral', 'switzerlandnorth'];
const MISTRAL_EU_URL = 'https://api.eu.mistral.ai/v1/chat/completions';
const AZURE_API_VERSION = '2024-10-21';

const PROVIDERS = {
  mistral: {
    id: 'mistral', label: 'Mistral (EU)', adapter: 'openai',
    fields: ['apiKey', 'model'],
    // 'documented' = udbyderens egen dokumentation siger det; 'declared' = brugerens egen erklæring
    regionBasis: 'documented'
  },
  azure: {
    id: 'azure', label: 'Azure OpenAI (EU-region)', adapter: 'openai',
    fields: ['apiKey', 'endpoint', 'deployment', 'apiVersion', 'regionDeclared'],
    regionBasis: 'declared'
  },
  bedrock: {
    id: 'bedrock', label: 'Claude via Amazon Bedrock (EU)', adapter: 'bedrock',
    fields: ['apiKey', 'awsRegion', 'modelId'],
    regionBasis: 'documented'
  },
  custom: {
    id: 'custom', label: 'Egen endpoint (OpenAI-kompatibel)', adapter: 'openai',
    fields: ['apiKey', 'endpoint', 'model', 'authHeader', 'regionDeclared'],
    regionBasis: 'declared'
  }
};

const STRING_FIELDS = ['apiKey', 'model', 'endpoint', 'deployment', 'apiVersion', 'regionDeclared', 'awsRegion', 'modelId', 'authHeader'];
// Ændres en af disse, gælder databehandleraftalen ikke længere for det nye sted.
const DPA_BOUND = ['endpoint', 'deployment', 'regionDeclared', 'awsRegion', 'modelId', 'model'];

function isLocalHost(h) { return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'; }

function parseHttpsUrl(raw, what) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (_) { throw new Error(`${what} is not a valid URL`); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHost(u.hostname)))
    throw new Error(`${what} must use https`);
  if (u.username || u.password) throw new Error(`${what} must not contain a login`);
  return u;
}

// Ren: rens og tjek en ændring af én udbyders opsætning. Returnerer kun de felter der er sendt med.
function cleanConfig(id, patch) {
  const p = PROVIDERS[id];
  if (!p) throw new Error('Unknown provider');
  const out = {};
  for (const k of STRING_FIELDS) {
    if (!p.fields.includes(k) || patch[k] === undefined) continue;
    const v = String(patch[k] == null ? '' : patch[k]).trim();
    if (v.length > 400) throw new Error(`${k} is too long`);
    if (/[\r\n\u0000]/.test(v)) throw new Error(`${k} must be a single line`);
    out[k] = v;
  }
  if (out.endpoint) {
    const u = parseHttpsUrl(out.endpoint, 'The endpoint');
    if (id === 'azure' && !/\.(openai\.azure\.com|cognitiveservices\.azure\.com)$/i.test(u.hostname))
      throw new Error('An Azure OpenAI endpoint ends in .openai.azure.com or .cognitiveservices.azure.com');
    out.endpoint = id === 'azure' ? u.origin : u.href;
  }
  if (out.deployment && !/^[A-Za-z0-9._-]{1,64}$/.test(out.deployment)) throw new Error('The deployment name may only contain letters, digits, dot, dash and underscore');
  if (out.apiVersion && !/^\d{4}-\d{2}-\d{2}(-preview)?$/.test(out.apiVersion)) throw new Error('The api-version looks like 2024-10-21');
  if (out.awsRegion && !EU_AWS_REGIONS.includes(out.awsRegion)) throw new Error('Only EU regions are allowed for Bedrock');
  if (out.modelId) {
    if (!/^[A-Za-z0-9._:\-/]{3,200}$/.test(out.modelId)) throw new Error('The model id has characters that are not allowed');
    // Et profil med us./apac./global. kan sende data ud af EU
    if (/^(us|apac|global|us-gov|jp|au)\./i.test(out.modelId)) throw new Error('This model id routes outside the EU — use an eu.* inference profile or a model in the chosen EU region');
  }
  if (out.model && !/^[A-Za-z0-9._:\-/]{1,120}$/.test(out.model)) throw new Error('The model name has characters that are not allowed');
  if (out.authHeader && !/^[A-Za-z0-9-]{1,40}$/.test(out.authHeader)) throw new Error('The header name may only contain letters, digits and dash');
  return out;
}

// ── Krypteret nøglelager ─────────────────────────────────────────────────────

function createStore(dir) {
  const keyFile = path.join(dir, 'ai.key');
  const dataFile = path.join(dir, 'ai-providers.enc');

  function masterKey(create) {
    try {
      const raw = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
      if (raw.length === 32) return raw;
    } catch (_) { /* ingen nøgle endnu */ }
    if (!create) return null;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const k = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, k.toString('base64'), { mode: 0o600 });
    return k;
  }

  function read() {
    let file;
    try { file = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (_) { return { providers: {} }; }
    const key = masterKey(false);
    if (!key) return { providers: {}, lost: true };
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
      d.setAuthTag(Buffer.from(file.tag, 'base64'));
      const plain = Buffer.concat([d.update(Buffer.from(file.data, 'base64')), d.final()]).toString('utf8');
      const j = JSON.parse(plain);
      return { providers: j.providers || {} };
    } catch (_) { return { providers: {}, lost: true }; }
  }

  function write(state) {
    const key = masterKey(true);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update(JSON.stringify({ providers: state.providers }), 'utf8'), c.final()]);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(dataFile, JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
  }

  return {
    keyFile, dataFile,
    get(id) { return read().providers[id] || {}; },
    // En tom apiKey i patchen lader den eksisterende stå; brug clearKey til at slette den.
    set(id, patch, { dpaConfirmed } = {}) {
      const state = read();
      const clean = cleanConfig(id, patch);
      const before = state.providers[id] || {};
      const next = { ...before };
      for (const [k, v] of Object.entries(clean)) {
        if (k === 'apiKey' && !v) continue;
        next[k] = v;
      }
      if (DPA_BOUND.some(k => k in clean && clean[k] !== (before[k] || ''))) delete next.dpaConfirmedAt;
      if (dpaConfirmed === true) next.dpaConfirmedAt = new Date().toISOString();
      if (dpaConfirmed === false) delete next.dpaConfirmedAt;
      state.providers[id] = next;
      write(state);
    },
    clearKey(id) {
      const state = read();
      if (state.providers[id]) { delete state.providers[id].apiKey; delete state.providers[id].dpaConfirmedAt; write(state); }
    },
    lost() { return !!read().lost; },
    // Til maskeringen i logfilen: alle gemte nøgler, så de aldrig kan stå i en tekst
    secrets() { return Object.values(read().providers).map(p => p && p.apiKey).filter(k => k && k.length > 6); },
    mtime() { try { return fs.statSync(dataFile).mtimeMs; } catch (_) { return 0; } }
  };
}

// ── Status til brugerfladen — aldrig selve nøglen ────────────────────────────

function effective(id, cfg) {
  const c = cfg || {};
  switch (id) {
    case 'mistral': return { model: c.model || 'mistral-large-latest' };
    case 'azure':   return { endpoint: c.endpoint || '', deployment: c.deployment || '', apiVersion: c.apiVersion || AZURE_API_VERSION, regionDeclared: c.regionDeclared || '' };
    case 'bedrock': return { awsRegion: c.awsRegion || 'eu-central-1', modelId: c.modelId || '' };
    case 'custom':  return { endpoint: c.endpoint || '', model: c.model || '', authHeader: c.authHeader || '', regionDeclared: c.regionDeclared || '' };
    default: return {};
  }
}

// Hvor og på hvilket grundlag: det brugeren ser ved siden af udbyderen.
function regionInfo(id, cfg) {
  const e = effective(id, cfg);
  if (id === 'mistral') return { text: 'EU — api.eu.mistral.ai', basis: 'documented', host: 'api.eu.mistral.ai' };
  if (id === 'bedrock') return { text: `EU — ${e.awsRegion}${/^eu\./i.test(e.modelId) ? ' (eu.* inference profile)' : ''}`, basis: 'documented', host: `bedrock-runtime.${e.awsRegion}.amazonaws.com` };
  let host = '';
  try { host = new URL(e.endpoint).host; } catch (_) { /* ikke sat */ }
  return { text: e.regionDeclared || '', basis: 'declared', host };
}

function missingFor(id, cfg) {
  const c = cfg || {}, e = effective(id, c), m = [];
  if (!c.apiKey) m.push('apiKey');
  if (id === 'azure') { if (!e.endpoint) m.push('endpoint'); if (!e.deployment) m.push('deployment'); if (!e.regionDeclared) m.push('regionDeclared'); }
  if (id === 'bedrock' && !e.modelId) m.push('modelId');
  if (id === 'custom') { if (!e.endpoint) m.push('endpoint'); if (!e.model) m.push('model'); if (!e.regionDeclared) m.push('regionDeclared'); }
  return m;
}

function providerStatus(id, cfg) {
  const c = cfg || {}, miss = missingFor(id, c);
  return {
    id, label: PROVIDERS[id].label,
    config: effective(id, c),                    // aldrig apiKey
    keySet: !!c.apiKey,
    region: regionInfo(id, c),
    dpaConfirmedAt: c.dpaConfirmedAt || null,
    missing: miss,
    ready: !miss.length && !!c.dpaConfirmedAt
  };
}

// Kastes før noget sendes: nøgle, felter og databehandleraftale skal være på plads.
function assertReady(id, cfg) {
  if (!PROVIDERS[id]) throw new Error('Unknown provider');
  const miss = missingFor(id, cfg);
  if (miss.length) throw new Error(`The provider is not set up yet: ${miss.join(', ')}`);
  if (!(cfg || {}).dpaConfirmedAt) throw new Error('Confirm that you have a data processing agreement with the provider before using it');
}

// ── Oversættelse af beskeder ─────────────────────────────────────────────────

const toolSchema = t => ({ type: 'object', properties: t.parameters || {}, required: t.required || [] });

function openaiMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'assistant') {
      const o = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls && m.toolCalls.length)
        o.tool_calls = m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
      out.push(o);
    } else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else out.push({ role: 'user', content: m.content });
  }
  return out;
}

function bedrockMessages(messages) {
  const out = [];
  const push = (role, block) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block); else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.content) push('assistant', { text: m.content });
      for (const c of m.toolCalls || []) push('assistant', { toolUse: { toolUseId: c.id, name: c.name, input: c.args || {} } });
      if (!m.content && !(m.toolCalls || []).length) push('assistant', { text: '.' });
    } else if (m.role === 'tool') push('user', { toolResult: { toolUseId: m.toolCallId, content: [{ text: m.content || '.' }] } });
    else push('user', { text: m.content || '.' });
  }
  return out;
}

// ── Adaptere ─────────────────────────────────────────────────────────────────

function buildRequest(id, cfg, { system, messages, tools, maxTokens = 2048 }) {
  const p = PROVIDERS[id];
  if (!p) throw new Error('Unknown provider');
  const c = cfg || {}, e = effective(id, c);
  if (p.adapter === 'bedrock') {
    const body = { messages: bedrockMessages(messages), inferenceConfig: { maxTokens } };
    if (system) body.system = [{ text: system }];
    if (tools && tools.length) body.toolConfig = { tools: tools.map(t => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: toolSchema(t) } } })) };
    return {
      url: `https://bedrock-runtime.${e.awsRegion}.amazonaws.com/model/${encodeURIComponent(e.modelId)}/converse`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey || ''}` },
      body
    };
  }
  const body = { messages: openaiMessages(system, messages), max_tokens: maxTokens };
  if (tools && tools.length) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toolSchema(t) } }));
  const headers = { 'Content-Type': 'application/json' };
  let url;
  if (id === 'mistral') {
    url = MISTRAL_EU_URL; body.model = e.model; headers.Authorization = `Bearer ${c.apiKey || ''}`;
  } else if (id === 'azure') {
    url = `${e.endpoint}/openai/deployments/${encodeURIComponent(e.deployment)}/chat/completions?api-version=${encodeURIComponent(e.apiVersion)}`;
    headers['api-key'] = c.apiKey || '';
  } else {
    url = e.endpoint; body.model = e.model;
    if (e.authHeader) headers[e.authHeader] = c.apiKey || ''; else headers.Authorization = `Bearer ${c.apiKey || ''}`;
  }
  return { url, headers, body };
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
}

function parseResponse(id, data) {
  if (PROVIDERS[id].adapter === 'bedrock') {
    const parts = (((data || {}).output || {}).message || {}).content || [];
    return {
      text: parts.filter(x => x.text).map(x => x.text).join(''),
      toolCalls: parts.filter(x => x.toolUse).map(x => ({ id: x.toolUse.toolUseId, name: x.toolUse.name, args: parseArgs(x.toolUse.input) })),
      stop: (data || {}).stopReason || null
    };
  }
  const ch = ((data || {}).choices || [])[0] || {}, msg = ch.message || {};
  let text = msg.content || '';
  if (Array.isArray(text)) text = text.map(x => (typeof x === 'string' ? x : x.text || '')).join('');
  return {
    text,
    toolCalls: (msg.tool_calls || []).map(c => ({ id: c.id, name: (c.function || {}).name, args: parseArgs((c.function || {}).arguments) })),
    stop: ch.finish_reason || null
  };
}

// Hvad der vises før noget sendes: adressen og indholdet — aldrig nøglen eller headeren.
function previewRequest(id, cfg, input) {
  const r = buildRequest(id, { ...(cfg || {}), apiKey: '' }, input);
  return { url: r.url, body: r.body };
}

// http er udskiftelig, så testene kan bruge en simuleret udbyder.
async function callProvider({ id, cfg, system, messages, tools, maxTokens, signal, http }) {
  assertReady(id, cfg);
  const r = buildRequest(id, cfg, { system, messages, tools, maxTokens });
  try {
    const resp = await (http || axios.post)(r.url, r.body, { headers: r.headers, timeout: 120000, signal, maxRedirects: 0 });
    return parseResponse(id, resp.data);
  } catch (e) {
    // Svaret fra udbyderen kan gentage dele af det der blev sendt — kun status og udbyderens egen korte fejlkode vises
    const status = e.response && e.response.status;
    const d = (e.response && e.response.data) || {};
    const code = typeof d.error === 'string' ? d.error : (d.error && (d.error.code || d.error.type)) || d.__type || '';
    const err = new Error(status ? `The provider answered HTTP ${status}${code ? ` (${String(code).slice(0, 60)})` : ''}` : `The provider could not be reached (${e.code || 'network error'})`);
    err.status = status || null;
    if (e.name === 'CanceledError' || e.code === 'ERR_CANCELED') err.canceled = true;
    throw err;
  }
}

module.exports = {
  PROVIDERS, EU_AWS_REGIONS, AZURE_EU_REGIONS, MISTRAL_EU_URL, AZURE_API_VERSION,
  createStore, cleanConfig, providerStatus, assertReady, missingFor, effective, regionInfo,
  buildRequest, parseResponse, previewRequest, callProvider
};
