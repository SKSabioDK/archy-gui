// Ruter: prompts, scripts, køer, grupper, åbningstider og de enkle ressourcer.

const express = require('express');
const axios = require('axios');
const { PORT } = require('../config');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { describeApiError } = require('../lib/helpers');
const { getToken } = require('../lib/token');
const { pagedList } = require('../lib/genesys');
const { archyHint } = require('../lib/archy');

const router = express.Router();

// ── User prompts ──────────────────────────────────────────────────────────────

// Migrerer én user prompt med alle dens sprogressourcer.
// TTS-tekst kopieres direkte. Har en ressource indtalt lyd, hentes WAV-filen
// fra kilden og lægges op på den nye ressources uploadUri.
router.post('/api/prompts/migrate', async (req, res) => {
  const { sourceId, targetId, promptName } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  const trail = [];
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const SH = { headers: { Authorization: `Bearer ${srcToken}` } };
    const sl = await axios.get(`${srcBase}/api/v2/architect/prompts`, { ...SH, params: { pageSize: 200, name: promptName } });
    const hit = (sl.data.entities || []).find(p => p.name === promptName);
    if (!hit) return res.status(400).json({ error: `Prompt "${promptName}" findes ikke i ${source.name}` });
    const src = (await axios.get(`${srcBase}/api/v2/architect/prompts/${hit.id}`, SH)).data;

    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const TH = { headers: { Authorization: `Bearer ${tgtToken}` } };
    const TJ = { headers: { ...TH.headers, 'Content-Type': 'application/json' } };

    const ex = await axios.get(`${tgtBase}/api/v2/architect/prompts`, { ...TH, params: { pageSize: 200, name: promptName } });
    const there = (ex.data.entities || []).find(p => p.name === promptName);
    // Findes den med indhold, er den færdig. En skal uden lyd eller TTS (fx fra en
    // migrering der fejlede midtvejs) fyldes op i stedet — ellers blev den ved med
    // at "findes", og flowet kunne ikke importeres.
    // Findes den allerede, kopieres kun de sprog målet mangler indhold på. Er der
    // intet at tilføje, er den færdig.
    const harIndhold = r => !!(r && (r.mediaUri || r.ttsString || r.text));
    const mangler = (src.resources || []).filter(r => harIndhold(r) &&
      !(there?.resources || []).some(x => x.language === r.language && harIndhold(x)));
    if (there && !mangler.length)
      return res.status(409).json({ error: 'already_exists', message: `Prompt "${promptName}" findes allerede i ${target.name}` });

    const created = there || (await axios.post(`${tgtBase}/api/v2/architect/prompts`,
      { name: src.name, description: src.description || '' }, TJ)).data;
    if (there) trail.push(`· prompten fandtes — mangler indhold på ${mangler.map(r => r.language).join(', ')}`);
    const haves = new Map((there?.resources || []).map(r => [r.language, r]));

    let ok = 0, audioOk = 0, audioFail = 0;
    for (const r of (there ? mangler : (src.resources || []))) {
      try {
        const felter = { language: r.language, ttsString: r.ttsString || undefined, text: r.text || undefined };
        const nr = haves.has(r.language)
          ? (await axios.put(`${tgtBase}/api/v2/architect/prompts/${created.id}/resources/${encodeURIComponent(r.language)}`, felter, TJ)).data
          : (await axios.post(`${tgtBase}/api/v2/architect/prompts/${created.id}/resources`, felter, TJ)).data;
        ok++;

        if (!r.mediaUri) { trail.push(`✓ ${r.language} (TTS)`); continue; }

        // Indtalt lyd: hent WAV'en fra kilden og læg den op på den nye ressource
        if (!nr.uploadUri) { trail.push(`⚠ ${r.language}: lyd kunne ikke uploades (ingen uploadUri)`); audioFail++; continue; }
        const wav = await axios.get(r.mediaUri, { responseType: 'arraybuffer', timeout: 60000 });
        const form = new FormData();
        form.append('file', new Blob([wav.data], { type: 'audio/wav' }), `${r.language}.wav`);
        const up = await fetch(nr.uploadUri, {
          method: 'POST', headers: { Authorization: `Bearer ${tgtToken}` }, body: form
        });
        if (!up.ok) { trail.push(`⚠ ${r.language}: lyd-upload svarede ${up.status}`); audioFail++; }
        else { trail.push(`✓ ${r.language} (lyd, ${Math.round(wav.data.length / 1024)} kB)`); audioOk++; }
      } catch (e) {
        trail.push(`✗ ${r.language}: ${describeApiError(e)}`);
      }
    }

    addLog('SUCCESS', `Prompt "${promptName}" migrated to ${target.name} — ${ok} languages` +
      (audioOk ? `, ${audioOk} with audio` : '') + (audioFail ? `, ${audioFail} audio failed` : ''), source.name, 'MIGRATE');
    res.json({ ok: true, id: created.id, name: created.name, languages: ok, audioOk, audioFail, trail });

  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Prompt "${promptName}" failed: ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg, trail });
  }
});

