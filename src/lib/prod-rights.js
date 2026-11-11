// Skrivning til prod kræver et personligt login med rettigheden.

const axios = require('axios');
const { addLog } = require('./log');
const { loadCustomers } = require('./customers');
const { describeApiError } = require('./helpers');
const { stageOf, isDemo } = require('./environments');
const { tokenStore } = require('./sessions');
const { getToken } = require('./token');

// ── Skrivning til prod kræver en person med rettigheden ─────────────────────
// Et tjek af en indtastet e-mail beviser kun at DEN e-mail har rettigheden —
// ikke at det er dens ejer der sidder ved tastaturet. Derfor logger man ind i
// Genesys som sig selv (PKCE), og det er DET token der skriver. Genesys
// håndhæver så selv rettighederne, og audit-loggen viser personen.
//
// Et prod-miljø med client credentials kan stadig læses, men ikke skrives til:
// med en secret på disken kunne enhver ved maskinen deploye. Og selv med et
// gyldigt login gælder deploy-retten kun et stykke tid — et token lever et
// døgn, og en pc der står ulåst efter frokost skal ikke kunne deploye.

const PROD_DEPLOY_WINDOW = 30 * 60 * 1000;
const DEFAULT_DEPLOY_PERMISSION = 'architect:flow:publish';

// Hver rute der skriver til en org, og feltet der siger hvilket miljø. En ny
// skrivende rute SKAL stå her — test/prod-rettigheder.test.js fælder ellers.
// Rollback og release-noter finder miljøet via releasen og tjekker selv.
const PROD_WRITE_ROUTES = {
  '/api/import':                  'customerId',
  '/api/flows/publish':           'customerId',
  '/api/flows/republish':         'envId',
  '/api/manifest/create':         'envId',
  '/api/manifest/rebuild':        'envId',
  '/api/flows/baseline':          'targetId',
  '/api/migrate/prepare':         'targetId',
  '/api/migrate/commit':          'targetId',
  '/api/flows/migrate-dependency': 'targetId',
  '/api/actions/migrate':         'targetId',
  '/api/datatables/migrate':      'targetId',
  '/api/wrapupcodes/migrate':     'targetId',
  '/api/oauthclients/migrate':    'targetId',
  '/api/roles/migrate':           'targetId',
  '/api/integrations/migrate':    'targetId',
  '/api/data-actions/map':        'targetId',
  '/api/prompts/migrate':         'targetId',
  '/api/scripts/migrate':         'targetId',
  '/api/queues/migrate':          'targetId',
  '/api/skills/migrate':          'targetId',
  '/api/resources/create':        'targetId',
  '/api/resources/migrate':       'targetId',
  '/api/groups/migrate':          'targetId',
  '/api/schedules/migrate':       'targetId',
  '/api/schedulegroups/migrate':  'targetId',
  '/api/surveyforms/migrate':     'targetId',
  '/api/divisions/create':        'targetId',
  '/api/orgsettings/migrate':     'targetId',
  '/api/prefix/apply':            'envId'
};

function deployRequirements(env) {
  const permissions = String(env?.deployPermission || DEFAULT_DEPLOY_PERMISSION)
    .split(/[,\s]+/).filter(Boolean);
  return { permissions, group: String(env?.deployGroup || '').trim() };
}

// "architect:*:*" dækker "architect:flow:publish". Stjernen gælder et helt led.
//
// Genesys skriver rettigheder der gælder pr. division med divisionernes id'er
// som et fjerde led: "architect:flow:publish:<id>,<id>,…". Det er sådan ALLE
// flow-rettigheder ser ud, så med krav om præcis tre led blev selv en Master
// Admin afvist. Divisionerne ses der bort fra her — Genesys håndhæver dem selv,
// når Archy skriver med brugerens token.
function permissionGranted(held, wanted) {
  const h = String(held || '').split(':'), w = String(wanted || '').split(':');
  if (h.length < 3 || h.length > 4 || w.length !== 3) return false;
  return h.slice(0, 3).every((x, i) => x === '*' || x.toLowerCase() === w[i].toLowerCase());
}

