// Scripts og user prompts kan migreres — både fra fanen på Data Actions-siden
// og som afhængighed, når et flow der bruger dem, flyttes. Før stod de begge
// som "skal oprettes manuelt" i dialogen, selv om prompts allerede kunne kopieres.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('scripter-importen går til apps.<region>, ikke api.<region>', () => {
  assert.equal(s.appsBaseOf('https://api.mypurecloud.de'), 'https://apps.mypurecloud.de');
  assert.equal(s.appsBaseOf('https://api.euw2.pure.cloud'), 'https://apps.euw2.pure.cloud');
});

test('prompts og scripts kan migreres med flowet', () => {
  assert.deepEqual([...s.COPYABLE_KINDS].sort(), ['prompt', 'script']);
  // Kilden slås op, og findes de dér, kan de vælges i dialogen
  const prep = SERVER.slice(SERVER.indexOf('async function analyzeFlowForMigration('), SERVER.indexOf("app.post('/api/migrate/check'"));
  assert.match(prep, /COPYABLE_KINDS\.has\(r\.kind\)\) \{\s*if \(inSource\[r\.kind\]\?\.has\(r\.name\)\) r\.canMigrate = true;/);
});

test('dialogen sender prompts og scripts til deres egne endpoints', () => {
  const fn = HTML.slice(HTML.indexOf('async function migrateOneDep('), HTML.indexOf('// ── User prompts'));
  assert.match(fn, /prompt:\s*\['\/api\/prompts\/migrate',\s*\{ promptName: dep\.name \}\]/);
  assert.match(fn, /script:\s*\['\/api\/scripts\/migrate',\s*\{ scriptName: dep\.name \}\]/);
});

test('et script publiceres kun i målet, hvis det er publiceret i kilden', () => {
  const route = SERVER.slice(SERVER.indexOf("app.post('/api/scripts/migrate'"), SERVER.indexOf('// ── Helpers'));
  assert.ok(route.length > 200, 'ruten findes ikke');
  const publish = route.indexOf('/api/v2/scripts/published`, { scriptId');
  assert.ok(publish > 0, 'scriptet publiceres aldrig');
  const guard = route.lastIndexOf('if (srcPublished) {', publish);
  assert.ok(guard > 0 && publish - guard < 120, 'publiceringen skal stå inden for if (srcPublished)');
  // Findes det i målet, skrives der ikke
  assert.ok(route.indexOf("'already_exists'") < route.indexOf('/uploads/v2/scripter'));
});

test('Kør Migration står over flowlisten', () => {
  const run = HTML.indexOf('id="m-runBtn"');
  const list = HTML.indexOf('<div id="m-flowList"></div>');
  assert.ok(run > 0 && list > 0);
  assert.ok(run < list, 'knappen skal stå før listen, så den kan nås med hundredvis af flows');
});

test('fanen Scripts findes og vises med sit kort', () => {
  assert.ok(HTML.includes(`id="da-tab-scripts" onclick="daSetTab('scripts')"`));
  assert.ok(HTML.includes(`document.getElementById('da-script-card').style.display = (tab === 'scripts' && srcPicked)`));
});
