// Små fælles hjælpere: fejltekster fra Genesys, navne og filstier fra klienten.

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { FLOWS_DIR } = require('../config');
const { addLog } = require('./log');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Genesys svarer typisk 400 med en intetsigende "Bad Request" i .message, mens
// den egentlige årsag ligger i .code, .details[] og .errors[]. Vi plukkede kun
// .message ud, så loggen sagde reelt ingenting. Denne samler hele svaret til én
// linje — inkl. hvilket kald der fejlede og contextId til Genesys support.
function describeApiError(e) {
  const d = e.response?.data;
  if (!d) return e.message;

  const parts = [];
  const base = d.message || d.error || e.message;
  if (base) parts.push(base);
  if (d.code && d.code !== base) parts.push(`[${d.code}]`);

  // Feltspecifikke valideringsfejl — det er her årsagen som regel står
  const bits = [];
  for (const det of d.details || []) {
    const bit = [det.fieldName, det.entityName, det.errorCode].filter(Boolean).join(' ');
    if (bit) bits.push(bit);
  }
  for (const err of d.errors || []) {
    const bit = err.message || err.code;
    if (bit) bits.push(bit);
  }
  if (bits.length) parts.push('— ' + bits.join('; '));

  // Fandt vi intet brugbart, så vis de felter vi ikke allerede har vist,
  // frem for at tabe dem på gulvet
  if (!bits.length && (!base || /^bad request$/i.test(base))) {
    const shown = ['message', 'error', 'code', 'status', 'contextId', 'details', 'errors', 'messageParams'];
    const rest = Object.fromEntries(Object.entries(d).filter(([k, v]) => !shown.includes(k) && v != null));
    if (Object.keys(rest).length) parts.push('— ' + JSON.stringify(rest).slice(0, 400));
  }

  if (!parts.length) parts.push(e.message || 'Unknown error');

  if (e.response.status) parts.push(`(HTTP ${e.response.status}`);
  else parts.push('(');
  if (e.config?.url) {
    const p = e.config.url.replace(/^https?:\/\/[^/]+/, '');
    parts[parts.length - 1] += ` ${(e.config.method || 'get').toUpperCase()} ${p}`;
  }
  parts[parts.length - 1] += ')';

  if (d.contextId) parts.push(`contextId=${d.contextId}`);

  // Et manglende scope rettes på OAuth-klienten, ikke på brugerens roller —
  // og et nyt scope gælder først efter et nyt login.
  if (d.code === 'app.not.authorized.for.scope')
    parts.push('— add the scope to the OAuth client in Genesys (Admin → Integrations → OAuth → the client → Scope), then log in again');
  if (d.code === 'bad.credentials')
    parts.push('— the login is no longer valid (expired, revoked or the org\'s idle timeout); log in again');

  return parts.join(' ');
}

// En Data Actions config peger på template-FILER hos kilden via
// requestTemplateUri / successTemplateUri, og de URI'er indeholder kildens
// action-id. Kopieres de råt til en anden org, peger de på en action der ikke
// findes der. Vi henter derfor indholdet og sender det som inline templates.
async function inlineActionTemplates(cfg, apiBase, token) {
  const out = {
    request:  { ...(cfg.request  || {}) },
    response: { ...(cfg.response || {}) }
  };
  const warnings = [];
  const jobs = [
    ['request',  'requestTemplateUri', 'requestTemplate'],
    ['response', 'successTemplateUri', 'successTemplate']
  ];
  for (const [section, uriKey, tplKey] of jobs) {
    const uri = out[section][uriKey];
    if (!uri) continue;
    if (out[section][tplKey]) { delete out[section][uriKey]; continue; }
    try {
      const r = await axios.get(`${apiBase}${uri}`, { headers: { Authorization: `Bearer ${token}` } });
      out[section][tplKey] = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      delete out[section][uriKey];
    } catch (e) {
      // Behold URI'en ikke — den ville pege på kildens org
      delete out[section][uriKey];
      warnings.push(`Kunne ikke hente ${tplKey}: ${describeApiError(e)}`);
    }
  }
  return { config: out, warnings };
}

