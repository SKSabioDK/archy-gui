// Kundepakken i en Terraform-mappe: det der skal til, for at kunden kan pakke
// mappen ud på sin egen pc, skrive sin OAuth-klient (client id og secret) ind ét
// sted og køre plan og apply uden Archy GUI. Ren kode — ingen filer, intet net.
//
// login.example.ps1 / login.example.sh  → kopieres til login.ps1 / login.sh og udfyldes
// run.cmd / run.ps1 / run.sh             → init, plan og apply med login'et
// .gitignore                             → login-filer, planer og .terraform/ kommer ikke med i git
// README.md                              → afsnittet "Kør den på din egen pc"

const zlib = require('zlib');

const KIT_MARK = '<!-- archy-kit -->';
const KIT_FILES = ['login.example.ps1', 'login.example.sh', 'run.cmd', 'run.ps1', 'run.sh', '.gitignore'];
// Filer der aldrig må med i en pakke til kunden: login, Archy GUI's egne filer, planer og providerens mappe
const ZIP_SKIP = /(^|\/)\.terraform(\/|$)|(^|\/)login\.(ps1|sh)$|(^|\/)workspace\.json$|(^|\/)\.archy-plan\.json$|\.tfplan$|(^|\/)terraform\.tfstate\.(\d+\.)?backup$|(^|\/)export_errors\.json$|(^|\/)_export(\/|$)/i;

const crlf = s => s.replace(/\r?\n/g, '\r\n');

