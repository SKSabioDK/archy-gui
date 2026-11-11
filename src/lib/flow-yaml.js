// Flowenes YAML: normalisering, indholds-hash, omdøbning og eksport af den rigtige udgave.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FLOWS_DIR } = require('../config');
const { addLog } = require('./log');
const { sanitizeName, describeApiError } = require('./helpers');
const { prefixOf, stripEnvPrefix, withEnvPrefix, setFlowDivisionInYaml } = require('./environments');
const { publishedVersionOf } = require('./guards');
const { runArchy, archyArg, archyBareArg, archyVersionFlag } = require('./archy');

// ── Indholdssammenligning af flows ────────────────────────────────────────────

// Genesys' versionsnumre er per-org tællere: kilden kan stå på v37 og målet på
// v1 for præcis samme flow. Tallene kan derfor aldrig bruges til at afgøre om
// to flows er ens — det kan kun indholdet.
//
// To slags støj skal ud først, begge Archys egen interne nummerering:
//   trackingId: 12          rene tællere, uden betydning
//   [Initial State_10]      løbenumre i refId og referencer til dem
// Målt på to flowpar: 8 rå forskelle blev til 1 (en ægte logikforskel), og
// 296 blev til 280 (to reelt forskellige flows).
function normalizeFlowYaml(yaml) {
  return String(yaml || '')
    .split(/\r?\n/)
    .filter(l => !/^\s*trackingId:\s*\d+\s*$/.test(l))
    // En TOM beskrivelse betyder det samme som ingen beskrivelse. Archy skriver
    // den ud på et nyoprettet flow, men udelader den på et der aldrig har haft
    // en — så en fejlfri kopi fik én linje mere end kilden og blev meldt som
    // afvigende. En beskrivelse med indhold tæller stadig med.
    .filter(l => !/^\s*description:\s*(""|'')\s*$/.test(l))
    .join('\n')
    .replace(/_(\d+)\]/g, '_#]')
    .replace(/^(\s*refId:\s*.*?)_(\d+)\s*$/gm, '$1_#')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// Ved sammenligning på tværs af miljøer skal præfikset ud af BÅDE flowets eget
// navn og dets referencer. De to linjer skal jo være forskellige — det er hele
// pointen med et præfikset miljø — så uden dette ville en fejlfri forfremmelse
// altid melde "afviger", og indholdstjekket ville være ubrugeligt netop dér
// hvor man har mest brug for det.
function stripEnvPrefixesInYaml(yaml, env) {
  // Divisionen SKAL være forskellig mellem miljøerne — den hører til miljøet,
  // ikke til flowet. Uden dette ville en fejlfri forfremmelse fra DEV til UAT
  // altid melde "afviger" på netop den linje. Den sættes til en fast værdi i
  // begge sider, så den ikke tæller med, men heller ikke forsvinder.
  let out = setFlowDivisionInYaml(String(yaml), '<miljøets division>');

  const p = prefixOf(env);
  if (!p) return out;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let done = false;
  out = out.split(/\r?\n/).map(l => {
    if (done) return l;
    const m = l.match(/^([ \t]{2,})name:([ \t]*)(.*)$/);
    if (!m) return l;
    done = true;
    return `${m[1]}name:${m[2]}${m[3].replace(new RegExp('^(["\']?)' + esc), '$1')}`;
  }).join('\n');

  for (const tag of ['dataTable', 'commonModule'])
    out = out.replace(new RegExp(`(^[ \\t]*${tag}:[ \\t]*\\r?\\n[ \\t]+)${esc}`, 'gm'), '$1');

  return out;
}

function flowContentHash(yaml, env) {
  const rent = env ? stripEnvPrefixesInYaml(yaml, env) : yaml;
  return crypto.createHash('sha256').update(normalizeFlowYaml(rent)).digest('hex');
}

// Archy lægger versionen i filnavnet: "Mit Flow_v16-0.yaml" → 16
// Versionsudligning: hver publicering i Genesys giver én ny udgave, og tælleren
// er pr. org. Efter en forfremmelse står målet derfor typisk lavere end kilden
// (dev v10 → test v3). Vil man have samme nummer begge steder, publiceres målet
// det antal ekstra gange der mangler. Ét antal pr. forfremmelse, og aldrig ned:
// står målet højere, kan det ikke rettes ved at publicere.
const MAX_ALIGN_PUBLISHES = 25;
function alignmentPlan(sourceVersion, targetVersion) {
  const major = v => parseInt(String(v ?? '').split('.')[0], 10);
  const s = major(sourceVersion), t = major(targetVersion);
  if (!Number.isFinite(s) || !Number.isFinite(t)) return { extra: 0, reason: 'unknown' };
  if (t >= s) return { extra: 0, reason: t > s ? 'target_ahead' : 'equal', source: s, target: t };
  if (s - t > MAX_ALIGN_PUBLISHES) return { extra: 0, reason: 'too_many', needed: s - t, source: s, target: t };
  return { extra: s - t, reason: 'ok', source: s, target: t };
}

function versionFromFileName(fileName) {
  const m = String(fileName).match(/_v(\d+)-\d+\.yaml$/i);
  return m ? parseInt(m[1], 10) : null;
}