// ── Scripts ───────────────────────────────────────────────────────────────────

// Scripter-importen ligger ikke på api.<region> men på apps.<region> — samme
// vej som Genesys' egen "Import" i Scripter og CX as Code bruger.
const appsBaseOf = apiBase => String(apiBase).replace('://api.', '://apps.');

async function listScripts(apiBase, token, name) {
  const H = { headers: { Authorization: `Bearer ${token}` } };
  let all = [], page = 1;
  while (true) {
    const r = await axios.get(`${apiBase}/api/v2/scripts`, {
      ...H, params: { pageSize: 100, pageNumber: page, ...(name ? { name } : {}) }
    });
    const e = r.data.entities || [];
    all = all.concat(e);
    if (e.length < 100) break;
    page++;
  }
  return all;
}

async function publishedScriptIds(apiBase, token) {
  const ids = new Set();
  let page = 1;
  while (true) {
    const r = await axios.get(`${apiBase}/api/v2/scripts/published`, {
      headers: { Authorization: `Bearer ${token}` }, params: { pageSize: 100, pageNumber: page }
    });
    const e = r.data.entities || [];
    for (const s of e) ids.add(s.id);
    if (e.length < 100) break;
    page++;
  }
  return ids;
}

router.get('/api/customers/:id/scripts', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const { token, apiBase } = await getToken(customer);
    const all = await listScripts(apiBase, token);
    let published = new Set();
    try { published = await publishedScriptIds(apiBase, token); } catch (_) { /* vises blot uden mærke */ }
    res.json(all
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(s => ({ id: s.id, name: s.name, published: published.has(s.id), modifiedDate: s.modifiedDate || null })));
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// ── Køer og grupper ──────────────────────────────────────────────────────────
// Kopieres som definition — ikke medlemmer. Brugere, skills og flows har andre
// id'er i målet, så medlemmer, bullseye, hold-/whisper-prompts og kø-flows
// følger ikke med; de sættes i målet. Selve køen/gruppen findes dermed, så et
// flow der peger på den kan importeres.

const QUEUE_COPY_FIELDS = ['name', 'description', 'mediaSettings', 'acwSettings', 'skillEvaluationMethod',
  'autoAnswerOnly', 'enableTranscription', 'enableManualAssignment', 'routingRules', 'suppressInQueueCallRecording'];
const GROUP_COPY_FIELDS = ['name', 'description', 'type', 'visibility', 'rolesEnabled'];

function pickFields(src, fields) {
  const out = {};
  for (const f of fields) if (src && src[f] !== undefined && src[f] !== null) out[f] = src[f];
  return out;
}
const queueCreateBody = (full, divisionId) =>
  ({ ...pickFields(full, QUEUE_COPY_FIELDS), ...(divisionId ? { division: { id: divisionId } } : {}) });
const groupCreateBody = full => pickFields(full, GROUP_COPY_FIELDS);

router.post('/api/queues/migrate', async (req, res) => {
  const { sourceId, targetId, name } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!name) return res.status(400).json({ error: 'name mangler' });
  const trail = [];
  try {
    const { token: st, apiBase: sb } = await getToken(source);
    const { token: tt, apiBase: tb } = await getToken(target);
    const byName = (list) => list.find(q => q.name === name);
    const hit = byName((await axios.get(`${sb}/api/v2/routing/queues`, { headers: { Authorization: `Bearer ${st}` }, params: { name, pageSize: 50 } })).data.entities || []);
    if (!hit) return res.status(400).json({ error: `Queue "${name}" findes ikke i ${source.name}` });
    const ex = byName((await axios.get(`${tb}/api/v2/routing/queues`, { headers: { Authorization: `Bearer ${tt}` }, params: { name, pageSize: 50 } })).data.entities || []);
    if (ex) return res.status(409).json({ error: 'already_exists', message: `Queue "${name}" findes allerede i ${target.name}` });

    const full = (await axios.get(`${sb}/api/v2/routing/queues/${hit.id}`, { headers: { Authorization: `Bearer ${st}` } })).data;
    // Samme division, hvis målet har en med samme navn; ellers målets standard.
    let divisionId = null;
    if (full.division?.name) {
      const divs = await pagedList(tb, '/api/v2/authorization/divisions', tt);
      divisionId = (divs.find(d => d.name === full.division.name) || {}).id || null;
      trail.push(divisionId ? `✓ division "${full.division.name}"` : `⚠ divisionen "${full.division.name}" findes ikke i ${target.name} — køen lægges i målets standarddivision`);
    }
    const r = await axios.post(`${tb}/api/v2/routing/queues`, queueCreateBody(full, divisionId),
      { headers: { Authorization: `Bearer ${tt}`, 'Content-Type': 'application/json' } });
    trail.push('✓ kø oprettet — medlemmer, skills og prompts sættes i målet');
    addLog('SUCCESS', `Queue "${name}" created in ${target.name} (definition only, no members)`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name, trail });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Could not create queue "${name}" in ${target.name}: ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg, trail });
  }
});

