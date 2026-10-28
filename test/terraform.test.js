// Terraform-generatoren: ren kode, så alt kan afprøves uden netværk. Testen holder
// fast i de regler, der gør opsætningen sikker at give til en kunde: citering,
// referencer der peger på noget der findes, og ingen hemmeligheder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const tf = require('../terraform.js');

const rod = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(rod, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(rod, 'public', 'index.html'), 'utf8');

const DATA = {
  divisions: [{ id: 'd1', name: 'DK Support' }, { id: 'h', name: 'Home', homeDivision: true }],
  skills: [{ id: 's1', name: 'Dansk' }, { id: 's2', name: 'Dansk' }],
  schedules: [{ id: 'sc1', name: 'Åbent', start: '2026-01-01T08:00:00.000', end: '2026-01-01T16:00:00.000', rrule: 'FREQ=DAILY', division: { id: 'd1' } }],
  schedulegroups: [{ id: 'sg1', name: 'Hoved', timeZone: 'Europe/Copenhagen', openSchedules: [{ id: 'sc1' }] }],
  queues: [{ id: 'q1', name: 'Salg "A"', division: { id: 'd1' }, mediaSettings: { call: { alertingTimeoutSeconds: 30, serviceLevel: { percentage: 0.8, durationMs: 20000 } } } }],
  roles: [{ id: 'r1', name: 'Admin', default: true }, { id: 'r2', name: 'Egen', permissionPolicies: [{ domain: 'routing', entityName: 'queue', actionSet: ['view'] }] }],
  oauth: [{ id: 'o1', name: 'Klient', authorizedGrantType: 'CLIENT-CREDENTIALS', roleDivisions: [{ roleId: 'r1', divisionId: '*' }] }],
  prompts: [{ id: 'p1', name: 'Hilsen', resources: [{ language: 'da-dk', ttsString: 'Goddag ${navn}' }, { language: 'en-us', mediaUri: 'x' }] }],
  integrations: [{ id: 'i1', name: 'Web', integrationType: { id: 'custom-rest-actions' }, intendedState: 'ENABLED' }],
  actions: [{ id: 'custom_1', name: 'Slå op', category: 'Web', integrationId: 'i1', secure: false,
    config: { request: { requestType: 'GET', requestUrlTemplate: 'https://x/${input.id}' }, response: { successTemplate: '{}' } },
    contract: { input: { inputSchema: { $schema: 'x', type: 'object', properties: { id: { type: 'string' } } } }, output: { successSchema: { type: 'object', properties: {} } } } }],
};
const build = (extra = {}) => tf.build(DATA, { lookup: { roles: DATA.roles, divisions: DATA.divisions }, orgName: 'Falck Global', lang: 'da', ...extra });

test('tekst citeres, så en værdi ikke kan bryde ud af strengen eller blive til interpolation', () => {
  assert.equal(tf.hclString('a"b'), '"a\\"b"');
  assert.equal(tf.hclString('a\\b'), '"a\\\\b"');
  assert.equal(tf.hclString('linje\n2'), '"linje\\n2"');
  assert.equal(tf.hclString('hej ${navn}'), '"hej $${navn}"');
  assert.equal(tf.hclString('50%{x}'), '"50%%{x}"');
});

test('lokale navne er gyldige og unikke, også med æøå og dubletter', () => {
  const used = new Set();
  assert.equal(tf.localName('Åbent & Lukket!', used), 'aabent_lukket');
  assert.equal(tf.localName('Åbent & Lukket!', used), 'aabent_lukket_2');
  assert.equal(tf.localName('123', new Set()), 'r_123');
  assert.equal(tf.localName('', new Set()), 'objekt');
});

test('datoer får seks decimaler og ingen tidszone, som provideren vil have dem', () => {
  assert.equal(tf.tfDateTime('2026-01-01T08:00:00.000'), '2026-01-01T08:00:00.000000');
  assert.equal(tf.tfDateTime('2026-01-01T08:00:00Z'), '2026-01-01T08:00:00.000000');
  assert.equal(tf.tfDateTime('2026-01-01T08:00:00.123+01:00'), '2026-01-01T08:00:00.123000');
});

