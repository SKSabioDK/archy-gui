// Opsætningen i org'en: rækken der beskriver miljøet, og som en anden pc kan
// finde miljøerne igen med.
//
// Reglerne blev aftalt før koden, og det er dem der prøves her:
//   · org'en vinder for de delte felter — men løsner aldrig prod-vagten
//   · trinlisten flettes ind, den erstattes aldrig
//   · søskendelisten mister ikke viden fordi én pc har færre miljøer
//   · et miljø uden præfiks tager aldrig flows med et præfiks org'en bruger
//   · ingen hemmeligheder i rækken

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');
const { KUNDE } = require('./fixtures.js');

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const KLIENT = '33333333-3333-3333-3333-333333333333';
const KLIENT_P = '44444444-4444-4444-4444-444444444444';

// Din kunde: dev og test med præfiks og UAT uden i test-org'en, prod uden
// præfiks i sin egen org.
const miljoe = (id, stage, prefix, orgId, extra = {}) => ({
  id, name: `Kunde ${stage.toUpperCase()}`, tenant: 'Kunde A/S', group: 'DK', stage, prefix,
  clientId: orgId === ORG_B ? KLIENT_P : KLIENT, clientSecret: 'hemmelig-secret-123', region: 'mypurecloud.de',
  authType: 'oauth', orgId, pipelineId: 'p-1', ...extra });
const DEV  = miljoe('dev',  'dev',  'DEV_',  ORG_A);
const TST  = miljoe('test', 'test', 'TEST_', ORG_A);
const UAT  = miljoe('uat',  'uat',  '',      ORG_A);
const PROD = miljoe('prod', 'prod', '',      ORG_B, { deployGroup: 'Release managers' });
const ALLE = [DEV, TST, UAT, PROD];

// ── Rækken ───────────────────────────────────────────────────────────────────

test('opsætningsrækken kan aldrig forveksles med et flow', () => {
  // Et flows nøgle er altid "grundnavn|TYPE". Tavlen og releases må aldrig
  // læse opsætningen som et flow.
  assert.equal(s.isFlowRowKey(s.SETUP_KEY), false);
  assert.equal(s.isFlowRowKey(s.orgManifestKey('ArchyGUI_Setup', 'INBOUNDCALL')), true);
  assert.deepEqual(Object.keys(s.onlyFlowRows({ [s.SETUP_KEY]: {}, 'Velkomst|INBOUNDCALL': {} })), ['Velkomst|INBOUNDCALL']);
});

test('rækken bærer ingen hemmeligheder', () => {
  const tekst = JSON.stringify(s.setupRowFor(UAT, ALLE));
  assert.ok(!tekst.includes('hemmelig-secret-123'), 'client secret i rækken');
  assert.ok(!/clientSecret|token/i.test(tekst), 'et felt der hedder secret eller token');
});

test('rækken beskriver miljøet og dets søskende', () => {
  const r = s.setupRowFor(UAT, ALLE, { at: 1 });
  assert.equal(r.env.stage, 'uat');
  assert.equal(r.env.prefix, '');
  assert.equal(r.env.orgId, ORG_A);
  assert.equal(r.pipelineId, 'p-1');
  assert.deepEqual(r.siblings.map(x => x.stage), ['dev', 'test', 'prod']);
  assert.deepEqual(r.takenPrefixes, ['DEV_', 'TEST_']);
  assert.equal(r.siblings.find(x => x.stage === 'prod').orgId, ORG_B);
});

test('kun en PKCE-klient deles — en client credentials-klient kan ikke bruges uden sin secret', () => {
  const creds = { ...PROD, authType: 'credentials' };
  const r = s.setupRowFor(UAT, [DEV, TST, UAT, creds]);
  assert.equal(r.siblings.find(x => x.stage === 'prod').clientId, '');
  assert.equal(r.siblings.find(x => x.stage === 'dev').clientId, KLIENT);
});

test('to rækker er ens selvom hvem og hvornår er forskellige', () => {
  const a = s.setupRowFor(UAT, ALLE, { at: 1, by: 'a' });
  const b = s.setupRowFor(UAT, ALLE, { at: 2, by: 'b' });
  assert.equal(s.sameSetup(a, b), true);
  assert.equal(s.sameSetup(a, s.setupRowFor({ ...UAT, color: 'red' }, ALLE)), false);
});

