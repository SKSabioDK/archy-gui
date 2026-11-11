// Ruter: migrering af data actions og datatabeller, totaltjek og setup-forslag.

const express = require('express');
const axios = require('axios');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { describeApiError, stripSchemaUris, inlineActionTemplates } = require('../lib/helpers');
const { orgKeyOf, stripEnvPrefix, withEnvPrefix } = require('../lib/environments');
const { getToken } = require('../lib/token');
const { FUNCTION_INTEGRATION } = require('../lib/dependencies');
const { listIntegrations, validDaEntry, loadDataActionMap, saveDataActionMap,
  compareDataActionSets, summarizeDataActionRows, compareContracts, listDataActionsFull,
  planDataActionPlacement } = require('../lib/data-action-refs');

const router = express.Router();

// Kategorien en migreret action oprettes med: målintegrationens navn. Kan det
// ikke læses, beholdes kildens — som før.
function actionCategoryFor(sourceCategory, targetIntegrationName) {
  return String(targetIntegrationName || '').trim() || sourceCategory;
}

// Migrate a Data Action from source org to target org
router.post('/api/actions/migrate', async (req, res) => {
  const { sourceId, targetId, actionId, targetIntegrationId } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);

    // 1. Fetch published action. includeConfig=true er påkrævet for at få
    // 'config' med — den følger IKKE med via expand, uanset værdi.
    const publishedRes = await axios.get(
      `${srcBase}/api/v2/integrations/actions/${actionId}`,
      { headers: { Authorization: `Bearer ${srcToken}` },
        params: { expand: 'contract', includeConfig: true } }
    );
    const published = publishedRes.data;

    // 2. Fetch draft hvis der er en — en action uden ventende ændringer har
    // ingen draft og svarer 404. Det er normalt, ikke en fejl.
    let draft = null;
    try {
      const draftRes = await axios.get(
        `${srcBase}/api/v2/integrations/actions/${actionId}/draft`,
        { headers: { Authorization: `Bearer ${srcToken}` },
          params: { expand: 'contract', includeConfig: true } }
      );
      draft = draftRes.data;
    } catch (e) {
      if (e.response?.status !== 404) {
        addLog('WARN', `Draft not available for "${published.name}": ${describeApiError(e)}`, source.name, 'MIGRATE');
      }
    }

    // Use draft if available (more complete), fallback to published
    const source_data = draft || published;

    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);

    // 3. Resolve integration in target org
    let integrationId = targetIntegrationId;
    let integrationName = '';
    if (integrationId) {
      // Kategorien skal være målintegrationens navn, så vi skal bruge navnet.
      try {
        const ir = await axios.get(`${tgtBase}/api/v2/integrations/${encodeURIComponent(integrationId)}`,
          { headers: { Authorization: `Bearer ${tgtToken}` } });
        integrationName = ir.data.name || '';
      } catch (e) {
        addLog('WARN', `Could not read the target integration ${integrationId}: ${describeApiError(e)} — keeping the source category`, target.name, 'MIGRATE');
      }
    }
    if (!integrationId) {
      const srcIntName = published.integration?.name || '';
      const intRes = await axios.get(`${tgtBase}/api/v2/integrations`, {
        headers: { Authorization: `Bearer ${tgtToken}` },
        params: { pageSize: 200 }
      });
      const entities = intRes.data.entities || [];
      const srcType  = published.integration?.integrationType?.id || '';

      // Navnematch skal have forrang. Én .find() med OR ville vælge den første
      // data-actions-integration i listen, også selv om der længere nede lå en
      // med præcis samme navn som kildens.
      const match = entities.find(i => i.name === srcIntName)
                 || (srcType && entities.find(i => i.integrationType?.id === srcType))
                 || entities.find(i => (i.integrationType?.id || '').includes('data-actions'));

      if (!match) {
        return res.status(400).json({
          error: `Ingen passende integration fundet i ${target.name}. Vælg mål-integration manuelt.`,
          needsIntegration: true
        });
      }

      // Gør det synligt i loggen når vi ikke ramte kildens integration præcist
      if (match.name !== srcIntName) {
        addLog('WARN',
          `No integration named "${srcIntName}" in ${target.name}; using "${match.name}". ` +
          `Pick the target integration by hand if the migration fails.`,
          source.name, 'MIGRATE');
      }
      integrationId = match.id;
      integrationName = match.name || '';
    }

    // 4. Create new action shell in target
    const srcContract = source_data.contract || published.contract || {};
    const contract = {
      input:  stripSchemaUris(srcContract.input)  || { inputSchema:   { type: 'object', properties: {} } },
      output: stripSchemaUris(srcContract.output) || { successSchema: { type: 'object', properties: {} } }
    };

    // POST /integrations/actions kræver 'config' — uden den svarer Genesys
    // 400 "Missing element 'config'".
    const srcConfig = source_data.config || published.config || {};
    const { config, warnings: tplWarnings } =
      await inlineActionTemplates(srcConfig, srcBase, srcToken);
    for (const w of tplWarnings) addLog('WARN', `"${published.name}": ${w}`, source.name, 'MIGRATE');

    // requestType og requestUrlTemplate er påkrævede af API'et
    if (!config.request.requestType)        config.request.requestType        = 'GET';
    if (!config.request.requestUrlTemplate) config.request.requestUrlTemplate = '';

    // En actions kategori er integrationens navn: det er den et flow slår den
    // op på. Beholdt vi kildens kategori, kunne en action i en integration der
    // hedder noget andet i målet blive stående under et navn flowet ikke finder.
    const category = actionCategoryFor(published.category, integrationName);
    if (category !== published.category)
      addLog('INFO', `Category of "${published.name}": "${published.category}" → "${category}" (the target integration's name)`, source.name, 'MIGRATE');

    const createRes = await axios.post(
      `${tgtBase}/api/v2/integrations/actions`,
      {
        name:         published.name,
        category,
        integrationId,
        // Archy slår en secureDataAction op blandt de secure actions alene, så
        // uden flaget fandtes den ikke i målet, selv om den var oprettet.
        secure:       !!published.secure,
        contract,
        config
      },
      { headers: { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' } }
    );
    const newAction = createRes.data;
    addLog('INFO', `Created "${newAction.name}" (${newAction.id}) in ${target.name} — version ${newAction.version}`, source.name, 'MIGRATE');

    // POST /integrations/actions opretter actionen komplet og publiceret
    // (version 1) med contract, config og templates. Der er derfor hverken en
    // draft at opdatere eller noget at publicere bagefter — tidligere forsøgte
    // vi PUT .../draft (som API'et slet ikke understøtter → 405) og
    // POST .../draft/publish (404, da der ingen draft er), hvilket fik en
    // fuldt lykkedes migrering til at fremstå som en fejl.

    addLog('SUCCESS', `Data Action "${published.name}" migrated to ${target.name}`, source.name, 'MIGRATE');
    res.json({ ok: true, newActionId: newAction.id, name: published.name });

  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `Data Action migration failed: ${msg}`, source.name, 'MIGRATE');
    if (e.response?.status === 409 || msg.toLowerCase().includes('already exist')) {
      return res.status(409).json({ error: 'already_exists', message: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// Genesys afviser ved oprettelse en minimum/maximum uden for talområdet
// (±9.99…e37), men kan godt returnere sådanne grænser fra en eksisterende
// tabel. Grænser uden for området — og ikke-endelige tal — fjernes, så de
// ikke stopper migreringen; det betyder "ingen grænse" alligevel.
const SCHEMA_LIMIT = 9.99e37;
function sanitizeDatatableSchema(schema) {
  const props = {};
  for (const [navn, def] of Object.entries(schema?.properties || {})) {
    const d = { ...def };
    for (const k of ['minimum', 'maximum']) {
      if (k in d && !(typeof d[k] === 'number' && Math.abs(d[k]) <= SCHEMA_LIMIT)) delete d[k];
    }
    props[navn] = d;
  }
  return { ...schema, properties: props };
}

// Migrate a DataTable's STRUCTURE (schema) from source org to target org.
// Rækkerne migreres bevidst ikke — kun tabeldefinitionen.
router.post('/api/datatables/migrate', async (req, res) => {
  const { sourceId, targetId, tableId } = req.body;
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });

  try {
    const { token: srcToken, apiBase: srcBase } = await getToken(source);

    // 1. Hent tabellen med schema — uden expand følger schemaet ikke med
    const srcRes = await axios.get(`${srcBase}/api/v2/flows/datatables/${tableId}`, {
      headers: { Authorization: `Bearer ${srcToken}` },
      params: { expand: 'schema' }
    });
    const src = srcRes.data;
    if (!src.schema) return res.status(400).json({ error: `Kunne ikke hente schema for "${src.name}"` });

    const { token: tgtToken, apiBase: tgtBase } = await getToken(target);
    const tgtHeaders = { Authorization: `Bearer ${tgtToken}`, 'Content-Type': 'application/json' };

    // 2. Findes tabellen allerede i målet? Navnet er unikt pr. org.
    const existing = await axios.get(`${tgtBase}/api/v2/flows/datatables`, {
      headers: { Authorization: `Bearer ${tgtToken}` },
      params: { pageSize: 200, pageNumber: 1 }
    });
    // Datatabellerne følger samme præfiks-konvention som flowene. Uden det
    // ville en tabel fra prod lande i DEV_-miljøet under prod-navnet — og bor
    // de to i samme org, er det den samme tabel.
    const tgtName = withEnvPrefix(stripEnvPrefix(src.name, source), target);
    if ((existing.data.entities || []).some(t => t.name === tgtName)) {
      return res.status(409).json({ error: 'already_exists', message: `DataTable "${tgtName}" findes allerede` });
    }

    // 3. Match division på navn. Findes den ikke, oprettes tabellen i orgens
    // standarddivision — det er bedre end at fejle, men skal siges højt.
    // Divisionen følger MILJØET, ikke kildetabellen. Er der sat en division på
    // målmiljøet, er det den der gælder; ellers falder vi tilbage på kildens
    // navn, så opførslen er uændret for de miljøer der ikke har sat noget.
    const oensketDivision = String(target.division || '').trim() || src.division?.name || null;
    let divisionId = null, divisionNote = null;
    if (oensketDivision) {
      try {
        const dv = await axios.get(`${tgtBase}/api/v2/authorization/divisions`, {
          headers: { Authorization: `Bearer ${tgtToken}` },
          params: { pageSize: 200 }
        });
        const match = (dv.data.entities || []).find(d => d.name === oensketDivision);
        if (match) divisionId = match.id;
        else divisionNote = `Division "${oensketDivision}" findes ikke i ${target.name} — tabellen oprettes i standarddivisionen`;
      } catch (e) {
        divisionNote = `Kunne ikke slå divisioner op: ${describeApiError(e)}`;
      }
    }

    // 4. Byg schemaet. datatableId peger på KILDENS tabel og skal væk —
    // ellers bærer den nye tabel en reference til en anden org.
    const schema = sanitizeDatatableSchema(src.schema);
    delete schema.datatableId;
    schema.title = tgtName;

    const body = { name: tgtName, schema };
    if (src.description) body.description = src.description;
    if (divisionId) body.division = { id: divisionId };

    const created = await axios.post(`${tgtBase}/api/v2/flows/datatables`, body, { headers: tgtHeaders });

    if (divisionNote) addLog('WARN', `"${src.name}": ${divisionNote}`, source.name, 'MIGRATE');
    addLog('SUCCESS', `DataTable "${src.name}" migrated to ${target.name} (${Object.keys(schema.properties || {}).length} columns)`, source.name, 'MIGRATE');

    res.json({ ok: true, newTableId: created.data.id, name: src.name, divisionNote });

  } catch (e) {
    const msg = describeApiError(e);
    addLog('ERROR', `DataTable migration failed: ${msg}`, source.name, 'MIGRATE');
    if (e.response?.status === 409 || /already exist/i.test(msg)) {
      return res.status(409).json({ error: 'already_exists', message: msg });
    }
    res.status(500).json({ error: msg });
  }
});

router.post('/api/data-actions/plan', async (req, res) => {
  const { sourceId, targetId, capacity } = req.body || {};
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (source.id === target.id) return res.status(400).json({ error: 'Kilde og mål er det samme miljø.' });
  if (orgKeyOf(source) === orgKeyOf(target)) return res.json({ ok: true, sameOrg: true });
  try {
    const [src, tgt, tgtInts, saved] = await Promise.all([
      listDataActionsFull(source), listDataActionsFull(target), listIntegrations(target), loadDataActionMap(source, target)]);
    const rows = compareDataActionSets(src, tgt, saved);
    // Kun det der mangler helt og kan oprettes herfra. Samme navn under en anden
    // kategori er et valg (totaltjekket), og en FDA kan ikke oprettes herfra.
    const todo = rows.filter(r => r.status === 'absent' && !r.fda);
    const existing = {};
    for (const a of tgt) existing[a.integrationId] = (existing[a.integrationId] || 0) + 1;
    const plan = planDataActionPlacement(todo, tgtInts
      .filter(i => i.type !== FUNCTION_INTEGRATION && /data-actions$|rest-actions$/.test(i.type))
      .map(i => ({ ...i, existing: existing[i.id] || 0 })), capacity);
    addLog('INFO', `Data action setup proposal ${source.name} → ${target.name}: ${todo.length} to place`, source.name, 'MIGRATE');
    res.json({
      ok: true, ...plan, saved,
      summary: { toPlace: todo.length, choose: rows.filter(r => r.status === 'choose').length,
                 fdaMissing: rows.filter(r => r.fda && (r.status === 'absent' || r.status === 'choose')).length,
                 alreadyThere: rows.filter(r => r.status === 'same' || r.status === 'mapped').length },
      manual: rows.filter(r => r.fda && (r.status === 'absent' || r.status === 'choose'))
                  .map(r => ({ name: r.name, category: r.category, integrationName: r.integrationName })),
      choose: rows.filter(r => r.status === 'choose').map(r => ({ name: r.name, category: r.category, candidates: r.candidates }))
    });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

router.post('/api/data-actions/compare', async (req, res) => {
  const { sourceId, targetId } = req.body || {};
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (source.id === target.id) return res.status(400).json({ error: 'Kilde og mål er det samme miljø.' });
  // To miljøer i samme org har de samme data actions. Der er intet at sammenligne.
  if (orgKeyOf(source) === orgKeyOf(target)) return res.json({ ok: true, sameOrg: true });
  try {
    const [src, tgt, saved] = await Promise.all([
      listDataActionsFull(source), listDataActionsFull(target), loadDataActionMap(source, target)]);
    const rows = compareDataActionSets(src, tgt, saved);
    addLog('INFO', `Data action check ${source.name} → ${target.name}: ${rows.length} compared`, source.name, 'MIGRATE');
    res.json({ ok: true, rows, summary: summarizeDataActionRows(rows), saved,
               targetActions: tgt.map(a => ({ category: a.category, name: a.name })) });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Sammenligner kontrakterne for op til 20 par ad gangen — klienten tager dem i
// bidder, så en stor org ikke holder forbindelsen oppe i minutter.
router.post('/api/data-actions/contracts', async (req, res) => {
  const { sourceId, targetId, pairs } = req.body || {};
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > 20)
    return res.status(400).json({ error: 'Send mellem 1 og 20 par.' });
  try {
    const { token: st, apiBase: sb } = await getToken(source);
    const { token: tt, apiBase: tb } = await getToken(target);
    const get = (base, token, id) => axios.get(`${base}/api/v2/integrations/actions/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${token}` }, params: { expand: 'contract' } }).then(r => r.data);
    const results = [];
    for (const p of pairs) {
      try {
        const [a, b] = await Promise.all([get(sb, st, p.source), get(tb, tt, p.target)]);
        results.push({ source: p.source, target: p.target, ...compareContracts(a, b) });
      } catch (e) {
        results.push({ source: p.source, target: p.target, error: describeApiError(e) });
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

// Gemmer hele listen af valg for et org-par — også en fjernelse. Skriver i
// mål-org'ens manifest, så den står i prod-vagten.
router.post('/api/data-actions/map', async (req, res) => {
  const { sourceId, targetId, entries } = req.body || {};
  const source = loadCustomers().find(c => c.id === sourceId);
  const target = loadCustomers().find(c => c.id === targetId);
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' });
  if (!Array.isArray(entries) || entries.length > 5000) return res.status(400).json({ error: 'Ugyldig liste.' });
  try {
    const r = await saveDataActionMap(source, target, entries.filter(validDaEntry), { replace: true });
    addLog('INFO', `Data action choices for ${source.name} → ${target.name} saved: ${r.count} (${r.where === 'org' ? 'in the target manifest' : 'locally'})`, target.name, 'MIGRATE');
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: describeApiError(e) });
  }
});

module.exports = { router, actionCategoryFor, sanitizeDatatableSchema };
