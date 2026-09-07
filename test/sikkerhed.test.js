// Tre huller der var åbne, og som hver især blev efterprøvet før de blev
// lukket. Testene her er skrevet mod DET der virkede — ikke mod en teori om
// hvad der kunne gå galt.
//
//   1. /api/files/content udleverede customers.json med alle credentials
//   2. /api/import skrev en fil i C:\Tools\, tre niveauer over flows/
//   3. et anførselstegn i et flownavn fik en indsat kommando til at køre
//
// Går én af dem i stykker, er hullet åbent igen.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const s = require('../server.js');

// ── 1. Læsning uden for flows/ ───────────────────────────────────────────────

test('insideFlowsDir opløser stien før den sammenligner', () => {
  // Det var netop dette: strengen BEGYNDER med flows-mappen, men peger ud af
  // den. Uden path.resolve slap den igennem.
  assert.equal(s.insideFlowsDir(path.join(s.FLOWS_DIR, '..', 'customers.json')), false);
  assert.equal(s.insideFlowsDir(path.join(s.FLOWS_DIR, '..', '..', '..', 'Windows', 'win.ini')), false);
  assert.equal(s.insideFlowsDir(s.FLOWS_DIR + '..\\customers.json'), false);
});

test('insideFlowsDir slipper rigtige filer under flows/ igennem', () => {
  assert.equal(s.insideFlowsDir(path.join(s.FLOWS_DIR, 'Kunde', 'Flow_v1-0.yaml')), true);
  assert.equal(s.insideFlowsDir(s.FLOWS_DIR), true);
});

test('insideFlowsDir afviser tomt og manglende input', () => {
  for (const x of [null, undefined, '', 0, false]) assert.equal(s.insideFlowsDir(x), false);
});

test('en mappe der blot BEGYNDER som flows/ er ikke inde i den', () => {
  // "…/flowshemmeligt" starter med "…/flows" som streng. Uden path.sep til
  // sidst ville den tælle som en fil i flows-mappen.
  assert.equal(s.insideFlowsDir(s.FLOWS_DIR + 'hemmeligt' + path.sep + 'x.yaml'), false);
});

// ── 2. Skrivning uden for flows/ ─────────────────────────────────────────────

test('safeFileName skræller mapper og .. af', () => {
  assert.equal(s.safeFileName('../../../BEVIS-traversal.yaml', 'standard.yaml'), 'BEVIS-traversal.yaml');
  assert.equal(s.safeFileName('..\\..\\..\\evil.yaml', 'standard.yaml'), 'evil.yaml');
  assert.equal(s.safeFileName('C:\\Windows\\System32\\drivers\\etc\\hosts', 'standard.yaml'), 'hosts');
});

test('safeFileName falder tilbage når der intet brugbart navn er', () => {
  for (const x of ['..', '.', '', null, undefined, '   ', '/', '\\'])
    assert.equal(s.safeFileName(x, 'standard.yaml'), 'standard.yaml');
});

test('safeFileName lader et almindeligt filnavn stå', () => {
  assert.equal(s.safeFileName('DEV_WeekNumber_v2-0.yaml', 'x'), 'DEV_WeekNumber_v2-0.yaml');
  assert.equal(s.safeFileName('Mit Flow_v16-3.yaml', 'x'), 'Mit Flow_v16-3.yaml');
});

test('et renset navn kan ikke komme ud af importmappen', () => {
  // Sådan bruges de to sammen i /api/import.
  const importDir = path.join(s.FLOWS_DIR, 'import_kunde');
  for (const ondt of ['../../../BEVIS.yaml', '..\\..\\evil.yaml', '/etc/passwd', '..']) {
    const sti = path.join(importDir, s.safeFileName(ondt, 'import.yaml'));
    assert.ok(s.insideFlowsDir(sti), `"${ondt}" slap ud: ${sti}`);
    assert.equal(path.dirname(path.resolve(sti)), path.resolve(importDir));
  }
});

// ── 3. Kommandoindsprøjtning ─────────────────────────────────────────────────

test('en værdi med anførselstegn afvises frem for at blive sendt af sted', () => {
  // Præcis den nyttelast der blev målt køre igennem cmd.exe.
  const ondt = 'uskyldigt" & echo naaet-igennem> "fil.txt" & rem ';
  assert.throws(() => s.archyArg(ondt, 'Flownavn'), /double quote/);
});

test('archyArg citerer almindelige navne, også med mellemrum og æøå', () => {
  assert.equal(s.archyArg('Mit Flow', 'Flownavn'), '"Mit Flow"');
  assert.equal(s.archyArg('Åbningstider', 'Flownavn'), '"Åbningstider"');
  // & og | er ufarlige INDE i citatet — det er kun " der bryder ud.
  assert.equal(s.archyArg('A & B', 'Flownavn'), '"A & B"');
  assert.equal(s.archyArg(null, 'Flownavn'), '""');
});