function kitFiles({ region } = {}) {
  const r = region || 'eu-central-1';
  return {
    'login.example.ps1': crlf(`# Copy this file to login.ps1 and fill in the OAuth client for the org you want to change.
# The client must use Client Credentials and have a role that may change the objects in this folder.
# login.ps1 is in .gitignore - never commit or send it.
$env:GENESYSCLOUD_OAUTHCLIENT_ID     = ''
$env:GENESYSCLOUD_OAUTHCLIENT_SECRET = ''
$env:GENESYSCLOUD_REGION             = '${r}'
`),
    'login.example.sh': `# Copy this file to login.sh and fill in the OAuth client for the org you want to change.
# The client must use Client Credentials and have a role that may change the objects in this folder.
# login.sh is in .gitignore - never commit or send it.
export GENESYSCLOUD_OAUTHCLIENT_ID=''
export GENESYSCLOUD_OAUTHCLIENT_SECRET=''
export GENESYSCLOUD_REGION='${r}'
`,
    'run.cmd': crlf(`@echo off
rem  run plan   - shows what would change
rem  run apply  - carries out the plan you just read
rem  run init   - downloads the Genesys Cloud provider (done automatically the first time)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
`),
    'run.ps1': crlf(`# Runs Terraform in this folder with the login from login.ps1.
#   .\\run.ps1 plan    shows what would change and saves the plan
#   .\\run.ps1 apply   carries out exactly that plan
#   .\\run.ps1 init    downloads the Genesys Cloud provider
param([ValidateSet('init', 'plan', 'apply')][string]$Step = 'plan')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
  Write-Host 'Terraform is not installed or not in PATH: https://developer.hashicorp.com/terraform/install' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path -LiteralPath '.\\login.ps1')) {
  Write-Host 'Copy login.example.ps1 to login.ps1 and fill in the client id, the secret and the region.' -ForegroundColor Yellow
  exit 1
}
. .\\login.ps1
Remove-Item Env:GENESYSCLOUD_ACCESS_TOKEN -ErrorAction SilentlyContinue
foreach ($v in 'GENESYSCLOUD_OAUTHCLIENT_ID', 'GENESYSCLOUD_OAUTHCLIENT_SECRET', 'GENESYSCLOUD_REGION') {
  if (-not [Environment]::GetEnvironmentVariable($v)) { Write-Host "$v is empty in login.ps1" -ForegroundColor Yellow; exit 1 }
}

if ($Step -eq 'init' -or -not (Test-Path -LiteralPath '.\\.terraform')) {
  terraform init -input=false
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  if ($Step -eq 'init') { exit 0 }
}
if ($Step -eq 'plan') {
  terraform plan -input=false '-out=customer.tfplan'
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  Write-Host ''
  Write-Host 'Read the plan above. If it is right: run apply' -ForegroundColor Cyan
  exit 0
}
if (-not (Test-Path -LiteralPath '.\\customer.tfplan')) {
  Write-Host 'Run plan first and read it - apply only carries out a plan you have seen.' -ForegroundColor Yellow
  exit 1
}
terraform apply -input=false customer.tfplan
$code = $LASTEXITCODE
Remove-Item -LiteralPath '.\\customer.tfplan' -ErrorAction SilentlyContinue
exit $code
`),
    'run.sh': `#!/bin/sh
# Runs Terraform in this folder with the login from login.sh.
#   ./run.sh plan    shows what would change and saves the plan
#   ./run.sh apply   carries out exactly that plan
#   ./run.sh init    downloads the Genesys Cloud provider
set -e
cd "$(dirname "$0")"
STEP="\${1:-plan}"
command -v terraform >/dev/null 2>&1 || { echo 'Terraform is not installed or not in PATH: https://developer.hashicorp.com/terraform/install'; exit 1; }
[ -f ./login.sh ] || { echo 'Copy login.example.sh to login.sh and fill in the client id, the secret and the region.'; exit 1; }
. ./login.sh
unset GENESYSCLOUD_ACCESS_TOKEN
for v in GENESYSCLOUD_OAUTHCLIENT_ID GENESYSCLOUD_OAUTHCLIENT_SECRET GENESYSCLOUD_REGION; do
  eval "val=\\\${$v:-}"
  [ -n "$val" ] || { echo "$v is empty in login.sh"; exit 1; }
done
if [ "$STEP" = init ] || [ ! -d .terraform ]; then
  terraform init -input=false
  [ "$STEP" = init ] && exit 0
fi
case "$STEP" in
  plan)
    terraform plan -input=false -out=customer.tfplan
    echo
    echo 'Read the plan above. If it is right: ./run.sh apply' ;;
  apply)
    [ -f customer.tfplan ] || { echo 'Run plan first and read it - apply only carries out a plan you have seen.'; exit 1; }
    terraform apply -input=false customer.tfplan
    rm -f customer.tfplan ;;
  *) echo 'Use: ./run.sh plan | apply | init'; exit 1 ;;
esac
`,
    '.gitignore': `# The login with the client secret
login.ps1
login.sh
# Terraform's own files
.terraform/
*.tfplan
crash.log
`,
  };
}

const README_KIT = {
  da: ({ region, hasState }) => `${KIT_MARK}
## Kør den på din egen pc

Mappen kan pakkes ud og køres hvor som helst — Archy GUI skal ikke være installeret.

1. **Installér Terraform** (https://developer.hashicorp.com/terraform/install), så \`terraform\` kan køres fra en kommandoprompt.
2. **Lav en OAuth-klient** i den org, der skal ændres: *Admin → Integrations → OAuth → Add Client*, typen **Client Credentials**, med en rolle der må ændre de objekter, mappen indeholder.
3. **Skriv login'et ind ét sted:** kopiér \`login.example.ps1\` til \`login.ps1\` (Mac/Linux: \`login.example.sh\` til \`login.sh\`) og udfyld client id, secret og region. Regionen er sat til \`${region || 'eu-central-1'}\` — ret den, hvis org'en ligger et andet sted. \`login.ps1\` og \`login.sh\` står i \`.gitignore\` og må aldrig sendes videre.
4. **Se hvad der vil ske:** \`run plan\` i en kommandoprompt i mappen (PowerShell: \`.\\run.ps1 plan\`, Mac/Linux: \`./run.sh plan\`). Første gang hentes Genesys Cloud-provideren automatisk.
5. **Udfør planen:** læs den, og kør så \`run apply\`. Apply udfører kun den plan, du lige har set.

${hasState
    ? `\`terraform.tfstate\` hører til mappen: den fortæller Terraform, hvilke objekter i org'en filerne styrer. Behold den, og del den kun med dem, der skal køre mappen — den indeholder org'ens værdier.`
    : `Der er ingen \`terraform.tfstate\`, så første apply opretter objekterne. Efter apply ligger state i mappen — behold den, ellers prøver næste apply at oprette dem igen.`}

