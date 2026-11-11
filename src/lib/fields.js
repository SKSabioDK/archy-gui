// Felterne på et miljø: regioner, tilladte tegn og validering.

const { sanitizeName } = require('./helpers');

// Region -> API base URL mapping
const REGION_MAP = {
  'mypurecloud.com':    'https://api.mypurecloud.com',
  'mypurecloud.de':     'https://api.mypurecloud.de',
  'mypurecloud.ie':     'https://api.mypurecloud.ie',
  'mypurecloud.com.au': 'https://api.mypurecloud.com.au',
  'mypurecloud.jp':     'https://api.mypurecloud.jp',
  'usw2.pure.cloud':    'https://api.usw2.pure.cloud',
  'cac1.pure.cloud':    'https://api.cac1.pure.cloud',
  'euw2.pure.cloud':    'https://api.euw2.pure.cloud',
  'apse2.pure.cloud':   'https://api.apse2.pure.cloud',
};

// ── Felter på et miljø ───────────────────────────────────────────────────────
// Navnet bliver til en mappe (flows/<navn>), mappen står på Archys
// kommandolinje gennem cmd.exe, præfikset bliver en del af flownavne og
// manifest-tabellens navn i Genesys, og Client ID og region ender i URL'er.
// En værdi der ikke holder hele vejen, skal afvises når den gemmes — ikke
// opdages midt i en eksport.
//
// "/" er tilladt i navne: "A/S" står i halvdelen af alle danske firmanavne, og
// mappenavnet får "_" i stedet. At to navne så kan give samme mappe, fanges af
// kollisionstjekket nedenfor.

// Ugyldige i Windows-stier (< > : " \ | ? *), udvidet af cmd.exe selv inden
// for anførselstegn (%, !), og tegn der bryder ud af et JS-attribut (' `).
const FORBIDDEN_CHARS = /[<>:"\\|?*%!^`$'\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERMISSION = /^[a-z0-9*\-]+:[a-z0-9*\-]+:[a-z0-9*\-]+$/i;
const FORBIDDEN_LIST = '< > : " \\ | ? * % ! ^ ` $ \'';

// Felterne PUT tager imod. Alt andet — fx "demo": true, som ville få
// prod-vagten til at se bort fra miljøet — ignoreres.
const EDITABLE_FIELDS = ['name', 'tenant', 'group', 'stage', 'prefix', 'orgLabel', 'division',
  'clientId', 'region', 'authType', 'deployPermission', 'deployGroup', 'newClientSecret', 'color'];

// Farven et miljø vises med på tavlen og i sidebjælken. Tomt betyder trinnets
// egen farve (dev grøn, test gul, uat orange, prod rød). Navne, ikke hex-koder,
// så farven følger temaet.
const ENV_COLORS = ['', 'green', 'yellow', 'orange', 'red', 'blue', 'grey'];

function textError(label, v, max) {
  if (v.length > max) return `${label} må højst være ${max} tegn (er ${v.length}).`;
  const bad = v.match(FORBIDDEN_CHARS);
  if (bad) {
    const vis = /[\u0000-\u001f\u007f]/.test(bad[0]) ? 'usynlige kontroltegn' : `tegnet ${bad[0]}`;
    return `${label} må ikke indeholde ${vis}. Disse tegn kan ikke bruges: ${FORBIDDEN_LIST}`;
  }
  return null;
}

// Tjekker de felter der står i `fields` (allerede trimmede). `others` er de
// ANDRE miljøer. Returnerer første fejl som tekst, ellers null.
function envFieldError(fields, others = []) {
  const has = k => fields[k] !== undefined;
  if (has('name')) {
    const n = String(fields.name);
    if (!n) return 'Navnet må ikke være tomt.';
    const e = textError('Navnet', n, 60);
    if (e) return e;
    if (/^\.|\.$/.test(n)) return 'Navnet må ikke begynde eller slutte med et punktum.';
    const mappe = sanitizeName(n);
    if (WINDOWS_RESERVED.test(mappe)) return `"${n}" er et reserveret navn i Windows og kan ikke bruges som mappe.`;
    if (/^import_/i.test(mappe)) return 'Navnet må ikke begynde med "import_" — det er værktøjets egne mapper.';
    // Windows skelner ikke store og små bogstaver, og "A/S" og "A_S" giver
    // samme mappe. To miljøer der deler eksportmappe, blander hinandens flows.
    const hit = others.find(o => sanitizeName(String(o.name || '')).toLowerCase() === mappe.toLowerCase());
    if (hit) return hit.name === n
      ? `Der findes allerede et miljø der hedder "${n}".`
      : `"${n}" ligger for tæt på "${hit.name}" — de ville dele eksportmappe. Vælg et andet navn.`;
  }
  for (const [k, label, max] of [['tenant', 'Kunde', 40], ['group', 'Gruppe', 40], ['orgLabel', 'Org-navn', 60]])
    if (has(k)) { const e = textError(label, String(fields[k]), max); if (e) return e; }
  if (has('color') && !ENV_COLORS.includes(String(fields.color)))
    return `Ukendt farve "${fields.color}" — vælg en af: ${ENV_COLORS.filter(Boolean).join(', ')}.`;
  if (has('prefix')) {
    const p = String(fields.prefix);
    if (p.length > 20) return `Præfikset må højst være 20 tegn (er ${p.length}).`;
    // Præfikset bliver en del af flownavne og manifest-tabellens navn i Genesys.
    if (!/^[A-Za-z0-9_\-]*$/.test(p))
      return `Præfikset må kun bestå af A-Z, 0-9, _ og - (fx "DEV_"). "${p}" indeholder andet.`;
  }
  if (has('clientId') && !GUID.test(String(fields.clientId)))
    return `Client ID skal være et GUID som xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. "${fields.clientId}" er ikke.`;
  if (has('region') && !REGION_MAP[fields.region])
    return `Ukendt region "${fields.region}" — vælg en af: ${Object.keys(REGION_MAP).join(', ')}`;
  if (has('deployPermission') && fields.deployPermission) {
    const bad = String(fields.deployPermission).split(/[,\s]+/).filter(Boolean).find(x => !PERMISSION.test(x));
    if (bad) return `"${bad}" er ikke en rettighed. Formen er domæne:entitet:handling, fx architect:flow:publish.`;
  }
  if (has('deployGroup')) {
    const g = String(fields.deployGroup);
    if (g.length > 100) return `Gruppenavnet må højst være 100 tegn (er ${g.length}).`;
    if (/[\u0000-\u001f\u007f]/.test(g)) return 'Gruppenavnet må ikke indeholde usynlige kontroltegn.';
  }
  return null;
}

module.exports = { REGION_MAP, GUID, EDITABLE_FIELDS, ENV_COLORS, envFieldError };