// Hvilken udgave en migrering skal hente. Archys export tager 'latest' som
// standard, altså den GEMTE kladde — og en kladde er per definition ikke testet.
// Målt på et rigtigt flow: prods ChatGPT var publiceret som 5.0 og havde sin data
// action, mens kladden 7.0 havde mistet den. Vagten i /api/migrate/prepare sagde
// god for flowet, fordi det ER publiceret — og så sendte vi kladden af sted.
//
// Kan udgaven ikke slås op, falder vi tilbage på latest frem for at standse:
// hellere den gamle opførsel end ingen migrering.
async function publishedVersionFor(customer, flowName, flowType, hvorfor) {
  try {
    const { found, published } = await publishedVersionOf(customer, flowName, flowType);
    if (found && published) return published;
    if (found) addLog('WARN', `"${flowName}" has no published version in ${customer.name} — exporting the saved draft`, customer.name, hvorfor);
  } catch (e) {
    addLog('WARN', `Could not look up the published version of "${flowName}" in ${customer.name}: ${describeApiError(e)}`, customer.name, hvorfor);
  }
  return null;
}

// Eksporterer ét flow og returnerer { yaml, fileName, version }.
// version = null betyder Archys standard, 'latest' — den gemte kladde.
async function exportFlowToYaml(customer, flowName, flowType, version) {
  const dir = path.join(FLOWS_DIR, sanitizeName(customer.name));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const mt = f => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) { return 0; } };
  const before = new Map(fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => [f, mt(f)]));

  await runArchy(
    `export --flowName ${archyArg(flowName, 'Flow name')} ` +
    `--flowType ${archyBareArg(String(flowType).toLowerCase(), 'Flow type')} ` +
    archyVersionFlag(version) +
    `--exportType yaml --force --outputDir ${archyArg(dir, 'Directory')}`,
    customer
  );
  const touched = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))
    .filter(f => !before.has(f) || mt(f) > before.get(f))
    .sort((a, b) => mt(b) - mt(a));
  if (!touched.length) throw new Error(`The export wrote no YAML file for "${flowName}"`);
  const fileName = touched[0];
  const yaml = fs.readFileSync(path.join(dir, fileName), 'utf8');
  assertYamlIsFlow(yaml, flowName, fileName);
  return { yaml, fileName, version: versionFromFileName(fileName) };
}

// Sidste kontrol før vi viser eller migrerer indholdet: står der det flownavn i
// YAML'en som brugeren bad om? Kan navnet ikke læses, lader vi det passere —
// vi vil hellere mangle kontrollen end afvise en gyldig eksport.
// Skriver flowets navn om i YAML'en. Det er ØVERSTE navnefelt der er flowets —
// de dybere hører til tasks og states — så kun det første røres.
function renameFlowInYaml(yaml, newName) {
  let done = false;
  const eol = /\r\n/.test(yaml) ? '\r\n' : '\n';
  return String(yaml).split(/\r?\n/).map(l => {
    if (done) return l;
    const m = l.match(/^([ \t]{2,})name:([ \t]*)(.*)$/);
    if (!m) return l;
    done = true;
    const varQuoted = /^".*"$|^'.*'$/.test(m[3].trim());
    return `${m[1]}name:${m[2] || ' '}${varQuoted ? JSON.stringify(newName) : newName}`;
  }).join(eol);
}

// Hvad flowet skal hedde i målmiljøet: kildens præfiks af, målets på.
// Versionsendelsen (_vN) røres IKKE her — den regel kører indtil videre kun i
// demoen, fordi omdøbning af et flow i en rigtig org ikke er afprøvet endnu.
function targetFlowName(flowName, source, target) {
  return withEnvPrefix(stripEnvPrefix(flowName, source), target);
}

// Flowtypen står som første nøgle i Archys YAML ("commonModule:",
// "inboundCall:" …) og navnet som det første indrykkede name:.
function yamlFlowHeader(yaml) {
  const kind = (String(yaml).match(/^([A-Za-z]+):[ \t]*$/m) || [])[1] || null;
  const m = String(yaml).match(/^[ \t]{2,}name:[ \t]*(.+?)[ \t]*$/m);
  return { kind, name: m ? m[1].replace(/^["']|["']$/g, '') : null };
}

function assertYamlIsFlow(yaml, flowName, fileName) {
  const m = String(yaml).match(/^[ \t]{2,}name:[ \t]*(.+?)[ \t]*$/m);
  if (!m) return;
  const got = m[1].replace(/^["']|["']$/g, '');
  const norm = x => String(x).trim().toLowerCase();
  if (norm(got) !== norm(flowName))
    throw new Error(`The export returned the wrong flow: asked for "${flowName}", file ${fileName} contains "${got}"`);
}

module.exports = { MAX_ALIGN_PUBLISHES, renameFlowInYaml, alignmentPlan, flowContentHash,
  normalizeFlowYaml, stripEnvPrefixesInYaml, versionFromFileName, publishedVersionFor,
  exportFlowToYaml, assertYamlIsFlow, targetFlowName, yamlFlowHeader };
