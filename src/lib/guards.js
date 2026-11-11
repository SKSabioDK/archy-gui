// Vagter foran en skrivning mellem miljøer, og præfiks-sammenstød.

const axios = require('axios');
const { UNGROUPED, tenantOf, groupOf, stageOf, prefixOf, orgKeyOf, belongsToEnv, stripEnvPrefix,
  sameGroup } = require('./environments');
const { baseFlowName } = require('./names');
const { getToken } = require('./token');

// Vagt foran enhver skrivning fra ét miljø til et andet. Alt her udledes af
// miljøernes egen opsætning — kun prod-bekræftelsen kommer fra brugeren, og
// den er netop ment som en bevidst handling.
// Returnerer null når det er tilladt, ellers { code, error }.
function migrationGuard(source, target, body = {}) {
  if (!source || !target) return { code: 'unknown-env', error: 'Ukendt miljø.' };
  if (source.id === target.id)
    return { code: 'same-env', error: 'Kilde og mål er det samme miljø.' };

  // Er blot ét af miljøerne sat op i en gruppe, gælder gruppereglen. Er ingen
  // af dem det, er der ingen pipeline at håndhæve, og en løs migrering går
  // igennem som før — ellers ville alt stå stille indtil grupperne er sat op.
  const grouped = c => tenantOf(c) !== UNGROUPED && groupOf(c) !== UNGROUPED;
  if ((grouped(source) || grouped(target)) && !sameGroup(source, target) && !body.allowCrossGroup)
    return { code: 'cross-group',
             error: `"${source.name}" og "${target.name}" er ikke i samme gruppe. Migrering på tværs af grupper er spærret.` };

  if (stageOf(target) === 'prod' && !body.confirmProd)
    return { code: 'prod-confirm',
             error: `"${target.name}" er et prod-miljø. Forfremmelsen skal bekræftes udtrykkeligt.` };

  return null;
}

// Trinnet før: man bygger og publicerer i ét miljø, tester det dér, og
// forfremmer først derefter. En upubliceret kladde er ikke testet.
async function publishedVersionOf(customer, flowName, flowType) {
  const { token, apiBase } = await getToken(customer);
  const r = await axios.get(`${apiBase}/api/v2/flows`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { name: flowName, type: flowType, pageSize: 50 }
  });
  const f = (r.data.entities || []).find(x =>
    x.name.trim().toLowerCase() === String(flowName).trim().toLowerCase());
  if (!f) return { found: false, published: null };
  return { found: true, published: f.publishedVersion?.name || f.publishedVersion?.commitVersion || null };
}

// To miljøer i SAMME org med SAMME præfiks ville gøre krav på de samme flows —
// tavlen kunne ikke skelne dem, og en forfremmelse mellem dem ville skrive
// flowet ovenpå sig selv. Oftest er det to miljøer uden præfiks: fx UAT og
// prod i samme org. UAT uden præfiks er fint, så længe prod bor i en anden org.
function prefixClash(env, all) {
  if (!stageOf(env)) return null;
  const hit = all.find(c => c.id !== env.id && stageOf(c) &&
    orgKeyOf(c) === orgKeyOf(env) && prefixOf(c) === prefixOf(env) &&
    tenantOf(c) === tenantOf(env) && groupOf(c) === groupOf(env));
  if (!hit) return null;
  return prefixOf(env)
    ? `"${hit.name}" bruger allerede præfikset "${prefixOf(env)}" i samme org. Hvert miljø i en org skal have sit eget præfiks.`
    : `"${hit.name}" ligger allerede uden præfiks i samme org. Kun ét miljø pr. org kan være uden præfiks — giv det ene et præfiks (fx UAT_).`;
}

// Hvilke flows i org'en ville skifte betydning hvis miljøet fik et andet
// præfiks? Flows omdøbes ikke af sig selv — i en rigtig org ville Archy lave et
// nyt flow ved siden af — så navnene i org'en står som de er. Ændres præfikset
// fra "UAT_" til intet, ligger "UAT_Betaling" tilbage, og tavlen viser det som
// sit eget flow med grundnavnet "UAT_Betaling". Ændres det fra intet til
// "UAT_", hører "Betaling" slet ikke til miljøet længere.
function prefixChangeImpact(env, newPrefix, flows, all) {
  const efter = { ...env, prefix: String(newPrefix || '').trim() };
  const soeskende = (e) => all.map(c => c.id === env.id ? e : c).filter(c => orgKeyOf(c) === orgKeyOf(env));
  const foer = soeskende(env), nu = soeskende(efter);
  const ramt = [];
  for (const f of flows) {
    const hoerteTil = belongsToEnv(f.name, env, foer);
    if (!hoerteTil) continue;
    const hoererTil = belongsToEnv(f.name, efter, nu);
    const skifter = !hoererTil ||
      baseFlowName(stripEnvPrefix(f.name, env)) !== baseFlowName(stripEnvPrefix(f.name, efter));
    if (skifter) ramt.push({ name: f.name, type: f.type, lost: !hoererTil });
  }
  return ramt;
}

module.exports = { migrationGuard, publishedVersionOf, prefixClash, prefixChangeImpact };
