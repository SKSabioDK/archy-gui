# Archy GUI — Flow Manager · v1.3.8

> 🇩🇰 [Dansk](#dansk) · 🇬🇧 [English](#english)

---

## Changelog

### v1.3.8
---
**🇩🇰 Dansk**
- **Migrate flow-valg forbedret** — Rettet bug hvor valgte flows ikke viste sig markerede (forkert nøgle i Set). Pub-version og Draft-version vises nu tydeligt adskilt. Nyt type-filter dropdown. Tæller viser antal valgte flows. "Vælg alle" og "Nulstil valg"-links.

---
**🇬🇧 English**
- **Migrate flow selection improved** — Fixed bug where selected flows didn't appear highlighted (wrong key in Set). Published and Draft versions now shown distinctly. New type filter dropdown. Counter shows number of selected flows. "Select all" and "Clear selection" links.

### v1.3.7
---
**🇩🇰 Dansk**
- **Manuel opdateringstjek** — Ny "🔍 Tjek for opdatering"-knap på README-siden ved siden af Genindlæs-knappen. Kalder serveren direkte og viser resultatet øjeblikkeligt — man behøver ikke vente op til 24 timer på det automatiske tjek.
- **Auth-status på Migrate-siden** — Kilde og mål viser nu om org'en er klar (grøn dot = forbundet/Client Credentials, gul = session udløbet, rød = ikke logget ind). Inkluderer ↺-knap til at re-checke efter PKCE-login.

---
**🇬🇧 English**
- **Manual update check** — New "🔍 Check for updates" button on the README page next to the Reload button. Triggers a server-side check immediately — no need to wait up to 24 hours for the automatic check.
- **Auth status on Migrate page** — Source and target now show whether the org is ready (green dot = connected/Client Credentials, yellow = session expired, red = not logged in). Includes ↺ button to re-check after PKCE login.

### v1.3.6
---
**🇩🇰 Dansk**
- **Versionstjek** — Serveren henter `package.json` fra GitHub ved opstart (og én gang i døgnet). Hvis der er en nyere version, vises en gul banner øverst i indholdsområdet med link til GitHub Releases. Banneret oversættes til valgt sprog og forsvinder ved klik på ✕.

---
**🇬🇧 English**
- **Version check** — On startup (and once every 24 hours) the server fetches `package.json` from GitHub. If a newer version exists, a yellow banner appears at the top of the main area with a link to GitHub Releases. The banner is translated to the selected language and can be dismissed with ✕.

### v1.3.5
---
**🇩🇰 Dansk**
- **Systemlog på engelsk** — Alle serverlog-beskeder (`addLog`) er oversat til engelsk, så systemloggen altid er læsbar uanset valgt sprog.

---
**🇬🇧 English**
- **System log in English** — All server-side log messages (`addLog`) are now in English so the system log is always readable regardless of the selected language.

### v1.3.4
---
**🇩🇰 Dansk**
- **Flow Builder: Sprogunderstøttelse** — Alle tekster i wizard-dialogen skifter nu sprog når brugeren ændrer sprog. Alle 5 sprog understøttes (da/en/fr/nl/es).
- **Prompts-søgning** — Trin 3 (Afslutning/Transfer) og initial audio kan nu bruge Genesys Cloud architect-prompts i stedet for TTS. Søg og vælg prompt via datalist.
- **YAML-fejl i Data Action fikset** — `successOutputs` genererede `noValue: true` for ubrugte outputs, hvilket fik Archy til at fejle (exit 100). Nu emitteres kun outputs der faktisk er aktiveret med en variabel.

---
**🇬🇧 English**
- **Flow Builder: Language support** — All wizard dialog texts now switch language when the user changes the language. All 5 languages supported (da/en/fr/nl/es).
- **Prompt search** — Step 3 (End/Transfer) and initial audio can now use Genesys Cloud architect prompts instead of TTS. Search and select a prompt via a datalist.
- **YAML bug in Data Action fixed** — `successOutputs` was generating `noValue: true` for unused outputs, causing Archy to fail (exit 100). Now only outputs that are actually enabled with a variable are emitted.

### v1.3.3
- **Spansk sprogunderstøttelse** — 🇪🇸 Español tilføjet som femte sprog i sprogselectoren.
- **Engelsk changelog** — Alle changelog-poster oversat til engelsk.

---
**🇩🇰 Dansk**

### v1.3.2
- **Stop-knap til Export Alle Flows** — ny ⏹ Stop-knap stopper eksporten efter det igangværende flow. Allerede eksporterede filer bevares. Server sætter `job.cancelled = true`; loop checker flaget før hvert flow.

### v1.3.1
- **Forbindelsestest fikset for Client Credentials** — brugte `/users/me` (kræver bruger-token), skiftet til `/organizations/me` som virker med alle token-typer. PKCE bruger stadig `/users/me`.

### v1.3.0
- **Flow Builder: JSON tabel-checkbox** — Hvert datatabel-kort har nu en eksplicit "JSON tabel"-afkrydsning (standard: markeret). Brugeren kan altid overstyre automatisk-detection uanset hvad serveren returnerer.
- **Datatabel-søgning fikset** — Hvert tabelkort har nu sit eget unikke datalist-id (`wiz-dt-datalist-${i}`); søgning filtreres client-side ligesom data actions.
- **Data Action schema fikset** — Skift fra de ikke-fungerende `/schemas/input|output` endpoints til `GET /integrations/actions/{id}?expand=contract`, som altid returnerer input/output-skema.
- **`isJsonTable`-detection forbedret** — Serveren detekterer nu JSON-tabeller via `Value`-kolonne (ikke kun kolonne-antal), og returnerer `columns: []` for JSON-tabeller for at undgå fejlagtig auto-udfyldning.
- **Import: "already exists"-fejl** — Archy exit 108 detekteres og viser en knap: "🔄 Skift til Update og prøv igen".
- **Flow Builder: badges og hints** — Tabelkort viser "JSON tabel" / "Multi-kolonne" badge i headeren og en vejledende hjælpetekst i feltsektionen.

### v1.2.0
- Data Actions wizard-sektion (input/output schema, auto-variabelnavne)
- Data Table søgning og nøgle-kolonne hint
- Transfer til Flow med type-filter
- Farvel-TTS valgfri checkbox
- `startUpTaskVariables:` support for inqueueCall

---
**🇬🇧 English**

### v1.3.2
- **Stop button for Export All Flows** — new ⏹ Stop button halts the export after the current flow finishes. Already-exported files are preserved. The server sets `job.cancelled = true`; the loop checks the flag before each flow.

### v1.3.1
- **Connection test fixed for Client Credentials** — was calling `/users/me` (requires a user token); switched to `/organizations/me` which works with all token types. PKCE still uses `/users/me`.

### v1.3.0
- **Flow Builder: JSON table checkbox** — each data-table card now has an explicit "JSON table" checkbox (default: checked). The user can always override the automatic detection regardless of what the server returns.
- **Data table search fixed** — each table card now has its own unique datalist ID (`wiz-dt-datalist-${i}`); search is filtered client-side, just like data actions.
- **Data Action schema fixed** — switched from the non-working `/schemas/input|output` endpoints to `GET /integrations/actions/{id}?expand=contract`, which always returns the input/output schema.
- **`isJsonTable` detection improved** — the server now detects JSON tables via the `Value` column (not just column count), and returns `columns: []` for JSON tables to prevent incorrect auto-population.
- **Import: "already exists" error** — Archy exit code 108 is detected and shows a button: "🔄 Switch to Update and try again".
- **Flow Builder: badges and hints** — table cards show a "JSON table" / "Multi-column" badge in the header and a guiding help text in the field section.

### v1.2.0
- Data Actions wizard section (input/output schema, auto-generated variable names)
- Data Table search and key-column hint
- Transfer to Flow with type filter
- Goodbye TTS optional checkbox
- `startUpTaskVariables:` support for inqueueCall

---

<a name="dansk"></a>
## 🇩🇰 Dansk

Et grafisk interface til [Archy](https://help.mypurecloud.com/articles/archy/) med multi-kunde support, flow-migration og OAuth PKCE login.

### Krav
- **Node.js 18+**
- **Archy** installeret og tilgængeligt i PATH (`archy version` skal returnere en version)
- Genesys Cloud OAuth-klient per org (enten Client Credentials eller PKCE Code Authorization)

### Installation

```bash
# Kopier mappen til din maskine, f.eks. C:\Tools\Archy-gui
cd C:\Tools\Archy-gui

# Installer afhængigheder
npm install
```

### Start

Dobbeltklik på **`start.bat`** — den:
1. Stopper eventuel tidligere instans på port 3737
2. Starter serveren i baggrunden (`server.log` logges)
3. Venter til serveren er klar
4. Åbner automatisk **http://localhost:3737** i browseren
5. Holder vinduet åbent (luk vinduet for at stoppe serveren)

Alternativt manuelt:
```bash
node server.js
```

### Versionstjek

Archy GUI tjekker automatisk om der er en nyere version tilgængelig. Checket bruger `git fetch` + `git show` direkte, så ingen token eller GitHub API-adgang er nødvendig — git er allerede autentificeret på maskinen via den normale git-opsætning.

---

### Funktioner

#### 🏢 Kunder
Tilføj Genesys Cloud orgs med to auth-typer:

| Auth-type | Hvornår | Hvad gemmes |
|---|---|---|
| **🔑 Client Credentials** | Scripts/automation, service-konti | Client ID + Secret lokalt i `customers.json` |
| **🌐 OAuth PKCE** | Personligt login, ingen secret på disk | Kun Client ID — token i hukommelse |

- Test forbindelsen live (kalder `/users/me`)
- Slet kunder når de ikke længere er nødvendige

#### OAuth PKCE Login
1. Tilføj en kunde med **🌐 OAuth (PKCE)** — angiv kun Client ID og Region (ingen secret)
2. Klik **🔑 Login** på kundekortet
3. Et Genesys Cloud login-vindue åbnes — log ind med dit normale brugernavn/kodeord
4. Vinduet lukker automatisk, og kortet viser **🟢 Forbundet**
5. Token gemmes kun i serverens hukommelse — forsvinder ved server-genstart

> **Bemærk:** OAuth-klienten i Genesys Cloud skal have:
> - Grant type: **Code Authorization** (PKCE)
> - Redirect URI: `http://localhost:3737/auth/callback`
>
> **Implicit Grant er forældet** af Genesys ([se annoncering](https://help.genesys.cloud/announcements/deprecation-token-implicit-grant-browser-option-for-oauth-authorization/)) — brug PKCE.

#### 📋 Flow Browser
- Hent alle flows i en org via Genesys Cloud API
- Søg og filtrer i realtid
- Klik **Export** direkte fra listen → prefylder Export-siden

#### 🔄 Migrer Flow
Fuldt automatisk migration i 3 trin:
1. Vælg kilde-org og mål-org
2. Vælg ét eller flere flows (multi-select med søgning)
3. Vælg handling (`create` / `update` / `publish`) og kør

Archy eksporterer fra kilden og importerer til målet automatisk.

#### 📤 Export YAML
- Eksporter ét flow som YAML via Archy
- Vis YAML direkte i browseren og download som `.yaml`-fil
- **Export Alle Flows** — eksporterer hele org'en med live fremgangsindikator og tæller (f.eks. `42 / 111`)

Eksporterede filer gemmes i `flows/<kundenavn>/`.

#### 📥 Import YAML
- Indsæt YAML manuelt eller upload `.yaml`-fil
- Vælg mål-kunde og handling (`create` / `update` / `publish`)

#### 🧙 Flow Builder
Wizard til at bygge et nyt Archy YAML-flow trin for trin uden at skrive YAML i hånden:
1. **Flow-type & navn** — alle 16 flow-typer understøttes: `inboundCall`, `inboundShortMessage`, `inboundEmail`, `inboundChat`, `outboundCall`, `botFlow`, `digitalBot`, `commonModule`, `inqueueCall`, `inqueueEmail`, `inqueueShortMessage`, `secureCall`, `voicemail`, `workflow`, `voiceSurvey`, `surveyInvite`
2. **Data Tables & Data Actions** — tilføj opslag og action-kald:
   - **📊 Data Tables** — tabelnavn hentes fra org'en (autocomplete); nøgle-kolonnen vises automatisk som hint i Lookup-feltet; JSON-tabeller (én Value-kolonne) og multi-kolonne tabeller detekteres automatisk og genererer forskellig YAML
   - **⚡ Data Actions** — alle data actions hentes fra org'en ved valg af kunde; vælg action → input/output-skema hentes automatisk; inputs kan sættes som literal eller variabel; outputs markeres med flueben og variabelnavne auto-genereres (s_, i_, b_ etc.); understøtter actions fra flere OAuth-integrationer
3. **Afslutning / Transfer** — valgfri overførsels- eller afslutningshandling med søgning direkte fra org'en:
   - `Disconnect` — afslut opkald
   - `Transfer to ACD` — kø-søgning
   - `Transfer to User` — bruger-søgning
   - `Transfer to Group` — gruppe-søgning
   - `Transfer to Flow` — flow-søgning (filtreret til samme flow-type)
   - `Transfer to Number` — telefonnummer
4. Generer færdig YAML og send direkte til Import-siden

#### 🗂 YAML Filer
- Se alle lokalt gemte YAML-filer
- Preview fil-indhold i ny fane
- Send direkte til Import-siden

#### 📋 Systemlog
- Alle handlinger, forbindelser og fejl logges i realtid
- Filtrer på niveau (INFO/SUCCESS/WARN/ERROR), handling, kunde og fritekst
- Hurtig-valg for tidsperioder (15 min, 1 time, i dag)
- Auto-opdater hvert 5. sekund
- Statistik-bjælke med totaler per niveau

#### 🌗 Tema & Sprog
- Mørk/lys tilstand — gemmes i `localStorage`
- Sprog: 🇩🇰 Dansk · 🇬🇧 English · 🇫🇷 Français · 🇳🇱 Nederlands — gemmes i `localStorage`

---

### Regions

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
- **Client Credentials**: Gemmes krypteret i `customers.json` — brug kun på betroet/lokal maskine
- **OAuth PKCE**: Ingen secret gemmes overhovedet — token lever kun i serverens hukommelse
- Client Secrets vises aldrig i GUI efter de er gemt
- Serveren er kun tilgængelig på `localhost` — eksponér ikke eksternt

### Filer
```
Archy-gui/
├── server.js          # Express backend (API + OAuth PKCE callback)
├── start.bat          # Start server + åbn browser automatisk
├── customers.json     # Kunder (genereres automatisk)
├── server.log         # Server-output (genereres af start.bat)
├── flows/             # Lokale YAML-filer pr. kunde (genereres automatisk)
│   └── <kundenavn>/
│       └── *.yaml
├── public/
│   └── index.html     # Frontend SPA (alle sider, i18n, tema)
└── package.json
```

---
---

<a name="english"></a>
## 🇬🇧 English

A graphical interface for [Archy](https://help.mypurecloud.com/articles/archy/) with multi-customer support, flow migration, and OAuth PKCE login.

> Current version: **v1.3.8** — see [Changelog](#changelog) above.

### Requirements
- **Node.js 18+**
- **Archy** installed and available in PATH (`archy version` should return a version)
- A Genesys Cloud OAuth client per org (either Client Credentials or PKCE Code Authorization)

### Installation

```bash
# Copy the folder to your machine, e.g. C:\Tools\Archy-gui
cd C:\Tools\Archy-gui

# Install dependencies
npm install
```

### Starting the app

Double-click **`start.bat`** — it will:
1. Kill any existing instance on port 3737
2. Start the server in the background (output logged to `server.log`)
3. Wait until the server is ready
4. Automatically open **http://localhost:3737** in the browser
5. Keep the window open (close it to stop the server)

Alternatively, run manually:
```bash
node server.js
```

### Version check

Archy GUI automatically checks whether a newer version is available. The check uses `git fetch` + `git show` directly — no token or GitHub API access needed. Git is already authenticated on the machine via the normal git setup.

---

### Features

#### 🏢 Customers
Add Genesys Cloud orgs with two authentication types:

| Auth type | When to use | What is stored |
|---|---|---|
| **🔑 Client Credentials** | Scripts/automation, service accounts | Client ID + Secret locally in `customers.json` |
| **🌐 OAuth PKCE** | Personal login, no secret on disk | Client ID only — token in memory |

- Test the connection live (calls `/users/me`)
- Delete customers when no longer needed

#### OAuth PKCE Login
1. Add a customer with **🌐 OAuth (PKCE)** — provide only Client ID and Region (no secret needed)
2. Click **🔑 Login** on the customer card
3. A Genesys Cloud login window opens — log in with your normal username/password
4. The window closes automatically and the card shows **🟢 Connected**
5. The token is stored only in server memory — it disappears when the server restarts

> **Note:** The OAuth client in Genesys Cloud must have:
> - Grant type: **Code Authorization** (PKCE)
> - Redirect URI: `http://localhost:3737/auth/callback`
>
> **Implicit Grant is deprecated** by Genesys ([see announcement](https://help.genesys.cloud/announcements/deprecation-token-implicit-grant-browser-option-for-oauth-authorization/)) — use PKCE instead.

#### 📋 Flow Browser
- Fetch all flows in an org via the Genesys Cloud API
- Search and filter in real time
- Click **Export** directly from the list → pre-fills the Export page

#### 🔄 Migrate Flow
Fully automated migration in 3 steps:
1. Select source org and target org
2. Select one or more flows (multi-select with search)
3. Choose action (`create` / `update` / `publish`) and run

Archy exports from the source and imports to the target automatically.

#### 📤 Export YAML
- Export a single flow as YAML via Archy
- View YAML directly in the browser and download as a `.yaml` file
- **Export All Flows** — exports an entire org with a live progress bar and counter (e.g. `42 / 111`)

Exported files are saved to `flows/<customername>/`.

#### 📥 Import YAML
- Paste YAML manually or upload a `.yaml` file
- Select target customer and action (`create` / `update` / `publish`)

#### 🧙 Flow Builder
A step-by-step wizard to create a new Archy YAML flow without writing YAML by hand:
1. **Flow type & name** — all 16 flow types supported: `inboundCall`, `inboundShortMessage`, `inboundEmail`, `inboundChat`, `outboundCall`, `botFlow`, `digitalBot`, `commonModule`, `inqueueCall`, `inqueueEmail`, `inqueueShortMessage`, `secureCall`, `voicemail`, `workflow`, `voiceSurvey`, `surveyInvite`
2. **Data Tables & Data Actions** — add lookups and action calls:
   - **📊 Data Tables** — table names fetched from the org (autocomplete); key column is shown automatically as a hint in the Lookup field; JSON tables (single Value column) and multi-column tables are auto-detected and generate different YAML
   - **⚡ Data Actions** — all data actions fetched from the org when a customer is selected; choose an action → input/output schema is fetched automatically; inputs can be set as literal or variable; outputs are opt-in with auto-generated variable names (s_, i_, b_ etc.); supports actions from multiple OAuth integrations
3. **End / Transfer** — optional transfer or end action with live search from the org:
   - `Disconnect` — end the call
   - `Transfer to ACD` — queue search
   - `Transfer to User` — user search
   - `Transfer to Group` — group search
   - `Transfer to Flow` — flow search (filtered to the same flow type)
   - `Transfer to Number` — phone number
4. Generate the finished YAML and send it directly to the Import page

#### 🗂 YAML Files
- View all locally saved YAML files
- Preview file contents in a new tab
- Send directly to the Import page

#### 📋 System Log
- All actions, connections and errors are logged in real time
- Filter by level (INFO/SUCCESS/WARN/ERROR), action type, customer and free-text
- Quick time selectors (15 min, 1 hour, today)
- Auto-refresh every 5 seconds
- Stats bar showing totals per level

#### 🌗 Theme & Language
- Dark/light mode toggle — preference saved in `localStorage`
- Languages: 🇩🇰 Dansk · 🇬🇧 English · 🇫🇷 Français · 🇳🇱 Nederlands — saved in `localStorage`

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
- **Client Credentials**: Stored in `customers.json` — use only on a trusted/local machine
- **OAuth PKCE**: No secret is stored at all — the token lives only in server memory
- Client Secrets are never shown in the GUI after being saved
- The server only listens on `localhost` — do not expose externally

### File structure
```
Archy-gui/
├── server.js          # Express backend (API + OAuth PKCE callback)
├── start.bat          # Start server + open browser automatically
├── customers.json     # Customer data (auto-generated)
├── server.log         # Server output (generated by start.bat)
├── flows/             # Local YAML files per customer (auto-generated)
│   └── <customername>/
│       └── *.yaml
├── public/
│   └── index.html     # Frontend SPA (all pages, i18n, theming)
└── package.json
```