test('uciterede værdier må kun være rene navne', () => {
  assert.equal(s.archyBareArg('inboundcall', 'Flowtype'), 'inboundcall');
  assert.equal(s.archyBareArg('common-module_2.0', 'Flowtype'), 'common-module_2.0');
  // Uden citater er selv et mellemrum nok til at starte noget nyt.
  for (const ondt of ['inboundcall & calc', 'a|b', 'a>fil', 'a"b', '', 'a b'])
    assert.throws(() => s.archyBareArg(ondt, 'Flowtype'), /is not a valid name/);
});

test('flowversionen er et tal, ikke en fri streng', () => {
  // --flowVersion tages nu med, så migreringen henter den PUBLICEREDE udgave
  // frem for kladden. Værdien kommer fra Genesys, men den skal ikke af den
  // grund gå uciteret på kommandolinjen.
  assert.equal(s.archyVersionFlag('5.0'), '--flowVersion "5.0" ');
  assert.equal(s.archyVersionFlag('5'), '--flowVersion "5.0" ', 'et helt tal skal få sin .0');
  // Tom eller manglende betyder Archys standard: latest.
  for (const x of [null, undefined, '']) assert.equal(s.archyVersionFlag(x), '');
  for (const ondt of ['5.0 & calc', 'latest', '../x', '5"0'])
    assert.throws(() => s.archyVersionFlag(ondt), /Invalid flow version/);
});

test('migreringen henter den publicerede udgave, ikke kladden', () => {
  // Vagten sagde god for flowet fordi det VAR publiceret, mens eksporten tog
  // 'latest' — altså kladden. Målt på en rigtig org: prods ChatGPT var
  // publiceret som 5.0 med sin data action, mens kladden 7.0 havde mistet den.
  const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(SRV, /archyVersionFlag\(kildeVersion\)/, 'migrate/prepare eksporterer uden version');
  assert.match(SRV, /archyVersionFlag\(depVersion\)/, 'afhængigheder eksporteres uden version');
  assert.match(SRV, /archyVersionFlag\(version\)/, 'exportFlowToYaml tager ikke imod en version');
});

test('underkommandoen kan kun være en af de tre Archy kender', () => {
  for (const ok of ['create', 'update', 'publish']) assert.equal(s.archyVerb(ok), ok);
  assert.equal(s.archyVerb(undefined), 'create');
  // Den kom fra req.body.action og gik uciteret ind i kommandoen.
  for (const ondt of ['create & calc', 'publish; rm -rf /', 'CREATE', 'delete'])
    assert.throws(() => s.archyVerb(ondt), /Unknown action/);
});

test('credentials citeres med archyArg, ikke med en POSIX-escape', () => {
  // Den gamle kode skrev \" — det virker i bash, ikke i cmd.exe. Et secret med
  // et anførselstegn ville være brudt ud på samme måde som flownavnet.
  const flags = s.archyCredFlags({
    name: 'Prøve', region: 'mypurecloud.de', clientId: 'id-0000', clientSecret: 'h3mm3l1gt'
  });
  assert.match(flags, /--clientSecret "h3mm3l1gt"/);
  assert.ok(!flags.includes('\\"'));
  assert.throws(
    () => s.archyCredFlags({ name: 'X', region: 'mypurecloud.de', clientId: 'i', clientSecret: 'a"b' }),
    /double quote/
  );
});

