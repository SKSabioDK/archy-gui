// Forfremmelse gennem hele kæden, release notes og rollback.
//
// Den første test herunder er fejlen der udløste det hele: DEV_Betaling_v6
// forfremmet til TEST blev rigtigt "TEST_Betaling_v6", men videre til UAT blev
// det "UAT_Betaling_v3" — og TEST blev omdøbt til _v3 med. Tallet kom fra
// TESTs egen udgave i stedet for fra dev.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');

const env = (id, stage, prefix = '', extra = {}) =>
  ({ id, name: id, tenant: 'Kunde 2', group: 'Norden', stage, prefix, clientId: 'x', region: 'r', ...extra });
const DEV = env('dev', 'dev', 'DEV_'), TEST = env('test', 'test', 'TEST_'),
      UAT = env('uat', 'uat', 'UAT_'), PROD = env('prod', 'prod', '', { clientId: 'y' });
const ALLE = [DEV, TEST, UAT, PROD];

test('kun pipelinens første trin sætter et nyt tal på navnet', () => {
  assert.equal(s.isPipelineOrigin(DEV, ALLE), true);
  assert.equal(s.isPipelineOrigin(TEST, ALLE), false);
  assert.equal(s.isPipelineOrigin(UAT, ALLE), false);
  assert.equal(s.isPipelineOrigin(PROD, ALLE), false);
});

test('en gruppe der starter i test har test som første trin', () => {
  const t = env('t', 'test'), p = env('p', 'prod');
  assert.equal(s.isPipelineOrigin(t, [t, p]), true);
});

test('_v6 fra dev bliver _v6 hele vejen til prod, uanset miljøernes egne udgaver', () => {
  // Fra dev: dev's udgave 6.
  const iTest = s.promotionNameFrom('Betaling', '6.0', s.isPipelineOrigin(DEV, ALLE), 'INBOUNDCALL');
  assert.equal(iTest, 'Betaling_v6');
  // Fra test: TEST står selv på v3 — det tal må IKKE bruges.
  const iUat = s.promotionNameFrom(iTest, '3.0', s.isPipelineOrigin(TEST, ALLE), 'INBOUNDCALL');
  assert.equal(iUat, 'Betaling_v6');
  const iProd = s.promotionNameFrom(iUat, '12.0', s.isPipelineOrigin(UAT, ALLE), 'INBOUNDCALL');
  assert.equal(iProd, 'Betaling_v6');
});

test('et common module får aldrig en versionsendelse — det kaldes ved navn', () => {
  // "Hilsen" → "Hilsen_v4" ville få hvert flow der kalder modulet til at pege
  // på et navn der ikke findes længere.
  assert.equal(s.carriesVersionSuffix('COMMONMODULE'), false);
  assert.equal(s.carriesVersionSuffix('commonmodule'), false);
  assert.equal(s.carriesVersionSuffix('INBOUNDCALL'), true);
  assert.equal(s.promotionNameFrom('Hilsen', '4.0', true, 'COMMONMODULE'), 'Hilsen');
});

test('UAT uden præfiks i samme org som dev og test er tilladt', () => {
  const uat = env('uat', 'uat', '');
  assert.equal(s.prefixClash(uat, [DEV, TEST, uat, PROD]), null);
  // Den tager alt der ikke bærer et søskendepræfiks.
  assert.equal(s.belongsToEnv('Betaling_v6', uat, [DEV, TEST, uat]), true);
  assert.equal(s.belongsToEnv('DEV_Betaling_v6', uat, [DEV, TEST, uat]), false);
});

test('to miljøer i samme org uden præfiks afvises', () => {
  const uat = env('uat', 'uat', '');
  const prodSammeOrg = env('prod', 'prod', '');       // samme clientId som uat
  assert.match(s.prefixClash(prodSammeOrg, [DEV, TEST, uat, prodSammeOrg]), /uden præfiks/);
  // Samme præfiks to gange er lige så galt.
  const test2 = env('test2', 'uat', 'TEST_');
  assert.match(s.prefixClash(test2, [DEV, TEST, test2]), /TEST_/);
});