router.post('/api/groups/migrate', async (req, res) => {
  const { sourceId, targetId, name } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!name) return res.status(400).json({ error: 'name mangler' });
  const trail = [];
  try {
    const { token: st, apiBase: sb } = await getToken(source);
    const { token: tt, apiBase: tb } = await getToken(target);
    const hit = (await pagedList(sb, '/api/v2/groups', st)).find(g => g.name === name);
    if (!hit) return res.status(400).json({ error: `Group "${name}" findes ikke i ${source.name}` });
    if ((await pagedList(tb, '/api/v2/groups', tt)).some(g => g.name === name))
      return res.status(409).json({ error: 'already_exists', message: `Group "${name}" findes allerede i ${target.name}` });
    const r = await axios.post(`${tb}/api/v2/groups`, groupCreateBody(hit),
      { headers: { Authorization: `Bearer ${tt}`, 'Content-Type': 'application/json' } });
    trail.push('✓ gruppe oprettet — medlemmer og ejere sættes i målet');
    addLog('SUCCESS', `Group "${name}" created in ${target.name} (definition only, no members)`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name, trail });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Could not create group "${name}" in ${target.name}: ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg, trail });
  }
});

// ── Åbningstider og åbningstidsgrupper ───────────────────────────────────────
// En åbningstidsgruppe peger på åbningstider (schedules) med id. Id'erne er
// forskellige i målet, så gruppen oprettes med målets egne: de åbningstider den
// bruger findes i målet på navn, og de der mangler oprettes først.

const SCHEDULE_COPY_FIELDS = ['name', 'description', 'start', 'end', 'rrule'];
const SCHEDULE_GROUP_COPY_FIELDS = ['name', 'description', 'timeZone'];
const SCHEDULE_GROUP_LISTS = ['openSchedules', 'closedSchedules', 'holidaySchedules'];

const scheduleCreateBody = (full, divisionId) =>
  ({ ...pickFields(full, SCHEDULE_COPY_FIELDS), ...(divisionId ? { division: { id: divisionId } } : {}) });

// idByName: navn → id i MÅLET. En åbningstid uden id i målet udelades.
function scheduleGroupCreateBody(full, idByName, divisionId) {
  const body = pickFields(full, SCHEDULE_GROUP_COPY_FIELDS);
  for (const l of SCHEDULE_GROUP_LISTS)
    body[l] = (full[l] || []).map(x => idByName[x.name]).filter(Boolean).map(id => ({ id }));
  if (divisionId) body.division = { id: divisionId };
  return body;
}

// Division i målet med samme navn som i kilden — ellers null (målets standard).
async function targetDivisionIdByName(tb, tt, name, trail) {
  if (!name) return null;
  const divs = await pagedList(tb, '/api/v2/authorization/divisions', tt);
  const id = (divs.find(d => d.name === name) || {}).id || null;
  trail.push(id ? `✓ division "${name}"` : `⚠ divisionen "${name}" findes ikke i målet — lægges i målets standarddivision`);
  return id;
}

// Navnefilteret finder ikke altid navne med tegn som «/» ('24/7' blev ikke fundet,
// og oprettelsen fejlede så med «name already assigned»). Findes navnet ikke med
// filteret, gennemgås hele listen.
async function listByName(base, url, token, name) {
  const r = await axios.get(`${base}${url}`, { headers: { Authorization: `Bearer ${token}` }, params: { name, pageSize: 50 } });
  const hit = (r.data.entities || []).find(x => x.name === name);
  if (hit) return hit;
  return (await pagedList(base, url, token)).find(x => x.name === name) || null;
}

// Sikrer at en åbningstid findes i målet. Returnerer id'et dér.
async function ensureScheduleInTarget(ctx, name, trail) {
  const there = await listByName(ctx.tb, '/api/v2/architect/schedules', ctx.tt, name);
  if (there) return there.id;
  const hit = await listByName(ctx.sb, '/api/v2/architect/schedules', ctx.st, name);
  if (!hit) { trail.push(`⚠ åbningstiden "${name}" findes ikke i kilden`); return null; }
  const full = (await axios.get(`${ctx.sb}/api/v2/architect/schedules/${hit.id}`, { headers: { Authorization: `Bearer ${ctx.st}` } })).data;
  const divisionId = await targetDivisionIdByName(ctx.tb, ctx.tt, full.division && full.division.name, trail);
  const r = await axios.post(`${ctx.tb}/api/v2/architect/schedules`, scheduleCreateBody(full, divisionId),
    { headers: { Authorization: `Bearer ${ctx.tt}`, 'Content-Type': 'application/json' } });
  trail.push(`✓ åbningstid "${name}"`);
  return r.data.id;
}

