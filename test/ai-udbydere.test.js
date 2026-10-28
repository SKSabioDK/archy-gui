// AI-udbydere med EU-hosting (beta): nøglelageret, adapterne og GDPR-kontrollerne.
// Ingen test taler med en rigtig udbyder — udbyderen er en simuleret http-funktion.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archy-ai-'));
process.env.ARCHY_SESSION_DIR = path.join(tmp, 'server');   // før server.js indlæses
const AI = require('../ai-providers.js');
const s = require('../server.js');

const NOEGLE = 'sk-test-0123456789-ABCDEF';
const nyStore = () => AI.createStore(fs.mkdtempSync(path.join(tmp, 'store-')));
const KLAR = { apiKey: NOEGLE, dpaConfirmedAt: '2026-10-28T10:00:00Z' };

test('nøglen gemmes krypteret og kan læses igen', () => {
  const st = nyStore();
  st.set('mistral', { apiKey: NOEGLE, model: 'mistral-large-latest' });
  const raa = fs.readFileSync(st.dataFile, 'utf8');
  assert.ok(!raa.includes(NOEGLE), 'nøglen står i klartekst på disken');
  assert.ok(!raa.includes('mistral-large'), 'resten af opsætningen er heller ikke i klartekst');
  assert.equal(st.get('mistral').apiKey, NOEGLE);
});

test('uden nøglefilen kan lageret ikke læses, og det siges', () => {
  const st = nyStore();
  st.set('mistral', { apiKey: NOEGLE });
  fs.unlinkSync(st.keyFile);
  assert.deepEqual(st.get('mistral'), {});
  assert.equal(st.lost(), true);
  // en ændret fil afvises af AES-GCM i stedet for at give skrald
  const st2 = nyStore();
  st2.set('mistral', { apiKey: NOEGLE });
  const f = JSON.parse(fs.readFileSync(st2.dataFile, 'utf8'));
  f.data = Buffer.from('x' + Buffer.from(f.data, 'base64').toString('latin1'), 'latin1').toString('base64');
  fs.writeFileSync(st2.dataFile, JSON.stringify(f));
  assert.equal(st2.lost(), true);
});

test('en tom nøgle i en ændring lader den gemte stå; clearKey sletter den og aftalen', () => {
  const st = nyStore();
  st.set('mistral', { apiKey: NOEGLE }, { dpaConfirmed: true });
  st.set('mistral', { apiKey: '', model: 'ny' });
  assert.equal(st.get('mistral').apiKey, NOEGLE);
  st.clearKey('mistral');
  assert.equal(st.get('mistral').apiKey, undefined);
  assert.equal(st.get('mistral').dpaConfirmedAt, undefined);
});

test('databehandleraftalen nulstilles når endpoint, region eller model ændres', () => {
  const st = nyStore();
  st.set('azure', { apiKey: NOEGLE, endpoint: 'https://a.openai.azure.com', deployment: 'd', regionDeclared: 'swedencentral' }, { dpaConfirmed: true });
  assert.ok(st.get('azure').dpaConfirmedAt);
  st.set('azure', { apiKey: '', deployment: 'd' });                       // uændret
  assert.ok(st.get('azure').dpaConfirmedAt, 'uændret opsætning skal beholde aftalen');
  st.set('azure', { regionDeclared: 'eastus' });
  assert.equal(st.get('azure').dpaConfirmedAt, undefined);
});

test('opsætningen afvises hvis den kan sende data ud af EU eller til et forkert sted', () => {
  assert.throws(() => AI.cleanConfig('bedrock', { awsRegion: 'us-east-1' }), /EU regions/);
  assert.throws(() => AI.cleanConfig('bedrock', { modelId: 'us.anthropic.x' }), /outside the EU/);
  assert.throws(() => AI.cleanConfig('bedrock', { modelId: 'global.anthropic.x' }), /outside the EU/);
  assert.throws(() => AI.cleanConfig('azure', { endpoint: 'https://evil.example.com' }), /openai\.azure\.com/);
  assert.throws(() => AI.cleanConfig('custom', { endpoint: 'http://example.com/v1/chat/completions' }), /https/);
  assert.throws(() => AI.cleanConfig('custom', { endpoint: 'https://user:pw@example.com/v1' }), /login/);
  assert.throws(() => AI.cleanConfig('custom', { authHeader: 'X Key\r\nEvil: 1' }), /single line|header name/);
  assert.equal(AI.cleanConfig('custom', { endpoint: 'http://localhost:11434/v1/chat/completions' }).endpoint, 'http://localhost:11434/v1/chat/completions');
  assert.equal(AI.cleanConfig('azure', { endpoint: 'https://min.openai.azure.com/foo' }).endpoint, 'https://min.openai.azure.com');
  // felter en udbyder ikke har, ignoreres
  assert.deepEqual(AI.cleanConfig('mistral', { endpoint: 'https://evil.example.com', model: 'm' }), { model: 'm' });
});