test('lineDiff finder den ændrede linje midt i en fil', () => {
  const d = s.lineDiff('a\nb\nc\nd', 'a\nb\nX\nd');
  assert.deepEqual(d.filter(x => x.op !== ' ').map(x => x.op + x.text), ['-c', '+X']);
});

test('lineDiff håndterer tomt før og tomt efter', () => {
  assert.deepEqual(s.lineDiff('', 'a').map(x => x.op + x.text), ['+a']);
  assert.deepEqual(s.lineDiff('a', '').map(x => x.op + x.text), ['-a']);
});

test('releaseDiff ser bort fra trackingId og tæller linjer', () => {
  const foer  = 'inboundCall:\n  name: Betaling_v5\n  trackingId: 12\n  description: "a"\n';
  const efter = 'inboundCall:\n  name: Betaling_v6\n  trackingId: 99\n  description: "a"\n';
  const d = s.releaseDiff(foer, efter);
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.equal(d.hunks.length, 1);
  assert.ok(d.hunks[0].lines.includes('+   name: Betaling_v6'));
});

test('releaseDiff uden et før siger det, i stedet for at vise hele filen som ny', () => {
  const d = s.releaseDiff(null, 'inboundCall:\n  name: X\n');
  assert.equal(d.noPrevious, true);
  assert.equal(d.hunks.length, 0);
});

test('rollback går én forfremmelse tilbage ad gangen', () => {
  const r = (id, at, kind, extra = {}) => ({ id, at, kind, targetId: 'prod', baseName: 'Betaling', flowType: 'INBOUNDCALL', prevSnapshot: 'x', ...extra });
  const v5 = r('v5', 1, 'promotion');
  const v6 = r('v6', 2, 'promotion');
  assert.equal(s.rollbackCandidate(s.releasesFor([v5, v6], 'prod', 'Betaling', 'INBOUNDCALL')).id, 'v6');

  // Efter rollback af v6 er det v5 der står for tur — rollback-posten selv og
  // en genpublicering springes over.
  v6.rolledBackBy = 'rb';
  const rb  = r('rb', 3, 'rollback');
  const rep = r('rep', 4, 'republish');
  assert.equal(s.rollbackCandidate(s.releasesFor([v5, v6, rb, rep], 'prod', 'Betaling', 'INBOUNDCALL')).id, 'v5');
});

test('en release der oprettede flowet kan ikke rulles tilbage — der er intet før', () => {
  const ny = { id: 'n', at: 1, kind: 'promotion', targetId: 'p', baseName: 'B', flowType: 'INBOUNDCALL', prevSnapshot: null };
  assert.equal(s.rollbackCandidate([ny]), null);
});

test('release-noten som markdown bærer navneskiftet og diff-blokken', () => {
  const md = s.releaseNoteMarkdown({
    kind: 'promotion', at: Date.UTC(2026, 8, 23, 10, 0), targetName: 'PROD', sourceName: 'UAT',
    baseName: 'Betaling', flowType: 'INBOUNDCALL', fromName: 'Betaling_v5', toName: 'Betaling_v6',
    prevVersion: '12.0', newVersion: '13.0', by: 'a@b',
    diff: { added: 1, removed: 1, hunks: [{ line: 1, lines: ['-   name: Betaling_v5', '+   name: Betaling_v6'] }] }
  });
  assert.match(md, /Betaling_v5 → Betaling_v6/);
  assert.match(md, /v12\.0 → v13\.0/);
  assert.match(md, /```diff[\s\S]*\+   name: Betaling_v6[\s\S]*```/);
});

test('flowHasDraft: en kladde eller en checked-in udgave over den publicerede', () => {
  assert.equal(s.flowHasDraft({ publishedVersion: { name: '3.0' } }), false);
  assert.equal(s.flowHasDraft({ publishedVersion: { name: '3.0' }, checkedInVersion: { name: '3.0' } }), false);
  assert.equal(s.flowHasDraft({ publishedVersion: { name: '3.0' }, checkedInVersion: { name: '4.0' } }), true);
  assert.equal(s.flowHasDraft({ publishedVersion: { name: '3.0' }, savedVersion: { name: '4.0' } }), true);
});