// Hvad hver funktion i programmet kræver i Genesys. Forbindelsestesten holder
// miljøets rettigheder op mod listen, så man ser HVILKEN funktion der vil
// fejle — før man står midt i en migrering. credsOnly gælder kun client
// credentials (Archy slår sin egen klient op).
const PERMISSION_CHECKS = [
  // Archy eksporterer og importerer gennem Architects egen brugerflade og
  // fejler uden architect:ui:view — også når API'et gerne viser flowene.
  { area: 'flows_read',    perms: ['architect:flow:view', 'architect:ui:view'] },
  { area: 'flows_write',   perms: ['architect:flow:add', 'architect:flow:edit', 'architect:ui:view'] },
  { area: 'flows_publish', perms: ['architect:flow:publish'] },
  { area: 'archy_client',  perms: ['oauth:client:view'], credsOnly: true },
  { area: 'datatables',    perms: ['architect:datatable:view', 'architect:datatable:add',
                                   'architect:datatableRow:view', 'architect:datatableRow:add', 'architect:datatableRow:edit'] },
  { area: 'dataactions',   perms: ['integrations:integration:view', 'integrations:action:view', 'integrations:action:add'] },
  { area: 'prompts',       perms: ['architect:userPrompt:view', 'architect:userPrompt:add'] },
  { area: 'scripts',       perms: ['scripter:script:view', 'scripter:script:add', 'scripter:publishedScript:view', 'scripter:publishedScript:add'] },
  { area: 'divisions',     perms: ['authorization:division:view'] },
  { area: 'queues',        perms: ['routing:queue:view'] },
  { area: 'users',         perms: ['directory:user:view'] },
  { area: 'dependencies',  perms: ['architect:dependencyTracking:view'] },
];

// Med PKCE er det brugerens roller OG OAuth-klientens scopes der afgør hvad
// et kald må. Rollerne kunne være i orden, mens klienten manglede fx scopet
// scripts — og så fejlede hvert kald med app.not.authorized.for.scope. Det
// scope hver funktion kræver, og om læseadgang (:readonly) er nok.
const SCOPE_NEEDS = {
  flows_read: ['architect', true], flows_write: ['architect', false], flows_publish: ['architect', false],
  datatables: ['architect', false], dataactions: ['integrations', false], prompts: ['architect', false],
  scripts: ['scripts', false], divisions: ['authorization', true], queues: ['routing', true],
  users: ['users', true], dependencies: ['architect', true]
};

// Ren funktion. En klient uden scope-liste begrænser ikke, så intet ændres.
function applyClientScopes(checks, scopes) {
  if (!Array.isArray(scopes) || !scopes.length) return checks;
  return checks.map(c => {
    const need = SCOPE_NEEDS[c.area];
    if (!need) return c;
    const [scope, readonlyOk] = need;
    if (scopes.includes(scope) || (readonlyOk && scopes.includes(scope + ':readonly'))) return c;
    return { ...c, ok: false, unknown: false, missing: [...(c.missing || []), `scope ${scope}`] };
  });
}

// Ren vurdering: held er rettighederne som "domæne:entitet:handling[:division]".
function evaluatePermissions(held, authType) {
  return PERMISSION_CHECKS
    .filter(c => !(c.credsOnly && authType === 'oauth'))
    .map(c => {
      const missing = c.perms.filter(p => !held.some(h => permissionGranted(h, p)));
      return { area: c.area, ok: missing.length === 0, missing };
    });
}

// En rolles permissionPolicies som rettighedsstrenge.
const rolePermissions = role => (role?.permissionPolicies || []).flatMap(p =>
  (p.actionSet || []).map(a => `${p.domain}:${p.entityName}:${a}`));

// Miljøets faktiske rettigheder. En person (PKCE) slås op direkte; en klient
// (client credentials) via sine roller, hvilket kræver oauth:client:view og
// authorization:role:view. Kan de ikke læses, returneres null.
async function heldPermissions(customer, token, apiBase) {
  const H = { headers: { Authorization: `Bearer ${token}` } };
  if (customer.authType === 'oauth') {
    const me = await axios.get(`${apiBase}/api/v2/users/me`, { ...H, params: { expand: 'authorization' } });
    return me.data.authorization?.permissions || [];
  }
  try {
    const cl = await axios.get(`${apiBase}/api/v2/oauth/clients/${encodeURIComponent(customer.clientId)}`, H);
    const roleIds = [...new Set((cl.data.roleDivisions || []).map(r => r.roleId).filter(Boolean))];
    const roles = await Promise.all(roleIds.map(id =>
      axios.get(`${apiBase}/api/v2/authorization/roles/${encodeURIComponent(id)}`, H).then(r => r.data)));
    return roles.flatMap(rolePermissions);
  } catch (_) { return null; }
}

