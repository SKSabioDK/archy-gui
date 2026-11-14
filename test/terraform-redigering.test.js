// Terraform-fanen (v1.82): fuld eksport med Genesys' eksportør, redigering af
// ressourcer og filer, plan og apply. Testene holder fast i det, der gør det
// sikkert at rette i kundens filer og køre mod en org:
//   · en rettelse ændrer kun det felt den handler om — resten af filen står
//   · GUI'en kan kun nå filer i arbejdsmappen, aldrig state eller provider
//   · apply kører kun den plan brugeren har set, og står bag prod-vagten
//   · tokenet står aldrig i en fil eller i loggen

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HCL = require('../src/terraform-hcl.js');
const { kilde } = require('./kilde.js');

const KOE = `# Kø til dansk support
resource "genesyscloud_routing_queue" "support_dk" {
  name           = "Support \${var.land}"  # med kode
  description    = "Dansk { support }"
  acw_timeout_ms = 300000
  skill_ids = [
    genesyscloud_routing_skill.dansk.id,
  ]
  media_settings_call {
    alerting_timeout_sec = 8
  }
  # en kommentar i blokken
  doc = <<EOT
klammer } { i en heredoc
EOT
}

resource "genesyscloud_routing_skill" "dansk" {
  name = "Dansk"
}
`;

// ── Læsning ──────────────────────────────────────────────────────────────────

test('ressourcerne findes, også med klammer i strenge, heredocs og kommentarer', () => {
  const r = HCL.resources(KOE);
  assert.deepEqual(r.map(x => `${x.type}.${x.name}`), ['genesyscloud_routing_queue.support_dk', 'genesyscloud_routing_skill.dansk']);
  const e = Object.fromEntries(r[0].entries.map(x => [x.id, x]));
  assert.deepEqual(Object.keys(e), ['name', 'description', 'acw_timeout_ms', 'skill_ids', 'media_settings_call#1', 'doc']);
  assert.equal(e.name.literal, undefined, 'en streng med ${…} er kode, ikke tekst');
  assert.deepEqual(e.description.literal, { type: 'string', value: 'Dansk { support }' });
  assert.deepEqual(e.acw_timeout_ms.literal, { type: 'number', value: 300000 });
  assert.equal(e['media_settings_call#1'].kind, 'block');
  assert.match(e.doc.raw, /^<<EOT\n.*\nEOT$/s);
});

test('$${ og \\" læses som tegn', () => {
  assert.equal(HCL.decodeString('"pris $${belob} og \\"citat\\""'), 'pris ${belob} og "citat"');
  assert.equal(HCL.decodeString('"${var.x}"'), null);
  assert.equal(HCL.decodeString('var.x'), null);
});

// ── Rettelser ────────────────────────────────────────────────────────────────

test('en rettelse ændrer kun feltet — kommentarer og resten af filen står', () => {
  const ud = HCL.editResource(KOE, 'genesyscloud_routing_queue', 'support_dk', {
    set: { description: { string: 'Ny "tekst" med ${kode}' }, acw_timeout_ms: { number: '60000' } } });
  assert.match(ud, /description    = "Ny \\"tekst\\" med \$\$\{kode\}"/, 'citeres som HCL — ${ bliver $${');
  assert.match(ud, /acw_timeout_ms = 60000/);
  for (const urort of ['# Kø til dansk support', '"Support ${var.land}"  # med kode', '# en kommentar i blokken',
    'klammer } { i en heredoc', 'resource "genesyscloud_routing_skill" "dansk"'])
    assert.ok(ud.includes(urort), urort);
  assert.equal(HCL.editResource(KOE, 'genesyscloud_routing_queue', 'support_dk', {}), KOE);
});

test('felter kan fjernes og tilføjes, og blokke erstattes eller tilføjes', () => {
  const ud = HCL.editResource(KOE, 'genesyscloud_routing_queue', 'support_dk', {
    remove: ['acw_timeout_ms', 'doc'],
    set: { enable_transcription: { bool: true }, 'media_settings_call#1': { raw: 'media_settings_call {\n  alerting_timeout_sec = 12\n}' } },
    add: ['bullseye_rings {\n  expansion_timeout_seconds = 5\n}'] });
  assert.ok(!ud.includes('acw_timeout_ms') && !ud.includes('heredoc'));
  assert.match(ud, /\n  enable_transcription = true/);
  assert.match(ud, /\n  media_settings_call \{\n    alerting_timeout_sec = 12\n  \}/);
  assert.match(ud, /\n  bullseye_rings \{\n    expansion_timeout_seconds = 5\n  \}\n\}/);
  const r = HCL.resources(ud)[0];
  assert.deepEqual(r.entries.map(e => e.id).sort(),
    ['bullseye_rings#1', 'description', 'enable_transcription', 'media_settings_call#1', 'name', 'skill_ids']);
});

