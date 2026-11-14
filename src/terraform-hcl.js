// Terraform-filer som GUI'en kan læse og rette: find ressourcerne i en .tf-fil,
// læs deres felter, ret enkelte felter på stedet og opsummér en plan. Ren kode —
// ingen netværk, ingen filer og ingen terraform.exe — så den kan testes.
//
// Det er ikke en fuld HCL-parser. Den kender nok til at finde blokkenes grænser
// (strenge med ${…}, heredocs og kommentarer springes over) og felterne i en
// ressources øverste niveau. Alt den ikke forstår, vises og gemmes som rå HCL,
// så intet går tabt: en rettelse ændrer kun de tegn der hører til feltet.

'use strict';

// ── Scanner ───────────────────────────────────────────────────────────────────

// Står der en kommentar, streng eller heredoc ved i, gives indekset lige efter
// den. Ellers null.
function skipToken(s, i) {
  const c = s[i], d = s[i + 1];
  if (c === '#' || (c === '/' && d === '/')) { const n = s.indexOf('\n', i); return n < 0 ? s.length : n; }
  if (c === '/' && d === '*') { const n = s.indexOf('*/', i + 2); return n < 0 ? s.length : n + 2; }
  if (c === '"') return skipString(s, i);
  if (c === '<' && d === '<') {
    const m = /^<<(-?)([A-Za-z_][A-Za-z0-9_]*)[ \t]*\r?\n/.exec(s.slice(i, i + 200));
    if (m) {
      let j = i + m[0].length;
      while (j < s.length) {
        const n = s.indexOf('\n', j);
        const line = s.slice(j, n < 0 ? s.length : n).replace(/\r$/, '');
        if (line.trim() === m[2]) return j + line.length;
        if (n < 0) return s.length;
        j = n + 1;
      }
      return s.length;
    }
  }
  return null;
}

function skipString(s, i) {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if ((c === '$' || c === '%') && s[j + 1] === '{') {
      if (s[j - 1] === c) { j += 2; continue; }   // $${ og %%{ er tegn, ikke kode
      j = skipBraces(s, j + 1);
      continue;
    }
    if (c === '"') return j + 1;
    if (c === '\n') return j;                      // en streng går ikke over linjer
    j++;
  }
  return j;
}

// s[i] er '{', '[' eller '('. Giver indekset lige efter den der lukker.
function skipBraces(s, i) {
  let depth = 0, j = i;
  while (j < s.length) {
    const sk = skipToken(s, j);
    if (sk !== null) { j = sk; continue; }
    const c = s[j];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') { depth--; if (!depth) return j + 1; }
    j++;
  }
  return j;
}

const IDENT_AT = /[A-Za-z_][A-Za-z0-9_-]*/y;
function identAt(s, i) { IDENT_AT.lastIndex = i; const m = IDENT_AT.exec(s); return m ? m[0] : null; }

function skipSpace(s, i, newlines = true) {
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r' || (newlines && c === '\n')) { i++; continue; }
    break;
  }
  return i;
}

// Etiketter og '{' efter en bloks navn: resource "type" "navn" {
function readLabels(s, i) {
  const labels = [];
  for (;;) {
    i = skipSpace(s, i, false);
    if (s[i] === '"') {
      const e = skipString(s, i);
      labels.push(decodeString(s.slice(i, e)) ?? s.slice(i + 1, e - 1));
      i = e; continue;
    }
    const id = identAt(s, i);
    if (id && s[i] !== '{') { labels.push(id); i += id.length; continue; }
    break;
  }
  return { labels, at: i };
}

// Topniveauets blokke i en fil: [{ kind, labels, start, outerStart, end, open, close }]
// start/end omfatter blokken selv; outerStart tager kommentarlinjerne lige over med,
// så en slettet ressource ikke efterlader sin kommentar.
function scanBlocks(text) {
  const s = String(text);
  const out = [];
  let i = 0;
  while (i < s.length) {
    i = skipSpace(s, i);
    if (i >= s.length) break;
    const sk = skipToken(s, i);
    if (sk !== null) { i = sk; continue; }
    const id = identAt(s, i);
    if (!id) { i++; continue; }
    const start = i;
    const { labels, at } = readLabels(s, i + id.length);
    if (s[at] === '{') {
      const end = skipBraces(s, at);
      out.push({ kind: id, labels, start, outerStart: leadingComments(s, start), end, open: at, close: end - 1 });
      i = end;
      continue;
    }
    // Et attribut på topniveau (fx i terraform.tfvars): spring linjen over
    i = valueEnd(s, at);
  }
  return out;
}