// Uden adgang til rollerne prøves læsningen af i stedet. Skriverettigheder kan
// ikke prøves uden at skrive, så de meldes som ukendte — ikke som i orden.
const READ_PROBES = {
  flows_read:   ['architect:flow:view',             '/api/v2/flows'],
  datatables:   ['architect:datatable:view',        '/api/v2/flows/datatables'],
  dataactions:  ['integrations:action:view',        '/api/v2/integrations/actions'],
  prompts:      ['architect:userPrompt:view',       '/api/v2/architect/prompts'],
  scripts:      ['scripter:script:view',            '/api/v2/scripts'],
  divisions:    ['authorization:division:view',     '/api/v2/authorization/divisions'],
  queues:       ['routing:queue:view',              '/api/v2/routing/queues'],
  users:        ['directory:user:view',             '/api/v2/users'],
};
// Nyere faner — org-indstillinger, Terraform, roller, OAuth, vidensbaser m.fl. — prøves ved at læse
// deres liste med brugerens eget login. Et 403 siger selv hvad der mangler (scope eller rettighed), og
// det er mere pålideligt end en liste over rettighedsstrenge der kunne være stavet forkert. Navnene
// er de samme som fanerne i Migrér ressourcer, så brugerfladen kan bruge deres tekster.
const LIVE_PROBES = [
  ['presence', '/api/v2/presencedefinitions'], ['orgset', '/api/v2/organizations/me'],
  ['skills', '/api/v2/routing/skills'], ['groups', '/api/v2/groups'], ['teams', '/api/v2/teams'],
  ['locations', '/api/v2/locations'], ['utilization', '/api/v2/routing/utilization/labels'],
  ['knowledgebases', '/api/v2/knowledge/knowledgebases'], ['responselibs', '/api/v2/responsemanagement/libraries'],
  ['schedules', '/api/v2/architect/schedules'], ['emergencygroups', '/api/v2/architect/emergencygroups'],
  ['contactlists', '/api/v2/outbound/contactlists'], ['wrapup', '/api/v2/routing/wrapupcodes'],
  ['roles', '/api/v2/authorization/roles'], ['oauth', '/api/v2/oauth/clients'],
  ['integ', '/api/v2/integrations'], ['evalforms', '/api/v2/quality/forms/evaluations'],
];

// Ren: hvad et afvist kald mangler. 403 → "scope x" eller den rettighed Genesys nævner; andre fejl → ukendt.
function liveProbeResult(area, status, data) {
  if (!status) return { area, ok: true, missing: [] };
  if (status !== 403) return { area, ok: false, unknown: true, missing: [] };
  const text = String((data && (data.message || data.error)) || '');
  const scope = text.match(/scope \[([^\]]+)\]/);
  if (scope) return { area, ok: false, missing: ['scope ' + scope[1].split(/[,\s]+/)[0]] };
  const perm = text.match(/permission[^\[]*\[([^\]]+)\]/i) || text.match(/([a-z]+:[A-Za-z]+:[a-z]+)/);
  return { area, ok: false, missing: [perm ? perm[1] : 'HTTP 403'] };
}

async function liveProbes(apiBase, token, skip = new Set()) {
  const H = { headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 1 } };
  return Promise.all(LIVE_PROBES.filter(([area]) => !skip.has(area)).map(async ([area, path]) => {
    try { await axios.get(apiBase + path, H); return liveProbeResult(area); }
    catch (e) { return liveProbeResult(area, e.response && e.response.status, e.response && e.response.data); }
  }));
}

async function probePermissions(customer, token, apiBase) {
  const H = { headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 1 } };
  const out = [];
  for (const c of PERMISSION_CHECKS) {
    if (c.credsOnly && customer.authType === 'oauth') continue;
    const probe = READ_PROBES[c.area];
    if (c.area === 'archy_client') {
      try { await axios.get(`${apiBase}/api/v2/oauth/clients/${encodeURIComponent(customer.clientId)}`, H);
            out.push({ area: c.area, ok: true, missing: [] }); }
      catch (e) { out.push(e.response?.status === 403
        ? { area: c.area, ok: false, missing: c.perms } : { area: c.area, ok: false, unknown: true, missing: [] }); }
      continue;
    }
    if (!probe) { out.push({ area: c.area, ok: false, unknown: true, missing: [] }); continue; }
    try { await axios.get(apiBase + probe[1], H); out.push({ area: c.area, ok: true, missing: [] }); }
    catch (e) {
      out.push(e.response?.status === 403
        ? { area: c.area, ok: false, missing: [probe[0]] }
        : { area: c.area, ok: false, unknown: true, missing: [] });
    }
  }
  return out;
}

