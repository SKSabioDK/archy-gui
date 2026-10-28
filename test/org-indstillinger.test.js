// Org-indstillinger: sammenligningen læser kun, og migreringen skriver kun
// statusser og standardsprog/-land. Alt andet — IP-lister, tilladte domæner,
// login — kan ikke skrives herfra.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const ok = data => ({ ok: true, data });

test('en status vises med sit navn, ellers sin engelske tekst', () => {
  assert.equal(s.presenceLabel({ name: 'Frokost', languageLabels: { en_US: 'Lunch' } }), 'Frokost');
  assert.equal(s.presenceLabel({ languageLabels: { da: 'Møde', en_US: 'Meeting' } }), 'Meeting');
  assert.equal(s.presenceLabel({ languageLabels: { da: 'Møde' } }), 'Møde');
  assert.equal(s.presenceLabel(null), '');
});

test('de primære statuser migreres ikke — de findes i enhver org', () => {
  assert.equal(s.presenceKeep({ primary: true, systemPresence: 'Available' }), false);
  assert.equal(s.presenceKeep({ primary: false, systemPresence: 'Break' }), true);
});

test('en ny status får kun det, der hører til den — ikke id, ejer eller tidspunkter', () => {
  const body = s.presenceCreateBody({ id: 'x', selfUri: '/y', createdBy: { id: 'u' }, createdDate: 'd', modifiedDate: 'd',
    languageLabels: { en_US: 'Lunch' }, systemPresence: 'Break', deactivated: false, primary: false });
  assert.deepEqual(body, { languageLabels: { en_US: 'Lunch' }, systemPresence: 'Break', deactivated: false });
});

test('sprog skrives ved at rette ét felt på målets egen organisation', () => {
  const me = { id: 'o', name: 'Mål A/S', defaultLanguage: 'en-US', defaultCountryCode: 'US', selfUri: '/api/v2/organizations/me', version: 3 };
  const body = s.languagePutBody(me, 'defaultLanguage', 'da-DK');
  assert.equal(body.defaultLanguage, 'da-DK');
  assert.equal(body.name, 'Mål A/S', 'navnet røres ikke');
  assert.equal(body.version, 3);
  assert.equal(body.selfUri, undefined);
  assert.equal(me.defaultLanguage, 'en-US', 'originalen ændres ikke');
});

test('kun sprog og land kan skrives — ikke navn eller andet', () => {
  for (const key of ['name', 'domain', 'state', 'integrationWhiteList'])
    assert.throws(() => s.languagePutBody({}, key, 'x'), /may not be changed/, key);
});

test('sammenligningen skelner ens, forskellig, mangler og kun i mål', () => {
  const src = {
    presence: ok({ entities: [
      { languageLabels: { en_US: 'Lunch' }, systemPresence: 'Break' },
      { languageLabels: { en_US: 'Coaching' }, systemPresence: 'Meeting' },
      { languageLabels: { en_US: 'Training' }, systemPresence: 'Busy' },
      { primary: true, languageLabels: { en_US: 'Available' }, systemPresence: 'Available' }] }),
    me: ok({ defaultLanguage: 'da-DK', defaultCountryCode: 'DK', supportedLanguages: ['da', 'en'] }),
    embedded: ok({ integrationWhiteList: ['a.dk'] }), whitelist: ok({ enabled: false }),
  };
  const tgt = {
    presence: ok({ entities: [
      { languageLabels: { en_US: 'Lunch' }, systemPresence: 'Break' },
      { languageLabels: { en_US: 'Coaching' }, systemPresence: 'Busy' },
      { languageLabels: { en_US: 'Old' }, systemPresence: 'Away' }] }),
    me: ok({ defaultLanguage: 'en-US', defaultCountryCode: 'DK', supportedLanguages: ['en', 'da'] }),
    embedded: ok({ integrationWhiteList: ['a.dk'] }), whitelist: ok({ enabled: true }),
  };
  const rows = s.orgSettingRows(src, tgt);
  const by = (sec, item) => rows.find(r => r.section === sec && r.item === item);
  assert.equal(by('presence', 'Lunch').status, 'same');
  assert.equal(by('presence', 'Coaching').status, 'differs');
  assert.equal(by('presence', 'Training').status, 'missing');
  assert.equal(by('presence', 'Training').migratable, true);
  assert.equal(by('presence', 'Old').status, 'extra');
  assert.equal(by('presence', 'Available'), undefined, 'primære statuser er ikke med');
  assert.equal(by('language', 'defaultLanguage').status, 'differs');
  assert.equal(by('language', 'defaultLanguage').migratable, true);
  assert.equal(by('language', 'defaultCountryCode').status, 'same');
  assert.equal(by('language', 'defaultCountryCode').migratable, false);
  assert.equal(by('language', 'supportedLanguages').migratable, false);
  assert.equal(by('whitelist', 'whitelist').status, 'differs');
  assert.equal(by('whitelist', 'whitelist').migratable, false, 'IP-lister kan ikke skrives herfra');
  assert.equal(by('embedded', 'integrationWhiteList').migratable, false);
});