// ── v1.41.0: releases bor i org'en ──────────────────────────────────────────
// Rollback skal virke fra en anden pc end den der forfremmede. Derfor ligger
// historikken i manifest-rækken, og den lokale fil er kun en cache.

const PROD_ENV = { id: 'prod', name: 'PROD', tenant: 'K', group: 'G', stage: 'prod' };

test('compactRelease tager hverken indhold eller diff-linjer med til org\'en', () => {
  const c = s.compactRelease({
    id: 'a', at: 1, kind: 'promotion', toName: 'X', prevVersion: '4.0', newVersion: '5.0',
    prevSnapshot: 'sti', newSnapshot: 'sti',
    diff: { added: 2, removed: 1, noPrevious: false, hunks: [{ line: 1, lines: ['+ x'] }] }
  });
  assert.equal(c.prevSnapshot, undefined);
  assert.equal(c.diff, undefined);
  assert.deepEqual(c.diffSummary, { added: 2, removed: 1, noPrevious: false });
  assert.equal(c.prevVersion, '4.0');   // det er DET rollback henter fra org'en
});

test('trimOrgReleases holder de nyeste og holder rækken under loftet', () => {
  const mange = Array.from({ length: 50 }, (_, i) => ({ id: String(i), note: '' }));
  const ud = s.trimOrgReleases(mange, {});
  assert.equal(ud.length, s.ORG_RELEASES_MAX);
  assert.equal(ud[ud.length - 1].id, '49');
  const store = Array.from({ length: 10 }, (_, i) => ({ id: String(i), note: 'x'.repeat(20000) }));
  const trimmet = s.trimOrgReleases(store, {});
  assert.ok(trimmet.length < 10 && trimmet.length >= 1);
  assert.equal(trimmet[trimmet.length - 1].id, '9');
});

test('mergeReleases: en release fra en anden pc kan rulles tilbage uden lokal cache', () => {
  const fraOrg = [{ id: 'r1', at: 5, kind: 'promotion', toName: 'Betaling_v6', fromName: 'Betaling_v5',
                   prevVersion: '12.0', newVersion: '13.0', diffSummary: { added: 1, removed: 1 } }];
  const liste = s.mergeReleases(fraOrg, [], { env: PROD_ENV, baseName: 'Betaling', flowType: 'INBOUNDCALL' });
  assert.equal(liste.length, 1);
  assert.equal(liste[0].targetId, 'prod');
  assert.equal(liste[0].source, 'org');
  assert.equal(s.rollbackCandidate(liste).id, 'r1');
});

test('mergeReleases: org\'en vinder på status, cachen bidrager med diff-linjer', () => {
  const lokal = [{ id: 'r1', at: 5, kind: 'promotion', targetId: 'prod', note: 'gammel',
                   diff: { added: 1, removed: 1, hunks: [{ line: 1, lines: ['+ x'] }] }, prevSnapshot: 'p' }];
  const org = [{ id: 'r1', at: 5, kind: 'promotion', note: 'ny fra anden pc', rolledBackBy: 'rb' }];
  const [m] = s.mergeReleases(org, lokal, { env: PROD_ENV, baseName: 'B', flowType: 'INBOUNDCALL' });
  assert.equal(m.note, 'ny fra anden pc');
  assert.equal(m.rolledBackBy, 'rb');
  assert.equal(m.diff.hunks.length, 1);
  assert.equal(m.prevSnapshot, 'p');
  assert.equal(m.source, 'org+local');
});

test('mergeReleases: poster der kun findes lokalt kommer med og siger det', () => {
  const lokal = [{ id: 'kun-her', at: 1, kind: 'promotion', targetId: 'prod' }];
  const [m] = s.mergeReleases([], lokal, { env: PROD_ENV, baseName: 'B', flowType: 'INBOUNDCALL' });
  assert.equal(m.source, 'local');
});

test('rollbackCandidate nøjes med en udgave i org\'en — intet lokalt indhold kræves', () => {
  const r = { id: 'x', at: 1, kind: 'promotion', prevVersion: '4.0', prevSnapshot: null };
  assert.equal(s.rollbackCandidate([r]).id, 'x');
});
