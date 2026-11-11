// Systemloggen og maskering af hemmeligheder i alt der logges.

const fs = require('fs');
const { CUSTOMERS_FILE } = require('../config');
const { loadCustomers } = require('./customers');

// ── System Log ────────────────────────────────────────────────────────────────

const LOG_MAX = 2000;
const logStore = [];

// ── Maskering af hemmeligheder ────────────────────────────────────────────────
// Archy kaldes med --clientSecret på kommandolinjen, og Node lægger HELE
// kommandoen i err.message når exec fejler ("Command failed: archy …
// --clientSecret \"…\""). Den fejl er tidligere endt både i server.log, i
// systemloggen og i svaret til browseren.
//
// Maskeringen sidder derfor det ene sted alt passerer — addLog — plus på
// fejlvejen i runArchy, så selve Error-objektet også er rent.
let _secretCache = { mtime: 0, secrets: [], ids: [] };
function knownCredentials() {
  try {
    const st = fs.statSync(CUSTOMERS_FILE);
    if (st.mtimeMs !== _secretCache.mtime) {
      const list = loadCustomers();
      _secretCache = {
        mtime: st.mtimeMs,
        secrets: list.map(c => c.clientSecret).filter(x => x && x.length > 6),
        ids:     list.map(c => c.clientId).filter(x => x && x.length > 6)
      };
    }
  } catch (_) { /* ingen kundefil endnu */ }
  return _secretCache;
}

// Sættes af routes/ai.js (setAiSecrets) når AI-laget indlæses; indtil da er der
// ingen nøgler at skjule.
let aiSecrets = () => [];
const setAiSecrets = fn => { aiSecrets = fn; };

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function redactSecrets(text) {
  if (text == null) return text;
  let s = String(text);

  // Flag på kommandolinjen — uanset om værdien er i anførselstegn
  s = s.replace(/(--clientSecret\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1"***"');
  s = s.replace(/(--authToken\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1"***"');
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-]{10,}/g, '$1***');

  // Kendte værdier fra customers.json — fanger også de steder hvor de dukker
  // op uden et flag foran. Client-id'et forkortes frem for at fjernes helt,
  // så man stadig kan se HVILKEN klient det drejer sig om.
  const { secrets, ids } = knownCredentials();
  for (const sec of secrets) s = s.split(sec).join('***');
  for (const id of ids) s = s.split(id).join(id.slice(0, 8) + '…');
  // Nøglerne til AI-udbyderne (ai-providers.js) — samme behandling som en client secret
  for (const sec of aiSecrets()) s = s.split(sec).join('***');

  return s;
}

// Er man ikke logget ind endnu, er det ikke en fejl men en opfordring til at
// trykke Login — det sker hver gang siden åbnes, før PKCE-login er gennemført.
function logLevelFor(level, message) {
  return level === 'ERROR' && /OAuth token missing for "/.test(String(message)) ? 'INFO' : level;
}

function addLog(level, message, customer = null, action = 'SYSTEM') {
  level = logLevelFor(level, message);
  const entry = {
    ts: new Date().toISOString(),
    level,          // INFO | SUCCESS | WARN | ERROR
    action,         // SYSTEM | CUSTOMER | TEST | FLOWS | EXPORT | IMPORT | MIGRATE
    customer: customer || null,
    message: redactSecrets(message)
  };
  logStore.push(entry);
  if (logStore.length > LOG_MAX) logStore.shift();
  // Also mirror to console
  console.log(`[${entry.ts}] [${level}] [${action}]${customer ? ' [' + customer + ']' : ''} ${entry.message}`);
}

module.exports = { setAiSecrets, addLog, LOG_MAX, logStore, redactSecrets, logLevelFor };
