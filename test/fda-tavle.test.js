// Tavlens FDA-mærke: hvilke flows bruger en Function Data Action. Afhængighedssporingen
// svarer med én post pr. flowUDGAVE (185 poster for én action hos Sabio), så
// sammenlægningen skal være på flow-id.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('et flow samles under de FDA\'er det bruger, sorteret', () => {
  assert.deepEqual(s.groupFdaConsumers(['b', 'a'], [['f1', 'f2'], ['f1']]), { f1: ['a', 'b'], f2: ['b'] });
});

test('samme FDA to gange for samme flow tælles én gang', () => {
  assert.deepEqual(s.groupFdaConsumers(['a', 'a'], [['f1'], ['f1']]), { f1: ['a'] });
});

test('en FDA ingen bruger, giver ingen poster', () => {
  assert.deepEqual(s.groupFdaConsumers(['a'], [[]]), {});
  assert.deepEqual(s.groupFdaConsumers([], []), {});
});

test('opslaget går på data actions i Function Data Action-integrationer', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function fdaUsage'), SERVER.indexOf("app.get('/api/customers/:id/fda-usage'"));
  assert.match(fn, /FUNCTION_INTEGRATION/);
  assert.match(fn, /consumerIds\(env, a\.id, 'DATAACTION'\)/);
  // Demo-miljøer har intet i Genesys at slå op i.
  assert.match(fn, /isDemo\(env\)/);
});

test('tavlen henter FDA-brugen i baggrunden og viser mærket i cellen', () => {
  assert.match(HTML, /checkPipelineFda\(r\);/);
  assert.match(HTML, /\$\{pipelineFdaCell\(c, prev\)\}/);
  assert.match(HTML, /\/api\/customers\/\$\{encodeURIComponent\(e\.id\)\}\/fda-usage/);
});
