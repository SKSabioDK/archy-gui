// Demo-kunden: lokale miljøer og flows der aldrig rører en rigtig org.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const { loadCustomers } = require('./customers');
const { prefixOf, isDemo, belongsToEnv, stripEnvPrefix } = require('./environments');
const { baseFlowName } = require('./names');
const { loadManifest, MANIFEST_FILE } = require('./manifest-file');
const { scanYamlDependencies } = require('./dependencies');

// ── Demo-kunde ───────────────────────────────────────────────────────────────
// Fire miljøer og et par flows der kun findes lokalt, så hele pipelinen kan
// prøves af uden at røre en rigtig org. Intet demo-miljø har credentials, og
// ingen kode-vej herunder kalder Genesys eller Archy.
const DEMO_FILE = path.join(DATA_DIR, 'demo-data.json');

// Demoens forfremmelser skrives i det samme manifest som de rigtige. Når demoen
// nulstilles eller fjernes, skal dens linjer med — ellers ville en øvelse
// efterlade spor i den fortegnelse der beskriver rigtige migreringer.
function dropDemoManifest(which) {
  const hit = id => which === '2' ? String(id).startsWith('demo2-')
            : which === '1' ? (String(id).startsWith('demo-') && !String(id).startsWith('demo2-'))
            : String(id).startsWith('demo');
  try {
    const all = loadManifest().filter(e => !hit(e.targetId || ''));
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(all, null, 2));
  } catch (_) { /* intet manifest endnu */ }
}

function loadDemo() {
  try { return JSON.parse(fs.readFileSync(DEMO_FILE, 'utf8')); }
  catch { return { flows: {} }; }
}
function saveDemo(d) { fs.writeFileSync(DEMO_FILE, JSON.stringify(d, null, 2)); }

const DEMO_TENANT = 'Demo A/S';
const DEMO_GROUP  = 'Demo';
const DEMO_ENVS = [
  { suffix: 'dev',  stage: 'dev'  },
  { suffix: 'test', stage: 'test' },
  { suffix: 'uat',  stage: 'uat'  },
  { suffix: 'prod', stage: 'prod' }
];
const demoEnvId = suffix => 'demo-' + suffix;

// Demo 2 er et andet mønster: miljøerne er ikke hver sin org, men kendes på et
// præfiks inde i den samme org — "DEV_Ordreflow", "TEST_Ordreflow" — og prod
// har intet præfiks. Samme konvention gælder datatabellerne. Her ligger de tre
// non-prod-miljøer i én org og prod i en anden, hvilket er den udbredte form.
const DEMO2_TENANT = 'Kunde 2 A/S';
const DEMO2_GROUP  = 'Norden';
const DEMO2_ORG_A  = 'demo2-orgA';
const DEMO2_ORG_B  = 'demo2-orgB';
const DEMO2_ENVS = [
  { suffix: 'dev',  stage: 'dev',  prefix: 'DEV_',  org: DEMO2_ORG_A, orgLabel: 'Fælles non-prod org' },
  { suffix: 'test', stage: 'test', prefix: 'TEST_', org: DEMO2_ORG_A, orgLabel: 'Fælles non-prod org' },
  { suffix: 'uat',  stage: 'uat',  prefix: 'UAT_',  org: DEMO2_ORG_A, orgLabel: 'Fælles non-prod org' },
  { suffix: 'prod', stage: 'prod', prefix: '',      org: DEMO2_ORG_B, orgLabel: 'Prod-org' }
];
const demo2EnvId = suffix => 'demo2-' + suffix;
// Navnet bærer trinnet, ikke præfikset. Præfikset kan ændres under Kunder, og
// så ville "Kunde 2 A/S — UAT_" stå tilbage over et miljø uden præfiks.
// Tavlen viser præfikset for sig selv i kolonnehovedet.
const demo2EnvName = stage => `${DEMO2_TENANT} — ${String(stage).toUpperCase()}`;

// Demoen har sine egne divisioner, så rullelisten kan prøves af uden en org.
const DEMO_DIVISIONS = ['Home', 'DEV', 'TEST', 'UAT', 'PROD'];

// Et flows indhold er bare en tekst her — nok til at hashe og sammenligne.
// Med 'modul' kalder flowet et common module — skrevet som Archy skriver det,
// så afhængighedsscanningen og præfiks-omskrivningen virker på det.
const demoYaml = (name, body, modul) =>
  `inboundCall:\n  name: ${name}\n  division: Home\n  description: "${body}"\n` +
  (modul
    ? `  tasks:\n    - task:\n        name: Start\n        refId: Start_1\n` +
      `        actions:\n          - callCommonModule:\n              name: Hilsen\n              commonModule:\n` +
      `                ${modul}:\n                  ver_latestPublished:\n`
    : '');
