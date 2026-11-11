// Ruter: org-indstillinger (sammenlign og migrér).

const express = require('express');
const axios = require('axios');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { describeApiError } = require('../lib/helpers');
const { getToken } = require('../lib/token');
const { pagedList, orgReadError } = require('../lib/genesys');
const { archyHint } = require('../lib/archy');

const router = express.Router();

// ── Org-indstillinger ─────────────────────────────────────────────────────────
// Det man ser under Admin → Organization Settings. Sammenligningen læser kun.
// Migreringen skriver to slags: organisationens egne statusser (presence
// definitions) og standardsprog/-land. Alt andet — tilladte domæner, IP-lister og
// login-indstillinger — vises kun: en forkert værdi kan låse brugere ude, og
// SSO-udbydere indeholder certifikater og hemmeligheder der ikke kan læses ud.
const ORGSET_LANGUAGE_KEYS = ['defaultLanguage', 'defaultCountryCode'];
// Kun læsning: [sektion, sti, felt der sammenlignes]
const ORGSET_READONLY = [
  ['embedded', '/api/v2/organizations/embeddedintegration', 'integrationWhiteList'],
  ['whitelist', '/api/v2/organizations/whitelist', null],
];

// En status har ikke altid et navn; labelen er det man ser i Genesys.
function presenceLabel(d) {
  if (!d) return '';
  if (d.name) return String(d.name);
  const l = d.languageLabels && typeof d.languageLabels === 'object' ? d.languageLabels : {};
  return String(l.en_US || l.en || Object.values(l)[0] || '');
}
// De primære statuser (Available, Away, Offline …) findes i enhver org.
const presenceKeep = d => !!d && !d.primary;

function presenceCreateBody(d) {
  const body = { languageLabels: d.languageLabels || {}, systemPresence: d.systemPresence };
  if (d.deactivated != null) body.deactivated = !!d.deactivated;
  if (d.name) body.name = d.name;
  return body;
}

// Organisationen skrives som helhed: hent målets egen, ret ét felt, skriv den tilbage.
function languagePutBody(targetMe, key, value) {
  if (!ORGSET_LANGUAGE_KEYS.includes(key)) throw new Error(`"${key}" may not be changed here`);
  const body = { ...targetMe, [key]: value };
  delete body.selfUri;
  return body;
}

// Samme tekst for samme indhold, uanset nøglernes rækkefølge.
function settingText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  const sorted = x => Array.isArray(x) ? x.map(sorted)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sorted(x[k])])) : x;
  try { return JSON.stringify(sorted(v)); } catch (_) { return String(v); }
}
const sameSetting = (a, b) => settingText(a) === settingText(b);

