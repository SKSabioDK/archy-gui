# Archy GUI — Flow Manager · v1.32.0

> 🇩🇰 [Dansk](#dansk) · 🇬🇧 [English](#english)

---

## Changelog

Alle ændringer står i **[CHANGELOG.md](CHANGELOG.md)** — nuværende version er **v1.32.0**.
All changes live in **[CHANGELOG.md](CHANGELOG.md)** — the current version is **v1.32.0**.

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

**Kunde → gruppe → miljø.** Én post er ét *miljø*. To niveauer ovenover afgør hvad der må migreres indbyrdes:

```
Vattenfall            Kunde 2 A/S
├── DE   test → prod  └── Norden   dev → test → uat → prod
└── SE   test → prod
```

**Gruppen er pipelinen** — om den hedder et land eller et firma er kun en etiket. Hvert miljø får et trin fra `dev → test → uat → prod`. Har en kunde kun én gruppe, skjules valget.

**Præfiks: flere miljøer i den samme org.** Nogle kunder har ikke én org pr. miljø, men **én org hvor miljøerne kendes på et præfiks**:

| Miljø | Præfiks | Flow hedder | Manifesttabel |
|---|---|---|---|
| dev | `DEV_` | `DEV_Ordreflow` | `DEV_ArchyGUI_Manifest` |
| test | `TEST_` | `TEST_Ordreflow` | `TEST_ArchyGUI_Manifest` |
| uat | `UAT_` | `UAT_Ordreflow` | `UAT_ArchyGUI_Manifest` |
| prod | *(tomt)* | `Ordreflow` | `ArchyGUI_Manifest` |

Opret ét miljø pr. præfiks med **samme credentials**. Programmet ser at de deler org, henter flowlisten én gang og deler den. Prod uden præfiks tager alt der **ikke** bærer et søskendepræfiks — ellers ville prod se hele orgen.

> **Præfikset skal ramme præcist.** Et flow der hedder `DEV Noget` med mellemrum i stedet for `DEV_Noget` hører til prod, ikke dev.

**Org-navn** er kun en etiket til overskriften på pipelinen, så man kan se hvilke miljøer der bor i samme org.

**Demo-kunder.** To knapper opretter et komplet opsæt der kun findes lokalt — ingen credentials, ingen kald til Genesys eller Archy:

| Demo | Opsæt |
|---|---|
| **Demo 1** | fire orgs, ét miljø i hver |
| **Demo 2** | `DEV_`, `TEST_`, `UAT_` deler én org; prod har sin egen og intet præfiks |

Begge kan være oprettet samtidig. `↺ Nulstil` sætter tilbage, `✕ Fjern` sletter miljøer, flows og manifestlinjer.

#### 📋 Flow Browser
Hent, søg og filtrer flows. Filtrér på **flowtype** (listen fyldes ud fra de typer org'en faktisk har, med antal pr. type) og på fritekst. Klik **Export** direkte fra listen.

**🚀 Publicér.** Flows der er migreret med handlingen `create` ligger som checked-in draft uden at være i drift. De får en **Publicér**-knap der publicerer den version der allerede er i org'en — uden at hente noget fra kilden igen. Flows der er tjekket ud af en bruger vises som **Udtjekket** i versionskolonnen.

**⇄ Sammenlign to orgs.** Vælg en org i *Sammenlign mod org*, og hver række får en ⇄-knap. Den eksporterer flowet fra begge orgs og sammenligner **indholdet** — ikke versionsnumrene, som er per-org tællere og intet siger om hvad flowet indeholder.

| Udfald | Betydning |
|---|---|
| ✓ Identisk indhold | Samme flow, uanset at der står fx v37 og v1 |
| ⚠ N forskelle | De første vises linje for linje |
| ⚠ Findes ikke i mål-org'en | Flowet mangler helt |

Dialogen viser desuden hvornår hver side sidst blev **publiceret** og af hvem, og — hvis flowet er migreret med dette værktøj — hvilken org og hvilken kildeversion målet er bygget af.

**📌 Sæt nulpunkt.** Noterer hvordan sammenlignings-org'ens flows ser ud nu. Derefter kan værktøjet fange at nogen har publiceret direkte i mål-org'en, **også for flows det aldrig selv har migreret**. Kør den én gang pr. par af orgs du arbejder med — fx `dev → uat` og `dev → prod` for hver kunde.

> Oplysningerne gemmes i `flows/.migrations.json`, nøglet på Genesys' org-id. **Filen er maskinspecifik og deles ikke** — arbejder I flere på samme kunde, så opret det delte manifest i org'en i stedet (se [Pipeline](#-pipeline)).

#### 🚦 Pipeline
Vælg kunde og gruppe, og få gruppens miljøer som kolonner i trin-rækkefølge med flows som rækker. Miljøer der bor i **samme org** samles under orgens navn.

Hver celle viser flowets **navn i netop det miljø**, dets publicerede udgave og hvornår. Versionstallene kan **ikke** sammenlignes på tværs — de er per-org tællere — så de er kun til orientering.

| Farve / mærke | Betydning |
|---|---|
| grøn | publiceret, og intet tyder på at det kom udenom |
| ✗ **publiceret uden om pipelinen** | manifestet siger vi efterlod miljøet på v*N*, og det står højere. Gælder kun et miljø der *modtog* flowet — arbejde i dev er ikke at gå udenom |
| ✗ **N udgaver foran trinnet før** | miljøet er publiceret flere gange end det trin der fodrer det. Et fingerpeg, ikke bevis |
| ⚠ **N udgaver ikke forfremmet** | der er arbejdet videre uden at skubbe det videre |
| ⚠ **findes kun i et senere trin** | bygget udenom kæden |
| ? **ukendt** | org'en kunne ikke læses — vi ved ikke hvad der er i den |

**Forfremmelse** går ét trin ad gangen og lander på *Migrer Flow* med kilde, mål og flow sat, så afhængighedstjek og divisionsvalg er som ellers. Kun en **publiceret** udgave kan forfremmes — en kladde er ikke testet.

**Navnet bærer sin historik.** Ved forfremmelse får flowet kildens udgave sat på — `Ordreflow` → `Ordreflow_v10` — i **både** kilde og mål. Arbejder man videre i dev og publicerer, bliver navnet stående på `_v10` indtil næste forfremmelse. Så kan man på navnene alene se hvilket trin der er bagud.

**Vejen tilbage.** Findes flowet kun senere i kæden — fx alt hvad der ligger i prod, når dev lige er sat op — får cellen en **⟵ Hent hertil**-knap der henter det fra det nærmeste senere trin. Har miljøet et præfiks, får flowet det på undervejs: `Bank bot` fra prod bliver til `DEV_Bank bot`. Datatabeller behandles på samme måde.

**⇄ Tjek indhold** eksporterer flowet fra hvert miljø og sammenligner hashen — det eneste der kan afgøre om to miljøer er ens. Afviger de, kommer der en **⟵ Hent tilbage**-knap den anden vej, så man kan hente virkeligheden ned og se hvad der blev lavet.

**⭳ Hent som CSV** henter præcis de rækker der vises, med semikolon og UTF-8 BOM så dansk Excel åbner den i kolonner.

**Vagter, håndhævet på serveren:** migrering på tværs af grupper er spærret; prod kræver en bevidst bekræftelse; kilden skal være publiceret; kilde og mål må ikke være samme miljø.

**Delt manifest.** Hvert miljø kan have en datatabel — `ArchyGUI_Manifest`, med præfiks hvis miljøet har et — der beskriver **sig selv**: hvad org'en indeholder, hvornår det kom hertil og hvem der gjorde det. Fordi hver org kun skriver om sig selv, kan to personer på hver sin pc aldrig sige hver sit om samme celle. Tabellen oprettes med en knap, aldrig af sig selv.

> **Ét manifest pr. miljø, ikke pr. org.** Deler flere virtuelle miljøer den samme org, skal hvert af dem have sin egen tabel: `DEV_ArchyGUI_Manifest`, `TEST_ArchyGUI_Manifest`, og `ArchyGUI_Manifest` for prod.
>
> Rækkenøglen er nemlig **grundnavnet uden præfiks** — `WeekNumber|INBOUNDCALL` — så tavlen kan parre `DEV_WeekNumber` og `WeekNumber` som én række. I én fælles tabel ville de to miljøer derfor skrive på samme nøgle og overskrive hinanden, og begge celler ville vise det samme.

#### 🔀 På tværs af kunder
Viser de flows der findes hos **flere kunder** — fx det samme common module i dev, uat og prod. Hver kunde vises med sin version, publiceringstidspunkt og om flowet er aktivt.

Oversigten bygger på ét API-kald pr. kunde og er derfor hurtig. **⇄ Sammenlign indhold** på en række eksporterer flowet fra hver kunde og sammenligner indholds-hashen — det tager tid, så det køres kun for den række du beder om.

> Begge niveauer er nødvendige: to kunder kan stå med samme versionsnummer og alligevel have forskelligt indhold, fordi numrene tælles pr. org.

#### 🔄 Migrer Flow
Vælg kilde, mål og flows. Migreringen kører i to faser:

1. **Tjek** — flowet eksporteres fra kilden, og mål-org'en undersøges for alt flowet refererer til. Der skrives intet til mål-org'en i denne fase.
2. **Import** — først efter dit valg importeres flowet.

Mangler der noget, åbnes en dialog med to sektioner:

| Sektion | Indhold | Handling |
|---|---|---|
| Kan migreres nu | DataTables, Data Actions, **common modules**, bot flows, transfer-mål | Afkrydsning — migreres inden flowet |
| Kræver et valg | **Division** (opret / brug Home / spring over), **survey form** (kopiér / spring over) | Rullemenu pr. ressource |
| Skal oprettes manuelt | Køer, skills, wrap-up-koder, scripts, prompts, schedules, knowledge bases, Function Data Actions | Oprettes i mål-org'en først |

Common modules migreres med samme maskineri som flows, og deres **egne** afhængigheder tages først — rekursivt, nedefra og op. Et modul der selv bruger femten tabeller får dem alle med.

Du kan vælge **Migrér valgte og fortsæt**, **Fortsæt uden** (flowet importeres selvom noget mangler — det fejler typisk i Architect bagefter) eller **Spring flowet over**.

> **Skills der slås op dynamisk kan ikke tjekkes.** Bruger flowet `FindSkill(Task.Skills)`, afgøres skillet først når flowet kører. Dialogen siger det, men du må selv kontrollere at skillene findes i mål-org'en.

Alt hvad der mangler skrives også til **Systemloggen**, så du kan finde det igen bagefter.

#### 📤 Export YAML
Eksporter ét flow eller hele org'en med live fremgangsindikator.

#### 📥 Import YAML
- Indsæt YAML manuelt, upload `.yaml`-fil eller drag-and-drop
- **🔍 Valider YAML** — syntax-tjek i browseren (ingen API-kald)
- **🌐 Tjek mod org** — tjekker om alle ressourcer (division, køer, DataTables, Data Actions, Prompts) eksisterer i mål-org'en *inden* import

#### ⚡ Migrér ressourcer
Siden migrerer det der ikke er flows mellem to orgs, fordelt på tre faner: **Data Actions**, **Data Tabeller** og **User Prompts**. Kilde- og mål-org vælges ét sted og deles af alle tre.

**Fanen Data Actions:**
1. Vælg **kilde-org** og **mål-org**
2. Vælg **kilde-integration** → kun actions fra netop den integration vises
3. **Mål-integrationen** foreslås automatisk — tjek noten over listen
4. Markér de actions du vil kopiere → klik **⚡ Migrér valgte**
5. Loggen viser pr. action: ✓ Oprettet og publiceret / ⚠ Allerede eksisterer / ✗ Fejl, og slutter med en opsummering

> **Hvorfor vælges der integration?** Data Actions hører til en integration, og en org kan have flere af samme type — fx flere OAuth-integrationer der grupperer actions og spreder belastningen. Ved at vælge én ad gangen bevares grupperingen i mål-org'en. Markeringen ryddes automatisk når du skifter integration, så du ikke kommer til at migrere på tværs af grupper.
>
> Mål-integrationen matches på navn, ellers på integrationstype hvis der kun er én kandidat. Er der flere mulige, skal du selv vælge — og migreringen kan ikke startes før du har gjort det.

**Fanen User Prompts** migrerer user prompts mellem orgs. Både TTS-teksten og indtalt lyd kopieres — prompts med lyd er markeret 🔊 i listen.

**Fanen Data Tabeller** migrerer DataTable-*strukturer* mellem orgs: vælg kilde- og mål-org, markér tabellerne, klik **⚡ Migrér valgte**. Kun kolonnedefinitionen kopieres — **rækkerne følger ikke med**. Findes kildens division i mål-org'en, oprettes tabellen der; ellers havner den i standarddivisionen, og loggen siger det.

> **Function Data Actions kan ikke migreres.** Deres `requestUrlTemplate` er ikke en URL, men et ID på en function der ligger i kilde-org'en. Der er ikke noget API til at oprette functionen i mål-org'en, så den skal oprettes manuelt først.

Der kopieres navn, kategori, input/output-schema, request-config (URL, metode, headers) samt request- og success-templates. Templates hentes fra kilden og indsættes direkte i den nye action, så den ikke refererer tilbage til kilde-orgen.
<img width="1436" height="634" alt="image" src="https://github.com/user-attachments/assets/e40b45d0-1322-430e-9d5e-28d0adda83e5" />

> **Bemærk:** Kategori-navne skal matche mellem orgs. Hvis kilden bruger `Genesys Cloud Data Actions - QM` men målet kun har `Genesys Cloud Data Actions`, skal du enten omdøbe integrationen i mål-org'en eller justere YAML'en før import.

#### 🧙 Flow Builder
Wizard til at bygge Archy YAML trin for trin uden at skrive YAML i hånden. Understøtter alle 16 flow-typer, Data Tables, Data Actions med schema-hentning, og transfer/disconnect-handling.

#### 🗂 YAML Filer
Alle flows værktøjet har eksporteret til disk. De havner her fra **Export YAML**, men også fra **migreringer** og **⇄ sammenligninger**, som begge eksporterer undervejs.

Archy navngiver filerne `<Flownavn>_v<major>-<minor>.yaml` — `Test33_v1-0.yaml` er altså flowet *Test33* i version *1.0*. Listen splitter det ad og viser flownavn, version, flowtype, kunde, tidspunkt og størrelse.

Filtrér på **kunde**, **flowtype** og fritekst. **Kun nyeste version** er slået til som standard, så ældre eksporter af samme flow foldes sammen — tælleren viser hvor mange der er skjult.

Hver fil kan åbnes (**View**) eller sendes videre til Import-siden (**Import**).

**🧹 Ryd op** fjerner gamle versioner: vælg hvor mange der skal beholdes pr. flow — 2 som standard, så du kan falde tilbage til en tidligere version — og godkend listen inden noget slettes. Filer uden versionsnummer røres ikke.

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

> Current version: **v1.32.0** — see [Changelog](#changelog) above.

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

**Customer → group → environment.** One record is one *environment*. Two levels above it decide what may be migrated between: the **group is the pipeline**, whether it is named after a country or a company. Each environment gets a stage from `dev → test → uat → prod`. With only one group, the picker is hidden.

**Prefix: several environments in one org.** Some customers do not have one org per environment but **one org where environments are told apart by a prefix**:

| Environment | Prefix | Flow is named | Manifest table |
|---|---|---|---|
| dev | `DEV_` | `DEV_Ordreflow` | `DEV_ArchyGUI_Manifest` |
| test | `TEST_` | `TEST_Ordreflow` | `TEST_ArchyGUI_Manifest` |
| uat | `UAT_` | `UAT_Ordreflow` | `UAT_ArchyGUI_Manifest` |
| prod | *(empty)* | `Ordreflow` | `ArchyGUI_Manifest` |

Create one environment per prefix using the **same credentials**. The app sees that they share an org, fetches the flow list once and shares it. Prod without a prefix takes everything that does **not** carry a sibling prefix — otherwise prod would see the whole org.

> **The prefix must match exactly.** A flow named `DEV Something` with a space instead of `DEV_Something` belongs to prod, not dev.

**Org label** is only a heading on the pipeline, so you can see which environments live in the same org.

**Demo customers.** Two buttons create a complete setup that exists only locally — no credentials, no calls to Genesys or Archy:

| Demo | Setup |
|---|---|
| **Demo 1** | four orgs, one environment each |
| **Demo 2** | `DEV_`, `TEST_`, `UAT_` share one org; prod has its own and no prefix |

Both can exist at once. `↺ Reset` puts them back, `✕ Remove` deletes environments, flows and manifest rows.

#### 📋 Flow Browser
Fetch, search and filter flows. Filter by **flow type** (the list is populated from the types the org actually has, with a count each) and by free text. Click **Export** directly from the list.

**🚀 Publish.** Flows migrated with the `create` action sit as a checked-in draft without being live. They get a **Publish** button that publishes the version already in the org — without fetching anything from the source again. Flows checked out by a user read **Checked out** in the version column.

**⇄ Compare two orgs.** Pick an org under *Compare against org* and each row gets a ⇄ button. It exports the flow from both orgs and compares the **content** — not the version numbers, which are per-org counters and say nothing about what the flow contains.

| Verdict | Meaning |
|---|---|
| ✓ Identical content | The same flow, regardless of it being e.g. v37 and v1 |
| ⚠ N differences | The first ones are shown line by line |
| ⚠ Does not exist in the target org | The flow is missing entirely |

The dialog also shows when each side was last **published** and by whom, and — if the flow was migrated with this tool — which org and which source version the target was built from.

**📌 Set baseline.** Records how the comparison org's flows look right now. From then on the tool can catch someone publishing directly in the target org, **including for flows it never migrated itself**. Run it once per pair of orgs you work with — e.g. `dev → uat` and `dev → prod` for each customer.

> The records live in `flows/.migrations.json`, keyed on the Genesys org id. **The file is machine-specific and is not shared** — if several of you work on the same customer, create the shared manifest in the org instead (see [Pipeline](#-pipeline-1)).

#### 🚦 Pipeline
Pick a customer and group and get the group's environments as columns in stage order, with flows as rows. Environments living in the **same org** are gathered under that org's name.

Each cell shows the flow's **name in that environment**, its published version and when. Version numbers **cannot** be compared across orgs — they are per-org counters — so they are for orientation only.

| Colour / marker | Meaning |
|---|---|
| green | published, with nothing suggesting it arrived out of band |
| ✗ **published outside the pipeline** | the manifest says we left the environment at v*N* and it stands higher. Applies only where the environment *received* the flow — working in dev is not going around anything |
| ✗ **N versions ahead of the previous stage** | published more times than the stage feeding it. An indication, not proof |
| ⚠ **N versions not promoted** | work continued without being pushed onward |
| ⚠ **only exists in a later stage** | built outside the chain |
| ? **unknown** | the org could not be read — we do not know what is in it |

**Promotion** moves one stage at a time and lands on *Migrate Flow* with source, target and flow filled in, so dependency checks and division choices work as usual. Only a **published** version can be promoted — a draft has not been tested.

**The name carries its history.** On promotion the flow gets the source's version stamped on it — `Ordreflow` → `Ordreflow_v10` — in **both** source and target. Keep working in dev and publish, and the name stays at `_v10` until the next promotion. The names alone then show which stage is behind.

**The way back.** If the flow exists only later in the chain — everything sitting in prod, say, when dev has just been set up — the cell gets a **⟵ Bring here** button that fetches it from the nearest later stage. If the environment has a prefix, the flow gets it on the way: `Bank bot` from prod becomes `DEV_Bank bot`. Datatables are handled the same way.

**⇄ Check content** exports the flow from each environment and compares the hash — the only thing that can decide whether two environments are the same. If they differ, a **⟵ Pull back** button appears going the other way, so you can bring reality down and see what was done.

**⭳ Download as CSV** takes exactly the rows shown, semicolon separated with a UTF-8 BOM so Danish Excel opens it in columns.

**Guards, enforced on the server:** migrating across groups is blocked; prod requires a deliberate confirmation; the source must be published; source and target cannot be the same environment.

**Shared manifest.** Each environment can have a datatable — `ArchyGUI_Manifest`, prefixed if the environment has a prefix — describing **itself**: what the org holds, when it arrived, and who did it. Because each org only writes about itself, two people on different PCs can never disagree about the same cell. The table is created with a button, never on its own.

> **One manifest per environment, not per org.** If several virtual environments share one org, each needs its own table: `DEV_ArchyGUI_Manifest`, `TEST_ArchyGUI_Manifest`, and `ArchyGUI_Manifest` for prod.
>
> The row key is the **base name without prefix** — `WeekNumber|INBOUNDCALL` — so the board can pair `DEV_WeekNumber` and `WeekNumber` as one row. In a single shared table the two environments would therefore write to the same key and overwrite each other, and both cells would show the same thing.

#### 🔀 Across customers
Lists the flows that exist at **more than one customer** — for example the same common module in dev, uat and prod. Each customer is shown with its version, publish time and whether the flow is active.

The overview is one API call per customer and therefore fast. **⇄ Compare content** on a row exports the flow from each customer and compares the content hash — that takes time, so it only runs for the row you ask for.

> Both levels are needed: two customers can show the same version number and still hold different content, because the numbers are counted per org.

#### 🔄 Migrate Flow
Select source, target and flows. Migration runs in two phases:

1. **Check** — the flow is exported from the source and the target org is inspected for everything the flow references. Nothing is written to the target in this phase.
2. **Import** — the flow is imported only after your decision.

If anything is missing, a dialog opens with two sections:

| Section | Contents | Action |
|---|---|---|
| Can be migrated now | DataTables, Data Actions, **common modules**, bot flows, transfer targets | Checkboxes — migrated before the flow |
| Needs a decision | **Division** (create / use Home / skip), **survey form** (copy / skip) | Dropdown per resource |
| Must be created manually | Queues, skills, wrap-up codes, scripts, prompts, schedules, knowledge bases, Function Data Actions | Create them in the target org first |

Common modules are migrated with the same machinery as flows, and their **own** dependencies are handled first — recursively, bottom-up. A module that itself uses fifteen tables brings all of them along.

You can choose **Migrate selected and continue**, **Continue anyway** (the flow is imported even though something is missing — it will usually fail in Architect afterwards) or **Skip this flow**.

> **Dynamically resolved skills cannot be checked.** When a flow uses `FindSkill(Task.Skills)` the skill is decided at runtime. The dialog says so, but you have to verify yourself that the skills exist in the target org.

Everything missing is also written to the **System Log**, so you can find it again afterwards.

#### 📤 Export YAML
Export a single flow or an entire org with live progress indicator.

#### 📥 Import YAML
- Paste YAML, upload a `.yaml` file, or drag-and-drop
- **🔍 Validate YAML** — browser-side syntax check (no API call)
- **🌐 Check against org** — verifies that all resources referenced in the YAML (division, queues, DataTables, Data Actions, Prompts) exist in the target org *before* importing

#### ⚡ Migrate resources
This page migrates everything that is not a flow between two orgs, across three tabs: **Data Actions**, **Data Tables** and **User Prompts**. Source and target org are chosen once and shared by all three.

**The Data Actions tab:**
1. Select **source org** and **target org**
2. Select the **source integration** → only its actions are listed
3. The **target integration** is suggested automatically — check the note above the list
4. Select the actions to copy → click **⚡ Migrate selected**
5. The log shows per action: ✓ Created and published / ⚠ Already exists / ✗ Error, and ends with a summary

> **Why pick an integration?** Data Actions belong to an integration, and an org can have several of the same type — for example multiple OAuth integrations that group actions and spread the load. Picking one at a time preserves that grouping in the target org. The selection is cleared when you switch integration, so you cannot accidentally migrate across groups.
>
> The target integration is matched by name, or by integration type when only one candidate exists. If several are possible you must choose yourself — and migration is blocked until you do.

**The User Prompts tab** migrates user prompts between orgs. Both the TTS text and any recorded audio are copied — prompts with audio are marked 🔊 in the list.

**The Data Tables tab** migrates DataTable *structures* between orgs: pick source and target org, select the tables, click **⚡ Migrate selected**. Only the column definition is copied — **rows do not come along**. If the source division exists in the target org the table is created there; otherwise it lands in the default division and the log says so.

> **Function Data Actions cannot be migrated.** Their `requestUrlTemplate` is not a URL but the id of a function living in the source org. There is no API to create that function in the target org, so it has to be created manually first.

Name, category, input/output schema, request config (URL, method, headers) and the request/success templates are copied. Templates are fetched from the source and inlined into the new action, so it never references the source org.

> **Note:** Category names must match between orgs. If the source uses `Genesys Cloud Data Actions - QM` but the target only has `Genesys Cloud Data Actions`, either rename the integration in the target org or adjust the category in your YAML before importing.

#### 🧙 Flow Builder
Step-by-step wizard to build Archy YAML without writing it by hand. Supports all 16 flow types, Data Tables, Data Actions with schema fetching, and transfer/disconnect handling.

#### 🗂 YAML Files
Every flow the tool has exported to disk. They arrive from **Export YAML**, but also from **migrations** and **⇄ comparisons**, both of which export along the way.

Archy names the files `<FlowName>_v<major>-<minor>.yaml` — so `Test33_v1-0.yaml` is the flow *Test33* at version *1.0*. The list splits that apart and shows flow name, version, flow type, customer, timestamp and size.

Filter by **customer**, **flow type** and free text. **Latest version only** is on by default, folding away older exports of the same flow — the counter shows how many are hidden.

Each file can be opened (**View**) or sent on to the Import page (**Import**).

**🧹 Clean up** removes old versions: choose how many to keep per flow — 2 by default, so you can fall back to an earlier version — and approve the list before anything is deleted. Files without a version number are left alone.

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