function leadingComments(s, start) {
  let ls = s.lastIndexOf('\n', start - 1) + 1;
  for (;;) {
    if (ls === 0) return ls;
    const prevEnd = ls - 1;
    const prevStart = s.lastIndexOf('\n', prevEnd - 1) + 1;
    const line = s.slice(prevStart, prevEnd).trim();
    if (!line.startsWith('#') && !line.startsWith('//')) return ls;
    ls = prevStart;
  }
}

// Værdien efter '=' slutter ved linjeskift på dybde 0 — eller før en kommentar.
function valueEnd(s, i) {
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '\n') break;
    if (c === '#' || (c === '/' && (s[j + 1] === '/' || s[j + 1] === '*'))) break;
    const sk = skipToken(s, j);
    if (sk !== null) { j = sk; continue; }
    if (c === '{' || c === '[' || c === '(') { j = skipBraces(s, j); continue; }
    j++;
  }
  // Mellemrum før en kommentar hører ikke til værdien
  while (j > i && (s[j - 1] === ' ' || s[j - 1] === '\t' || s[j - 1] === '\r')) j--;
  return j;
}

// Felterne i en bloks øverste niveau. Hvert felt får et id: navnet for et
// attribut, "navn#n" for den n'te indlejrede blok med det navn.
function blockEntries(text, block) {
  const s = String(text);
  const out = [];
  const seen = {};
  let i = block.open + 1;
  while (i < block.close) {
    i = skipSpace(s, i);
    if (i >= block.close) break;
    const sk = skipToken(s, i);
    if (sk !== null) { i = sk; continue; }
    const key = identAt(s, i);
    if (!key) { i++; continue; }
    const start = i;
    let j = skipSpace(s, i + key.length, false);
    if (s[j] === '=' && s[j + 1] !== '=') {
      const vs = skipSpace(s, j + 1, false);
      const ve = valueEnd(s, vs);
      out.push({ id: key, key, kind: 'attr', start, end: ve, valueStart: vs, valueEnd: ve, raw: s.slice(vs, ve) });
      i = ve;
      continue;
    }
    const { at } = readLabels(s, i + key.length);
    if (s[at] === '{') {
      const e = skipBraces(s, at);
      const n = seen[key] = (seen[key] || 0) + 1;
      out.push({ id: `${key}#${n}`, key, kind: 'block', start, end: e, raw: s.slice(start, e) });
      i = e;
      continue;
    }
    i = valueEnd(s, j);
  }
  return out;
}

// ── Værdier ───────────────────────────────────────────────────────────────────

