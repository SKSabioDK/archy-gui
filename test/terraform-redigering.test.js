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

test('README i en fuld eksport siger om state kom med', () => {
  const { exportReadme } = require('../src/routes/terraform.js')._test;
  assert.match(exportReadme('da', 'Kunde DEV', null, true), /terraform\.tfstate/);
  assert.match(exportReadme('en', 'A', 'B', false), /creates the objects in B/);
  assert.match(exportReadme('fr', 'A', 'B', false), /To another org/, 'ukendt sprog → engelsk');
});

// ── Kundepakken (v1.85.0) ────────────────────────────────────────────────────

test('kundepakken har et sted til client id og secret og scripts til plan og apply', () => {
  const KIT = require('../src/terraform-kit.js');
  const f = KIT.kitFiles({ region: 'eu-west-1' });
  for (const n of KIT.KIT_FILES) assert.ok(f[n], n);
  assert.match(f['login.example.ps1'], /\$env:GENESYSCLOUD_OAUTHCLIENT_ID\s+= ''/);
  assert.match(f['login.example.ps1'], /\$env:GENESYSCLOUD_OAUTHCLIENT_SECRET = ''/);
  assert.match(f['login.example.ps1'], /GENESYSCLOUD_REGION\s+= 'eu-west-1'/, 'regionen følger org\'en');
  assert.match(f['login.example.sh'], /export GENESYSCLOUD_OAUTHCLIENT_SECRET=''/);
  assert.match(f['run.ps1'], /\. \.\\login\.ps1/, 'run.ps1 læser login.ps1');
  assert.match(f['run.ps1'], /terraform plan -input=false '-out=customer\.tfplan'/, 'PowerShell 5.1 deler -out=a.b i to uden anførselstegn');
  for (const [n, text] of Object.entries(f)) assert.ok(/^[\x00-\x7f]*$/.test(text), n + ' er ren ASCII (PowerShell 5.1 læser filer uden BOM som ANSI)');
  assert.match(f['run.ps1'], /terraform apply -input=false customer\.tfplan/, 'apply kun af den gemte plan');
  assert.match(f['run.ps1'], /Remove-Item Env:GENESYSCLOUD_ACCESS_TOKEN/, 'et gammelt token på pc\'en bruges ikke');
  assert.match(f['run.cmd'], /-ExecutionPolicy Bypass -File "%~dp0run\.ps1" %\*/, 'run plan virker fra en kommandoprompt');
  assert.match(f['run.sh'], /STEP="\$\{1:-plan\}"/);
  assert.match(f['run.sh'], /eval "val=\\\$\{\$v:-\}"/);
  assert.match(f['.gitignore'], /^login\.ps1$/m);
  assert.match(f['.gitignore'], /^login\.sh$/m);
  assert.ok(f['run.ps1'].includes('\r\n') && !f['run.sh'].includes('\r'), 'Windows-filer CRLF, sh-filer LF');
});

test('README får kundeafsnittet én gang, også når det skrives igen', () => {
  const KIT = require('../src/terraform-kit.js');
  const once = KIT.withKitReadme('# Terraform — A\n\nTekst.\n', 'da', { region: 'eu-central-1', hasState: true });
  const twice = KIT.withKitReadme(once, 'da', { region: 'eu-west-1', hasState: true });
  assert.equal(twice.split(KIT.KIT_MARK).length, 2, 'kun ét afsnit');
  assert.ok(twice.startsWith('# Terraform — A\n\nTekst.\n'));
  assert.match(twice, /eu-west-1/); assert.doesNotMatch(twice, /eu-central-1/);
  assert.match(twice, /Kør den på din egen pc/);
  assert.match(KIT.withKitReadme('', 'de', {}), /Run it on your own PC/, 'ukendt sprog → engelsk');
  assert.match(KIT.kitReadme('en', { hasState: false }), /first apply creates the objects/);
});

function unzip(buf) {
  const zlib = require('zlib');
  const out = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), crc = buf.readUInt32LE(i + 14), size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), x = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + n).toString('utf8');
    const body = buf.slice(i + 30 + n + x, i + 30 + n + x + size);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    out[name] = { data, crc };
    i += 30 + n + x + size;
  }
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, 'slutposten findes');
  assert.equal(buf.readUInt16LE(buf.length - 12), Object.keys(out).length, 'antal i slutposten');
  return out;
}