// Ren vurdering af /users/me?expand=authorization,groups mod kravene.
// groupIds er id'erne på grupper med det krævede navn (null = ikke slået op).
function evaluateDeployRights(me, need, groupIds, now = Date.now(), lookupError = null) {
  const held = me?.authorization?.permissions || [];
  const missing = [];
  for (const p of need.permissions)
    if (!held.some(h => permissionGranted(h, p))) missing.push({ kind: 'permission', value: p });
  if (need.group) {
    if (lookupError) missing.push({ kind: 'lookup', value: `${need.group}: ${lookupError}` });
    else {
      const mine = (me?.groups || []).map(g => g.id);
      if (!(groupIds || []).some(id => mine.includes(id))) missing.push({ kind: 'group', value: need.group });
    }
  }
  const who = me?.email || me?.username || me?.name || me?.id || '?';
  return { ok: missing.length === 0, who, missing, checkedAt: now };
}

async function checkDeployRights(env) {
  const { token, apiBase } = await getToken(env);
  const H = { headers: { Authorization: `Bearer ${token}` } };
  const me = (await axios.get(`${apiBase}/api/v2/users/me`,
    { ...H, params: { expand: 'authorization,groups' } })).data;
  const need = deployRequirements(env);
  let groupIds = null, lookupError = null;
  if (need.group) {
    // Kan gruppen ikke slås op, er svaret nej. En vagt der lukker op når den
    // er i tvivl, er ingen vagt.
    try {
      const r = await axios.post(`${apiBase}/api/v2/groups/search`,
        { query: [{ type: 'EXACT', fields: ['name'], value: need.group }] }, H);
      groupIds = (r.data.results || []).map(g => g.id);
    } catch (e) { lookupError = describeApiError(e); }
  }
  return evaluateDeployRights(me, need, groupIds, Date.now(), lookupError);
}

const missingText = m => m.kind === 'permission' ? `rettigheden ${m.value}`
  : m.kind === 'group' ? `medlemskab af gruppen "${m.value}"`
  : `gruppeopslaget (${m.value})`;
const missingLog = m => m.kind === 'lookup' ? `group lookup failed (${m.value})` : `${m.kind} ${m.value}`;

// Returnerer null når skrivningen er tilladt, ellers { code, error }.
function prodWriteBlock(env, stored, now = Date.now()) {
  if (!env || isDemo(env) || stageOf(env) !== 'prod') return null;
  if (env.authType !== 'oauth')
    return { code: 'prod-oauth-required',
             error: `"${env.name}" er et prod-miljø med client credentials. Skrivning til prod kræver at du logger ind som dig selv — skift miljøet til OAuth (PKCE) under Kunder → ⚙ Indstillinger.` };
  if (!stored || now > stored.expiresAt || !stored.deploy)
    return { code: 'prod-login',
             error: `Log ind i "${env.name}" for at skrive til prod, og prøv igen.` };
  const d = stored.deploy;
  if (!d.ok)
    return { code: 'prod-rights',
             error: `${d.who} må ikke skrive til "${env.name}" — mangler ${d.missing.map(missingText).join(' og ')}.` };
  if (now - d.checkedAt > PROD_DEPLOY_WINDOW)
    return { code: 'prod-login',
             error: `Dit prod-login i "${env.name}" gælder ${PROD_DEPLOY_WINDOW / 60000} minutter og er udløbet. Log ind igen, og prøv igen.` };
  return null;
}

// Prod-vagtens egne indstillinger må ikke kunne slås fra af den den vogter.
// Uden dette kunne man sætte trinnet til "uat", skrive, og sætte det tilbage —
// eller fjerne gruppekravet. De felter der afgør OM og HVORDAN vagten gælder,
// kræver derfor samme login som en skrivning.
const PROD_GUARDED_FIELDS = ['stage', 'authType', 'clientId', 'region', 'deployPermission', 'deployGroup'];

