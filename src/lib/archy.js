// Archy: find programmet, byg kommandolinjen, kør det og forklar dets fejl.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { DATA_DIR, loadSettings } = require('../config');
const { addLog, redactSecrets } = require('./log');
const { orgKeyOf, isDemo } = require('./environments');
const { oauthToken } = require('./token');
const { getFlowPublishInfo } = require('./genesys');

// ── Archy helpers ────────────────────────────────────────────────────────────

// Find archy's own directory at startup (archy.bat uses relative paths so must
// be run from there). We detect it by resolving 'where archy' on cmd.exe.
let ARCHY_DIR = null;
// Kommandoen der kalder Archy. "archy" når den findes i PATH; ellers den fulde
// sti til archy.bat, så Archy virker uden at være sat i PATH.
let ARCHY_CMD = 'archy';

// Steder Archy typisk pakkes ud, når den ikke ligger i PATH. Rækkefølgen er
// prioriteten; en sti fra settings.json (archyDir) eller miljøvariablen
// ARCHY_DIR vinder over gætene.
function archyCandidateDirs() {
  const home = process.env.USERPROFILE || os.homedir();
  const liste = [
    process.env.ARCHY_DIR,
    (() => { try { return loadSettings().archyDir; } catch (_) { return null; } })(),
    'C:\\Tools\\Archy', 'C:\\Archy', 'C:\\Program Files\\Archy', 'C:\\Program Files (x86)\\Archy',
    path.join(home, 'Archy'), path.join(home, 'archy'),
    path.join(home, 'Downloads', 'archy'), path.join(home, 'Downloads', 'Archy'),
  ];
  return liste.filter(Boolean);
}

// Finder mappen med archy.bat — direkte eller i en undermappe (bin).
function archyDirIn(dir) {
  for (const d of [dir, path.join(dir, 'bin')]) {
    if (fs.existsSync(path.join(d, 'archy.bat'))) return d;
  }
  return null;
}

