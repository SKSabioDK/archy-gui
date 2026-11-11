// Archy opretter flowet i den division YAML'en siger. Mangler den i målet, eller
// må login'et ikke oprette flows dér, fejlede importen først i Archy — efter at
// tabeller, prompts og moduler var migreret med. Nu afgøres det før.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../src/server.js');

const { kilde, udsnit } = require('./kilde.js');
const MIGRATE = kilde('routes/migrate.js');
const ACCESS = { names: new Set(['Home', 'CAPTURI', 'Falck Global Tele']), permitted: new Set(['Home']) };

test('flowets egen division er den første indrykkede', () => {
  const yaml = 'inboundCall:\n  name: X\n  division: "Falck Global Tele"\n  tasks:\n    - x:\n        division: Task.division\n';
  assert.equal(s.flowOwnDivision(yaml), 'Falck Global Tele');
  assert.equal(s.flowOwnDivision('inboundCall:\n  name: X\n'), null);
});

test('mangler, nægtet eller i orden', () => {
  assert.equal(s.divisionProblem('EUR_FGA', ACCESS), 'missing');
  assert.equal(s.divisionProblem('CAPTURI', ACCESS), 'denied');
  assert.equal(s.divisionProblem('Home', ACCESS), null);
});

test('kendes rettighederne ikke, afgør Archy det', () => {
  assert.equal(s.divisionProblem('CAPTURI', { names: ACCESS.names, permitted: null }), null);
  assert.equal(s.divisionProblem(null, ACCESS), null);
});

test('en nægtet division blokerer forfremmelsen i tjekket', () => {
  const v = s.buildMigrationVerdict({ deps: [], divisionDenied: 'CAPTURI' });
  assert.equal(v.canPromote, false);
  assert.deepEqual(v.blockers, [{ kind: 'division', name: 'CAPTURI', code: 'division-denied' }]);
});

test('prepare afviser en nægtet division, før noget migreres med', () => {
  const route = udsnit(MIGRATE, "router.post('/api/migrate/prepare'", 'async function migrationPreflight(');
  assert.match(route, /if \(analysis\.divisionDenied\)\s*return res\.status\(409\)/);
});

test('et modul i en division der mangler i målet, lægges i målmiljøets division', () => {
  const fn = udsnit(MIGRATE, 'async function migrateFlowDependency(', "router.post('/api/divisions/create'");
  assert.match(fn, /problem === 'missing' && !omskriv\)[\s\S]{0,400}omskriv = true;/);
  assert.ok(fn.indexOf("problem === 'denied'") < fn.indexOf('runArchy(`publish'), 'nægtet division skal stoppe før importen');
});
