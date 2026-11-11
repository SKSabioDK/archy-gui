// Miljøer: kunde → gruppe → trin, virtuelle miljøer i samme org og præfikser.

const { addLog } = require('./log');
const { loadCustomers, saveCustomers } = require('./customers');
const { STAGES, stageOrder, FLOW_KINDS } = require('./conventions');

const UNGROUPED = '__ungrouped__';
const tenantOf = c => (c.tenant || '').trim() || UNGROUPED;
const groupOf  = c => (c.group  || '').trim() || UNGROUPED;
const stageOf  = c => { const s = String(c.stage || '').toLowerCase(); return STAGES.includes(s) ? s : null; };

// ── Virtuelle miljøer i samme org ────────────────────────────────────────────
// Nogle kunder har ikke én org pr. miljø, men ÉN org hvor miljøerne kendes på
// et præfiks: "DEV_Main flow", "TEST_Main flow", og prod uden præfiks. Samme
// konvention gælder datatabellerne. Det er et udbredt Genesys-mønster, og det
// findes allerede i jeres egne orgs.
//
// Et miljø er derfor stadig én post i customers.json — flere poster kan blot
// pege på samme org med hvert sit præfiks. Så virker tavlen, forfremmelsen og
// manifestet uændret; kun udvælgelsen af flows skal kende præfikset.
const prefixOf = c => String(c.prefix || '');

// Samme credentials = samme fysiske org. Det kan afgøres uden et opslag, og
// bruges til at hente flowlisten én gang og dele den mellem søskendemiljøer.
//
// Org-id'et fra Genesys er den rigtige nøgle. Client ID + region er kun en
// nødløsning indtil id'et kendes: to miljøer i SAMME org kan sagtens have hver
// sin OAuth-klient — fx dev med client credentials og prod med PKCE — og så
// troede værktøjet at de lå i hver sin org, og prod så dev's flows.
//
// Et PKCE-miljø uden kendt org får sin egen nøgle: klienten kan logge ind i
// flere orgs via trusted orgs, så to miljøer på samme PKCE-klient må ikke dele
// flowliste før org'en er set ved login.
const orgKeyOf = c => isDemo(c) ? `demo:${c.demoOrg || c.id}`
  : c.orgId ? `org:${c.orgId}`
  : c.authType === 'oauth' ? `env:${c.id}` : `${c.clientId}|${c.region}`;

// Et miljø der endnu ikke kender sin org, må ikke tage en org der allerede
// hører til en anden kunde (tenant). Søskende i samme tenant deler gerne org —
// Sabio's dev og prod gør — men en kundes org i Sabio's pipeline er et fejlvalg
// på login-siden.
const orgOwnedElsewhere = (customer, orgId, all) => !customer?.orgId && orgId
  ? all.find(c => c.id !== customer.id && !isDemo(c) && c.orgId === orgId && tenantOf(c) !== tenantOf(customer)) || null
  : null;

// Står et token i en anden org end den miljøet allerede er kendt i? Med PKCE
// vælger BRUGEREN org'en på Genesys' login-side — og med trusted orgs kan en
// Sabio-bruger vælge en kundes org. Klienten binder ikke org'en; det gør kun
// login'et. Et miljø uden kendt org-id kan ikke afsløre noget.
const wrongOrg = (customer, orgId) => !!(customer?.orgId && orgId && customer.orgId !== orgId);

// Kun client credentials er bundet til klientens egen org. Et PKCE-login kan
// lande i en trusted org, så samme klient siger intet om samme org der.
const clientPinsOrg = c => !isDemo(c) && c.authType !== 'oauth';

// Husker org-id'et på miljøet — og på alle miljøer med samme client
// credentials-klient, for de ligger nødvendigvis i samme org. Sker én gang pr.
// miljø. Et kendt org-id overskrives ALDRIG: et login i en anden org gjorde
// før prod til et søskende af kundens org, og så hentedes kundens flows som
// prod's. Skifter et miljø reelt org, ændrer man klient eller region, og så
// nulstilles id'et dér.
function rememberOrgId(customer, orgId) {
  if (!orgId || !customer || isDemo(customer)) return;
  if (wrongOrg(customer, orgId)) {
    addLog('ERROR', `Refused to change the org id of ${customer.name}: known ${customer.orgId}, got ${orgId}`, customer.name, 'SECURITY');
    return;
  }
  customer.orgId = orgId;
  const all = loadCustomers();
  let changed = false;
  for (const c of all) {
    const sameClient = clientPinsOrg(customer) && clientPinsOrg(c) &&
                       c.clientId === customer.clientId && c.region === customer.region;
    if ((c.id === customer.id || sameClient) && !isDemo(c) && !c.orgId) { c.orgId = orgId; changed = true; }
  }
  if (changed) {
    saveCustomers(all);
    addLog('INFO', `Org id recorded for ${customer.name}: ${orgId}`, customer.name, 'CUSTOMER');
  }
}