async function migrateScheduleLike(req, res, kind) {
  const { sourceId, targetId, name } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!name) return res.status(400).json({ error: 'name mangler' });
  const isGroup = kind === 'schedulegroup';
  const url = isGroup ? '/api/v2/architect/schedulegroups' : '/api/v2/architect/schedules';
  const label = isGroup ? 'Schedule group' : 'Schedule';
  const trail = [];
  try {
    const { token: st, apiBase: sb } = await getToken(source);
    const { token: tt, apiBase: tb } = await getToken(target);
    const ctx = { st, sb, tt, tb };
    const hit = await listByName(sb, url, st, name);
    if (!hit) return res.status(400).json({ error: `${label} "${name}" findes ikke i ${source.name}` });
    if (await listByName(tb, url, tt, name))
      return res.status(409).json({ error: 'already_exists', message: `${label} "${name}" findes allerede i ${target.name}` });
    const full = (await axios.get(`${sb}${url}/${hit.id}`, { headers: { Authorization: `Bearer ${st}` } })).data;
    const divisionId = await targetDivisionIdByName(tb, tt, full.division && full.division.name, trail);
    let body;
    if (isGroup) {
      const idByName = {};
      for (const l of SCHEDULE_GROUP_LISTS)
        for (const x of full[l] || []) if (!idByName[x.name]) idByName[x.name] = await ensureScheduleInTarget(ctx, x.name, trail);
      body = scheduleGroupCreateBody(full, idByName, divisionId);
    } else body = scheduleCreateBody(full, divisionId);
    const r = await axios.post(`${tb}${url}`, body, { headers: { Authorization: `Bearer ${tt}`, 'Content-Type': 'application/json' } });
    trail.push(`✓ ${isGroup ? 'åbningstidsgruppe' : 'åbningstid'} oprettet`);
    addLog('SUCCESS', `${label} "${name}" created in ${target.name}`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name, trail });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Could not create ${label.toLowerCase()} "${name}" in ${target.name}: ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg, trail });
  }
}
router.post('/api/schedules/migrate', (req, res) => migrateScheduleLike(req, res, 'schedule'));
router.post('/api/schedulegroups/migrate', (req, res) => migrateScheduleLike(req, res, 'schedulegroup'));

// ── Migrér ressourcer: køer, grupper, skills, åbningstider, divisioner ─────────
// Ét sæt ruter til de ressourcer der kun har et navn og en lille definition:
// listen hentes ens, og migreringen genbruger de enkelte ruter (en kø, en gruppe,
// en åbningstid …) som også flow-migreringen bruger — så de to veje aldrig
// opfører sig forskelligt.

const RESOURCE_KINDS = {
  divisions:      { url: '/api/v2/authorization/divisions', keep: d => !d.homeDivision && d.name !== 'Home', sub: () => '' },
  skills:         { url: '/api/v2/routing/skills',          keep: () => true, sub: () => '' },
  groups:         { url: '/api/v2/groups',                  keep: () => true,
                    sub: g => [g.type, g.memberCount != null ? `${g.memberCount} 👥` : ''].filter(Boolean).join(' · ') },
  schedules:      { url: '/api/v2/architect/schedules',     keep: () => true, sub: x => (x.division && x.division.name) || '' },
  schedulegroups: { url: '/api/v2/architect/schedulegroups', keep: () => true, sub: x => (x.division && x.division.name) || '' },
  queues:         { url: '/api/v2/routing/queues',          keep: () => true,
                    sub: q => [q.division && q.division.name, q.memberCount != null ? `${q.memberCount} 👥` : ''].filter(Boolean).join(' · ') },
  teams:          { url: '/api/v2/teams',                   keep: () => true,
                    sub: x => [x.division && x.division.name, x.memberCount != null ? `${x.memberCount} 👥` : ''].filter(Boolean).join(' · ') },
  locations:      { url: '/api/v2/locations',               keep: () => true, sub: x => (x.address && (x.address.city || x.address.country)) || '' },
  utilization:    { url: '/api/v2/routing/utilization/labels', keep: () => true, sub: () => '' },
  skillgroups:    { url: '/api/v2/routing/skillgroups',     keep: () => true, sub: x => x.description || '' },
  knowledgebases: { url: '/api/v2/knowledge/knowledgebases', keep: () => true, sub: x => x.coreLanguage || '' },
  responselibs:   { url: '/api/v2/responsemanagement/libraries', keep: () => true, sub: () => '' },
  surveyforms:    { url: '/api/v2/quality/forms/surveys',   keep: () => true, sub: x => x.published ? 'published' : '' },
  evalforms:      { url: '/api/v2/quality/forms/evaluations', keep: () => true, sub: x => x.published ? 'published' : '' },
  emergencygroups:{ url: '/api/v2/architect/emergencygroups', keep: () => true, sub: x => (x.division && x.division.name) || '' },
  contactlists:   { url: '/api/v2/outbound/contactlists',   keep: () => true, sub: x => (x.division && x.division.name) || '' },
  dnclists:       { url: '/api/v2/outbound/dnclists',       keep: () => true, sub: x => [x.dncSourceType, x.contactMethod].filter(Boolean).join(' · ') }
};
// Ruten der opretter ét element i målet, ved navn
const RESOURCE_MIGRATE = {
  divisions: '/api/divisions/create', skills: '/api/skills/migrate', groups: '/api/groups/migrate',
  schedules: '/api/schedules/migrate', schedulegroups: '/api/schedulegroups/migrate', queues: '/api/queues/migrate',
  surveyforms: '/api/surveyforms/migrate'
};
// Resten oprettes af én fælles rute (SIMPLE_CREATE nedenfor)
for (const k of ['teams', 'locations', 'utilization', 'skillgroups', 'knowledgebases', 'responselibs', 'evalforms',
                 'emergencygroups', 'contactlists', 'dnclists']) RESOURCE_MIGRATE[k] = '/api/resources/create';

