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
    pre: (x, c) => x.homeDivision || x.name === 'Home' ? c.t('skip_home') : null,
    map: x => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined]] }) },

  { id: 'skills', label: 'Skills', type: 'genesyscloud_routing_skill', file: 'skills.tf', list: '/api/v2/routing/skills',
    map: x => ({ attrs: [['name', x.name]] }) },

  { id: 'skillgroups', label: 'Skill-grupper', type: 'genesyscloud_routing_skill_group', file: 'skill_groups.tf', list: '/api/v2/routing/skillgroups',
    map: (x, c) => {
      if (x.skillConditions && x.skillConditions.length) c.note(c.t('n_skillcond', { name: x.name }));
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x, true)]],
        comments: x.skillConditions && x.skillConditions.length ? [c.t('c_skillcond')] : [] };
    } },

  { id: 'groups', label: 'Grupper', type: 'genesyscloud_group', file: 'groups.tf', list: '/api/v2/groups',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['type', x.type], ['visibility', x.visibility], ['rules_visible', x.rulesVisible]],
      comments: [c.t('c_group_members')] }) },

  { id: 'teams', label: 'Teams', type: 'genesyscloud_team', file: 'teams.tf', list: '/api/v2/teams',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x)]],
      comments: [c.t('c_team_members')] }) },

  { id: 'locations', label: 'Lokationer', type: 'genesyscloud_location', file: 'locations.tf', list: '/api/v2/locations',
    map: (x, c) => {
      const a = x.address || {};
      const addr = Object.keys(a).length ? [['street1', a.street1], ['street2', a.street2], ['city', a.city], ['state', a.state], ['zip_code', a.zipcode || a.zipCode], ['country', a.country]] : null;
      if (x.emergencyNumber && x.emergencyNumber.number) c.note(c.t('n_location_emerg', { name: x.name }));
      return { attrs: [['name', x.name], ['notes', present(x.notes) ? x.notes : undefined]], blocks: addr ? [['address', addr]] : [] };
    } },

  { id: 'utilization', label: 'Utilization-labels', type: 'genesyscloud_routing_utilization_label', file: 'utilization_labels.tf', list: '/api/v2/routing/utilization/labels',
    map: x => ({ attrs: [['name', x.name]] }) },

  { id: 'knowledgebases', label: 'Vidensbaser', type: 'genesyscloud_knowledge_knowledgebase', file: 'knowledge_bases.tf', list: '/api/v2/knowledge/knowledgebases',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['core_language', x.coreLocale || x.coreLanguage], ['published', x.published]],
      comments: [c.t('c_kb_content')] }) },

  { id: 'responselibs', label: 'Svarbiblioteker', type: 'genesyscloud_responsemanagement_library', file: 'response_libraries.tf', list: '/api/v2/responsemanagement/libraries',
    map: x => ({ attrs: [['name', x.name]] }) },

  { id: 'schedules', label: 'Åbningstider', type: 'genesyscloud_architect_schedules', file: 'schedules.tf', list: '/api/v2/architect/schedules',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['start', tfDateTime(x.start)], ['end', tfDateTime(x.end)],
      ['rrule', present(x.rrule) ? x.rrule : undefined], ['division_id', c.division(x, true)]] }) },

  { id: 'schedulegroups', label: 'Åbningstidsgrupper', type: 'genesyscloud_architect_schedulegroups', file: 'schedule_groups.tf', list: '/api/v2/architect/schedulegroups',
    map: (x, c) => {
      const refs = list => (list || []).map(s => c.ref('schedules', idOf(s))).filter(Boolean);
      const open = refs(x.openSchedules);
      if (!open.length) return { skip: c.t('skip_no_schedules') };
      const closed = refs(x.closedSchedules), holiday = refs(x.holidaySchedules);
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['time_zone', x.timeZone],
        ['open_schedules_id', open], ['closed_schedules_id', closed.length ? closed : undefined], ['holiday_schedules_id', holiday.length ? holiday : undefined],
        ['division_id', c.division(x, true)]] };
    } },

  { id: 'emergencygroups', label: 'Nødgrupper', type: 'genesyscloud_architect_emergencygroup', file: 'emergency_groups.tf', list: '/api/v2/architect/emergencygroups',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['enabled', false], ['division_id', c.division(x, true)]],
      comments: [c.t('c_emergency')] }) },

  { id: 'contactlists', label: 'Kontaktlister', type: 'genesyscloud_outbound_contact_list', file: 'contact_lists.tf', list: '/api/v2/outbound/contactlists',
    map: (x, c) => {
      const cols = (list, f) => (list || []).map(f);
      const phone = cols(x.phoneColumns, p => [['column_name', p.columnName], ['type', p.type], ['callable_time_column_name', p.callableTimeColumn]]);
      const email = cols(x.emailColumns, p => [['column_name', p.columnName], ['type', p.type], ['contactable_time_column_name', p.contactableTimeColumn]]);
      return { attrs: [['name', x.name], ['column_names', x.columnNames || []], ['automatic_time_zone_mapping', x.automaticTimeZoneMapping],
        ['zip_code_column_name', present(x.zipCodeColumnName) ? x.zipCodeColumnName : undefined], ['division_id', c.division(x, true)]],
        blocks: [...phone.map(p => ['phone_columns', p]), ...email.map(p => ['email_columns', p])], comments: [c.t('c_contacts')] };
    } },

  { id: 'dnclists', label: 'DNC-lister', type: 'genesyscloud_outbound_dnclist', file: 'dnc_lists.tf', list: '/api/v2/outbound/dnclists',
    map: (x, c) => {
      if (['dnc.com', 'gryphon'].includes(x.dncSourceType)) return { skip: c.t('skip_dnc_login', { type: x.dncSourceType }) };
      return { attrs: [['name', x.name], ['dnc_source_type', x.dncSourceType], ['contact_method', present(x.contactMethod) ? x.contactMethod : undefined],
        ['custom_exclusion_column', present(x.customExclusionColumn) ? x.customExclusionColumn : undefined], ['division_id', c.division(x, true)]],
        comments: [c.t('c_dnc')] };
    } },

  { id: 'wrapup', label: 'Wrap-up-koder', type: 'genesyscloud_routing_wrapupcode', file: 'wrapup_codes.tf', list: '/api/v2/routing/wrapupcodes',
    map: (x, c) => ({ attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x, true)]] }) },

  { id: 'roles', label: 'Roller', type: 'genesyscloud_auth_role', file: 'roles.tf', list: '/api/v2/authorization/roles',
    pre: (x, c) => x.default ? c.t('skip_default_role') : null,
    map: (x, c) => {
      const blocks = [];
      for (const p of x.permissionPolicies || []) {
        if (p.resourceConditionNode || p.namedResources) { c.note(c.t('n_role_cond', { name: x.name, domain: p.domain, entity: p.entityName })); continue; }
        blocks.push(['permission_policies', [['domain', p.domain], ['entity_name', p.entityName], ['action_set', p.actionSet || []]]]);
      }
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined],
        ['permissions', x.permissions && x.permissions.length ? x.permissions : undefined]], blocks };
    } },

  { id: 'oauth', label: 'OAuth-klienter', type: 'genesyscloud_oauth_client', file: 'oauth_clients.tf', list: '/api/v2/oauth/clients',
    map: (x, c) => {
      const blocks = (x.roleDivisions || []).map(rd => {
        const role = c.roleRef(rd.roleId);
        if (!role) { c.note(c.t('n_oauth_role', { name: x.name })); return null; }
        return ['roles', [['role_id', role], ['division_id', rd.divisionId === '*' ? '*' : (c.ref('divisions', rd.divisionId) || c.homeDivisionRef())]]];
      }).filter(Boolean);
      return { attrs: [['name', x.name], ['authorized_grant_type', x.authorizedGrantType], ['description', present(x.description) ? x.description : undefined],
        ['access_token_validity_seconds', x.accessTokenValiditySeconds], ['registered_redirect_uris', x.registeredRedirectUri && x.registeredRedirectUri.length ? x.registeredRedirectUri : undefined],
        ['scopes', x.scope && x.scope.length ? x.scope : undefined], ['state', x.state]], blocks,
        comments: [c.t('c_oauth_secret')] };
    } },

  { id: 'integrations', label: 'Integrationer', type: 'genesyscloud_integration', file: 'integrations.tf', list: '/api/v2/integrations',
    map: (x, c) => {
      c.note(c.t('n_integration', { name: x.name }));
      return { attrs: [['integration_type', idOf(x.integrationType)], ['intended_state', x.intendedState || 'DISABLED']], blocks: [['config', [['name', x.name]]]] };
    } },

  { id: 'actions', label: 'Data Actions', type: 'genesyscloud_integration_action', file: 'data_actions.tf', list: '/api/v2/integrations/actions',
    detail: x => ({ path: `/api/v2/integrations/actions/${encodeURIComponent(x.id)}`, params: { expand: 'contract', includeConfig: true } }),
    map: (x, c) => {
      if (String(x.id).startsWith('static_')) return { skip: c.t('skip_static_action') };
      if (/^custom_/.test(String(x.id)) === false && x.config === undefined && x.contract === undefined) return { skip: c.t('skip_no_details') };
      const integ = c.ref('integrations', x.integrationId);
      if (!integ) return { skip: c.t('skip_no_integration') };
      if (x.config && x.config.request === undefined && x.config.response === undefined) return { skip: c.t('skip_function_action') };
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
      if (!names.length) return { skip: c.t('skip_no_columns') };
      const blocks = names.map(n => ['properties', [['name', n], ['type', props[n].type], ['title', props[n].title],
        ['default', present(props[n].default) ? String(props[n].default) : undefined]]]);
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x)]], blocks,
        comments: [c.t('c_datatable_rows')] };
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
      if (audio) c.note(c.t('n_prompt_audio', { name: x.name }));
      if (!blocks.length) return { skip: c.t('skip_no_tts') };
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
      if (x.bullseye && x.bullseye.rings && x.bullseye.rings.length) c.note(c.t('n_bullseye', { name: x.name }));
      if (x.queueFlow || x.defaultScripts) c.note(c.t('n_queue_flow', { name: x.name }));
      const acw = x.acwSettings || {};
      return { attrs: [['name', x.name], ['description', present(x.description) ? x.description : undefined], ['division_id', c.division(x, true)],
        ['acw_wrapup_prompt', acw.wrapupPrompt], ['acw_timeout_ms', acw.timeoutMs], ['skill_evaluation_method', x.skillEvaluationMethod],
        ['scoring_method', x.scoringMethod], ['auto_answer_only', x.autoAnswerOnly], ['enable_transcription', x.enableTranscription],
        ['enable_audio_monitoring', x.enableAudioMonitoring], ['enable_manual_assignment', x.enableManualAssignment],
        ['suppress_in_queue_call_recording', x.suppressInQueueCallRecording], ['calling_party_name', present(x.callingPartyName) ? x.callingPartyName : undefined]],
        blocks, comments: [c.t('c_queue')] };
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