async function orgGet(apiBase, token, path) {
  try {
    const r = await axios.get(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { ok: true, data: r.data };
  } catch (e) {
    return { ok: false, error: orgReadError(e) };
  }
}

// Rækkerne: { section, item, source, target, status, migratable }
// status: same | differs | missing | extra | unreadable
function orgSettingRows(src, tgt) {
  const rows = [];
  const unreadable = (section, item, why) => rows.push({ section, item, source: '', target: '', status: 'unreadable', migratable: false, detail: why });

  // Statuser
  if (!src.presence.ok || !tgt.presence.ok) unreadable('presence', '—', (src.presence.error || tgt.presence.error));
  else {
    const list = x => (x.data.entities || x.data || []).filter(presenceKeep);
    const tmap = new Map(list(tgt.presence).map(d => [presenceLabel(d), d]));
    const seen = new Set();
    for (const d of list(src.presence)) {
      const label = presenceLabel(d), hit = tmap.get(label);
      seen.add(label);
      const base = { section: 'presence', item: label, source: d.systemPresence || '', migratable: false };
      if (!hit) rows.push({ ...base, target: '', status: 'missing', migratable: true });
      else rows.push({ ...base, target: hit.systemPresence || '',
        status: (hit.systemPresence === d.systemPresence && !!hit.deactivated === !!d.deactivated) ? 'same' : 'differs' });
    }
    for (const [label, d] of tmap) if (!seen.has(label))
      rows.push({ section: 'presence', item: label, source: '', target: d.systemPresence || '', status: 'extra', migratable: false });
  }

  // Standardsprog og -land
  if (!src.me.ok || !tgt.me.ok) unreadable('language', '—', src.me.error || tgt.me.error);
  else {
    for (const key of ORGSET_LANGUAGE_KEYS) {
      const a = src.me.data[key], b = tgt.me.data[key];
      rows.push({ section: 'language', item: key, source: settingText(a), target: settingText(b),
        status: sameSetting(a, b) ? 'same' : 'differs', migratable: !sameSetting(a, b) && a != null });
    }
    const a = src.me.data.supportedLanguages, b = tgt.me.data.supportedLanguages;
    if (a !== undefined || b !== undefined)
      rows.push({ section: 'language', item: 'supportedLanguages', source: settingText(a), target: settingText(b),
        status: sameSetting(a, b) ? 'same' : 'differs', migratable: false });
  }

  // Kun til sammenligning
  for (const [section, , field] of ORGSET_READONLY) {
    const s = src[section], g = tgt[section];
    if (!s.ok || !g.ok) { unreadable(section, '—', s.error || g.error); continue; }
    const a = field ? s.data[field] : s.data, b = field ? g.data[field] : g.data;
    rows.push({ section, item: field || section, source: settingText(a), target: settingText(b),
      status: sameSetting(a, b) ? 'same' : 'differs', migratable: false });
  }
  return rows;
}

router.get('/api/orgsettings/compare', async (req, res) => {
  const source = loadCustomers().find(c => c.id === req.query.sourceId);
  const target = loadCustomers().find(c => c.id === req.query.targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (source.id === target.id) return res.json({ sameOrg: true, rows: [] });
  try {
    const read = async c => {
      const { token, apiBase } = await getToken(c);
      const out = {};
      out.presence = await (async () => {
        try { return { ok: true, data: { entities: await pagedList(apiBase, '/api/v2/presencedefinitions', token) } }; }
        catch (e) { return { ok: false, error: orgReadError(e) }; }
      })();
      out.me = await orgGet(apiBase, token, '/api/v2/organizations/me');
      for (const [section, path] of ORGSET_READONLY) out[section] = await orgGet(apiBase, token, path);
      return out;
    };
    const [s, t] = [await read(source), await read(target)];
    res.json({ sourceName: source.name, targetName: target.name, rows: orgSettingRows(s, t) });
  } catch (e) { res.status(500).json({ error: archyHint(describeApiError(e)) }); }
});

router.post('/api/orgsettings/migrate', async (req, res) => {
  const { sourceId, targetId, items } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (source.id === target.id) return res.status(400).json({ error: 'Kilde og mål må ikke være samme org' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Intet valgt' });
  try {
    const { token: st, apiBase: sb } = await getToken(source);
    const { token: tt, apiBase: tb } = await getToken(target);
    const TH = { headers: { Authorization: `Bearer ${tt}`, 'Content-Type': 'application/json' } };
    const results = [];
    let srcPresence = null, tgtPresence = null, srcMe = null;
    for (const it of items) {
      const id = `${it.section}:${it.item}`;
      try {
        if (it.section === 'presence') {
          srcPresence = srcPresence || await pagedList(sb, '/api/v2/presencedefinitions', st);
          tgtPresence = tgtPresence || await pagedList(tb, '/api/v2/presencedefinitions', tt);
          const hit = srcPresence.filter(presenceKeep).find(d => presenceLabel(d) === it.item);
          if (!hit) { results.push({ id, name: it.item, status: 'error', message: `findes ikke i ${source.name}` }); continue; }
          if (tgtPresence.some(d => presenceLabel(d) === it.item)) { results.push({ id, name: it.item, status: 'exists' }); continue; }
          await axios.post(`${tb}/api/v2/presencedefinitions`, presenceCreateBody(hit), TH);
          addLog('SUCCESS', `Presence "${it.item}" created in ${target.name}`, target.name, 'MIGRATE');
          results.push({ id, name: it.item, status: 'created' });
        } else if (it.section === 'language') {
          if (!ORGSET_LANGUAGE_KEYS.includes(it.item)) { results.push({ id, name: it.item, status: 'error', message: 'Kan ikke migreres' }); continue; }
          srcMe = srcMe || (await axios.get(`${sb}/api/v2/organizations/me`, { headers: { Authorization: `Bearer ${st}` } })).data;
          const tgtMe = (await axios.get(`${tb}/api/v2/organizations/me`, { headers: { Authorization: `Bearer ${tt}` } })).data;
          if (sameSetting(srcMe[it.item], tgtMe[it.item])) { results.push({ id, name: it.item, status: 'exists' }); continue; }
          await axios.put(`${tb}/api/v2/organizations/me`, languagePutBody(tgtMe, it.item, srcMe[it.item]), TH);
          addLog('SUCCESS', `Org setting ${it.item} set to "${srcMe[it.item]}" in ${target.name}`, target.name, 'MIGRATE');
          results.push({ id, name: it.item, status: 'created', detail: `${settingText(tgtMe[it.item])} → ${settingText(srcMe[it.item])}` });
        } else results.push({ id, name: it.item, status: 'error', message: 'Kan ikke migreres' });
      } catch (e) {
        const msg = archyHint(describeApiError(e));
        addLog('ERROR', `Could not migrate org setting ${id} to ${target.name}: ${msg}`, target.name, 'MIGRATE');
        results.push({ id, name: it.item, status: 'error', message: msg });
      }
    }
    res.json({ ok: true, results });
  } catch (e) { res.status(500).json({ error: archyHint(describeApiError(e)) }); }
});

module.exports = { router, presenceLabel, presenceKeep, presenceCreateBody, languagePutBody,
  settingText, orgSettingRows };
