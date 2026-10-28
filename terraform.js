// Terraform-generator: laver en opsætning til genesyscloud-provideren ud fra
// objekterne i en org. Ren kode — ingen netværk og ingen filer — så den kan testes.
// Serveren henter objekterne og skriver filerne.
//
// Det er en startopsætning, ikke en eksport af alt: hemmeligheder, medlemmer og
// ting der kun findes som filer eller org-specifikke id'er kommer ikke med. Alt
// der er udeladt, står i rapporten (notes) og i README.md i mappen.

'use strict';

// ── HCL ───────────────────────────────────────────────────────────────────────
class Ref { constructor(type, local, attr = 'id') { this.type = type; this.local = local; this.attr = attr; } }
class Raw { constructor(text) { this.text = text; } }   // færdig HCL, fx jsonencode(...)

const ref = (type, local, attr) => new Ref(type, local, attr);
const raw = text => new Raw(text);

function hclString(s) {
  return '"' + String(s)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    .replace(/\$\{/g, () => '$${').replace(/%\{/g, () => '%%{') + '"';
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const hclKey = k => IDENT.test(k) ? k : hclString(k);

function value(v, indent) {
  const pad = '  '.repeat(indent);
  if (v instanceof Ref) return `${v.type}.${v.local}.${v.attr}`;
  if (v instanceof Raw) return v.text;
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'string') return hclString(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every(x => typeof x !== 'object' || x instanceof Ref || x instanceof Raw)) return '[' + v.map(x => value(x, indent)).join(', ') + ']';
    return '[\n' + v.map(x => pad + '  ' + value(x, indent + 1) + ',').join('\n') + '\n' + pad + ']';
  }
  const keys = Object.keys(v);
  if (!keys.length) return '{}';
  return '{\n' + keys.map(k => `${pad}  ${hclKey(k)} = ${value(v[k], indent + 1)}`).join('\n') + '\n' + pad + '}';
}

// En ressource: attrs er [[navn, værdi], …] (rækkefølgen bevares), blocks er [[navn, attrs], …]
function render(type, local, attrs, blocks = [], comments = []) {
  const keep = attrs.filter(([, v]) => v !== undefined && v !== null);
  const width = Math.max(0, ...keep.map(([k]) => k.length));
  let out = comments.map(c => `# ${c}\n`).join('');
  out += `resource "${type}" "${local}" {\n`;
  for (const [k, v] of keep) out += `  ${k.padEnd(width)} = ${value(v, 1)}\n`;
  for (const [name, b] of blocks) out += blockText(name, b, 1);
  return out + '}\n';
}

function blockText(name, attrs, indent) {
  const pad = '  '.repeat(indent);
  const keep = attrs.filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0 && false));
  const width = Math.max(0, ...keep.filter(([, v]) => !(v && v.__block)).map(([k]) => k.length));
  let out = `${pad}${name} {\n`;
  for (const [k, v] of keep) {
    if (v && v.__block) out += v.blocks.map(b => blockText(k, b, indent + 1)).join('');
    else out += `${pad}  ${k.padEnd(width)} = ${value(v, indent + 1)}\n`;
  }
  return out + `${pad}}\n`;
}
const nested = blocks => ({ __block: true, blocks });

// ── Navne ─────────────────────────────────────────────────────────────────────
function localName(base, used) {
  let n = String(base || 'objekt').replace(/æ/gi, 'ae').replace(/ø/gi, 'oe').replace(/å/gi, 'aa')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!n) n = 'objekt';
  if (/^[0-9]/.test(n)) n = 'r_' + n;
  let out = n, i = 2;
  while (used.has(out)) out = `${n}_${i++}`;
  used.add(out);
  return out;
}

const present = x => x !== undefined && x !== null && x !== '';
const idOf = x => (x && typeof x === 'object' ? x.id : x);

// GET-datoer uden tidszone, med seks decimaler, som provideren ønsker dem
function tfDateTime(s) {
  if (!s) return undefined;
  let t = String(s).replace(/(Z|[+-]\d\d:?\d\d)$/, '');
  if (!/\./.test(t)) return t + '.000000';
  return t.replace(/\.(\d+)$/, (_, f) => '.' + (f + '000000').slice(0, 6));
}