// ── Tekster i de genererede filer ─────────────────────────────────────────────
// Filerne følger appens sprog: dansk, engelsk og tysk. Andre sprog får engelsk.
const MSG = {
  da: {
    skip_home: 'Home findes i enhver org', skip_default_role: 'standardrolle — findes i enhver org', skip_no_schedules: 'ingen åbningstider i opsætningen — tag Åbningstider med',
    skip_dnc_login: 'typen {type} kræver udbyderens login/licens', skip_static_action: 'indbygget action', skip_no_details: 'detaljerne kunne ikke hentes',
    skip_no_integration: 'integrationen er ikke med i opsætningen — tag Integrationer med', skip_function_action: 'Function Data Action — koden (zip-fil) kan ikke hentes herfra',
    skip_no_columns: 'ingen kolonner', skip_no_tts: 'ingen tekst eller TTS — kun indspillet lyd',
    n_skillcond: 'Skill-gruppen "{name}": reglerne (skill_conditions) indeholder skill-id\'er fra kilden og er ikke med — tilføj dem i hånden.',
    n_location_emerg: 'Lokationen "{name}": nødnummeret er ikke med (det er knyttet til den enkelte org).',
    n_role_cond: 'Rollen "{name}": en rettighed i {domain}/{entity} har betingelser og er ikke med.',
    n_oauth_role: 'OAuth-klienten "{name}": en rolle kunne ikke findes og er ikke med.',
    n_integration: 'Integrationen "{name}": adgangsoplysninger og typespecifik konfiguration er ikke med — udfyld dem efter oprettelsen.',
    n_prompt_audio: 'Prompten "{name}": indspillet lyd er ikke med (kun tekst og TTS) — lyd skal tilføjes som filer.',
    n_bullseye: 'Køen "{name}": bullseye-ringene er ikke med.', n_queue_flow: 'Køen "{name}": kø-flow og scripts er ikke med.',
    c_skillcond: 'skill_conditions er udeladt — se README.md.', c_group_members: 'Medlemmer og ejere er ikke med.', c_team_members: 'Medlemmer er ikke med.',
    c_kb_content: 'Artikler og kategorier er ikke med.', c_emergency: 'Oprettes slået fra og uden flows — sæt dem selv.', c_contacts: 'Selve kontakterne er ikke med.',
    c_dnc: 'Numrene på listen er ikke med.', c_oauth_secret: 'Klientens secret kopieres aldrig — Genesys giver en ny, når klienten oprettes.',
    c_datatable_rows: 'Kun strukturen — rækkerne er ikke med.', c_queue: 'Medlemmer, wrap-up-koder, skills, flows og bullseye er ikke med — se README.md.',
    c_flow_deps: 'Afhængigheder (køer, tabeller, prompts …) skal findes, før flowet publiceres.',
    vers_comment: 'Som i providerens egen vejledning. Lås gerne til en version, I har afprøvet.',
    prov_comment: 'Kør terraform apply med oplysningerne for MÅL-org\'en. Er en værdi tom (null), bruger provideren miljøvariablerne GENESYSCLOUD_OAUTHCLIENT_ID, GENESYSCLOUD_OAUTHCLIENT_SECRET og GENESYSCLOUD_REGION.',
    v_id: 'Client ID på en OAuth-klient (Client Credentials) i mål-org\'en. Tom = miljøvariablen GENESYSCLOUD_OAUTHCLIENT_ID.',
    v_secret: 'Client secret. Gem den ikke i filer — brug miljøvariablen GENESYSCLOUD_OAUTHCLIENT_SECRET eller en hemmelighedsstyring.',
    v_region: 'Mål-org\'ens AWS-region, fx eu-west-1 eller us-east-1. Tom = miljøvariablen GENESYSCLOUD_REGION.',
    v_division: 'ID på divisionen "{name}" i mål-org\'en. Divisionen er ikke med i opsætningen, så id\'et skal udfyldes.',
    tfvars_comment: 'Udfyld id\'erne fra mål-org\'en, før terraform plan. Filen ligger i .gitignore.',
    ex_comment: 'Kopiér til terraform.tfvars (og undgå at committe den). Secret kan i stedet sættes med miljøvariablen GENESYSCLOUD_OAUTHCLIENT_SECRET.',
  },
  en: {
    skip_home: 'Home exists in every org', skip_default_role: 'default role — exists in every org', skip_no_schedules: 'no schedules in the setup — include Schedules',
    skip_dnc_login: 'type {type} needs the provider\'s login/licence', skip_static_action: 'built-in action', skip_no_details: 'the details could not be fetched',
    skip_no_integration: 'the integration is not in the setup — include Integrations', skip_function_action: 'Function Data Action — the code (zip file) cannot be fetched from here',
    skip_no_columns: 'no columns', skip_no_tts: 'no text or TTS — recorded audio only',
    n_skillcond: 'Skill group "{name}": the rules (skill_conditions) contain skill ids from the source and are not included — add them by hand.',
    n_location_emerg: 'Location "{name}": the emergency number is not included (it belongs to the individual org).',
    n_role_cond: 'Role "{name}": a permission in {domain}/{entity} has conditions and is not included.',
    n_oauth_role: 'OAuth client "{name}": a role could not be found and is not included.',
    n_integration: 'Integration "{name}": credentials and type-specific configuration are not included — fill them in after creation.',
    n_prompt_audio: 'Prompt "{name}": recorded audio is not included (text and TTS only) — add audio as files.',
    n_bullseye: 'Queue "{name}": the bullseye rings are not included.', n_queue_flow: 'Queue "{name}": the in-queue flow and scripts are not included.',
    c_skillcond: 'skill_conditions is left out — see README.md.', c_group_members: 'Members and owners are not included.', c_team_members: 'Members are not included.',
    c_kb_content: 'Articles and categories are not included.', c_emergency: 'Created disabled and without flows — set them yourself.', c_contacts: 'The contacts themselves are not included.',
    c_dnc: 'The numbers on the list are not included.', c_oauth_secret: 'The client secret is never copied — Genesys issues a new one when the client is created.',
    c_datatable_rows: 'Structure only — the rows are not included.', c_queue: 'Members, wrap-up codes, skills, flows and bullseye are not included — see README.md.',
    c_flow_deps: 'Dependencies (queues, tables, prompts …) must exist before the flow is published.',
    vers_comment: 'As in the provider\'s own guide. Pin to a version you have tested.',
    prov_comment: 'Run terraform apply with the details of the TARGET org. If a value is empty (null), the provider uses the environment variables GENESYSCLOUD_OAUTHCLIENT_ID, GENESYSCLOUD_OAUTHCLIENT_SECRET and GENESYSCLOUD_REGION.',
    v_id: 'Client ID of an OAuth client (Client Credentials) in the target org. Empty = the environment variable GENESYSCLOUD_OAUTHCLIENT_ID.',
    v_secret: 'Client secret. Do not store it in files — use the environment variable GENESYSCLOUD_OAUTHCLIENT_SECRET or a secrets manager.',
    v_region: 'The target org\'s AWS region, e.g. eu-west-1 or us-east-1. Empty = the environment variable GENESYSCLOUD_REGION.',
    v_division: 'ID of the division "{name}" in the target org. The division is not part of the setup, so the id must be filled in.',
    tfvars_comment: 'Fill in the ids from the target org before terraform plan. The file is in .gitignore.',
    ex_comment: 'Copy to terraform.tfvars (and avoid committing it). The secret can instead be set with the environment variable GENESYSCLOUD_OAUTHCLIENT_SECRET.',
  },
  de: {
    skip_home: 'Home existiert in jeder Org', skip_default_role: 'Standardrolle — existiert in jeder Org', skip_no_schedules: 'keine Zeitpläne im Setup — Zeitpläne mit aufnehmen',
    skip_dnc_login: 'Typ {type} erfordert Login/Lizenz des Anbieters', skip_static_action: 'eingebaute Aktion', skip_no_details: 'die Details konnten nicht abgerufen werden',
    skip_no_integration: 'die Integration ist nicht im Setup — Integrationen mit aufnehmen', skip_function_action: 'Function Data Action — der Code (Zip-Datei) kann von hier nicht abgerufen werden',
    skip_no_columns: 'keine Spalten', skip_no_tts: 'kein Text oder TTS — nur aufgenommenes Audio',
    n_skillcond: 'Skill-Gruppe "{name}": die Regeln (skill_conditions) enthalten Skill-IDs der Quelle und sind nicht enthalten — von Hand ergänzen.',
    n_location_emerg: 'Standort "{name}": die Notrufnummer ist nicht enthalten (sie gehört zur jeweiligen Org).',
    n_role_cond: 'Rolle "{name}": eine Berechtigung in {domain}/{entity} hat Bedingungen und ist nicht enthalten.',
    n_oauth_role: 'OAuth-Client "{name}": eine Rolle wurde nicht gefunden und ist nicht enthalten.',
    n_integration: 'Integration "{name}": Zugangsdaten und typspezifische Konfiguration sind nicht enthalten — nach dem Anlegen ausfüllen.',
    n_prompt_audio: 'Prompt "{name}": aufgenommenes Audio ist nicht enthalten (nur Text und TTS) — Audio als Dateien ergänzen.',
    n_bullseye: 'Warteschlange "{name}": die Bullseye-Ringe sind nicht enthalten.', n_queue_flow: 'Warteschlange "{name}": In-Queue-Flow und Skripte sind nicht enthalten.',
    c_skillcond: 'skill_conditions wurde weggelassen — siehe README.md.', c_group_members: 'Mitglieder und Eigentümer sind nicht enthalten.', c_team_members: 'Mitglieder sind nicht enthalten.',
    c_kb_content: 'Artikel und Kategorien sind nicht enthalten.', c_emergency: 'Wird deaktiviert und ohne Flows angelegt — selbst setzen.', c_contacts: 'Die Kontakte selbst sind nicht enthalten.',
    c_dnc: 'Die Nummern der Liste sind nicht enthalten.', c_oauth_secret: 'Das Client Secret wird nie kopiert — Genesys vergibt beim Anlegen ein neues.',
    c_datatable_rows: 'Nur die Struktur — die Zeilen sind nicht enthalten.', c_queue: 'Mitglieder, Wrap-up-Codes, Skills, Flows und Bullseye sind nicht enthalten — siehe README.md.',
    c_flow_deps: 'Abhängigkeiten (Warteschlangen, Tabellen, Prompts …) müssen existieren, bevor der Flow veröffentlicht wird.',
    vers_comment: 'Wie in der Anleitung des Providers. Auf eine erprobte Version festlegen.',
    prov_comment: 'terraform apply mit den Angaben der ZIEL-Org ausführen. Ist ein Wert leer (null), verwendet der Provider die Umgebungsvariablen GENESYSCLOUD_OAUTHCLIENT_ID, GENESYSCLOUD_OAUTHCLIENT_SECRET und GENESYSCLOUD_REGION.',
    v_id: 'Client ID eines OAuth-Clients (Client Credentials) in der Ziel-Org. Leer = Umgebungsvariable GENESYSCLOUD_OAUTHCLIENT_ID.',
    v_secret: 'Client Secret. Nicht in Dateien speichern — Umgebungsvariable GENESYSCLOUD_OAUTHCLIENT_SECRET oder ein Secrets-Manager.',
    v_region: 'AWS-Region der Ziel-Org, z. B. eu-west-1 oder us-east-1. Leer = Umgebungsvariable GENESYSCLOUD_REGION.',
    v_division: 'ID der Division "{name}" in der Ziel-Org. Die Division gehört nicht zum Setup, daher muss die ID ausgefüllt werden.',
    tfvars_comment: 'Vor terraform plan die IDs der Ziel-Org eintragen. Die Datei steht in .gitignore.',
    ex_comment: 'Nach terraform.tfvars kopieren (und nicht committen). Das Secret kann stattdessen per Umgebungsvariable GENESYSCLOUD_OAUTHCLIENT_SECRET gesetzt werden.',
  },
};