// ── Søskendelisten ───────────────────────────────────────────────────────────

test('en pc med færre miljøer sletter ikke org\'ens viden om prod', () => {
  // Pc'en har kun UAT. Uden fletningen ville den skrive en tom liste og
  // slette at prod findes i en anden org.
  const foer = s.setupRowFor(UAT, ALLE);
  const efter = s.setupRowFor(UAT, [UAT], { previous: foer });
  assert.deepEqual(efter.siblings.map(x => x.stage), ['dev', 'test', 'prod']);
});

test('pc\'ens egne miljøer erstatter deres post — de lægges ikke ved siden af', () => {
  const foer = s.setupRowFor(UAT, ALLE);
  const omdoebt = { ...PROD, name: 'Kunde PRODUKTION' };
  const efter = s.setupRowFor(UAT, [DEV, TST, UAT, omdoebt], { previous: foer });
  const prods = efter.siblings.filter(x => x.stage === 'prod');
  assert.equal(prods.length, 1);
  assert.equal(prods[0].name, 'Kunde PRODUKTION');
});

test('et miljø der har forladt pipelinen, glemmes', () => {
  const foer = s.setupRowFor(UAT, ALLE);
  const glem = [{ name: PROD.name, stage: 'prod', prefix: '', region: PROD.region, orgId: ORG_B, clientId: KLIENT_P }];
  const efter = s.setupRowFor(UAT, [DEV, TST, UAT], { previous: foer, forget: glem });
  assert.deepEqual(efter.siblings.map(x => x.stage), ['dev', 'test']);
});

test('miljøet står aldrig på sin egen søskendeliste', () => {
  const fremmed = { kind: 'archygui-setup', env: {}, siblings: [{ name: 'Kunde UAT', stage: 'uat', prefix: '', orgId: ORG_A, region: 'x' }] };
  assert.ok(!s.setupRowFor(UAT, [UAT], { previous: fremmed }).siblings.some(x => x.stage === 'uat'));
});

test('en søskendepost fra org\'en renses — ukendte felter og ugyldige id\'er kommer ikke med', () => {
  const ren = s.cleanSibling({ name: 'X', stage: 'PROD', prefix: '', orgId: 'ikke-et-id', clientId: KLIENT,
                               region: 'r', clientSecret: 'lækket', token: 't' });
  assert.deepEqual(Object.keys(ren).sort(), ['clientId', 'name', 'orgId', 'orgLabel', 'prefix', 'region', 'stage']);
  assert.equal(ren.orgId, null);
  assert.equal(ren.stage, 'prod');
  assert.equal(s.cleanSibling({ name: 'Uden org og klient' }), null);
});

// ── Org'en vinder ────────────────────────────────────────────────────────────

const raekke = env => ({ kind: 'archygui-setup', schemaVersion: 1, env, pipelineId: 'p-1', stages: ['dev', 'test', 'uat', 'prod'], takenPrefixes: [], siblings: [] });

test('org\'en vinder for de delte felter', () => {
  const r = s.setupChanges(UAT, raekke({ ...s.setupRowFor(UAT, ALLE).env, color: 'blue', group: 'Norden' }));
  assert.deepEqual(r.apply, { color: 'blue', group: 'Norden' });
  assert.deepEqual(r.held, []);
});

test('præfikset er ikke et delt felt — det er dét tabellen blev fundet på', () => {
  assert.ok(!s.SETUP_SHARED.includes('prefix'));
  const r = s.setupChanges(UAT, raekke({ ...s.setupRowFor(UAT, ALLE).env, prefix: 'X_' }));
  assert.deepEqual(r.apply, {});
});

test('org\'en kan ikke løsne prod-vagten på et prod-miljø', () => {
  // Ellers kunne en række i en datatabel sætte prod til uat eller fjerne
  // gruppekravet på alle andre pc'er.
  const org = { ...s.setupRowFor(PROD, ALLE).env, stage: 'uat', deployGroup: '', color: 'red' };
  const r = s.setupChanges(PROD, raekke(org));
  assert.deepEqual(r.apply, { color: 'red' });
  assert.deepEqual(r.held.map(h => [h.field, h.reason]).sort(), [['deployGroup', 'prod-guarded'], ['stage', 'prod-guarded']]);
});