// ── Typerne ───────────────────────────────────────────────────────────────────
// map(x, c) → { attrs, blocks?, comments?, skip?: 'årsag' }. c.ref(kind, id) giver
// en reference til et objekt der er med i opsætningen — ellers undefined.
// c.division(x) giver division_id, c.note(tekst) skriver i rapporten.
const KINDS = [
  { id: 'divisions', label: 'Divisioner', type: 'genesyscloud_auth_division', file: 'divisions.tf',
    list: '/api/v2/authorization/divisions',
    pre: x => x.homeDivision || x.name === 'Home' ? 'Home findes i enhver org' : null,
    map: x => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined]] }) },

  { id: 'skills', label: 'Skills', type: 'genesyscloud_routing_skill', file: 'skills.tf', list: '/api/v2/routing/skills',
    map: x => ({ attrs: [['name', x.name]] }) },

  { id: 'skillgroups', label: 'Skill-grupper', type: 'genesyscloud_routing_skill_group', file: 'skill_groups.tf', list: '/api/v2/routing/skillgroups',
    map: (x, c) => {
      if (x.skillConditions && x.skillConditions.length) c.note(`Skill-gruppen "${x.name}": reglerne (skill_conditions) indeholder skill-id'er fra kilden og er ikke med — tilføj dem i hånden.`);
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x, true)]],
        comments: x.skillConditions && x.skillConditions.length ? ['skill_conditions er udeladt — se rapporten.'] : [] };
    } },

  { id: 'groups', label: 'Grupper', type: 'genesyscloud_group', file: 'groups.tf', list: '/api/v2/groups',
    map: x => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['type', x.type], ['visibility', x.visibility], ['rules_visible', x.rulesVisible]],
      comments: ['Medlemmer og ejere er ikke med.'] }) },

  { id: 'teams', label: 'Teams', type: 'genesyscloud_team', file: 'teams.tf', list: '/api/v2/teams',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x)]],
      comments: ['Medlemmer er ikke med.'] }) },

  { id: 'locations', label: 'Lokationer', type: 'genesyscloud_location', file: 'locations.tf', list: '/api/v2/locations',
    map: (x, c) => {
      const a = x.address || {};
      const addr = Object.keys(a).length ? [['street1', a.street1], ['street2', a.street2], ['city', a.city], ['state', a.state], ['zip_code', a.zipcode || a.zipCode], ['country', a.country]] : null;
      if (x.emergencyNumber && x.emergencyNumber.number) c.note(`Lokationen "${x.name}": nødnummeret er ikke med (det er knyttet til den enkelte org).`);
      return { attrs: [['name', x.name], ['notes', present(x.notes) ? x.notes : undefined]], blocks: addr ? [['address', addr]] : [] };
    } },

  { id: 'utilization', label: 'Utilization-labels', type: 'genesyscloud_routing_utilization_label', file: 'utilization_labels.tf', list: '/api/v2/routing/utilization/labels',
    map: x => ({ attrs: [['name', x.name]] }) },

  { id: 'knowledgebases', label: 'Vidensbaser', type: 'genesyscloud_knowledge_knowledgebase', file: 'knowledge_bases.tf', list: '/api/v2/knowledge/knowledgebases',
    map: x => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['core_language', x.coreLocale || x.coreLanguage], ['published', x.published]],
      comments: ['Artikler og kategorier er ikke med.'] }) },

  { id: 'responselibs', label: 'Svarbiblioteker', type: 'genesyscloud_responsemanagement_library', file: 'response_libraries.tf', list: '/api/v2/responsemanagement/libraries',
    map: x => ({ attrs: [['name', x.name]] }) },

  { id: 'schedules', label: 'Åbningstider', type: 'genesyscloud_architect_schedules', file: 'schedules.tf', list: '/api/v2/architect/schedules',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['start', tfDateTime(x.start)], ['end', tfDateTime(x.end)],
      ['rrule', present(x.rrule) ? x.rrule : undefined], ['division_id', c.division(x, true)]] }) },

  { id: 'schedulegroups', label: 'Åbningstidsgrupper', type: 'genesyscloud_architect_schedulegroups', file: 'schedule_groups.tf', list: '/api/v2/architect/schedulegroups',
    map: (x, c) => {
      const refs = list => (list || []).map(s => c.ref('schedules', idOf(s))).filter(Boolean);
      const open = refs(x.openSchedules);
      if (!open.length) return { skip: 'ingen åbningstider i opsætningen — tag Åbningstider med' };
      const closed = refs(x.closedSchedules), holiday = refs(x.holidaySchedules);
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['time_zone', x.timeZone],
        ['open_schedules_id', open], ['closed_schedules_id', closed.length ? closed : undefined], ['holiday_schedules_id', holiday.length ? holiday : undefined],
        ['division_id', c.division(x, true)]] };
    } },

  { id: 'emergencygroups', label: 'Nødgrupper', type: 'genesyscloud_architect_emergencygroup', file: 'emergency_groups.tf', list: '/api/v2/architect/emergencygroups',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['enabled', false], ['division_id', c.division(x, true)]],
      comments: ['Oprettes slået fra og uden flows — sæt dem selv.'] }) },

  { id: 'contactlists', label: 'Kontaktlister', type: 'genesyscloud_outbound_contact_list', file: 'contact_lists.tf', list: '/api/v2/outbound/contactlists',
    map: (x, c) => {
      const cols = (list, f) => (list || []).map(f);
      const phone = cols(x.phoneColumns, p => [['column_name', p.columnName], ['type', p.type], ['callable_time_column_name', p.callableTimeColumn]]);
      const email = cols(x.emailColumns, p => [['column_name', p.columnName], ['type', p.type], ['contactable_time_column_name', p.contactableTimeColumn]]);
      return { attrs: [['name', x.name], ['column_names', x.columnNames || []], ['automatic_time_zone_mapping', x.automaticTimeZoneMapping],
        ['zip_code_column_name', present(x.zipCodeColumnName) ? x.zipCodeColumnName : undefined], ['division_id', c.division(x, true)]],
        blocks: [...phone.map(p => ['phone_columns', p]), ...email.map(p => ['email_columns', p])], comments: ['Selve kontakterne er ikke med.'] };
    } },

  { id: 'dnclists', label: 'DNC-lister', type: 'genesyscloud_outbound_dnclist', file: 'dnc_lists.tf', list: '/api/v2/outbound/dnclists',
    map: (x, c) => {
      if (['dnc.com', 'gryphon'].includes(x.dncSourceType)) return { skip: `typen ${x.dncSourceType} kræver udbyderens login/licens` };
      return { attrs: [['name', x.name], ['dnc_source_type', x.dncSourceType], ['contact_method', present(x.contactMethod) ? x.contactMethod : undefined],
        ['custom_exclusion_column', present(x.customExclusionColumn) ? x.customExclusionColumn : undefined], ['division_id', c.division(x, true)]],
        comments: ['Numrene på listen er ikke med.'] };
    } },

  { id: 'wrapup', label: 'Wrap-up-koder', type: 'genesyscloud_routing_wrapupcode', file: 'wrapup_codes.tf', list: '/api/v2/routing/wrapupcodes',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x, true)]] }) },

  { id: 'roles', label: 'Roller', type: 'genesyscloud_auth_role', file: 'roles.tf', list: '/api/v2/authorization/roles',
    pre: x => x.default ? 'standardrolle — findes i enhver org' : null,
    map: (x, c) => {
      const blocks = [];
      for (const p of x.permissionPolicies || []) {
        if (p.resourceConditionNode || p.namedResources) { c.note(`Rollen "${x.name}": en rettighed i ${p.domain}/${p.entityName} har betingelser og er ikke med.`); continue; }
        blocks.push(['permission_policies', [['domain', p.domain], ['entity_name', p.entityName], ['action_set', p.actionSet || []]]]);
      }
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined],
        ['permissions', x.permissions && x.permissions.length ? x.permissions : undefined]], blocks };
    } },

  { id: 'oauth', label: 'OAuth-klienter', type: 'genesyscloud_oauth_client', file: 'oauth_clients.tf', list: '/api/v2/oauth/clients',
    map: (x, c) => {
      const blocks = (x.roleDivisions || []).map(rd => {
        const role = c.roleRef(rd.roleId);
        if (!role) { c.note(`OAuth-klienten "${x.name}": en rolle kunne ikke findes og er ikke med.`); return null; }
        return ['roles', [['role_id', role], ['division_id', rd.divisionId === '*' ? '*' : (c.ref('divisions', rd.divisionId) || c.homeDivisionRef())]]];
      }).filter(Boolean);
      return { attrs: [['name', x.name], ['authorized_grant_type', x.authorizedGrantType], ['description', present(x.description) ? x.description : undefined],
        ['access_token_validity_seconds', x.accessTokenValiditySeconds], ['registered_redirect_uris', x.registeredRedirectUri && x.registeredRedirectUri.length ? x.registeredRedirectUri : undefined],
        ['scopes', x.scope && x.scope.length ? x.scope : undefined], ['state', x.state]], blocks,
        comments: ['Klientens secret kopieres aldrig — Genesys giver en ny, når klienten oprettes.'] };
    } },

  { id: 'integrations', label: 'Integrationer', type: 'genesyscloud_integration', file: 'integrations.tf', list: '/api/v2/integrations',
    map: (x, c) => {
      c.note(`Integrationen "${x.name}": adgangsoplysninger og typespecifik konfiguration er ikke med — udfyld dem efter oprettelsen.`);
      return { attrs: [['integration_type', idOf(x.integrationType)], ['intended_state', x.intendedState || 'DISABLED']], blocks: [['config', [['name', x.name]]]] };
    } },

  { id: 'actions', label: 'Data Actions', type: 'genesyscloud_integration_action', file: 'data_actions.tf', list: '/api/v2/integrations/actions',
    detail: x => ({ path: `/api/v2/integrations/actions/${encodeURIComponent(x.id)}`, params: { expand: 'contract', includeConfig: true } }),
    map: (x, c) => {
      if (String(x.id).startsWith('static_')) return { skip: 'indbygget action' };
      if (/^custom_/.test(String(x.id)) === false && x.config === undefined && x.contract === undefined) return { skip: 'detaljerne kunne ikke hentes' };
      const integ = c.ref('integrations', x.integrationId);
      if (!integ) return { skip: 'integrationen er ikke med i opsætningen — tag Integrationer med' };
      if (x.config && x.config.request === undefined && x.config.response === undefined) return { skip: 'Function Data Action — koden (zip-fil) kan ikke hentes herfra' };
      const req = (x.config && x.config.request) || {}, resp = (x.config && x.config.response) || {};
      const input = x.contract && x.contract.input && x.contract.input.inputSchema, output = x.contract && x.contract.output && x.contract.output.successSchema;
      const blocks = [];
      if (Object.keys(req).length) blocks.push(['config_request', [['request_type', req.requestType], ['request_url_template', req.requestUrlTemplate], ['request_template', req.requestTemplate],
        ['headers', req.headers && Object.keys(req.headers).length ? req.headers : undefined]]]);
      if (Object.keys(resp).length) blocks.push(['config_response', [['success_template', resp.successTemplate],
        ['translation_map', resp.translationMap && Object.keys(resp.translationMap).length ? resp.translationMap : undefined],
        ['translation_map_defaults', resp.translationMapDefaults && Object.keys(resp.translationMapDefaults).length ? resp.translationMapDefaults : undefined]]]);
      return { attrs: [['name', x.name], ['category', x.category], ['integration_id', integ], ['secure', !!x.secure],
        ['contract_input', raw(`jsonencode(${value(stripUris(input || { type: 'object', properties: {} }), 1)})`)],
        ['contract_output', raw(`jsonencode(${value(stripUris(output || { type: 'object', properties: {} }), 1)})`)]], blocks };
    } },

  { id: 'tables', label: 'Data Tabeller', type: 'genesyscloud_architect_datatable', file: 'data_tables.tf', list: '/api/v2/flows/datatables', params: { expand: 'schema' },
    map: (x, c) => {
      const props = (x.schema && x.schema.properties) || {};
      const names = Object.keys(props).sort((a, b) => (a === 'key' ? -1 : b === 'key' ? 1 : 0));
      if (!names.length) return { skip: 'ingen kolner' };
      const blocks = names.map(n => ['properties', [['name', n], ['type', props[n].type], ['title', props[n].title],
        ['default', present(props[n].default) ? String(props[n].default) : undefined]]]);
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x)]], blocks,
        comments: ['Kun strukturen — rækkerne er ikke med.'] };
    } },

  { id: 'prompts', label: 'User Prompts', type: 'genesyscloud_architect_user_prompt', file: 'user_prompts.tf', list: '/api/v2/architect/prompts',
    map: (x, c) => {
      const blocks = [];
      let audio = 0;
      for (const r of x.resources || []) {
        if (!(r.ttsString || r.text)) { if (r.mediaUri) audio++; continue; }
        if (r.mediaUri) audio++;
        blocks.push(['resources', [['language', r.language], ['text', present(r.text) ? r.text : undefined], ['tts_string', present(r.ttsString) ? r.ttsString : undefined]]]);
      }
      if (audio) c.note(`Prompten "${x.name}": indspillet lyd er ikke med (kun tekst og TTS) — lyd skal tilføjes som filer.`);
      if (!blocks.length) return { skip: 'ingen tekst eller TTS — kun indspillet lyd' };
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined]], blocks };
    } },

  { id: 'queues', label: 'Køer', type: 'genesyscloud_routing_queue', file: 'queues.tf', list: '/api/v2/routing/queues',
    map: (x, c) => {
      const ms = (m) => {
        if (!m) return null;
        const a = [['alerting_timeout_sec', m.alertingTimeoutSeconds], ['enable_auto_answer', m.enableAutoAnswer],
          ['service_level_percentage', m.serviceLevel && m.serviceLevel.percentage], ['service_level_duration_ms', m.serviceLevel && m.serviceLevel.durationMs]];
        return a.some(([, v]) => v !== undefined && v !== null) ? a : null;
      };
      const blocks = [];
      for (const [k, name] of [['call', 'media_settings_call'], ['callback', 'media_settings_callback'], ['chat', 'media_settings_chat'], ['email', 'media_settings_email']]) {
        const m = ms(x.mediaSettings && x.mediaSettings[k]); if (m) blocks.push([name, m]);
      }
      for (const r of x.routingRules || []) blocks.push(['routing_rules', [['operator', r.operator], ['threshold', r.threshold], ['wait_seconds', r.waitSeconds]]]);
      if (x.bullseye && x.bullseye.rings && x.bullseye.rings.length) c.note(`Køen "${x.name}": bullseye-ringene er ikke med.`);
      if (x.queueFlow || x.defaultScripts) c.note(`Køen "${x.name}": kø-flow og scripts er ikke med.`);
      const acw = x.acwSettings || {};
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x, true)],
        ['acw_wrapup_prompt', acw.wrapupPrompt], ['acw_timeout_ms', acw.timeoutMs], ['skill_evaluation_method', x.skillEvaluationMethod],
        ['scoring_method', x.scoringMethod], ['auto_answer_only', x.autoAnswerOnly], ['enable_transcription', x.enableTranscription],
        ['enable_audio_monitoring', x.enableAudioMonitoring], ['enable_manual_assignment', x.enableManualAssignment],
        ['suppress_in_queue_call_recording', x.suppressInQueueCallRecording], ['calling_party_name', present(x.callingPartyName) ? x.callingPartyName : undefined]],
        blocks, comments: ['Medlemmer, wrap-up-koder, skills, flows og bullseye er ikke med — se rapporten.'] };
    } },
];