test('Mistral bruger kun EU-adressen, Azure api-key-headeren og Bedrock en Bearer-nøgle i den valgte EU-region', () => {
  const input = { system: 'S', messages: [{ role: 'user', content: 'hej' }], tools: [] };
  const m = AI.buildRequest('mistral', KLAR, input);
  assert.equal(m.url, 'https://api.eu.mistral.ai/v1/chat/completions');
  assert.equal(m.headers.Authorization, `Bearer ${NOEGLE}`);
  assert.deepEqual(m.body.messages[0], { role: 'system', content: 'S' });

  const a = AI.buildRequest('azure', { ...KLAR, endpoint: 'https://min.openai.azure.com', deployment: 'gpt-x' }, input);
  assert.equal(a.url, 'https://min.openai.azure.com/openai/deployments/gpt-x/chat/completions?api-version=2024-10-21');
  assert.equal(a.headers['api-key'], NOEGLE);
  assert.equal(a.headers.Authorization, undefined);

  const b = AI.buildRequest('bedrock', { ...KLAR, awsRegion: 'eu-west-1', modelId: 'eu.anthropic.x' }, input);
  assert.equal(b.url, 'https://bedrock-runtime.eu-west-1.amazonaws.com/model/eu.anthropic.x/converse');
  assert.equal(b.headers.Authorization, `Bearer ${NOEGLE}`);
  assert.deepEqual(b.body.system, [{ text: 'S' }]);

  const c = AI.buildRequest('custom', { ...KLAR, endpoint: 'https://eu.example.com/v1/chat/completions', model: 'x', authHeader: 'X-Api-Key' }, input);
  assert.equal(c.headers['X-Api-Key'], NOEGLE);
  assert.equal(c.headers.Authorization, undefined);
});

test('værktøjer og værktøjssvar oversættes til begge formater', () => {
  const tools = [{ name: 'list_flows', description: 'd', parameters: { customer: { type: 'string' } }, required: ['customer'] }];
  const messages = [
    { role: 'user', content: 'find' },
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'list_flows', args: { customer: 'X' } }] },
    { role: 'tool', toolCallId: 't1', content: 'svar' }
  ];
  const o = AI.buildRequest('mistral', KLAR, { messages, tools }).body;
  assert.equal(o.tools[0].function.parameters.required[0], 'customer');
  assert.equal(o.messages[1].tool_calls[0].function.arguments, '{"customer":"X"}');
  assert.deepEqual(o.messages[2], { role: 'tool', tool_call_id: 't1', content: 'svar' });

  const b = AI.buildRequest('bedrock', { ...KLAR, modelId: 'eu.x' }, { messages, tools }).body;
  assert.equal(b.toolConfig.tools[0].toolSpec.inputSchema.json.required[0], 'customer');
  assert.equal(b.messages[1].content[0].toolUse.toolUseId, 't1');
  assert.equal(b.messages[2].role, 'user');
  assert.equal(b.messages[2].content[0].toolResult.toolUseId, 't1');
});

test('svar fra begge formater giver samme form', () => {
  const o = AI.parseResponse('mistral', { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'a', function: { name: 'n', arguments: '{"x":1}' } }] } }] });
  assert.deepEqual(o.toolCalls, [{ id: 'a', name: 'n', args: { x: 1 } }]);
  const b = AI.parseResponse('bedrock', { stopReason: 'tool_use', output: { message: { content: [{ text: 'hej' }, { toolUse: { toolUseId: 'b', name: 'n', input: { y: 2 } } }] } } });
  assert.equal(b.text, 'hej');
  assert.deepEqual(b.toolCalls, [{ id: 'b', name: 'n', args: { y: 2 } }]);
  // ødelagte argumenter bliver til et tomt objekt i stedet for at vælte løkken
  assert.deepEqual(AI.parseResponse('custom', { choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'n', arguments: '{ikke json' } }] } }] }).toolCalls[0].args, {});
});

test('forhåndsvisningen viser adresse og indhold, aldrig nøglen', () => {
  const p = AI.previewRequest('mistral', KLAR, { messages: [{ role: 'user', content: 'ping' }], maxTokens: 8 });
  const tekst = JSON.stringify(p);
  assert.ok(!tekst.includes(NOEGLE) && !/bearer/i.test(tekst));
  assert.ok(tekst.includes('api.eu.mistral.ai') && tekst.includes('ping'));
});