test('en blok skal være præcis én blok med det rigtige navn', () => {
  const ret = raw => () => HCL.editResource(KOE, 'genesyscloud_routing_queue', 'support_dk', { set: { 'media_settings_call#1': { raw } } });
  assert.throws(ret('anden_blok {\n}'));
  assert.throws(ret('media_settings_call {\n}\n}\nresource "x" "y" {'), /én|one/i);
  assert.throws(() => HCL.editResource(KOE, 'genesyscloud_routing_queue', 'support_dk', { set: { 'ikke gyldigt': { raw: '1' } } }));
});

test('ny ressource tilføjes sidst, og samme navn to gange afvises', () => {
  const ud = HCL.addResource(KOE, 'genesyscloud_routing_wrapupcode', 'klage', [['name', { string: 'Klage' }]], []);
  assert.ok(ud.startsWith(KOE.trimEnd()));
  assert.match(ud, /resource "genesyscloud_routing_wrapupcode" "klage" \{\n  name = "Klage"\n\}\n$/);
  assert.throws(() => HCL.addResource(KOE, 'genesyscloud_routing_skill', 'dansk', []), /already exists/);
  assert.throws(() => HCL.newResourceText('genesyscloud_x', '1navn'), /Invalid name/);
  assert.throws(() => HCL.newResourceText('Genesys X', 'navn'), /Invalid resource type/);
});

test('en slettet ressource tager sin kommentar med og lader resten stå', () => {
  const ud = HCL.removeResource(KOE, 'genesyscloud_routing_queue', 'support_dk');
  assert.ok(!ud.includes('Kø til dansk support') && !ud.includes('support_dk'));
  assert.equal(HCL.resources(ud).length, 1);
  assert.throws(() => HCL.removeResource(KOE, 'genesyscloud_routing_queue', 'findes_ikke'), /not found/);
});

test('værdier fra formularen bliver gyldig HCL', () => {
  assert.equal(HCL.encodeValue({ string: 'a\nb "c" %{x}' }), '"a\\nb \\"c\\" %%{x}"');
  assert.equal(HCL.encodeValue({ number: '42.5' }), '42.5');
  assert.throws(() => HCL.encodeValue({ number: 'abc' }));
  assert.throws(() => HCL.encodeValue({ number: '' }));
  assert.equal(HCL.encodeValue({ bool: false }), 'false');
  assert.equal(HCL.encodeValue({ raw: ' genesyscloud_routing_skill.dansk.id ' }), 'genesyscloud_routing_skill.dansk.id');
  assert.throws(() => HCL.encodeValue({ raw: '  ' }));
});

// ── Plan, fejl og eksportør ──────────────────────────────────────────────────

test('planen opsummeres: oprettes, ændres, slettes og erstattes', () => {
  const s = HCL.summarizePlan({ resource_changes: [
    { address: 'a.x', type: 'a', name: 'x', mode: 'managed', change: { actions: ['create'] } },
    { address: 'a.y', type: 'a', name: 'y', mode: 'managed', change: { actions: ['update'], before: { n: 1, m: 2 }, after: { n: 3, m: 2 } } },
    { address: 'a.z', type: 'a', name: 'z', mode: 'managed', change: { actions: ['delete'] } },
    { address: 'a.w', type: 'a', name: 'w', mode: 'managed', change: { actions: ['delete', 'create'] } },
    { address: 'a.v', type: 'a', name: 'v', mode: 'managed', change: { actions: ['no-op'] } },
    { address: 'data.a.d', type: 'a', name: 'd', mode: 'data', change: { actions: ['read'] } },
  ] });
  assert.deepEqual([s.create, s.update, s.delete, s.replace], [1, 1, 1, 1]);
  assert.deepEqual(s.items.map(i => i.action), ['delete', 'replace', 'update', 'create'], 'det farlige står øverst');
  assert.deepEqual(s.items.find(i => i.action === 'update').changed, ['n']);
});