const demoModuleYaml = (name, body) =>
  `commonModule:\n  name: ${name}\n  division: Home\n  description: "${body}"\n`;

function seedDemo() {
  const now = Date.now();
  const day = 86400000;
  const flows = {};
  for (const e of DEMO_ENVS) flows[demoEnvId(e.suffix)] = [];

  // 1) Findes overalt med samme indhold — den rolige række.
  for (const [i, e] of DEMO_ENVS.entries())
    flows[demoEnvId(e.suffix)].push({
      name: 'Velkomst', type: 'INBOUNDCALL',
      published: String(4 - i) + '.0',
      publishedAt: now - (40 - i * 9) * day,
      content: demoYaml('Velkomst', 'goddag og velkommen')
    });

  // 2) Findes kun i dev — hele kæden ligger foran.
  flows[demoEnvId('dev')].push({
    name: 'Aabningstider', type: 'INBOUNDCALL',
    published: '10.0', publishedAt: now - 3 * day,
    content: demoYaml('Aabningstider', 'vi har aabent 8-16')
  });

  // 3) Findes overalt, men prod er løbet fra de andre — nogen har rettet
  //    direkte i prod. Det er den række afvigelses-visningen er til for.
  for (const [i, e] of DEMO_ENVS.entries()) {
    const drifted = e.stage === 'prod';
    flows[demoEnvId(e.suffix)].push({
      name: 'Kundeservice', type: 'WORKFLOW',
      published: drifted ? '7.0' : String(3 - Math.min(i, 2)) + '.0',
      publishedAt: now - (drifted ? 2 : 30 - i * 7) * day,
      content: demoYaml('Kundeservice', drifted
        ? 'rettet direkte i prod en fredag eftermiddag'
        : 'stil om til kundeservice')
    });
  }
  // Flet ind i det der allerede ligger. Skrev vi hele filen, ville en
  // nulstilling af demo 1 slette demo 2's flows og begge demoers manifester —
  // og de to skal ikke kunne røre hinanden.
  for (const liste of Object.values(flows)) liste.forEach(demoRemember);
  const d = loadDemo();
  d.flows = { ...(d.flows || {}), ...flows };
  d.seededAt = now;
  if (d.manifest) for (const e of DEMO_ENVS) delete d.manifest[demoEnvId(e.suffix)];
  saveDemo(d);
}

// Flowene ligger under den ORG miljøet hører til. For demo 1 er org og miljø
// det samme; for demo 2 deler flere virtuelle miljøer den samme org, og så
// skal de læse fra samme liste — ellers er der intet præfikset at filtrere i.
const demoFlowKey = c => (typeof c === 'string' ? c : (c.demoOrg || c.id));
function demoFlowsFor(env) { return (loadDemo().flows || {})[demoFlowKey(env)] || []; }

// Demoen efterligner Genesys' versionshistorik: hver publiceret udgave huskes
// på flowet, så en rollback kan hente den — præcis som den ville hente den fra
// en rigtig org med en eksport af den udgave.
const DEMO_VERSIONS_MAX = 30;
function demoRemember(f) {
  f.versions = f.versions || {};
  f.versions[String(f.published)] = f.content;
  const keys = Object.keys(f.versions);
  for (const k of keys.slice(0, Math.max(0, keys.length - DEMO_VERSIONS_MAX))) delete f.versions[k];
}