// Dele af et JSON-schema der peger på kildens id'er
function stripUris(s) {
  if (Array.isArray(s)) return s.map(stripUris);
  if (s && typeof s === 'object') {
    const o = {};
    for (const k of Object.keys(s)) if (k !== '$schema' && k !== '$id' && k !== 'selfUri') o[k] = stripUris(s[k]);
    return o;
  }
  return s;
}

// ── Samlingen ─────────────────────────────────────────────────────────────────
// data: { kindId: [objekter] }, lookup: { roles: [...alle roller], divisions: [...] }
// options: { include: [kindId,…], orgName, flows: [{ name, file }] }
function build(data, options = {}) {
  const include = new Set(options.include || KINDS.map(k => k.id));
  const lookup = options.lookup || {};
  const notes = [];
  const note = t => { if (!notes.includes(t)) notes.push(t); };
  const summary = [];
  const count = {};
  const reg = new Map();      // `${kind}:${id}` → Ref
  const used = {};            // pr. ressourcetype
  const plan = [];            // { kind, item, local }

  // 1. Navne først, så referencer kan pege frem
  for (const k of KINDS) {
    if (!include.has(k.id)) continue;
    used[k.type] = used[k.type] || new Set();
    for (const x of data[k.id] || []) {
      // Det der skippes her, får ingen reference — ellers ville andre pege på noget der ikke findes
      const why = k.pre && k.pre(x);
      if (why) {
        const s0 = count[k.id] = count[k.id] || { id: k.id, label: k.label, type: k.type, total: 0, written: 0, skipped: [] };
        s0.total++; s0.skipped.push({ name: x.name, reason: why });
        continue;
      }
      const local = localName(x.name, used[k.type]);
      reg.set(`${k.id}:${x.id}`, ref(k.type, local));
      plan.push({ k, x, local });
    }
  }

  let homeUsed = false;
  const dataBlocks = new Map();   // navn → tekst
  const homeRef = () => { homeUsed = true; return ref('data.genesyscloud_auth_division_home', 'home'); };
  const roleDataRef = role => {
    const local = 'role_' + localName(role.name, new Set());
    if (!dataBlocks.has(local)) dataBlocks.set(local, `data "genesyscloud_auth_role" "${local}" {\n  name = ${hclString(role.name)}\n}\n`);
    return ref('data.genesyscloud_auth_role', local);
  };
  const ctx = {
    ref: (kind, id) => reg.get(`${kind}:${id}`),
    note,
    homeDivisionRef: homeRef,
    // division_id: referencen hvis divisionen er med, ellers Home — eller ingenting, hvis provideren selv vælger
    division: (x, optional) => {
      const id = idOf(x.division);
      if (id === '*') return undefined;             // alle divisioner — provideren vælger selv
      if (!id) return optional ? undefined : homeRef();
      const r = reg.get(`divisions:${id}`);
      if (r) return r;
      const d = (lookup.divisions || []).find(v => v.id === id);
      if (d && (d.homeDivision || d.name === 'Home')) return homeRef();
      note(`"${x.name}" ligger i divisionen "${(d && d.name) || id}", som ikke er med i opsætningen — division_id er udeladt.`);
      return optional ? undefined : homeRef();
    },
    roleRef: id => {
      const own = reg.get(`roles:${id}`);
      if (own) return own;
      const role = (lookup.roles || []).find(r => r.id === id);
      return role ? roleDataRef(role) : null;
    },
  };

  // 2. Ressourcerne
  const files = {};
  for (const { k, x, local } of plan) {
    const r = k.map(x, ctx);
    const s = count[k.id] = count[k.id] || { id: k.id, label: k.label, type: k.type, total: 0, written: 0, skipped: [] };
    s.total++;
    if (r.skip) { s.skipped.push({ name: x.name, reason: r.skip }); continue; }
    files[k.file] = (files[k.file] || '') + (files[k.file] ? '\n' : '') + render(k.type, local, r.attrs, r.blocks || [], r.comments || []);
    s.written++;
  }

  // 3. Flows fra lokale YAML-filer
  const flows = options.flows || [];
  if (include.has('flows')) {
    const used2 = new Set();
    const s = { id: 'flows', label: 'Flows', type: 'genesyscloud_flow', total: flows.length, written: 0, skipped: [] };
    for (const f of flows) {
      const local = localName(f.name, used2);
      files['flows.tf'] = (files['flows.tf'] ? files['flows.tf'] + '\n' : '') +
        render('genesyscloud_flow', local, [['filepath', raw(`"\${path.module}/flows/${f.file.replace(/"/g, '')}"`)]], [], ['Afhængigheder (køer, tabeller, prompts …) skal findes, før flowet publiceres.']);
      s.written++;
    }
    summary.push(s);
  }
  for (const k of KINDS) if (count[k.id]) summary.push(count[k.id]);
  for (const [id, error] of Object.entries(options.errors || {})) {
    const k = KINDS.find(x => x.id === id);
    if (k) summary.push({ id, label: k.label, type: k.type, total: 0, written: 0, skipped: [], error });
  }

  // 4. Data-blokke
  let data_tf = '';
  if (homeUsed) data_tf += 'data "genesyscloud_auth_division_home" "home" {}\n\n';
  for (const t of dataBlocks.values()) data_tf += t + '\n';
  if (data_tf) files['data.tf'] = data_tf.trimEnd() + '\n';

  // 5. Provider og variabler
  files['versions.tf'] =
`terraform {
  required_providers {
    genesyscloud = {
      source = "mypurecloud/genesyscloud"
      # version = "~> 1.0"   # lås gerne til en version, I har afprøvet
    }
  }
}
`;
  files['provider.tf'] =
`# Org'en der skal ændres: kør terraform apply med oplysningerne for MÅL-org'en.
provider "genesyscloud" {
  oauthclient_id     = var.oauthclient_id
  oauthclient_secret = var.oauthclient_secret
  aws_region         = var.aws_region
}
`;
  files['variables.tf'] =
`variable "oauthclient_id" {
  type        = string
  description = "Client ID på en OAuth-klient (Client Credentials) i mål-org'en"
}

variable "oauthclient_secret" {
  type        = string
  sensitive   = true
  description = "Client secret — gem den ikke i filer, brug miljøvariabel eller en hemmelighedsstyring"
}

variable "aws_region" {
  type        = string
  description = "Mål-org'ens region, fx eu-west-1 eller us-east-1"
}
`;
  files['terraform.tfvars.example'] =
`# Kopiér til terraform.tfvars (og undgå at committe den). Secret kan i stedet sættes
# med miljøvariablen TF_VAR_oauthclient_secret.
oauthclient_id = "..."
aws_region     = "us-east-1"
`;
  files['.gitignore'] = '.terraform/\n*.tfstate\n*.tfstate.*\nterraform.tfvars\n';

  files['README.md'] = readme(options.orgName || '', summary, notes);
  return { files, summary, notes };
}

