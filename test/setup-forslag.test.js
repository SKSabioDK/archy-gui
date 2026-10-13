// Setup-forslaget: hvor skal de data actions der mangler i målet, hen? Hos en
// kunde har prod mange integrationer, hvoraf flere er inaktive, og test har få.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');

const GC = 'purecloud-data-actions', REST = 'custom-rest-actions';
const todo = (n, integrationName, integrationType = GC, prefix = 'a') =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}`, category: integrationName, integrationName, integrationType }));
const int = (id, name, existing, over = {}) => ({ id, name, type: GC, active: true, existing, ...over });

test('en gruppe holdes samlet i integrationen med samme navn, hvis der er plads', () => {
  const p = s.planDataActionPlacement(todo(10, 'Agent Scripts'),
    [int('i1', 'Andet', 0), int('i2', 'Agent Scripts', 50)], 100);
  assert.equal(p.placements[0].allocations.length, 1);
  assert.equal(p.placements[0].allocations[0].integrationId, 'i2');
  assert.equal(p.placements[0].unplaced, null);
});

test('uden et navnematch vælges integrationen med mest plads', () => {
  const p = s.planDataActionPlacement(todo(10, 'Emails'), [int('i1', 'A', 90), int('i2', 'B', 20)], 100);
  assert.equal(p.placements[0].allocations[0].integrationId, 'i2');
});

test('en gruppe der ikke kan være samlet, deles over flere', () => {
  const p = s.planDataActionPlacement(todo(30, 'CRM'), [int('i1', 'A', 80), int('i2', 'B', 85), int('i3', 'C', 100)], 100);
  const a = p.placements[0].allocations;
  assert.equal(a.reduce((n, x) => n + x.actions.length, 0), 30);
  // Én af dem har plads til alle 30 — men C er fuld, så det skal være A eller B delt.
  assert.ok(a.length >= 2);
  assert.equal(p.placements[0].unplaced, null);
});

test('kapaciteten overskrides aldrig', () => {
  const p = s.planDataActionPlacement(todo(120, 'CRM'), [int('i1', 'A', 60), int('i2', 'B', 70)], 100);
  for (const i of p.integrations) assert.ok(i.existing + i.planned <= 100, `${i.name} er fuld`);
  assert.equal(p.placements[0].unplaced.count, 120 - 40 - 30);
  assert.equal(p.placements[0].unplaced.reason, 'no-capacity');
});

test('inaktive integrationer og andre typer bruges ikke', () => {
  const p = s.planDataActionPlacement(todo(5, 'Web'),
    [int('i1', 'Inaktiv', 0, { active: false }), int('i2', 'Anden type', 0, { type: REST })], 100);
  assert.deepEqual(p.placements[0].allocations, []);
  assert.equal(p.placements[0].unplaced.reason, 'no-integration');
  assert.equal(p.placements[0].unplaced.suggestedName, 'Web');
});

test('flere grupper deler pladsen, og de store placeres først', () => {
  const t = [...todo(8, 'Lille', GC, 'l'), ...todo(60, 'Stor', GC, 's')];
  const p = s.planDataActionPlacement(t, [int('i1', 'A', 50), int('i2', 'B', 0)], 100);
  assert.equal(p.placements[0].integrationName, 'Stor');
  assert.equal(p.placements[0].allocations[0].integrationId, 'i2');
  assert.equal(p.placements[1].allocations[0].integrationId, 'i1');
});

test('tællingen i integrationerne passer med fordelingen', () => {
  const p = s.planDataActionPlacement(todo(12, 'X'), [int('i1', 'A', 10)], 100);
  assert.equal(p.integrations[0].planned, 12);
  assert.equal(p.integrations[0].capacity, 100);
});

test('en ugyldig kapacitet falder tilbage på 100, og aldrig under 1', () => {
  assert.equal(s.planDataActionPlacement([], [], 'abc').capacity, 100);
  assert.equal(s.planDataActionPlacement([], [], 0).capacity, 100);
  assert.equal(s.planDataActionPlacement([], [], -5).capacity, 1);
});

test('ingenting at placere giver et tomt forslag', () => {
  const p = s.planDataActionPlacement([], [int('i1', 'A', 3)], 100);
  assert.deepEqual(p.placements, []);
  assert.equal(p.integrations[0].planned, 0);
});