test('org\'en må gerne stramme: et ikke-prod-miljø kan blive prod', () => {
  const r = s.setupChanges(UAT, raekke({ ...s.setupRowFor(UAT, ALLE).env, stage: 'prod' }));
  assert.equal(r.apply.stage, 'prod');
});

test('et trin denne pc ikke kender, tages ikke blindt', () => {
  const r = s.setupChanges(UAT, raekke({ ...s.setupRowFor(UAT, ALLE).env, stage: 'staging' }));
  assert.deepEqual(r.held.map(h => h.reason), ['unknown-stage']);
});

test('et navn der allerede bruges på denne pc, tages ikke — det ville dele eksportmappe', () => {
  const r = s.applyOrgSetup(UAT, raekke({ ...s.setupRowFor(UAT, ALLE).env, name: 'Kunde DEV' }), ALLE);
  assert.equal(r.env.name, 'Kunde UAT');
  assert.equal(r.held[0].reason, 'invalid');
});

test('pipelineId og org\'ens præfikser følger med fra org\'en', () => {
  const uden = { ...UAT, pipelineId: undefined, takenPrefixes: [] };
  const rk = { ...raekke(s.setupRowFor(UAT, ALLE).env), pipelineId: 'p-org', takenPrefixes: ['DEV_', 'TEST_', ''] };
  const r = s.applyOrgSetup(uden, rk, [uden]);
  assert.equal(r.env.pipelineId, 'p-org');
  assert.deepEqual(r.env.takenPrefixes, ['DEV_', 'TEST_']);
});

// ── Trinlisten ───────────────────────────────────────────────────────────────

test('org\'ens trin flettes ind på deres plads, og prod står sidst', () => {
  assert.deepEqual(s.mergeStages(['dev', 'test', 'uat', 'prod'], ['dev', 'staging', 'prod']),
                   ['dev', 'staging', 'test', 'uat', 'prod']);
  assert.deepEqual(s.mergeStages(['dev', 'prod'], ['dev', 'prod', 'efter']), ['dev', 'efter', 'prod']);
});

test('trinlisten mister aldrig et lokalt trin', () => {
  assert.deepEqual(s.mergeStages(['dev', 'test', 'uat', 'prod'], ['dev', 'prod']), ['dev', 'test', 'uat', 'prod']);
  assert.deepEqual(s.mergeStages(['dev', 'prod'], ['DROP TABLE', 42, null]), ['dev', 'prod']);
  assert.deepEqual(s.mergeStages(['dev', 'prod'], 'ikke en liste'), ['dev', 'prod']);
});

// ── Præfikser org'en bruger ──────────────────────────────────────────────────

test('UAT uden præfiks tilføjet alene tager ikke DEV_- og TEST_-flows', () => {
  // Før: kendte pc'en ikke søskendene, var "DEV_Betaling" UAT's flow.
  const alene = { ...UAT, takenPrefixes: [] };
  assert.equal(s.belongsToEnv('DEV_Betaling', alene, [alene]), true, 'kontrol: uden viden tager den det');
  const medViden = { ...UAT, takenPrefixes: ['DEV_', 'TEST_'] };
  assert.equal(s.belongsToEnv('DEV_Betaling', medViden, [medViden]), false);
  assert.equal(s.belongsToEnv('Betaling', medViden, [medViden]), true);
});

test('et miljø med præfiks er upåvirket af org\'ens præfikser', () => {
  assert.equal(s.belongsToEnv('DEV_Betaling', { ...DEV, takenPrefixes: ['DEV_'] }, [DEV]), true);
});

test('de optagne præfikser er søskendenes og opdagelsens — aldrig miljøets eget', () => {
  assert.deepEqual(s.takenPrefixesFor({ ...UAT, takenPrefixes: ['GAMMEL_', ''] }, ALLE), ['DEV_', 'GAMMEL_', 'TEST_']);
  assert.deepEqual(s.takenPrefixesFor({ ...DEV, takenPrefixes: ['DEV_'] }, ALLE), ['TEST_']);
});

// ── Pipelines ────────────────────────────────────────────────────────────────

test('miljøer i samme kunde og gruppe deler pipelineId — løse miljøer får intet', () => {
  let n = 0;
  const liste = [{ ...KUNDE.dev }, { ...KUNDE.prod }, { id: 'x', name: 'Løs', stage: '' },
                 { id: 'y', name: 'Anden', tenant: 'B', group: 'G', stage: 'dev' }];
  s.ensurePipelineIds(liste, () => `id-${++n}`);
  assert.equal(liste[0].pipelineId, liste[1].pipelineId);
  assert.equal(liste[2].pipelineId, undefined);
  assert.notEqual(liste[3].pipelineId, liste[0].pipelineId);
});

