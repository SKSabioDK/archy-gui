// OAuth-klienter og integrationer: roller og divisioner skal matches på navn
// på tværs af orgs, og fanerne skal have tekst på alle fem sprog.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mapRoleDivisions, buildOauthClientBody, buildRolePolicies, missingRolesFor, missingDivisionsFor } = require('../server.js');

const rod = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(rod, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(rod, 'public/index.html'), 'utf8');

const srcRole = new Map([['r1', 'Admin'], ['r2', 'Custom']]);
const srcDiv = new Map([['d1', 'Sales']]);
const tgtRole = new Map([['Admin', 'R-A']]);
const tgtDiv = new Map([['Sales', 'D-S']]);

test('roller og divisioner matches på navn, og * bæres med', () => {
  const r = mapRoleDivisions([
    { roleId: 'r1', divisionId: '*' },
    { roleId: 'r1', divisionId: 'd1' },
  ], srcRole, srcDiv, tgtRole, tgtDiv);
  assert.deepEqual(r.mapped, [{ roleId: 'R-A', divisionId: '*' }, { roleId: 'R-A', divisionId: 'D-S' }]);
  assert.deepEqual(r.missing, []);
});

test('en rolle eller division der ikke findes i målet meldes tilbage', () => {
  const r = mapRoleDivisions([
    { roleId: 'r2', divisionId: '*' },
    { roleId: 'r1', divisionId: 'ukendt' },
  ], srcRole, srcDiv, tgtRole, tgtDiv);
  assert.deepEqual(r.mapped, []);
  assert.equal(r.missing.length, 2);
});

test('klientens krop tager kun det der skal med', () => {
  const b = buildOauthClientBody({
    name: 'X', authorizedGrantType: 'CODE', accessTokenValiditySeconds: 86400,
    registeredRedirectUri: ['http://localhost'], scope: ['users'], roleDivisions: [{ roleId: 'a' }],
    id: 'kilde-id', secret: 'hemmelig', selfUri: '/x',
  }, []);
  assert.deepEqual(Object.keys(b).sort(), ['accessTokenValiditySeconds', 'authorizedGrantType', 'name', 'registeredRedirectUri', 'scope', 'state']);
});

test('migreringsruterne er skrivende og målbeskyttede', () => {
  assert.match(server, /'\/api\/oauthclients\/migrate':\s+'targetId'/);
  assert.match(server, /'\/api\/integrations\/migrate':\s+'targetId'/);
});

test('en rolles politikker med betingelse springes over i stedet for at blive ubegrænsede', () => {
  const r = buildRolePolicies([
    { domain: 'routing', entityName: 'queue', actionSet: ['view'] },
    { domain: 'routing', entityName: 'queue', actionSet: ['edit'], resourceConditionNode: { variableName: 'x' } },
  ]);
  assert.equal(r.kept.length, 1);
  assert.deepEqual(r.skipped, ['routing:queue']);
});

test('rolle-migrering er skrivende og målbeskyttet', () => {
  assert.match(server, /'\/api\/roles\/migrate':\s+'targetId'/);
});

test('roller der mangler i målet findes ud fra de valgte klienter, standardroller markeret', () => {
  const roller = [{ id: 'a', name: 'Admin', default: true }, { id: 'b', name: 'Egen' }, { id: 'c', name: 'Findes' }];
  const klienter = [{ roleDivisions: [{ roleId: 'a' }, { roleId: 'b' }, { roleId: 'c' }, { roleId: 'b' }] }];
  const r = missingRolesFor(klienter, roller, new Set(['Findes']));
  assert.deepEqual(r, [{ id: 'a', name: 'Admin', default: true }, { id: 'b', name: 'Egen', default: false }]);
});

test('divisioner der mangler i målet findes ud fra klienternes roller, og * ignoreres', () => {
  const divs = [{ id: 'd1', name: 'DK' }, { id: 'd2', name: 'Findes' }];
  const klienter = [{ roleDivisions: [{ roleId: 'r', divisionId: 'd1' }, { roleId: 'r', divisionId: 'd2' }, { roleId: 'r', divisionId: '*' }] }];
  assert.deepEqual(missingDivisionsFor(klienter, divs, new Set(['Findes'])), ['DK']);
});

test('uden division i målet kan rollen gives i Home, og dubletter fjernes', () => {
  const rd = [{ roleId: 'r1', divisionId: 'd1' }, { roleId: 'r1', divisionId: 'ukendt' }];
  const uden = mapRoleDivisions(rd, srcRole, srcDiv, tgtRole, tgtDiv);
  assert.equal(uden.mapped.length, 1);
  const med = mapRoleDivisions([{ roleId: 'r1', divisionId: 'ukendt' }, { roleId: 'r1', divisionId: 'ukendt2' }], srcRole, srcDiv, tgtRole, tgtDiv, 'HOME');
  assert.deepEqual(med.mapped, [{ roleId: 'R-A', divisionId: 'HOME' }]);
  assert.deepEqual(med.missing, []);
});

test('fanerne har tekst på alle fem sprog', () => {
  for (const key of ['oa_home_confirm', 'oa_home_used', 'oa_divs_confirm', 'oa_divisions', 'oa_roles_confirm', 'oa_builtin_missing', 'da_tab_roles', 'ro_roles', 'ro_search_ph', 'ro_policies', 'ro_skipped', 'roles_note', 'da_tab_oauth', 'da_tab_integ', 'oa_clients', 'ig_integrations', 'oa_search_ph', 'ig_search_ph',
    'ml_migrate_btn', 'ml_loading', 'ml_none', 'ml_exists', 'oa_roles', 'oa_missing', 'oa_secret_warn',
    'oa_download_secrets', 'oauth_note', 'integ_note', 'ig_activated', 'ig_inactive', 'ig_todo', 'tip_ml_migrate_btn']) {
    const antal = (html.match(new RegExp(`^[ \t]*${key}:`, 'gm')) || []).length;
    assert.equal(antal, 5, `${key} findes ${antal} steder i LANGS, ikke 5`);
  }
});