// ── Kilden selv ──────────────────────────────────────────────────────────────
// De to næste kan ikke prøves af uden en rigtig org, så de læser koden i stedet.
// Det er stadig bedre end ingenting: de fælder hvis mønstret kommer igen.

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('ingen værdi går uciteret ind i en Archy-kommando', () => {
  // Alt der interpoleres i en runArchy-streng skal gennem archyArg eller
  // archyBareArg. En rå ${...} dér er præcis den fejl der blev målt.
  const kald = [...SERVER.matchAll(/runArchy\(\s*\n?\s*`([^`]*)`/g)].map(m => m[1])
    .concat([...SERVER.matchAll(/runArchy\(\s*\n\s*`([\s\S]*?)`,/g)].map(m => m[1]));
  assert.ok(kald.length >= 3, 'fandt ingen runArchy-kald at tjekke');
  for (const k of kald) {
    for (const m of k.matchAll(/\$\{([^}]*)\}/g)) {
      const udtryk = m[1].trim();
      assert.ok(/^(archyArg|archyBareArg)\(/.test(udtryk) || udtryk === 'cmd',
        `uciteret værdi i en Archy-kommando: \${${udtryk}}`);
    }
  }
});

test('opslag i mål-org\'en bliver ikke slugt', () => {
  // Før: catch (_) {} → tom mængde → "alt mangler" → vi oprettede tabeller og
  // data actions der allerede var der.
  const slugt = SERVER.match(/lookupExisting\([^;]*\);\s*\}\s*catch\s*\(_\)\s*\{\s*\}/g) || [];
  assert.equal(slugt.length, 0, 'et opslag mod mål-org\'en sluger stadig sin fejl');
  // Og fejlen skal komme frem som en rigtig besked.
  assert.match(SERVER, /Could not look up \$\{kind\} in/);
});

test('stier fra klienten tjekkes med insideFlowsDir, ikke med startsWith', () => {
  assert.equal((SERVER.match(/startsWith\(FLOWS_DIR\)/g) || []).length, 0,
    'en rå strengsammenligning på FLOWS_DIR er tilbage');
});

// Selve KALDET skal også være der. En test af safeFileName alene fælder ikke
// nogen der fjerner kaldet og skriver fileName direkte igen — det viste en
// mutationskørsel, hvor netop den ændring slap forbi hele suiten.
function ruteKrop(sti) {
  const start = SERVER.indexOf(`app.post('${sti}'`);
  assert.ok(start > 0, `fandt ikke ruten ${sti}`);
  const slut = SERVER.indexOf('\n});', start);
  return SERVER.slice(start, slut);
}

test('/api/import renser filnavnet før det bliver til en sti', () => {
  const krop = ruteKrop('/api/import');
  assert.match(krop, /safeFileName\(fileName/, 'fileName går uden om safeFileName');
  assert.ok(!/path\.join\(importDir,\s*fileName\s*\)/.test(krop),
    'det rå fileName bruges igen som sti');
  assert.match(krop, /insideFlowsDir\(filePath\)/, 'stien tjekkes ikke bagefter');
});

test('/api/import tager kun de handlinger Archy kender', () => {
  const krop = ruteKrop('/api/import');
  assert.match(krop, /archyVerb\(action\)/, 'action går uden om archyVerb');
  assert.ok(!/const cmd = action \|\| 'create'/.test(krop),
    'action bruges igen rå fra req.body');
});

// ── Endepunkterne, ikke kun funktionerne ─────────────────────────────────────

test('/api/import kan ikke skrive uden for flows/', async (t) => {
  // Kræver et demo-miljø: dér stopper runArchy før den rører noget, mens
  // skrivningen — det vi tester — allerede er sket. Findes der ingen, springes
  // testen over frem for at ramme en rigtig org.
  const kunder = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'customers.json'), 'utf8')); }
    catch (_) { return []; }
  })();
  const demo = kunder.find(c => c.demo);
  if (!demo) return t.skip('intet demo-miljø i customers.json');

  const uden = path.resolve(s.FLOWS_DIR, '..', '..', 'BEVIS-traversal.yaml');
  assert.ok(!fs.existsSync(uden), 'bevisfilen lå der i forvejen — afbryder');

  const srv = await new Promise(res => { const h = s.app.listen(0, '127.0.0.1', () => res(h)); });
  const skrevet = [];
  try {
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: demo.id,
        fileName: '../../BEVIS-traversal.yaml',
        yamlContent: '# skulle aldrig lande uden for flows/'
      })
    });
    // Archy afvises på demo-miljøet — det er forventet. Pointen er hvor filen lå.
    assert.ok(r.status >= 400, 'demo-miljøet skulle afvise Archy-kaldet');
    assert.ok(!fs.existsSync(uden), 'filen landede UDEN FOR flows/ — hullet er åbent igen');

    const inde = path.join(s.FLOWS_DIR, `import_${demo.id}`, 'BEVIS-traversal.yaml');
    if (fs.existsSync(inde)) skrevet.push(inde);
    assert.ok(fs.existsSync(inde), 'filen skulle være skrevet inde i importmappen');

    // Og en ukendt handling skal afvises, ikke sendes videre til cmd.exe.
    const r2 = await fetch(`http://127.0.0.1:${port}/api/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: demo.id, fileName: 'x.yaml',
                             yamlContent: 'a: 1', action: 'create & calc' })
    });
    assert.equal(r2.status, 400);
    assert.match((await r2.json()).error, /Unknown action/);
  } finally {
    for (const f of skrevet) { try { fs.unlinkSync(f); } catch (_) {} }
    try { fs.unlinkSync(uden); } catch (_) {}
    await new Promise(res => srv.close(res));
  }
});

test('/api/files/content nægter at læse uden for flows/', async () => {
  const srv = await new Promise(res => { const h = s.app.listen(0, '127.0.0.1', () => res(h)); });
  try {
    const port = srv.address().port;
    const ud = path.join(s.FLOWS_DIR, '..', 'customers.json');
    const r = await fetch(`http://127.0.0.1:${port}/api/files/content?filePath=${encodeURIComponent(ud)}`);
    assert.equal(r.status, 400, 'stien uden for flows/ skal afvises');
    const krop = await r.json();
    assert.match(krop.error, /flows/);

    // Og den skal stadig kunne læse en rigtig fil under flows/.
    const inde = path.join(s.FLOWS_DIR, '.test-laesning.yaml');
    fs.writeFileSync(inde, 'inboundCall:\n  name: Test\n');
    try {
      const ok = await fetch(`http://127.0.0.1:${port}/api/files/content?filePath=${encodeURIComponent(inde)}`);
      assert.equal(ok.status, 200);
      assert.match((await ok.json()).content, /name: Test/);
    } finally { fs.unlinkSync(inde); }
  } finally {
    await new Promise(res => srv.close(res));
  }
});
