// Konventioner der deles med klienten: trin, versionsendelse og flowtyper.

const { loadSettings } = require('../config');

// ── Kunde → gruppe → miljø ───────────────────────────────────────────────────
// Én post i customers.json er ét miljø (én Genesys-org med ét OAuth-sæt).
// Hierarkiet udledes af tre felter, så alle eksisterende opslag virker uændret
// og poster uden felterne blot samler sig i én bunke.

// ── Konventioner ─────────────────────────────────────────────────────────────
// Trin-rækkefølgen og versionsendelsen er REGLER, ikke tilfældige værdier, og de
// stod tre steder: her, i klientens sortering af miljøer, og i klientens
// aflæsning af "_v10" på et flownavn. Ændrede man den ene, opdagede man først de
// to andre når tavlen sorterede forkert — og en tavle der sorterer forkert siger
// noget usandt om hvad der er forfremmet hvorhen.
//
// De står her alene. Klienten henter dem som et script (se /konventioner.js), så
// de er sat før nogen anden kode kører, og der er intet sted at glemme.

const STAGES = ['dev', 'test', 'uat', 'prod'];

// Hvor Genesys sender et PKCE-login tilbage hen. Skal stå på OAuth-klienten.
const OAUTH_REDIRECT_URI = 'http://localhost:3737/auth/callback';
const stageOrder = s => { const i = STAGES.indexOf(String(s || '').toLowerCase()); return i === -1 ? 99 : i; };
// Listen ovenfor er standarden. Kunder der har flere trin — fx staging eller
// preprod — kan rette den under Kunder → Trin; den gemmes i settings.json og
// lægges ind i STAGES ved opstart. Arrayet skiftes ud på stedet, så alle der
// holder på det (også /konventioner.js), ser den nye liste.
//
// Prod er ikke bare et navn: login, deploy-ret og skrivevagten hænger på det.
// Derfor skal "prod" altid findes og altid stå sidst.
const STAGE_NAME = /^[a-z][a-z0-9-]{0,19}$/;
const MAX_STAGES = 10;

// Ren vurdering af en ny trinliste. Returnerer { stages } eller { error }.
function stageListError(list, customers = []) {
  if (!Array.isArray(list)) return { error: 'Trinlisten skal være en liste.' };
  const stages = list.map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
  if (!stages.length) return { error: 'Der skal være mindst ét trin.' };
  if (stages.length > MAX_STAGES) return { error: `Højst ${MAX_STAGES} trin.` };
  const ugyldig = stages.find(s => !STAGE_NAME.test(s));
  if (ugyldig) return { error: `"${ugyldig}" er ikke et gyldigt trin — brug små bogstaver, tal og bindestreg, højst 20 tegn, og start med et bogstav.` };
  const dobbelt = stages.find((s, i) => stages.indexOf(s) !== i);
  if (dobbelt) return { error: `"${dobbelt}" står to gange.` };
  if (stages[stages.length - 1] !== 'prod')
    return { error: 'Prod skal findes og stå sidst — login, deploy-ret og skrivevagten hænger på det.' };
  // Et trin der er i brug, kan ikke forsvinde — så faldt miljøet ud af pipelinen.
  const iBrug = customers.filter(c => c.stage && !stages.includes(String(c.stage).toLowerCase()));
  if (iBrug.length)
    return { error: `Trinnet "${iBrug[0].stage}" bruges af ${iBrug.map(c => c.name).join(', ')}. Flyt miljøerne til et andet trin først.` };
  return { stages };
}

function applyStages(stages) { STAGES.splice(0, STAGES.length, ...stages); }

// Ved opstart: en gemt liste bruges kun hvis den stadig er gyldig.
{
  const gemt = loadSettings().stages;
  if (gemt) {
    const r = stageListError(gemt);
    if (r.stages) applyStages(r.stages);
  }
}

// Endelsen et forfremmet flow bærer: "testtest" publiceret som udgave 10 bliver
// til "testtest_v10". Reglen bruges tre steder — når navnet dannes, når
// grundnavnet skal findes igen, og når tavlen skal se hvor mange udgaver der er
// kommet til siden forfremmelsen — så den må kun findes ét sted.
const VERSION_SUFFIX = /_v(\d+)$/i;

// Flowtyper skrives forskelligt de to steder de kommer fra: API'et siger
// INBOUNDCALL, YAML-roden siger inboundCall. Manifestet gemmer én form.
const normType = t => String(t || '').toUpperCase();

// ── Migrate (export + import in one go) ─────────────────────────────────────

// Referencer der peger på et andet FLOW. De kan migreres med samme maskineri
// som alt andet — et common module er bare et flow af typen COMMONMODULE.
const FLOW_KINDS = new Set(['commonmodule', 'botflow', 'targetflow', 'inqueueflow']);

module.exports = { STAGES, OAUTH_REDIRECT_URI, stageOrder, STAGE_NAME, stageListError, applyStages,
  VERSION_SUFFIX, FLOW_KINDS, normType };