function hclString(v) {
  return '"' + String(v)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    .replace(/\$\{/g, () => '$${').replace(/%\{/g, () => '%%{') + '"';
}

// En streng uden kode i ("abc", ikke "${var.x}") som tekst. Ellers null.
function decodeString(raw) {
  const m = /^"((?:[^"\\$%\n]|\\.|\$\$\{|%%\{|\$(?!\{)|%(?!\{))*)"$/.exec(String(raw).trim());
  if (!m) return null;
  return m[1].replace(/\\(.)|\$\$\{|%%\{/g, (all, ch) => {
    if (all === '$${') return '${';
    if (all === '%%{') return '%{';
    return { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }[ch] ?? ch;
  });
}

// Hvad formularen kan vise som et simpelt felt: { type, value } — ellers null (rå HCL).
function literalOf(raw) {
  const r = String(raw).trim();
  const str = decodeString(r);
  if (str !== null) return { type: 'string', value: str };
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(r)) return { type: 'number', value: Number(r) };
  if (r === 'true' || r === 'false') return { type: 'bool', value: r === 'true' };
  return null;
}

// Fra formularen: { string } | { number } | { bool } | { raw }
function encodeValue(v) {
  if (!v || typeof v !== 'object') throw new Error('Missing value');
  if ('raw' in v) {
    const r = String(v.raw).trim();
    if (!r) throw new Error('Empty value');
    return r;
  }
  if ('string' in v) return hclString(v.string);
  if ('number' in v) {
    const n = Number(v.number);
    if (v.number === '' || !Number.isFinite(n)) throw new Error(`Not a number: ${v.number}`);
    return String(n);
  }
  if ('bool' in v) return v.bool ? 'true' : 'false';
  throw new Error('Unknown value');
}

// ── Ressourcer ────────────────────────────────────────────────────────────────

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function resources(text) {
  const s = String(text);
  return scanBlocks(s).filter(b => b.kind === 'resource' && b.labels.length === 2).map(b => ({
    type: b.labels[0], name: b.labels[1],
    entries: blockEntries(s, b).map(e => {
      const out = { id: e.id, key: e.key, kind: e.kind, raw: e.raw };
      if (e.kind === 'attr') { const lit = literalOf(e.raw); if (lit) out.literal = lit; }
      return out;
    }),
  }));
}

function findResource(s, type, name) {
  const b = scanBlocks(s).find(b => b.kind === 'resource' && b.labels[0] === type && b.labels[1] === name);
  if (!b) throw new Error(`Resource ${type}.${name} not found in the file`);
  return b;
}

// Retter felter på stedet: { set: { id: værdi }, remove: [id], add: [rå blok] }.
// Et nyt attribut sættes ind efter det sidste attribut; en ny blok før '}'.
function editResource(text, type, name, { set = {}, remove = [], add = [] } = {}) {
  let s = String(text);
  const b = findResource(s, type, name);
  const entries = blockEntries(s, b);
  const byId = new Map(entries.map(e => [e.id, e]));
  const splices = [];   // [start, end, ny tekst]
  for (const id of remove) {
    const e = byId.get(id);
    if (!e) continue;
    const ls = s.lastIndexOf('\n', e.start - 1) + 1;
    let le = s.indexOf('\n', e.end);
    le = le < 0 ? s.length : le + 1;
    // Hele linjen fjernes, hvis feltet står alene på den
    if (!s.slice(ls, e.start).trim() && !s.slice(e.end, le).trim()) splices.push([ls, le, '']);
    else splices.push([e.start, e.end, '']);
  }
  const lineIndent = pos => (/^[ \t]*/.exec(s.slice(s.lastIndexOf('\n', pos - 1) + 1)) || [''])[0];
  const fresh = [];
  for (const [id, v] of Object.entries(set)) {
    if (remove.includes(id)) continue;
    const e = byId.get(id);
    if (e && e.kind === 'attr') { splices.push([e.valueStart, e.valueEnd, encodeValue(v)]); continue; }
    if (e && e.kind === 'block') {
      const r = String((v && v.raw) || '').trim();
      if (!r) throw new Error(`Empty block: ${id}`);
      checkBlockText(r, e.key);
      splices.push([e.start, e.end, reindent(r, lineIndent(e.start)).replace(/^[ \t]*/, '')]);
      continue;
    }
    if (!NAME_RE.test(id)) throw new Error(`Invalid field name: ${id}`);
    fresh.push(`${id} = ${encodeValue(v)}`);
  }
  const indent = entries.length ? lineIndent(entries[0].start) : '  ';
  if (fresh.length) {
    const attrs = entries.filter(e => e.kind === 'attr' && !remove.includes(e.id));
    const after = attrs.length ? attrs[attrs.length - 1].end : b.open + 1;
    splices.push([after, after, fresh.map(l => '\n' + indent + l).join('')]);
  }
  if (add.length) {
    const blocks = add.map(r => {
      const t = String(r).trim();
      checkBlockText(t);
      return reindent(t, indent);
    });
    let at = b.close;
    while (at > b.open && (s[at - 1] === ' ' || s[at - 1] === '\t')) at--;
    const nl = s[at - 1] === '\n' ? '' : '\n';
    splices.push([at, at, nl + blocks.join('\n') + '\n']);
  }
  splices.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [a, e, t] of splices) s = s.slice(0, a) + t + s.slice(e);
  return s;
}

// En indlejret blok skal være netop én blok: navn { … }
function checkBlockText(t, key) {
  const id = identAt(t, 0);
  if (!id || (key && id !== key)) throw new Error(`The block must start with ${key || 'a name'} {`);
  const { at } = readLabels(t, id.length);
  if (t[at] !== '{' || skipBraces(t, at) !== t.length) throw new Error(`The block ${id} must be one { … } block`);
}

function reindent(t, indent) {
  const lines = t.split('\n');
  const rest = lines.slice(1).filter(l => l.trim());
  const min = rest.length ? Math.min(...rest.map(l => /^[ \t]*/.exec(l)[0].length)) : 0;
  const base = Math.max(0, min - 2);
  return indent + lines[0].trim() + lines.slice(1).map(l => '\n' + (l.trim() ? indent + l.slice(Math.min(base, /^[ \t]*/.exec(l)[0].length)) : '')).join('');
}

function newResourceText(type, name, attrs = [], blocks = []) {
  if (!/^[a-z][a-z0-9_]*$/.test(type)) throw new Error(`Invalid resource type: ${type}`);
  if (!NAME_RE.test(name)) throw new Error(`Invalid name: ${name} — use letters, digits, _ and -, and start with a letter`);
  const lines = attrs.map(([k, v]) => {
    if (!NAME_RE.test(k)) throw new Error(`Invalid field name: ${k}`);
    return [k, encodeValue(v)];
  });
  const w = Math.max(0, ...lines.map(([k]) => k.length));
  let out = `resource "${type}" "${name}" {\n` + lines.map(([k, v]) => `  ${k.padEnd(w)} = ${v}\n`).join('');
  for (const b of blocks) { const t = String(b).trim(); checkBlockText(t); out += reindent(t, '  ') + '\n'; }
  return out + '}\n';
}

function addResource(text, type, name, attrs, blocks) {
  const s = String(text || '');
  if (scanBlocks(s).some(b => b.kind === 'resource' && b.labels[0] === type && b.labels[1] === name))
    throw new Error(`${type}.${name} already exists in the file`);
  const block = newResourceText(type, name, attrs, blocks);
  if (!s.trim()) return block;
  return s.replace(/\s*$/, '') + '\n\n' + block;
}

function removeResource(text, type, name) {
  const s = String(text);
  const b = findResource(s, type, name);
  let end = b.end;
  while (s[end] === '\r' || s[end] === '\n') end++;
  const out = s.slice(0, b.outerStart) + s.slice(end);
  return out.replace(/\n{3,}/g, '\n\n');
}

// ── Plan ──────────────────────────────────────────────────────────────────────

// terraform show -json <plan> → hvad der oprettes, ændres, slettes og erstattes.
function summarizePlan(json) {
  const p = typeof json === 'string' ? JSON.parse(json) : json;
  const items = [];
  for (const rc of (p && p.resource_changes) || []) {
    const a = (rc.change && rc.change.actions) || [];
    let action = null;
    if (a.includes('create') && a.includes('delete')) action = 'replace';
    else if (a.includes('create')) action = 'create';
    else if (a.includes('delete')) action = 'delete';
    else if (a.includes('update')) action = 'update';
    if (!action || rc.mode === 'data') continue;
    const changed = action === 'update'
      ? Object.keys({ ...(rc.change.before || {}), ...(rc.change.after || {}) })
        .filter(k => JSON.stringify((rc.change.before || {})[k]) !== JSON.stringify((rc.change.after || {})[k])).sort()
      : [];
    items.push({ address: rc.address, type: rc.type, name: rc.name, action, changed });
  }
  const order = { delete: 0, replace: 1, update: 2, create: 3 };
  items.sort((x, y) => order[x.action] - order[y.action] || x.address.localeCompare(y.address));
  const n = k => items.filter(i => i.action === k).length;
  return { create: n('create'), update: n('update'), delete: n('delete'), replace: n('replace'), items };
}

// ── Fejl ──────────────────────────────────────────────────────────────────────

// Kendte fejl fra terraform.exe → en kode brugerfladen kan forklare.
function errorHint(text) {
  const t = String(text || '');
  if (/authentication handshake failed|certificate signed by unknown authority/i.test(t) && /plugin|provider|GRPC/i.test(t)) return 'tls_intercept';
  // Uden loggen ses kun at provideren ikke svarede; årsagen er oftest den samme
  if (/Plugin did not respond|plugin process exited|failed to instantiate provider/i.test(t)) return 'plugin_start';
  if (/Inconsistent dependency lock file|terraform init|Missing required provider|Plugin reinitialization required/i.test(t)) return 'needs_init';
  if (/Failed to query available provider packages|registry\.terraform\.io.*(timeout|no such host|connection)/i.test(t)) return 'registry';
  if (/401|invalid_client|bad\.credentials|unauthorized/i.test(t) && /genesys|oauth|token|provider/i.test(t)) return 'auth';
  if (/Saved plan is stale/i.test(t)) return 'stale_plan';
  return null;
}

// ── Loggen ────────────────────────────────────────────────────────────────────
// terraforms uddata gjort læselig. En eksport skrev før "apply", "Creating…"
// og "Plan: 1 to add", hvilket lignede en ændring i org'en — det er kun
// eksportørens egen hjælpe-ressource. Den del skjules, og brugerfladen siger
// i stedet at org'en kun læses. "Still creating… [01m10s elapsed]" hvert 10.
// sekund bliver til én tidsangivelse, og hver 403 fra en type login'et ikke må
// læse, bliver til en linje i listen over sprungne typer.
const PERM_RE = /permission\(s\): \[([^\]]+)\]|permission ([\w:*]+) in at least|permissions assigned: \[([^\]]+)\]/;

function logFilter({ exportRun = false } = {}) {
  let inPlan = false;
  return line => {
    const l = String(line);
    const el = /Still (?:creating|modifying|destroying|reading)\.\.\. \[(\d+m\d+s|\d+s) elapsed\]/.exec(l);
    if (el) return { elapsed: el[1] };
    if (/API Error: 403/.test(l)) {
      const p = PERM_RE.exec(l);
      if (p) {
        const what = (/\.exe: (.+?)(?: \| error| error)?: /.exec(l) || [])[1] || '';
        return { skipped: { perm: (p[1] || p[2] || p[3]).trim(), what: what.replace(/^failed/, 'Failed').trim() } };
      }
    }
    if (!exportRun) return { log: l };
    // init: kun det der siger noget
    if (/^(Initializing|Partner and community|If you'd like to know more|https:\/\/developer\.hashicorp\.com\/terraform\/cli\/plugins\/signing|Terraform has created a lock file|selections it made above|so that Terraform can guarantee|you run "terraform init"|- Finding )/.test(l)) return {};
    // apply af eksportørens hjælpe-ressource: planen er ikke en ændring i org'en
    if (/^Terraform used the selected providers/.test(l)) { inPlan = true; return {}; }
    if (inPlan) { if (/^Plan: /.test(l)) inPlan = false; return {}; }
    if (/^genesyscloud_tf_export\.export: (Creating|Creation complete)/.test(l)) return {};
    if (/^Apply complete! Resources: 1 added/.test(l)) return {};
    return { log: l };
  };
}

// Typer der fik hele eksporten til at fejle. Mangler login'et en rettighed,
// springer eksportøren selv typen over (log_permission_errors), men mangler
// OAuth-klienten et scope, stopper den: Falck US' klient havde ikke
// webdeployments. terraform ombryder fejlen over flere linjer, så den samles
// først. → [{ type, perm }]
function exportFailures(output) {
  const flat = String(output || '').replace(/\s*\r?\n\s*/g, ' ');
  const out = [];
  const re = /\{"resourceType":"(genesyscloud_[a-z0-9_]+)"[^{}]*?"statusCode":(40[13])[^{}]*?"errorMessage":"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(flat))) {
    const msg = m[3];
    const scope = /scope \[([^\],]+)/.exec(msg);
    const p = PERM_RE.exec(msg);
    const perm = scope ? 'scope ' + scope[1].trim() : p ? (p[1] || p[2] || p[3]).trim() : 'HTTP ' + m[2];
    if (!out.some(x => x.type === m[1])) out.push({ type: m[1], perm });
  }
  return out;
}

// Sprungne typer samlet pr. rettighed: [{ perm, what: [...] }]
function addSkipped(list, { perm, what }) {
  let e = list.find(x => x.perm === perm);
  if (!e) { e = { perm, what: [] }; list.push(e); }
  if (what && !e.what.includes(what)) e.what.push(what);
  return list;
}

// ── Eksportøren ───────────────────────────────────────────────────────────────

// main.tf til genesyscloud_tf_export. Med state (samme org) bliver objekterne i
// org'en styret af Terraform fra start; uden (en anden org) bliver de oprettet.
function exportMainTf({ includeState = false, include = [], exclude = [], dependencies = false } = {}) {
  const list = a => '[' + a.map(hclString).join(', ') + ']';
  const lines = [
    ['directory', hclString('./out')],
    ['export_format', hclString('hcl')],
    ['split_files_by_resource', 'true'],
    ['include_state_file', includeState ? 'true' : 'false'],
    ['log_permission_errors', 'true'],
    ['enable_dependency_resolution', dependencies ? 'true' : 'false'],
    ['use_legacy_architect_flow_exporter', 'false'],
  ];
  if (include.length) lines.push(['include_filter_resources', list(include)]);
  if (exclude.length) lines.push(['exclude_filter_resources', list(exclude)]);
  const w = Math.max(...lines.map(([k]) => k.length));
  return `# Lavet af Archy GUI. Kører Genesys' egen eksportør (genesyscloud_tf_export).
# Login og region kommer fra miljøvariablerne GENESYSCLOUD_ACCESS_TOKEN og GENESYSCLOUD_REGION.
terraform {
  required_providers {
    genesyscloud = {
      source = "mypurecloud/genesyscloud"
    }
  }
}

provider "genesyscloud" {}

resource "genesyscloud_tf_export" "export" {
${lines.map(([k, v]) => `  ${k.padEnd(w)} = ${v}`).join('\n')}
}
`;
}

// Udsnit af `terraform providers schema -json` til formularerne.
function trimSchema(json) {
  const p = typeof json === 'string' ? JSON.parse(json) : json;
  const prov = Object.entries((p && p.provider_schemas) || {}).find(([k]) => /genesyscloud$/.test(k));
  if (!prov) return { types: {} };
  const block = b => {
    const attrs = {};
    for (const [k, a] of Object.entries((b && b.attributes) || {})) {
      if (k === 'id' || (a.computed && !a.optional && !a.required)) continue;
      attrs[k] = { type: a.type, required: !!a.required, description: a.description || '', sensitive: !!a.sensitive,
        deprecated: !!a.deprecated };
    }
    const blocks = {};
    for (const [k, bt] of Object.entries((b && b.block_types) || {}))
      blocks[k] = { min: bt.min_items || 0, max: bt.max_items || 0, nesting: bt.nesting_mode, description: (bt.block && bt.block.description) || '',
        example: exampleBlock(k, bt.block) };
    return { attrs, blocks };
  };
  const types = {};
  for (const [t, r] of Object.entries(prov[1].resource_schemas || {})) {
    if (t === 'genesyscloud_tf_export') continue;
    types[t] = { description: (r.block && r.block.description) || '', ...block(r.block) };
  }
  return { types };
}

// En skabelon til en ny indlejret blok: de påkrævede felter med tomme værdier.
function exampleBlock(name, b) {
  const req = Object.entries((b && b.attributes) || {}).filter(([, a]) => a.required);
  const sample = t => t === 'string' ? '""' : t === 'number' ? '0' : t === 'bool' ? 'false' : Array.isArray(t) && t[0] === 'map' ? '{}' : Array.isArray(t) ? '[]' : 'null';
  return `${name} {\n${req.map(([k, a]) => `  ${k} = ${sample(a.type)}\n`).join('')}}`;
}

module.exports = { scanBlocks, blockEntries, resources, editResource, addResource, removeResource, newResourceText,
  literalOf, decodeString, encodeValue, hclString, summarizePlan, errorHint, exportMainTf, trimSchema, exampleBlock,
  logFilter, addSkipped, exportFailures };