test('intet sendes uden nøgle, udfyldte felter og databehandleraftale', async () => {
  let kaldt = 0;
  const http = async () => { kaldt++; return { data: {} }; };
  await assert.rejects(AI.callProvider({ id: 'mistral', cfg: { apiKey: NOEGLE }, messages: [], http }), /data processing agreement/);
  await assert.rejects(AI.callProvider({ id: 'mistral', cfg: { dpaConfirmedAt: 'x' }, messages: [], http }), /apiKey/);
  await assert.rejects(AI.callProvider({ id: 'azure', cfg: KLAR, messages: [], http }), /endpoint/);
  await assert.rejects(AI.callProvider({ id: 'custom', cfg: KLAR, messages: [], http }), /regionDeclared/);
  assert.equal(kaldt, 0);
});

test('en simuleret udbyder svarer, og en fejl afslører hverken nøgle eller indhold', async () => {
  const ok = await AI.callProvider({ id: 'mistral', cfg: KLAR, messages: [{ role: 'user', content: 'ping' }],
    http: async (url, body, opt) => { assert.equal(opt.headers.Authorization, `Bearer ${NOEGLE}`); return { data: { choices: [{ message: { content: 'pong' } }] } }; } });
  assert.equal(ok.text, 'pong');
  const fejl = { response: { status: 400, data: { error: { code: 'invalid_request', message: 'din besked: CPR 010203-1234' } } } };
  await assert.rejects(AI.callProvider({ id: 'mistral', cfg: KLAR, messages: [], http: async () => { throw fejl; } }), e => {
    assert.match(e.message, /HTTP 400 \(invalid_request\)/);
    assert.ok(!e.message.includes('CPR') && !e.message.includes(NOEGLE));
    return true;
  });
});

test('status til brugerfladen indeholder aldrig nøglen, men siger sat / ikke sat og regionen', () => {
  const st = AI.providerStatus('azure', { ...KLAR, endpoint: 'https://min.openai.azure.com', deployment: 'd', regionDeclared: 'swedencentral' });
  assert.ok(!JSON.stringify(st).includes(NOEGLE));
  assert.equal(st.keySet, true);
  assert.equal(st.ready, true);
  assert.equal(st.region.basis, 'declared', 'Azures region er brugerens egen erklæring og må ikke fremstå som kontrolleret');
  assert.equal(AI.providerStatus('mistral', {}).keySet, false);
  assert.equal(AI.providerStatus('mistral', { apiKey: NOEGLE }).ready, false, 'uden aftale er den ikke klar');
  assert.equal(AI.providerStatus('mistral', {}).region.basis, 'documented');
});

test('serveren: oversigten og loggen afslører ikke en gemt nøgle', () => {
  s.aiStore.set('mistral', { apiKey: NOEGLE, model: 'm' }, { dpaConfirmed: true });
  const j = JSON.stringify(s.aiOverview());
  assert.ok(!j.includes(NOEGLE), 'oversigten til browseren indeholder nøglen');
  assert.ok(j.includes('"keySet":true'));
  assert.ok(!s.redactSecrets(`fejl med ${NOEGLE} i teksten`).includes(NOEGLE), 'redactSecrets maskerer ikke AI-nøglen');
});

test('AI-ruterne kræver aktiveringsnøglen og test-ruten kræver at funktionen er slået til', () => {
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const r of ["app.get('/api/ai/providers', requireInternal", "app.put('/api/ai/enabled', requireInternal", "app.put('/api/ai/providers/:id', requireInternal",
    "app.delete('/api/ai/providers/:id/key', requireInternal", "app.post('/api/ai/providers/:id/test', requireAi"])
    assert.ok(SERVER.includes(r), r);
  assert.ok(SERVER.includes('internalUnlocked() && loadSettings().aiEnabled === true'), 'slået fra som standard');
  const fn = SERVER.slice(SERVER.indexOf("app.post('/api/ai/providers/:id/test'"), SERVER.indexOf('// Skal stå EFTER alle ruter'));
  assert.ok(!/addLog\([^)]*(content|messages|prompt)/.test(fn), 'prompts må ikke logges');
});

test('nøglemateriale og indstillinger kan ikke komme i git', () => {
  const ignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(ignore, /^settings\.json$/m);
  assert.ok(!AI.createStore(tmp).dataFile.startsWith(path.join(__dirname, '..')), 'lageret ligger i projektmappen');
  const kode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(kode.includes('AI.createStore(SESSION_DIR)'), 'lageret skal ligge i profilmappen (SESSION_DIR)');
});