test('zip-filen kan pakkes ud igen med samme indhold og kontrolsum', () => {
  const KIT = require('../src/terraform-kit.js');
  const big = Buffer.from('resource "genesyscloud_group" "x" {}\n'.repeat(200));
  const files = unzip(KIT.zip([{ name: 'm/a.tf', data: big }, { name: 'm/æøå.txt', data: 'hej' }, { name: 'm/tom.txt', data: '' }]));
  assert.deepEqual(Object.keys(files), ['m/a.tf', 'm/æøå.txt', 'm/tom.txt']);
  assert.ok(files['m/a.tf'].data.equals(big));
  assert.equal(files['m/æøå.txt'].data.toString(), 'hej');
  assert.equal(files['m/a.tf'].crc, KIT.crc32(big));
});

test('zip til kunden har kundepakken og state, men ikke login, Archy GUI\'s filer eller .terraform', () => {
  const { writeKit, zipEntries } = require('../src/routes/terraform.js')._test;
  const KIT = require('../src/terraform-kit.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfkit-'));
  try {
    const put = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    for (const f of ['main.tf', 'provider.tf', 'terraform.tfvars', 'terraform.tfstate', '.terraform.lock.hcl', 'README.md', 'architect_flows/f.yaml',
      'login.ps1', 'login.sh', 'workspace.json', '.archy-plan.json', 'archy.tfplan', 'customer.tfplan', 'terraform.tfstate.backup',
      'terraform.tfstate.1794678090.backup', 'export_errors.json', '.terraform/providers/p.exe', '_export/x.tf']) put(f);
    writeKit(dir, { region: 'mypurecloud.ie' }, 'da');
    const names = zipEntries(dir, 'Kunde_2026').map(e => e.name);
    for (const ok of ['main.tf', 'provider.tf', 'terraform.tfvars', 'terraform.tfstate', '.terraform.lock.hcl', 'README.md', 'architect_flows/f.yaml', ...KIT.KIT_FILES])
      assert.ok(names.includes('Kunde_2026/' + ok), ok);
    for (const no of ['login.ps1', 'login.sh', 'workspace.json', '.archy-plan.json', 'archy.tfplan', 'customer.tfplan', 'terraform.tfstate.backup',
      'terraform.tfstate.1794678090.backup', 'export_errors.json', '.terraform/providers/p.exe', '_export/x.tf'])
      assert.ok(!names.includes('Kunde_2026/' + no), no);
    assert.equal(fs.readFileSync(path.join(dir, 'login.ps1'), 'utf8'), 'x', 'kundens login.ps1 overskrives aldrig');
    assert.match(fs.readFileSync(path.join(dir, 'login.example.ps1'), 'utf8'), /'eu-west-1'/, 'regionen kommer fra org\'en');
    assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /Kør den på din egen pc/);
    assert.ok(fs.existsSync(path.join(dir, 'versions.tf')), 'uden provider-krav skrives versions.tf');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('provider-kravet genkendes, så en eksports provider.tf ikke får en versions.tf ved siden af', () => {
  const KIT = require('../src/terraform-kit.js');
  assert.ok(KIT.declaresProvider('terraform {\n  required_providers {\n    genesyscloud = {\n      source  = "registry.terraform.io/mypurecloud/genesyscloud"\n      version = "1.88.0"\n    }\n  }\n}\n'));
  assert.ok(KIT.declaresProvider(KIT.VERSIONS_TF));
  assert.ok(!KIT.declaresProvider('resource "genesyscloud_group" "g" {}'));
  assert.ok(!KIT.declaresProvider('required_providers { aws = { source = "hashicorp/aws" } }'));
});

// ── Stop og loggen (v1.82.1) ─────────────────────────────────────────────────

test('Stop dræber også underprocesserne — provideren kørte før videre efter Stop', async () => {
  // Falck Global: Stop dræbte terraform.exe, men provideren eksporterede
  // videre for sig selv og holdt mappen låst (EPERM ved oprydningen).
  const CLI = require('../src/lib/terraform-cli.js');
  const barn = 'const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });' +
    'console.log("barnebarn " + c.pid); setInterval(() => {}, 1000);';
  const ctl = new AbortController();
  let pid = null;
  const kørsel = CLI.runTerraform(process.execPath, ['-e', barn], { cwd: os.tmpdir(), env: process.env,
    signal: ctl.signal, onLine: l => { const m = /barnebarn (\d+)/.exec(l); if (m) { pid = Number(m[1]); ctl.abort(); } } });
  const r = await kørsel;
  assert.equal(r.aborted, true);
  assert.ok(pid, 'barnebarnet startede ikke');
  const lever = p => { try { process.kill(p, 0); return true; } catch (_) { return false; } };
  for (let i = 0; i < 20 && lever(pid); i++) await new Promise(ok => setTimeout(ok, 100));
  assert.equal(lever(pid), false, 'underprocessen kører stadig efter Stop');
});

test('et job der stoppes, ender som stoppet — ikke som fejlet', async () => {
  const CLI = require('../src/lib/terraform-cli.js');
  const job = CLI.startJob('test/stop-' + Date.now(), 'export', async j => {
    if (!j.controller.signal.aborted) await new Promise(ok => j.controller.signal.addEventListener('abort', ok));
    throw new Error('Stopped');
  });
  job.controller.abort();
  for (let i = 0; i < 50 && job.status === 'running'; i++) await new Promise(ok => setTimeout(ok, 10));
  assert.equal(job.status, 'cancelled');
  assert.equal(CLI.jobView(job).status, 'cancelled');
});

test('eksportens log: hjælpe-ressourcens plan skjules, ventelinjer og 403 samles', () => {
  const f = HCL.logFilter({ exportRun: true });
  // Linjer fra en rigtig eksport af Falck Global
  const ud = [
    'Initializing the backend...',
    '- Installed mypurecloud/genesyscloud v1.88.0 (self-signed, key ID 8167A4FEF3EC3F4F)',
    'Partner and community providers are signed by their developers.',
    'Terraform has been successfully initialized!',
    'Terraform used the selected providers to generate the following execution',
    '  + create',
    '  # genesyscloud_tf_export.export will be created',
    '      + include_state_file                 = false',
    'Plan: 1 to add, 0 to change, 0 to destroy.',
    'genesyscloud_tf_export.export: Creating...',
    'genesyscloud_tf_export.export: Still creating... [01m10s elapsed]',
    '2026-11-14T16:53:06.816+0100 [ERROR] provider.terraform-provider-genesyscloud_v1.88.0.exe: Failed to get all guides | error: API Error: 403 - Unable to perform the requested action. You are missing the following permission(s): [aiStudio:guide:view] (6cc2): tf_rpc=ApplyResourceChange',
    '2026-11-14T16:53:06.844+0100 [ERROR] provider.terraform-provider-genesyscloud_v1.88.0.exe: Failed to get task management worktype error: failed to get worktypes: API Error: 403 - Unable to perform the requested action. You must have permission workitems:worktype:view in at least one division. (fab1): x',
    '2026-11-14T16:53:08.674+0100 [ERROR] provider.terraform-provider-genesyscloud_v1.88.0.exe: Failed to get all business rules schemas error: failed: API Error: 403 - Unable to perform the requested action. You must have at least one of the following permissions assigned: [businessrules:businessRulesSchema:view] (7b4e): x',
    '2026-11-14T16:53:09.345+0100 [ERROR] provider.terraform-provider-genesyscloud_v1.88.0.exe: Failed to get task management worktypes: failed to get worktypes: API Error: 403 - You must have permission workitems:worktype:view in at least one division. (dc43): x',
  ].map(f);
  const logget = ud.filter(x => x.log).map(x => x.log);
  assert.deepEqual(logget, ['- Installed mypurecloud/genesyscloud v1.88.0 (self-signed, key ID 8167A4FEF3EC3F4F)', 'Terraform has been successfully initialized!']);
  assert.deepEqual(ud.filter(x => x.elapsed).map(x => x.elapsed), ['01m10s']);
  const sprunget = ud.filter(x => x.skipped).reduce((l, x) => HCL.addSkipped(l, x.skipped), []);
  assert.deepEqual(sprunget.map(x => x.perm), ['aiStudio:guide:view', 'workitems:worktype:view', 'businessrules:businessRulesSchema:view']);
  assert.deepEqual(sprunget[1].what, ['Failed to get task management worktype', 'Failed to get task management worktypes']);
  assert.equal(sprunget[0].what[0], 'Failed to get all guides');
  // Uden for en eksport vises planen — dér er den en rigtig ændring
  assert.deepEqual(HCL.logFilter()('Plan: 3 to add, 0 to change, 0 to destroy.'), { log: 'Plan: 3 to add, 0 to change, 0 to destroy.' });
});

test('listen over sprungne typer: "| Error" og intetsigende tekster ryddes væk', () => {
  // Falck US viste "Failed to get response management response assets | Error"
  // og "Response contains error diagnostic" ved siden af den rigtige type
  const f = HCL.logFilter({ exportRun: true });
  const ass = f('2026-11-14T17:40:01.000+0100 [ERROR] provider.terraform-provider-genesyscloud_v1.88.0.exe: Failed to get response management response assets | Error: API Error: 403 - Unable to perform the requested action. You must have at least one of the following permissions assigned: [responseAssets:asset:view:92a660e1-fc22-4fde-8989-6f702f0f0e6b] (abc): tf_rpc=ApplyResourceChange');
  assert.equal(ass.skipped.what, 'Failed to get response management response assets');
  const koe = f('2026-11-14T17:40:02.000+0100 [ERROR] provider.terraform-provider-genesyscloud_v1.88.0.exe: Response contains error diagnostic: API Error: 403 - You are missing the following permission(s): [queue:identityResolution:view] (def): tf_rpc=x');
  assert.equal(koe.skipped.what, '');
  const liste = HCL.addSkipped(HCL.addSkipped([], koe.skipped), { perm: 'queue:identityResolution:view', what: 'genesyscloud_routing_queue_identity_resolution' });
  assert.deepEqual(liste, [{ perm: 'queue:identityResolution:view', what: ['genesyscloud_routing_queue_identity_resolution'] }]);
});

test('et manglende OAuth-scope stopper eksportøren — typen findes, så den kan udelades', () => {
  // Falck US, ordret som terraform ombrød den
  const ud = `Error: API Error
  on main.tf line 13, in resource "genesyscloud_tf_export" "export":
  13: resource "genesyscloud_tf_export" "export" {
{"resourceType":"genesyscloud_webdeployments_deployment_identity_resolution","method":"GET","path":"/api/v2/webdeployments/deployments","statusCode":403,"errorMessage":"API
Error: 403 - App not authorized to use scope [webdeployments:readonly,
webdeployments]
(66b9b2d4-d832-4cda-a81c-7cd3cab1eaf1)","correlationId":"66b9b2d4-d832-4cda-a81c-7cd3cab1eaf1"}
{"resourceType":"genesyscloud_quality_forms_evaluation","method":"GET","path":"/api/v2/quality/forms","statusCode":403,"errorMessage":"API Error: 403 - You are missing the following permission(s): [quality:evaluationForm:view] (x)","correlationId":"x"}`;
  assert.deepEqual(HCL.exportFailures(ud), [
    { type: 'genesyscloud_webdeployments_deployment_identity_resolution', perm: 'scope webdeployments:readonly', path: '/api/v2/webdeployments/deployments' },
    { type: 'genesyscloud_quality_forms_evaluation', perm: 'quality:evaluationForm:view', path: '/api/v2/quality/forms' }]);
  assert.deepEqual(HCL.exportFailures('Error: something else'), []);
  const R = kilde('routes/terraform.js');
  const exp = R.slice(R.indexOf("router.post('/api/terraform/export'"), R.indexOf('// ── Kørsler'));
  assert.match(exp, /exclude: \[\.\.\.exclude, \.\.\.noScope\]/, 'typen udelades ved næste forsøg');
  assert.match(exp, /forsoeg >= 40/, 'en ukendt fejl kører ikke i ring');
});

test('brugere og grupper udelades aldrig for et opslag i et andet område (voicemail)', () => {
  // Falck US forsøg 7: genesyscloud_group fejlede på gruppens voicemail-politik.
  // Var hele typen blevet udeladt, var alle grupper og brugere forsvundet.
  assert.equal(HCL.isOwnRead('genesyscloud_group', '/api/v2/voicemail/groups/25bd0d19/policy'), false);
  assert.equal(HCL.isOwnRead('genesyscloud_user', '/api/v2/voicemail/userpolicies/6fc18d30'), false);
  assert.equal(HCL.isOwnRead('genesyscloud_webdeployments_deployment_identity_resolution', '/api/v2/webdeployments/deployments'), true);
  assert.equal(HCL.isOwnRead('genesyscloud_telephony_providers_edges_trunk', '/api/v2/telephony/providers/edges/trunks'), true);
  assert.equal(HCL.isOwnRead('genesyscloud_conversations_messaging_integrations_open_identity_resolution', '/api/v2/conversations/messaging/integrations/open'), true);
  assert.equal(HCL.isOwnRead('genesyscloud_group', '/api/v2/groups/1'), true);
  const R = kilde('routes/terraform.js');
  assert.match(R, /const foreign = fails\.filter\(f => !HCL\.isOwnRead\(f\.type, f\.path\)\)/);
});

test('OAuth-klientens scopes tjekkes før eksporten, så alle mangler ses på én gang', () => {
  assert.deepEqual(HCL.missingExportScopes([]), [], 'en klient uden scope-liste begrænser ikke');
  assert.deepEqual(HCL.missingExportScopes(['*']), []);
  const alle = HCL.EXPORT_SCOPES.map(s => s + ':readonly');
  assert.deepEqual(HCL.missingExportScopes(alle), []);
  assert.deepEqual(HCL.missingExportScopes(HCL.EXPORT_SCOPES), [], 'det fulde scope dækker også læsning');
  const uden = HCL.missingExportScopes(alle.filter(s => s !== 'voicemail:readonly' && s !== 'workitems:readonly'));
  assert.deepEqual(uden, ['voicemail:readonly', 'workitems:readonly']);
  const R = kilde('routes/terraform.js');
  const exp = R.slice(R.indexOf("router.post('/api/terraform/export'"), R.indexOf('// ── Kørsler'));
  assert.ok(exp.indexOf('missingClientScopes(') < exp.indexOf('CLI.startJob('), 'tjekket kommer før eksporten starter');
  assert.match(exp, /req\.body\.ignoreScopes !== true/, 'man kan vælge at eksportere alligevel');
});

test('export_errors.json samles pr. scope — typer der helt mangler, står øverst', () => {
  // Udsnit af Falck US' export_errors.json
  const fil = JSON.stringify({
    genesyscloud_user: Array(11).fill({ error_message: 'Failed to read voicemail userpolicies x error: API Error: 403 - App not authorized to use scope [voicemail, voicemail:readonly] (c7c8d05a-2600-44e1-b555-9c8639b0d56c)', resource_id: 'u1' }),
    genesyscloud_group: Array(6).fill({ error_message: 'Failed to read group voicemail policy: API Error: 403 - App not authorized to use scope [voicemail, voicemail:readonly] (x)', resource_id: 'g1' }),
    genesyscloud_task_management_workbin: [{ error_message: 'Failed: API Error: 403 - App not authorized to use scope [workitems:readonly, workitems] (x)', resource_id: '*' }],
    genesyscloud_routing_sms_address: [{ error_message: 'Failed to get sms addresses: API Error: 403 - You are missing the following permission(s): [sms:phoneNumber:view] (x)', resource_id: '*' }],
  });
  const s = HCL.summarizeExportErrors(fil, new Set(['genesyscloud_routing_queue']));
  assert.equal(s[0].need, 'scope voicemail:readonly');
  assert.deepEqual(s[0].types.map(t => [t.type, t.count, t.all, t.none]), [['genesyscloud_group', 6, false, true], ['genesyscloud_user', 11, false, true]]);
  assert.deepEqual(s.slice(1).map(g => g.need), ['scope workitems:readonly', 'sms:phoneNumber:view']);
  assert.equal(s[1].types[0].all, true);
});

test('ubrugte data-opslag fjernes — tvetydige stoppede planen for Falck US', () => {
  const files = {
    'genesyscloud_integration_action.tf': `data "genesyscloud_integration_action" "A_Get_User_Presence" {
  integration_id = "\${genesyscloud_integration.A.id}"
  name           = "Get User Presence"
}

data "genesyscloud_integration_action" "Brugt" {
  name = "X"
}

resource "genesyscloud_integration_action" "Egen" {
  name = "Egen"
}
`,
    'genesyscloud_flow.tf': 'resource "genesyscloud_flow" "f" {\n  substitutions = { a = data.genesyscloud_integration_action.Brugt.id }\n}\n',
  };
  const u = HCL.unusedDataBlocks(files);
  assert.deepEqual(u.map(x => x.name), ['A_Get_User_Presence'], 'kun det ubrugte — et brugt opslag og ressourcer bliver');
  const ud = HCL.removeDataBlock(files['genesyscloud_integration_action.tf'], u[0].type, u[0].name);
  assert.ok(!ud.includes('A_Get_User_Presence') && ud.includes('"Brugt"') && ud.includes('resource "genesyscloud_integration_action" "Egen"'));
  // Fejlen fra Falck US forklares — og den forkerte "login afvist" er væk
  const fejl = 'Error: ambiguous data action name: Get User Routing Status (set integration_id and/or action_type to disambiguate)\n{"resourceType":"genesyscloud_integration_action","method":"GET","path":"/api/v2/integrations/actions","statusCode":200,"correlationId":"41c049fc-39d0-4d40-86da-9087f8d3e8a0"} provider';
  assert.equal(HCL.errorHint(fejl), 'ambiguous_data');
  assert.equal(HCL.errorHint('correlationId 4012-aa provider token'), null, '401 midt i et id er ikke et afvist login');
  assert.equal(HCL.errorHint('API Error: 401 - bad.credentials from the genesys provider'), 'auth');
});

test('data-opslag fjernes fra eksportørens state, så terraform show ikke fejler', () => {
  const st = { version: 4, serial: 1, resources: [
    { mode: 'data', type: 'genesyscloud_integration_action', name: 'A', instances: [{ schema_version: 1 }] },
    { mode: 'managed', type: 'genesyscloud_group', name: 'G', instances: [{ schema_version: 0 }] }] };
  const r = HCL.stripStateData(JSON.stringify(st));
  assert.equal(r.removed, 1);
  const ny = JSON.parse(r.text);
  assert.deepEqual(ny.resources.map(x => x.name), ['G'], 'ressourcerne bliver');
  assert.equal(ny.serial, 2, 'serial tælles op');
  assert.deepEqual(HCL.stripStateData(r.text), { text: null, removed: 0 }, 'intet at fjerne → filen røres ikke');
  const fejl = 'terraform show failed: Failed to marshal plan to json: error marshaling prior state: schema version 1 for data.genesyscloud_integration_action.X in state does not match version 0 from the provider';
  assert.equal(HCL.errorHint(fejl), 'state_data');
});

test('plan kan begrænses til enkelte ressourcer, og en plan der ændrer hemmeligheder kræver et ja', () => {
  assert.ok(HCL.TARGET_RE.test('genesyscloud_group.testtest'));
  assert.ok(HCL.TARGET_RE.test('genesyscloud_group.Test-Test'));
  for (const ond of ['genesyscloud_group', 'genesyscloud_group.x -destroy', '-target=x.y', 'a.b;rm', 'genesyscloud_group.x y'])
    assert.ok(!HCL.TARGET_RE.test(ond), ond);
  assert.ok(HCL.SECRET_TYPES.includes('genesyscloud_integration_credential') && HCL.SECRET_TYPES.includes('genesyscloud_oauth_client'));
  const R = kilde('routes/terraform.js');
  const run = R.slice(R.indexOf("router.post('/api/terraform/run'"), R.indexOf("router.post('/api/terraform/apply'"));
  assert.match(run, /targets\.map\(t => `-target=\$\{t\}`\)/);
  assert.match(run, /!HCL\.TARGET_RE\.test\(t\)/, 'en adresse valideres, før den kommer på kommandolinjen');
  assert.match(run, /summary\.secrets = /);
  const apply = R.slice(R.indexOf("router.post('/api/terraform/apply'"));
  assert.match(apply, /req\.body\.confirmSecrets !== true/);
});

test('"Kopiér til en anden org" har intet valgt på forhånd og foreslår arbejdsparret', () => {
  // Listen startede på den første org (Sabio APS), så den så valgt ud
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const fn = HTML.slice(HTML.indexOf('function tfCopyOptions('), HTML.indexOf('function tfRenderWs('));
  assert.match(fn, /<option value="">/);
  assert.match(fn, /\[work\.target, work\.source\]/);
  assert.match(fn, /c\.id !== own/, 'mappens egen org er ikke med');
});

test('eksporten oplyser at org\'en kun læses, og en stoppet eksport ryddes op', () => {
  const R = kilde('routes/terraform.js');
  const exp = R.slice(R.indexOf("router.post('/api/terraform/export'"), R.indexOf('// ── Kørsler'));
  assert.match(exp, /Read-only export of/);
  assert.match(exp, /job\.status === 'cancelled'/);
  assert.match(exp, /CLI\.removeDir\(dir\)/, 'mappen slettes med genforsøg (Windows slipper filer langsomt)');
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(HTML.includes("tfFollowExport();\n}"), 'en kørende eksport følges igen, når fanen tegnes på ny');
  // Et stoppet eller fejlet job har et error-felt. Gik opslaget gennem tfApi,
  // blev det taget for et fejlet opslag, og fanen viste "kører" for evigt.
  const follow = HTML.slice(HTML.indexOf('function tfFollowJob('), HTML.indexOf('function tfClock('));
  assert.ok(!/tfApi\(`\/api\/terraform\/job\//.test(follow), 'jobbet hentes med fetch, ikke tfApi');
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

test('opgaver: kopier en kø uden navn og medlemmer, og find ledige lokale navne', () => {
  const src = [
    '# Kommentar over køen',
    'resource "genesyscloud_routing_queue" "Akut" {',
    '  name                     = "Akut"',
    '  acw_wrapup_prompt        = "MANDATORY_TIMEOUT"',
    '  skill_evaluation_method  = "ALL"',
    '  division_id              = genesyscloud_auth_division.Home.id',
    '  members {',
    '    user_id = genesyscloud_user.a.id',
    '  }',
    '  media_settings_call {',
    '    alerting_timeout_sec = 8',
    '  }',
    '}',
    ''].join('\n');
  const ny = HCL.cloneResource(src, 'genesyscloud_routing_queue', 'Akut', 'Support_DK', 'Support "DK"');
  assert.ok(ny.startsWith('resource "genesyscloud_routing_queue" "Support_DK" {'), 'ny overskrift, ingen kommentar med');
  const r = HCL.resources(ny)[0];
  assert.equal(r.entries.find(e => e.key === 'name').literal.value, 'Support "DK"');
  assert.ok(!r.entries.some(e => e.key === 'members'), 'medlemmer kopieres ikke');
  assert.ok(ny.includes('genesyscloud_auth_division.Home.id') && ny.includes('alerting_timeout_sec = 8'), 'resten kopieres');
  assert.ok(src.includes('user_id'), 'skabelonen er urørt');

  const taken = new Set(['Akut']);
  assert.equal(HCL.localName('Akut', taken), 'Akut_2');
  assert.equal(HCL.localName('Kø Ærø/Søndag', taken), 'Koe_AEroe_Soendag');
  assert.equal(HCL.localName('112 Akut', taken), 'r_112_Akut');
  assert.equal(HCL.localName('!!!', taken), 'r');
  assert.throws(() => HCL.cloneResource(src, 'genesyscloud_routing_queue', 'Findes_ikke', 'X', 'X'));
});

test('ændrede ressourcer findes ved at sammenligne en fil før og efter, og fmt tæller ikke', () => {
  const a = 'resource "genesyscloud_group" "A" {\n  name = "A"\n}\n\nresource "genesyscloud_group" "B" {\n  name = "B"\n}\n';
  assert.deepEqual(HCL.changedResources(a, a.replace(/name = /g, 'name   =  ')), [], 'kun mellemrum');
  const b = a.replace('"B"\n', '"B2"\n') + '\nresource "genesyscloud_group" "C" {\n  name = "C"\n}\n';
  assert.deepEqual(HCL.changedResources(a, b).sort(), ['genesyscloud_group.B', 'genesyscloud_group.C']);
  assert.deepEqual(HCL.changedResources(a, ''), ['genesyscloud_group.A', 'genesyscloud_group.B'], 'en slettet fil');
});

// ── Flow-tjek efter eksporten (v1.87.0) ──────────────────────────────────────
// Eksportøren siger ikke, hvilke flows den springer over. En Falck US-eksport
// havde 29 flows; tjekket viser hvilke af org'ens øvrige flows der mangler og hvorfor.

test('flow-id\'erne i en eksport findes både i YAML-filernes navne og i genesyscloud_flow', () => {
  const { exportedFlowIds } = require('../src/routes/terraform.js')._test;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfflow-'));
  try {
    fs.mkdirSync(path.join(dir, 'architect_flows'));
    fs.writeFileSync(path.join(dir, 'architect_flows', 'Main_25-INBOUNDCALL-115e1a38-fa53-4136-9e14-e1b53f06f198.yaml'), 'x');
    fs.writeFileSync(path.join(dir, 'genesyscloud_flow.tf'),
      'resource "genesyscloud_flow" "b" {\n  filepath = "architect_flows\\Bot-BOT-86C0901F-8936-4e15-8822-11ff0226aff3.yaml"\n}\n');
    fs.writeFileSync(path.join(dir, 'genesyscloud_routing_queue.tf'), 'resource "genesyscloud_routing_queue" "q" {\n  id = "00000000-0000-0000-0000-000000000001"\n}\n');
    const ids = exportedFlowIds(dir);
    assert.ok(ids.has('115e1a38-fa53-4136-9e14-e1b53f06f198'));
    assert.ok(ids.has('86c0901f-8936-4e15-8822-11ff0226aff3'), 'store bogstaver i id\'et gør ingen forskel');
    assert.ok(!ids.has('00000000-0000-0000-0000-000000000001'), 'id\'er i andre typer tæller ikke');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('manglende flows får det vi kan se om dem, de ukendte først', () => {
  const { compareFlows } = require('../src/routes/terraform.js')._test;
  const flows = [
    { id: 'a', name: 'Main', type: 'INBOUNDCALL', publishedVersion: { name: '3.0' } },
    { id: 'b', name: 'Default In-Queue Flow', type: 'INQUEUECALL', system: true, publishedVersion: { name: '1.0' } },
    { id: 'c', name: 'Kladde', type: 'INBOUNDCALL', publishedVersion: null },
    { id: 'd', name: 'Låst', type: 'INBOUNDCALL', publishedVersion: { name: '2.0' }, lockedUser: 'Anna' },
    { id: 'e', name: 'Gåde', type: 'WORKFLOW', publishedVersion: { name: '1.0' } },
  ];
  const r = compareFlows(flows, new Set(['a']));
  assert.equal(r.total, 5); assert.equal(r.exported, 1);
  assert.deepEqual(r.missing.map(m => [m.name, m.reason]),
    [['Gåde', 'unknown'], ['Låst', 'locked'], ['Kladde', 'unpublished'], ['Default In-Queue Flow', 'system']]);
  const uden = compareFlows(flows, new Set(), { include: ['genesyscloud_routing_queue'] });
  assert.ok(uden.flowsOff && uden.missing.every(m => m.reason === 'filter'), 'flows var ikke valgt i eksporten');
  const navnefilter = compareFlows(flows, new Set(['a']), { include: ['genesyscloud_flow::Main'] });
  assert.equal(navnefilter.missing.find(m => m.name === 'Gåde').reason, 'filter');
  assert.equal(compareFlows(flows, new Set(['a']), { exclude: ['genesyscloud_flow'] }).flowsOff, true);
});

test('flow-tjekket kører efter eksporten og vises i mappen', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'terraform.js'), 'utf8');
  const exp = src.slice(src.indexOf("writeMeta(dir, { kind: 'export'"), src.indexOf("job.phase = 'done';"));
  assert.ok(exp.includes('await checkFlows(dir)'), 'eksporten kører tjekket');
  assert.match(src, /flowCheck: meta\.flowCheck \|\| null/, 'mappen sender resultatet med');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('${tfExportErrorsHtml(w.exportErrors)}${tfFlowCheckHtml(w)}'));
  assert.ok(html.includes("tfApi('/api/terraform/workspace/flowcheck'"));
  for (const r of ['system', 'unpublished', 'locked', 'filter', 'unknown']) assert.ok(html.includes(`tf_fc_r_${r}:'`), r);
});

// ── terraform.exe der ikke kan startes (v1.87.1) ─────────────────────────────
// På en anden pc stod der "terraform.exe was not found", og en sti skrevet i
// hånden gav kun "spawn UNKNOWN". Nu siger Archy GUI hvad der er galt med filen.

function fakePe(machine) {
  const b = Buffer.alloc(512);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x4550, 0x80);          // "PE\0\0"
  b.writeUInt16LE(machine, 0x84);
  return b;
}

test('filen undersøges: zip, ikke et program, eller til en anden processor', () => {
  const CLI = require('../src/lib/terraform-cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfexe-'));
  try {
    const put = (n, data) => { const f = path.join(dir, n); fs.writeFileSync(f, data); return f; };
    const zip = put('zip.exe', Buffer.from('PK\x03\x04rest', 'latin1'));
    const txt = put('txt.exe', 'not a program');
    const amd = put('amd.exe', fakePe(0x8664));
    const arm = put('arm.exe', fakePe(0xaa64));
    const x86 = put('x86.exe', fakePe(0x14c));
    assert.equal(CLI.inspectExe(zip, 'win32', 'x64').problem, 'zip');
    assert.equal(CLI.inspectExe(txt, 'win32', 'x64').problem, 'not_exe');
    assert.deepEqual(CLI.inspectExe(amd, 'win32', 'x64'), { problem: null, machine: 'amd64', host: 'amd64' });
    assert.deepEqual(CLI.inspectExe(arm, 'win32', 'x64'), { problem: 'arch', machine: 'arm64', host: 'amd64' }, 'ARM64 kører ikke på en almindelig pc');
    assert.equal(CLI.inspectExe(amd, 'win32', 'arm64').problem, null, 'Windows på ARM kører amd64');
    assert.equal(CLI.inspectExe(x86, 'win32', 'x64').problem, null, '386 kører på en 64-bit pc');
    assert.equal(CLI.inspectExe(path.join(dir, 'findes-ikke.exe'), 'win32', 'x64').problem, 'unreadable');
    assert.equal(CLI.inspectExe(txt, 'linux', 'x64').problem, null, 'kun Windows-filer undersøges');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('spawn UNKNOWN får et hint, og en udpakket undermappe findes', () => {
  assert.equal(HCL.errorHint('Error: spawn UNKNOWN'), 'spawn');
  assert.equal(HCL.errorHint('spawn EPERM'), 'spawn');
  assert.equal(HCL.errorHint('terraform init failed (exit 1)'), 'needs_init', 'de andre hints er uændrede');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'terraform-cli.js'), 'utf8');
  assert.match(src, /e\.isDirectory\(\) && \/\^terraform\/i\.test\(e\.name\)/, 'C:\\Tools\\Terraform\\terraform_1.x_windows_amd64\\terraform.exe findes også');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('if (tfCli.found && tfCli.version) {'), 'fundet uden version er ikke et grønt flueben');
  for (const k of ['zip', 'not_exe', 'arch', 'blocked', 'unreadable']) assert.ok(html.includes(`tf_cli_bad_${k}:'`), k);
  assert.ok(html.includes("tf_hint_spawn:'"));
});
