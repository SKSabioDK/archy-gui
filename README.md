# Archy GUI — Flow Manager · v1.11.0

> 🇩🇰 [Dansk](#dansk) · 🇬🇧 [English](#english)

---

## Changelog

### v1.11.0
---
**🇩🇰 Dansk**
- **⚖️ Ny sektion i dialogen: "Kræver et valg"** — Manglende ressourcer hvor der er mere end én rimelig håndtering får nu en rullemenu i stedet for blot at blive listet som manuelle.
- **Manglende division** — Vælg mellem **Opret i mål-org**, **Brug Home i stedet** eller **Spring over**. Vælges Home, omskrives `division:`-linjerne i den eksporterede YAML før importen. Kun de navngivne divisioner røres — verificeret på en rigtig fil at ingen andre linjer ændres.
- **Manglende survey form** — Vælg mellem **Kopiér fra kilde-org** eller **Spring over**. Definitionen hentes fra kilden, og `id`/`contextId`/`selfUri` strippes rekursivt, så den kopierede form ikke bærer referencer til kilde-org'en.
- Valget træffes pr. ressource, og intet sker før du trykker **Migrér valgte og fortsæt**.

> **Evaluation forms kan ikke tjekkes som flow-afhængighed.** De optræder kun som `evaluationFormID` / `evaluationFormIds` i YAML'en — altså variabelnavne og input til data actions, aldrig en statisk navnereference. Flowet slår formen op på kørselstidspunktet, typisk via et ID fra en DataTable, så der er ikke noget navn at kontrollere på forhånd.

---
**🇬🇧 English**
- **⚖️ New dialog section: "Needs a decision"** — Missing resources where more than one handling is reasonable now get a dropdown instead of merely being listed as manual.
- **Missing division** — Choose **Create in target org**, **Use Home instead** or **Skip**. Choosing Home rewrites the `division:` lines in the exported YAML before the import. Only the named divisions are touched — verified on a real file that no other line changes.
- **Missing survey form** — Choose **Copy from source org** or **Skip**. The definition is fetched from the source and `id`/`contextId`/`selfUri` are stripped recursively so the copy carries no reference back to the source org.
- The decision is made per resource, and nothing happens until you press **Migrate selected and continue**.

> **Evaluation forms cannot be checked as a flow dependency.** They appear only as `evaluationFormID` / `evaluationFormIds` in the YAML — variable names and data action inputs, never a static name reference. The flow resolves the form at runtime, typically from an ID held in a DataTable, so there is no name to check up front.

### v1.10.0
---
**🇩🇰 Dansk**
- **🔗 Common modules migreres nu automatisk** — Et common module *er* et flow, så det kan migreres med præcis samme maskineri som alt andet. De flyttes fra "skal oprettes manuelt" til "kan migreres nu" og kan markeres i dialogen som en tabel eller data action. Gælder også **bot flows** og **transfer-mål** (`targetFlow`).
- **Afhængigheder løses nedefra og op** — Et modul kan selv bruge tabeller, data actions og andre common modules. De migreres først, rekursivt, så rækkefølgen bliver rigtig. Cirkler brydes med et `visited`-sæt og dybden er begrænset til 5 niveauer.
- **Moduler publiceres** — Der importeres med `publish`, ikke `create`. Et modul skal være publiceret i mål-org'en for at et andet flow kan referere det.
- **Sporet vises i loggen** — Hvert delelement rapporteres med indrykning, så man kan se hvad der blev migreret undervejs og i hvilken rækkefølge.

> **Bemærk:** Et modul kan stadig fejle på ting der ikke kan automatiseres — typisk en **division** der ikke findes i mål-org'en. Fejlen vises da med Archys egen begrundelse.

---
**🇬🇧 English**
- **🔗 Common modules are now migrated automatically** — A common module *is* a flow, so it can be migrated with exactly the same machinery as everything else. They move from "must be created manually" to "can be migrated now" and can be ticked in the dialog like a table or data action. The same applies to **bot flows** and **transfer targets** (`targetFlow`).
- **Dependencies are resolved bottom-up** — A module can itself use tables, data actions and other common modules. Those are migrated first, recursively, so the ordering is right. Cycles are broken with a `visited` set and depth is capped at 5 levels.
- **Modules are published** — The import uses `publish`, not `create`. A module has to be published in the target org before another flow can reference it.
- **The trail is shown in the log** — Each sub-item is reported indented, so you can see what was migrated along the way and in what order.

> **Note:** A module can still fail on something that cannot be automated — typically a **division** that does not exist in the target org. The failure is then shown with Archy's own reason.

### v1.9.5
---
**🇩🇰 Dansk**
- **Systematisk gennemgang af alle 162 eksporterede flows** — I stedet for at opdage manglende afhængighedstyper én ad gangen når en migrering fejler, er samtlige YAML-filer scannet for konstruktioner der ligner en navnereference. Otte typer manglede: **common modules** (21 unikke — den største), **bot flows**, **flow-referencer** (`targetFlow`), **schedules**, **schedule groups**, **knowledge bases**, **speech-to-text engines** og **grupper**.
- **Common modules var det største hul** — 21 unikke moduler på tværs af flows. Et flow der kalder et common module som ikke findes i mål-org'en fejler ved import, og det blev ikke fanget før.
- **Rettet: scanneren fandt afhængigheder der ikke fandtes** — Flere udtryk brugte `\s*` mellem nøgle og værdi, og da `\s` også dækker linjeskift, fangede de indholdet af den *næste* linje. `division` rapporterede fx `exp: Task.division` og `prompt` rapporterede `name` som afhængigheder. Det ville have vist spøgelser i dialogen som "manglende". Udtrykkene kræver nu at værdien står på samme linje.
- **Systemprompts udelades** — `PromptSystem.*` er Genesys' indbyggede prompts. De ligger ikke i orgens promptliste og blev derfor altid rapporteret som manglende.

---
**🇬🇧 English**
- **Systematic sweep of all 162 exported flows** — Rather than discovering missing dependency types one at a time when a migration fails, every YAML file was scanned for constructs that look like a name reference. Eight types were missing: **common modules** (21 unique — the largest gap), **bot flows**, **flow references** (`targetFlow`), **schedules**, **schedule groups**, **knowledge bases**, **speech-to-text engines** and **groups**.
- **Common modules were the biggest gap** — 21 unique modules across the flows. A flow calling a common module that does not exist in the target org fails on import, and that was not being caught.
- **Fixed: the scanner reported dependencies that did not exist** — Several patterns used `\s*` between key and value, and since `\s` also matches newlines they captured the content of the *next* line. `division` reported `exp: Task.division` and `prompt` reported `name` as dependencies, which would have shown phantoms in the dialog as "missing". The patterns now require the value on the same line.
- **System prompts are excluded** — `PromptSystem.*` are Genesys built-ins. They are not in the org's prompt list and were therefore always reported as missing.

### v1.9.4
---
**🇩🇰 Dansk**
- **Survey forms tjekkes nu** — `VOICESURVEY`-flows peger på en survey form ved navn (`surveyForm: name: …`). Den blev ikke tjekket, så importen nåede hele vejen til Archy og fejlede der. Survey forms indgår nu i afhængighedstjekket og listes under "skal oprettes manuelt".
- **Manglende ressourcer navngives i fejlen** — Archy melder en manglende ressource som `find 'survey forms' by value of 'X' - no matches`, men opsummerer det som `Architect Scripting session ended in error ( code: 99 )`. Den generiske linje blev vist. Nu vises i stedet `survey forms "X" findes ikke i mål-org'en`.

---
**🇬🇧 English**
- **Survey forms are now checked** — `VOICESURVEY` flows reference a survey form by name (`surveyForm: name: …`). It was not checked, so the import ran all the way to Archy and failed there. Survey forms are now part of the dependency check and listed under "must be created manually".
- **Missing resources are named in the error** — Archy reports a missing resource as `find 'survey forms' by value of 'X' - no matches` but summarises it as `Architect Scripting session ended in error ( code: 99 )`. The generic line was what got shown. It now reads `survey forms "X" findes ikke i mål-org'en`.

### v1.9.3
---
**🇩🇰 Dansk**
- **Certifikatfejlen i Archy er løst rigtigt** — v1.9.1 forsøgte med `NODE_OPTIONS=--use-system-ca`. Det virkede ikke: Archy er en kompileret `.exe` med sin egen indlejrede Node, og flaget kom først i Node 22.15. Målt på maskinen: uden noget sat fejler den, med `--use-system-ca` fejler den stadig, med `NODE_EXTRA_CA_CERTS` lykkes den.
- **GUI'en bygger nu sit eget CA-bundle** — Ved første Archy-kald skrives `.archy-ca.pem` med Nodes indbyggede rødder plus **Windows' certifikatlager**, og Archy startes med `NODE_EXTRA_CA_CERTS` pegende på den. Det er afprøvet at et bundle *uden* proxyens egen `.pem` er nok, fordi dens root ligger i Windows-lageret — løsningen er altså ikke bundet til Norton, men virker for enhver TLS-inspicerende proxy hvis root er installeret i Windows.
- Filen er maskinspecifik og ligger i `.gitignore`.

---
**🇬🇧 English**
- **The Archy certificate failure is properly fixed** — v1.9.1 tried `NODE_OPTIONS=--use-system-ca`. That did not work: Archy is a compiled `.exe` with its own embedded Node, and the flag only arrived in Node 22.15. Measured on the machine: with nothing set it fails, with `--use-system-ca` it still fails, with `NODE_EXTRA_CA_CERTS` it succeeds.
- **The GUI now builds its own CA bundle** — On the first Archy call it writes `.archy-ca.pem` containing Node's built-in roots plus the **Windows certificate store**, and starts Archy with `NODE_EXTRA_CA_CERTS` pointing at it. A bundle *without* the proxy's own `.pem` was verified to be sufficient, because its root lives in the Windows store — so the fix is not Norton-specific but works for any TLS-inspecting proxy whose root is installed in Windows.
- The file is machine-specific and is in `.gitignore`.

### v1.9.2
---
**🇩🇰 Dansk**
- **Årsagen frem ved importfejl** — Archy afslutter nogle fejl med `Error(s) and warning(s) encountered.` i stedet for `Error(s) encountered.`, og lægger den egentlige forklaring i en `Exception:`-linje langt over opsummeringen. Begge dele ramte forbi, så en importfejl igen viste 30 linjer rå debug-log. Fejlen udtrækkes nu fra `Exception:`-linjen inkl. hvilken property og sti der fejlede — fx `a default voice was not found for engine 'Genesys Enhanced TTS' and language 'nl-NL'. ('textToSpeech' i '/inboundCall')`.

---
**🇬🇧 English**
- **The real reason on import failures** — Archy ends some failures with `Error(s) and warning(s) encountered.` rather than `Error(s) encountered.`, and puts the actual explanation in an `Exception:` line far above the summary. Both were missed, so an import failure again showed 30 lines of raw debug log. The reason is now taken from the `Exception:` line including the failing property and path — e.g. `a default voice was not found for engine 'Genesys Enhanced TTS' and language 'nl-NL'. ('textToSpeech' in '/inboundCall')`.

### v1.9.1
---
**🇩🇰 Dansk**
- **Archy-fejl blev slugt** — `runArchy` betragtede et kald som lykkedes hvis outputtet indeholdt fx `execution complete` eller `successfully`. Archy printer `execution complete.` ved **både** succes og fejl, og fejl-output indeholder linjen `did not fetch versions successfully` — så mønstrene matchede altid, og enhver rigtig Archy-fejl blev meldt som en succes. Resultatet afgøres nu på Archys eget slutbanner: `- Finish` mod `- Failure`.
- **Læsbar årsag i stedet for debug-støj** — Fejlbeskeden er nu Archys egen konklusion (`the flow named 'X' of type 'inboundcall' does not exist.`) i stedet for de sidste 30 linjer råt output.
- **Certifikater i Archy** — Forsøgt løst med `NODE_OPTIONS=--use-system-ca`. **Det virkede ikke** — se v1.9.3.
- **`maxBuffer` hævet til 20 MB**, så Archys debug-output ikke kan afkorte svaret.

---
**🇬🇧 English**
- **Archy errors were swallowed** — `runArchy` treated a call as successful if the output contained e.g. `execution complete` or `successfully`. Archy prints `execution complete.` on **both** success and failure, and failure output contains the line `did not fetch versions successfully` — so the patterns always matched and every real Archy error was reported as a success. The result is now decided by Archy's own closing banner: `- Finish` versus `- Failure`.
- **A readable reason instead of debug noise** — The error message is now Archy's own conclusion (`the flow named 'X' of type 'inboundcall' does not exist.`) rather than the last 30 lines of raw output.
- **Certificates in Archy** — Attempted with `NODE_OPTIONS=--use-system-ca`. **That did not work** — see v1.9.3.
- **`maxBuffer` raised to 20 MB** so Archy's debug output cannot truncate the response.

### v1.9.0
---
**🇩🇰 Dansk**
- **🔗 Afhængighedstjek før flow-migrering** — Migreringen er delt i to faser. Først eksporteres flowet og mål-org'en undersøges — **der skrives intet endnu**. Mangler der noget, vises en dialog med to sektioner: det der kan migreres med det samme (DataTables og Data Actions) med afkrydsning, og det der skal oprettes manuelt. Du vælger så: *Migrér valgte og fortsæt*, *Fortsæt uden*, eller *Spring flowet over*. Først derefter importeres flowet.
- **Function Data Actions blokeres bevidst** — Deres `requestUrlTemplate` er ikke en URL men et ID på en function i kilde-org'en, og der er intet API til at oprette den i målet. De listes derfor under "skal oprettes manuelt" i stedet for at fejle halvvejs.
- **Flere afhængighedstyper** — Ud over division, køer, DataTables, Data Actions og prompts tjekkes nu også **wrap-up-koder, scripts og skills**. Alt hvad der mangler skrives til systemloggen med hvilken org det mangler i, så det kan findes igen bagefter.
- **Dynamiske skills siges højt** — Bruger flowet `FindSkill(Task.Skills)`, slås skillet op på kørselstidspunktet og kan ikke tjekkes på forhånd. Dialogen fortæller det i stedet for at lade som om alt er kontrolleret.
- **Rettet: forkert flow kunne blive migreret** — Efter eksporten fandt koden filen ved at matche flownavnet mod filnavnet, og faldt ellers tilbage på *sidste fil i mappen* — altså et vilkårligt gammelt eksport. Et flow som "Set warp-up code" ramte ingen fil og migrerede i stedet et helt andet flow. Filen findes nu på hvad eksporten faktisk skrev.
- **Rettet: migreringsløkken stoppede ved første fejl** — `failed++` talte på en variabel der aldrig var erklæret, så fejlhåndteringen selv kastede og afbrød resten af batchen.

---
**🇬🇧 English**
- **🔗 Dependency check before flow migration** — Migration is now two phases. The flow is exported and the target org inspected first — **nothing is written yet**. If anything is missing, a dialog shows two sections: what can be migrated right away (DataTables and Data Actions) with checkboxes, and what has to be created by hand. You then choose: *Migrate selected and continue*, *Continue anyway*, or *Skip this flow*. Only then is the flow imported.
- **Function Data Actions are deliberately blocked** — Their `requestUrlTemplate` is not a URL but the id of a function in the source org, and there is no API to create it in the target. They are listed under "must be created manually" instead of failing halfway through.
- **More dependency types** — Beyond division, queues, DataTables, Data Actions and prompts, the check now also covers **wrap-up codes, scripts and skills**. Everything missing is written to the system log along with which org it is missing from, so it can be found again afterwards.
- **Dynamic skills are called out** — When a flow uses `FindSkill(Task.Skills)` the skill is resolved at runtime and cannot be checked in advance. The dialog says so rather than implying everything was verified.
- **Fixed: the wrong flow could be migrated** — After exporting, the code located the file by matching the flow name against the filename, and otherwise fell back to *the last file in the directory* — an arbitrary old export. A flow like "Set warp-up code" matched nothing and migrated a completely different flow instead. The file is now identified by what the export actually wrote.
- **Fixed: the migration loop stopped at the first failure** — `failed++` incremented a variable that was never declared, so the error handler itself threw and aborted the rest of the batch.

### v1.8.0
---
**🇩🇰 Dansk**
- **📊 Migrering af DataTable-strukturer** — Data Actions-siden hedder nu *Data Actions & Tabeller* og har to faner. På den nye Tabeller-fane listes kildens DataTables med kolonneantal og division, og du kan migrere strukturen til mål-org'en. **Kun strukturen — rækker kopieres ikke.** Kilde- og mål-org deles med Actions-fanen, så du ikke skal vælge org to gange.
- **Division håndteres** — Tabeller ligger i en division. Findes samme division i mål-org'en, oprettes tabellen der; ellers oprettes den i standarddivisionen, og det siges eksplicit i loggen frem for at ske i stilhed.
- **Rettet: schema blev aldrig hentet** — Opslaget af en enkelt DataTable hentede uden `expand=schema`, men læste `r.data.schema` bagefter. Feltet følger ikke med uden det parameter, så schemaet var altid tomt — det ramte Flow Builderens kolonneopslag. Listen henter nu også schema, så kolonner kan vises uden et kald pr. tabel.
- **`datatableId` strippes** — Schemaet indeholder `datatableId`, der peger på kildens tabel. Kopieres den med, bærer den nye tabel en reference til en anden org. Samme fælde som `requestTemplateUri` ved Data Actions.

---
**🇬🇧 English**
- **📊 DataTable structure migration** — The Data Actions page is now *Data Actions & Tables* with two tabs. The new Tables tab lists the source org's DataTables with column count and division, and lets you migrate the structure to the target org. **Structure only — rows are not copied.** Source and target org are shared with the Actions tab, so you do not pick the org twice.
- **Divisions are handled** — Tables live in a division. If the same division exists in the target org the table is created there; otherwise it goes to the default division and the log says so explicitly rather than letting it happen silently.
- **Fixed: the schema was never fetched** — Fetching a single DataTable omitted `expand=schema` but then read `r.data.schema`. The field is not returned without that parameter, so the schema was always empty — which broke the Flow Builder's column lookup. The list endpoint now requests the schema too, so columns can be shown without one call per table.
- **`datatableId` is stripped** — The schema carries a `datatableId` pointing at the source table. Copied verbatim, the new table would reference another org — the same trap as `requestTemplateUri` on Data Actions.

### v1.7.0
---
**🇩🇰 Dansk**
- **Valg af integration ved Data Action-migrering** — Data Actions hører til en *integration*, og en org kan have flere af samme type — fx fire OAuth-integrationer der grupperer actions og spreder belastningen. Før viste siden alle actions i én bunke og havde ét mål-dropdown, så en migrering på tværs kollapsede grupperingen. Nu vælges én kilde-integration ad gangen, listen viser kun dens actions, og markeringen ryddes automatisk når du skifter integration, så actions fra en tidligere gruppe ikke følger med.
- **Automatisk match af mål-integration** — Mål-integrationen foreslås ud fra kilden: samme navn først, ellers samme integrationstype hvis der kun findes én. Findes der flere kandidater af samme type, står valget tomt, og migreringen kan ikke startes før du selv har peget. En farvet note over listen fortæller hvilken vej matchet gik.
- **Alle data-action-typer i mål-dropdownen** — Tidligere filtrerede den på navnet "genesys" eller "data action", så `custom-rest-actions` (Web Services) og `function-data-actions` kunne falde ud. Nu vises alle data-action-typer, og der advares hvis kildens og målets type er forskellig.
- **Opsummering efter migrering** — Loggen slutter med antal oprettet / sprunget over / fejlet, så man ikke skal scrolle igennem ved mange actions.
- **Rettet: integrationen blev aldrig læst korrekt** — Serveren læste `a.integration?.name`, men API'et returnerer `integrationId` som et *fladt* felt. Feltet ramte derfor aldrig og faldt altid tilbage til kategorien, så to integrationer med samme kategorinavn var umulige at skelne. Actions får nu deres rigtige integration og type med.

---
**🇬🇧 English**
- **Integration selection for Data Action migration** — Data Actions belong to an *integration*, and an org can have several of the same type — for example four OAuth integrations that group actions and spread the load. The page previously showed every action in one list with a single target dropdown, so migrating across integrations collapsed the grouping. You now pick one source integration at a time, the list shows only its actions, and the selection is cleared when you switch integration so actions from a previous group cannot come along.
- **Automatic target matching** — The target integration is suggested from the source: same name first, otherwise same integration type when only one candidate exists. If several candidates share the type, the choice is left empty and migration is blocked until you pick. A coloured note above the list says which way the match went.
- **All data action types in the target dropdown** — It previously filtered on the words "genesys" or "data action" in the name, so `custom-rest-actions` (Web Services) and `function-data-actions` could drop out. All data action types are now listed, and a warning is shown when source and target types differ.
- **Summary after migration** — The log ends with counts of created / skipped / failed, so you do not have to scroll through it when migrating many actions.
- **Fixed: the integration was never read correctly** — The server read `a.integration?.name`, but the API returns `integrationId` as a *flat* field. That field therefore never matched and always fell back to the category, making two integrations with the same category name impossible to tell apart. Actions now carry their real integration and type.

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
Vælg kilde, mål og flows. Migreringen kører i to faser:

1. **Tjek** — flowet eksporteres fra kilden, og mål-org'en undersøges for alt flowet refererer til. Der skrives intet til mål-org'en i denne fase.
2. **Import** — først efter dit valg importeres flowet.

Mangler der noget, åbnes en dialog med to sektioner:

| Sektion | Indhold | Handling |
|---|---|---|
| Kan migreres nu | DataTables, Data Actions | Afkrydsning — migreres inden flowet |
| Skal oprettes manuelt | Køer, skills, wrap-up-koder, scripts, prompts, divisioner, Function Data Actions | Oprettes i mål-org'en først |

Du kan vælge **Migrér valgte og fortsæt**, **Fortsæt uden** (flowet importeres selvom noget mangler — det fejler typisk i Architect bagefter) eller **Spring flowet over**.

> **Skills der slås op dynamisk kan ikke tjekkes.** Bruger flowet `FindSkill(Task.Skills)`, afgøres skillet først når flowet kører. Dialogen siger det, men du må selv kontrollere at skillene findes i mål-org'en.

Alt hvad der mangler skrives også til **Systemloggen**, så du kan finde det igen bagefter.

#### 📤 Export YAML
Eksporter ét flow eller hele org'en med live fremgangsindikator.

#### 📥 Import YAML
- Indsæt YAML manuelt, upload `.yaml`-fil eller drag-and-drop
- **🔍 Valider YAML** — syntax-tjek i browseren (ingen API-kald)
- **🌐 Tjek mod org** — tjekker om alle ressourcer (division, køer, DataTables, Data Actions, Prompts) eksisterer i mål-org'en *inden* import

#### ⚡ Data Actions
Side til at migrere Data Actions mellem orgs:
1. Vælg **kilde-org** og **mål-org**
2. Vælg **kilde-integration** → kun actions fra netop den integration vises
3. **Mål-integrationen** foreslås automatisk — tjek noten over listen
4. Markér de actions du vil kopiere → klik **⚡ Migrér valgte**
5. Loggen viser pr. action: ✓ Oprettet og publiceret / ⚠ Allerede eksisterer / ✗ Fejl, og slutter med en opsummering

> **Hvorfor vælges der integration?** Data Actions hører til en integration, og en org kan have flere af samme type — fx flere OAuth-integrationer der grupperer actions og spreder belastningen. Ved at vælge én ad gangen bevares grupperingen i mål-org'en. Markeringen ryddes automatisk når du skifter integration, så du ikke kommer til at migrere på tværs af grupper.
>
> Mål-integrationen matches på navn, ellers på integrationstype hvis der kun er én kandidat. Er der flere mulige, skal du selv vælge — og migreringen kan ikke startes før du har gjort det.

**Fanen Data Tabeller** migrerer DataTable-*strukturer* mellem orgs: vælg kilde- og mål-org, markér tabellerne, klik **⚡ Migrér valgte**. Kun kolonnedefinitionen kopieres — **rækkerne følger ikke med**. Findes kildens division i mål-org'en, oprettes tabellen der; ellers havner den i standarddivisionen, og loggen siger det.

> **Function Data Actions kan ikke migreres.** Deres `requestUrlTemplate` er ikke en URL, men et ID på en function der ligger i kilde-org'en. Der er ikke noget API til at oprette functionen i mål-org'en, så den skal oprettes manuelt først.

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

> Current version: **v1.11.0** — see [Changelog](#changelog) above.

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
Select source, target and flows. Migration runs in two phases:

1. **Check** — the flow is exported from the source and the target org is inspected for everything the flow references. Nothing is written to the target in this phase.
2. **Import** — the flow is imported only after your decision.

If anything is missing, a dialog opens with two sections:

| Section | Contents | Action |
|---|---|---|
| Can be migrated now | DataTables, Data Actions | Checkboxes — migrated before the flow |
| Must be created manually | Queues, skills, wrap-up codes, scripts, prompts, divisions, Function Data Actions | Create them in the target org first |

You can choose **Migrate selected and continue**, **Continue anyway** (the flow is imported even though something is missing — it will usually fail in Architect afterwards) or **Skip this flow**.

> **Dynamically resolved skills cannot be checked.** When a flow uses `FindSkill(Task.Skills)` the skill is decided at runtime. The dialog says so, but you have to verify yourself that the skills exist in the target org.

Everything missing is also written to the **System Log**, so you can find it again afterwards.

#### 📤 Export YAML
Export a single flow or an entire org with live progress indicator.

#### 📥 Import YAML
- Paste YAML, upload a `.yaml` file, or drag-and-drop
- **🔍 Validate YAML** — browser-side syntax check (no API call)
- **🌐 Check against org** — verifies that all resources referenced in the YAML (division, queues, DataTables, Data Actions, Prompts) exist in the target org *before* importing

#### ⚡ Data Actions
Page to migrate Data Actions between orgs:
1. Select **source org** and **target org**
2. Select the **source integration** → only its actions are listed
3. The **target integration** is suggested automatically — check the note above the list
4. Select the actions to copy → click **⚡ Migrate selected**
5. The log shows per action: ✓ Created and published / ⚠ Already exists / ✗ Error, and ends with a summary

> **Why pick an integration?** Data Actions belong to an integration, and an org can have several of the same type — for example multiple OAuth integrations that group actions and spread the load. Picking one at a time preserves that grouping in the target org. The selection is cleared when you switch integration, so you cannot accidentally migrate across groups.
>
> The target integration is matched by name, or by integration type when only one candidate exists. If several are possible you must choose yourself — and migration is blocked until you do.

**The Data Tables tab** migrates DataTable *structures* between orgs: pick source and target org, select the tables, click **⚡ Migrate selected**. Only the column definition is copied — **rows do not come along**. If the source division exists in the target org the table is created there; otherwise it lands in the default division and the log says so.

> **Function Data Actions cannot be migrated.** Their `requestUrlTemplate` is not a URL but the id of a function living in the source org. There is no API to create that function in the target org, so it has to be created manually first.

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