function readme(orgName, summary, notes) {
  const rows = summary.map(s => `| ${s.label} | ${s.error ? 'kunne ikke læses: ' + s.error : s.written + ' af ' + s.total} |`).join('\n');
  const skipped = summary.flatMap(s => s.skipped.map(x => `- ${s.label}: **${x.name}** — ${x.reason}`));
  return `# Terraform-opsætning${orgName ? ' — ' + orgName : ''}

Genereret af Archy GUI. Opsætningen bygger de valgte objekter i en Genesys Cloud-org med
[genesyscloud-provideren](https://registry.terraform.io/providers/MyPureCloud/genesyscloud/latest/docs).
Det er en **startopsætning**: læs den igennem og afprøv den i en test-org, før den bruges i drift.

## Sådan bruges den

1. Opret en OAuth-klient (Client Credentials) i **mål-org'en** med de roller, der skal til for at oprette objekterne.
2. Kopiér \`terraform.tfvars.example\` til \`terraform.tfvars\` og udfyld klient-id og region. Secret sættes med \`TF_VAR_oauthclient_secret\`.
3. \`terraform init\`, \`terraform plan\` og \`terraform apply\`.

Ændrer I noget i kilde-org'en, laver Archy GUI en ny opsætning, og \`terraform plan\` viser forskellen mod mål-org'en.

## Indhold

| Type | Med |
|---|---|
${rows}

## Det der ikke er med

- Hemmeligheder: OAuth-klienters secrets og integrationers adgangsoplysninger.
- Medlemmer af køer, grupper og teams, samt brugere.
- Indhold: kontakter, DNC-numre, artikler i vidensbaser og rækker i datatabeller.
- Indspillet lyd i prompts og filer til scripts (de kræver lokale filer).
- Betingede rettigheder i roller og ting, der er knyttet til den enkelte org (nødnumre, flow-id'er).
${skipped.length ? '\n### Udeladt i denne kørsel\n\n' + skipped.join('\n') : ''}
${notes.length ? '\n### Bemærkninger\n\n' + notes.map(n => '- ' + n).join('\n') : ''}
`;
}

module.exports = { KINDS, build, render, value, hclString, localName, tfDateTime, stripUris, ref, raw, Ref, Raw };