try {
  const { execSync } = require('child_process');
  const archyBat = execSync('where archy', { shell: 'cmd.exe', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().split(/\r?\n/)[0].trim();
  ARCHY_DIR = path.dirname(archyBat);
  console.log(`[archy] Found at: ${ARCHY_DIR}`);
} catch (e) {
  for (const kandidat of archyCandidateDirs()) {
    const d = archyDirIn(kandidat);
    if (d) {
      ARCHY_DIR = d;
      ARCHY_CMD = `"${path.join(d, 'archy.bat')}"`;
      console.log(`[archy] Not in PATH — using ${ARCHY_DIR}`);
      break;
    }
  }
  if (!ARCHY_DIR) console.warn('[archy] Not found in PATH or in the usual folders');
}

// ── Værdier på Archys kommandolinje ──────────────────────────────────────────
// runArchy kalder exec med shell: 'cmd.exe'. Inde i en citeret streng kan et
// anførselstegn IKKE escapes i cmd — det afslutter citatet, og resten af
// værdien læses som kommandoer. Målt: et flownavn som
//
//     uskyldigt" & echo naaet-igennem> "fil.txt" & rem
//
// fik echo'et til at køre. Værdien kom fra req.body, så enhver der kunne nå
// serveren kunne køre kommandoer på maskinen.
//
// Der findes ingen escape der virker, så værdien afvises i stedet. Målt på 517
// rigtige flownavne i fire orgs: ingen indeholder et anførselstegn.
function archyArg(vaerdi, felt) {
  const s = String(vaerdi ?? '');
  if (s.includes('"'))
    throw new Error(`${felt} must not contain a double quote: Archy is invoked through cmd.exe, ` +
                    `where the character cannot be escaped. Rename the flow, or export it by hand.`);
  return `"${s}"`;
}

// Værdier UDEN anførselstegn omkring — fx --flowType. Her er selv et mellemrum
// eller et & nok til at bryde ud, så de må kun bestå af de tegn de faktisk har.
function archyBareArg(vaerdi, felt) {
  const s = String(vaerdi ?? '');
  if (!/^[A-Za-z0-9_.\-]+$/.test(s))
    throw new Error(`${felt} "${s}" is not a valid name`);
  return s;
}

// --flowVersion tager formen '5.0'. Tom værdi betyder Archys standard, 'latest'.
function archyVersionFlag(version) {
  if (version === null || version === undefined || version === '') return '';
  const s = String(version).trim();
  if (!/^\d+(\.\d+)?$/.test(s))
    throw new Error(`Invalid flow version "${s}" — expected e.g. 5.0`);
  return `--flowVersion ${archyArg(s.includes('.') ? s : s + '.0', 'Flow version')} `;
}

// Underkommandoen er ikke en værdi — den er et af tre faste ord. Den kom fra
// req.body.action og gik uciteret ind i kommandoen.
const ARCHY_VERBS = new Set(['create', 'update', 'publish']);
function archyVerb(handling) {
  const s = String(handling || 'create');
  if (!ARCHY_VERBS.has(s))
    throw new Error(`Unknown action "${s}" — use create, update or publish`);
  return s;
}

// Build credential flags for archy CLI (no config file needed)
function archyCredFlags(customer) {
  // OAuth customers: use stored bearer token
  if (customer.authType === 'oauth')
    return `--authToken ${archyArg(oauthToken(customer), 'Token')} --location ${archyArg(customer.region, 'Region')}`;

  // Client credentials. Tidligere blev " erstattet med \" — den escape virker i
  // en POSIX-skal, men ikke i cmd.exe, så et secret med et anførselstegn ville
  // være brudt ud på samme måde som flownavnet.
  return `--clientId ${archyArg(customer.clientId, 'Client ID')} ` +
         `--clientSecret ${archyArg(customer.clientSecret, 'Client Secret')} ` +
         `--location ${archyArg(customer.region, 'Region')}`;
}

function parseArchyOutput(raw) {
  if (!raw) return raw;
  const cleaned = raw
    .replace(/\x1B\[[0-9;]*m/g, '')
    .replace(/\[0m/g, '');
  const filtered = cleaned.split(/\r?\n/).filter(line => {
    const t = line.trim();
    if (/^\*{5,}/.test(t)) return false;
    if (/Archy - Architect Yaml Flow Processor/.test(t)) return false;
    if (/^DateTime:/.test(t)) return false;
    if (t === 'Summary') return false;
    if (/^Log:\s/.test(t)) return false;
    if (/^[┌┐└┘]/.test(t)) return false;
    if (/Archy (patch|minor|major) version update available/.test(t)) return false;
    if (/Changelog:.*genesys/.test(t)) return false;
    if (/Run archy version.*to upgrade/.test(t)) return false;
    if (t === 'execution complete.') return false;
    if (/^TRACE:\[/.test(t) || /^flowId: .*opName: /.test(t)) return false;   // Archys interne sporing
    if (/^exit code:/.test(t)) return false;
    return true;
  });
  const result = [];
  let prevBlank = false;
  for (const line of filtered) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue;
    result.push(line);
    prevBlank = isBlank;
  }
  return result.join('\n').trim();
}

// Archy afviser en flowtype, målets org ikke har produktet til (fx beskeder/SMS
// til INBOUNDSHORTMESSAGE). Det kan ikke løses herfra, så beskeden siger hvad
// der er galt og hvad man kan gøre — i stedet for kun Archys engelske tekst.
function archyHint(msg) {
  const scope = String(msg || '').match(/App not authorized to use scope \[([^\]]+)\]/i);
  if (scope && !/OAuth-klienten/.test(msg))
    return `${msg}
  — OAuth-klienten i mål-org'en mangler scope [${scope[1]}]. Tilføj det under Admin → Integrations → OAuth, ` +
           `og log ind igen. Outbound-flows (og survey-flows med kontaktlister) kræver det.`;
  const m = String(msg || '').match(/the flow type '([a-z]+)' is not available/i);
  if (!m) return msg;
  return `${msg}
  — ${m[1].toUpperCase()} kræver et produkt, mål-org'en ikke har (fx Messaging for SMS/beskeder). ` +
         `Aktivér det i mål-org'en, eller fjern flowet fra migreringen.`;
}

// Flowtyper et mål har afvist («flow type … is not available»), pr. org. Uden den
// huskede værktøjet intet: hvert SMS-flow i en liste migrerede først sine køer,
// åbningstider og prompts over — og fejlede så alligevel på typen. Gælder i en
// halv time, så et produkt der aktiveres imens, ikke blokerer for evigt.
const UNAVAILABLE_TYPES = new Map();
const UNAVAILABLE_TYPE_MS = 30 * 60 * 1000;
const unavailableKey = (target, type) => `${orgKeyOf(target)}|${String(type || '').toLowerCase()}`;
function noteUnavailableType(target, msg) {
  const m = String(msg || '').match(/the flow type '([a-z]+)' is not available/i);
  if (m) UNAVAILABLE_TYPES.set(unavailableKey(target, m[1]), Date.now());
}
function typeUnavailableHere(target, type) {
  const at = UNAVAILABLE_TYPES.get(unavailableKey(target, type));
  return !!at && Date.now() - at < UNAVAILABLE_TYPE_MS;
}

const ARCHY_LOG_TAIL = 30; // Max lines shown from Archy error output

function truncateArchyError(raw) {
  if (!raw) return raw;
  const lines = raw.split(/\r?\n/);
  if (lines.length <= ARCHY_LOG_TAIL) return raw;
  const tail = lines.slice(-ARCHY_LOG_TAIL);
  return `[... ${lines.length - ARCHY_LOG_TAIL} lines hidden — showing the last ${ARCHY_LOG_TAIL} ...]\n` + tail.join('\n');
}

// Archy skriver stien til sin egen fulde udskrift i en "Log:"-linje til sidst.
// parseArchyOutput filtrerer den væk som støj — med rette når det gik godt.
//
// Men når det gik galt, er den den eneste pegepind til hele detaljen, og det vi
// selv kan trække ud er nogle gange kun "Architect Scripting session ended in
// error ( code: 99 )". Tre migreringer fejlede sådan, og der var intet at gå
// videre med — mens hele forklaringen lå i en fil vi kendte stien til og smed
// væk. Så hæftes den på fejlen i stedet.
function archyDebugLog(out) {
  const m = String(out || '').match(/^[ \t]*Log:[ \t]*(\S.*?)[ \t]*$/mi);
  return m ? m[1] : null;
}

function withArchyLog(besked, out) {
  const sti = archyDebugLog(out);
  return sti ? `${besked}\n  — full Archy output: ${sti}` : besked;
}

// Fejler et flow valideringen, står den brugbare tekst i "Validation Results"
// — ikke i opsummeringen, som kun TÆLLER. Og opsummeringen sætter warnings
// sidst:
//
//     ERROR - the flow has 1 error(s). (see above)
//     WARNING - the flow has 14 warning(s). (see above)
//     Error(s) and warning(s) encountered.
//
// Baglænssøgningen ramte derfor WARNING-linjen og skjulte fejlen helt. Brugeren
// fik "the flow has 14 warning(s)" og kunne intet stille op med det, mens den
// eneste sætning der forklarede noget — "A data action must be selected." —
// stod hundrede linjer længere oppe.
//
// Blokken ser sådan ud, og både navnet og stien hører med:
//
//     1 -> [Type:'ArchValidationIssue', ErrorCount:1, ArchObject:[…, Name:'Call Data Action', …]]
//     A data action must be selected.
//         ___ Yaml Info ___
//         ref path: /inboundEmail/states/state[Initial State_11]/actions/callData[…]
//
// RollupErrorCount er en optælling af de samme fejl et niveau oppe ("There is
// one action in error within this task") og tages ikke med — den ville
// fordoble hver fejl.
function archyValidationIssues(lines) {
  const start = lines.findIndex(l => /^Validation Results$/i.test(l));
  if (start === -1) return [];
  const ud = [];
  for (let i = start; i < lines.length; i++) {
    const h = lines[i].match(/^\d+\s*->\s*\[Type:'ArchValidationIssue',\s*ErrorCount:\d+/);
    if (!h) continue;
    const navn = (lines[i].match(/Name:'([^']*)'/) || [])[1];
    const efter = lines.slice(i + 1, i + 8);
    const besked = efter.find(x => x && !/^_+\s*Yaml Info|^ref path:|^name:/i.test(x));
    if (!besked) continue;
    const sti = (efter.find(x => /^ref path:/i.test(x)) || '').replace(/^ref path:\s*/i, '').trim();
    const hvor = [navn, sti].filter(Boolean).join(' i ');
    ud.push(hvor ? `${besked} (${hvor})` : besked);
  }
  return ud;
}

// Hvorfor en genpublicering fejlede, i en form brugerfladen kan forklare.
// Genpublicering eksporterer den publicerede udgave og importerer den igen —
// og så valideres flowet mod org'en som den er NU. Peger det på en kø der er
// slettet, eller en TTS-stemme org'en ikke har længere, afviser Archy det,
// selvom flowet kører i dag. Teksten er archyErrorReason's, evt. med stien til
// Archys debug-log på.
const REF_KIND = [
  [/queue/i, 'queue'], [/user/i, 'user'], [/datatable/i, 'datatable'],
  [/dataaction|^action$/i, 'dataaction'], [/prompt|audio/i, 'prompt'],
  [/schedule|emergency/i, 'schedule'], [/flow|module/i, 'flow']
];
function explainRepublishFailure(msg) {
  const tekst = String(msg || '');
  const debugFile = (tekst.match(/full Archy output:\s*(.+?\.txt)/i) || [])[1] || null;
  const reason = tekst.replace(/\s*—\s*full Archy output:.*$/i, '').trim();
  const [, field = null, sti = null] = reason.match(/\('([^']+)' i '([^']+)'\)/) || [];
  // Hvor i flowet: det sidste navngivne element i stien, fx menu[EG_Demo_69].
  // Archys egne løbenavne (_^_archy_…) siger ikke brugeren noget.
  const navngivne = [...String(sti || '').matchAll(/(\w+)\[([^\]]+)\]/g)]
    .filter(m => !m[2].startsWith('_^_archy'));
  const where = navngivne.length ? `${navngivne.at(-1)[1]} "${navngivne.at(-1)[2]}"` : null;
  const ud = { kind: 'other', field, where, path: sti, reason, debugFile };

  let m;
  if ((m = reason.match(/text to speech voice with the name '([^']+)'.*?language '([^']+)'/i)))
    return { ...ud, kind: 'tts-voice', value: m[1], lang: m[2] };
  if ((m = reason.match(/default voice was not found for engine '[^']+' and language '([^']+)'/i)))
    return { ...ud, kind: 'tts-default', lang: m[1] };
  if (/no matches/i.test(reason)) {
    const hit = REF_KIND.find(([re]) => re.test(field || ''));
    return { ...ud, kind: 'missing-ref', what: hit ? hit[1] : 'other' };
  }
  if (/expected an? \w+ but got null/i.test(reason)) return { ...ud, kind: 'empty-field' };
  if (/checked out|locked/i.test(reason)) return { ...ud, kind: 'locked' };
  return ud;
}

// Trækker den forklarende årsag ud af Archys output. Ved TLS-fejl er Archys
// egen konklusion ("ugyldige credentials") misvisende, så den underliggende
// certifikatfejl tages med i stedet.
function archyErrorReason(out) {
  const lines = out.split(/\r?\n/)
    .map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))            // ANSI-farver
    .map(l => l.replace(/^\S+Z:\s*\[[A-Z]+\]\s*/, ''))      // debug-log-præfiks
    .map(l => l.trim());

  let summary = '';
  // Hvor i udskriften årsagen blev fundet. Path: og Property name: står som
  // indrykkede detaljelinjer LIGE UNDER deres overskrift, så de skal hentes
  // dér — ikke med find() gennem hele udskriften. Målt: i et flow med mange
  // variabler blev den første forekomst grebet, og brugeren fik
  // "('stringVariable' i '/inboundEmail/variables/stringVariable')" hængt på en
  // fejl den intet havde med at gøre.
  let summaryIndex = -1;
  // -1 og samtidig et summary betyder: årsagen bærer allerede sin egen sti.
  let harEgenSti = false;

  // Detaljelinjerne der hører til overskriften på linje i.
  const detaljer = (i) => {
    const nær = i >= 0 ? lines.slice(i + 1, i + 4) : [];
    const hent = (re) => (nær.find(l => re.test(l)) || '').replace(re, '').trim();
    return { prop: hent(/^Property name:\s*/i), sti: hent(/^Path:\s*/i) };
  };

  const valideringsfejl = archyValidationIssues(lines);
  if (valideringsfejl.length) {
    summary = valideringsfejl.slice(0, 3).join(' · ');
    if (valideringsfejl.length > 3) summary += ` (+${valideringsfejl.length - 3} more)`;
    harEgenSti = true;
  }

  // Ved YAML-/importfejl lægger Archy den egentlige årsag i en "Exception:"-linje
  // langt over sin afsluttende opsummering. Den er langt mere brugbar end det
  // der står lige før terminatoren (typisk "Flow Name: '…'").
  const excIndex = summary ? -1 : lines.findIndex(l => /^Exception:/i.test(l));
  if (excIndex >= 0) {
    summaryIndex = excIndex;
    summary = lines[excIndex]
      .replace(/^Exception:\s*-?\s*(ERROR!\s*)?/i, '')
      .replace(/\s*--\s*\[.*$/, '')          // metadata-halen
      .trim();
    // Tag den ramte property og sti med — det er dem man skal rette i YAML'en
    const { prop, sti } = detaljer(excIndex);
    if (prop) summary += ` (${prop}${sti ? ' i ' + sti : ''})`;
  }

  // Ellers: Archys egen konklusion lige før "Error(s) [and warning(s)] encountered."
  //
  // Archy skriver fejlen som en overskriftslinje efterfulgt af indrykkede
  // detaljer:
  //
  //     did not find a text to speech voice with the name 'da-DK-Standard-C' …
  //         Path: '/inboundCall/supportedLanguages/textToSpeech'
  //         Property name: 'voice'
  //
  // Detaljerne SKAL tælle som støj når vi leder baglæns efter overskriften —
  // ellers greb vi "Property name: 'voice'" og kastede den eneste brugbare
  // sætning væk. De hægtes i stedet på til sidst.
  if (!summary) {
    const noise = /^(\*+|DateTime:|Summary$|Command:|Log:|Flow Name:|Input YAML File:|Path:|Property name:|Value:|Line:|\||└|┌|-\s*Architect Scripting|An error occurred)/i;
    const end = lines.findIndex(l => /^Error\(s\)(\s+and\s+warning\(s\))?\s+encountered\.?$/i.test(l));
    if (end > 0) {
      // Opsummeringen sætter warnings EFTER errors, så den første linje man
      // møder baglæns er warning-linjen. Har Archy også talt fejl, er det dem
      // der gør at kommandoen mislykkedes — de vinder.
      const fejlLinje = lines.slice(Math.max(0, end - 12), end)
        .find(l => /^ERROR\s*-\s*the flow has/i.test(l));
      if (fejlLinje) summary = fejlLinje;

      for (let i = end - 1; !summary && i >= 0 && end - i < 12; i--) {
        const l = lines[i];
        if (l && !noise.test(l) && !/Architect Yaml Flow Processor/i.test(l)) {
          summary = l; summaryIndex = i; break;
        }
      }
    }
  }

  // Sti og property hører til — det er dem man skal rette i YAML'en. Men kun
  // DEM DER STÅR UNDER den overskrift vi valgte. Tidligere blev de hentet med
  // find() gennem hele udskriften, og så fulgte der en sti med der intet havde
  // med fejlen at gøre.
  if (summary && !harEgenSti && !/\($/.test(summary)) {
    const { prop, sti } = detaljer(summaryIndex);
    if (prop && !summary.includes(prop)) summary += ` (${prop}${sti ? ' i ' + sti : ''})`;
  }

  // Manglende Genesys-rettigheder ender også som den generiske "session ended
  // in error ( code: 99 )". Rettighedens navn står i en linje for sig og er det
  // eneste brugbare — uden det aner man ikke hvad man skal gøre.
  const perm = lines.find(l => /missing permission '[^']+'|the '[^']+' permission is required/i.test(l));
  if (perm && (!summary || /session ended in error/i.test(summary))) {
    const p = perm.match(/'([^']+)'/);
    summary = p
      ? `The OAuth client is missing the '${p[1]}' permission in this org`
      : perm.replace(/\s*--\s*\[.*$/, '');
  }

  // Archy melder en manglende ressource som "find '<type>' by value of '<navn>'
  // - no matches", men opsummerer det som "Architect Scripting session ended in
  // error ( code: 99 )". Den generiske linje siger intet, så vi foretrækker den
  // specifikke.
  if (!summary || /session ended in error|^Error details:\s*no matches\.?$/i.test(summary)) {
    const miss = lines.find(l => /find '[^']+' by value of '[^']+'\s*-\s*no matches/i.test(l));
    const m = miss && miss.match(/find '([^']+)' by value of '([^']+)'/i);
    if (m) summary = `${m[1]} "${m[2]}" does not exist in the target org`;
  }

  // Ved TLS-fejl er Archys egen konklusion ("ugyldige credentials") misvisende,
  // så den underliggende certifikatfejl skal frem i stedet.
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate/i.test(out)) {
    return 'Archy could not verify the certificate chain (UNABLE_TO_VERIFY_LEAF_SIGNATURE) — typically ' +
           'TLS inspection by Norton or a corporate proxy. Archy runs with --use-system-ca, so ' +
           'the proxy root CA must be installed in the Windows certificate store.' +
           (summary ? ` [Archy: ${summary}]` : '');
  }
  return summary;
}

// Archy er en kompileret .exe med sin egen indlejrede Node. Den forstår IKKE
// --use-system-ca (flaget kom i Node 22.15, binæren er ældre), så bag TLS-
// inspektion — Norton, firmaproxy — fejler den med UNABLE_TO_VERIFY_LEAF_SIGNATURE
// og rapporterer det misvisende som ugyldige credentials.
//
// NODE_EXTRA_CA_CERTS respekterer den derimod. Vi kan ikke regne med at
// variablen er sat i miljøet, så vi skriver vores eget bundle: Nodes indbyggede
// rødder + Windows' certifikatlager (hvor proxyens root ligger installeret).
// Målt: bundle uden proxyens egen .pem er nok, så løsningen er ikke Norton-specifik.
let ARCHY_CA_BUNDLE = null;
function ensureArchyCaBundle() {
  if (ARCHY_CA_BUNDLE !== null) return ARCHY_CA_BUNDLE;
  ARCHY_CA_BUNDLE = false;
  try {
    const tls = require('tls');
    if (typeof tls.getCACertificates !== 'function') return ARCHY_CA_BUNDLE;  // Node < 22.15
    const seen = new Set(), pems = [];
    for (const kind of ['bundled', 'system', 'extra']) {
      let certs = [];
      try { certs = tls.getCACertificates(kind) || []; } catch (_) {}
      for (const pem of certs) if (pem && !seen.has(pem)) { seen.add(pem); pems.push(pem.trim()); }
    }
    if (!pems.length) return ARCHY_CA_BUNDLE;
    const file = path.join(DATA_DIR, '.archy-ca.pem');
    fs.writeFileSync(file, pems.join('\n') + '\n');
    ARCHY_CA_BUNDLE = file;
    addLog('INFO', `CA bundle for Archy written (${pems.length} certificates)`, null, 'SYSTEM');
  } catch (e) {
    addLog('WARN', `Could not build the CA bundle for Archy: ${e.message}`, null, 'SYSTEM');
  }
  return ARCHY_CA_BUNDLE;
}

// Et stort flow (tusindvis af actions) bruger flere minutter på validering og
// publicering. 120 s dræbte Archy midt i en publicering af et in-queue-flow, og
// fejlen fremstod som 14.000 linjer TRACE-støj.
// Kan ændres med archyTimeoutMinutes i settings.json (1–60).
const ARCHY_TIMEOUT_DEFAULT_MIN = 10;
function archyTimeoutMs() {
  let min = ARCHY_TIMEOUT_DEFAULT_MIN;
  try { min = Number(loadSettings().archyTimeoutMinutes) || min; } catch (_) {}
  return Math.min(60, Math.max(1, min)) * 60 * 1000;
}

// Blev Archy dræbt af tidsgrænsen, er det ikke det samme som at importen
// fejlede: Genesys kan have publiceret færdigt. Ser vi flowet i målet med en
// publicering efter at vi startede (publish), eller et flow der ikke fandtes
// før (create), regnes importen for gennemført — ellers mangler manifest og
// release-note for noget der ER i drift. Update kan ikke afgøres og regnes
// for fejlet.
async function importFinishedDespiteTimeout(target, name, flowType, cmd, startedAt, hadBefore) {
  try {
    const info = await getFlowPublishInfo(target, name, flowType);
    if (!info) return false;
    if (cmd === 'publish') return !!info.publishedAt && info.publishedAt > startedAt - 5000;
    if (cmd === 'create') return !hadBefore;
    return false;
  } catch (_) { return false; }
}

function runArchy(args, customer) {
  return new Promise((resolve, reject) => {
    // Samme vagt som i getToken. Archy-vejene går ikke gennem getToken, så et
    // demo-miljø nåede helt frem til Archy og fik en uforståelig fejl om at
    // "demo" ikke er en gyldig Genesys-region.
    if (isDemo(customer))
      return reject(new Error(`"${customer.name}" is a demo environment — it exists only locally, ` +
        `so there is no org to run Archy against. Use the Pipeline page to try promotions.`));
    if (!ARCHY_DIR) return reject(new Error("Archy was not found. Add Archy to PATH, or put the folder holding archy.bat in \"archyDir\" in data/settings.json, then restart with start.bat."));
    const cmd = `${ARCHY_CMD} ${args} ${archyCredFlags(customer)}`;
    const bundle = ensureArchyCaBundle();
    const env = { ...process.env };
    if (bundle) env.NODE_EXTRA_CA_CERTS = bundle;
    exec(cmd, {
      // windowsHide: serveren er startet skjult (eller har genstartet sig selv uden
      // konsol), og så åbner hver cmd.exe ellers et synligt, tomt vindue.
      cwd: ARCHY_DIR, shell: 'cmd.exe', windowsHide: true, timeout: archyTimeoutMs(),
      maxBuffer: 20 * 1024 * 1024,      // Archys debug-output kan være stort
      env
    }, (err, stdout, stderr) => {
      const combined = (stdout || '') + '\n' + (stderr || '');
      const parsed   = parseArchyOutput(combined) || '';

      // Archy afslutter med et banner: "… - Finish" ved succes, "… - Failure"
      // ved fejl. Det er det eneste pålidelige signal. De tidligere heuristikker
      // matchede ALTID: "execution complete." printes ved begge udfald, og
      // fejl-output indeholder "did not fetch versions successfully" — så enhver
      // rigtig Archy-fejl blev slugt og fremstod som en succes.
      const failed   = /Architect Yaml Flow Processor[^\n]*-\s*Failure/i.test(combined);
      const finished = /Architect Yaml Flow Processor[^\n]*-\s*Finish/i.test(combined);

      // redactSecrets: err.message fra exec indeholder hele kommandolinjen,
      // inkl. --clientSecret. Den Error her ender også i svaret til browseren.
      // Stien hæftes på EFTER afkortningen, så den ikke selv bliver skrevet væk.
      const afvis = (grund) =>
        reject(new Error(redactSecrets(withArchyLog(truncateArchyError(grund), combined))));

      // Dræbt af tidsgrænsen: ingen banner, og Genesys kan sagtens have færdiggjort
      // publiceringen. Det skal stå klart, så man tjekker målet i stedet for at gentage blindt.
      if (err && err.killed && !failed && !finished)
      {
        const e = new Error(`Archy was stopped after ${Math.round(archyTimeoutMs() / 60000)} minutes without finishing. ` +
          `The flow may still have been published in the target — check it there before running again.`);
        e.timedOut = true;
        return reject(e);
      }
      if (failed)               return afvis(archyErrorReason(combined) || parsed || 'Archy failed');
      if (finished || !err)     return resolve(parsed || 'OK');
      afvis(archyErrorReason(combined) || parsed || err.message);
    });
  });
}

module.exports = { runArchy, archyArg, archyBareArg, archyVersionFlag, explainRepublishFailure,
  archyHint, archyVerb, archyCredFlags, parseArchyOutput, noteUnavailableType, typeUnavailableHere,
  truncateArchyError, archyDebugLog, withArchyLog, archyErrorReason, archyTimeoutMs,
  importFinishedDespiteTimeout };
