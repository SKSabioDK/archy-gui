# Archy GUI — Flow Manager · v1.6.0

> 🇩🇰 [Dansk](#dansk) · 🇬🇧 [English](#english)

---

## Changelog

### v1.6.0
---
**🇩🇰 Dansk**
- **🔷 Sabio-tema** — To nye temaer, *Sabio Dark* og *Sabio Light*, med Sabios brandfarver (navy `#0F096B`, gul `#F7D501`, lilla `#6518BB`), Sabios ordmærke i topbaren og brandets skarpe hjørner. Temavælgeren i topbaren er nu en dropdown med fire valg i stedet for en lys/mørk-knap, og det valgte tema sættes før første paint, så der ikke blinker et forkert tema ved indlæsning.
- **Data Action migration virker igen** — Migreringen fejlede med `Bad Request`. Genesys kræver feltet `config` ved oprettelse, og det blev hverken sendt *eller* hentet: `config` følger kun med når `includeConfig=true` er sat — ikke via `expand`. Derudover pegede de kopierede `requestTemplateUri`, `successTemplateUri` og `*SchemaUri` på kildens action-id, så en migreret action ville referere kildeorganisationen. Templates hentes nu og sendes inline, og schema-URI'erne strippes.
- **Falsk fejl efter vellykket migrering** — Efter oprettelsen forsøgte koden `PUT .../draft` (som API'et ikke understøtter → 405) og `POST .../draft/publish` (404, da der ingen draft er). Begge trin er overflødige: `POST /integrations/actions` opretter actionen komplet og publiceret. En migrering der lykkedes fuldt ud fremstod derfor som en fejl.
- **Sprogskift var kun halvt gennemført** — `setLang()` kaldte `renderCustomers()`, som ikke findes. Kaldet kastede, så alt efter det blev sprunget over. Data Actions-siden var desuden aldrig oversat og stod på dansk uanset sprogvalg. Alle tekster på siden — plus YAML-validator, Import- og Export-knapper — har nu nøgler på alle fem sprog.
- **Læsbare API-fejl** — Fejl fra Genesys viste kun `e.response.data.message`, som ved en 400 blot er "Bad Request". Årsagen ligger i `code`, `details[]` og `errors[]` og blev smidt væk. Fejl viser nu felt, kode, endpoint og `contextId` til Genesys support.
- **Certifikater bag TLS-inspektion** — `start.bat` kører nu Node med `--use-system-ca`, så Windows' certifikatlager bruges. Uden det fejler API-kald når Norton eller en firmaproxy gensignerer HTTPS og `NODE_EXTRA_CA_CERTS` ikke er arvet. Falder tilbage på Node < 22.15, hvor flaget ikke findes.
- **Versionstjek sammenlignede forkert** — Tjekket brugte `!==` i stedet for semver, så det meldte "opdatering tilgængelig" når man var *foran* remote. Versionsnummeret i sidebaren var desuden hardkodet og hang på `v1.4.1`; det læses nu fra `/api/version`.

---
**🇬🇧 English**
- **🔷 Sabio theme** — Two new themes, *Sabio Dark* and *Sabio Light*, using Sabio's brand colours (navy `#0F096B`, yellow `#F7D501`, purple `#6518BB`), the Sabio wordmark in the top bar, and the brand's square corners. The theme switcher is now a four-option dropdown instead of a light/dark toggle, and the stored theme is applied before first paint so no wrong theme flashes on load.
- **Data Action migration works again** — Migration failed with `Bad Request`. Genesys requires a `config` element on create, and it was neither sent *nor* fetched: `config` is only returned when `includeConfig=true` is set — not via `expand`. On top of that, the copied `requestTemplateUri`, `successTemplateUri` and `*SchemaUri` all carried the source action's id, so a migrated action would point back at the source org. Templates are now fetched and sent inline, and the schema URIs are stripped.
- **False error after a successful migration** — After creating the action the code attempted `PUT .../draft` (not supported by the API → 405) and `POST .../draft/publish` (404, since there is no draft). Both steps are redundant: `POST /integrations/actions` creates the action complete and published. A fully successful migration therefore looked like a failure.
- **Language switching only half applied** — `setLang()` called `renderCustomers()`, which does not exist. The call threw, so everything after it was skipped. The Data Actions page had also never been translated and stayed Danish regardless of the selected language. Every string on that page — plus the YAML validator and the Import/Export buttons — now has keys in all five languages.
- **Readable API errors** — Genesys errors only surfaced `e.response.data.message`, which for a 400 is just "Bad Request". The actual cause lives in `code`, `details[]` and `errors[]` and was discarded. Errors now show the field, code, endpoint and `contextId` for Genesys support.
- **Certificates behind TLS inspection** — `start.bat` now runs Node with `--use-system-ca` so the Windows certificate store is used. Without it, API calls fail when Norton or a corporate proxy re-signs HTTPS and `NODE_EXTRA_CA_CERTS` is not inherited. Falls back gracefully on Node < 22.15, where the flag does not exist.
- **Version check compared wrongly** — The check used `!==` instead of semver, so it reported "update available" when you were *ahead* of the remote. The sidebar version was also hardcoded and stuck at `v1.4.1`; it now reads from `/api/version`.

### v1.5.0
---
**🇩🇰 Dansk**
- **⚡ Data Actions migration** — Ny side i sidebaren til at migrere Data Actions mellem Genesys Cloud orgs. Vælg kilde-org og mål-org, filtrer og vælg actions (søg + kategori-filter), og klik "Migrér valgte". Kopierer navn, kategori, input/output-schema, request template og publicerer automatisk. Håndterer "allerede eksisterer".
- **🌐 Tjek mod org** — Ny knap på Import YAML-siden der tjekker YAML'en mod mål-org'en *inden* import via Genesys API. Viser præcis hvilke ressourcer der mangler: division, køer, DataTables, Data Actions og Prompts. Forhindrer fejlede imports og sparer debugging-tid.
- **Kortere fejllog fra Archy** — Archy-fejloutput viser nu kun de **sidste 30 linjer** i stedet for tusindvis af linjer intern path-resolution debug. Det vigtige (selve fejlbeskrivelsen) er altid i slutningen af Archy's output.
- **Smartere success-detection** — Import/migrate viser nu korrekt ✓ success selvom Archy returnerer exit code != 0 pga. warnings eller debug-output. Outputtet scannes for kendte succesbeskeder ("created", "published", "successfully" m.fl.).

---
**🇬🇧 English**
- **⚡ Data Actions migration** — New sidebar page to migrate Data Actions between Genesys Cloud orgs. Select source and target org, filter and select actions (search + category filter), and click "Migrate selected". Copies name, category, input/output schema, request template, and publishes automatically. Handles "already exists".
- **🌐 Check against org** — New button on the Import YAML page that checks the YAML against the target org *before* importing via the Genesys API. Shows exactly which resources are missing: division, queues, DataTables, Data Actions and Prompts. Prevents failed imports and saves debugging time.
- **Shorter Archy error log** — Archy error output now shows only the **last 30 lines** instead of thousands of lines of internal path-resolution debug. The important part (the actual error description) is always at the end of Archy's output.
- **Smarter success detection** — Import/migrate now correctly shows ✓ success even when Archy returns a non-zero exit code due to warnings or debug output. The output is scanned for known success indicators ("created", "published", "successfully" etc.).

### v1.4.3
---
**🇩🇰 Dansk**
- **YAML Validator** — Ny "🔍 Valider YAML"-knap på Import-siden. Validerer YAML syntaks og Archy-struktur direkte i browseren — ingen kundeforbindelse nødvendig. Viser ✅/❌/⚠️ for: YAML syntaks (med linje- og kolonnenummer ved fejl), flow-type, `name`, `startUpRef`, `defaultLanguage` og `supportedLanguages`. Opsummering øverst fortæller straks om YAML er klar til import.
- **Smartere fejlvisning ved import** — Alerten viser nu kun den første meningsfulde fejllinje (max 160 tegn) i stedet for hele Archy-outputtet. De fulde detaljer vises stadig i log-boksen nedenunder (scrollbar, max 200px). Ved succes skjules log-boksen — den grønne "✓ Flow importeret!"-alert er tilstrækkelig.

---
**🇬🇧 English**
- **YAML Validator** — New "🔍 Valider YAML" button on the Import page. Validates YAML syntax and Archy structure directly in the browser — no customer connection needed. Shows ✅/❌/⚠️ for: YAML syntax (with line and column on error), flow type, `name`, `startUpRef`, `defaultLanguage` and `supportedLanguages`. A summary at the top tells you immediately whether the YAML is ready to import.
- **Smarter import error display** — The alert now shows only the first meaningful error line (max 160 chars) instead of the full Archy output. Full details are still shown in the log box below (scrollable, max 200px). On success the log box is hidden — the green "✓ Flow imported!" alert is sufficient.

### v1.4.2
---
**🇩🇰 Dansk**
- **Renere fejllog fra Archy** — Archy-fejlmeddelelser i systemloggen viser nu kun den relevante fejltekst (Command, fejlbeskrivelse, YAML-fil, fejltype). Al dekorativ output fjernes: banner-linjer, DateTime, Summary-header, Log-sti, versionsopdateringsrammen, "execution complete." og "exit code:".

---
**🇬🇧 English**
- **Cleaner Archy error log** — Archy error messages in the system log now show only the relevant error text (Command, error description, YAML file, error type). All decorative output is stripped: banner lines, DateTime, Summary header, Log path, version update box, "execution complete." and "exit code:".

### v1.4.1
---
**🇩🇰 Dansk**
- **Versionsnummer rettet i navigation** — Navigationen viste `v1.3.9` i stedet for `v1.4.0`.
- **Flow YAML Builder → Ekstra: YAML-bibliotek** — Nyt felt i trin 3 (Ekstra) hvor man kan indsætte rå YAML-blokke fra sit bibliotek (IVR-menuer, Schedule-grupper, reusable tasks m.m.). Blokkene tilføjes direkte efter det genererede YAML.
- **Flow YAML Builder → Kunden følger med til Import** — Kunden valgt i Wizard pre-selektes nu automatisk på Import-siden, så man slipper for at vælge igen.

---
**🇬🇧 English**
- **Version number corrected in navigation** — Navigation was showing `v1.3.9` instead of `v1.4.0`.
- **Flow YAML Builder → Extra: YAML library** — New field in step 3 (Extra) to paste raw YAML blocks from your library (IVR menus, Schedule groups, reusable tasks etc.). Blocks are appended directly after the generated YAML.
- **Flow YAML Builder → Customer carries over to Import** — The customer selected in the Wizard is now automatically pre-selected on the Import page, so you don't have to pick it again.

### v1.4.0
---
**🇩🇰 Dansk**
- **Drag-and-drop på Import-siden** — YAML-filer kan nu slippes direkte på siden (ikke kun via "Vælg fil"-knappen).

---
**🇬🇧 English**
- **Drag-and-drop on Import page** — YAML files can now be dropped directly onto the page (not only via the "Choose file" button).

### v1.3.9
---
**🇩🇰 Dansk**
- **Rettighedstjek ved forbindelsestest** — Testkontappen tjekker nu om OAuth-klienten har tilladelsen `oauth:client:view` og `architect:flow:view`.

---
**🇬🇧 English**
- **Permission check on connection test** — The test endpoint now verifies `oauth:client:view` and `architect:flow:view` permissions.

### v1.3.8
---
**🇩🇰 Dansk**
- **Migrate flow-valg forbedret** — Rettet bug hvor valgte flows ikke viste sig markerede. Pub-version og Draft-version vises tydeligt adskilt. Nyt type-filter dropdown.

---
**🇬🇧 English**
- **Migrate flow selection improved** — Fixed bug where selected flows didn't appear highlighted. Published and Draft versions shown distinctly. New type filter dropdown.

### v1.3.7
---
**🇩🇰 Dansk**
- **Manuel opdateringstjek** — Ny "🔍 Tjek for opdatering"-knap på README-siden.
- **Auth-status på Migrate-siden** — Kilde og mål viser nu om org'en er klar (grøn/gul/rød dot).

---
**🇬🇧 English**
- **Manual update check** — New "🔍 Check for updates" button on the README page.
- **Auth status on Migrate page** — Source and target show org readiness (green/yellow/red dot).

### v1.3.6
---
**🇩🇰 Dansk**
- **Versionstjek** — Serveren henter `package.json` fra GitHub ved opstart og viser gul banner ved ny version.

---
**🇬🇧 English**
- **Version check** — On startup the server fetches `package.json` from GitHub and shows a yellow banner if a newer version exists.

### v1.3.0 – v1.3.5
- Systemlog på engelsk, renere output, Flow Builder sprog-support, Prompts-søgning, Data Action schema fix, JSON-tabel detection, "already exists"-håndtering, stop-knap til Export Alle.

### v1.2.0
- Data Actions wizard-sektion, Data Table søgning, Transfer til Flow, `startUpTaskVariables:` support.

---

<a name="dansk"></a>
## 🇩🇰 Dansk

Et grafisk interface til [Archy](https://help.mypurecloud.com/articles/archy/) med multi-kunde support, flow-migration, Data Action migration og OAuth PKCE login.

### Krav
- **Node.js 18+**
- **Archy** installeret og tilgængeligt i PATH (`archy version` skal returnere en version)
- Genesys Cloud OAuth-klient per org (enten Client Credentials eller PKCE Code Authorization)

### Installation

```bash
cd C:\Tools\Archy-gui
npm install
```

### Start

Dobbeltklik på **`start.bat`** — den:
1. Stopper eventuel tidligere instans på port 3737
2. Starter serveren i baggrunden (`server.log` logges)
3. Venter til serveren er klar
4. Åbner automatisk **http://localhost:3737** i browseren

Alternativt manuelt: `node server.js`

---

### Funktioner

#### 🏢 Kunder
Tilføj Genesys Cloud orgs med to auth-typer:

| Auth-type | Hvornår | Hvad gemmes |
|---|---|---|
| **🔑 Client Credentials** | Scripts/automation | Client ID + Secret i `customers.json` |
| **🌐 OAuth PKCE** | Personligt login | Kun Client ID — token i hukommelse |

#### 📋 Flow Browser
Hent, søg og filtrer flows. Klik **Export** direkte fra listen.

#### 🔄 Migrer Flow
Fuldt automatisk flow-migration: vælg kilde, mål og flows → Archy eksporterer og importerer automatisk.

#### 📤 Export YAML
Eksporter ét flow eller hele org'en med live fremgangsindikator.

#### 📥 Import YAML
- Indsæt YAML manuelt, upload `.yaml`-fil eller drag-and-drop
- **🔍 Valider YAML** — syntax-tjek i browseren (ingen API-kald)
- **🌐 Tjek mod org** — tjekker om alle ressourcer (division, køer, DataTables, Data Actions, Prompts) eksisterer i mål-org'en *inden* import

#### ⚡ Data Actions
Ny side til at migrere Data Actions mellem orgs:
1. Vælg **kilde-org** → alle Data Actions listes med kategori-filter og søgning
2. Vælg **mål-org** → tilgængelige Genesys Cloud Data Actions integrationer vises
3. Markér de actions du vil kopiere → klik **⚡ Migrér valgte**
4. Loggen viser: ✓ Oprettet og publiceret / ⚠ Allerede eksisterer / ✗ Fejl

Der kopieres navn, kategori, input/output-schema, request-config (URL, metode, headers) samt request- og success-templates. Templates hentes fra kilden og indsættes direkte i den nye action, så den ikke refererer tilbage til kilde-orgen.
<img width="1436" height="634" alt="image" src="https://github.com/user-attachments/assets/e40b45d0-1322-430e-9d5e-28d0adda83e5" />

> **Bemærk:** Kategori-navne skal matche mellem orgs. Hvis kilden bruger `Genesys Cloud Data Actions - QM` men målet kun har `Genesys Cloud Data Actions`, skal du enten omdøbe integrationen i mål-org'en eller justere YAML'en før import.

#### 🧙 Flow Builder
Wizard til at bygge Archy YAML trin for trin uden at skrive YAML i hånden. Understøtter alle 16 flow-typer, Data Tables, Data Actions med schema-hentning, og transfer/disconnect-handling.

#### 🗂 YAML Filer
Se og preview lokalt gemte YAML-filer. Send direkte til Import-siden.

#### 📋 Systemlog
Alle handlinger logges i realtid. Filtrer på niveau, handling, kunde og fritekst.
<img width="1439" height="547" alt="image" src="https://github.com/user-attachments/assets/4d994a59-70b6-4886-be82-54876ff61193" />

---

### Temaer og sprog

Begge vælges i topbaren og gemmes i browserens `localStorage`, så valget huskes til næste gang.

| Tema | Beskrivelse |
|---|---|
| 🌙 Archy Dark | Standard — mørk med orange accent |
| ☀️ Archy Light | Lys med orange accent |
| 🔷 Sabio Dark | Sabio-brand: navy `#0F096B` med gul `#F7D501` |
| 🔹 Sabio Light | Sabio-brand: off-white med lilla `#6518BB` |

Sabio-temaerne viser Sabios ordmærke i topbaren i stedet for "ArchyGUI" og bruger brandets skarpe hjørner.

Sprog: 🇩🇰 Dansk · 🇬🇧 English · 🇫🇷 Français · 🇳🇱 Nederlands · 🇪🇸 Español.
Tekniske betegnelser oversættes ikke — flow-typer (`InboundCall`, `Workflow` …), regionsnavne, logniveauer (`INFO`, `ERROR` …) og Genesys-kategorinavne vises som i API'et.

---

### Regioner

| Org | Region-værdi |
|-----|--------------|
| EU Frankfurt | `mypurecloud.de` |
| US East | `mypurecloud.com` |
| EU Ireland | `mypurecloud.ie` |
| AP Sydney | `mypurecloud.com.au` |
| AP Tokyo | `mypurecloud.jp` |
| US West | `usw2.pure.cloud` |
| EU London | `euw2.pure.cloud` |
| Canada | `cac1.pure.cloud` |

### Sikkerhed
- Client Secrets vises aldrig i GUI efter gemning
- OAuth PKCE: ingen secret gemmes — token lever kun i serverens hukommelse
- Serveren er kun tilgængelig på `localhost`

### Filer
```
Archy-gui/
├── server.js          # Express backend
├── start.bat          # Start server + åbn browser
├── customers.json     # Kunder (auto-genereret)
├── server.log         # Server-output
├── flows/             # Lokale YAML-filer
│   └── <kundenavn>/
│       └── *.yaml
├── public/
│   └── index.html     # Frontend SPA
└── package.json
```

---

<a name="english"></a>
## 🇬🇧 English

A graphical interface for [Archy](https://help.mypurecloud.com/articles/archy/) with multi-customer support, flow migration, Data Action migration, and OAuth PKCE login.

> Current version: **v1.6.0** — see [Changelog](#changelog) above.

### Requirements
- **Node.js 18+**
- **Archy** installed and available in PATH
- A Genesys Cloud OAuth client per org (Client Credentials or PKCE Code Authorization)

### Installation

```bash
cd C:\Tools\Archy-gui
npm install
```

### Starting the app

Double-click **`start.bat`** or run `node server.js` manually.

---

### Features

#### 🏢 Customers
Add Genesys Cloud orgs with Client Credentials or OAuth PKCE.

#### 📋 Flow Browser
Fetch, search and filter flows. Click **Export** directly from the list.

#### 🔄 Migrate Flow
Fully automated flow migration: select source, target and flows → Archy exports and imports automatically.

#### 📤 Export YAML
Export a single flow or an entire org with live progress indicator.

#### 📥 Import YAML
- Paste YAML, upload a `.yaml` file, or drag-and-drop
- **🔍 Validate YAML** — browser-side syntax check (no API call)
- **🌐 Check against org** — verifies that all resources referenced in the YAML (division, queues, DataTables, Data Actions, Prompts) exist in the target org *before* importing

#### ⚡ Data Actions
New page to migrate Data Actions between orgs:
1. Select **source org** → all Data Actions listed with category filter and search
2. Select **target org** → available Genesys Cloud Data Actions integrations shown
3. Select the actions to copy → click **⚡ Migrate selected**
4. Log shows: ✓ Created and published / ⚠ Already exists / ✗ Error

Name, category, input/output schema, request config (URL, method, headers) and the request/success templates are copied. Templates are fetched from the source and inlined into the new action, so it never references the source org.

> **Note:** Category names must match between orgs. If the source uses `Genesys Cloud Data Actions - QM` but the target only has `Genesys Cloud Data Actions`, either rename the integration in the target org or adjust the category in your YAML before importing.

#### 🧙 Flow Builder
Step-by-step wizard to build Archy YAML without writing it by hand. Supports all 16 flow types, Data Tables, Data Actions with schema fetching, and transfer/disconnect handling.

#### 🗂 YAML Files
View and preview locally saved YAML files. Send directly to the Import page.

#### 📋 System Log
All actions logged in real time. Filter by level, action type, customer, and free text.

---

### Themes and languages

Both are chosen in the top bar and stored in the browser's `localStorage`, so your choice is remembered.

| Theme | Description |
|---|---|
| 🌙 Archy Dark | Default — dark with orange accent |
| ☀️ Archy Light | Light with orange accent |
| 🔷 Sabio Dark | Sabio brand: navy `#0F096B` with yellow `#F7D501` |
| 🔹 Sabio Light | Sabio brand: off-white with purple `#6518BB` |

The Sabio themes show the Sabio wordmark in the top bar instead of "ArchyGUI" and use the brand's square corners.

Languages: 🇩🇰 Dansk · 🇬🇧 English · 🇫🇷 Français · 🇳🇱 Nederlands · 🇪🇸 Español.
Technical identifiers are not translated — flow types (`InboundCall`, `Workflow` …), region names, log levels (`INFO`, `ERROR` …) and Genesys category names appear exactly as the API returns them.

---

### Regions

| Org | Region value |
|-----|--------------|
| EU Frankfurt | `mypurecloud.de` |
| US East | `mypurecloud.com` |
| EU Ireland | `mypurecloud.ie` |
| AP Sydney | `mypurecloud.com.au` |
| AP Tokyo | `mypurecloud.jp` |
| US West | `usw2.pure.cloud` |
| EU London | `euw2.pure.cloud` |
| Canada | `cac1.pure.cloud` |

### Security
- Client Secrets never shown in the GUI after saving
- OAuth PKCE: no secret stored — token lives only in server memory
- Server only listens on `localhost`

### File structure
```
Archy-gui/
├── server.js          # Express backend
├── start.bat          # Start server + open browser
├── customers.json     # Customer data (auto-generated)
├── server.log         # Server output
├── flows/             # Local YAML files per customer
│   └── <customername>/
│       └── *.yaml
├── public/
│   └── index.html     # Frontend SPA
└── package.json
```