Hemmeligheder (fx credentials til integrationer) eksporteres ikke. De står som variabler i \`terraform.tfvars\` og skal udfyldes, før en plan kan oprette dem.
`,
  en: ({ region, hasState }) => `${KIT_MARK}
## Run it on your own PC

The folder can be unpacked and run anywhere — Archy GUI does not have to be installed.

1. **Install Terraform** (https://developer.hashicorp.com/terraform/install) so \`terraform\` runs from a command prompt.
2. **Create an OAuth client** in the org that should change: *Admin → Integrations → OAuth → Add Client*, type **Client Credentials**, with a role that may change the objects in this folder.
3. **Enter the login in one place:** copy \`login.example.ps1\` to \`login.ps1\` (Mac/Linux: \`login.example.sh\` to \`login.sh\`) and fill in the client id, the secret and the region. The region is set to \`${region || 'eu-central-1'}\` — change it if the org lives elsewhere. \`login.ps1\` and \`login.sh\` are in \`.gitignore\` and must never be passed on.
4. **See what would happen:** \`run plan\` in a command prompt in the folder (PowerShell: \`.\\run.ps1 plan\`, Mac/Linux: \`./run.sh plan\`). The first time, the Genesys Cloud provider is downloaded automatically.
5. **Carry out the plan:** read it, then run \`run apply\`. Apply only carries out the plan you have just seen.

${hasState
    ? `\`terraform.tfstate\` belongs to the folder: it tells Terraform which objects in the org the files manage. Keep it, and share it only with those who will run the folder — it holds the org's values.`
    : `There is no \`terraform.tfstate\`, so the first apply creates the objects. After apply the state is in the folder — keep it, or the next apply tries to create them again.`}

Secrets (e.g. integration credentials) are not exported. They are variables in \`terraform.tfvars\` and must be filled in before a plan can create them.
`,
};

const kitReadme = (lang, opts) => (README_KIT[lang] || README_KIT.en)(opts || {});

// README med kundeafsnittet: et gammelt afsnit erstattes, ellers lægges det til
function withKitReadme(readme, lang, opts) {
  const base = String(readme || '');
  const i = base.indexOf(KIT_MARK);
  const head = (i >= 0 ? base.slice(0, i) : base).replace(/\s*$/, '');
  return (head ? head + '\n\n' : '') + kitReadme(lang, opts);
}

// ── Zip ──────────────────────────────────────────────────────────────────────
// entries: [{ name, data: Buffer, mtime?: Date }] → Buffer. Deflate, UTF-8-navne.
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function dosTime(d) {
  const t = d instanceof Date && !isNaN(d) ? d : new Date();
  const y = Math.max(1980, t.getFullYear());
  return { time: (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate() };
}

function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(String(e.name).replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const packed = zlib.deflateRawSync(data);
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data;
    const crc = crc32(data);
    const { time, date } = dosTime(e.mtime);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(useDeflate ? 8 : 0, 8); h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(useDeflate ? 8 : 0, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

// Erklærer filen genesyscloud-provideren fra mypurecloud?
const declaresProvider = text => /required_providers\s*\{[\s\S]*?source\s*=\s*"(registry\.terraform\.io\/)?mypurecloud\/genesyscloud"/i.test(String(text || ''));
const VERSIONS_TF = `terraform {
  required_version = ">= 1.0.0"
  required_providers {
    genesyscloud = {
      source = "mypurecloud/genesyscloud"
    }
  }
}
`;

module.exports = { KIT_MARK, KIT_FILES, ZIP_SKIP, VERSIONS_TF, declaresProvider, kitFiles, kitReadme, withKitReadme, zip, crc32 };