test('antivirus der bryder terraforms forbindelse til provideren, forklares', () => {
  // Sådan så det ud på en pc med Nortons scanning af krypteret trafik
  const norton = 'plugin.(*GRPCProvider).GetProviderSchema: error="rpc error: code = Unavailable desc = connection error: desc = \\"transport: authentication handshake failed: tls: failed to verify certificate: x509: certificate signed by unknown authority\\""';
  assert.equal(HCL.errorHint(norton), 'tls_intercept');
  assert.equal(HCL.errorHint('Error: Saved plan is stale'), 'stale_plan');
  // Uden TF_LOG ses kun at provideren ikke svarede
  assert.equal(HCL.errorHint('Plugin did not respond: The plugin encountered an error'), 'plugin_start');
  assert.equal(HCL.errorHint('alt gik godt'), null);
});

test('eksportøren: state kun for samme org, filtre citeres', () => {
  const samme = HCL.exportMainTf({ includeState: true });
  assert.match(samme, /include_state_file\s+= true/);
  assert.match(samme, /split_files_by_resource\s+= true/);
  assert.match(samme, /export_format\s+= "hcl"/);
  assert.ok(!/include_filter_resources/.test(samme));
  assert.ok(!/oauthclient|secret|token\s*=/i.test(samme), 'login kommer fra miljøvariabler, aldrig fra filen');
  const anden = HCL.exportMainTf({ includeState: false, include: ['genesyscloud_routing_queue', 'genesyscloud_flow::^Support$'] });
  assert.match(anden, /include_state_file\s+= false/);
  assert.match(anden, /include_filter_resources\s+= \["genesyscloud_routing_queue", "genesyscloud_flow::\^Support\$"\]/);
});

test('schemaet til formularerne: rene computed-felter og id udelades', () => {
  const s = HCL.trimSchema({ provider_schemas: { 'registry.terraform.io/mypurecloud/genesyscloud': { resource_schemas: {
    genesyscloud_tf_export: { block: {} },
    genesyscloud_routing_skill: { block: { description: 'Skill', attributes: {
      id: { type: 'string', computed: true }, name: { type: 'string', required: true, description: 'Navn' },
      state: { type: 'string', computed: true }, division_id: { type: 'string', optional: true, computed: true } },
      block_types: { regel: { nesting_mode: 'list', min_items: 1, block: { attributes: { v: { type: 'number', required: true } } } } } } } } } } });
  assert.deepEqual(Object.keys(s.types), ['genesyscloud_routing_skill']);
  assert.deepEqual(Object.keys(s.types.genesyscloud_routing_skill.attrs), ['name', 'division_id']);
  assert.equal(s.types.genesyscloud_routing_skill.attrs.name.required, true);
  assert.equal(s.types.genesyscloud_routing_skill.blocks.regel.example, 'regel {\n  v = 0\n}');
});

// ── Mapper og filer ──────────────────────────────────────────────────────────

