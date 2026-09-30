// Felterne på et miljø ender i mappenavne, på Archys kommandolinje, i flownavne
// i Genesys og i URL'er. En værdi der ikke holder hele vejen, skal afvises når
// den gemmes — ikke opdages midt i en eksport.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');

const ok  = (f, andre) => assert.equal(s.envFieldError(f, andre), null, JSON.stringify(f));
const nej = (f, re, andre) => {
  const e = s.envFieldError(f, andre);
  assert.ok(e, `blev ikke afvist: ${JSON.stringify(f)}`);
  if (re) assert.match(e, re);
};

test('almindelige danske firmanavne går igennem', () => {
  // "A/S" og tankestreg står i demoens egne navne, og æøå i halvdelen af alle
  // kundenavne. De må ikke blive fanget.
  for (const name of ['Sabio APS - PROD', 'Demo A/S — DEV', 'Kunde 2 A/S — UAT', 'Ærø Færgefart', 'Brødrene (DK) & Co'])
    ok({ name });
});

test('tegn der bryder en sti eller cmd.exe afvises, og fejlen siger hvilket', () => {
  for (const c of ['<', '>', ':', '"', '\\', '|', '?', '*', '%', '!', '^', '`', '$', "'"])
    nej({ name: `Kunde${c}Test` }, new RegExp('tegnet ' + c.replace(/[\\^$*?|]/g, '\\$&')));
  nej({ name: 'Kunde\tTest' }, /kontroltegn/);
});

test('navnet må ikke være tomt, for langt eller et Windows-navn', () => {
  nej({ name: '' }, /tomt/);
  nej({ name: 'x'.repeat(61) }, /60 tegn/);
  nej({ name: 'CON' }, /reserveret/);
  nej({ name: 'nul' }, /reserveret/);
  nej({ name: '.skjult' }, /punktum/);
  nej({ name: 'Kunde.' }, /punktum/);
  nej({ name: 'import_x' }, /import_/);
});

test('to navne der giver samme mappe, afvises', () => {
  // Windows skelner ikke store og små bogstaver, og "/" bliver til "_".
  const andre = [{ name: 'Demo A/S' }];
  nej({ name: 'Demo A/S' }, /findes allerede/, andre);
  nej({ name: 'demo a/s' }, /dele eksportmappe/, andre);
  nej({ name: 'Demo A_S' }, /dele eksportmappe/, andre);
  ok({ name: 'Demo A/S 2' }, andre);
});

test('præfikset må kun bestå af A-Z, 0-9, _ og -', () => {
  for (const prefix of ['', 'DEV_', 'UAT-', 'T2_']) ok({ prefix });
  for (const prefix of ['DEV ', 'DÆV_', 'DEV.', 'x'.repeat(21)]) nej({ prefix });
});

test('Client ID skal være et GUID, og regionen en kendt', () => {
  ok({ clientId: '71d78538-f7a1-400f-872f-50ff40d38357', region: 'mypurecloud.de' });
  nej({ clientId: 'x' }, /GUID/);
  nej({ clientId: '71d78538-f7a1-400f-872f-50ff40d38357 ' }, /GUID/);
  nej({ region: 'evil.example.com' }, /region/);
});

test('deploy-rettigheder skal have formen domæne:entitet:handling', () => {
  ok({ deployPermission: 'architect:flow:publish, architect:*:*' });
  ok({ deployPermission: '' });
  nej({ deployPermission: 'architect:flow' }, /domæne:entitet:handling/);
});

test('kunde, gruppe, org-navn og deploy-gruppe har hver deres grænse', () => {
  nej({ tenant: 'x'.repeat(41) }, /Kunde/);
  nej({ group: 'DE%' }, /Gruppe/);
  nej({ orgLabel: 'a|b' }, /Org-navn/);
  ok({ deployGroup: 'Prod Deployers (DK)' });
  nej({ deployGroup: 'a\nb' }, /kontroltegn/);
});

test('PUT tager kun imod felter der kan redigeres', () => {
  // "demo": true ville få prod-vagten til at se bort fra miljøet.
  for (const k of ['demo', 'id', 'clientSecret']) assert.ok(!s.EDITABLE_FIELDS.includes(k), k);
});

test('miljøets farve skal være en af de kendte', () => {
  // Navne, ikke hex-koder — så farven følger temaet og ikke kan bære HTML ind.
  for (const c of ['', 'green', 'yellow', 'orange', 'red', 'blue', 'grey']) ok({ color: c });
  nej({ color: 'pink' }, /Ukendt farve/);
  nej({ color: 'red;background:url(x)' }, /Ukendt farve/);
});