// Kontrakten indeholder både inline-skemaer og *SchemaUri-pegepinde, og
// pegepindene bærer kildens action-id. De ville referere en action der ikke
// findes i målorganisationen, så vi sender kun de inline skemaer.
function stripSchemaUris(section) {
  if (!section || typeof section !== 'object') return section;
  return Object.fromEntries(Object.entries(section).filter(([k]) => !/Uri$/.test(k)));
}

function sanitizeName(name) {
  // Remove Windows-invalid path chars, keep rest as-is
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'unknown';
}

// Et miljøs eksporter ligger i flows/<navn>. Skifter navnet, skal mappen med —
// ellers ser Flow Browser og rollback-cachen en tom mappe og glemmer alt der
// er hentet. Findes den nye mappe allerede, flettes der ikke: så bliver begge
// stående, og loggen siger det.
function moveCustomerFolder(oldName, newName) {
  const from = path.join(FLOWS_DIR, sanitizeName(oldName));
  const to   = path.join(FLOWS_DIR, sanitizeName(newName));
  if (from === to || !fs.existsSync(from)) return;
  // Kun forskel i store/små bogstaver: på Windows ER det den samme mappe.
  if (from.toLowerCase() === to.toLowerCase()) {
    try { fs.renameSync(from, to); } catch (_) {}
    return;
  }
  if (fs.existsSync(to)) {
    addLog('WARN', `Folder not moved: "${path.basename(to)}" already exists — exports stay in "${path.basename(from)}"`, newName, 'CUSTOMER');
    return;
  }
  try { fs.renameSync(from, to); }
  catch (e) { addLog('WARN', `Could not move folder "${path.basename(from)}": ${e.message}`, newName, 'CUSTOMER'); }
}

// ── Felter fra klienten ──────────────────────────────────────────────────────

// Et manglende felt skal give en besked man kan handle på. Uden dette kom
// /api/export ud som
//
//     500 Cannot read properties of undefined (reading 'toLowerCase')
//
// fordi flowType blev brugt før nogen havde set efter om den var der. Det er en
// Node-fejl, ikke en forklaring: den siger hvad koden snublede over, ikke hvad
// man selv har glemt at sende.
//
// Returnerer null når alt er der, ellers en besked der navngiver de felter der
// mangler.
function missingFields(body, felter) {
  const mangler = felter.filter(f => typeof body?.[f] !== 'string' || !body[f].trim());
  if (!mangler.length) return null;
  return mangler.length === 1
    ? `Missing or empty field: ${mangler[0]}`
    : `Missing or empty fields: ${mangler.join(', ')}`;
}

// ── Filstier fra klienten ────────────────────────────────────────────────────

// Ligger stien inden for FLOWS_DIR? path.resolve SKAL med: uden den slipper
// "…\flows\..\customers.json" igennem, fordi strengen jo begynder rigtigt.
// Målt før rettelsen: /api/files/content udleverede hele customers.json med
// alle kunders credentials på den måde.
function insideFlowsDir(p) {
  if (!p) return false;
  const rod = path.resolve(FLOWS_DIR);
  const sti = path.resolve(String(p));
  return sti === rod || sti.startsWith(rod + path.sep);
}

// Et filnavn fra klienten må ikke kunne pege ud af den mappe det hører til.
// path.join(importDir, "../../../fil.yaml") lander uden for FLOWS_DIR, og
// /api/import skrev dér uden at spørge — målt landede filen i C:\Tools\.
// Vi tager derfor kun selve navnet, uden mapper, og renser det. Så er der
// ingenting tilbage at navigere med.
function safeFileName(navn, standard) {
  const kun = path.basename(String(navn || '').replace(/\\/g, '/'));
  const rent = sanitizeName(kun).replace(/^[.\s]+/, '').trim();
  return rent && rent !== 'unknown' ? rent : standard;
}

module.exports = { sanitizeName, missingFields, describeApiError, moveCustomerFolder,
  stripSchemaUris, inlineActionTemplates, safeFileName, insideFlowsDir };