test('et eksisterende pipelineId arves af et nyt miljø i samme gruppe', () => {
  const liste = [{ ...KUNDE.dev, pipelineId: 'fra-org' }, { ...KUNDE.test }];
  s.ensurePipelineIds(liste, () => 'nyt');
  assert.equal(liste[1].pipelineId, 'fra-org');
});

test('UAT og prod uden præfiks i hver sin org støder ikke sammen', () => {
  assert.equal(s.prefixClash(UAT, ALLE), null);
  assert.equal(s.prefixClash(PROD, ALLE), null);
  assert.equal(s.pipelinePeers(UAT, ALLE).length, 4);
});

// ── Opdagelsen ───────────────────────────────────────────────────────────────

const tabel = (env, setup = true) => ({ id: 't-' + env.id, name: env.prefix + 'ArchyGUI_Manifest', prefix: env.prefix,
                                       setup: setup ? s.setupRowFor(env, ALLE, { at: 5 }) : null });

test('opdagelsen i test-org\'en viser tre kort og peger på prod i en anden org', () => {
  const ny = { id: 'ny', name: 'Ny', clientId: KLIENT, region: 'mypurecloud.de', authType: 'oauth', orgId: ORG_A };
  const r = s.discoveryResult(ny, [ny], ORG_A, [tabel(UAT), tabel(DEV), tabel(TST)]);
  assert.deepEqual(r.cards.map(c => c.setup.stage), ['dev', 'test', 'uat']);
  assert.ok(r.cards.every(c => !c.localId && !c.wrongOrg));
  assert.deepEqual(r.elsewhere.map(e => [e.stage, e.orgId]), [['prod', ORG_B]]);
  assert.equal(r.elsewhere[0].tenant, 'Kunde A/S');
});

test('opdagelsen kender de miljøer pc\'en allerede har', () => {
  const r = s.discoveryResult(UAT, ALLE, ORG_A, [tabel(UAT), tabel(DEV)]);
  assert.equal(r.cards.find(c => c.prefix === '').self, true);
  assert.equal(r.cards.find(c => c.prefix === 'DEV_').localId, 'dev');
  assert.deepEqual(r.elsewhere, [], 'prod findes allerede lokalt');
});

test('en tabel fra før opsætningsrækken vises — uden at trinnet gættes', () => {
  const ny = { id: 'ny', name: 'Ny', orgId: ORG_A };
  const r = s.discoveryResult(ny, [ny], ORG_A, [tabel(UAT, false)]);
  assert.equal(r.cards[0].setup, null);
});

test('en række der siger en anden org, markeres', () => {
  const ny = { id: 'ny', name: 'Ny', orgId: ORG_B };
  const r = s.discoveryResult(ny, [ny], ORG_B, [tabel(UAT)]);
  assert.equal(r.cards[0].wrongOrg, true);
});

// ── Genopbygning ─────────────────────────────────────────────────────────────

test('genopbygning med lokal historik beholder udgaven fra forfremmelsen', () => {
  // Tog vi org'ens nuværende udgave, ville signalet "ændret uden om
  // pipelinen" forsvinde for netop de flows nogen har rettet direkte.
  const row = s.rebuiltManifestRow({ name: 'Velkomst_v4', version: '7.0', publishedAt: 9 },
    { kind: 'migration', sourceName: 'Kunde UAT', targetVersion: '3.0', targetPublishedAt: 5, sourceVersion: '4.0', hash: 'h' });
  assert.equal(row.version, '3.0');
  assert.equal(row.promotedFrom, 'Kunde UAT');
  assert.equal(row.history, 'local');
  assert.equal(row.rebuilt, true);
});

test('genopbygning uden historik er et nulpunkt — og siger det', () => {
  const row = s.rebuiltManifestRow({ name: 'Velkomst', version: '7.0', publishedAt: 9 }, null, []);
  assert.equal(row.kind, 'baseline');
  assert.equal(row.version, '7.0');
  assert.equal(row.history, 'none');
  assert.equal(row.promotedFrom, undefined);
});
