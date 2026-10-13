// Function Data Actions ved migrering. De kan ikke oprettes via API'et, så mangler
// en i målet, skal flowet vente — ellers rettes det bagefter direkte i Genesys,
// og versionsnummer og tjek kommer ude af trit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const ACTIONS = [
  { id: 'a1', name: 'get_customer',  integrationId: 'i-rest' },
  { id: 'a2', name: 'calc_delivery', integrationId: 'i-fda' },
  { id: 'a3', name: 'lookup_zip',    integrationId: 'i-fda' }
];
const TYPER = { 'i-rest': 'custom-rest-actions', 'i-fda': 'function-data-actions' };

test('kun de manglende der er Function Data Actions i kilden, blokerer', () => {
  const r = s.missingFunctionActions(['get_customer', 'calc_delivery', 'lookup_zip'], ACTIONS, TYPER);
  assert.deepEqual(r, ['calc_delivery', 'lookup_zip']);
});

test('et navn kilden ikke kender, kan ikke påvises som FDA og blokerer ikke', () => {
  assert.deepEqual(s.missingFunctionActions(['findes_ikke'], ACTIONS, TYPER), []);
});

test('ukendt integrationstype blokerer ikke', () => {
  assert.deepEqual(s.missingFunctionActions(['calc_delivery'], ACTIONS, {}), []);
  assert.deepEqual(s.missingFunctionActions(['calc_delivery'], null, null), []);
});

test('ingen manglende giver ingen blokering', () => {
  assert.deepEqual(s.missingFunctionActions([], ACTIONS, TYPER), []);
});

test('commit afviser en manglende FDA, før der skrives noget', () => {
  // Vagten skal stå i den rute der skriver, ikke kun i dialogen — ellers kan
  // klienten springe forbi den.
  const commit = SERVER.slice(SERVER.indexOf("app.post('/api/migrate/commit'"));
  const vagt = commit.indexOf('functionActionsMissingInTarget');
  assert.ok(vagt > 0, 'commit tjekker Function Data Actions');
  assert.ok(vagt < commit.indexOf('runArchy('), 'tjekket kommer før importen');
  assert.match(commit.slice(vagt, vagt + 1500), /status\(409\)[\s\S]*fda-missing/);
});
