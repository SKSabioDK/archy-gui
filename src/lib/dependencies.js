// Hvad et flow bruger: afhængigheder læst ud af YAML'en og slået op i målet.

const axios = require('axios');
const { FLOW_KINDS } = require('./conventions');
const { getToken } = require('./token');

// ── Afhængigheder i et flow ───────────────────────────────────────────────────

// Tegnene et ressourcenavn må bestå af. \w dækker kun ASCII, og danske navne
// gør ikke: "Åbningstider" blev læst som ingenting, og et flow der slår op i
// den tabel fremstod dermed uden afhængigheder — både i rapporten og når
// migreringen skulle tage dem med. Latin-1's bogstaver dækker æ, ø og å samt
// resten af de vesteuropæiske sprog.
const ORD = '\\wÀ-ÖØ-öø-ÿ';

// Finder de ressourcer et flow-YAML refererer til. Regexerne er skrevet mod
// den form Archy faktisk eksporterer — se README for eksempler.
function scanYamlDependencies(yaml) {
  const uniq = a => [...new Set(a.map(s => (s || '').trim()).filter(Boolean))];
  const grab = (re) => { const out = []; let m; while ((m = re.exec(yaml)) !== null) out.push(m[1]); return uniq(out); };

  return {
    division:   grab(/^[ \t]*division:[ \t]*["']?([^'"\n]+)["']?/gm),
    queue:      grab(/targetQueue:[\s\S]{0,60}?name:[ \t]*["']?([^'"\n]+)["']?/gm),
    datatable:  grab(new RegExp(`dataTable:\\s*\\n\\s+([${ORD}][${ORD} _\\-]+):`, 'gm'))
                  .filter(n => !['foundOutputs', 'failureOutputs', 'outputs'].includes(n)),
    // secureDataAction: er en data action markeret secure — samme opslag, og
    // før blev den slet ikke fundet.
    dataaction: grab(new RegExp(`(?:secureDataAction|dataAction):\\s*\\n\\s+([${ORD}][${ORD} _\\-()]+):`, 'gm')),
    // PromptSystem.* er Genesys' indbyggede systemprompts. De ligger ikke i
    // orgens promptliste og ville derfor altid fremstå som manglende.
    // Et prompt kan også stå inde i et udtryk (exp: AudioPlaybackOptions(Prompt.P1, true)).
    // Den form blev ikke læst, så et flow med den fejlede ved publicering med
    // "The variable reference 'Prompt.P1' ... is not valid".
    prompt:     uniq([...grab(new RegExp(`prompt:[ \\t]+["']?(?:Prompt\\.)?([${ORD}_\\-. ]+)["']?`, 'gm')),
                      ...grab(new RegExp(`\\bPrompt\\.([${ORD}_\\-]+)`, 'g'))])
                  .filter(n => !/^PromptSystem\./i.test(n)),
    // wrapupCode: \n lit: \n name: X
    wrapupcode: grab(/wrapupCode:\s*\n\s*lit:\s*\n\s*name:[ \t]*["']?([^'"\n]+)["']?/gmi),
    // screenPopScript: \n <ScriptNavn>:
    script:     grab(new RegExp(`screenPopScript:\\s*\\n\\s+([${ORD}][${ORD} _\\-.()]*):`, 'gm')),
    // Kun statiske skill-navne. FindSkill(Task.Skills) slås op på kørselstidspunktet
    // og kan ikke tjekkes her — det siges eksplicit i rapporten.
    skill:      grab(/FindSkill\(\s*["']([^"']+)["']\s*\)/gm),
    // VOICESURVEY-flows peger på en survey form ved navn
    surveyform: grab(/surveyForm:\s*\n\s*name:[ \t]*["']?([^'"\n]+)["']?/gm),

    // ── Referencer til ANDRE flows ────────────────────────────────────────
    // Bemærk kravet om indrykning (^\s+): på indrykning 0 er 'commonModule:'
    // og 'botFlow:' flowets EGEN type, ikke en reference til et andet flow.
    commonmodule: grab(new RegExp(`^\\s+commonModule:\\s*\\n\\s+([${ORD}][${ORD} .\\-()]*):`, 'gm')).filter(notMeta),
    botflow:      grab(new RegExp(`^\\s+botFlow:\\s*\\n\\s+([${ORD}][${ORD} .\\-()]*):`, 'gm')).filter(notMeta),
    // To former: «targetFlow: \n name: X» og, i "Set Post-Flow" (voiceSurveyFlow),
    // flownavnet som nøgle: «targetFlow: \n X: \n ver_latestPublished:». Den sidste
    // blev ikke læst, så et outbound-flow med et survey-flow efter sig fremstod
    // uden afhængigheder, og Archy afviste importen med «flow name "X" does not exist».
    targetflow:   uniq([...grab(/targetFlow:\s*\n\s*(?:lit:\s*\n\s*)?name:\s*["']?([^'"\n]+)["']?/gm),
                        ...grab(new RegExp(`targetFlow:\\s*\\n\\s+([${ORD}][${ORD} .\\-()]*):\\s*\\n\\s+ver_`, 'gm'))]),
    // "Transfer to ACD" med et bestemt in-queue-flow: overrideInQueueFlow: \n name: X.
    // Manglede, så Archy afviste importen med «flow name "X" does not exist».
    inqueueflow:  grab(/overrideInQueueFlow:\s*\n\s*(?:lit:\s*\n\s*)?name:\s*["']?([^'"\n]+)["']?/gm),

    // ── Brugere ───────────────────────────────────────────────────────────
    // "Transfer to User" med en fast bruger: targetUser: \n lit: \n userName: x@y.
    // En bruger er en person i org'en — findes vedkommende ikke i målet, kan
    // flowet ikke importeres, og vi kan ikke oprette brugeren for dem.
    // Et udtryk (exp:) slås op når flowet kører og kan ikke tjekkes her.
    user:          grab(/targetUser:\s*\n\s*lit:\s*\n\s*userName:[ \t]*["']?([^'"\n]+?)["']?[ \t]*$/gm),

    // ── Åbningstider ──────────────────────────────────────────────────────
    schedule:      grab(/schedule:\s*\n\s*selectedSchedule:\s*\n\s*(?:lit:\s*\n\s*)?name:\s*["']?([^'"\n]+)["']?/gm),
    schedulegroup: grab(/scheduleGroup:\s*\n\s*lit:\s*\n\s*name:\s*["']?([^'"\n]+)["']?/gm),

    // ── Øvrige org-ressourcer ─────────────────────────────────────────────
    knowledgebase: grab(/knowledgeBase:\s*\n\s*name:\s*["']?([^'"\n]+)["']?/gm),
    // Outbound-flowets kontaktliste: «contactList: \n lit: \n name: X»
    contactlist:   grab(/contactList:\s*\n\s*(?:lit:\s*\n\s*)?name:[ \t]*["']?([^'"\n]+?)["']?[ \t]*$/gm),
    sttengine:     grab(/speechToText:\s*\n\s*engine:\s*\n\s*name:\s*["']?([^'"\n]+)["']?/gm),
    group:         grab(/targetGroup:\s*\n\s*lit:\s*\n\s*name:\s*["']?([^'"\n]+)["']?/gm),
    // "Set Utilization Label": utilizationLabel: \n lit: \n name: X. Et udtryk
    // (exp:) slås op når flowet kører og kan ikke tjekkes her.
    utilizationlabel: grab(/utilizationLabel:\s*\n\s*lit:\s*\n\s*name:[ \t]*["']?([^'"\n]+?)["']?[ \t]*$/gm)
  };
}

// Strukturelle nøgler der aldrig er ressourcenavne
function notMeta(n) {
  return !['name', 'lit', 'exp', 'noValue', 'division', 'description',
           'ver_latestPublished', 'inputs', 'outputs', 'supportedLanguages'].includes(n);
}

// Et flow et andet flow peger på, findes først når det er publiceret. Archy
// opretter flowet før indholdet lægges ind, så en import der fejlede (fx på en
// TTS-motor), efterlod en tom skal: version 1.0 med kun Disconnect, aldrig
// publiceret. Den blev regnet for "findes", og modulet blev aldrig migreret.
// Samme for en prompt: en skal uden lyd eller TTS i nogen sprog findes, men
// kan ikke afspilles, og Archy afviser flowet med "does not have audio or text
// to speech for at least one supported language". Svarer listen ikke med
// ressourcerne, ved vi det ikke, og så regnes den for at findes.
//
// Archy kræver indhold på MINDST ÉT AF FLOWETS SPROG. En prompt med lyd på fx
// nl-nl alene dur ikke til et flow, der kun taler da-dk og en-gb — så er
// 'languages' (flowets sprog, små bogstaver) givet, tæller kun de sprog.
//
// Er flowets standardsprog kendt, kræves indhold DÉR. Falck: P1435 havde lyd på
// en-us, som flowet understøtter — men standardsproget er en-gb, og Archy
// afviste prompten alligevel. Forkert "mangler" koster kun en kopi af de sprog
// der mangler; forkert "findes" stopper hele migreringen.
const promptHasContent = (e, languages = null, defaultLanguage = null) => !Array.isArray(e?.resources) ||
  e.resources.some(r => r && (r.mediaUri || r.ttsString || r.text) &&
    (defaultLanguage ? String(r.language || '').toLowerCase() === defaultLanguage
     : (!languages || !languages.size || languages.has(String(r.language || '').toLowerCase()))));

// Flowets standardsprog: «defaultLanguage: en-gb» øverst i YAML'en.
function scanDefaultLanguage(yaml) {
  const m = String(yaml).match(/^[ "+B+"t]{2}defaultLanguage:[ "+B+"t]*([A-Za-z]{2,3}-[A-Za-z0-9]{2,4})/m);
  return m ? m[1].toLowerCase() : null;
}

// Sprogene et flow understøtter: nøglerne under «supportedLanguages:».
function scanSupportedLanguages(yaml) {
  const out = new Set();
  let inBlock = false;
  for (const l of String(yaml).split(/\r?\n/)) {
    if (/^[ \t]{2}supportedLanguages:[ \t]*$/.test(l)) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (/^[ \t]{0,2}\S/.test(l)) break;
    const m = l.match(/^[ \t]{4}([A-Za-z]{2,3}-[A-Za-z0-9]{2,4}):[ \t]*$/);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}
const countsAsExisting = (kind, entity, languages = null, defaultLanguage = null) =>
  kind === 'prompt' ? promptHasContent(entity, languages, defaultLanguage)
  : (!FLOW_KINDS.has(kind) || !!(entity && entity.publishedVersion));

// Hvilke af 'names' findes allerede i org'en? Store lister (758 køer, 350 skills)
// slås op pr. navn; små lister hentes i ét hug.
async function lookupExisting(kind, names, token, apiBase, ctx = {}) {
  const found = new Set();
  if (!names.length) return found;
  const H = { headers: { Authorization: `Bearer ${token}` } };

  const bulk = {
    datatable:  { url: '/api/v2/flows/datatables',      size: 200 },
    dataaction: { url: '/api/v2/integrations/actions',  size: 100 },
    script:     { url: '/api/v2/scripts',               size: 100 },
    surveyform: { url: '/api/v2/quality/publishedforms/surveys', size: 100 },
    // Alle tre flow-referencer slås op i den samme flow-liste
    commonmodule: { url: '/api/v2/flows', size: 100 },
    botflow:      { url: '/api/v2/flows', size: 100 },
    targetflow:   { url: '/api/v2/flows', size: 100 },
    inqueueflow:  { url: '/api/v2/flows', size: 100 },
    schedule:      { url: '/api/v2/architect/schedules', size: 100 },
    schedulegroup: { url: '/api/v2/architect/schedulegroups', size: 100 },
    knowledgebase:{ url: '/api/v2/knowledge/knowledgebases', size: 100 },
    contactlist:  { url: '/api/v2/outbound/contactlists', size: 100 },
    sttengine:    { url: '/api/v2/integrations/speech/stt/engines', size: 100 },
    group:        { url: '/api/v2/groups', size: 100 },
    utilizationlabel: { url: '/api/v2/routing/utilization/labels', size: 100 }
  };
  if (bulk[kind]) {
    let page = 1;
    while (true) {
      const r = await axios.get(`${apiBase}${bulk[kind].url}`, {
        ...H, params: { pageSize: bulk[kind].size, pageNumber: page }
      });
      const e = r.data.entities || [];
      for (const x of e) if (names.includes(x.name) && countsAsExisting(kind, x)) found.add(x.name);
      if (e.length < bulk[kind].size) break;
      page++;
    }
    return found;
  }

  // Brugere findes på brugernavnet (login-mailen), ikke på et navnefelt.
  if (kind === 'user') {
    for (const n of names) {
      try {
        const r = await axios.post(`${apiBase}/api/v2/users/search`, {
          pageSize: 5,
          query: [{ type: 'EXACT', fields: ['email'], value: n }]
        }, { headers: { ...H.headers, 'Content-Type': 'application/json' } });
        const lav = String(n).toLowerCase();
        if ((r.data.results || []).some(u =>
          String(u.username || '').toLowerCase() === lav || String(u.email || '').toLowerCase() === lav))
          found.add(n);
      } catch (_) { /* uafklaret — tælles som manglende og markeres i rapporten */ }
    }
    return found;
  }

  const byName = {
    division:      '/api/v2/authorization/divisions',
    queue:         '/api/v2/routing/queues',
    prompt:        '/api/v2/architect/prompts',
    wrapupcode:    '/api/v2/routing/wrapupcodes',
    skill:         '/api/v2/routing/skills',
  };
  const url = byName[kind];
  if (!url) return found;
  for (const n of names) {
    try {
      const r = await axios.get(`${apiBase}${url}`, { ...H, params: { pageSize: 50, name: n } });
      let hit = (r.data.entities || []).find(x => x.name === n);
      // Svarer listen ikke med ressourcerne, hentes promptens egen post — ellers
      // kan vi ikke se om den har indhold, og "ved ikke" blev læst som "findes".
      if (hit && kind === 'prompt' && !Array.isArray(hit.resources))
        hit = (await axios.get(`${apiBase}${url}/${hit.id}`, H)).data;
      if (hit && countsAsExisting(kind, hit, ctx.languages, ctx.defaultLanguage)) found.add(n);
    } catch (_) { /* uafklaret — tælles som manglende og markeres i rapporten */ }
  }
  return found;
}

// ── Function Data Actions ─────────────────────────────────────────────────────

const FUNCTION_INTEGRATION = 'function-data-actions';

// En Function Data Action kan ikke oprettes via API'et: dens skabelon er et id
// på en function i kildens org. Mangler den i målet, kan flowet ikke forfremmes
// — og forfremmes det alligevel, ender versionsnummeret og tjekket i Genesys
// ude af trit, når man retter det bagefter direkte i org'en.
//
// Ren afgørelse, så den kan prøves uden en org: hvilke af de manglende navne er
// FDA'er i kilden? Et navn kilden ikke kender, er ikke en FDA vi kan påvise.
function missingFunctionActions(missingNames, sourceActions, integrationTypes) {
  return missingNames.filter(n => {
    const hit = (sourceActions || []).find(a => a.name === n);
    return !!hit && (integrationTypes || {})[hit.integrationId] === FUNCTION_INTEGRATION;
  });
}

// De Function Data Actions flowet bruger, som ikke findes i målet.
async function functionActionsMissingInTarget(source, target, yaml) {
  const names = scanYamlDependencies(yaml).dataaction;
  if (!names.length) return [];
  const { token: tt, apiBase: tb } = await getToken(target);
  const existing = await lookupExisting('dataaction', names, tt, tb);
  const missing = names.filter(n => !existing.has(n));
  if (!missing.length) return [];

  const { token: st, apiBase: sb } = await getToken(source);
  const SH = { headers: { Authorization: `Bearer ${st}` } };
  let actions = [], page = 1;
  for (;;) {
    const r = await axios.get(`${sb}/api/v2/integrations/actions`, { ...SH, params: { pageSize: 100, pageNumber: page } });
    const e = r.data.entities || [];
    actions = actions.concat(e);
    if (e.length < 100) break;
    page++;
  }
  const types = {};
  const ri = await axios.get(`${sb}/api/v2/integrations`, { ...SH, params: { pageSize: 200 } });
  for (const i of ri.data.entities || []) types[i.id] = i.integrationType?.id || '';
  return missingFunctionActions(missing, actions, types);
}

module.exports = { scanYamlDependencies, FUNCTION_INTEGRATION, notMeta, promptHasContent,
  scanDefaultLanguage, scanSupportedLanguages, countsAsExisting, lookupExisting,
  missingFunctionActions, functionActionsMissingInTarget };
