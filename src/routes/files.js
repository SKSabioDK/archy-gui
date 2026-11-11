// Ruter: eksport og import af flows med Archy, og de gemte YAML-filer.

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { FLOWS_DIR } = require('../config');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { sanitizeName, missingFields, describeApiError, safeFileName, insideFlowsDir } = require('../lib/helpers');
const { orgKeyOf, belongsToEnv } = require('../lib/environments');
const { getToken } = require('../lib/token');
const { getOrgId } = require('../lib/manifest');
const { runArchy, archyArg, archyBareArg, archyVerb } = require('../lib/archy');
const { exportFlowToYaml, yamlFlowHeader } = require('../lib/flow-yaml');
const { dependentsOf } = require('../lib/dependents');

const router = express.Router();

// ── Export Flow ──────────────────────────────────────────────────────────────

router.post('/api/export', async (req, res) => {
  const { customerId, flowName, flowType } = req.body;
  const mangler = missingFields(req.body, ['flowName', 'flowType']);
  if (mangler) return res.status(400).json({ error: mangler });

  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const exportDir = path.join(FLOWS_DIR, sanitizeName(customer.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const flowTypeLower = flowType.trim().toLowerCase();
  addLog('INFO', `Exporting flow "${flowName}" (${flowTypeLower}) from ${customer.name}`, customer.name, 'EXPORT');

  try {
    // Tidligere gættede vi filnavnet ud fra flownavnet og faldt tilbage på
    // "sidste fil i mappen". Navnet fik fjernet mellemrum, filnavnene beholdt
    // dem — så ethvert flernavnsflow ramte forbi og viste et fremmed flow.
    const { yaml: content, fileName: yamlFile } =
      await exportFlowToYaml(customer, flowName, flowTypeLower);
    addLog('SUCCESS', `Exported: ${yamlFile} → ${exportDir}`, customer.name, 'EXPORT');
    res.json({ ok: true, fileName: yamlFile, content, savedTo: exportDir });
  } catch (e) {
    addLog('ERROR', `Export failed for "${flowName}": ${e.message}`, customer.name, 'EXPORT');
    res.status(500).json({ error: e.message });
  }
});

// ── Export All Flows ─────────────────────────────────────────────────────────

// In-memory job store for export-all progress tracking
const exportJobs = {};

// Note: /api/validate-yaml endpoint is defined below (before /api/import)
// See the Cross-org YAML resource validation section

router.post('/api/export-all', async (req, res) => {
  const { customerId } = req.body;
  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const jobId = Date.now().toString();
  exportJobs[jobId] = { status: 'starting', current: 0, total: 0, succeeded: 0, failed: 0, results: [], savedTo: '', done: false, cancelled: false };

  // Return jobId immediately so client can start polling
  res.json({ ok: true, jobId });

  const job = exportJobs[jobId];
  const exportDir = path.join(FLOWS_DIR, sanitizeName(customer.name));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  job.savedTo = exportDir;

  addLog('INFO', `Starting export of ALL flows for ${customer.name}`, customer.name, 'EXPORT');

  // Fetch all flows first — kun miljøets egne, som i Flow Browser og Export.
  let allFlows = [];
  try {
    const { token, apiBase } = await getToken(customer);
    await getOrgId(customer);
    const soeskende = loadCustomers().filter(x => orgKeyOf(x) === orgKeyOf(customer));
    let page = 1;
    while (true) {
      const resp = await axios.get(`${apiBase}/api/v2/flows`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 100, pageNumber: page, includeDraft: true }
      });
      const flows = resp.data.entities || [];
      allFlows = allFlows.concat(flows.filter(f => belongsToEnv(f.name, customer, soeskende))
        .map(f => ({ name: f.name, type: f.type })));
      if (flows.length < 100) break;
      page++;
    }
  } catch (e) {
    const errMsg = e.response?.data?.message || e.message;
    addLog('ERROR', `Could not fetch flows for ${customer.name}: ${errMsg}`, customer.name, 'EXPORT');
    job.status = 'error'; job.error = errMsg; job.done = true;
    return;
  }

  job.total = allFlows.length;
  job.status = 'running';
  addLog('INFO', `Found ${allFlows.length} flows — starting export to ${exportDir}`, customer.name, 'EXPORT');

  // Export each flow sequentially — check cancelled flag before each flow
  for (const flow of allFlows) {
    if (job.cancelled) {
      addLog('WARN', `Export cancelled by user after ${job.current}/${job.total} flows`, customer.name, 'EXPORT');
      break;
    }
    try {
      await runArchy(
        `export --flowName ${archyArg(flow.name, 'Flow name')} ` +
        `--flowType ${archyBareArg(flow.type.toLowerCase(), 'Flow type')} ` +
        `--exportType yaml --force --outputDir ${archyArg(exportDir, 'Directory')}`,
        customer
      );
      job.results.push({ name: flow.name, type: flow.type.toLowerCase(), ok: true });
      job.succeeded++;
      addLog('SUCCESS', `Exported: "${flow.name}" (${flow.type.toLowerCase()})`, customer.name, 'EXPORT');
    } catch (e) {
      job.results.push({ name: flow.name, type: flow.type.toLowerCase(), ok: false, error: e.message });
      job.failed++;
      addLog('ERROR', `Error exporting "${flow.name}": ${e.message}`, customer.name, 'EXPORT');
    }
    job.current++;
  }

  job.done = true;
  job.status = job.cancelled ? 'cancelled' : 'done';
  addLog(job.cancelled ? 'WARN' : job.failed === 0 ? 'SUCCESS' : 'WARN',
    job.cancelled
      ? `Export stopped: ${job.succeeded} flows saved to "${exportDir}"`
      : `Export all completed for ${customer.name}: ${job.succeeded}/${job.total} flows ok`,
    customer.name, 'EXPORT');

  // Clean up job after 5 minutes
  setTimeout(() => { delete exportJobs[jobId]; }, 5 * 60 * 1000);
});