async function listResources(customer, kind) {
  const spec = RESOURCE_KINDS[kind];
  const { token, apiBase } = await getToken(customer);
  const all = await pagedList(apiBase, spec.url, token);
  return all.filter(spec.keep)
    .map(x => ({ id: x.id, name: x.name, sub: spec.sub(x) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

router.get('/api/customers/:id/resources/:kind', async (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  if (!RESOURCE_KINDS[req.params.kind]) return res.status(400).json({ error: `Ukendt type "${req.params.kind}"` });
  try { res.json(await listResources(customer, req.params.kind)); }
  catch (e) { res.status(500).json({ error: archyHint(describeApiError(e)) }); }
});

router.post('/api/resources/migrate', async (req, res) => {
  const { kind, sourceId, targetId, ids } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!RESOURCE_KINDS[kind]) return res.status(400).json({ error: `Ukendt type "${kind}"` });
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Intet valgt' });
  try {
    const byId = new Map((await listResources(source, kind)).map(x => [x.id, x]));
    const results = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) { results.push({ id, status: 'error', message: `findes ikke i ${source.name}` }); continue; }
      const resp = await fetch(`http://127.0.0.1:${PORT}${RESOURCE_MIGRATE[kind]}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, targetId, name: item.name, kind })
      }).then(r => r.json()).catch(e => ({ error: e.message }));
      if (resp.error === 'already_exists') results.push({ id, name: item.name, status: 'exists' });
      else if (resp.error) results.push({ id, name: item.name, status: 'error', message: resp.error });
      else results.push({ id, name: item.name, status: 'created', trail: resp.trail || [] });
    }
    res.json({ ok: true, results });
  } catch (e) { res.status(500).json({ error: describeApiError(e) }); }
});

// ── Oprettelse af de enkle ressourcer, ved navn ──────────────────────────────
// Kun definitionen kopieres. Medlemmer, brugere og referencer til andre objekter
// har andre id'er i målet og sættes dér; trail siger hvad der ikke fulgte med.
const hasDivision = x => x && x.division && x.division.name;
const SIMPLE_CREATE = {
  teams: { create: '/api/v2/teams', division: true,
    body: f => pickFields(f, ['name', 'description']), note: 'medlemmer sættes i målet' },
  locations: { create: '/api/v2/locations',
    body: f => pickFields(f, ['name', 'notes', 'emergencyNumber', 'address']) },
  utilization: { create: '/api/v2/routing/utilization/labels',
    body: f => pickFields(f, ['name']) },
  skillgroups: { create: '/api/v2/routing/skillgroups',
    body: f => pickFields(f, ['name', 'description']), note: 'betingelser (skills) sættes i målet' },
  knowledgebases: { create: '/api/v2/knowledge/knowledgebases',
    body: f => pickFields(f, ['name', 'description', 'coreLanguage']), note: 'dokumenter følger ikke med' },
  responselibs: { create: '/api/v2/responsemanagement/libraries',
    body: f => pickFields(f, ['name']), after: copyResponses },
  evalforms: { create: '/api/v2/quality/forms/evaluations', detail: id => `/api/v2/quality/forms/evaluations/${id}`,
    body: f => ({ name: f.name, published: false, questionGroups: stripFormIds(f.questionGroups || []) }),
    note: 'oprettet som ikke-publiceret' },
  emergencygroups: { create: '/api/v2/architect/emergencygroups', division: true,
    body: f => ({ ...pickFields(f, ['name', 'description']), enabled: false, emergencyCallFlows: [] }),
    note: 'oprettet slået fra, uden nødflows — sættes i målet' },
  contactlists: { create: '/api/v2/outbound/contactlists', division: true,
    body: f => pickFields(f, ['name', 'columnNames', 'phoneColumns', 'emailColumns', 'previewModeColumnName',
      'previewModeAcceptedValues', 'automaticTimeZoneMapping', 'zipCodeColumnName', 'identifierColumnName',
      'columnDataTypeSpecifications']), note: 'kontakterne følger ikke med' },
  dnclists: { create: '/api/v2/outbound/dnclists', division: true,
    check: f => f.dncSourceType && f.dncSourceType !== 'rds'
      ? `kilden er «${f.dncSourceType}», som kræver login til udbyderen — opret listen i målet` : null,
    body: f => ({ ...pickFields(f, ['name', 'contactMethod']), dncSourceType: 'rds' }), note: 'numrene følger ikke med' }
};

// Standardsvar: biblioteket oprettes, og svarene i det kopieres så godt det går
async function copyResponses(ctx, srcLib, newLib, trail) {
  const list = await pagedList(ctx.sb, '/api/v2/responsemanagement/responses', ctx.st, { libraryId: srcLib.id });
  let ok = 0;
  for (const r of list) {
    try {
      await axios.post(`${ctx.tb}/api/v2/responsemanagement/responses`,
        { ...pickFields(r, ['name', 'texts', 'responseType', 'interactionType', 'substitutions', 'substitutionsSchema']),
          libraries: [{ id: newLib.id }] },
        { headers: { Authorization: `Bearer ${ctx.tt}`, 'Content-Type': 'application/json' } });
      ok++;
    } catch (e) { trail.push(`⚠ svaret «${r.name}»: ${describeApiError(e)}`); }
  }
  trail.push(`✓ ${ok} af ${list.length} standardsvar kopieret`);
}

router.post('/api/resources/create', async (req, res) => {
  const { kind, sourceId, targetId, name } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  const spec = SIMPLE_CREATE[kind];
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!spec || !RESOURCE_KINDS[kind]) return res.status(400).json({ error: `Ukendt type "${kind}"` });
  if (!name) return res.status(400).json({ error: 'name mangler' });
  const trail = [];
  try {
    const { token: st, apiBase: sb } = await getToken(source);
    const { token: tt, apiBase: tb } = await getToken(target);
    const ctx = { st, sb, tt, tb };
    const list = RESOURCE_KINDS[kind].url;
    const hit = (await pagedList(sb, list, st)).find(x => x.name === name);
    if (!hit) return res.status(400).json({ error: `"${name}" findes ikke i ${source.name}` });
    if ((await pagedList(tb, list, tt)).some(x => x.name === name))
      return res.status(409).json({ error: 'already_exists', message: `"${name}" findes allerede i ${target.name}` });
    const full = spec.detail ? (await axios.get(`${sb}${spec.detail(hit.id)}`, { headers: { Authorization: `Bearer ${st}` } })).data : hit;
    const problem = spec.check && spec.check(full);
    if (problem) return res.status(400).json({ error: problem });
    const body = spec.body(full);
    if (spec.division && hasDivision(full)) {
      const id = await targetDivisionIdByName(tb, tt, full.division.name, trail);
      if (id) body.division = { id };
    }
    const r = await axios.post(`${tb}${spec.create}`, body, { headers: { Authorization: `Bearer ${tt}`, 'Content-Type': 'application/json' } });
    trail.push(`✓ oprettet${spec.note ? ' — ' + spec.note : ''}`);
    if (spec.after) await spec.after(ctx, hit, r.data, trail);
    addLog('SUCCESS', `${kind} "${name}" created in ${target.name}`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name, trail });
  } catch (e) {
    const msg = archyHint(describeApiError(e));
    addLog('ERROR', `Could not create ${kind} "${name}" in ${target.name}: ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg, trail });
  }
});

// En skill er kun et navn. Brugernes skills (hvem der har den) følger ikke med —
// brugere har andre id'er i målet.
router.post('/api/skills/migrate', async (req, res) => {
  const { sourceId, targetId, name } = req.body;
  const target = loadCustomers().find(c => c.id === targetId);
  if (!loadCustomers().find(c => c.id === sourceId) || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!name) return res.status(400).json({ error: 'name mangler' });
  try {
    const { token: tt, apiBase: tb } = await getToken(target);
    if ((await pagedList(tb, '/api/v2/routing/skills', tt)).some(x => x.name === name))
      return res.status(409).json({ error: 'already_exists', message: `Skill "${name}" findes allerede i ${target.name}` });
    const r = await axios.post(`${tb}/api/v2/routing/skills`, { name },
      { headers: { Authorization: `Bearer ${tt}`, 'Content-Type': 'application/json' } });
    addLog('SUCCESS', `Skill "${name}" created in ${target.name}`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name, trail: [] });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Could not create skill "${name}" in ${target.name}: ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

// Et script flyttes som helhed: eksportér fra kilden, importér i målet og
// publicér, hvis det var publiceret i kilden. Et flow peger på den publicerede
// udgave, så et upubliceret script ville stadig mangle for flowet.
router.post('/api/scripts/migrate', async (req, res) => {
  const { sourceId, targetId, scriptName } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!scriptName) return res.status(400).json({ error: 'scriptName mangler' });

  const trail = [];
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const SH = { headers: { Authorization: `Bearer ${srcToken}` } };
    const hit = (await listScripts(srcBase, srcToken, scriptName)).find(s => s.name === scriptName);
    if (!hit) return res.status(400).json({ error: `Script "${scriptName}" findes ikke i ${source.name}` });
    let srcPublished = false;
    try { await axios.get(`${srcBase}/api/v2/scripts/published/${hit.id}`, SH); srcPublished = true; }
    catch (e) { if (e.response?.status !== 404) throw e; }

    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const TH = { headers: { Authorization: `Bearer ${tgtToken}` } };
    if ((await listScripts(tgtBase, tgtToken, scriptName)).some(s => s.name === scriptName))
      return res.status(409).json({ error: 'already_exists', message: `Script "${scriptName}" findes allerede i ${target.name}` });

    // Eksporten giver en midlertidig download-URL til script-filen
    const ex = await axios.post(`${srcBase}/api/v2/scripts/${hit.id}/export`, {},
      { headers: { ...SH.headers, 'Content-Type': 'application/json' } });
    if (!ex.data?.url) throw new Error('The script export returned no download URL');
    const file = await axios.get(ex.data.url, { responseType: 'arraybuffer', timeout: 60000 });
    trail.push(`✓ export (${Math.round(file.data.length / 1024)} kB)`);

    const form = new FormData();
    form.append('file', new Blob([file.data], { type: 'application/json' }), 'script.json');
    form.append('scriptName', scriptName);
    const up = await fetch(`${appsBaseOf(tgtBase)}/uploads/v2/scripter`, {
      method: 'POST', headers: { Authorization: `Bearer ${tgtToken}` }, body: form
    });
    if (!up.ok) throw new Error(`Script upload answered ${up.status}: ${(await up.text()).slice(0, 300)}`);
    const { correlationId } = await up.json();
    if (!correlationId) throw new Error('Script upload returned no correlationId');

    // Importen kører asynkront hos Genesys — vent på svaret
    let status = null;
    for (let i = 0; i < 30; i++) {
      const s = (await axios.get(`${tgtBase}/api/v2/scripts/uploads/${correlationId}/status`,
        { ...TH, params: { longPoll: true } })).data;
      if (s.succeeded === true) { status = s; break; }
      if (s.succeeded === false && s.message) throw new Error(`Script import failed: ${s.message}`);
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!status) throw new Error('Script import did not finish within 30 seconds');
    trail.push('✓ import');

    const created = (await listScripts(tgtBase, tgtToken, scriptName)).find(s => s.name === scriptName);
    if (!created) throw new Error(`Script "${scriptName}" was imported but cannot be found in ${target.name}`);
    if (srcPublished) {
      await axios.post(`${tgtBase}/api/v2/scripts/published`, { scriptId: created.id },
        { headers: { ...TH.headers, 'Content-Type': 'application/json' } });
      trail.push('✓ publish');
    } else {
      trail.push('⚠ ikke publiceret i kilden — står som kladde i målet');
    }

    addLog('SUCCESS', `Script "${scriptName}" migrated to ${target.name}` + (srcPublished ? ' and published' : ' (draft)'),
      source.name, 'MIGRATE');
    res.json({ ok: true, id: created.id, name: created.name, published: srcPublished, trail });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Script "${scriptName}" failed: ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg, trail });
  }
});