// Hører flownavnet til dette miljø? Et præfikset miljø tager kun sine egne.
// Prod har intet præfiks og tager alt DER IKKE bærer et søskendepræfiks —
// ellers ville prod se hele orgen, dev og test inklusive.
//
// Søskendene er dem der er tilføjet på DENNE pc. Er UAT uden præfiks tilføjet
// alene, kendte den ikke DEV_ og TEST_, og så var "DEV_Betaling" UAT's flow.
// takenPrefixes er de præfikser org'en selv har vist sig at bruge (fundet ved
// opdagelsen og husket i opsætningsrækken), så de holdes ude uanset hvad der
// er tilføjet lokalt.
function belongsToEnv(name, env, siblings) {
  const p = prefixOf(env);
  const n = String(name || '');
  if (p) return n.startsWith(p);
  const andre = [...siblings.filter(s => s !== env).map(prefixOf), ...(env.takenPrefixes || [])];
  return !andre.some(x => x && n.startsWith(x));
}

function stripEnvPrefix(name, env) {
  const p = prefixOf(env);
  const n = String(name || '');
  return p && n.startsWith(p) ? n.slice(p.length) : n;
}

// Navnet et flow skal have i et givet miljø: præfikset sat på grundnavnet.
const withEnvPrefix = (baseName, env) => prefixOf(env) + String(baseName || '');

// Hvilke ressourcetyper der bærer miljøets præfiks.
//
// Datatabeller gør — det er konventionen i orgen. Flows gør, og et common
// module ER et flow, så det følger med af sig selv. Køer, skills, wrap-up-koder
// og scripts er derimod fælles for hele org'en og duplikeres ikke pr. virtuelt
// miljø; ville man præfikse dem, ledte vi efter noget der aldrig har eksisteret.
//
// Data actions står bevidst udenfor indtil det er afklaret: de hører til en
// integration, og om man duplikerer dem pr. miljø afhænger af opsætningen.
const prefixedKinds = () => new Set(['datatable', ...FLOW_KINDS]);

// Navnet en afhængighed har i et givet miljø.
function depNameIn(kind, name, env, source) {
  if (!prefixedKinds().has(kind)) return name;
  return withEnvPrefix(stripEnvPrefix(name, source), env);
}

// Inde i et præfikset miljø peger flowet på de præfiksede ressourcer. Uden
// denne omskrivning ville DEV_-flowet pege tilbage på prods tabel — og så
// ville dev og prod dele data, hvilket er lige præcis dét man ville undgå.
// Divisionen hører til miljøet, ikke til flowet. Opretter man i division DEV og
// forfremmer til UAT, skal flowet skifte med — ellers ville UAT-udgaven ligge i
// dev's division. Er der ingen division sat på målet, bruges Home.
const divisionOf = c => (c && String(c.division || '').trim()) || 'Home';

// Kun flowets EGEN division (øverste niveau) skrives om. Længere nede kan der
// stå udtryk som Task.division, og de skal stå urørt.
function setFlowDivisionInYaml(yaml, division) {
  let done = false;
  const eol = /\r\n/.test(yaml) ? '\r\n' : '\n';
  return String(yaml).split(/\r?\n/).map(l => {
    if (done) return l;
    const m = l.match(/^([ \t]{2,})division:([ \t]*)(.*)$/);
    if (!m) return l;
    done = true;
    const varQuoted = /^".*"$|^'.*'$/.test(m[3].trim());
    return `${m[1]}division:${m[2] || ' '}${varQuoted ? JSON.stringify(division) : division}`;
  }).join(eol);
}

