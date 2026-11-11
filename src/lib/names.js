// Flownavne og versioner: basisnavn, versionsendelse og forfremmelsesnavne.

const { stageOrder, VERSION_SUFFIX, normType } = require('./conventions');
const { stageOf, sameGroup } = require('./environments');

// Navneregel ved forfremmelse.
//
//   "testest"          publiceret 10  ->  "testest_v10"
//   "testcallback_v10" publiceret 34  ->  "testcallback_v34"   (v10 erstattes)
//   "testtest_v10"     publiceret  1  ->  "testtest_v10"       (uændret)
//
// Tallet er kildens udgave, så navnet siger hvor det kom fra. Er kilden kun
// publiceret én gang, er der ikke sket noget i det miljø siden det ankom — så
// bærer navnet stadig den udgave det kom med, og vi rører det ikke.
// Grundnavnet uden versionsendelsen. Tavlen parrer på DET, så "testtest_v10" i
// dev og "testtest_v15" i test stadig er den samme række — ellers ville en
// omdøbning splitte flowet i to og tage både kæden og afvigelses-visningen med sig.
function baseFlowName(name) {
  return String(name || '').replace(VERSION_SUFFIX, '');
}

// Tallet i endelsen, eller null hvis navnet ingen bærer. Tavlen bruger det til
// at se hvor mange udgaver der er publiceret siden forfremmelsen.
function versionSuffixOf(name) {
  const m = String(name || '').match(VERSION_SUFFIX);
  return m ? parseInt(m[1], 10) : null;
}

function promotionName(currentName, sourcePublishedVersion) {
  const n = parseInt(String(sourcePublishedVersion || '').split('.')[0], 10);
  if (!Number.isFinite(n) || n <= 1) return currentName;
  return `${baseFlowName(currentName)}_v${n}`;
}

// Er miljøet det første trin i sin gruppe — dér hvor flowet bygges?
//
// Kun DÉR sætter forfremmelsen et nyt tal på navnet. Længere nede i kæden er
// miljøets egen udgave bare antallet af gange det har modtaget noget: TEST kan
// stå på v3 mens flowet kom fra DEV som v6. Brugte vi TESTs tal, blev
// "TEST_Betaling_v6" forfremmet til UAT som "UAT_Betaling_v3" — og TEST blev
// omdøbt til _v3 med. Endelsen skal fortælle hvilken udviklingsudgave der
// kører, hele vejen til prod.
function isPipelineOrigin(env, all) {
  if (!stageOf(env)) return true;
  const peers = (all || []).filter(c => sameGroup(c, env) && stageOf(c));
  if (!peers.length) return true;
  return stageOrder(env.stage) <= Math.min(...peers.map(c => stageOrder(c.stage)));
}

// Navnet efter forfremmelse. Fra første trin: kildens udgave. Længere nede:
// navnet som det er — endelsen blev sat dengang flowet forlod første trin.
function promotionNameFrom(currentName, sourcePublishedVersion, fromOrigin, flowType) {
  if (flowType && !carriesVersionSuffix(flowType)) return currentName;
  return fromOrigin ? promotionName(currentName, sourcePublishedVersion) : currentName;
}

// Flowtyper der kaldes VED NAVN fra andre flows. Et common module står i
// kalderens YAML som "commonModule: Hilsen:", og et bot flow som "botFlow:".
// Fik de en versionsendelse, ville "Hilsen" blive til "Hilsen_v4", og hvert
// eneste flow der kalder modulet ville pege på et navn der ikke findes længere.
// Et opkaldsflow rammes derimod via sit id (DID, rute), så dér er endelsen ufarlig.
const NAVNGIVNE_KALDEMAAL = new Set(['COMMONMODULE', 'BOT', 'DIGITALBOT']);
function carriesVersionSuffix(flowType) {
  return !NAVNGIVNE_KALDEMAAL.has(normType(flowType));
}

// ── Pipeline-tavlen ──────────────────────────────────────────────────────────
// Flows som rækker, gruppens miljøer som kolonner i trin-rækkefølge.
// Versionstallet er per-org og kan ikke sammenlignes på tværs — det vises kun
// til orientering. Om indholdet faktisk er ens afgøres af /api/flows/cross-hash,
// som eksporterer og hasher, og derfor kun kaldes for én række ad gangen.
// Genesys navngiver en kladde med et internt id ("saved_version_0d4c8ad4-…").
// Det er ikke et versionsnummer og skal ikke vises som ét.
function versionLabel(v) {
  if (!v) return null;
  for (const cand of [v.commitVersion, v.name]) {
    if (cand && /^\d+(\.\d+)?$/.test(String(cand).trim())) return String(cand).trim();
  }
  return null;
}

module.exports = { baseFlowName, versionSuffixOf, promotionName, isPipelineOrigin,
  promotionNameFrom, carriesVersionSuffix, versionLabel };