router.get('/api/export-all/progress/:jobId', (req, res) => {
  const job = exportJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/api/export-all/cancel/:jobId', (req, res) => {
  const job = exportJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.done) return res.json({ ok: true, alreadyDone: true });
  job.cancelled = true;
  res.json({ ok: true });
});

// ── Import Flow ──────────────────────────────────────────────────────────────

router.post('/api/validate-yaml', async (req, res) => {
  const { customerId, yamlContent } = req.body;
  if (!customerId || !yamlContent)
    return res.status(400).json({ error: 'customerId og yamlContent er påkrævet' });

  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Kunde ikke fundet' });

  const checks = [];

  try {
    const { token, apiBase } = await getToken(customer);
    const headers = { Authorization: `Bearer ${token}` };

    // 1. Division check
    const divRe = /^\s*division:\s*["']?([^'"\n]+)["']?/gm;
    const divNames = [];
    let dm;
    while ((dm = divRe.exec(yamlContent)) !== null) {
      const v = dm[1].trim();
      if (v) divNames.push(v);
    }
    for (const div of [...new Set(divNames)]) {
      try {
        const r = await axios.get(`${apiBase}/api/v2/authorization/divisions`, {
          headers, params: { pageSize: 50, name: div }
        });
        const found = (r.data.entities || []).some(d => d.name === div);
        checks.push({ type: 'division', name: div, ok: found,
          message: found ? `Division "${div}" fundet` : `\u26a0 Division "${div}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'division', name: div, ok: null, message: `Kunne ikke tjekke division "${div}"` });
      }
    }

    // 2. Queue checks
    const tqRe = /targetQueue:[\s\S]{0,60}?name:\s*["']?([^'"\n]+)["']?/gm;
    const targetQueues = [];
    let tqm;
    while ((tqm = tqRe.exec(yamlContent)) !== null) targetQueues.push(tqm[1].trim());
    for (const qName of [...new Set(targetQueues)]) {
      try {
        const r = await axios.get(`${apiBase}/api/v2/routing/queues`, {
          headers, params: { pageSize: 25, name: qName }
        });
        const found = (r.data.entities || []).some(q => q.name === qName);
        checks.push({ type: 'queue', name: qName, ok: found,
          message: found ? `K\u00f8 "${qName}" fundet` : `\u26a0 K\u00f8 "${qName}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'queue', name: qName, ok: null, message: `Kunne ikke tjekke k\u00f8 "${qName}"` });
      }
    }

    // 3. DataTable checks
    const dtRe = /dataTable:\s*\n\s+([\w][\w _\-]+):/gm;
    const dtNames = [];
    let dtm;
    while ((dtm = dtRe.exec(yamlContent)) !== null) {
      const n = dtm[1].trim();
      if (n && !['foundOutputs','failureOutputs','outputs'].includes(n)) dtNames.push(n);
    }
    const uniqueDts = [...new Set(dtNames)];
    if (uniqueDts.length) {
      try {
        let allDts = [], page = 1;
        while (true) {
          const r = await axios.get(`${apiBase}/api/v2/flows/datatables`, {
            headers, params: { pageSize: 200, pageNumber: page }
          });
          allDts = allDts.concat(r.data.entities || []);
          if (allDts.length >= (r.data.total || 0) || !(r.data.entities || []).length) break;
          page++;
        }
        const dtSet = new Set(allDts.map(t => t.name));
        for (const n of uniqueDts)
          checks.push({ type: 'datatable', name: n, ok: dtSet.has(n),
            message: dtSet.has(n) ? `DataTable "${n}" fundet` : `\u26a0 DataTable "${n}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'datatable', name: '(alle)', ok: null, message: 'Kunne ikke hente datatables: ' + e.message });
      }
    }

    // 4. Data Action checks
    const daRe = /(?:secureDataAction|dataAction):\s*\n\s+([\w][\w _\-()]+):/gm;
    const daNames = [];
    let dam;
    while ((dam = daRe.exec(yamlContent)) !== null) {
      const n = dam[1].trim();
      if (n) daNames.push(n);
    }
    const uniqueDas = [...new Set(daNames)];
    if (uniqueDas.length) {
      try {
        let allDas = [], daPage = 1;
        while (true) {
          const r = await axios.get(`${apiBase}/api/v2/integrations/actions`, {
            headers, params: { pageSize: 100, pageNumber: daPage }
          });
          allDas = allDas.concat(r.data.entities || []);
          if ((r.data.entities || []).length < 100) break;
          daPage++;
        }
        const daSet = new Set(allDas.map(a => a.name));
        for (const n of uniqueDas)
          checks.push({ type: 'dataaction', name: n, ok: daSet.has(n),
            message: daSet.has(n) ? `Data Action "${n}" fundet` : `\u26a0 Data Action "${n}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'dataaction', name: '(alle)', ok: null, message: 'Kunne ikke hente Data Actions: ' + e.message });
      }
    }

    // 5. Prompt checks
    const promptRe = /prompt:\s*["']?(?:Prompt\.)?([\w_\-. ]+)["']?/gm;
    const promptNames = [];
    let pm;
    while ((pm = promptRe.exec(yamlContent)) !== null) {
      const n = pm[1].trim();
      if (n && !['true','false','noValue'].includes(n)) promptNames.push(n);
    }
    for (const pName of [...new Set(promptNames)]) {
      try {
        const r = await axios.get(`${apiBase}/api/v2/architect/prompts`, {
          headers, params: { pageSize: 25, name: pName }
        });
        const found = (r.data.entities || []).some(p => p.name === pName);
        checks.push({ type: 'prompt', name: pName, ok: found,
          message: found ? `Prompt "${pName}" fundet` : `\u26a0 Prompt "${pName}" ikke fundet i m\u00e5l-org` });
      } catch (e) {
        checks.push({ type: 'prompt', name: pName, ok: null, message: `Kunne ikke tjekke prompt "${pName}"` });
      }
    }

    const missing = checks.filter(c => c.ok === false).length;
    addLog(
      missing > 0 ? 'WARN' : 'SUCCESS',
      `YAML validation against ${customer.name}: ${checks.length} resources checked${missing > 0 ? ', ' + missing + ' missing' : ' \u2014 all found'}`,
      customer.name, 'IMPORT'
    );
    res.json({ ok: missing === 0, checks });

  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

router.post('/api/import', async (req, res) => {
  const { customerId, yamlContent, fileName, action } = req.body;
  // action: 'create' | 'update' | 'publish'
  const customer = loadCustomers().find(c => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  // Uden dette faldt et manglende felt igennem til fs.writeFileSync og kom ud
  // som 'The "data" argument must be of type string' — en Node-fejl der intet
  // fortæller den der skal rette noget.
  if (typeof yamlContent !== 'string' || !yamlContent.trim())
    return res.status(400).json({ error: 'Ingen YAML at importere' });

  const importDir = path.join(FLOWS_DIR, `import_${safeFileName(customer.id, 'ukendt')}`);
  if (!fs.existsSync(importDir)) fs.mkdirSync(importDir, { recursive: true });

  // Navnet er kun et navn. Kom det med mapper eller ".." med, er de skrællet af.
  const trygtNavn = safeFileName(fileName, 'import.yaml');
  const filePath = path.join(importDir, trygtNavn);
  if (!insideFlowsDir(filePath))
    return res.status(400).json({ error: 'Ugyldigt filnavn' });

  let cmd;
  try { cmd = archyVerb(action); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  fs.writeFileSync(filePath, yamlContent, 'utf8');
  addLog('INFO', `Importing "${trygtNavn}" to ${customer.name} (action: ${cmd})`, customer.name, 'IMPORT');

  try {
    const out = await runArchy(`${cmd} --file ${archyArg(filePath, 'File path')}`, customer);
    addLog('SUCCESS', `Import ok: "${trygtNavn}" → ${customer.name}`, customer.name, 'IMPORT');
    // Et publiceret common module slår først igennem når de flows der kalder
    // det, publiceres igen. Samme tilbud som efter en forfremmelse.
    const hoved = yamlFlowHeader(yamlContent);
    let dependents = [];
    if (cmd === 'publish' && hoved.kind === 'commonModule' && hoved.name) {
      try { dependents = await dependentsOf(customer, hoved.name); }
      catch (e) { addLog('WARN', `Could not find the flows that use "${hoved.name}": ${describeApiError(e)}`, customer.name, 'REPUBLISH'); }
    }
    res.json({ ok: true, output: out, moduleName: hoved.name, dependents });
  } catch (e) {
    const msg = e.message || '';
    addLog('ERROR', `Import failed for "${trygtNavn}" to ${customer.name}: ${msg}`, customer.name, 'IMPORT');
    // Archy exit 108 — flow already exists with 'create' action
    if (msg.toLowerCase().includes('already exists')) {
      return res.status(409).json({ error: 'already_exists', message: msg });
    }
    // 403 / Access Denied — missing architect:flow:edit permission
    if (/403|access.?denied|forbidden|not.*authoriz|do not have.*access|insufficient.*perm/i.test(msg)) {
      return res.status(403).json({ error: 'access_denied', message: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// ── Stored YAML files ────────────────────────────────────────────────────────

// Archy navngiver eksporter <Flownavn>_v<major>-<minor>.yaml. Vi splitter det ad,
// så listen kan vise flow, version og type frem for et filnavn man skal tyde.
function parseFlowFileName(fileName) {
  const m = fileName.match(/^(.*)_v(\d+)-(\d+)\.yaml$/i);
  if (!m) return { flowName: fileName.replace(/\.yaml$/i, ''), version: null, major: null };
  return { flowName: m[1], version: `${m[2]}.${m[3]}`, major: parseInt(m[2], 10) };
}

// Flowtypen står som YAML-roden. Vi læser kun starten af filen.
function flowTypeFromFile(p) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    const head = buf.slice(0, n).toString('utf8');
    const t = head.match(/^([A-Za-z]\w*):/m);
    return t ? t[1] : null;
  } catch (_) { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
}

router.get('/api/files', (req, res) => {
  const results = [];
  if (!fs.existsSync(FLOWS_DIR)) return res.json([]);
  const customers = loadCustomers();
  for (const dir of fs.readdirSync(FLOWS_DIR)) {
    const fullDir = path.join(FLOWS_DIR, dir);
    if (!fs.statSync(fullDir).isDirectory()) continue;
    const isImportDir = dir.startsWith('import_');
    let customer;
    if (isImportDir) {
      const customerId = dir.replace('import_', '');
      customer = customers.find(c => c.id === customerId);
    } else {
      customer = customers.find(c => sanitizeName(c.name) === dir);
    }
    const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      const p = path.join(fullDir, f);
      let st = null;
      try { st = fs.statSync(p); } catch (_) {}
      const parsed = parseFlowFileName(f);
      results.push({
        customerId: customer?.id || dir, customerName: customer?.name || dir,
        fileName: f, isImport: isImportDir, path: p,
        flowName: parsed.flowName, version: parsed.version, major: parsed.major,
        flowType: flowTypeFromFile(p),
        size: st ? st.size : null,
        modified: st ? st.mtime.toISOString() : null
      });
    }
  }
  // Nyeste først
  results.sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));
  res.json(results);
});

// Rydder op i eksporterede YAML-filer: behold de nyeste N versioner af hvert
// flow pr. kunde, slet resten.
//
// Kaldes altid først med dryRun, så brugeren kan se præcis hvad der ryger.
// Filer uden versionsnummer i navnet står alene i deres egen gruppe og røres
// derfor aldrig.
router.post('/api/files/cleanup', (req, res) => {
  const keep = Math.max(1, Math.min(20, parseInt(req.body?.keep, 10) || 2));
  const dryRun = req.body?.dryRun !== false;   // slet kun når der udtrykkeligt bedes om det

  if (!fs.existsSync(FLOWS_DIR)) return res.json({ ok: true, keep, dryRun, toDelete: [], freed: 0 });

  try {
    const customers = loadCustomers();
    const groups = new Map();   // kunde|flownavn -> [filer]

    for (const dir of fs.readdirSync(FLOWS_DIR)) {
      const fullDir = path.join(FLOWS_DIR, dir);
      if (!fs.statSync(fullDir).isDirectory()) continue;
      const isImportDir = dir.startsWith('import_');
      const customer = isImportDir
        ? customers.find(c => c.id === dir.replace('import_', ''))
        : customers.find(c => sanitizeName(c.name) === dir);
      const customerName = customer?.name || dir;

      for (const f of fs.readdirSync(fullDir).filter(x => x.endsWith('.yaml'))) {
        const p = path.join(fullDir, f);
        let st; try { st = fs.statSync(p); } catch (_) { continue; }
        const parsed = parseFlowFileName(f);
        // Grupper pr. mappe, ikke kun pr. kunde: en eksport og en fil lagt op
        // til import er to forskellige ting og skal ikke udkonkurrere hinanden.
        const key = `${dir}|${parsed.flowName}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({
          path: p, fileName: f, dir, customerName, isImport: isImportDir,
          flowName: parsed.flowName, version: parsed.version, major: parsed.major,
          size: st.size, modified: st.mtime.toISOString()
        });
      }
    }

    const toDelete = [];
    for (const files of groups.values()) {
      if (files.length <= keep) continue;
      // Nyeste først: højeste version, ellers senest ændret
      files.sort((a, b) => (b.major ?? -1) !== (a.major ?? -1)
        ? (b.major ?? -1) - (a.major ?? -1)
        : String(b.modified).localeCompare(String(a.modified)));
      toDelete.push(...files.slice(keep));
    }
    const freed = toDelete.reduce((n, f) => n + f.size, 0);

    if (dryRun) return res.json({ ok: true, keep, dryRun: true, toDelete, freed });

    let deleted = 0;
    for (const f of toDelete) {
      // Bliv inden for FLOWS_DIR uanset hvad
      const resolved = path.resolve(f.path);
      if (!insideFlowsDir(resolved)) continue;
      try { fs.unlinkSync(resolved); deleted++; } catch (_) {}
    }
    addLog('SUCCESS', `Cleanup: ${deleted} old YAML files deleted (kept ${keep} per flow, ${Math.round(freed / 1024)} kB freed)`, null, 'SYSTEM');
    res.json({ ok: true, keep, dryRun: false, deleted, freed, toDelete });

  } catch (e) {
    addLog('ERROR', `Cleanup failed: ${e.message}`, null, 'SYSTEM');
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/files/content', (req, res) => {
  const { filePath } = req.query;
  // Tjekket var før en ren strengsammenligning uden path.resolve, og så slap
  // "…\flows\..\customers.json" igennem — hele kundefilen med credentials kunne
  // hentes gennem dette endpoint. insideFlowsDir opløser stien først.
  if (!insideFlowsDir(filePath))
    return res.status(400).json({ error: 'Ugyldig filsti — kun filer under flows/' });
  const resolved = path.resolve(String(filePath));
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Not found' });
  res.json({ content: fs.readFileSync(resolved, 'utf8') });
});

module.exports = { router, parseFlowFileName };