function prefixDependenciesInYaml(yaml, source, target) {
  if (prefixOf(source) === prefixOf(target)) return { yaml: String(yaml), changed: [] };
  const changed = [];
  let out = String(yaml);
  for (const tag of ['dataTable', 'commonModule', 'botFlow']) {
    // INDRYKNING KRÆVES. På indrykning 0 er 'commonModule:' ikke en reference
    // til et andet modul — det er flowets EGEN type, og linjen under er dets
    // navnefelt. Uden kravet blev
    //
    //     commonModule:
    //       name: Create Logitems
    //
    // til "DEV_name:", flowet mistede sit navn, og Archy afviste importen med
    // "the flow name 'undefined' is invalid". scanYamlDependencies har haft
    // kravet hele tiden — her manglede det.
    const re = new RegExp(`(^[ \\t]+${tag}:[ \\t]*\\r?\\n[ \\t]+)([^\\r\\n:]+)(:)`, 'gm');
    out = out.replace(re, (hele, hoved, navn, hale) => {
      const rent = navn.trim();
      // «botFlow:» kan også stå som flowets eget felt; nøgler som name/lit er ikke et flownavn.
      if (/^(name|lit|id|description)$/.test(rent)) return hele;
      const ny = withEnvPrefix(stripEnvPrefix(rent, source), target);
      if (ny === rent) return hele;
      if (!changed.includes(`${rent} → ${ny}`)) changed.push(`${rent} → ${ny}`);
      return `${hoved}${ny}${hale}`;
    });
  }
  // Transfer to Flow og Transfer to ACD peger på et flow med «name: X» under
  // nøglen — ikke med navnet som nøgle, som de tre ovenfor.
  const reNavn = /(^[ \t]+(?:targetFlow|overrideInQueueFlow):[ \t]*\r?\n(?:[ \t]+lit:[ \t]*\r?\n)?[ \t]+name:[ \t]*["']?)([^\r\n"']+?)(["']?[ \t]*\r?$)/gm;
  out = out.replace(reNavn, (hele, hoved, navn, hale) => {
    const ny = withEnvPrefix(stripEnvPrefix(navn.trim(), source), target);
    if (ny === navn.trim()) return hele;
    if (!changed.includes(`${navn.trim()} → ${ny}`)) changed.push(`${navn.trim()} → ${ny}`);
    return `${hoved}${ny}${hale}`;
  });
  return { yaml: out, changed };
}

// To miljøer må kun sammenlignes og migreres indbyrdes hvis de deler kunde OG
// gruppe. Miljøer uden gruppe hører ikke sammen med noget — heller ikke med
// hinanden — så en manglende opsætning aldrig kan læses som "de hører sammen".
function sameGroup(a, b) {
  if (!a || !b) return false;
  if (tenantOf(a) === UNGROUPED || groupOf(a) === UNGROUPED) return false;
  if (tenantOf(b) === UNGROUPED || groupOf(b) === UNGROUPED) return false;
  return tenantOf(a) === tenantOf(b) && groupOf(a) === groupOf(b);
}

function buildHierarchy(customers) {
  const tenants = new Map();
  for (const c of customers) {
    const t = tenantOf(c), g = groupOf(c);
    if (!tenants.has(t)) tenants.set(t, new Map());
    const groups = tenants.get(t);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({
      id: c.id, name: c.name, region: c.region,
      stage: stageOf(c), authType: c.authType || 'credentials'
    });
  }
  const out = [];
  for (const [tenant, groups] of tenants) {
    const gs = [];
    for (const [group, envs] of groups) {
      envs.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.name.localeCompare(b.name));
      gs.push({ group, named: group !== UNGROUPED, environments: envs });
    }
    gs.sort((a, b) => a.group.localeCompare(b.group));
    out.push({
      tenant, named: tenant !== UNGROUPED, groups: gs,
      // Brugerfladen skjuler gruppeniveauet når kunden kun har én gruppe —
      // gruppen er der stadig, den fylder bare ikke.
      singleGroup: gs.length === 1
    });
  }
  out.sort((a, b) => (a.named === b.named) ? a.tenant.localeCompare(b.tenant) : (a.named ? -1 : 1));
  return out;
}
const isDemo = c => !!(c && c.demo);

module.exports = { wrongOrg, UNGROUPED, tenantOf, groupOf, stageOf, prefixOf, orgKeyOf, isDemo,
  orgOwnedElsewhere, clientPinsOrg, rememberOrgId, belongsToEnv, stripEnvPrefix, withEnvPrefix,
  depNameIn, divisionOf, setFlowDivisionInYaml, prefixDependenciesInYaml, sameGroup,
  buildHierarchy };