test('et område der ikke kan læses, står som det — ikke som ens', () => {
  const bad = { ok: false, error: 'HTTP 403' };
  const good = { presence: ok({ entities: [] }), me: ok({}), embedded: ok({}), whitelist: ok({}) };
  const rows = s.orgSettingRows({ ...good, presence: bad, whitelist: bad }, good);
  assert.equal(rows.filter(r => r.status === 'unreadable').length, 2);
  assert.ok(rows.filter(r => r.status === 'unreadable').every(r => r.detail === 'HTTP 403' && !r.migratable));
});

test('serverens skrivninger er afgrænset, og ruten står bag prod-vagten', () => {
  assert.equal(s.PROD_WRITE_ROUTES['/api/orgsettings/migrate'], 'targetId');
  const start = SERVER.indexOf("app.post('/api/orgsettings/migrate'");
  const body = SERVER.slice(start, SERVER.indexOf('\n});\n', start));
  const writes = [...body.matchAll(/axios\.(post|put|patch|delete)\(`\$\{tb\}([^`]+)`/g)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(writes.sort(), ['post /api/v2/presencedefinitions', 'put /api/v2/organizations/me']);
  const cmp = SERVER.slice(SERVER.indexOf("app.get('/api/orgsettings/compare'"), start);
  assert.doesNotMatch(cmp, /axios\.(post|put|patch|delete)/, 'sammenligningen skriver intet');
});

test('fanen har tekst på alle seks sprog og er koblet til migreringsrapporten', () => {
  for (const k of ['da_tab_orgset', 'os_title', 'os_intro', 'os_note', 'os_run', 'os_migrate', 'os_only_diff', 'os_none', 'os_confirm', 'os_running', 'os_need_orgs',
    'os_col_section', 'os_col_item', 'os_col_src', 'os_col_tgt', 'os_col_status', 'os_sec_presence', 'os_sec_language', 'os_sec_embedded', 'os_sec_whitelist',
    'os_st_same', 'os_st_differs', 'os_st_missing', 'os_st_extra', 'os_st_unreadable',
    'os_i_defaultLanguage', 'os_i_defaultCountryCode', 'os_i_supportedLanguages', 'os_i_integrationWhiteList', 'os_i_whitelist'])
    assert.equal(HTML.split(k + ':').length - 1, 6, k);
  const f = HTML.slice(HTML.indexOf('async function osMigrate()'), HTML.indexOf('// ── Totaltjek af data actions'));
  assert.match(f, /migStart\('da_tab_orgset'/);
  assert.match(f, /migEnd\(\)/);
  assert.match(f, /migRec\(/);
  assert.match(f, /confirm\(msg\)/, 'bekræftelse før der skrives');
});