// Kopierer en survey forms definition fra kilde- til mål-org.
router.post('/api/surveyforms/migrate', async (req, res) => {
  const { sourceId, targetId, name } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);
    const SH = { headers: { Authorization: `Bearer ${srcToken}` } };
    // Det er den UDGIVNE version et flow peger på. Formens seneste version kan være en
    // nyere kladde (published: false), mens flowet kører på den udgivne — og Archy
    // finder kun udgivne survey forms. Derfor læses den udgivne først.
    const pubList = async (base, H) => ((await axios.get(`${base}/api/v2/quality/publishedforms/surveys`,
      { ...H, params: { pageSize: 200, name } })).data.entities || []).find(f => f.name === name);
    const srcPub = await pubList(srcBase, SH).catch(() => null);
    let full, srcPublished = !!srcPub;
    if (srcPub) {
      full = (await axios.get(`${srcBase}/api/v2/quality/publishedforms/surveys/${srcPub.id}`, SH)
        .catch(() => axios.get(`${srcBase}/api/v2/quality/forms/surveys/${srcPub.id}`, SH))).data;
    } else {
      const list = await axios.get(`${srcBase}/api/v2/quality/forms/surveys`, { ...SH, params: { pageSize: 200 } });
      const hit = (list.data.entities || []).find(f => f.name === name);
      if (!hit) return res.status(400).json({ error: `Survey form "${name}" findes ikke i ${source.name}` });
      full = (await axios.get(`${srcBase}/api/v2/quality/forms/surveys/${hit.id}`, SH)).data;
      srcPublished = !!full.published;
    }

    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const TH = { headers: { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' } };
    const TG = { headers: { Authorization: `Bearer ${tgtToken}` } };
    // Findes en UDGIVEN form med navnet i målet, er der intet at gøre. En kladde
    // (fx fra en tidligere kørsel) tæller ikke — Archy finder den ikke.
    const tgtPub = await pubList(tgtBase, TG).catch(() => null);
    if (tgtPub) {
      // Er den udgivne kopi i målet en anden udgave end kildens (spørgsmålstekster og
      // svarmuligheder), finder Archy ikke svarmulighederne. Så udgives kildens udgave
      // som en ny version af samme form.
      const tekster = f => JSON.stringify((f?.questionGroups || []).map(g => (g.questions || [])
        .map(q => [q.text, (q.answerOptions || []).map(o => o.text)])));
      const udgivet = srcPublished && srcPub
        ? (await axios.get(`${tgtBase}/api/v2/quality/publishedforms/surveys/${tgtPub.id}`, TG).catch(() => ({ data: null }))).data : null;
      if (!udgivet || tekster(udgivet) === tekster(full))
        return res.status(409).json({ error: 'already_exists', message: `Survey form "${name}" findes allerede` });
      await axios.put(`${tgtBase}/api/v2/quality/forms/surveys/${tgtPub.id}`, {
        name: full.name, language: full.language, published: false, disabled: full.disabled,
        questionGroups: stripFormIds(full.questionGroups || [])
      }, TH);
      await axios.post(`${tgtBase}/api/v2/quality/publishedforms/surveys`, { id: tgtPub.id, name: tgtPub.name, published: true }, TH);
      addLog('SUCCESS', `Survey form "${name}" differed from the source — published the source's version in ${target.name}`, target.name, 'MIGRATE');
      return res.json({ ok: true, id: tgtPub.id, name, published: true });
    }
    const ex = await axios.get(`${tgtBase}/api/v2/quality/forms/surveys`, { ...TG, params: { pageSize: 200 } });
    const there = (ex.data.entities || []).find(f => f.name === name);
    if (there) {
      if (!srcPublished) return res.status(409).json({ error: 'already_exists', message: `Survey form "${name}" findes allerede` });
      // Kladden kommer fra en tidligere kørsel og kan stamme fra kildens nyeste version,
      // ikke den udgivne. Archy matcher spørgsmålenes tekst, så indholdet sættes til
      // den udgivne version, før den udgives: «could not find the answer options
      // using the survey question text …».
      await axios.put(`${tgtBase}/api/v2/quality/forms/surveys/${there.id}`, {
        name: full.name, language: full.language, published: false, disabled: full.disabled,
        questionGroups: stripFormIds(full.questionGroups || [])
      }, TH);
      await axios.post(`${tgtBase}/api/v2/quality/publishedforms/surveys`, { id: there.id, name: there.name, published: true }, TH);
      addLog('SUCCESS', `Survey form "${name}" updated to the source's published version and published in ${target.name}`, target.name, 'MIGRATE');
      return res.json({ ok: true, id: there.id, name, published: true });
    }

    // id/contextId/selfUri/modifiedDate hører til kildens form og skal ikke med
    const body = {
      name: full.name,
      language: full.language,
      published: false,
      disabled: full.disabled,
      questionGroups: stripFormIds(full.questionGroups || [])
    };
    const r = await axios.post(`${tgtBase}/api/v2/quality/forms/surveys`, body, TH);
    // «published» ved oprettelse bliver ignoreret: formen står som kladde, og Archy
    // afviser flowet med «survey forms "X" does not exist». Den udgives i et eget kald.
    if (srcPublished)
      await axios.post(`${tgtBase}/api/v2/quality/publishedforms/surveys`, { id: r.data.id, name: full.name, published: true }, TH);
    addLog('SUCCESS', `Survey form "${name}" copied to ${target.name}`, target.name, 'MIGRATE');
    res.json({ ok: true, id: r.data.id, name });
  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Could not copy survey form "${name}": ${msg}`, target.name, 'MIGRATE');
    res.status(500).json({ error: msg });
  }
});

// Fjerner id'er fra en formdefinition — de peger på kildens form.
function stripFormIds(node) {
  if (Array.isArray(node)) return node.map(stripFormIds);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'id' || k === 'contextId' || k === 'selfUri') continue;
      out[k] = stripFormIds(v);
    }
    return out;
  }
  return node;
}

module.exports = { router, appsBaseOf, queueCreateBody, groupCreateBody, scheduleCreateBody,
  scheduleGroupCreateBody, RESOURCE_KINDS, RESOURCE_MIGRATE, SIMPLE_CREATE, stripFormIds };