test('GUI\'en kan kun nå tekstfiler i arbejdsmappen — aldrig state, plan eller provider', () => {
  const { wsFile } = require('../src/routes/terraform.js')._test;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-ws-'));
  try {
    assert.equal(wsFile(dir, 'main.tf').r, 'main.tf');
    assert.equal(wsFile(dir, 'flows\\support.yaml').r, 'flows/support.yaml');
    for (const ond of ['../x.tf', 'a/../../x.tf', 'C:/x.tf', '.terraform/providers/x.tf', 'terraform.tfstate',
      'terraform.tfstate.backup', 'archy.tfplan', 'workspace.json', '_export/main.tf', 'terraform.exe', ''])
      assert.throws(() => wsFile(dir, ond, { write: true }), undefined, ond);
    assert.throws(() => wsFile(dir, '.terraform.lock.hcl', { write: true }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('en mappe navngives med et gyldigt <org>/<dato> — ellers afvises den', () => {
  const { wsDir } = require('../src/routes/terraform.js')._test;
  for (const ond of ['..', '../..', 'a', 'a/b/c', '.plugin-cache/x', 'a/..', 'a\\b', ''])
    assert.throws(() => wsDir(ond), undefined, ond);
});

// ── Plan og apply mod en org ─────────────────────────────────────────────────

test('apply står bag prod-vagten og kører kun den plan brugeren har set', () => {
  const s = require('../src/server.js');
  assert.equal(s.PROD_WRITE_ROUTES['/api/terraform/apply'], 'targetId');
  const R = kilde('routes/terraform.js');
  const apply = R.slice(R.indexOf("router.post('/api/terraform/apply'"));
  assert.match(apply, /checkBound\(dir, req\.body\.targetId\)/, 'kun mod mappens egen org');
  assert.match(apply, /pm\.hash !== req\.body\.planHash/);
  assert.match(apply, /CLI\.fileHash\(planFile\) !== pm\.hash/);
  assert.match(apply, /\['apply', '-input=false', '-no-color', PLAN_FILE\]/, 'apply af den gemte plan — aldrig -auto-approve');
  // plan kører også kun mod mappens org
  const run = R.slice(R.indexOf("router.post('/api/terraform/run'"), R.indexOf("router.post('/api/terraform/apply'"));
  assert.match(run, /checkBound\(dir, req\.body\.envId\)/);
});

test('terraform får Archy GUI\'s login gennem miljøet, og tokenet vaskes ud af uddata', async () => {
  const CLI = require('../src/lib/terraform-cli.js');
  const gammel = process.env.GENESYSCLOUD_OAUTHCLIENT_SECRET;
  process.env.GENESYSCLOUD_OAUTHCLIENT_SECRET = 'fra-windows';
  try {
    const env = CLI.terraformEnv({ token: 'hemmeligt-token-123', region: 'eu-central-1' });
    assert.equal(env.GENESYSCLOUD_ACCESS_TOKEN, 'hemmeligt-token-123');
    assert.equal(env.GENESYSCLOUD_REGION, 'eu-central-1');
    assert.equal(env.GENESYSCLOUD_OAUTHCLIENT_SECRET, undefined, 'en klient fra Windows\' miljø må ikke svare for en anden org');
    const linjer = [];
    const r = await CLI.runTerraform(process.execPath, ['-e', 'console.log("token: " + process.env.GENESYSCLOUD_ACCESS_TOKEN)'],
      { cwd: os.tmpdir(), env, onLine: l => linjer.push(l) });
    assert.equal(r.code, 0);
    assert.ok(!r.out.includes('hemmeligt-token-123') && !linjer.join().includes('hemmeligt-token-123'));
    assert.ok(linjer.includes('token: ***'));
  } finally {
    if (gammel === undefined) delete process.env.GENESYSCLOUD_OAUTHCLIENT_SECRET; else process.env.GENESYSCLOUD_OAUTHCLIENT_SECRET = gammel;
  }
});

test('README i en fuld eksport forklarer kunden at køre videre selv', () => {
  const { exportReadme } = require('../src/routes/terraform.js')._test;
  const samme = exportReadme('da', 'Kunde DEV', null, true);
  assert.match(samme, /terraform\.tfstate/);
  assert.match(samme, /GENESYSCLOUD_OAUTHCLIENT_ID/);
  assert.match(exportReadme('en', 'A', 'B', false), /creates the objects in B/);
  assert.match(exportReadme('fr', 'A', 'B', false), /Running it yourself/, 'ukendt sprog → engelsk');
});

// ── Brugerfladen ─────────────────────────────────────────────────────────────

test('fanen har fuld eksport, startopsætning, arbejdsmapper og guiden — uden kundenavne', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  for (const id of ['tf-v-export', 'tf-v-quick', 'tf-v-folders', 'tf-cli', 'tf-view']) assert.ok(HTML.includes(`id="${id}"`), id);
  for (const fn of ['tfExport', 'tfOpenWs', 'tfSaveRes', 'tfSaveFile', 'tfRunAction', 'tfApply', 'tfOpenGuide'])
    assert.ok(HTML.includes(`function ${fn}(`), fn);
  // Teksterne i fanen nævner ingen kunde (før stod der "fx fra Falck Global til US")
  const tf = [...HTML.matchAll(/\btf_[a-z_]+:'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]).join('\n');
  assert.ok(!/Falck|Vattenfall|Transcom/i.test(tf));
  const guide = fs.readFileSync(path.join(__dirname, '..', 'public', 'terraform-guide.html'), 'utf8');
  assert.ok(!/id="quiz"|renderQuiz|q_score/.test(guide), 'guiden er uden kontrolspørgsmål');
  assert.match(guide, /\[\?&\]lang=/, 'sproget følger Archy GUI');
  assert.ok(!/Falck|Vattenfall|Transcom/i.test(guide));
});