function seedDemo2() {
  const d = loadDemo();
  d.flows = d.flows || {};
  const now = Date.now(), day = 86400000;
  const A = [], B = [];

  // Præfikserne tages fra miljøernes AKTUELLE opsætning, ikke fra DEMO2_ENVS.
  // Fjerner man UAT_ under Kunder og nulstiller, skal demoen følge med —
  // ellers stod de gamle "UAT_Betaling" tilbage som selvstændige flows i et
  // miljø uden præfiks, én ekstra række pr. flow.
  const envs = loadCustomers();
  const pfx = {};
  for (const e of DEMO2_ENVS) {
    const c = envs.find(x => x.id === demo2EnvId(e.suffix));
    pfx[e.stage] = c ? prefixOf(c) : e.prefix;
  }
  const nonProd = ['dev', 'test', 'uat'];
  const n = (stage, base) => pfx[stage] + base;

  // 1) Findes i alle fire med samme indhold — den rolige række.
  // Ordreflow og Betaling kalder begge det fælles modul "Hilsen". Forfremmes
  // modulet, skal de to publiceres igen i målet for at få den nye udgave med.
  const ord = 'tag imod ordren';
  const ordV = { dev: ['9.0', 30], test: ['2.0', 22], uat: ['2.0', 15] };
  for (const s of nonProd)
    A.push({ name: n(s, 'Ordreflow'), type: 'INBOUNDCALL', published: ordV[s][0],
             publishedAt: now - ordV[s][1] * day, content: demoYaml(n(s, 'Ordreflow'), ord, n(s, 'Hilsen')) });
  B.push({ name: n('prod', 'Ordreflow'), type: 'INBOUNDCALL', published: '1.0',
           publishedAt: now - 8 * day, content: demoYaml(n('prod', 'Ordreflow'), ord, n('prod', 'Hilsen')) });

  // 1b) Det fælles modul. Dev er rettet (ny velkomsttekst); resten er ens.
  const hilV = { dev: ['4.0', 1], test: ['1.0', 22], uat: ['1.0', 15] };
  for (const s of nonProd)
    A.push({ name: n(s, 'Hilsen'), type: 'COMMONMODULE', published: hilV[s][0],
             publishedAt: now - hilV[s][1] * day,
             content: demoModuleYaml(n(s, 'Hilsen'), s === 'dev' ? 'velkommen til Kunde 2 - nu med ny tekst' : 'velkommen til Kunde 2') });
  B.push({ name: n('prod', 'Hilsen'), type: 'COMMONMODULE', published: '1.0',
           publishedAt: now - 8 * day, content: demoModuleYaml(n('prod', 'Hilsen'), 'velkommen til Kunde 2') });

  // 2) Kun i dev — hele kæden ligger foran.
  A.push({ name: n('dev', 'Fejlbesked'), type: 'WORKFLOW', published: '4.0',
           publishedAt: now - 2 * day, content: demoYaml(n('dev', 'Fejlbesked'), 'sig undskyld') });

  // 3) Findes overalt, men prod er løbet fra de andre.
  const bet = 'tag imod betaling';
  const betV = { dev: ['5.0', 26], test: ['2.0', 20], uat: ['2.0', 14] };
  for (const s of nonProd)
    A.push({ name: n(s, 'Betaling'), type: 'INBOUNDCALL', published: betV[s][0],
             publishedAt: now - betV[s][1] * day, content: demoYaml(n(s, 'Betaling'), bet, n(s, 'Hilsen')) });
  B.push({ name: n('prod', 'Betaling'), type: 'INBOUNDCALL', published: '11.0',
           publishedAt: now - 1 * day,
           content: demoYaml(n('prod', 'Betaling'), 'rettet direkte i prod, ingen ved hvorfor', n('prod', 'Hilsen')) });

  // Et efterladt flow uden præfiks i non-prod-org'en. Det hører til INTET
  // miljø — prod bor i en anden org — og skal derfor ikke dukke op på tavlen.
  // Står et non-prod-miljø UDEN præfiks, er flowet dets — så giver det ingen
  // mening som eksempel, og det udelades.
  if (nonProd.every(s => pfx[s]))
    A.push({ name: 'Gammelt forsoeg', type: 'INBOUNDCALL', published: '1.0',
             publishedAt: now - 300 * day, content: demoYaml('Gammelt forsoeg', 'glemt') });

  A.forEach(demoRemember);
  B.forEach(demoRemember);
  d.flows[DEMO2_ORG_A] = A;
  d.flows[DEMO2_ORG_B] = B;
  // Nulstilling giver en ren tavle: demo 2's egne manifestrækker ryddes, og
  // kun dem — demo 1 skal ikke mærke det.
  if (d.manifest) for (const k of Object.keys(d.manifest))
    if (k.startsWith('demo2-')) delete d.manifest[k];
  saveDemo(d);
}

// De flows i et demo-miljø der bruger et common module. Demoen har ingen
// afhængighedssporing, så referencerne læses direkte ud af indholdet.
function demoDependentsOf(env, moduleName) {
  const siblings = loadCustomers().filter(c => isDemo(c) && demoFlowKey(c) === demoFlowKey(env));
  const base = baseFlowName(stripEnvPrefix(moduleName, env));
  return demoFlowsFor(env)
    .filter(f => belongsToEnv(f.name, env, siblings) && f.name !== moduleName)
    .filter(f => (scanYamlDependencies(f.content).commonmodule || [])
      .some(n => baseFlowName(stripEnvPrefix(n, env)) === base))
    .map(f => ({ name: f.name, type: f.type, published: f.published, hasDraft: false }));
}

module.exports = { dropDemoManifest, loadDemo, saveDemo, DEMO_TENANT, DEMO_GROUP, DEMO_ENVS,
  demoEnvId, DEMO2_TENANT, DEMO2_GROUP, DEMO2_ORG_A, DEMO2_ORG_B, DEMO2_ENVS, demo2EnvId,
  demo2EnvName, DEMO_DIVISIONS, seedDemo, demoRemember, demoFlowKey, demoFlowsFor, seedDemo2,
  demoDependentsOf };