function prodSettingsBlock(before, changed, stored, now = Date.now()) {
  if (!before || isDemo(before) || stageOf(before) !== 'prod') return null;
  if (!PROD_GUARDED_FIELDS.some(k => changed[k] !== undefined)) return null;
  // Et prod-miljø med client credentials kan ikke logge ind som en person.
  // Den eneste vej ud er at stramme: skifte til OAuth og blive i prod.
  if (before.authType !== 'oauth') {
    const efter = { ...before, ...changed };
    if (efter.authType === 'oauth' && stageOf(efter) === 'prod') return null;
    return { code: 'prod-oauth-required',
             error: `"${before.name}" er et prod-miljø med client credentials. Det eneste der kan ændres ved godkendelsen, er at skifte til OAuth (PKCE) — trinnet skal blive prod.` };
  }
  // Kun et nyt client id: ellers kan et prod-miljø hvis klient er slettet eller
  // forkert, aldrig rettes — rettelsen kræver et prod-login, og login'et går
  // gennem den gamle klient. Det svækker ikke vagten: skrivning kræver stadig
  // et friskt login med deploy-ret, og org-id'et bliver stående (se
  // keepsOrgOnClientChange), så den nye klients login skal lande i samme org.
  if (onlyClientIdChange(before, changed)) return null;
  const b = prodWriteBlock(before, stored, now);
  if (!b) return null;
  // Sig HVILKE felter der er låst. Ellers lignede en afvisning af et klientskift
  // en fejl, når det i virkeligheden var trinnet, der også var ændret i formularen.
  const laaste = PROD_GUARDED_FIELDS.filter(k => changed[k] !== undefined);
  const hint = laaste.includes('clientId') && before.authType === 'oauth'
    ? ` Et nyt Client ID alene kan gemmes uden login — sæt ${laaste.filter(k => k !== 'clientId').map(k => PROD_FIELD_NAMES[k]).join(' og ')} tilbage, og gem igen.`
    : '';
  return { ...b, fields: laaste,
           error: `Trin, godkendelse og deploy-krav på et prod-miljø kan kun ændres af en der må deploye dertil. ` +
                  `Du har ændret: ${laaste.map(k => PROD_FIELD_NAMES[k]).join(', ')}. ${b.error}${hint}` };
}

const PROD_FIELD_NAMES = { stage: 'trin', authType: 'godkendelse', clientId: 'Client ID', region: 'region',
                           deployPermission: 'deploy-rettighed', deployGroup: 'deploy-gruppe' };

const onlyClientIdChange = (before, changed) =>
  before.authType === 'oauth' && changed.clientId !== undefined &&
  PROD_GUARDED_FIELDS.filter(k => changed[k] !== undefined).every(k => k === 'clientId');

// Et prod-miljø med OAuth beholder sit org-id, når klienten skiftes. Ellers
// ville et klientskift uden prod-login løsne org-bindingen, og et login i en
// hvilken som helst org blive taget for prod.
const keepsOrgOnClientChange = (before, after) =>
  stageOf(before) === 'prod' && !isDemo(before) && before.authType === 'oauth' && after.authType === 'oauth' &&
  (before.region || '') === (after.region || '');

function refuseProdWrite(res, env, what) {
  const blocked = prodWriteBlock(env, env && tokenStore[env.id]);
  if (!blocked) return false;
  addLog('WARN', `Write to prod blocked (${blocked.code}): ${what} → ${env.name}`, env.name, 'SECURITY');
  res.status(403).json({ ...blocked, envId: env.id, envName: env.name });
  return true;
}

// Registreres øverst i filen, før ruterne — se app.use(prodWriteGate).
function prodWriteGate(req, res, next) {
  const field = req.method === 'POST' && PROD_WRITE_ROUTES[req.path];
  if (!field) return next();
  const env = loadCustomers().find(c => c.id === req.body?.[field]);
  if (refuseProdWrite(res, env, req.path)) return;
  next();
}

module.exports = { prodWriteGate, PERMISSION_CHECKS, prodSettingsBlock, keepsOrgOnClientChange,
  PROD_DEPLOY_WINDOW, DEFAULT_DEPLOY_PERMISSION, PROD_WRITE_ROUTES, deployRequirements,
  permissionGranted, applyClientScopes, evaluatePermissions, rolePermissions, heldPermissions,
  LIVE_PROBES, liveProbeResult, liveProbes, probePermissions, evaluateDeployRights,
  checkDeployRights, missingLog, prodWriteBlock, PROD_GUARDED_FIELDS, refuseProdWrite };