function translator(lang) {
  const m = MSG[lang] || MSG.en;
  return (key, params = {}) => String(m[key] !== undefined ? m[key] : MSG.en[key] || key).replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
}

// Genesys-regionen (domænet) → AWS-regionen som provideren vil have
const AWS_REGION = {
  'mypurecloud.com': 'us-east-1', 'mypurecloud.de': 'eu-central-1', 'mypurecloud.ie': 'eu-west-1', 'mypurecloud.com.au': 'ap-southeast-2',
  'mypurecloud.jp': 'ap-northeast-1', 'usw2.pure.cloud': 'us-west-2', 'cac1.pure.cloud': 'ca-central-1', 'euw2.pure.cloud': 'eu-west-2',
  'apse2.pure.cloud': 'ap-southeast-2',
};
const awsRegion = region => AWS_REGION[region] || null;

// ── Samlingen ─────────────────────────────────────────────────────────────────
// data: { kindId: [objekter] }, lookup: { roles: [...alle roller], divisions: [...] }
// options: { include, orgName, targetName, targetRegion, lang, errors, flows: [{ name, file }] }
function build(data, options = {}) {
  const include = new Set(options.include || KINDS.map(k => k.id));
  const lookup = options.lookup || {};
  const t = translator(options.lang);
  const notes = [];
  const note = x => { if (!notes.includes(x)) notes.push(x); };
  const summary = [];
  const count = {};
  const reg = new Map();      // `${kind}:${id}` → Ref
  const used = {};            // pr. ressourcetype
  const plan = [];            // { kind, item, local }
  const refVars = new Map();  // variabelnavn → divisionens navn
  const refVarOf = new Map(); // division-id → variabelnavn
  const usedVars = new Set();

  // 1. Navne først, så referencer kan pege frem
  for (const k of KINDS) {
    if (!include.has(k.id)) continue;
    used[k.type] = used[k.type] || new Set();
    for (const x of data[k.id] || []) {
      // Det der skippes her, får ingen reference — ellers ville andre pege på noget der ikke findes
      const why = k.pre && k.pre(x, { t });
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
  // En division der ikke er med i opsætningen, bliver en variabel, som i providerens egen eksport:
  // værdien udfyldes med divisionens id i mål-org'en.
  const divisionVar = (id, name) => {
    if (!refVarOf.has(id)) {
      const v = 'division_' + localName(name || id, usedVars) + '_id';
      refVarOf.set(id, v); refVars.set(v, name || id);
    }
    return raw('var.' + refVarOf.get(id));
  };
  const ctx = {
    t,
    ref: (kind, id) => reg.get(`${kind}:${id}`),
    note,
    homeDivisionRef: homeRef,
    // division_id: referencen hvis divisionen er med, ellers Home eller en variabel — eller ingenting, hvis provideren selv vælger
    division: (x, optional) => {
      const id = idOf(x.division);
      if (id === '*') return undefined;             // alle divisioner — provideren vælger selv
      if (!id) return optional ? undefined : homeRef();
      const r = reg.get(`divisions:${id}`);
      if (r) return r;
      const d = (lookup.divisions || []).find(v => v.id === id);
      if (d && (d.homeDivision || d.name === 'Home')) return homeRef();
      return divisionVar(id, d && d.name);
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
    const s = count[k.id] = count[k.id] || { id: k.id, label: k.label, type: k.type, file: k.file, total: 0, written: 0, skipped: [] };
    s.total++;
    if (r.skip) { s.skipped.push({ name: x.name, reason: r.skip }); continue; }
    files[k.file] = (files[k.file] || '') + (files[k.file] ? '\n' : '') + render(k.type, local, r.attrs, r.blocks || [], r.comments || []);
    s.written++;
  }

  // 3. Flows fra lokale YAML-filer (mappen hedder som i providerens egen eksport)
  const flows = options.flows || [];
  if (include.has('flows')) {
    const used2 = new Set();
    const s = { id: 'flows', label: 'Flows', type: 'genesyscloud_flow', file: 'flows.tf', total: flows.length, written: 0, skipped: [] };
    for (const f of flows) {
      const local = localName(f.name, used2);
      files['flows.tf'] = (files['flows.tf'] ? files['flows.tf'] + '\n' : '') +
        render('genesyscloud_flow', local, [['filepath', raw(`"\${path.module}/${FLOW_DIR}/${f.file.replace(/"/g, '')}"`)]], [], [t('c_flow_deps')]);
      s.written++;
    }
    summary.push(s);
  }
  for (const k of KINDS) if (count[k.id]) summary.push(count[k.id]);
  for (const [id, error] of Object.entries(options.errors || {})) {
    const k = KINDS.find(x => x.id === id);
    if (k) summary.push({ id, label: k.label, type: k.type, file: k.file, total: 0, written: 0, skipped: [], error });
  }

  // 4. Data-blokke
  let data_tf = '';
  if (homeUsed) data_tf += 'data "genesyscloud_auth_division_home" "home" {}\n\n';
  for (const d of dataBlocks.values()) data_tf += d + '\n';
  if (data_tf) files['data.tf'] = data_tf.trimEnd() + '\n';

  // 5. Provider og variabler — som i providerens egen vejledning (versions, miljøvariabler)
  const region = awsRegion(options.targetRegion);
  files['versions.tf'] =
`terraform {
  required_version = ">= 1.0.0"
  required_providers {
    genesyscloud = {
      source  = "mypurecloud/genesyscloud"
      version = ">= 1.6.0" # ${t('vers_comment')}
    }
  }
}
`;
  files['provider.tf'] =
`# ${t('prov_comment')}
provider "genesyscloud" {
  oauthclient_id     = var.oauthclient_id
  oauthclient_secret = var.oauthclient_secret
  aws_region         = var.aws_region
}
`;
  const divVars = [...refVars].map(([v, name]) => `\nvariable "${v}" {\n  type        = string\n  description = ${hclString(t('v_division', { name }))}\n}\n`).join('');
  files['variables.tf'] =
`variable "oauthclient_id" {
  type        = string
  default     = null
  description = ${hclString(t('v_id'))}
}

variable "oauthclient_secret" {
  type        = string
  default     = null
  sensitive   = true
  description = ${hclString(t('v_secret'))}
}

variable "aws_region" {
  type        = string
  default     = ${region ? hclString(region) : 'null'}
  description = ${hclString(t('v_region'))}
}
${divVars}`;
  files['terraform.tfvars.example'] =
`# ${t('ex_comment')}
oauthclient_id = "..."
aws_region     = ${hclString(region || 'us-east-1')}
`;
  if (refVars.size)
    files['terraform.tfvars'] = `# ${t('tfvars_comment')}\n` + [...refVars].map(([v, name]) => `${v} = ""  # ${name}`).join('\n') + '\n';
  files['.gitignore'] = '.terraform/\n*.tfstate\n*.tfstate.*\nterraform.tfvars\n';

  files['README.md'] = readme(options.lang, { source: options.orgName || '', target: options.targetName || '', region, summary, notes, refVars });
  return { files, summary, notes };
}

const FLOW_DIR = 'architect_flows';

// ── README.md ─────────────────────────────────────────────────────────────────
const R = {
  da: {
    title: 'Terraform-opsætning', hdrFrom: 'Fra', hdrTo: 'Til', toUnknown: '(vælges ved apply)',
    intro: 'Genereret af Archy GUI. Opsætningen bygger de valgte objekter i en Genesys Cloud-org med [genesyscloud-provideren](https://registry.terraform.io/providers/MyPureCloud/genesyscloud/latest/docs) (CX as Code). Den beskriver **kildens** objekter; den org, der ændres, er den, I kører `terraform apply` mod. Det er en **startopsætning**: læs den igennem og afprøv den i en test-org, før den bruges i drift.',
    use: 'Sådan bruges den', s1: 'Opret en OAuth-klient (Client Credentials) i **mål-org\'en** med de roller, der skal til for at oprette objekterne.',
    s2: 'Giv providerens oplysninger med miljøvariablerne `GENESYSCLOUD_OAUTHCLIENT_ID`, `GENESYSCLOUD_OAUTHCLIENT_SECRET` og `GENESYSCLOUD_REGION` — eller kopiér `terraform.tfvars.example` til `terraform.tfvars`.',
    s3: '`terraform init`, `terraform plan` og `terraform apply`.', s4: 'Ændrer I noget i kilde-org\'en, laver Archy GUI en ny opsætning, og `terraform plan` viser forskellen mod mål-org\'en.',
    vars: 'Variabler der skal udfyldes', varsText: 'Disse divisioner er ikke med i opsætningen. Udfyld deres id i mål-org\'en i `terraform.tfvars`:',
    content: 'Indhold', cType: 'Ressource', cFile: 'Fil', cIncl: 'Med', unreadable: 'kunne ikke læses', of: 'af',
    missing: 'Det der ikke er med',
    m1: 'Hemmeligheder: OAuth-klienters secrets og integrationers adgangsoplysninger.', m2: 'Medlemmer af køer, grupper og teams, samt brugere.',
    m3: 'Indhold: kontakter, DNC-numre, artikler i vidensbaser og rækker i datatabeller.', m4: 'Indspillet lyd i prompts og filer til scripts (de kræver lokale filer).',
    m5: 'Betingede rettigheder i roller og ting, der er knyttet til den enkelte org (nødnumre, flow-id\'er).', m6: 'Survey- og evalueringsformularer, scripts og Function Data Actions.',
    left: 'Udeladt i denne kørsel', remarks: 'Bemærkninger',
  },
  en: {
    title: 'Terraform setup', hdrFrom: 'From', hdrTo: 'To', toUnknown: '(chosen at apply)',
    intro: 'Generated by Archy GUI. The setup builds the selected objects in a Genesys Cloud org with the [genesyscloud provider](https://registry.terraform.io/providers/MyPureCloud/genesyscloud/latest/docs) (CX as Code). It describes the **source** objects; the org that changes is the one you run `terraform apply` against. It is a **starting setup**: read it through and try it in a test org before using it in production.',
    use: 'How to use it', s1: 'Create an OAuth client (Client Credentials) in the **target org** with the roles needed to create the objects.',
    s2: 'Provide the provider details with the environment variables `GENESYSCLOUD_OAUTHCLIENT_ID`, `GENESYSCLOUD_OAUTHCLIENT_SECRET` and `GENESYSCLOUD_REGION` — or copy `terraform.tfvars.example` to `terraform.tfvars`.',
    s3: '`terraform init`, `terraform plan` and `terraform apply`.', s4: 'If something changes in the source org, Archy GUI makes a new setup and `terraform plan` shows the difference against the target org.',
    vars: 'Variables to fill in', varsText: 'These divisions are not part of the setup. Fill in their ids in the target org in `terraform.tfvars`:',
    content: 'Contents', cType: 'Resource', cFile: 'File', cIncl: 'Included', unreadable: 'could not be read', of: 'of',
    missing: 'What is not included',
    m1: 'Secrets: OAuth client secrets and integration credentials.', m2: 'Members of queues, groups and teams, and users.',
    m3: 'Content: contacts, DNC numbers, knowledge base articles and data table rows.', m4: 'Recorded audio in prompts and files for scripts (they need local files).',
    m5: 'Conditional permissions in roles and things tied to the individual org (emergency numbers, flow ids).', m6: 'Survey and evaluation forms, scripts and Function Data Actions.',
    left: 'Left out in this run', remarks: 'Remarks',
  },
  de: {
    title: 'Terraform-Setup', hdrFrom: 'Von', hdrTo: 'Nach', toUnknown: '(wird beim Apply gewählt)',
    intro: 'Erzeugt von Archy GUI. Das Setup baut die ausgewählten Objekte in einer Genesys-Cloud-Org mit dem [genesyscloud-Provider](https://registry.terraform.io/providers/MyPureCloud/genesyscloud/latest/docs) (CX as Code). Es beschreibt die Objekte der **Quelle**; geändert wird die Org, gegen die Sie `terraform apply` ausführen. Es ist ein **Start-Setup**: Lesen Sie es durch und probieren Sie es in einer Test-Org aus, bevor es produktiv genutzt wird.',
    use: 'So wird es verwendet', s1: 'Legen Sie in der **Ziel-Org** einen OAuth-Client (Client Credentials) mit den Rollen an, die zum Anlegen der Objekte nötig sind.',
    s2: 'Geben Sie die Provider-Angaben über die Umgebungsvariablen `GENESYSCLOUD_OAUTHCLIENT_ID`, `GENESYSCLOUD_OAUTHCLIENT_SECRET` und `GENESYSCLOUD_REGION` an — oder kopieren Sie `terraform.tfvars.example` nach `terraform.tfvars`.',
    s3: '`terraform init`, `terraform plan` und `terraform apply`.', s4: 'Ändert sich etwas in der Quell-Org, erzeugt Archy GUI ein neues Setup, und `terraform plan` zeigt den Unterschied zur Ziel-Org.',
    vars: 'Auszufüllende Variablen', varsText: 'Diese Divisionen gehören nicht zum Setup. Tragen Sie ihre IDs aus der Ziel-Org in `terraform.tfvars` ein:',
    content: 'Inhalt', cType: 'Ressource', cFile: 'Datei', cIncl: 'Enthalten', unreadable: 'konnte nicht gelesen werden', of: 'von',
    missing: 'Was nicht enthalten ist',
    m1: 'Geheimnisse: Secrets von OAuth-Clients und Zugangsdaten von Integrationen.', m2: 'Mitglieder von Warteschlangen, Gruppen und Teams sowie Benutzer.',
    m3: 'Inhalte: Kontakte, DNC-Nummern, Artikel in Wissensdatenbanken und Zeilen in Datentabellen.', m4: 'Aufgenommenes Audio in Prompts und Dateien für Skripte (sie brauchen lokale Dateien).',
    m5: 'Bedingte Berechtigungen in Rollen und Dinge, die zur jeweiligen Org gehören (Notrufnummern, Flow-IDs).', m6: 'Umfrage- und Bewertungsformulare, Skripte und Function Data Actions.',
    left: 'In diesem Durchlauf weggelassen', remarks: 'Hinweise',
  },
};

function readme(lang, { source, target, region, summary, notes, refVars }) {
  const r = R[lang] || R.en;
  const rows = summary.map(s => `| \`${s.type}\` | \`${s.file || ''}\` | ${s.error ? r.unreadable + ': ' + s.error : s.written + ' ' + r.of + ' ' + s.total} |`).join('\n');
  const skipped = summary.flatMap(s => s.skipped.map(x => `- \`${s.type}\`: **${x.name}** — ${x.reason}`));
  const route = source ? `\n**${r.hdrFrom}:** ${source}  \n**${r.hdrTo}:** ${target || r.toUnknown}${region ? ` (\`aws_region = ${region}\`)` : ''}\n` : '';
  return `# ${r.title}${source ? ' — ' + source + (target ? ' → ' + target : '') : ''}
${route}
${r.intro}

## ${r.use}

1. ${r.s1}
2. ${r.s2}
3. ${r.s3}

${r.s4}
${refVars && refVars.size ? `\n## ${r.vars}\n\n${r.varsText}\n\n${[...refVars].map(([v, n]) => `- \`${v}\` (${n})`).join('\n')}\n` : ''}
## ${r.content}

| ${r.cType} | ${r.cFile} | ${r.cIncl} |
|---|---|---|
${rows}

## ${r.missing}

- ${r.m1}
- ${r.m2}
- ${r.m3}
- ${r.m4}
- ${r.m5}
- ${r.m6}
${skipped.length ? `\n### ${r.left}\n\n${skipped.join('\n')}\n` : ''}${notes.length ? `\n### ${r.remarks}\n\n${notes.map(n => '- ' + n).join('\n')}\n` : ''}`;
}

module.exports = { KINDS, build, render, value, hclString, localName, tfDateTime, stripUris, ref, raw, Ref, Raw, awsRegion, translator, FLOW_DIR };