test('en ressource skrives som HCL, med referencer i stedet for id\'er', () => {
  const r = build();
  const q = r.files['queues.tf'];
  assert.match(q, /resource "genesyscloud_routing_queue" "salg_a" \{/);
  assert.match(q, /name\s+= "Salg \\"A\\""/);
  assert.match(q, /division_id\s+= genesyscloud_auth_division\.dk_support\.id/);
  assert.match(q, /media_settings_call \{/);
  assert.match(r.files['schedule_groups.tf'], /open_schedules_id = \[genesyscloud_architect_schedules\.aabent\.id\]/);
});

test('Home og standardroller får en data-kilde — ikke en reference til en ressource der ikke oprettes', () => {
  const r = build();
  assert.doesNotMatch(r.files['divisions.tf'], /Home/);
  assert.doesNotMatch(r.files['roles.tf'], /Admin/);
  assert.match(r.files['oauth_clients.tf'], /role_id\s+= data\.genesyscloud_auth_role\.role_admin\.id/);
  assert.match(r.files['data.tf'], /data "genesyscloud_auth_role" "role_admin" \{\s+name = "Admin"/);
  const all = Object.values(r.files).join('\n');
  assert.doesNotMatch(all, /genesyscloud_auth_role\.admin\b/, 'ingen reference til den udeladte standardrolle');
});

test('en division der ikke er med, bliver en variabel som i providerens egen eksport', () => {
  const r = build({ include: ['queues'] });          // divisioner er ikke med
  assert.doesNotMatch(r.files['queues.tf'], /genesyscloud_auth_division\./);
  assert.match(r.files['queues.tf'], /division_id\s+= var\.division_dk_support_id/);
  assert.match(r.files['variables.tf'], /variable "division_dk_support_id" \{/);
  assert.match(r.files['terraform.tfvars'], /division_dk_support_id = ""/);
  assert.match(r.files['README.md'], /division_dk_support_id/);
  assert.equal(build().files['terraform.tfvars'], undefined, 'ingen variabler når alt er med');
});

test('en wrap-up-kode for alle divisioner (*) får ingen division_id og ingen bemærkning', () => {
  const r = tf.build({ wrapup: [{ id: 'w', name: 'Do Not Call', division: { id: '*' } }] }, { include: ['wrapup'], lookup: { divisions: [] } });
  assert.doesNotMatch(r.files['wrapup_codes.tf'], /division_id/);
  assert.deepEqual(r.notes, []);
});

test('en data action uden sin integration udelades, og det står i rapporten', () => {
  const r = build({ include: ['actions'] });
  assert.equal(r.files['data_actions.tf'], undefined);
  assert.match(r.summary.find(s => s.id === 'actions').skipped[0].reason, /Integrationer/);
});

test('kontrakter bliver til jsonencode og mister kildens $schema', () => {
  const a = build().files['data_actions.tf'];
  assert.match(a, /contract_input\s+= jsonencode\(/);
  assert.doesNotMatch(a, /\$schema/);
  assert.match(a, /request_url_template\s+= "https:\/\/x\/\$\{input\.id\}"/.test(a) ? /x/ : /request_url_template\s+= "https:\/\/x\/\$\$\{input\.id\}"/);
});

test('ingen hemmeligheder følger med, og lyd uden tekst udelades', () => {
  const r = build();
  // Opsætningens egne filer nævner provider-variablen oauthclient_secret; objekterne gør ikke
  const infra = ['provider.tf', 'variables.tf', 'terraform.tfvars.example', 'README.md'];
  const all = Object.entries(r.files).filter(([f]) => !infra.includes(f)).map(([, v]) => v).join('\n');
  assert.doesNotMatch(all, /client_secret\s*=|clientSecret|password|token/i);
  assert.match(r.files['oauth_clients.tf'], /secret kopieres aldrig/);
  assert.match(r.files['user_prompts.tf'], /tts_string\s+= "Goddag \$\$\{navn\}"/);
  assert.equal((r.files['user_prompts.tf'].match(/resources \{/g) || []).length, 1, 'kun TTS-ressourcen er med');
  assert.ok(r.notes.some(n => /indspillet lyd/.test(n)));
});

test('opsætningen har provider, variabler og en README der siger hvad der ikke er med', () => {
  const r = build();
  for (const f of ['versions.tf', 'provider.tf', 'variables.tf', 'terraform.tfvars.example', 'README.md', '.gitignore'])
    assert.ok(r.files[f], f);
  assert.match(r.files['provider.tf'], /oauthclient_secret = var\.oauthclient_secret/);
  assert.match(r.files['versions.tf'], /required_version = ">= 1\.0\.0"/);
  assert.match(r.files['versions.tf'], /version\s+= ">= 1\.6\.0"/);
  assert.match(r.files['variables.tf'], /variable "oauthclient_id" \{[^}]*default\s+= null/, 'tom = miljøvariablerne');
  assert.match(r.files['README.md'], /GENESYSCLOUD_OAUTHCLIENT_SECRET/);
  assert.match(r.files['variables.tf'], /variable "oauthclient_secret" \{[^}]*sensitive\s+= true/);
  assert.match(r.files['versions.tf'], /mypurecloud\/genesyscloud/);
  assert.match(r.files['README.md'], /Det der ikke er med/);
  assert.match(r.files['.gitignore'], /terraform\.tfvars/);
  assert.match(r.files['README.md'], /Falck Global/);
});

test('kun de valgte typer skrives', () => {
  const r = build({ include: ['skills'] });
  assert.ok(r.files['skills.tf']);
  assert.equal(r.files['queues.tf'], undefined);
  assert.deepEqual(r.summary.map(s => s.id), ['skills']);
});

test('flows peger på YAML-filer i architect_flows/, og en type der ikke kunne læses står i rapporten', () => {
  const r = tf.build({}, { lang: 'da', include: ['flows', 'queues'], errors: { queues: 'HTTP 403' }, flows: [{ name: 'Velkomst', file: 'Velkomst_v2-0.yaml' }] });
  assert.match(r.files['flows.tf'], /filepath = "\$\{path\.module\}\/architect_flows\/Velkomst_v2-0\.yaml"/);
  assert.equal(r.summary.find(s => s.id === 'queues').error, 'HTTP 403');
  assert.match(r.files['README.md'], /kunne ikke læses: HTTP 403/);
});

test('hver type har en liste, en fil og en ressourcetype fra genesyscloud-provideren', () => {
  const ids = new Set();
  for (const k of tf.KINDS) {
    assert.ok(!ids.has(k.id), 'dublet ' + k.id); ids.add(k.id);
    assert.match(k.type, /^genesyscloud_[a-z_]+$/, k.id);
    assert.match(k.file, /\.tf$/, k.id);
    assert.match(k.list, /^\/api\/v2\//, k.id);
    assert.equal(typeof k.map, 'function', k.id);
  }
  assert.ok(ids.size >= 22, 'alle objekttyper er med');
});

test('serveren skriver kun lokalt, og mappen er holdt ude af git', () => {
  const start = SERVER.indexOf("app.post('/api/terraform/generate'");
  const body = SERVER.slice(start, SERVER.indexOf('\n});\n', start));
  assert.doesNotMatch(body, /axios\.(post|put|patch|delete)/, 'ingen skrivning til en org');
  assert.match(body, /safeFileName\(name/, 'filnavne renses');
  assert.match(fs.readFileSync(path.join(rod, '.gitignore'), 'utf8'), /^terraform\/$/m);
});

test('fanen har tekst på alle seks sprog', () => {
  for (const k of ['da_tab_terraform', 'tf_title', 'tf_run', 'tf_all', 'tf_none', 'tf_intro', 'tf_target_hint', 'tf_note', 'tf_need_source', 'tf_need_kind', 'tf_running', 'tf_done',
    'tf_saved_in', 'tf_copy_path', 'tf_files', 'tf_col_written', 'tf_unreadable', 'tf_skipped', 'tf_notes'])
    assert.equal(HTML.split(k + ':').length - 1, 6, k);
});

test('filerne følger appens sprog: dansk, engelsk og tysk — andre sprog får engelsk', () => {
  const da = build({ lang: 'da' }), en = build({ lang: 'en' }), de = build({ lang: 'de' }), fr = build({ lang: 'fr' });
  assert.match(da.files['README.md'], /Det der ikke er med/);
  assert.match(en.files['README.md'], /What is not included/);
  assert.match(de.files['README.md'], /Was nicht enthalten ist/);
  assert.match(fr.files['README.md'], /What is not included/, 'fransk falder tilbage på engelsk');
  assert.match(en.files['oauth_clients.tf'], /client secret is never copied/);
  assert.doesNotMatch(en.files['oauth_clients.tf'], /kopieres aldrig/);
  assert.match(de.files['variables.tf'], /Ziel-Org/);
  assert.ok(en.notes.every(n => !/ikke med|er ikke/.test(n)), 'engelske bemærkninger');
  assert.ok(en.summary.flatMap(s => s.skipped).every(x => !/findes i enhver|ikke med/.test(x.reason)));
});

test('README og provider nævner både kilde og mål, og målets region bliver standard', () => {
  const r = build({ targetName: 'Falck US', targetRegion: 'mypurecloud.de' });
  assert.match(r.files['README.md'], /^# Terraform-opsætning — Falck Global → Falck US/m);
  assert.match(r.files['README.md'], /\*\*Fra:\*\* Falck Global/);
  assert.match(r.files['README.md'], /\*\*Til:\*\* Falck US \(`aws_region = eu-central-1`\)/);
  assert.match(r.files['variables.tf'], /variable "aws_region" \{[^}]*default\s+= "eu-central-1"/);
  assert.match(r.files['terraform.tfvars.example'], /aws_region\s+= "eu-central-1"/);
  assert.match(build().files['variables.tf'], /variable "aws_region" \{[^}]*default\s+= null/);
  assert.equal(tf.awsRegion('mypurecloud.ie'), 'eu-west-1');
  assert.equal(tf.awsRegion('ukendt'), null);
});

test('mappen hedder <fra>_<til>, når der er valgt et mål', () => {
  const start = SERVER.indexOf("app.post('/api/terraform/generate'");
  const body = SERVER.slice(start, SERVER.indexOf('\n});\n', start));
  assert.match(body, /part\(source\.name\) \+ \(target \? '_' \+ part\(target\.name\) : ''\)/);
  assert.match(body, /c\.id !== source\.id/, 'målet må ikke være kilden');
  assert.match(body, /TERRAFORM\.FLOW_DIR/);
});
