# Changelog — Archy GUI

> Alle ændringer, nyeste først. Installation og brug står i [README](README.md).
> All changes, newest first. Installation and usage live in the [README](README.md).

---

### v1.42.2
---
**🇩🇰 Dansk**

- **Et miljø kan omdøbes** under ⚙ Indstillinger. Før var der intet felt til navnet. Navnet må ikke være tomt eller allerede i brug.

- **Eksportmappen flytter med.** Et miljøs eksporter ligger i `flows/<navn>`, så uden flytningen ville Flow Browser og rollback-cachen se en tom mappe efter omdøbningen. Findes en mappe med det nye navn allerede, flettes der ikke — begge bliver stående, og systemloggen siger det.

**2 nye tests**, i alt 184.

**🇬🇧 English**
- **An environment can be renamed** under ⚙ Settings. The name must be non-empty and unique.
- **The export folder moves along** (`flows/<name>`). If a folder with the new name already exists, nothing is merged and the system log says so.

**2 new tests**, 184 in total.

---

### v1.42.1
---
**🇩🇰 Dansk**

- **Nye miljøer oprettes med personligt login (OAuth/PKCE).** Client credentials kan ikke længere vælges ved oprettelse, og feltet til client secret er væk fra formularen. Et eksisterende miljø kan stadig skiftes under ⚙ Indstillinger.

- **Miljøer med client credentials er markeret med gult** — både kortet og navnet i sidebjælken. De har en secret liggende på disken.

- **"⚙ Gruppering" hedder nu "⚙ Indstillinger".** Knappen rummer mere end gruppering: trin, præfiks, division, godkendelse og krav til prod.

**🇬🇧 English**
- **New environments are created with a personal login (OAuth/PKCE).** Client credentials can no longer be chosen when creating one; existing environments can still be switched under ⚙ Settings.
- **Environments using client credentials are highlighted in yellow**, on the card and in the sidebar.
- **"⚙ Grouping" is now "⚙ Settings".**

---

### v1.42.0
---
**🇩🇰 Dansk**

- **Prod kræver et personligt login med rettigheden.** Før kunne enhver ved pc'en skrive til prod — bekræftelsen var et klik, og client secret'en lå på disken. Nu skal prod-miljøet bruge OAuth (PKCE), og man logger ind i Genesys som sig selv. Ved login slås brugeren op, og værktøjet tjekker at vedkommende har rettigheden — som standard `architect:flow:publish` — og, hvis det er sat op, er med i en bestemt gruppe. Kravene sættes pr. miljø under **⚙ Gruppering**.

  Et indtastet e-mail-tjek var overvejet, men det beviser kun at e-mailen har rettigheden, ikke at det er ejeren der sidder ved tastaturet.

- **Genesys håndhæver det også selv.** Archy og API-kaldene til prod kører med brugerens eget token, så en manglende rettighed afvises af Genesys, og audit-loggen viser personen — ikke integrationen.

- **Deploy-retten gælder 30 minutter** efter login. Tokenet lever et døgn, og en ulåst pc efter frokost skal ikke kunne deploye på formiddagens login. Med SSO er et nyt login som regel ét klik.

- **Prod med client credentials kan læses, men ikke skrives til.** Kortet siger det, og skift til OAuth sker under ⚙ Gruppering. Når et prod-miljø skifter til OAuth, slettes secret'en fra `customers.json`.

- **Alle skrivende ruter står bag vagten** — import, publicering, genpublicering, forfremmelse, rollback, nulpunkt, manifest, release-noter og migrering af data actions, datatabeller, prompts, survey forms og divisioner. Afvises man, tilbyder værktøjet at logge ind. En test fælder, hvis en ny skrivende rute kommer til uden at være taget stilling til.

- **Demo-miljøerne er ikke omfattet** — de har ingen org at logge ind i.

**11 nye tests**, i alt 182.

**🇬🇧 English**
- **Prod requires a personal login with the permission.** A prod environment must use OAuth (PKCE). At login the user is looked up in Genesys and must hold `architect:flow:publish` (configurable) and, optionally, belong to a group — set per environment under ⚙ Grouping.
- **Genesys enforces it too.** Archy and API calls to prod run with the user's own token; the audit log shows the person.
- **Deploy rights last 30 minutes** after login.
- **Prod with client credentials is read-only.** Switching a prod environment to OAuth removes its secret from `customers.json`.
- **Every writing route is behind the guard**, with a test that fails if a new one is added without a decision. Demo environments are not affected.

**11 new tests**, 182 in total.

---

### v1.41.2
---
**🇩🇰 Dansk**

- **Demo 2 fulgte ikke præfikserne.** Fjernede man `UAT_` på UAT-miljøet, stod demoens flows stadig som `UAT_Betaling`, `UAT_Hilsen` og `UAT_Ordreflow` — og et miljø uden præfiks ser dem som selvstændige flows. Tavlen fik en ekstra række pr. flow. *Nulstil demo* bygger nu flowene ud fra miljøernes aktuelle præfiks.

- **Demo-miljøerne hedder efter trinnet**, "Kunde 2 A/S — UAT", ikke efter præfikset, som kunne ændres og så stå forkert i kolonnehovedet. Ældre navne rettes ved nulstilling.

- **"Gammelt forsoeg" udelades** når et non-prod-miljø er uden præfiks — så hører flowet til det miljø, og eksemplet giver ingen mening.

- **Advarsel når et præfiks ændres.** Det samme kan ske med rigtige kunder: flowene i org'en omdøbes ikke, når præfikset ændres. Før der gemmes, tjekker værktøjet org'en og siger hvor mange flows der stadig har den gamle navngivning, med eksempler — og man kan fortryde. Kan org'en ikke læses, gemmes der som før.

**1 ny test**, i alt 171.

**🇬🇧 English**
- **Demo 2 did not follow the prefixes.** With `UAT_` removed, the demo flows were still named `UAT_…` and showed as extra rows. *Reset demo* now builds them from the environments' current prefixes.
- **Demo environments are named after the stage**, not the prefix; older names are fixed on reset.
- **"Gammelt forsoeg" is left out** when a non-prod environment has no prefix.
- **A warning when a prefix changes.** Flows in the org are not renamed; before saving, the tool reports how many flows still use the old naming, with examples, and lets you cancel.

**1 new test**, 171 in total.

---

### v1.41.1
---
**🇩🇰 Dansk**

- **Programmet starter på Pipeline** når der er sat grupper op, med den kunde man sidst arbejdede med valgt. Tavlen hentes ikke af sig selv — det ville kalde alle gruppens orgs, og et OAuth-miljø ville bede om login — så man trykker stadig *Vis pipeline*. Uden grupper starter det på Kunder som før.

- **Brugere tjekkes før import.** Et flow med en fast bruger i *Transfer to User* (`targetUser: lit: userName: …`) blev ikke tjekket, så en bruger der ikke fandtes i mål-org'en først viste sig når Archy afviste importen. Nu slås brugeren op i målet på login-mailen, og en manglende bruger står i afhængighedsdialogen under *opret i mål-org først*, sammen med køerne. Brugere oprettes ikke af værktøjet. I de eksporterede flows er der 6 med faste brugere.

  En bruger eller kø givet som udtryk (`exp:`) slås først op når flowet kører og kan ikke tjekkes på forhånd.

**1 ny test**, i alt 170.

**🇬🇧 English**
- **The app starts on Pipeline** when groups are set up, with the last-used customer selected. The board is not fetched automatically.
- **Users are checked before import.** A fixed user in *Transfer to User* was not checked, so a user missing in the target org only surfaced when Archy rejected the import. The user is now looked up by login email and listed under *create in target org first*, alongside queues. Users given as an expression cannot be checked in advance.

**1 new test**, 170 in total.

---

### v1.41.0
---
**🇩🇰 Dansk**

- **Rollback virker nu fra en anden pc.** I v1.40.0 lå hele release-loggen — og indholdet en rollback skulle bruge — i `flows/.releases.json` på den pc der forfremmede. Åbnede man tavlen på en anden pc næste morgen, var der hverken en **↩**-knap eller et **📝**-link.

  Nu ligger historikken i **org'en**, i manifest-rækken for flowet: de seneste 20 releases med udgaven før og efter, hvem, hvornår, noten og om den er rullet tilbage. Indholdet gemmes *ikke* dér — Genesys har allerede hver publiceret udgave, så rollback eksporterer den udgave målet stod på før, direkte fra org'en. Det er efterprøvet på demoen ved at slette hele den lokale cache mellem forfremmelse og rollback.

- **Den lokale fil er nu en cache.** Den har diff'en og indholdet klar og sparer en eksport. Mangler den, bygges diff'en af de to udgaver i org'en første gang man folder den ud, og lægges så i cachen.

- **Noter og "rullet tilbage" deles.** En note skrevet på én pc, eller en rollback lavet fra en anden, ses af alle. Næste klik på **↩** går én forfremmelse længere tilbage, uanset hvilken pc de forrige klik kom fra.

- **En forfremmelse sletter ikke længere historikken.** Manifest-rækken blev skrevet forfra ved hver forfremmelse. Nu læses den først, og historikken følger med.

- **Miljøer uden manifest-tabel** har stadig kun historikken på den pc der lavede releasen. Listen markerer dem *kun på denne pc*, og systemloggen siger det ved hver release.

- **Demoen husker sine udgaver**, ligesom Genesys, så rollback i demoen henter indholdet samme vej som i en rigtig org.

**6 nye tests**, i alt 169.

**🇬🇧 English**
- **Rollback now works from another PC.** In v1.40.0 the release log — and the content a rollback needed — lived in `flows/.releases.json` on the PC that promoted. The history now lives in **the org**, in the flow's manifest row: the latest 20 releases with version before and after, who, when, note and rollback status. Content is *not* stored there; Genesys keeps every published version, so rollback exports the previous version straight from the org. Verified on the demo by deleting the whole local cache between promotion and rollback.
- **The local file is now a cache**; a missing diff is built from the two versions in the org on first expand.
- **Notes and rollback status are shared** across PCs.
- **A promotion no longer wipes the history** in the manifest row.
- **Environments without a manifest table** keep history on the promoting PC only, marked *this PC only*.
- **The demo keeps its versions**, as Genesys does.

**6 new tests**, 169 in total.

---

### v1.40.0
---
**🇩🇰 Dansk**

- **Forfremmelse videre end ét trin gav forkert navn.** `DEV_Betaling_v6` → TEST blev rigtigt `TEST_Betaling_v6`, men videre til UAT blev det `UAT_Betaling_v3` — og TEST blev omdøbt til `_v3` med. Tallet blev taget fra det miljø man forfremmede *fra*, og TEST stod selv på v3. Nu sættes tallet kun når flowet forlader gruppens **første trin**; derefter følger navnet med som det er, hele vejen til prod.

- **Indholdet fik ikke målets navn.** Demoen kopierede kildens YAML som den var, så UAT-udgaven stod med `name: DEV_Betaling` indeni, og referencer pegede på `DEV_`-ressourcer. Forfremmelsen omskriver nu navn, referencer og division som en rigtig import gør.

- **Common modules får aldrig en versionsendelse.** Fanget under afprøvningen: `TEST_Hilsen` blev til `TEST_Hilsen_v4`, og de flows der kalder modulet *ved navn* pegede på noget der ikke fandtes længere. Gælder også bot flows.

- **📝 Release notes.** Hver forfremmelse skriver en release med diff af hvad målet indeholdt før og efter, hvem, hvornår og hvilke referencer der blev omskrevet. Ses fra tavlen (📝 N på cellen, 📝 Release notes for gruppen), kan kommenteres, og kan kopieres eller hentes som markdown. Den rigtige migrering eksporterer målets publicerede udgave før importen for at kende "før" — én ekstra eksport pr. forfremmelse.

- **↩ Rollback med ét klik.** Publicerer indholdet fra før seneste forfremmelse igen. Næste klik går én længere tilbage. Prod kræver bekræftelse. Manifestet opdateres, så tavlen ikke melder vores egen rollback som "publiceret uden om pipelinen".

- **🔁 Kaskade for common modules.** Forfremmes eller rulles et modul tilbage, findes de flows i målmiljøet der bruger det (Genesys' afhængighedssporing, også gennem et andet modul), og man vælger hvilke der genpubliceres. Flows med en upubliceret kladde er fravalgt som standard. Også som knap på tavlen.

- **Ét miljø uden præfiks pr. org.** UAT uden præfiks i samme org som `DEV_` og `TEST_` virkede allerede — nu afviser serveren blot et *andet* miljø uden præfiks (eller med samme præfiks) i samme org, for de ville gøre krav på de samme flows.

- **Demo 2** har fået et common module, `Hilsen`, som Ordreflow og Betaling kalder — så kaskaden kan prøves af.

**14 nye tests** (`test/releases.test.js`), i alt 163.

**🇬🇧 English**
- **Promotion beyond one stage produced the wrong name.** `DEV_Betaling_v6` → TEST correctly became `TEST_Betaling_v6`, but onward to UAT it became `UAT_Betaling_v3`, and TEST was renamed to `_v3` as well. The number came from the environment promoted *from*, and TEST itself stood at v3. The number is now only set when leaving the group's **first stage**; after that the name travels unchanged to prod.
- **The content did not get the target's name.** The demo copied the source YAML verbatim. Promotion now rewrites name, references and division as a real import does.
- **Common modules never get a version suffix** — other flows call them by name. Same for bot flows.
- **📝 Release notes** with a diff of before and after, who, when and rewritten references; commentable, copyable and downloadable as markdown.
- **↩ One-click rollback** to the content from before the latest promotion; each further click goes one promotion back. Prod requires confirmation.
- **🔁 Common module cascade**: after a module is promoted or rolled back, the flows using it in the target are found and can be republished. Also a board button.
- **One unprefixed environment per org** is now enforced on the server.

**14 new tests**, 163 in total.

---

### v1.39.2
---
**🇩🇰 Dansk**

- **Brugerfladen talte dansk i en engelsk flade.** Efter en eksport af alle flows stod der

  ```
  ✓ Alle 76 flows eksporteret til "Transcom"
  ```

  selv om sprogvælgeren stod på English. Beskeden var **hardkodet** i en template-streng og gik uden om `t()` — mens nabolinjen i det *samme* udtryk hentede sin tekst fra `LANGS`:

  ```js
  job.failed === 0
    ? `✓ Alle ${job.succeeded} flows eksporteret til "${folderName}"`   // hardkodet
    : `⚠ … ${t('export_errors')} — ${t('export_saved_to')} "…"`         // oversat
  ```

  Det er derfor den overlevede: koden *ser* oversat ud. Samme fejl sad i "Stoppet"-beskeden, som kun ses hvis man afbryder en eksport.

- **Hele YAML-validatorens udskrift stod på dansk.** Fjorten tekster — fra `YAML syntaks OK` og `linje 12, kolonne 5` til `Mangler "startUpRef:"` og `Alt ser korrekt ud — klar til import` — samt overskriften `🌐 VALIDERING MOD ORG` og opsummeringen `Alle 76 ressourcer fundet i mål-org`. Alle fem sprog har nu nøglerne.

- **To steder mere:** `(findes ikke i org'en)` i division-rullelisten, og advarselsbanneret når `/konventioner.js` ikke kan hentes. Banneret krævede en ekstra rettelse: det tegnes på `DOMContentLoaded`, men sproget blev først læst i `window.onload` — så `t()` ville have svaret dansk uanset hvad. `currentLang` sættes nu fra `localStorage` allerede ved erklæringen, så `t()` svarer rigtigt fra det første kald i programmet.

- **Mappenavnet escapes nu**, inden det lander i `showAlert`, der skriver med `innerHTML` — samme linje som i v1.38.0.

**En sprogvagt på brugerfladen** (`test/ui-sprog.test.js`), efter samme mønster som vagten på systemloggen fra v1.37.0, men med modsat fortegn: loggen skal være engelsk, fladen skal komme fra `LANGS`. Den læser klient-JS'en, blanker `LANGS` ud, springer kommentarer og regexer over — og fælder på en dansk streng i det der er tilbage.

To ting kostede en omgang hver:

| Problem | Udslag |
|---|---|
| `job.current / job.total` blev læst som starten på et regex | scanneren løb ud af trit og meldte kodestumper som tekst |
| `klar` og `korrekt` manglede i ordlisten | `Alt ser korrekt ud — klar til import` slap igennem |

Efterprøvet ved at genindføre alle fire rigtige fejl: **alle fire blev fanget**, med linjenummer i `index.html`. Dertil en test på at de fem sprogblokke har præcis de samme nøgler — mangler en nøgle i ét sprog, falder `t()` tilbage på dansk, altså den samme fejl gemt i ordbogen i stedet.

**6 nye tests**, i alt 149.

**🇬🇧 English**
- **The interface spoke Danish in an English window.** `✓ Alle 76 flows eksporteret til "Transcom"` was hardcoded in a template string and bypassed `t()` — while the neighbouring branch of the *same* expression read its text from `LANGS`. That is why it survived: the code looks translated.
- **The whole YAML validator output was Danish** — fourteen strings, plus the org-check heading and summary. All five languages now carry the keys.
- **Two more:** `(findes ikke i org'en)` in the division dropdown, and the banner shown when `/konventioner.js` cannot be fetched. The banner needed a second fix: it is drawn on `DOMContentLoaded`, but the language was not read until `window.onload`, so `t()` would have answered Danish regardless. `currentLang` is now initialised from `localStorage` at declaration.
- **The folder name is escaped** before it reaches `showAlert`, which writes with `innerHTML`.

**A language guard for the interface** (`test/ui-sprog.test.js`), mirroring the system-log guard from v1.37.0 with the sign reversed: the log must be English, the interface must come from `LANGS`. Verified by reintroducing all four real defects — all four were caught, with line numbers. Plus a test that the five dictionaries hold exactly the same keys.

**6 new tests**, 149 in total.

---

### v1.39.1
---
**🇩🇰 Dansk**

- **Fejlen bærer nu stien til Archys fulde udskrift.** Tre migreringer fejlede med kun

  ```
  Architect Scripting session ended in error ( code: 99 )
  ```

  Det er Archys generiske afslutning. Den er så intetsigende at `archyErrorReason` **aktivt fravælger den**, hvis der står noget mere præcist i udskriften — så når den alligevel kom igennem, var der intet mere præcist at finde. Og der var ikke noget at gå videre med.

  Men Archy skriver selv en `Log:`-linje med stien til hele kørslen, og **`parseArchyOutput` filtrerede den væk som støj** — med rette når det gik godt, men netop når det gik galt var den den eneste pegepind til detaljen. Nu hæftes den på:

  ```
  the flow named 'ZZZ_findes_ikke' of type 'workflow' does not exist.
    — full Archy output: C:\Tools\Archy\archyHome\debug\archy-debug-2026-09-10T08.31.18.687Z.txt
  ```

  Efterprøvet mod en rigtig org med en læsende eksport af et flow der ikke findes: stien kom med, og filen lå der. Den hæftes på **efter** afkortningen — ellers ville den selv blive skrevet væk på en lang udskrift, altså præcis dem hvor man har mest brug for den.

- **Tre danske tekster slap stadig ind i systemloggen.** Sprogvagten fra v1.37.0 scannede `addLog(`, `throw new Error(` og `reject(new Error(` — men ikke de funktioner der **returnerer** en besked, som så ender i loggen som en del af `${e.message}`:

  | Sted | Før | Nu |
  |---|---|---|
  | `truncateArchyError` | `[... 70 linjer skjult — viser de sidste 30 ...]` | `[... 70 lines hidden — showing the last 30 ...]` |
  | `archyErrorReason` | `(+2 flere)` | `(+2 more)` |
  | `describeApiError` | `Ukendt fejl` | `Unknown error` |

  Vagten dækker nu også de seks funktioner der bygger fejlbeskeder. **Den fandt selv de to sidste** — jeg havde kun set den første.

**7 nye tests**, i alt 143. Efterprøvet ved at genindføre hver af de fem fejl: alle fem blev fanget. To af dem krævede en kildekontrol på `runArchy`, som ikke kan køres uden Archy og en org — dér er **rækkefølgen** det testen holder øje med.

**🇬🇧 English**
- **Failures now carry the path to Archy's full output.** Three migrations failed with nothing but `Architect Scripting session ended in error ( code: 99 )` — Archy's generic terminator. Archy writes a `Log:` line pointing at the complete run, and `parseArchyOutput` was filtering it out as noise; right on success, wrong on failure. It is now appended to the error, after truncation so it cannot be trimmed away.
- **Three Danish strings still reached the system log.** The guard from v1.37.0 scanned `addLog(` and thrown errors, but not the functions that *return* a message which later lands in `${e.message}`. It now covers the six message-building functions — and found two of the three itself.

**7 new tests**, 143 in total.

---

### v1.39.0
---
**🇩🇰 Dansk**

- **Migrer Flow: "Vis kun valgte".** Har man prikket tolv flows af i en liste på 191, kunne man ikke se hvad man rent faktisk havde valgt, før man trykkede kør. Nu kan listen skrumpes til udvalget.

  Filteret virker sammen med de to andre: på en rigtig org gik listen fra **122 → 3** med *Vis kun valgte*, og videre til **2** da typefilteret også blev sat til WORKFLOW.

  *Vælg alle* tager stadig kun de synlige — med typefilteret på COMMONMODULE valgte den 27, og *Vis kun valgte* viste derefter præcis de 27.

- **Pipeline: filtrér på flowtype.** Som på Flow Browser og Migrer Flow. Listen fyldes ud fra de typer gruppen faktisk har, med antal pr. type — en fast liste ville vise typer gruppen ikke har og mangle dem den har. På Sabio: 120 rækker → 26 common modules, 24 inbound call, 16 workflow. Tallene summerer til 120.

  **CSV-udtrækket følger med**, fordi både tavlen og udtrækket bruger `pipelineRowsShown()`. Efterprøvet: 26 rækker på tavlen, 27 linjer i CSV'en (overskriften med).

  Skifter man gruppe, fyldes listen på ny, og et valg der ikke findes i den nye gruppe falder bort af sig selv.

- **To småting undervejs.** Nøglen et flow kendes på i migreringslisten blev sat sammen i hånden fire steder; nu ét sted, så filteret og afkrydsningen ikke kan komme til at bruge hver sin. Og den tomme liste sagde *"Ingen logposter fundet"* — en tekst lånt fra systemloggen, der intet fortalte. Nu siger den enten *"Ingen flows valgt endnu"* eller *"Ingen flows passer til filteret"*, alt efter hvad der er tilfældet.

Tre nye tekster i alle fem sprog.

**🇬🇧 English**
- **Migrate Flow: "Show only selected".** With twelve flows ticked in a list of 191 you could not see your own selection before pressing run. On a real org the list went 122 → 3, and on to 2 with the type filter also set. *Select all* still takes only what is visible.
- **Pipeline: filter by flow type**, as on the other pages. The list is built from the types the group actually has, with counts; 120 rows on Sabio split into 26 common modules, 24 inbound call, 16 workflow. **The CSV export follows** — both the board and the export go through `pipelineRowsShown()`. Switching group rebuilds the list and drops a selection that no longer applies.
- Two small things on the way: the key a flow is known by in the migration list was assembled by hand in four places and is now in one, so the filter and the tick cannot use different keys; and the empty list said *"No log entries found"* — borrowed from the system log — where it now says whether nothing is selected or nothing matches the filter.

---

### v1.38.2
---
**🇩🇰 Dansk**

- **Et common module mistede sit navn når det blev forfremmet til et præfikset miljø.** Migreringen fejlede med

  ```
  the flow name 'undefined' is invalid.  It must be a non-blank string
  with no leading or trailing spaces. ('name' i '/commonModule')
  ```

  Årsagen: `prefixDependenciesInYaml` ledte efter `commonModule:` **uden krav om indrykning**. På indrykning 0 er `commonModule:` ikke en reference til et andet modul — det er flowets EGEN type, og linjen under er dets navnefelt. Omskrivningen ramte altså selve nøglen:

  ```
  commonModule:                        commonModule:
    name: DEV_Create Logitems    →      DEV_name: DEV_Create Logitems
  ```

  Flowet havde derefter intet navn, og Archy afviste importen. `scanYamlDependencies` har haft kravet om indrykning hele tiden — kommentaren dér forklarer endda hvorfor. Det manglede kun her.

  **Efterprøvet på den rigtige fil** ved at eksportere `Create Logitems` fra prod (læsende) og køre nøjagtig de omskrivninger commit laver:

  | | Før | Nu |
  |---|---|---|
  | Navnelinje | `DEV_name: DEV_Create Logitems` | `name: DEV_Create Logitems` |
  | `changed` | `name → DEV_name` | `(ingen)` |

  Og rettelsen tager ikke det funktionen er til for: `Personal menu` får stadig sine tre indrykkede referencer skrevet om (`PersonalMenu`, `NRD_AbsentCode`, `NRD_SplitDate`), og navnelinjen står urørt.

  **Intet nåede ud i en org.** Importen fejlede, så der ligger ingen halvfærdig kopi — efterset: 26 common modules i mål-org'en, ingen med et mistænkeligt navn.

**3 nye tests**, i alt 134. Efterprøvet ved at fjerne indrykningskravet igen: fejlen blev fanget.

**🇬🇧 English**
- **A common module lost its name when promoted into a prefixed environment**, and Archy rejected the import with `the flow name 'undefined' is invalid`. `prefixDependenciesInYaml` looked for `commonModule:` without requiring indentation — but at indentation 0 that is the flow's own type, not a reference, and the line below it is the name field. So `name:` was rewritten to `DEV_name:`. `scanYamlDependencies` has always required the indentation; only this function did not.

  Verified on the real exported file: the name line is now untouched, and the three genuinely nested references in `Personal menu` are still rewritten. Nothing reached an org — the import failed, and the target org has no half-written copy.

**3 new tests**, 134 in total.

---

### v1.38.1
---
**🇩🇰 Dansk**

- **`/api/export` siger nu hvad der mangler.** Feltet `flowType` blev brugt før nogen havde set efter om det var der:

  | | |
  |---|---|
  | Før | `500 {"error":"Cannot read properties of undefined (reading 'toLowerCase')"}` |
  | Nu | `400 {"error":"Missing or empty field: flowType"}` |

  Den gamle besked siger hvad koden snublede over, ikke hvad man selv har glemt at sende. Mangler begge felter, navngives de begge — ikke bare det første. Er felterne der men kunden ikke, er det stadig kunden der meldes.

  En værdi som `' WORKFLOW '` med slør på bliver trimmet i stedet for at ende hos `archyBareArg` som *"is not a valid name"* — en besked der ville pege på det forkerte.

- **Jeg ledte efter flere af samme slags.** En scanning af alle 30 skrivende ruter for mønstret *"felt fra `req.body` brugt med et metodekald, uden at nogen har tjekket at det findes"* gav **ét** hit: `/api/export`. Scanningen er nu en test, så den næste af slagsen fældes med det samme.

- **To demo-ruter sagde `"undefined"`.** `/api/demo/promote` og `/api/demo/publish` svarede `"undefined" findes ikke i Demo A/S — DEV` når flownavnet manglede. Forståeligt, men `undefined` er en programmeringsfejl der lækker ud i en besked til brugeren. De bruger nu samme validering.

  Alle 17 skrivende ruter blev derefter prøvet af med en mangelfuld krop: **ingen lækker en Node-fejl** længere.

**10 nye tests**, i alt 131. Efterprøvet ved at genindføre hver af de fire fejl: alle fire blev fanget — den ene først efter at testen blev skrevet om, fordi `.trim()` ikke var observerbar uden en værdi der både er gyldig og har mellemrum omkring sig.

**🇬🇧 English**
- **`/api/export` now says what is missing.** `flowType` was used before anything checked it, so a missing field came out as `500 Cannot read properties of undefined (reading 'toLowerCase')` — a message about what the code tripped over, not about what you forgot to send. Now `400 Missing or empty field: flowType`, naming every missing field rather than just the first.
- **I looked for more of the same.** Scanning all 30 writing routes for the pattern gave exactly one hit. The scan is now a test.
- **Two demo routes answered `"undefined"`** when the flow name was missing; they use the same validation now. All 17 writing routes were then probed with an incomplete body: none leaks a Node error.

**10 new tests**, 131 in total.

---

### v1.38.0
---
**🇩🇰 Dansk**

- **Navne fra en org escapes nu overalt, før de tegnes.** Et flow der hedder `<img src=x onerror=…>` blev sat direkte ind i `innerHTML` femten steder. Vinduet kan kalde hele API'et — herunder `/api/customers` og `/api/files/content` — så det er ikke bare en gættet risiko.

  Målt først: **0 af 517 rigtige flownavne i fire orgs indeholder `' " < > &`.** Det bider altså ikke i dag. Det er et hul der lukkes, ikke en fejl der rettes.

  **`escapeHtml` fandtes allerede** — den blev bare brugt 34 steder og ikke 133. Nu er den konsekvent.

- **`jsAttr` til JavaScript inde i en attribut.** `escapeHtml` alene rækker ikke i `onclick="fn('${navn}')"`: HTML-parseren afkoder `&#39;` tilbage til `'` **før** JS ser strengen, og så er man ude af strengen igen. `jsAttr` JSON-koder først og escaper derefter:

  ```
  navn = Kunde's flow
  → onclick="fn(&quot;Kunde&#39;s flow&quot;)"   →   fn("Kunde's flow")
  ```

  Seks `onclick`-steder er lagt om. **Det retter samtidig en almindelig fejl**: et flow der hedder `Kunde's flow` brød sin egen Export-knap med en syntaksfejl, helt uden ondsindet hensigt.

- **Seks slags hjemmelavede escapes er væk.** Der stod `.replace(/</g,'&lt;')` ét sted, `.replace(/"/g,'&quot;')` et andet og `&apos;` et tredje — hver dækkede ét tegn, og hvilket ét afhang af hvem der skrev linjen. `escapeHtml` dækker `& < > " '` alle steder.

  **Efterprøvet i brugerfladen** med navne der ville køre kode:

  | Flownavn | Resultat |
  |---|---|
  | `<img src=x onerror="…">` | vist som tekst, **0** `<img>`-elementer oprettet |
  | `</script><script>…</script>` | vist som tekst |
  | `a" onclick="…` | vist som tekst |
  | `Kunde's flow` | vist som tekst — og knappen virker nu |

  Ingen af dem kørte. Og lige så vigtigt: **alle fire navne når uskadte frem til funktionen** når man trykker på knappen — escaping skal beskytte OG bevare.

**6 nye tests**, i alt 121. `test/escape.test.js` scanner `index.html` og fælder hvis et utrygt felt går uescapet ind i HTML eller i en `onclick`. Den henter `escapeHtml` og `jsAttr` **ud af index.html** og kører dem som de er — en kopi i testfilen ville bestå selvom nogen ændrede den rigtige, hvilket en mutationskørsel viste. Efterprøvet ved at genindføre hver af de fire fejl: alle fire blev fanget.

**🇬🇧 English**
- **Names from an org are now escaped everywhere before rendering.** A flow named `<img src=x onerror=…>` went straight into `innerHTML` in fifteen places, and the window can call the whole API. Measured first: **0 of 517 real flow names contain `' " < > &`**, so this closes a hole rather than fixing a live bug. `escapeHtml` already existed — it was used in 34 places, now 133.
- **`jsAttr` for JavaScript inside an attribute.** `escapeHtml` is not enough there: the HTML parser decodes `&#39;` back to `'` before JS sees the string. `jsAttr` JSON-encodes first, then escapes. Six `onclick` sites converted — which also fixes a plain bug: a flow named `Kunde's flow` used to break its own Export button.
- **Six kinds of hand-rolled escaping are gone**, each covering a single character depending on who wrote the line.

  Verified in the UI with names that would otherwise run code: nothing executed, no `<img>` element created, and all four names still arrive intact at the handler when the button is clicked.

**6 new tests**, 121 in total. `test/escape.test.js` scans `index.html` and pulls `escapeHtml` and `jsAttr` out of it to exercise them directly.

---

### v1.37.1
---
**🇩🇰 Dansk**
- **`npm audit fix`: 5 sårbarheder → 0.** Alle sad i `axios`, som er hoppet fra 1.14.0 til 1.20.0 — inden for `^1.14.0`, så `package.json` er urørt og kun låsefilen har ændret sig. Følgepakkerne fulgte med: `body-parser` 2.2.2 → 2.3.0, `follow-redirects` 1.15.11 → 1.16.0, `form-data` 4.0.5 → 4.0.6, `qs` 6.15.0 → 6.16.0. Fire transitive pakker kom til (`agent-base`, `https-proxy-agent` og to indlejrede `content-type`), ingen forsvandt.

  De to høje var SSRF via `NO_PROXY` og prototype pollution i axios' konfigurations-fletning. Ingen af dem var nærliggende her — URL'erne bygges af programmet selv, ikke af noget udefra — men rettelsen var gratis.

  **Efterprøvet mod de rigtige orgs bagefter**, ikke bare med `npm audit`:

  | Hvad | Resultat |
  |---|---|
  | 115 tests | alle grønne |
  | Flowliste (axios + OAuth-token) | 121 flows |
  | Divisioner (axios med `params`) | 3 fundet |
  | Datatabeller (paginering) | 41 fundet |
  | Archy-eksport | `Notify Flow Error_v2-0.yaml`, rigtigt navn i YAML'en |
  | `migrate/prepare` | `ChatGPT_v5-0.yaml` — stadig den publicerede udgave |
  | Brugerfladen | 11 sider × 5 sprog, ingen konsolfejl |

**🇬🇧 English**
- **`npm audit fix`: 5 vulnerabilities → 0.** All of them in `axios`, bumped 1.14.0 → 1.20.0 — within `^1.14.0`, so `package.json` is untouched and only the lockfile changed. Verified against the real orgs afterwards, not just with `npm audit`: 115 tests green, flow list, divisions, datatables, an Archy export and a `migrate/prepare` all behave exactly as before.

---

### v1.37.0
---
**🇩🇰 Dansk**

- **Migreringen henter nu den PUBLICEREDE udgave, ikke kladden.** `archy export` tager `latest` som standard, og latest er den gemte kladde. Vagten i `/api/migrate/prepare` sagde god for flowet fordi det ER publiceret — og så sendte vi kladden af sted. Vi lovede ét og leverede noget andet.

  Målt på en rigtig org, før og efter:

  ```
  før:  ChatGPT_v7-0.yaml   0 dataAction-referencer   (kladden — nogen havde
                                                        fjernet data action-valget)
  nu:   ChatGPT_v5-0.yaml   1 dataAction-referencer   (den publicerede)
  ```

  Det var årsagen til migreringen der fejlede med *"A data action must be selected."* Samme opslag afgør nu både vagten og hvilken udgave der eksporteres, så de to ikke kan komme på tværs af hinanden igen. Gælder også afhængige flows.

  Kan udgaven ikke slås op, falder vi tilbage på latest og skriver det i loggen — hellere den gamle opførsel end ingen migrering. Versionen citeres som alt andet på kommandolinjen.

  **Export YAML-siden er urørt**: den giver stadig `latest`, for der er det netop det man arbejder på man vil have fat i.

- **Systemloggen er altid engelsk.** Før var den en blanding: kolonneoverskrifterne fulgte sproget, og linjerne var dels danske, dels engelske. Loggen er driftsdata — den bliver kopieret ind i en sag og læst af folk der ikke nødvendigvis kører programmet i samme sprog som den der lavede migreringen.

  **53 beskeder oversat**, fordelt på tre veje dansk kom ind ad:

  | Vej | Eksempel før | Nu |
  |---|---|---|
  | `addLog` direkte | `Oprydning: 12 gamle YAML-filer slettet` | `Cleanup: 12 old YAML files deleted` |
  | Kastede fejl, som ender i loggen som `${e.message}` | `Eksporten skrev ingen YAML-fil for …` | `The export wrote no YAML file for …` |
  | Vejledning der blev logget råt | `Migration blocked: "X" er ikke publiceret i …` | `Migration blocked (unpublished-source): "X" is not published in …` |

  Vejledningen til brugeren bliver på dansk i selve dialogen — det er kun loggen der er låst. Kolonneoverskrifter og filtre følger stadig sproget.

  `test/log-engelsk.test.js` læser `server.js` og fælder hvis en dansk besked slipper ind igen, også gennem en kastet fejl. Den fandt fire beskeder jeg selv havde overset i første gennemgang, og to falske udslag i sin egen opdager — begge dele er rettet, og der er en kontroltest der beviser at opdageren stadig fælder rigtig dansk.

**6 nye tests**, i alt 115.

**🇬🇧 English**
- **Migrations now export the PUBLISHED version, not the draft.** `archy export` defaults to `latest`, which is the saved draft. The guard in `/api/migrate/prepare` approved the flow because it *is* published, and then we shipped the draft. Measured on a real org: `ChatGPT_v7-0.yaml` with 0 data action references before, `ChatGPT_v5-0.yaml` with 1 after. That was the cause of the migration that failed with *"A data action must be selected."* The same lookup now drives both the guard and the export. The Export YAML page still gives you `latest` — there, the draft is what you want.
- **The system log is always English**, whatever language the interface is set to. 53 messages translated, across three routes Danish came in by: `addLog` itself, thrown errors that reach the log as `${e.message}`, and user guidance that was logged verbatim. Guidance shown in dialogs stays translated; only the log is fixed. `test/log-engelsk.test.js` reads `server.js` and fails if Danish gets back in.

---

### v1.36.1
---
**🇩🇰 Dansk**

En migrering fejlede med **"WARNING - the flow has 14 warning(s). (see above)"** — et advarselstal, ikke en fejl man kan gøre noget ved. Den egentlige årsag stod i udskriften, men blev ikke vist.

- **Advarsler vandt over fejl.** Archy afslutter sådan her:

  ```
  ERROR - the flow has 1 error(s). (see above)

  WARNING - the flow has 14 warning(s). (see above)

  Error(s) and warning(s) encountered.
  ```

  Vi leder baglæns fra terminatoren, og warnings står **sidst** — så vi ramte dem hver gang og skjulte fejlen lige over. En `ERROR`-linje vinder nu over en `WARNING`-linje.

- **Men tallene siger stadig ingenting.** Den brugbare tekst står i Archys `Validation Results` længere oppe, sammen med hvilket objekt og hvilken sti det drejer sig om. Den læses nu i stedet:

  | | |
  |---|---|
  | Før | `WARNING - the flow has 14 warning(s). (see above) ('stringVariable' i '/inboundEmail/variables/stringVariable')` |
  | Nu | `A data action must be selected. (Call Data Action i /inboundEmail/states/state[Initial State_11]/actions/callData[…])` |

  `RollupErrorCount` springes over — det er de samme fejl talt op et niveau højere ("There is one action in error within this task") og ville fordoble hver linje.

- **Stien der blev hægtet på, hørte ikke til fejlen.** `Path:` og `Property name:` blev fundet med `find()` gennem hele udskriften — altså den **første** forekomst. I et flow med mange variabler er det en linje om variabelbehandling hundrede linjer tidligere. Archy skriver dem som indrykkede detaljer *lige under* deres overskrift, og de hentes nu kun dér.

  Målt på en anden rigtig udskrift forsvandt `('stringVariable' i '/inboundEmail/variables/stringVariable')` fra en fejl om en tvetydig data action, som den intet havde med at gøre.

**8 nye tests**, bygget på Archys rigtige udskrifter fra de to migreringer. Efterprøvet ved at genindføre hver af de seks fejl én ad gangen: **alle seks blev fanget.**

**🇬🇧 English**
- **Warnings won over errors.** Archy prints the warning summary *after* the error summary, and the backwards search from the terminator hit it every time. An `ERROR` line now wins over a `WARNING` line.
- **The counts say nothing anyway.** The usable text is in Archy's `Validation Results` block, together with the object and the ref path; that is now read instead. `A data action must be selected. (Call Data Action i /inboundEmail/…/callData[…])` rather than `the flow has 14 warning(s)`.
- **The attached path did not belong to the error.** `Path:` and `Property name:` were found with `find()` across the whole output — the first occurrence anywhere. They are now taken only from the indented detail lines directly beneath the chosen headline.

**8 new tests**, built from Archy's real output. Verified by reintroducing each of the six bugs one at a time: all six were caught.

---

### v1.36.0
---
**🇩🇰 Dansk**

Tre huller lukket. Alle tre blev **efterprøvet åbne først** — det er derfor de står beskrevet med hvad de faktisk gjorde og ikke med hvad de kunne have gjort.

- **`/api/files/content` udleverede hele `customers.json`.** Tjekket var `filePath.startsWith(FLOWS_DIR)` på den rå streng, uden `path.resolve`. En sti som `…\flows\..\customers.json` *begynder* rigtigt og pegede alligevel ud af mappen:

  ```
  før: GET /api/files/content?filePath=…\flows\..\customers.json
       → 200, 12 kunder med clientId og clientSecret
  nu:  → 400 {"error":"Ugyldig filsti — kun filer under flows/"}
  ```

  Den rigtige kode stod allerede i samme fil ved `/api/migrate/commit`. Nu bruger begge — og oprydningen — den samme `insideFlowsDir()`.

- **`/api/import` kunne skrive hvor som helst.** `fileName` kom fra klienten og gik direkte i `path.join(importDir, fileName)`. Målt: `../../../BEVIS-traversal.yaml` landede i `C:\Tools\` — tre niveauer over `flows/`. Skrivningen skete *før* demo-vagten, så den ramte uanset miljø, og kunne have overskrevet `customers.json`, `server.js` eller `start.bat`.

  `safeFileName()` skræller nu mapper og `..` af og beholder kun selve navnet. Prøvet igen bagefter: filen lander i importmappen, og der er ingen fil uden for `flows/`.

- **Et anførselstegn i et flownavn kunne køre kommandoer.** `runArchy` kalder `exec` med `shell: 'cmd.exe'`, og inde i en citeret streng kan `"` ikke escapes i cmd — det *afslutter* citatet. Målt med nyttelasten

  ```
  uskyldigt" & echo naaet-igennem> "fil.txt" & rem
  ```

  at det indsatte `echo` kørte. Værdien kom fra `req.body`, så enhver der kunne nå serveren kunne køre kommandoer.

  Der findes ingen escape der virker i cmd, så værdien afvises i stedet — målt på **517 rigtige flownavne i fire orgs indeholder ingen et anførselstegn**. Tre steder var åbne, ikke ét:

  | Sted | Før | Nu |
  |---|---|---|
  | `--flowName` | `"${flowName}"` | `archyArg()` — citerer, afviser `"` |
  | `--flowType` | helt uciteret | `archyBareArg()` — kun `[A-Za-z0-9_.-]` |
  | Underkommandoen | `action \|\| 'create'` fra `req.body` | `archyVerb()` — kun create, update, publish |

  `archyCredFlags` erstattede `"` med `\"`. Den escape virker i en POSIX-skal, ikke i cmd, så et client secret med et anførselstegn ville være brudt ud på samme måde. Den bruger nu `archyArg` som alt andet.

- **Et mislykket opslag i mål-org'en blev læst som "alt mangler".** `try { existing = await lookupExisting(…) } catch (_) {}` gav en tom mængde, og så oprettede migreringen datatabeller og data actions i mål-org'en **som allerede lå der**. Et udløbet token eller en manglende rettighed var nok: opslaget svarer 401 og kaster — det målte jeg mod det rigtige API. Uvished er ikke fravær, så fejlen kommer nu frem med `describeApiError` og migreringen stopper i stedet for at skrive i blinde. To steder.

**20 nye tests.** Skrevet mod de angreb der virkede, ikke mod en teori. Efterprøvet ved at genindføre hver af de syv fejl i `server.js` én ad gangen: **alle syv blev fanget.** To af dem slap forbi den første udgave af testene — en test af `safeFileName` alene fælder ikke nogen der fjerner *kaldet* — så der kom tests til der rammer selve ruten.

Efter rettelserne: en rigtig eksport fra en rigtig org virker uændret (`Notify Flow Error_v2-0.yaml`, 4.290 tegn, rigtigt navn i YAML'en), YAML Filer viser og åbner sine 147 filer, og alle 11 sider i fem sprog kører uden konsolfejl.

**🇬🇧 English**
- **`/api/files/content` served the whole of `customers.json`.** The check was a raw `startsWith` without `path.resolve`, so `…\flows\..\customers.json` passed. Now `insideFlowsDir()`, shared with the other two path checks.
- **`/api/import` could write anywhere.** `fileName` went straight into `path.join`; measured, `../../../BEVIS-traversal.yaml` landed in `C:\Tools\`. `safeFileName()` now keeps only the name itself.
- **A double quote in a flow name could run commands.** `exec` runs through `cmd.exe`, where `"` cannot be escaped inside a quoted string — measured, the injected command ran. Three interpolation points were open (`--flowName`, the unquoted `--flowType`, and the subcommand from `req.body.action`); all three now go through `archyArg` / `archyBareArg` / `archyVerb`. `archyCredFlags` used a POSIX-style `\"` escape that cmd does not honour, and now uses the same helper.
- **A failed lookup in the target org read as "everything is missing"** — the migration then created datatables and data actions that were already there. The error now surfaces and the migration stops.

**20 new tests**, written against the attacks that worked. Verified by reintroducing each of the seven bugs one at a time: all seven were caught. A real export from a real org still works unchanged.

---

### v1.35.1
---
**🇩🇰 Dansk**
- **`cors` fjernet fra afhængighederne.** Pakken har aldrig været `require`'et — hverken i `server.js` eller andre steder. Den lå i `package.json` og blev hentet ved hver `npm install` uden at gøre noget. Serveren lytter kun på loopback og har ingen anden oprindelse at tale med, så der er heller ikke brug for den.

- **Tre døde funktioner fjernet fra klienten:**

  | Funktion | Hvorfor den var død |
  |---|---|
  | `toggleTheme()` | Temaet skiftes af rullelisten `themeSelect`, som kalder `setTheme(this.value)`. Der findes ingen knap der skifter frem og tilbage |
  | `filterFlows()` | Alias "bevaret for ældre kald" — alle fem kald i Flow Browser går direkte til `applyFlowFilter()` |
  | `filterMigrateFlows()` | Samme historie: syv kald, alle til `applyMigrateFilter()` |

  Bekræftet før sletning: hver af de tre optrådte **kun** på sin egen definitionslinje i hele projektet, og der er ingen dynamiske kald (`window[...]`, `eval`) der kunne have ramt dem. Efter oprydningen har `index.html` 184 funktioner og **ingen** uden kald.

  Efterprøvet i brugerfladen: alle fire temaer skifter stadig gennem rullelisten, og begge filtre virker — Flow Browser går fra 121 til 14 rækker på "bot" og til 11 på typen `BOT`, og migreringslisten går fra 121 til 14 og tilbage igen. Alle 11 sider og alle fem sprog uden konsolfejl.

**🇬🇧 English**
- **`cors` removed from the dependencies.** It was never required anywhere. The server listens on loopback only and has no other origin to talk to.
- **Three dead client functions removed:** `toggleTheme()` (the theme is changed by the `themeSelect` dropdown), and the `filterFlows()` / `filterMigrateFlows()` aliases kept for callers that no longer exist. Each appeared only on its own definition line in the whole project. `index.html` now has 184 functions and none without callers.

  Verified in the UI: all four themes still switch, both filters still narrow and reset correctly, all 11 pages and five languages with no console errors.

---

### v1.35.0
---
**🇩🇰 Dansk**
- **Trin-rækkefølgen og versionsendelsen står nu ét sted.** De stod tre steder — i `server.js`, i klientens sortering af miljøer, og i klientens aflæsning af `_v10` på et flownavn. Ændrede man den ene, opdagede man først de to andre når tavlen sorterede forkert, og **en tavle der sorterer forkert siger noget usandt om hvad der er forfremmet hvorhen.**

  Reglerne bor i `STAGES` og `VERSION_SUFFIX` i `server.js`. Klienten henter dem fra **`/konventioner.js`**, som serveren genererer ud fra netop de to. Det er et `<script>` i sidehovedet frem for et API-kald: så er reglerne sat før nogen anden kode kører, og der er ingen rækkefølge at få galt i halsen.

  Fire steder i klienten skrev listen af og gør det ikke længere:

  | Sted | Før | Nu |
  |---|---|---|
  | Kundetræet i sidebaren | `['dev','test','uat','prod']` | `byStage` |
  | Miljøerne for den kunde der er i fokus | samme liste igen | `byStage` |
  | Trin-rullelisten på kundekortet | fire faste `<option>` i HTML'en | `fillStages()` |
  | Trin i den indlejrede gruppe-editor | listen en tredje gang | `STAGES` |

  Aflæsningen af versionsendelsen på tavlen (`_v(\d+)$`) kommer nu fra samme sted som serverens omdøbning.

- **Kommer `/konventioner.js` ikke igennem, siges det.** Reglerne gættes ikke — klienten viser et rødt bånd om at trin-rækkefølgen og versionsendelsen er ukendte. En tavle der sorterer efter gættede regler er værre end en der siger at den ikke ved det.

- **Syv nye tests spærrer for at det skrider igen.** De læser både `server.js` og `index.html` og fælder hvis reglerne bliver skrevet af på ny; én af dem starter serveren på en ledig port og tjekker at `/konventioner.js` svarer med præcis det serveren selv bruger. Efterprøvet ved at genindføre hver af de tre måder at bryde det på — afskrift af listen, afskrift af regexen, og fjernelse af `<script>`-linjen: alle tre blev fanget.

**🇬🇧 English**
- **The stage order and the version suffix now exist in one place.** They lived in three: `server.js`, the client's environment sorting, and the client's reading of `_v10` on a flow name. Change one and you found the other two only when the board sorted wrongly — and a board that sorts wrongly says something untrue about what has been promoted where.

  The rules live in `STAGES` and `VERSION_SUFFIX` in `server.js`. The client loads them from **`/konventioner.js`**, generated by the server from those two. A `<script>` in the head rather than an API call, so the rules are in place before any other code runs.

- **If `/konventioner.js` fails to load, the client says so** — a red banner, rather than guessing the rules.

- **Seven new tests keep it that way.** They read both `server.js` and `index.html` and fail if the rules are copied out again; one starts the server on a free port and checks that `/konventioner.js` serves exactly what the server itself uses.

---

### v1.34.0
---
**🇩🇰 Dansk**
- **74 enhedstests af de rene funktioner.** `npm test`. Programmet havde nul tests, og netop de funktioner der her er dækket, har hver især haft mindst én fejl der nåede ud til brugeren. Testene er derfor skrevet som spærringer mod de fejl vi allerede har haft — ikke som dokumentation af hvad koden gør:

  | Område | Spærrer mod |
  |---|---|
  | Navne og versioner | `testest_v10_v15` efter to forfremmelser; rækken i manifestet der blev forældreløs ved hver omdøbning; Genesys' interne kladde-id vist som et versionsnummer |
  | Miljøer og præfikser | at prod ser hele org'en, dev og test inklusive; at køer og skills bliver præfikset selvom de er fælles |
  | Grupper og vagten | migrering på tværs af kunder; publicering til prod uden bekræftelse; to uopsatte miljøer der læses som "hører sammen" |
  | YAML | omdøbning der rammer et task-navn i stedet for flowets eget; DEV-flowet der peger tilbage på prods datatabel; en fejlfri kopi meldt som afvigende |
  | Fejltekster | `Property name: 'voice'` i stedet for den sætning man kan handle på; "ugyldige credentials" ved en certifikatfejl; `Bad Request` uden årsagen fra `details[]` |
  | Maskering | at et client secret slipper ud i `server.log` eller systemloggen |

  Testene kræver ingen pakker ud over Node selv (`node --test`), og de rører hverken en Genesys-org, en fil eller Archy.

  **Efterprøvet:** hver af de otte gamle fejl blev genindført i `server.js` én ad gangen, testene kørt, og filen sat tilbage. Alle otte blev fanget. En test der ikke fælder sin egen fejl er værdiløs, og det er den eneste måde at vide det på.

- **Danske ressourcenavne blev ikke fundet i afhængighedsscanningen.** Fundet af testene. Regexerne brugte `\w`, som kun dækker ASCII, så en tabel ved navn `Åbningstider` eller et common module ved navn `Fælles logning` blev læst som **ingenting** — flowet fremstod uden afhængigheder, både i rapporten og når migreringen skulle tage dem med. Tegnklassen dækker nu også æ, ø, å og resten af Latin-1.

  Målt på alle 155 eksporterede YAML-filer: **0 forskelle** — ingen af dem bruger tilfældigvis de bogstaver i en referenceposition, så intet eksisterende svar ændrer sig. Hullet er lukket før nogen faldt i det.

- **`server.js` kan indlæses uden at starte serveren.** `app.listen` og døgn-intervallet kører nu kun når filen KØRES (`require.main === module`). Uden det ville `npm test` binde port 3737 og aldrig afslutte af sig selv. De rene funktioner eksporteres til sidst i filen.

**🇬🇧 English**
- **74 unit tests of the pure functions.** `npm test`. The app had zero tests, and each of the functions covered here has had at least one bug that reached the user. The tests are therefore written as guards against the bugs we have already had — not as documentation of what the code does. They cover promotion naming, environment prefixes, the group and prod guards, YAML rewriting and comparison, Archy and Genesys error messages, and client-secret redaction. No packages beyond Node itself (`node --test`), and nothing touches a Genesys org, a file, or Archy.

  **Verified:** each of eight past bugs was reintroduced into `server.js` one at a time, the tests run, and the file restored. All eight were caught.

- **Nordic resource names were invisible to the dependency scan.** Found by the tests. The regexes used `\w`, which is ASCII only, so a table named `Åbningstider` or a common module named `Fælles logning` was read as nothing — the flow appeared to have no dependencies, both in the report and when the migration was meant to carry them along. The character class now covers æ, ø, å and the rest of Latin-1. Measured across all 155 exported YAML files: **0 differences**, so no existing answer changes.

- **`server.js` can be required without starting the server.** `app.listen` and the daily interval now run only when the file is executed (`require.main === module`); otherwise `npm test` would bind port 3737 and never exit.

---

### v1.33.0
---
**🇩🇰 Dansk**
- **Serveren lytter kun på maskinen selv.** `app.listen(PORT, …)` uden vært binder til `0.0.0.0`, så programmet var åbent for hele netværket — uden nogen form for adgangskontrol. Enhver der kunne nå port 3737 kunne liste kunderne, se deres client-id'er og migrere til produktion.

  Målt før og efter:

  ```
  før:  TCP 0.0.0.0:3737    LISTENING     via 192.168.1.209 → svarede
  nu:   TCP 127.0.0.1:3737  LISTENING     via 192.168.1.209 → afvist
  ```

  Sæt `HOST` hvis den bevidst skal nås udefra — men så bør der komme adgangskontrol foran først.

- **Store flows kan importeres igen.** `express.json()` bruger 100 KB som standard, og **ni af de 153 eksporterede YAML-filer her er over den grænse** — `Main flow` på 626 KB, `DEV_Main flow` på 594 KB, den største på 800 KB. De svarede `413` uden nogen forklaring. Grænsen er nu 25 MB, og den 800 KB store fil kommer hele vejen igennem.

- **Fejl kommer tilbage som JSON.** Der var ingen fejl-middleware, så Express svarede med sin egen HTML-side — mens hele brugerfladen kalder `.json()`. En fejl blev derfor vist som `Unexpected token '<'` i stedet for det der gik galt.

  | Situation | Før | Nu |
  |---|---|---|
  | Ukendt `/api`-sti | HTML | `404 {"error":"Ukendt endpoint: GET /api/…"}` |
  | Ugyldig JSON i kroppen | HTML | `400` med parserens egen besked |
  | Krop over grænsen | HTML | `413 {"error":"Indholdet er for stort…"}` |
  | Uventet fejl | HTML | `500` med beskeden, og en linje i systemloggen |

- **To ting mere, fundet undervejs:** `/api/import` tjekkede ikke sit input, så et manglende felt kom ud som Node's `The "data" argument must be of type string`. Og Archy-vejene gik ikke gennem `getToken`, så et demo-miljø nåede helt frem til Archy og fik en uforståelig fejl om at `demo` ikke er en gyldig Genesys-region. Begge siger nu hvad der er galt.

---
**🇬🇧 English**
- **The server now listens only on the machine itself.** `app.listen(PORT, …)` without a host binds to `0.0.0.0`, so the program was open to the whole network — with no access control of any kind. Anyone who could reach port 3737 could list the customers, see their client ids, and migrate to production.

  Measured before and after:

  ```
  before:  TCP 0.0.0.0:3737    LISTENING     via 192.168.1.209 → answered
  now:     TCP 127.0.0.1:3737  LISTENING     via 192.168.1.209 → refused
  ```

  Set `HOST` if it is deliberately meant to be reachable from outside — but access control should come first.

- **Large flows can be imported again.** `express.json()` defaults to 100 KB, and **nine of the 153 exported YAML files here exceed it** — `Main flow` at 626 KB, `DEV_Main flow` at 594 KB, the largest at 800 KB. They answered `413` with no explanation. The limit is now 25 MB, and the 800 KB file goes all the way through.

- **Errors come back as JSON.** There was no error middleware, so Express replied with its own HTML page — while the entire UI calls `.json()`. An error therefore appeared as `Unexpected token '<'` instead of what went wrong.

  | Situation | Before | Now |
  |---|---|---|
  | Unknown `/api` path | HTML | `404 {"error":"Unknown endpoint: GET /api/…"}` |
  | Invalid JSON body | HTML | `400` with the parser's own message |
  | Body over the limit | HTML | `413 {"error":"The content is too large…"}` |
  | Unexpected error | HTML | `500` with the message, and a line in the system log |

- **Two more, found along the way:** `/api/import` did not validate its input, so a missing field surfaced as Node's `The "data" argument must be of type string`. And the Archy paths did not go through `getToken`, so a demo environment reached Archy and got an incomprehensible error about `demo` not being a valid Genesys region. Both now say what is wrong.

---

### v1.32.2
---
**🇩🇰 Dansk**
- **`getaddrinfo ENOTFOUND login.demo` er væk overalt, ikke bare ét sted.** Sidste rettelse tog kun "På tværs af kunder". Femten kode-veje kalder `getToken()`, og hver eneste af dem forsøgte at logge ind på `login.demo` for et demo-miljø.

  Vagten ligger nu i **`getToken()` selv**, så ingen ny vej kan lave fejlen igen. I stedet for en netværksfejl står der hvad der faktisk er på færde:

  > *"Demo A/S — DEV" er et demo-miljø — det findes kun lokalt, så denne funktion har ingen org at spørge. Brug Pipeline til at prøve forfremmelser af.*

- **Flowlisten virker nu i demoen.** Den er kernen i Flow Browser, Migrer Flow og Export, så den læser fra demolageret — med præfiks-filtrering, så et `DEV_`-miljø kun ser sine egne. Før stod Flow Browser med en rød DNS-fejl.
- **Test-knappen svarer ærligt:** *"Demo-miljø — ingen forbindelse nødvendig. 3 flows lokalt."* Der er ingen forbindelse at afprøve.
- Køer, prompts, datatabeller, integrationer og Archy-vejene findes ikke i demoen og siger det nu klart, i stedet for at fejle på DNS.

---
**🇬🇧 English**
- **`getaddrinfo ENOTFOUND login.demo` is gone everywhere, not just in one place.** The last fix only covered "Across customers". Fifteen code paths call `getToken()`, and every one of them tried to sign in to `login.demo` for a demo environment.

  The guard now sits in **`getToken()` itself**, so no new path can reproduce it. Instead of a network error it says what is actually going on:

  > *"Demo A/S — DEV" is a demo environment — it exists only locally, so this function has no org to ask. Use Pipeline to try promotions out.*

- **The flow list now works in the demo.** It is the core of Flow Browser, Migrate Flow and Export, so it reads from the demo store — with prefix filtering, so a `DEV_` environment sees only its own. Flow Browser previously showed a red DNS error.
- **The Test button answers honestly:** *"Demo environment — no connection needed. 3 flows locally."* There is no connection to test.
- Queues, prompts, datatables, integrations and the Archy paths do not exist in the demo and now say so plainly, instead of failing on DNS.

---

### v1.32.1
---
**🇩🇰 Dansk**
- **Rettet: "På tværs af kunder" forsøgte at logge ind på demo-miljøerne.** Siden løb alle kunder igennem og hentede en token — men demo-miljøer har region `demo` og ingen credentials, så den fyldte listen med `getaddrinfo ENOTFOUND login.demo`, én linje pr. demo-miljø. Den læser nu fra demolageret, ligesom pipelinen gør. Otte advarsler blev til nul.
- **Siden parrer nu på grundnavnet.** `DEV_Ordreflow` og `Ordreflow` tælles som det samme flow, og hver org viser sit eget navn. Sammenligningen slår hvert miljø op under **dets** navn — før ledte den efter `Ordreflow` i et miljø hvor flowet hedder `DEV_Ordreflow`.

- **Rettet: en nulstilling af demo 1 slettede demo 2.** `seedDemo()` skrev hele demofilen på én gang, så demo 2's flows og begge demoers manifester forsvandt. Den fletter nu ind i det der allerede ligger og rører kun sine egne nøgler. Samme oprydning i demo 2, så en nulstilling giver en ren tavle uden at ramme naboen.

  Det var også derfor demo 2's flows manglede på tværs-siden: de var væk fra filen, ikke filtreret fra.

---
**🇬🇧 English**
- **Fixed: "Across customers" tried to sign in to the demo environments.** The page walked every customer and fetched a token — but demo environments have region `demo` and no credentials, so it filled the list with `getaddrinfo ENOTFOUND login.demo`, one line per demo environment. It now reads from the demo store, as the pipeline does. Eight warnings became none.
- **The page now pairs on the base name.** `DEV_Ordreflow` and `Ordreflow` count as the same flow, and each org shows its own name. The comparison looks each environment up under **its** name — previously it searched for `Ordreflow` in an environment where the flow is called `DEV_Ordreflow`.

- **Fixed: resetting demo 1 deleted demo 2.** `seedDemo()` wrote the whole demo file at once, so demo 2's flows and both demos' manifests disappeared. It now merges into what is already there and touches only its own keys. The same tidy-up in demo 2, so a reset gives a clean slate without hitting the neighbour.

  That was also why demo 2's flows were missing from the across-customers page: they were gone from the file, not filtered out.

---

### v1.32.0
---
**🇩🇰 Dansk**
- **Division pr. miljø.** Divisionen hører til miljøet, ikke til flowet: opretter man i division DEV og forfremmer til UAT, flytter flowet og tabellen med. Er der ingen sat, bruges Home.

  Den vælges fra en **rulleliste med orgens egne divisioner** — et frit tekstfelt ville før eller siden give en stavefejl der først viser sig som en mislykket import. Kan listen ikke hentes, siges det, og den nuværende værdi bevares, så et miljø ikke stiltiende mister sin division.

  Kun flowets **egen** division skrives om; udtryk som `Task.division` længere nede står urørt. Datatabeller oprettes i målmiljøets division.

- **Sammenligningen ser bort fra divisionen**, ligesom fra præfikset. Divisionen *skal* være forskellig mellem miljøerne, så uden dette ville en fejlfri forfremmelse fra DEV til UAT altid melde "afviger" på netop den linje. Afprøvet: samme flow i DEV og UAT med forskellig division **og** forskelligt præfiks melder nu *i trit*, mens én ændret værdi stadig melder *afviger*.

- **Kunden bliver i fokus når man skifter fane.** Arbejder man med Kunde 2 i pipelinen og går til Migrer Flow, landede man før på demoen — den stod bare først i listen. Pipelinen husker nu hvilken kunde og gruppe man er i gang med, og Migrer Flow forudfylder kilde og mål med kundens to tidligste trin. Det overlever en genindlæsning.

- **Prod publiceres ikke som standard.** Alt andet publiceres ved ankomst, så det er i drift med det samme; prod lægges som kladde nogen selv skal publicere. Handlingsvalget skriver hvad det gør og hvorfor.

- **Kunderne i sidebjælken er nu et træ.** Ti kunder á fire miljøer gav fyrre punkter under hinanden uden at man kunne se hvad der hørte sammen. Nu ses kunderne med antal miljøer, og et klik folder dem ud. Hvad der er foldet ud huskes.

- **Hjælp til hvert område.** En `?`-knap ved hver sides titel — og ved Flow Builder — åbner en forklaring af hvad siden gør og hvordan man bruger den. Elleve områder, på alle fem sprog.

  > Knappen ligger **ved siden af** overskriften, ikke inde i den: `applyLang()` sætter `textContent` på alt med `data-i18n`, og et barn-element ville blive slettet ved første sprogskift. Det skete faktisk, og ti af elleve knapper forsvandt.

---
**🇬🇧 English**
- **Division per environment.** The division belongs to the environment, not the flow: create in division DEV and promote to UAT, and the flow and table move with it. If none is set, Home is used.

  It is chosen from a **dropdown of the org's own divisions** — a free text field would eventually produce a typo that only surfaces as a failed import. If the list cannot be fetched, it says so and keeps the current value, so an environment does not quietly lose its division.

  Only the flow's **own** division is rewritten; expressions such as `Task.division` further down are left alone. Datatables are created in the target environment's division.

- **The comparison ignores the division**, as it already did the prefix. The division *must* differ between environments, so without this a flawless promotion from DEV to UAT would always report "differs" on that one line. Tested: the same flow in DEV and UAT with a different division **and** a different prefix now reports *in step*, while a single changed value still reports *differs*.

- **The customer stays in focus across tabs.** Work on Kunde 2 in the pipeline, go to Migrate Flow, and you used to land on the demo — it simply came first in the list. The pipeline now remembers which customer and group you are working on, and Migrate Flow prefills source and target with that customer's two earliest stages. It survives a reload.

- **Prod is not published by default.** Everything else is published on arrival so it is live straight away; prod is left as a draft for someone to publish. The action selector says what it is doing and why.

- **The customers in the sidebar are now a tree.** Ten customers with four environments each gave forty entries in a row with no way to see what belonged together. Now you see the customers with a count, and a click expands them. What is expanded is remembered.

- **Help for each area.** A `?` button beside each page title — and beside Flow Builder — opens an explanation of what the page does and how to use it. Eleven areas, in all five languages.

  > The button sits **beside** the heading, not inside it: `applyLang()` sets `textContent` on everything with `data-i18n`, and a child element would be wiped on the first language change. That actually happened, and ten of eleven buttons vanished.

---

### v1.31.0
---
**🇩🇰 Dansk**
- **`N udgaver foran trinnet før` undertrykkes når flowet kom baglæns.** Fingerpeget bygger på at arbejdet flyder opstrøms → ned, så et højere udgavetal nedstrøms er mistænkeligt. Men henter man prod ned i et nyt dev, er rækkefølgen vendt om **med vilje**, og prods tæller er naturligt højere. Uden dette ville hvert eneste flow stå rødt dagen efter man satte dev op.

  Viser manifestet at det tidligere trin blev hentet **fra** dette, springes fingerpeget over. Afprøvet i demoen: prod stod med *9 udgaver foran* før, og **0** efter at uat var hentet fra prod.

- **Rettet: demoens forfremmelse skrev manifestrækken under en nøgle der aldrig blev læst.** Den sendte det præfiksede navn — `UAT_Betaling|INBOUNDCALL` — mens tavlen slår op på grundnavnet `Betaling|INBOUNDCALL`. Rækken var der, men usynlig. Samme fejl som jeg rettede i den rigtige migreringsvej i v1.30.0; demoens var overset.

- **Rettet: README viste begge sprog på én gang.** Siden delte teksten på to `---` i træk — et mønster der forsvandt da changeloggen flyttede ud i v1.28.0. Delingen sker nu på **sprogankrene**, som står i filen netop for at kunne linke til hvert sprog.
- **README følger appens sprogvalg.** De to flag-faner er væk; vælger man engelsk i toppen, skifter vejledningen med. Dansk viser dansk, alle andre sprog viser den engelske vejledning — der findes ikke andre.

---
**🇬🇧 English**
- **`N versions ahead of the previous stage` is suppressed when the flow came backwards.** The indication rests on work flowing upstream → down, so a higher version count downstream is suspicious. But pull prod down into a fresh dev and the order is inverted **deliberately**; prod's counter is naturally higher. Without this, every single flow would sit red the day after you set dev up.

  If the manifest shows the earlier stage was pulled **from** this one, the indication is skipped. Tested in the demo: prod read *9 versions ahead* before, and **0** after uat was pulled from prod.

- **Fixed: the demo's promotion wrote the manifest row under a key that is never read.** It passed the prefixed name — `UAT_Betaling|INBOUNDCALL` — while the board looks up the base name `Betaling|INBOUNDCALL`. The row was there but invisible. The same fault I fixed in the real migration path in v1.30.0; the demo's copy was missed.

- **Fixed: the README showed both languages at once.** The page split the text on two consecutive `---`, a pattern that disappeared when the changelog moved out in v1.28.0. It now splits on the **language anchors**, which exist in the file precisely so each language can be linked.
- **The README follows the app's language.** The two flag tabs are gone; pick English at the top and the guide follows. Danish shows Danish, every other language shows the English guide — there are no others.

---

### v1.30.1
---
**🇩🇰 Dansk**
- **Rettet: indholdstjekket meldte "afviger" på en fejlfri kopi.** To ting, begge målt frem for gættet.

  **1. Præfikset talte med i hashen.** Flowets navn og dets referencer *skal* være forskellige i et præfikset miljø — det er hele pointen — men de indgik i sammenligningen. En byte-perfekt forfremmelse afveg derfor altid på præcis to linjer:

  ```
  prod: name: WeekNumber              prod: By Week Routing:
  dev : name: DEV_WeekNumber          dev : DEV_By Week Routing:
  ```

  Miljøets præfiks fjernes nu fra både navnet og `dataTable:`/`commonModule:`-referencerne **inden** der hashes. En rigtig forskel fanges stadig — afprøvet med én ændret værdi.

  **2. En tom beskrivelse talte med.** Archy skriver `description: ""` ud på et nyoprettet flow, men udelader linjen på et der aldrig har haft en beskrivelse. Kopien fik altså én linje mere end kilden. Tomme beskrivelser springes nu over; en beskrivelse med indhold tæller stadig.

  Mod de rigtige orgs: `WeekNumber` i prod og `DEV_WeekNumber` i dev gav før to forskellige hashes, nu den samme — **i trit**.

> **Bemærk om forskels-visningen.** Sammenligningen stiller linje 1 op mod linje 1, linje 2 mod linje 2 og så videre. Én indsat linje forskyder alt derefter, så en enkelt forskel kan vises som hundredvis. Hashen er upåvirket — den er den der afgør sagen — men listen af forskelle skal læses med det i baghovedet.

---
**🇬🇧 English**
- **Fixed: the content check reported "differs" on a flawless copy.** Two causes, both measured rather than guessed.

  **1. The prefix counted towards the hash.** A flow's name and its references *must* differ in a prefixed environment — that is the whole point — yet they went into the comparison. A byte-perfect promotion therefore always differed on exactly two lines:

  ```
  prod: name: WeekNumber              prod: By Week Routing:
  dev : name: DEV_WeekNumber          dev : DEV_By Week Routing:
  ```

  The environment's prefix is now removed from both the name and the `dataTable:`/`commonModule:` references **before** hashing. A real difference is still caught — tested with a single changed value.

  **2. An empty description counted.** Archy writes `description: ""` on a newly created flow but omits the line on one that never had a description, so the copy had one line more than the source. Empty descriptions are now skipped; a description with content still counts.

  Against the real orgs: `WeekNumber` in prod and `DEV_WeekNumber` in dev previously produced two different hashes, now the same — **in step**.

> **A note on the difference list.** The comparison lines up line 1 against line 1, line 2 against line 2 and so on. One inserted line shifts everything after it, so a single difference can be displayed as hundreds. The hash is unaffected — that is what decides — but the list of differences should be read with this in mind.

---

### v1.30.0
---
**🇩🇰 Dansk**
- **Rettet: afhængigheder blev ikke præfikset — så flowet i DEV pegede tilbage på prods data.** `WeekNumber` blev migreret til `DEV_WeekNumber`, men tabellen `By Week Routing` fulgte ikke med, og flowet pegede stadig på prods tabel. Dev og prod ville have delt data, hvilket er lige præcis dét adskillelsen skal forhindre.

  Der var to fejl bag:

  | | Hvad der skete |
  |---|---|
  | **Tjekket** | slog `By Week Routing` op i mål-**org'en**. Den findes jo — det er samme org — så tjekket sagde "alle afhængigheder findes". Det skulle have ledt efter `DEV_By Week Routing`. |
  | **Importen** | omskrev flowets eget navn, men ikke dets referencer. |

- **Hvilke typer der bærer præfikset er nu udtrykkeligt afgjort:**

  | Type | Præfiks | Hvorfor |
  |---|---|---|
  | datatabeller | ja | konventionen i orgen |
  | flows og common modules | ja | et common module *er* et flow |
  | køer, skills, wrap-up-koder, scripts | nej | fælles for hele org'en, duplikeres ikke pr. miljø |
  | data actions | nej indtil videre | de hører til en integration, og om man duplikerer dem pr. miljø afhænger af opsætningen |

  Ville vi præfikse en kø, ledte vi efter noget der aldrig har eksisteret.

- **Referencer omskrives ved import.** `dataTable:` og `commonModule:` i YAML'en peges om til målmiljøets navne, og hver omskrivning står i loggen: *Reference omskrevet: By Week Routing → DEV_By Week Routing*. Afprøvet mod det rigtige `WeekNumber`-flow: præcis én linje ændret, køer og data actions urørt.
- **Dialogen viser målnavnet** — `By Week Routing → DEV_By Week Routing` — så man kan se hvad der bliver oprettet, i stedet for at tro at prods tabel genbruges.

> **Det `DEV_WeekNumber` der allerede er oprettet peger på prods tabel.** Slet det og kør migreringen igen, så kommer tabellen med og referencen bliver rettet.

---
**🇬🇧 English**
- **Fixed: dependencies were not prefixed — so the flow in DEV pointed back at prod's data.** `WeekNumber` was migrated to `DEV_WeekNumber`, but the table `By Week Routing` did not come along, and the flow still pointed at prod's table. Dev and prod would have shared data, which is precisely what the separation exists to prevent.

  Two faults behind it:

  | | What happened |
  |---|---|
  | **The check** | looked `By Week Routing` up in the target **org**. It is there — it is the same org — so the check said "all dependencies exist". It should have looked for `DEV_By Week Routing`. |
  | **The import** | rewrote the flow's own name but not its references. |

- **Which types carry the prefix is now decided explicitly:**

  | Type | Prefixed | Why |
  |---|---|---|
  | datatables | yes | the convention in the org |
  | flows and common modules | yes | a common module *is* a flow |
  | queues, skills, wrap-up codes, scripts | no | shared across the whole org, not duplicated per environment |
  | data actions | not for now | they belong to an integration, and whether you duplicate them per environment depends on the setup |

  Prefixing a queue would mean looking for something that never existed.

- **References are rewritten on import.** `dataTable:` and `commonModule:` in the YAML are repointed to the target environment's names, and each rewrite is logged: *Reference rewritten: By Week Routing → DEV_By Week Routing*. Tested against the real `WeekNumber` flow: exactly one line changed, queues and data actions untouched.
- **The dialog shows the target name** — `By Week Routing → DEV_By Week Routing` — so you can see what will be created, rather than assuming prod's table is reused.

> **The `DEV_WeekNumber` already created points at prod's table.** Delete it and run the migration again; the table will follow and the reference will be corrected.

---

### v1.29.1
---
**🇩🇰 Dansk**
- **Rettet: fejludtrækningen greb detaljelinjen i stedet for selve fejlen.** En migrering fejlede med `Property name: 'voice'` — ubrugeligt. Archy havde i virkeligheden skrevet:

  ```
  Command: 'create'
  did not find a text to speech voice with the name 'da-DK-Standard-C'
  for engine 'Genesys Enhanced TTS' in language 'da-dk'.
      Path: '/inboundCall/supportedLanguages/textToSpeech'
      Property name: 'voice'
  ...
  Error(s) and warning(s) encountered.
  ```

  Vi leder baglæns fra `Error(s) … encountered.` efter den første linje der ikke er støj. `Flow Name:` og `Input YAML File:` stod på støjlisten — men **ikke** `Path:` og `Property name:`, så søgningen stoppede på en detaljelinje og kastede den eneste brugbare sætning væk. Detaljerne tæller nu som støj og hægtes i stedet på til sidst:

  > `did not find a text to speech voice with the name 'da-DK-Standard-C' for engine 'Genesys Enhanced TTS' in language 'da-dk'. ('voice' i '/inboundCall/supportedLanguages/textToSpeech')`

- **Rettet: sidefilen blev liggende når importen fejlede.** Den omdøbte `.import-…`-fil ryddes nu op i `finally`, ikke først efter et vellykket kald. Hver mislykket migrering efterlod ellers en fil i eksportmappen.

---
**🇬🇧 English**
- **Fixed: the error extraction grabbed a detail line instead of the error.** A migration failed with `Property name: 'voice'` — useless. What Archy actually wrote was:

  ```
  Command: 'create'
  did not find a text to speech voice with the name 'da-DK-Standard-C'
  for engine 'Genesys Enhanced TTS' in language 'da-dk'.
      Path: '/inboundCall/supportedLanguages/textToSpeech'
      Property name: 'voice'
  ...
  Error(s) and warning(s) encountered.
  ```

  We search backwards from `Error(s) … encountered.` for the first line that is not noise. `Flow Name:` and `Input YAML File:` were on the noise list — but **not** `Path:` and `Property name:`, so the search stopped on a detail line and threw away the only useful sentence. The details now count as noise and are appended instead:

  > `did not find a text to speech voice with the name 'da-DK-Standard-C' for engine 'Genesys Enhanced TTS' in language 'da-dk'. ('voice' in '/inboundCall/supportedLanguages/textToSpeech')`

- **Fixed: the side file was left behind when the import failed.** The renamed `.import-…` file is now cleaned up in a `finally`, not only after a successful call. Every failed migration otherwise left a file in the export directory.

---

### v1.29.0
---
**🇩🇰 Dansk**
- **Rettet: man kunne slet ikke migrere ind i et præfikset miljø.** To ting stod i vejen, og den anden var den alvorlige:

  1. **Der var ingen knap.** Forfremmelse går kun fremad, og `⟵ Hent tilbage` kræver at *begge* sider har flowet. Et tomt `DEV_`-miljø kunne derfor ikke fyldes fra noget som helst.
  2. **Navnet fulgte ikke med.** Importen tog YAML'en som den var, så et flow fra prod ville lande i `DEV_`-miljøet under **prod-navnet** — og bor de to i samme org, er det det samme flow. Archy ville have svaret "already exists".

- **`⟵ Hent hertil`** — på et flow der kun findes senere i kæden kommer der nu en knap der henter det fra det nærmeste senere trin. Det er vejen ind i et tomt dev-miljø.
- **Flowet omdøbes til målmiljøet.** Kildens præfiks af, målets på: `Bank bot` fra prod bliver til `DEV_Bank bot`. Kun **øverste** navnefelt i YAML'en røres — tasks og actions har også `name:`, og de skal stå. Citering bevares.

  > Den omdøbte udgave skrives til en **sidefil**. Den eksporterede fil er vores lokale kopi af kildens flow; skrev vi ovenpå den, ville kopien stille og roligt blive til noget andet.

  Versionsendelsen `_vN` sættes **ikke** på her — den regel kører fortsat kun i demoen, indtil omdøbning i en rigtig org er afprøvet.

- **Datatabeller følger med:** `SystemConfig` fra prod bliver til `DEV_SystemConfig`, og "findes allerede"-tjekket ser på det nye navn. Uden det ville en tabel migreret inden for samme org ramme sig selv.
- Manifestet nøgles på **grundnavnet uden præfiks**, men hver rækkes `flowName` er miljøets eget navn. Ellers ville en kilde med præfiks skrive under én nøgle og blive læst under en anden. Opslaget af målets publicerede udgave bruger nu også målets navn.

- **Tydeligere adskillelse på tavlen:** ramme om hver org, og prod har sin egen tone og rød, fed overskrift. Prod får **ikke** rød baggrund — rødt betyder allerede "noget er galt" på tavlen, og prod er ikke i sig selv en fejl.

---
**🇬🇧 English**
- **Fixed: migrating into a prefixed environment was simply not possible.** Two things blocked it, and the second was the serious one:

  1. **There was no button.** Promotion only moves forward, and `⟵ Pull back` requires *both* sides to hold the flow. An empty `DEV_` environment could therefore not be filled from anything.
  2. **The name did not come along.** The import took the YAML as it was, so a flow from prod would land in the `DEV_` environment under the **prod name** — and if the two live in the same org, that is the same flow. Archy would have answered "already exists".

- **`⟵ Bring here`** — a flow that exists only later in the chain now gets a button that fetches it from the nearest later stage. That is the way into an empty dev environment.
- **The flow is renamed for the target environment.** Source prefix off, target prefix on: `Bank bot` from prod becomes `DEV_Bank bot`. Only the **topmost** name field in the YAML is touched — tasks and actions have `name:` too and must stay. Quoting is preserved.

  > The renamed copy is written to a **side file**. The exported file is our local copy of the source's flow; writing over it would quietly turn that copy into something else.

  The `_vN` version suffix is **not** applied here — that rule still runs only in the demo, until renaming in a real org has been tested.

- **Datatables follow the same convention:** `SystemConfig` from prod becomes `DEV_SystemConfig`, and the "already exists" check looks at the new name. Without it, a table migrated within one org would collide with itself.
- The manifest is keyed on the **base name without prefix**, while each row's `flowName` is the environment's own name. Otherwise a prefixed source would write under one key and be read under another. The lookup of the target's published version now uses the target's name too.

- **Clearer separation on the board:** a frame around each org, and prod gets its own tone with a bold red heading. Prod does **not** get a red background — red already means "something is wrong" on the board, and prod is not itself a fault.

---

### v1.28.0
---
**🇩🇰 Dansk**
- **Changeloggen er flyttet hertil.** README er nu installation og brugervejledning og gik fra 1440 til under 400 linjer.

- **Virtuelle miljøer på præfiks.** Nogle kunder har ikke én org pr. miljø, men **én org hvor miljøerne kendes på et præfiks** — `DEV_Ordreflow`, `TEST_Ordreflow`, og prod uden præfiks. Samme konvention gælder datatabellerne. Mønstret findes allerede i jeres egne orgs (`DEV_Main flow`, `DEV_SystemConfig` i VF NL).

  Et miljø er stadig én post i `customers.json` — flere poster kan blot pege på samme org med hvert sit **præfiks**. Så virker tavlen, forfremmelsen og manifestet uændret; kun udvælgelsen af flows kender præfikset.

  | Miljø | Præfiks | Flow | Manifesttabel |
  |---|---|---|---|
  | dev | `DEV_` | `DEV_Ordreflow` | `DEV_ArchyGUI_Manifest` |
  | prod | *(tomt)* | `Ordreflow` | `ArchyGUI_Manifest` |

  **Prod uden præfiks tager alt der ikke bærer et søskendepræfiks** — ellers ville prod se hele orgen, dev og test inklusive. Afprøvet med alle fire miljøer i samme org: hvert flownavn hører til præcis ét miljø.

- **Forfremmelse skifter præfiks.** Navnet regnes ud på grundnavnet, og præfikset sættes derefter på hver side for sig: `DEV_Fejlbesked` (v4) bliver til `DEV_Fejlbesked_v4` i dev og `TEST_Fejlbesked_v4` i test. Uden det ville modtageren bære afsenderens præfiks.
- **Flowlisten hentes én gang pr. org.** Fire virtuelle miljøer i samme org kostede ellers fire fulde gennemløb af den samme org.
- **Miljøerne grupperes under orgen på tavlen** — en række over kolonnerne med orgens navn og hvor mange miljøer den rummer. Rækken vises kun når mindst én org har flere miljøer; ellers siger den intet nyt.
- **Demo 2** viser mønstret: `DEV_`, `TEST_` og `UAT_` deler én org, prod har sin egen. Demo 1 og 2 kan være oprettet samtidig og rører ikke hinanden. Demo 2 rummer også et efterladt flow uden præfiks i non-prod-org'en, som hører til **intet** miljø og korrekt ikke dukker op.
- Nye felter på et miljø: **Præfiks** og **Org-navn**, både ved oprettelse og under ⚙ Gruppering.

---
**🇬🇧 English**
- **The changelog moved here.** The README is now installation and user guide, down from 1440 lines to under 400.

- **Virtual environments by prefix.** Some customers do not have one org per environment but **one org where environments are told apart by a prefix** — `DEV_Ordreflow`, `TEST_Ordreflow`, and prod with no prefix. The same convention applies to datatables. The pattern already exists in your own orgs (`DEV_Main flow`, `DEV_SystemConfig` in VF NL).

  An environment is still one record in `customers.json` — several records can simply point at the same org with their own **prefix**. The board, promotion and manifest work unchanged; only the selection of flows knows about the prefix.

  | Environment | Prefix | Flow | Manifest table |
  |---|---|---|---|
  | dev | `DEV_` | `DEV_Ordreflow` | `DEV_ArchyGUI_Manifest` |
  | prod | *(empty)* | `Ordreflow` | `ArchyGUI_Manifest` |

  **Prod without a prefix takes everything that does not carry a sibling prefix** — otherwise prod would see the whole org, dev and test included. Tested with all four environments in one org: every flow name belongs to exactly one environment.

- **Promotion swaps the prefix.** The name is computed on the base name, then the prefix is applied to each side separately: `DEV_Fejlbesked` (v4) becomes `DEV_Fejlbesked_v4` in dev and `TEST_Fejlbesked_v4` in test. Without this the receiver would carry the sender's prefix.
- **The flow list is fetched once per org.** Four virtual environments in one org otherwise cost four full sweeps of the same org.
- **Environments are grouped under their org on the board** — a row above the columns with the org's name and how many environments it holds. It appears only when at least one org holds more than one; otherwise it says nothing new.
- **Demo 2** shows the pattern: `DEV_`, `TEST_` and `UAT_` share one org, prod has its own. Demo 1 and 2 can exist at the same time and do not touch each other. Demo 2 also holds a leftover unprefixed flow in the non-prod org, which belongs to **no** environment and correctly does not appear.
- New fields on an environment: **Prefix** and **Org label**, both when creating and under ⚙ Grouping.

---

### v1.27.0
---
**🇩🇰 Dansk**
- **`⭳ Hent som CSV` på pipelinen.** Én række pr. flow, fem kolonner pr. miljø — navn, udgave, publiceringsdato, bemærkning og hvem der noterede det — plus indholdstjekkets udfald til sidst.

  ```
  Flow;Type;DEV navn;DEV udgave;DEV publiceret;DEV bemærkning;DEV noteret af;TEST navn;…;Indhold
  Kundeservice;WORKFLOW;Kundeservice;v3.0;2026-08-05;;;…;v7.0;2026-09-02;6 udgave(r) foran trinnet før;;afviger
  ```

  **Semikolon som skilletegn og UTF-8 med BOM**, så dansk Excel åbner den i kolonner og viser æ, ø og å rigtigt uden at man skal ind i importguiden.

- **Udtrækket følger skærmen.** Søgning og "kun dem der mangler i et senere trin" gælder også CSV'en. Filtreringen og signalerne er flyttet ud i `pipelineRowsShown()` og `cellSignals()`, som **både** tavlen og udtrækket bruger — ellers kunne de to komme til at vise hver sit uden at nogen opdagede det.
- Et flow der ikke er indholdstjekket står som `ikke tjekket`, ikke som tomt felt. Tomt ville læses som "ingen forskel".

- **Rettet, fundet i CSV'ens egen tekst: dev blev udråbt for "publiceret uden om pipelinen".** Manifestrækken i kilden noterer den udgave flowet havde da det blev forfremmet. Arbejder man så videre i dev — hvilket er hele meningen med dev — stod udgaven højere, og markeringen slog til. **Enhver dev-org ville stå rød så snart nogen rørte den.**

  Markeringen gælder nu kun et miljø der **modtog** flowet fra os (rækken har `promotedFrom`). Sendte miljøet det videre (`promotedTo`), er senere publiceringer almindeligt udviklingsarbejde og dækkes af `N udgaver ikke forfremmet`.

  | Miljø | Situation | Før | Nu |
  |---|---|---|---|
  | dev | forfremmet videre, derefter arbejdet på | ✗ uden om pipelinen | ⚠ 5 udgaver ikke forfremmet |
  | test | modtog flowet, derefter publiceret i | ✗ uden om pipelinen | ✗ uden om pipelinen |

---
**🇬🇧 English**
- **`⭳ Download as CSV` on the pipeline.** One row per flow, five columns per environment — name, version, publish date, note, and who recorded it — plus the content check verdict at the end.

  ```
  Flow;Type;DEV name;DEV version;DEV published;DEV note;DEV recorded by;TEST name;…;Content
  Kundeservice;WORKFLOW;Kundeservice;v3.0;2026-08-05;;;…;v7.0;2026-09-02;6 version(s) ahead of the previous stage;;differs
  ```

  **Semicolon separated and UTF-8 with a BOM**, so Danish Excel opens it in columns and shows accented characters correctly without the import wizard.

- **The export follows the screen.** Search and "only those missing in a later stage" apply to the CSV too. The filtering and the signals moved into `pipelineRowsShown()` and `cellSignals()`, used by **both** the board and the export — otherwise the two could drift apart without anyone noticing.
- A flow that has not been content-checked reads `not checked`, not an empty field. Empty would read as "no difference".

- **Fixed, spotted in the CSV's own text: dev was being accused of "published outside the pipeline".** The manifest row in the source records the version the flow had when it was promoted. Keep working in dev — which is the whole point of dev — and the version stands higher, so the marker fired. **Every dev org would have turned red the moment anyone touched it.**

  The marker now applies only to an environment that **received** the flow from us (its row carries `promotedFrom`). If the environment sent it onward (`promotedTo`), later publishes are ordinary development work and are covered by `N versions not promoted`.

  | Environment | Situation | Before | Now |
  |---|---|---|---|
  | dev | promoted onward, then worked on | ✗ outside the pipeline | ⚠ 5 versions not promoted |
  | test | received the flow, then published in | ✗ outside the pipeline | ✗ outside the pipeline |

---

### v1.26.2
---
**🇩🇰 Dansk**
- **`by` bruger nu den rigtige Genesys-bruger når miljøet er logget ind med OAuth (PKCE).** Før skrev den altid pc-brugeren, fordi opslaget aldrig blev forsøgt. Nu spørges `/api/v2/users/me`, og rækken bærer personens e-mail.
- **Med client credentials findes der ingen Genesys-bruger** — det er ikke en mangel, det er sådan tokenet er. Målt mod en rigtig org:

  ```
  GET /api/v2/users/me   →  400  "This request requires a user context.
                                  Client credentials cannot be used..."
  GET /api/v2/tokens/me  →  authenticatedUser: null
  ```

  Så er pc-brugeren det eneste sande vi kan notere. **Rækken siger nu hvilken slags identitet det er** via et nyt felt `bySource`:

  | `bySource` | Betydning |
  |---|---|
  | `genesys` | rigtig Genesys-bruger, fra et PKCE-login |
  | `machine` | pc-bruger — miljøet kører client credentials, så der er ingen Genesys-bruger |

  Museover-teksten skriver det ud, så `skn_d@SKYOGA` ikke forveksles med en Genesys-identitet.

- **`kind` i manifestet har præcis to værdier:**

  | Værdi | Hvornår |
  |---|---|
  | `migration` | flowet blev flyttet hertil med værktøjet |
  | `baseline` | nulpunkt — vi noterede blot hvad org'en indeholdt, uden at flytte noget |

  Den bruges ét sted: et nulpunkt overskriver aldrig en rigtig migrering. (De `kind` man ser i afhængighedstjekket — `datatable`, `dataaction`, `division`, `surveyform` — er noget helt andet og hører ikke til manifestet.)

- Brugeropslaget caches i 10 minutter pr. miljø, og fejler det, opdigtes ingen bruger — der falddes tilbage til pc-brugeren med `bySource: machine`.

---
**🇬🇧 English**
- **`by` now uses the real Genesys user when the environment is logged in with OAuth (PKCE).** It always wrote the PC user before, because the lookup was never attempted. `/api/v2/users/me` is now asked, and the row carries the person's email.
- **With client credentials there is no Genesys user** — that is not a shortcoming, it is what the token is. Measured against a real org:

  ```
  GET /api/v2/users/me   →  400  "This request requires a user context.
                                  Client credentials cannot be used..."
  GET /api/v2/tokens/me  →  authenticatedUser: null
  ```

  So the PC user is the only truthful thing to record. **The row now says which kind of identity it is**, through a new `bySource` field:

  | `bySource` | Meaning |
  |---|---|
  | `genesys` | a real Genesys user, from a PKCE login |
  | `machine` | PC user — the environment uses client credentials, so there is no Genesys user |

  The hover text spells this out, so `skn_d@SKYOGA` is not mistaken for a Genesys identity.

- **`kind` in the manifest has exactly two values:**

  | Value | When |
  |---|---|
  | `migration` | the flow was moved here with the tool |
  | `baseline` | baseline — we simply recorded what the org held, without moving anything |

  It is used in one place: a baseline never overwrites a real migration. (The `kind` values seen in the dependency check — `datatable`, `dataaction`, `division`, `surveyform` — are something else entirely and do not belong to the manifest.)

- The user lookup is cached for 10 minutes per environment, and if it fails no user is invented — it falls back to the PC user with `bySource: machine`.

---

### v1.26.1
---
**🇩🇰 Dansk**
- **Rettet: den rigtige migreringsvej skrev aldrig til org-manifestet.** `recordOrgManifest()` blev kun kaldt fra demoens forfremmelse. En manifesttabel oprettet i en rigtig org ville derfor have stået tom for evigt, og delingen var kun på papiret. `/api/migrate/commit` skriver nu også dertil.
- **Nulpunkt skriver org-manifestet med.** `Sæt nulpunkt` noterer hvad org'en indeholder — præcis dét tabellen er til. Efter et nulpunkt gælder afvigelses-signalet **alle** flows, ikke kun dem værktøjet selv har flyttet. Det er én skrivning pr. flow, så det tager tid, og antallet står i loggen.
- Et nulpunkt har ingen kilde, så kun mål-rækken skrives.

---
**🇬🇧 English**
- **Fixed: the real migration path never wrote to the org manifest.** `recordOrgManifest()` was only called from the demo promotion. A manifest table created in a real org would therefore have stayed empty forever, and the sharing was only on paper. `/api/migrate/commit` now writes there too.
- **Baseline writes the org manifest as well.** `Set baseline` records what the org holds — exactly what the table is for. After a baseline the drift signal covers **every** flow, not only those the tool moved itself. It is one write per flow, so it takes time, and the count appears in the log.
- A baseline has no source, so only the target row is written.

---

### v1.26.0
---
**🇩🇰 Dansk**
- **Manifestet kan nu ligge i org'en, så flere kan arbejde på samme kunde.** Den lokale `flows/.migrations.json` kan ikke deles: to personer på hver sin pc får hver sin historik, og signalet "publiceret uden om pipelinen" ville sige noget forskelligt alt efter hvem der kigger. Manifestet ligger nu i en datatabel — `ArchyGUI_Manifest` — i hvert miljø.

- **Hver org beskriver kun sig selv.** Det er den afgørende beslutning. Kendsgerningen *"dev har Velkomst_v10 på v10"* skrives kun af den der ændrede dev, så to skrivende kan aldrig sige hver sit om samme celle — **uenighed er umulig af konstruktion**, i stedet for noget der skal løses bagefter. En forfremmelse skriver derfor to rækker: én i kilden (som netop blev omdøbt) og én i målet. Kan en org ikke nås, bliver den "ukendt", præcis som tavlen allerede gør.

  Alternativet — at skrive hele billedet til alle orgs — ville give N kopier der kan komme ud af trit, hvilket er samme problem flyttet ind i Genesys.

- **Målt mod jeres rigtige org før noget blev bygget:**

  | Hvad | Grænse |
  |---|---|
  | Nøglefelt | 256 tegn |
  | Strengfelt | 262.144 tegn |

  Rigelig plads til JSON pr. række. Rækken bærer flownavn, udgave, publiceringstidspunkt, hvor det kom fra — og **hvem der gjorde det**. Det sidste er den egentlige gevinst ved at flytte det ud af den lokale fil, og det svarer direkte på *"hvem har arbejdet i det forkerte miljø"*.

- **Nøglen er grundnavn + type**, ikke flownavnet. Med omdøbningsreglen ville en nøgle på det fulde navn blive forældreløs ved hver forfremmelse — samme fejl som i den lokale fil før v1.25.0.
- **Tabellen oprettes ikke af sig selv.** Under Pipeline står der en oversigt pr. miljø med en `Opret tabel`-knap og en bekræftelse der siger hvad den gør. At ArchyGUI selv lægger et objekt i en kundes produktionsorg, fordi nogen åbnede programmet, bør være en bevidst handling.
- **Den lokale fil bruges stadig hvor der ikke er en tabel**, så intet går tabt undervejs i overgangen. Er kilden den lokale fil, siges det i museover-teksten: *lokal fil — ikke delt*.
- **Sidste skrivning vinder.** Datatabel-API'et har ingen "skriv kun hvis uændret". To der forfremmer samme flow samtidig — den sidste overskriver. Det kan mildnes ved at skrive efter en vellykket migrering og gemme hvem, men ikke fjernes.
- Fejler manifestskrivningen, rulles migreringen **ikke** tilbage — flowet *er* flyttet. Det siges i loggen. En mangel i bogføringen er ikke en grund til at påstå at flytningen ikke skete.

---
**🇬🇧 English**
- **The manifest can now live in the org, so several people can work on the same customer.** The local `flows/.migrations.json` cannot be shared: two people on different PCs get different histories, and the "published outside the pipeline" signal would say different things depending on who is looking. The manifest now lives in a datatable — `ArchyGUI_Manifest` — in each environment.

- **Each org describes only itself.** That is the decisive choice. The fact *"dev holds Velkomst_v10 at v10"* is only ever written by whoever changed dev, so two writers can never disagree about the same cell — **disagreement is impossible by construction** rather than something to resolve afterwards. A promotion therefore writes two rows: one in the source (which was just renamed) and one in the target. An unreachable org becomes "unknown", exactly as the board already does.

  The alternative — writing the whole picture to every org — would give N copies that can fall out of step, which is the same problem moved into Genesys.

- **Measured against your real org before anything was built:**

  | What | Limit |
  |---|---|
  | Key field | 256 characters |
  | String field | 262,144 characters |

  Ample room for JSON per row. The row carries flow name, version, publish time, where it came from — and **who did it**. That last one is the real gain from moving out of the local file, and it answers *"who worked in the wrong environment"* directly.

- **The key is base name + type**, not the flow name. With the naming rule, keying on the full name would orphan the row at every promotion — the same bug as in the local file before v1.25.0.
- **The table is not created on its own.** Under Pipeline there is a per-environment overview with a `Create table` button and a confirmation stating what it does. ArchyGUI placing an object in a customer's production org because someone opened the program should be a deliberate act.
- **The local file is still used where there is no table**, so nothing is lost during the transition. When the local file is the source, the hover text says so: *local file — not shared*.
- **Last write wins.** The datatable API has no compare-and-swap. Two people promoting the same flow at once — the last one overwrites. Writing only after a successful migration and recording who helps, but does not remove it.
- If the manifest write fails, the migration is **not** rolled back — the flow *has* moved. It is stated in the log. A gap in the bookkeeping is not a reason to claim the move did not happen.

---

### v1.25.0
---
**🇩🇰 Dansk**
- **Grøn betød bare "publiceret" — nu betyder den "publiceret ad den rigtige vej".** En udgave nogen havde lavet uden om pipelinen så lige så rolig ud som en der kom den rette vej. To ting gør tallet rødt:

  | Signal | Grundlag | Styrke |
  |---|---|---|
  | **publiceret uden om pipelinen** | manifestet siger vi efterlod miljøet på v*N*, og det står højere nu | nær bevis |
  | **N udgave(r) foran trinnet før** | miljøet er publiceret flere gange end trinnet der fodrer det | fingerpeg |

  Det andet bygger på at udgavetallene i en kæde **falder nedad** — arbejdet sker opstrøms, og hvert senere trin får kun én udgave pr. forfremmelse. Vender rækkefølgen, er der arbejdet nedstrøms. `Kundeservice` i demoen: dev v3 · test v2 · uat v1 · **prod v7** → rød.

  > **Forbehold, der står i museover-teksten:** et miljø der var i drift længe før pipelinen kan stå højt af helt naturlige grunde. Fingerpeget er ikke bevis — indholdstjekket er stadig det eneste der afgør om to miljøer er ens.

- **Rettet: manifestet mistede sporet så snart et flow blev omdøbt.** Manifestlinjen blev gemt under det fulde navn (`Aabningstider_v10`), men tavlen slog op på grundnavnet (`Aabningstider`) — så der var aldrig en træfning, og manifest-signalet var reelt dødt. Værre endnu lagde hver omdøbning en **ny** linje ved siden af den gamle i stedet for at opdatere den; efter tre forfremmelser stod der tre linjer for det samme flow. Både opslag og opdatering matcher nu på grundnavnet.
- **Demoen efterlader ikke længere spor i det rigtige manifest** — `↺ Nulstil` og `✕ Fjern` rydder demoens linjer, så fortegnelsen over rigtige migreringer holdes ren.

---
**🇬🇧 English**
- **Green used to mean just "published" — now it means "published the right way".** A version someone made outside the pipeline looked as calm as one that arrived properly. Two things turn the number red:

  | Signal | Basis | Strength |
  |---|---|---|
  | **published outside the pipeline** | the manifest says we left the environment at v*N*, and it stands higher now | near proof |
  | **N version(s) ahead of the previous stage** | the environment has been published more times than the stage feeding it | an indication |

  The second rests on version numbers **falling downstream** in a chain — work happens upstream, and each later stage gains only one version per promotion. Invert that order and work has happened downstream. `Kundeservice` in the demo: dev v3 · test v2 · uat v1 · **prod v7** → red.

  > **The caveat, stated in the hover text:** an environment that was in use long before the pipeline can stand high for perfectly ordinary reasons. The indication is not proof — the content check remains the only thing that decides whether two environments are the same.

- **Fixed: the manifest lost track the moment a flow was renamed.** The manifest line was stored under the full name (`Aabningstider_v10`) while the board looked it up by base name (`Aabningstider`) — so there was never a match, and the manifest signal was effectively dead. Worse, each rename added a **new** line beside the old one instead of updating it; after three promotions there were three lines for one flow. Both lookup and update now match on the base name.
- **The demo no longer leaves traces in the real manifest** — `↺ Reset` and `✕ Remove` clear the demo's lines, keeping the record of real migrations clean.

---

### v1.24.1
---
**🇩🇰 Dansk**
- **Rettet: cellen viste kun et versionsnummer, ikke hvilket flow der stod der.** Med navnereglen er der pludselig **to tal der ligner hinanden** i samme celle — `v11.0` er miljøets egen publicerede udgave, `_v4` er den udgave der sidst blev forfremmet. Viste man kun `v11.0`, kunne man hverken se hvad flowet hed eller hvad tallet betød.

  Cellen viser nu **flowets fulde navn** øverst, og udgaven under:

  |  | DEV | TEST | UAT | PROD |
  |---|---|---|---|---|
  | **navn** | `Velkomst_v4` | `Velkomst_v4` | `Velkomst` | `Velkomst` |
  | **udgave** | v11.0 | v4.0 | v2.0 | v1.0 |

  Med ét blik ses at uat og prod stadig står på det uforfremmede `Velkomst`, mens dev og test er på `_v4` — og at dev er løbet 7 udgaver foran det der sidst blev skubbet videre.

- Udgaven har fået en forklaring ved museover, så de to tal ikke kan forveksles.

---
**🇬🇧 English**
- **Fixed: the cell showed only a version number, not which flow was there.** With the naming rule there are suddenly **two similar-looking numbers** in one cell — `v11.0` is the environment's own published version, `_v4` is the version last promoted. Showing only `v11.0` told you neither what the flow was called nor what the number meant.

  The cell now shows the **flow's full name** on top, with the version beneath:

  |  | DEV | TEST | UAT | PROD |
  |---|---|---|---|---|
  | **name** | `Velkomst_v4` | `Velkomst_v4` | `Velkomst` | `Velkomst` |
  | **version** | v11.0 | v4.0 | v2.0 | v1.0 |

  At a glance you can see uat and prod still hold the un-promoted `Velkomst` while dev and test are on `_v4` — and that dev has run 7 versions ahead of what was last pushed onward.

- The version carries a hover explanation so the two numbers cannot be confused.

---

### v1.24.0
---
**🇩🇰 Dansk**
- **Navnereglen færdiggjort: kilden omdøbes med.** Det var det manglende stykke. Endelsen fortæller ikke hvad flowets nuværende udgave er — den fortæller **hvilken udgave der sidst blev skubbet videre herfra**. Hele forløbet:

  | Trin | dev | test | uat |
  |---|---|---|---|
  | 0. bygger i dev | `Aabningstider` v10 | — | — |
  | 1. dev → test | `Aabningstider_v10` v10 | `Aabningstider_v10` v1 | — |
  | 2. test → uat | `Aabningstider_v10` v10 | `Aabningstider_v10` v1 | `Aabningstider_v10` v1 |
  | 3. arbejdet videre i dev | `Aabningstider_v10` **v15** | `Aabningstider_v10` v1 | `Aabningstider_v10` v1 |
  | 4. dev → test | `Aabningstider_v15` v15 | `Aabningstider_v15` v2 | `Aabningstider_v10` v1 |

  I trin 4 kan man se på navnene alene at **uat er bagud**. I trin 3 kan man se at der er arbejdet videre i dev uden at det er kommet videre.

- **Tavlen parrer nu på grundnavnet** — `testtest_v10` i uat og `testtest_v15` i dev er den samme række. Uden det ville en omdøbning splitte flowet i to og tage både forfremmelses-kæden og hele afvigelses-visningen med sig; det så man med det samme i v1.23.0's demo. Hvert miljøs faktiske navn står i cellen.
- **Målets eksisterende flow omdøbes — der laves ikke et nyt ved siden af.** Det betyder at flowet beholder sit id i målorgen, og **alt der ruter til det bliver ved med at gøre det**. Det var den anden bekymring ved v1.23.0, og den er væk.
- **Ny markering: `⚠ N udgave(r) ikke forfremmet`** — er miljøets egen udgave nået længere end endelsen siger, er der arbejdet videre uden at skubbe det videre. Er den lavere, har miljøet modtaget flowet, og det er normalt. Det er præcis signalet der viser at nogen har arbejdet i et miljø uden at føre det videre.
- **`▲ Publicér` i demoen** — lader som om nogen har arbejdet videre og publiceret igen, så trin 3 kan afprøves. Navnet røres ikke, indholdet ændrer sig, så et indholdstjek også opdager det. Kun demo-miljøer har knappen.
- **Indholdstjekket slår hvert miljø op under dets eget navn** — ellers ville det lede efter `testtest_v15` i uat, hvor flowet hedder `testtest_v10`, og fejlagtigt melde "kunne ikke tjekkes".

> **Reglen findes stadig kun i demoen.** Den mangler ét stykke før den kan bruges mod rigtige orgs: at omdøbe et flow i Genesys via API'et er ikke afprøvet endnu, og jeg vil ikke påstå det virker før det er målt. Alt andet — navneregel, parring på grundnavn, markeringer — er færdigt og kører.

---
**🇬🇧 English**
- **The naming rule completed: the source is renamed too.** That was the missing piece. The suffix does not say what the flow's current version is — it says **which version was last pushed onward from here**. The full sequence:

  | Step | dev | test | uat |
  |---|---|---|---|
  | 0. building in dev | `Aabningstider` v10 | — | — |
  | 1. dev → test | `Aabningstider_v10` v10 | `Aabningstider_v10` v1 | — |
  | 2. test → uat | `Aabningstider_v10` v10 | `Aabningstider_v10` v1 | `Aabningstider_v10` v1 |
  | 3. kept working in dev | `Aabningstider_v10` **v15** | `Aabningstider_v10` v1 | `Aabningstider_v10` v1 |
  | 4. dev → test | `Aabningstider_v15` v15 | `Aabningstider_v15` v2 | `Aabningstider_v10` v1 |

  At step 4 the names alone show that **uat is behind**. At step 3 they show that work has continued in dev without being pushed onward.

- **The board now matches on the base name** — `testtest_v10` in uat and `testtest_v15` in dev are the same row. Without that a rename would split the flow in two and take the promotion chain and the whole drift view with it; v1.23.0's demo showed this immediately. Each environment's actual name is shown in its cell.
- **The target's existing flow is renamed — no new one is created beside it.** The flow keeps its id in the target org, so **anything routing to it keeps routing to it**. That was the other concern with v1.23.0, and it is gone.
- **New marker: `⚠ N version(s) not promoted`** — if an environment's own version has gone past what the suffix says, work has continued there without being pushed onward. If it is lower, the environment received the flow, which is normal. This is exactly the signal that shows someone has been working in an environment without carrying it forward.
- **`▲ Publish` in the demo** — pretends someone kept working and published again, so step 3 can be tried. The name is left alone and the content changes, so a content check notices it too. Only demo environments get the button.
- **The content check looks each environment up under its own name** — otherwise it would look for `testtest_v15` in uat, where the flow is called `testtest_v10`, and wrongly report "could not be checked".

> **The rule still exists only in the demo.** One piece is missing before it can be used against real orgs: renaming a flow in Genesys through the API has not been tested yet, and I will not claim it works before it has been measured. Everything else — the naming rule, base-name matching, the markers — is finished and running.

---

### v1.23.0
---
**🇩🇰 Dansk**
- **Publiceringsdato på hver celle** — så man kan se hvor gammel udgaven er, og hvornår flowet sidst blev skubbet videre. Datoen kan stadig ikke bruges til at afgøre om to miljøer er i trit (se v1.22.0), men den fortæller hvornår noget skete.

- **Demo-kunde — fire miljøer og tre flows, helt lokalt.** `Kunder → Opret demo-kunde` giver `Demo A/S` med dev · test · uat · prod. Ingen credentials, ingen kald til Genesys eller Archy: demo-miljøerne har `demo: true`, og hver kode-vej der ellers ville hente en token springer den over. De tre flows dækker hver sin situation:

  | Flow | Situation |
  |---|---|
  | `Velkomst` | findes i alle fire med samme indhold → ✓ i trit |
  | `Aabningstider` | kun i dev, v10 → hele kæden ligger foran |
  | `Kundeservice` | findes i alle fire, men prod er løbet fra → ⚠ afviger |

  `↺ Nulstil demo` sætter den tilbage; `✕ Fjern demo` sletter miljøerne og filen. Demoens flows ligger i `demo-data.json`, som er gitignored.

- **Navneregel ved forfremmelse — indbygget i demoen.** Navnet får kildens udgave sat på, så det kan ses hvor det kom fra:

  | Navn i kilden | Publiceret | Bliver til |
  |---|---|---|
  | `testest` | 10 | `testest_v10` |
  | `testcallback_v10` | 34 | `testcallback_v34` |
  | `testtest_v10` | 1 | `testtest_v10` — uændret |

  Er kilden kun publiceret én gang, er der ikke sket noget i det miljø siden flowet ankom, så navnet bærer stadig den udgave det kom med og røres ikke. Et eksisterende `_v<N>` erstattes, ikke stables. Reglen ligger i `promotionName()` og er prøvet af mod alle tre eksempler samt grænsetilfælde (`flow_V7` → `flow_v12`, `my_v2_flow` → `my_v2_flow_v9` — kun endelsen tælles).

  > **Reglen findes indtil videre KUN i demoen.** Den er ikke koblet på migrering mod rigtige orgs, og det er med vilje — se forbeholdet nedenfor.

- **Hvad demoen viste med det samme:** forfremmer man `Aabningstider` (dev, v10) til test, kommer den derover som `Aabningstider_v10` — og tavlen viser nu **to adskilte rækker**: `Aabningstider` som "kun i dev" og `Aabningstider_v10` som "kun i test". Tavlen matcher på navn, så et omdøbt flow er ikke længere det samme flow. Dermed falder både forfremmelses-kæden og hele afvigelses-visningen fra v1.22.0 fra hinanden. Skal reglen bruges mod rigtige orgs, skal tavlen først matche på **grundnavnet** med endelsen skrællet af.

---
**🇬🇧 English**
- **Publish date on every cell** — so you can see how old a version is and when the flow was last pushed onward. The date still cannot decide whether two environments are in step (see v1.22.0), but it tells you when something happened.

- **Demo customer — four environments and three flows, entirely local.** `Customers → Create demo customer` gives you `Demo A/S` with dev · test · uat · prod. No credentials, no calls to Genesys or Archy: demo environments carry `demo: true`, and every code path that would otherwise fetch a token skips it. The three flows each cover a different situation:

  | Flow | Situation |
  |---|---|
  | `Velkomst` | present in all four with identical content → ✓ in step |
  | `Aabningstider` | dev only, v10 → the whole chain lies ahead |
  | `Kundeservice` | present in all four, but prod has drifted → ⚠ differs |

  `↺ Reset demo` puts it back; `✕ Remove demo` deletes the environments and the file. The demo's flows live in `demo-data.json`, which is gitignored.

- **Naming rule on promotion — built into the demo.** The name gets the source's version stamped on it, so you can see where it came from:

  | Name in source | Published | Becomes |
  |---|---|---|
  | `testest` | 10 | `testest_v10` |
  | `testcallback_v10` | 34 | `testcallback_v34` |
  | `testtest_v10` | 1 | `testtest_v10` — unchanged |

  If the source has been published only once, nothing has happened in that environment since the flow arrived, so the name still carries the version it came with and is left alone. An existing `_v<N>` is replaced, not stacked. The rule lives in `promotionName()` and is tested against all three examples plus edge cases (`flow_V7` → `flow_v12`, `my_v2_flow` → `my_v2_flow_v9` — only the suffix counts).

  > **The rule exists ONLY in the demo so far.** It is not wired into migration against real orgs, and that is deliberate — see the caveat below.

- **What the demo showed immediately:** promote `Aabningstider` (dev, v10) to test and it arrives as `Aabningstider_v10` — and the board now shows **two separate rows**: `Aabningstider` as "dev only" and `Aabningstider_v10` as "test only". The board matches by name, so a renamed flow is no longer the same flow. That breaks both the promotion chain and the whole drift view from v1.22.0. Before the rule can be used against real orgs, the board must match on the **base name** with the suffix stripped.

---

### v1.22.0
---
**🇩🇰 Dansk**
- **Tavlen kan nu se når et senere trin er løbet fra et tidligere** — altså når nogen har rettet direkte i prod. Tidligere var det usynligt: `v1.0 | v2.0` ser roligt ud, men tallene er per-org tællere og siger intet om indhold.

- **Publiceringsdatoen duer ikke som signal — det blev målt.** Det oplagte forslag er "leder Test, er alt godt; er Prod nyere, har nogen rørt den". På fem ud af fem flows der findes i begge orgs var det senere trin publiceret senest:

  | Flow | test | uat |
  |---|---|---|
  | Agent Logout - Transfer Emails | 2025-07-07 | 2025-10-22 |
  | CM Recording with DT V2 | 2025-11-27 | 2026-02-11 |
  | Default In-Queue Flow | 2024-09-30 | 2025-09-03 |
  | DEV_CM Recording with DT V3 | 2025-11-27 | 2025-12-15 |
  | Propose Callback | 2025-04-01 | 2025-08-05 |

  Og sådan skal det være: forfremmer man Test → Prod, bliver Prod publiceret bagefter. **En sund forfremmelse og en ulovlig prod-rettelse har samme form.** Et datosignal ville markere alt eller intet.

- **Tre signaler i stedet, hver med sin pris:**

  | Signal | Koster | Rækkevidde |
  |---|---|---|
  | **Findes kun i et senere trin** | intet | alle flows — det er bygget udenom kæden, ikke en ventende forfremmelse |
  | **Publiceret igen efter vores forfremmelse** | intet | kun flows vi selv har forfremmet — manifestet er nulpunktet |
  | **Indholdshash** | en Archy-eksport pr. org | alle flows der findes flere steder — den eneste universelle test |

- **Indholdstjek på forlangende** — `⇄ Tjek indhold` pr. række, eller `⇄ Tjek alle der findes flere steder`. Kun rækker der findes i mere end ét miljø kan afvige, så resten springes over. Rækken får tre tilstande: **✓ i trit**, **⚠ afviger**, **✗ kunne ikke tjekkes**. Kom der ikke en hash fra hvert miljø, siges der aldrig "i trit" — samme regel som i sammenligningen på tværs af kunder.
- **Uenighed afgøres parvis**, ikke pr. række, så knappen ved præcis hvilke to miljøer der er ude af trit.
- **`⟵ Hent tilbage`** — på en afvigende række kommer der en knap den anden vej, som lander på Migrer Flow med det senere miljø som kilde. Så kan man hente virkeligheden tilbage i test, se hvad der blev lavet, og køre det ordentligt frem igen.
- **`⟶ Forfrem` advarer når den overskriver** — på en række vi ved afviger, bliver knappen rød og siger hvad den gør. Den fjernes ikke: nogle gange er det dét man vil. Men den kasserer den forskel man lige har fundet, og det skal man vide.
- Hashene nulstilles når man skifter gruppe — de hører til de miljø-id'er de blev målt i.

---
**🇬🇧 English**
- **The board can now see when a later stage has drifted from an earlier one** — that is, when someone edited production directly. This used to be invisible: `v1.0 | v2.0` looks calm, but those are per-org counters and say nothing about content.

- **The publish date does not work as a signal — this was measured.** The obvious proposal is "if Test leads, all is well; if Prod is newer, someone touched it". On five of five flows present in both orgs, the later stage was published most recently:

  | Flow | test | uat |
  |---|---|---|
  | Agent Logout - Transfer Emails | 2025-07-07 | 2025-10-22 |
  | CM Recording with DT V2 | 2025-11-27 | 2026-02-11 |
  | Default In-Queue Flow | 2024-09-30 | 2025-09-03 |
  | DEV_CM Recording with DT V3 | 2025-11-27 | 2025-12-15 |
  | Propose Callback | 2025-04-01 | 2025-08-05 |

  And so it should be: promote Test → Prod and Prod is published afterwards. **A healthy promotion and an out-of-band production edit have the same shape.** A date signal would flag everything or nothing.

- **Three signals instead, each with its own cost:**

  | Signal | Costs | Reach |
  |---|---|---|
  | **Only exists in a later stage** | nothing | every flow — it was built outside the chain, not a pending promotion |
  | **Published again after our promotion** | nothing | only flows we promoted ourselves — the manifest is the baseline |
  | **Content hash** | one Archy export per org | every flow present in more than one place — the only universal test |

- **Content check on demand** — `⇄ Check content` per row, or `⇄ Check all present in more than one place`. Only rows present in more than one environment can differ, so the rest are skipped. A row gets three states: **✓ in step**, **⚠ differs**, **✗ could not be checked**. If a hash did not come back from every environment, it never says "in step" — the same rule as the across-customers comparison.
- **Disagreement is decided pairwise**, not per row, so the button knows exactly which two environments are out of step.
- **`⟵ Pull back`** — on a differing row a button appears going the other way, landing on Migrate Flow with the later environment as source. You can pull reality back into test, see what was done, and roll it forward properly.
- **`⟶ Promote` warns when it overwrites** — on a row known to differ, the button turns red and says what it does. It is not removed: sometimes that is what you want. But it discards the difference you just found, and you should know that.
- Hashes are cleared when you switch group — they belong to the environment ids they were measured in.

---

### v1.21.0
---
**🇩🇰 Dansk**
- **Kunde → gruppe → miljø** — Det programmet hidtil kaldte en "kunde" er i virkeligheden ét *miljø*: én Genesys-org med ét OAuth-sæt. Der er nu to niveauer ovenover:

  ```
  Vattenfall            Kunde B
  ├── DE   test → prod  ├── Firma A  test → prod
  └── SE   test → prod  └── Firma C  dev → test → uat → prod
  ```

  **Gruppen er pipelinen.** Om den hedder et land eller et firma er kun en etiket — modellen behøver ikke kende forskel. Hvert miljø får et trin fra `dev → test → uat → prod`; en gruppe med kun to miljøer får bare to kolonner.

- **Ingen omlægning af data** — `customers.json` er uændret i form. Hver post har fået tre felter (`tenant`, `group`, `stage`), og hierarkiet udledes af dem. Alle 48 opslag i koden virker uændret, og miljøer uden felterne samler sig i én "ikke grupperet"-bunke man kan rydde op i i sit eget tempo. Ingen engangsmigrering der kan gå galt.
- **Gruppen kræves, men fylder ikke** — har en kunde kun én gruppe, skjules valget. Gruppen er der stadig, så modellen er ensartet.
- **Ny side: Pipeline** — flows som rækker, gruppens miljøer som kolonner i trin-rækkefølge. Versionstallet vises kun til orientering; det er per-org og kan ikke sammenlignes på tværs. Filtrér på navn, eller på "kun dem der mangler i et senere trin". Et miljø der ikke kunne læses står som **ukendt** — aldrig som **mangler**, for vi ved ikke hvad der er i det.
- **Forfrem ét trin ad gangen** — knappen i en kolonne henter fra kolonnen til venstre og lander på Migrer Flow med kilde, mål og flow sat. Den genbruger den eksisterende vej, så afhængighedstjek, divisionsvalg og logning er præcis som ellers.

- **Fire vagter, håndhævet på serveren** — ikke kun skjult i brugerfladen:

  | Vagt | Hvornår |
  |---|---|
  | `cross-group` | Kilde og mål er ikke i samme gruppe. Er ingen af dem grupperet, går en løs migrering igennem som før. |
  | `prod-confirm` | Målet er et prod-miljø. Kræver en bevidst bekræftelse. |
  | `unpublished-source` | Flowet er ikke publiceret i kilden. Publicér og test det dér først — en kladde er ikke testet. |
  | `same-env` | Kilde og mål er det samme miljø. |

  Både `prepare` og `commit` tjekker. Commit er den der skriver, og den stoler ikke på at klienten kom forbi `prepare` først.

- **Rettet: `PUT /api/customers/:id` kunne ødelægge en client secret** — GET udleverer hemmeligheden maskeret. Sendte brugerfladen den værdi tilbage, ville en naiv fletning skrive prikker oven i den rigtige hemmelighed og gøre miljøet ubrugeligt. At genkende masken er for skrøbeligt — tegnene kan forvanskes undervejs, hvilket jeg fik målt undervejs. **PUT tager nu slet ikke imod `clientSecret`**; vil man skifte den, sender man `newClientSecret`. Endpointet var ubrugt før nu, men redigering af miljøer bruger det.
- **Rettet: kladdeversioner viste et internt id** — Genesys navngiver en kladde `saved_version_0d4c8ad4-…`. Det er ikke et versionsnummer og vises ikke som ét.

> **Endnu ikke bygget:** miljøspecifik oversættelse — at kø `Support_TEST` svarer til `Support_PROD` osv. Uden den vil en forfremmelse stadig fejle på ressourcer der hedder noget forskelligt i hvert miljø. Det er næste skridt.

---
**🇬🇧 English**
- **Customer → group → environment** — What the app called a "customer" is really one *environment*: one Genesys org with one OAuth client. There are now two levels above it:

  ```
  Vattenfall            Customer B
  ├── DE   test → prod  ├── Company A  test → prod
  └── SE   test → prod  └── Company C  dev → test → uat → prod
  ```

  **The group is the pipeline.** Whether it is named after a country or a company is just a label — the model need not tell them apart. Each environment gets a stage from `dev → test → uat → prod`; a group with only two environments simply gets two columns.

- **No data restructuring** — `customers.json` keeps its shape. Each record gained three fields (`tenant`, `group`, `stage`), and the hierarchy is derived from them. All 48 lookups in the code work unchanged, and environments without the fields collect in one "not grouped" bucket to be tidied at your own pace. No one-off migration that can go wrong.
- **The group is required but stays out of the way** — when a customer has only one group, the choice is hidden. The group is still there, so the model stays uniform.
- **New page: Pipeline** — flows as rows, the group's environments as columns in stage order. Version numbers are shown for orientation only; they are per-org and cannot be compared across. Filter by name, or by "only those missing in a later stage". An environment that could not be read shows as **unknown** — never as **missing**, because we do not know what is in it.
- **Promote one stage at a time** — the button in a column pulls from the column to its left and lands on Migrate Flow with source, target and flow filled in. It reuses the existing path, so dependency checks, division choices and logging are exactly as before.

- **Four guards, enforced on the server** — not merely hidden in the UI:

  | Guard | When |
  |---|---|
  | `cross-group` | Source and target are not in the same group. If neither is grouped, an ad-hoc migration passes as before. |
  | `prod-confirm` | The target is a production environment. Requires a deliberate confirmation. |
  | `unpublished-source` | The flow is not published in the source. Publish and test it there first — a draft has not been tested. |
  | `same-env` | Source and target are the same environment. |

  Both `prepare` and `commit` check. Commit is the one that writes, and it does not trust that the client came through `prepare` first.

- **Fixed: `PUT /api/customers/:id` could destroy a client secret** — GET hands out the secret masked. Had the UI sent that value back, a naive merge would have written dots over the real secret and made the environment unusable. Recognising the mask is too fragile — the characters can be mangled in transit, which is what I measured happening. **PUT no longer accepts `clientSecret` at all**; to change it you send `newClientSecret`. The endpoint was unused until now, but editing environments uses it.
- **Fixed: draft versions showed an internal id** — Genesys names a draft `saved_version_0d4c8ad4-…`. That is not a version number and is no longer shown as one.

> **Not built yet:** per-environment translation — that queue `Support_TEST` corresponds to `Support_PROD`, and so on. Without it a promotion will still fail on resources named differently in each environment. That is the next step.

---

### v1.20.3
---
**🇩🇰 Dansk**
- **Rettet: Export YAML kunne vise et helt andet flow end det man valgte** — Efter eksporten gættede `/api/export` sig frem til filen ved at lede efter flownavnet i filnavnene. Men navnet fik fjernet sine mellemrum, mens filnavnene beholdt deres:

  | Valgt flow | Søgte efter | Filen hedder | Resultat |
  |---|---|---|---|
  | `Notify Flow Error` | `notifyflowerror` | `Notify Flow Error_v1-0.yaml` | rammer forbi |
  | `WeekNumber` | `weeknumber` | `WeekNumber_v6-0.yaml` | rammer |

  **Ethvert flownavn med mellemrum ramte forbi.** Og når intet matchede, tog koden *sidste fil i mappen* — et vilkårligt, fremmed flow, som så blev vist som om det var eksporten. Det er sådan et valgt `Notify Flow Error` kunne ende med at vise `WeekNumber`.

- **Filen findes nu på hvad eksporten rørte ved** — mappen aflæses før og efter, og kun filer der er nye eller nyskrevne kommer i betragtning. Der er ingen "gæt"-tilbagefald: skrev eksporten ingen fil, siger den det. Samme fremgangsmåde som migrerings- og sammenligningsvejene allerede brugte — `/api/export` var det sidste sted med den gamle logik.
- **Nyt værn: indholdet kontrolleres mod det man bad om** — flownavnet inde i YAML'en sammenholdes med det valgte flow, og passer de ikke, stopper eksporten med at sige hvad man bad om og hvad filen indeholder. Kontrollen gælder alle fire eksportveje. Afprøvet mod alle 147 eksisterende YAML-filer: 147 af 147 går igennem, ingen falske afvisninger.

---
**🇬🇧 English**
- **Fixed: Export YAML could show an entirely different flow than the one selected** — After exporting, `/api/export` guessed at the file by looking for the flow name inside the file names. But the name had its spaces stripped while the file names kept theirs:

  | Selected flow | Searched for | File is named | Result |
  |---|---|---|---|
  | `Notify Flow Error` | `notifyflowerror` | `Notify Flow Error_v1-0.yaml` | misses |
  | `WeekNumber` | `weeknumber` | `WeekNumber_v6-0.yaml` | hits |

  **Every flow name containing a space missed.** And when nothing matched, the code took *the last file in the directory* — an arbitrary, unrelated flow, then displayed as though it were the export. That is how a selected `Notify Flow Error` could end up showing `WeekNumber`.

- **The file is now found by what the export actually touched** — the directory is read before and after, and only files that are new or freshly written are considered. There is no guessing fallback: if the export wrote no file, it says so. This is the same approach the migration and comparison paths already used — `/api/export` was the last place still on the old logic.
- **New guard: the content is checked against what was asked for** — the flow name inside the YAML is compared with the selected flow, and if they disagree the export stops and states what was requested and what the file contains. The check covers all four export paths. Tested against all 147 existing YAML files: 147 of 147 pass, no false rejections.

---

### v1.20.2
---
**🇩🇰 Dansk**
- **Rettet: `--clientSecret` kunne havne i konsollen og `server.log`** — Archy kaldes med credentials på kommandolinjen. Når Node's `exec` fejler *inden* Archy selv siger noget, lægger Node **hele kommandolinjen** ind i `err.message` — inklusive `--clientSecret`. Den besked blev brugt som fejltekst, og gik derfra videre til systemloggen, `server.log`, konsollen og browseren. Målt og bekræftet før rettelsen:

  ```
  err.message: Command failed: archy ... --clientSecret "SUPERHEMMELIG123" --clientId "ID-ABC"
  ```

- **Alt der logges maskeres nu ét sted** — `addLog()` er den eneste vej til både systemloggen og konsollen, så maskeringen sidder dér, og kan ikke omgås af nye kald. Den fjerner:

  | Mønster | Bliver til |
  |---|---|
  | `--clientSecret <værdi>` (med eller uden anførselstegn) | `--clientSecret "***"` |
  | `--authToken <værdi>` | `--authToken "***"` |
  | `Bearer <token>` | `Bearer ***` |
  | Enhver hemmelighed fra `customers.json`, også uden flag foran | `***` |
  | Ethvert client-id fra `customers.json` | `af9bcc12…` (første 8 tegn) |

- **Client-id vises aldrig fuldt ud i en log** — det forkortes til de første 8 tegn. Nok til at se *hvilken* klient det drejer sig om, ikke nok til at genbruge. Kundelisten (`/api/customers`) har hele tiden sendt `••••••••` i stedet for hemmeligheden.
- **Fejl til browseren maskeres også** — `runArchy` maskerer på begge fejlveje, så en fejlbesked ikke smugler kommandolinjen ud via HTTP-svaret.
- Verificeret ved at fremprovokere en rigtig Archy-fejl mod en levende org og derefter gennemsøge `server.log`, systemloggen og HTTP-svaret for hver hemmelighed og hvert client-id i `customers.json` — ingen fund.

> **Uden for programmets kontrol:** Archy's egne debug-logs under `C:\Tools\Archy\archyHome\debug\*.txt` skriver **client-id** (ikke hemmeligheden). Det er Archy's egen logning — ryd mappen hvis den skal deles.

---
**🇬🇧 English**
- **Fixed: `--clientSecret` could reach the console and `server.log`** — Archy is invoked with credentials on the command line. When Node's `exec` fails *before* Archy itself says anything, Node puts **the entire command line** into `err.message` — including `--clientSecret`. That message was used as the error text, and travelled on to the system log, `server.log`, the console and the browser. Measured and confirmed before the fix:

  ```
  err.message: Command failed: archy ... --clientSecret "SUPERHEMMELIG123" --clientId "ID-ABC"
  ```

- **Everything logged is now masked in one place** — `addLog()` is the only route to both the system log and the console, so the masking sits there and cannot be bypassed by new calls. It removes:

  | Pattern | Becomes |
  |---|---|
  | `--clientSecret <value>` (quoted or not) | `--clientSecret "***"` |
  | `--authToken <value>` | `--authToken "***"` |
  | `Bearer <token>` | `Bearer ***` |
  | Any secret from `customers.json`, even with no flag in front | `***` |
  | Any client id from `customers.json` | `af9bcc12…` (first 8 characters) |

- **A client id is never shown in full in a log** — it is shortened to the first 8 characters. Enough to see *which* client is meant, not enough to reuse. The customer list (`/api/customers`) has always sent `••••••••` in place of the secret.
- **Errors sent to the browser are masked too** — `runArchy` masks on both failure paths, so an error message cannot smuggle the command line out through the HTTP response.
- Verified by provoking a real Archy failure against a live org and then searching `server.log`, the system log and the HTTP response for every secret and every client id in `customers.json` — no hits.

> **Outside this program's control:** Archy's own debug logs under `C:\Tools\Archy\archyHome\debug\*.txt` write the **client id** (not the secret). That is Archy's own logging — clear the folder if it is to be shared.

---

### v1.20.1
---
**🇩🇰 Dansk**
- **Rettet: "identisk indhold" blev påstået når en org fejlede** — Sammenligningen talte kun de hashes den fik. Fejlede eksporten hos én kunde, stod der ét hash tilbage — og både dialogen og systemloggen kaldte det *identisk overalt*. Det er direkte forkert: vi ved intet om den org der fejlede. Udfaldet har nu fire tilstande, og **identisk kræver at hver eneste org gav en hash**:

  | Udfald | Betydning |
  |---|---|
  | ✓ Identisk indhold hos alle | Alle orgs svarede, samme hash |
  | ⚠ N forskellige udgaver | Alle orgs svarede, hashene er forskellige |
  | ✗ Kunne ikke sammenlignes | En eller flere orgs fejlede — resultatet er ufuldstændigt |
  | For få resultater | Under to orgs gav et resultat |

- **Manglende rettigheder vises nu som det de er** — Archy melder rettighedsfejl som den generiske `Architect Scripting session ended in error ( code: 99 )`. Rettighedens navn står i en linje for sig i outputtet og trækkes nu ud: *"OAuth-klienten mangler rettigheden 'architect:ui:view' i denne org"*. Det er præcis grunden til at Vattenfall DE Test fejlede.

---
**🇬🇧 English**
- **Fixed: "identical content" was claimed when an org had failed** — The comparison counted only the hashes it received. If the export failed at one customer, a single hash was left — and both the dialog and the system log called that *identical everywhere*. That is simply wrong: nothing is known about the org that failed. The verdict now has four states, and **identical requires every org to have produced a hash**:

  | Verdict | Meaning |
  |---|---|
  | ✓ Identical content everywhere | Every org answered, same hash |
  | ⚠ N distinct versions | Every org answered, the hashes differ |
  | ✗ Could not be compared | One or more orgs failed — the result is incomplete |
  | Too few results | Fewer than two orgs produced a result |

- **Missing permissions are now reported as such** — Archy reports permission failures as the generic `Architect Scripting session ended in error ( code: 99 )`. The permission name sits on its own line in the output and is now extracted: *"The OAuth client is missing the 'architect:ui:view' permission in this org"*. That is exactly why Vattenfall DE Test failed.


### v1.20.0
---
**🇩🇰 Dansk**
- **🔀 Ny side: På tværs af kunder** — Viser de flows der findes hos **flere kunder**, med hver kundes version, publiceringstidspunkt og om flowet er aktivt. Ét API-kald pr. kunde, så oversigten er hurtig. Filtrér på flowtype og fritekst, og slå **Kun dem der er ude af trit** fra for at se dem alle.
- **⇄ Sammenlign indhold pr. række** — Eksporterer flowet fra hver kunde der har det og sammenligner indholds-hashen. Kræver en eksport pr. org og tager derfor tid, så det køres på forlangende og én række ad gangen.
- **Hvorfor begge niveauer** — `Default Voicemail Flow` står som **v1 hos begge** kunder, men indholdet er forskelligt. Versionsnumrene ville have sagt "samme version"; hashen afslører at de ikke er ens.
- **Kunder der ikke kan nås siges højt** — Fejler et opslag mod en kunde, vises det som en advarsel over listen i stedet for at oversigten ser komplet ud.
- **Import-knappen på YAML Filer hedder nu "Send til import"** — Den importerede ikke noget: den henter filens indhold, lægger det i tekstfeltet på Import YAML-siden og navigerer derhen. Man skal fortsat selv vælge mål-kunde og trykke import.

---
**🇬🇧 English**
- **🔀 New page: Across customers** — Lists the flows that exist at **more than one customer**, with each customer's version, publish time and whether the flow is active. One API call per customer, so the overview is fast. Filter by flow type and free text, and turn off **Only those out of step** to see them all.
- **⇄ Compare content per row** — Exports the flow from each customer that has it and compares the content hash. That needs an export per org and therefore takes time, so it runs on demand, one row at a time.
- **Why both levels** — `Default Voicemail Flow` is **v1 at both** customers, but the content differs. The version numbers would have said "same version"; the hash shows they are not the same.
- **Unreachable customers are called out** — If a lookup against a customer fails it is shown as a warning above the list, rather than letting the overview look complete.
- **The Import button on YAML Files is now "Send to import"** — It never imported anything: it fetches the file content, puts it in the Import YAML page's text area and navigates there. You still pick the target customer and press import yourself.


### v1.19.0
---
**🇩🇰 Dansk**
- **🧹 Oprydning i eksporterede filer** — Ny knap på YAML Filer. Vælg hvor mange versioner der skal beholdes pr. flow (**2 som standard**, så der altid er en fallback til en tidligere version) og se præcis hvilke filer der ryger, før noget slettes.
- **Tørkørsel først, altid** — Dialogen viser listen over filer der vil blive slettet med kunde, filnavn og dato, og knappen er slået fra indtil der faktisk er noget at slette. Sletningen kræver derefter en bekræftelse.
- **Versionerne sammenlignes som tal** — v10 rangerer over v3. En tekstsortering ville have beholdt de forkerte to.
- **Eksport og import holdes adskilt** — Filer i en kundes eksportmappe og filer lagt op til import grupperes hver for sig, så en eksport aldrig udkonkurrerer en fil der ligger klar til import. Filer uden versionsnummer i navnet står alene og røres ikke.

---
**🇬🇧 English**
- **🧹 Cleanup of exported files** — A new button on YAML Files. Choose how many versions to keep per flow (**2 by default**, so there is always a fallback to an earlier version) and see exactly which files will go before anything is deleted.
- **A dry run first, always** — The dialog lists the files that would be deleted with customer, file name and date, and the button stays disabled until there is actually something to delete. Deleting then asks for confirmation.
- **Versions are compared numerically** — v10 ranks above v3. A string sort would have kept the wrong two.
- **Exports and imports are kept apart** — Files in a customer's export directory and files staged for import are grouped separately, so an export never displaces a file waiting to be imported. Files with no version number in the name stand alone and are never touched.


### v1.18.0
---
**🇩🇰 Dansk**
- **YAML Filer viser nu hvad filerne er** — Listen viste kun filnavnet, fx `Test33_v1-0.yaml`. Archy navngiver eksporter `<Flownavn>_v<major>-<minor>.yaml`, så det navn er flowet **Test33 version 1.0**. Siden splitter det nu ad og viser flownavn, version, **flowtype**, kunde, tidspunkt og filstørrelse. Filnavnet står stadig nederst i rækken.
- **Filtre på kunde, flowtype og fritekst** — Begge rullemenuer fyldes ud fra det der faktisk ligger på disken.
- **Kun nyeste version** — Slået til som standard. Samme flow kan ligge i flere versioner; de ældre foldes sammen, og tælleren fortæller hvor mange der er skjult (176 filer → 169 med 7 skjult).
- **Rettet: undertitlen var forkert** — Der stod "gemt lokalt under import/export", men filerne kommer også fra **migreringer** og **sammenligninger**, som begge eksporterer flows undervejs. To filer der dukkede op samtidig i to orgs var en ⇄-sammenligning, ikke en eksport. Undertitlen siger det nu.

---
**🇬🇧 English**
- **YAML Files now shows what the files are** — The list showed only the file name, e.g. `Test33_v1-0.yaml`. Archy names exports `<FlowName>_v<major>-<minor>.yaml`, so that is the flow **Test33 version 1.0**. The page now splits it apart and shows flow name, version, **flow type**, customer, timestamp and file size. The file name is still shown at the bottom of the row.
- **Filters on customer, flow type and free text** — Both dropdowns are populated from what is actually on disk.
- **Latest version only** — On by default. The same flow can exist in several versions; older ones are folded away and the counter says how many are hidden (176 files → 169 with 7 hidden).
- **Fixed: the subtitle was wrong** — It said "saved locally during import/export", but files also come from **migrations** and **comparisons**, both of which export flows along the way. Two files appearing in two orgs at the same moment were a ⇄ comparison, not an export. The subtitle now says so.


### v1.17.2
---
**🇩🇰 Dansk**
- **Migrér ressourcer flyttet op under Migrer Flow** — De to migreringssider står nu ved siden af hinanden i sidebaren: flows det ene sted, alt det andet det andet. Tidligere lå Export og Import YAML imellem dem.

---
**🇬🇧 English**
- **Migrate resources moved up under Migrate Flow** — The two migration pages now sit next to each other in the sidebar: flows in one, everything else in the other. Export and Import YAML previously separated them.

### v1.17.1
---
**🇩🇰 Dansk**
- **Menupunktet hedder nu "Migrér ressourcer"** — Siden hed *Data Actions*, men rummer Data Actions, DataTable-strukturer og user prompts. Navnet dækkede altså kun en tredjedel af den. Det nye navn parrer med **Migrer Flow** — flows det ene sted, alt det andet her — og bliver ikke forkert hvis der kommer en fjerde fane til. Undertitlen nævner nu alle tre.

---
**🇬🇧 English**
- **The menu item is now "Migrate resources"** — The page was called *Data Actions* but holds Data Actions, DataTable structures and user prompts, so the name covered only a third of it. The new name pairs with **Migrate Flow** — flows in one place, everything else here — and will not become wrong if a fourth tab arrives. The subtitle now names all three.


### v1.17.0
---
**🇩🇰 Dansk**
- **🔊 Migrering af user prompts** — Tredje fane på *Data Actions & Tabeller*. Prompts listes med deres sprog, og dem med indtalt lyd er markeret 🔊. Både TTS-teksten og selve WAV-filen kopieres: lyden hentes fra kildens `mediaUri` og lægges op på den nye ressources `uploadUri`. Loggen viser resultatet pr. sprog.
- **Rettet: promptlisten afkortede stille ved 50** — Den eksisterende `/prompts`-rute hentede med `pageSize: 50` uden paginering, så en org med flere prompts fik listen skåret af uden nogen besked. VF NL har 54. Ruten paginerer nu.
- **Rettet: intetsigende `FAILURE` ved publicering** — Fejlårsagen ligger i `currentOperation.errorMessage` og `errorCode`, ikke i `errorDetails[]`, som typisk er tom. Beskeden var derfor bare "FAILURE". Den viser nu fx *"A backend service error occurred while publishing flow 'Indtast CPR_CVR'. (ARCHITECT_EXTERNAL_PUBLISH_ERROR)"*.

---
**🇬🇧 English**
- **🔊 User prompt migration** — A third tab on *Data Actions & Tables*. Prompts are listed with their languages, and those with recorded audio are marked 🔊. Both the TTS text and the WAV file are copied: the audio is fetched from the source `mediaUri` and posted to the new resource's `uploadUri`. The log reports the outcome per language.
- **Fixed: the prompt list silently truncated at 50** — The existing `/prompts` route fetched with `pageSize: 50` and no pagination, so an org with more prompts had its list cut off with no indication. VF NL has 54. The route now paginates.
- **Fixed: a bare `FAILURE` on publish** — The reason lives in `currentOperation.errorMessage` and `errorCode`, not in `errorDetails[]`, which is usually empty. The message was therefore just "FAILURE". It now reads e.g. *"A backend service error occurred while publishing flow 'Indtast CPR_CVR'. (ARCHITECT_EXTERNAL_PUBLISH_ERROR)"*.


### v1.16.1
---
**🇩🇰 Dansk**
- **Rettet: publicering blev meldt som fejlet selvom den lykkedes** — Publicering i Genesys er **asynkron**. `POST` svarer 200 med det samme, mens arbejdet fortsætter i baggrunden, så et øjeblikkeligt opslag ser stadig det gamle flow. Verifikationen fra v1.16.0 læste for tidligt og meldte fejl på en publicering der gik fint. Den følger nu flowets `currentOperation` indtil den er færdig og læser dens `actionStatus`.
- Fejler publiceringen rigtigt, vises Genesys' egne `errorDetails`. Er den stadig i gang efter 30 sekunder, meldes den som *sat i gang, ikke færdig* frem for at blive kaldt en fejl.

---
**🇬🇧 English**
- **Fixed: publishing was reported as failed even when it succeeded** — Publishing in Genesys is **asynchronous**. The `POST` returns 200 immediately while the work continues in the background, so an immediate re-read still sees the old flow. The verification added in v1.16.0 read too early and reported a failure for a publish that worked. It now follows the flow's `currentOperation` until it completes and reads its `actionStatus`.
- When a publish genuinely fails, Genesys' own `errorDetails` are shown. If it is still running after 30 seconds it is reported as *started but not finished* rather than called a failure.


### v1.16.0
---
**🇩🇰 Dansk**
- **🚀 Publicér et flow der allerede ligger i org'en** — Migrerer man med handlingen `create`, lander flowet som checked-in draft uden at være i drift. Flow Browser har nu en **Publicér**-knap på netop de flows, og den publicerer den version der allerede er i org'en. Archy kan ikke bruges til det: `archy publish` kræver altid en YAML-fil og ville re-importere fra kilden — havde kilden ændret sig, ville man publicere noget andet end det man migrerede.
- **Resultatet verificeres** — Genesys' publiceringsendpoint svarer `200` selv når intet blev publiceret. Værktøjet læser derfor flowet igen bagefter og melder fejl hvis `publishedVersion` stadig er tom, frem for at stole på statuskoden.
- **Rettet: versionskolonnen viste altid `v?`** — Koden læste `f.publishedVersion?.version`, men Genesys kalder feltet `name` / `commitVersion`. Værdien var derfor altid `undefined`. 104 af 119 flows viser nu deres rigtige versionsnummer.
- **Udtjekkede flows vises som sådan** — De resterende 15 flows har hverken en publiceret eller checked-in version: de er tjekket ud af en bruger med ugemt arbejde. Deres `savedVersion.name` er et GUID, ikke et versionsnummer, så de vises nu som **Udtjekket** i stedet for `v?`. Det er værd at vide inden en migrering, da et låst flow kræver `--forceUnlock`.

---
**🇬🇧 English**
- **🚀 Publish a flow that is already in the org** — Migrating with the `create` action leaves the flow as a checked-in draft that is not live. Flow Browser now has a **Publish** button on exactly those flows, and it publishes the version already in the org. Archy cannot do this: `archy publish` always requires a YAML file and would re-import from the source — if the source had changed, you would publish something other than what you migrated.
- **The result is verified** — Genesys' publish endpoint answers `200` even when nothing was published. The tool therefore re-reads the flow afterwards and reports a failure if `publishedVersion` is still empty, rather than trusting the status code.
- **Fixed: the version column always showed `v?`** — The code read `f.publishedVersion?.version`, but Genesys calls the field `name` / `commitVersion`. The value was therefore always `undefined`. 104 of 119 flows now show their real version number.
- **Checked-out flows are shown as such** — The remaining 15 flows have neither a published nor a checked-in version: they are checked out by a user with unsaved work. Their `savedVersion.name` is a GUID, not a version number, so they now read **Checked out** instead of `v?`. Worth knowing before a migration, since a locked flow needs `--forceUnlock`.


### v1.15.0
---
**🇩🇰 Dansk**
- **Herkomst i sammenligningen** — Dialogen viste kun en tynd linje "Migreret herfra" med et tidsstempel. Nu vises et helt afsnit ud fra manifestet: **hvilken org** flowet kom fra, **hvilken kildeversion** det blev bygget af, **hvilken handling** der blev brugt (`create` / `update` / `publish`) og hvornår. Er posten et nulpunkt i stedet for en migrering, står det som *NULPUNKT*.
- **En konklusion man kan handle på** — Er indholdet identisk, siger dialogen nu rent ud: *"Målet svarer til kilde v3 — migreret med ArchyGUI og indholdet er stadig identisk."* Er kilden versioneret op siden, men indholdet stadig ens, siges det i stedet: *"Målet blev bygget af kilde v3, som nu står på v5. Indholdet er stadig identisk, så kilden er kun versioneret op."*
- **Hint når `create` fejler** — Vælger man `create` og flowet allerede findes i mål-org'en, afviser Archy det og foreslår `--recreate`. Fejlen suppleres nu med det man i praksis vil gøre: vælg **update** eller **publish** i Handling.

---
**🇬🇧 English**
- **Provenance in the comparison** — The dialog only showed a thin "Migrated from here" line with a timestamp. It now shows a full section from the manifest: **which org** the flow came from, **which source version** it was built from, **which action** was used (`create` / `update` / `publish`) and when. If the record is a baseline rather than a migration, it says *BASELINE*.
- **A conclusion you can act on** — When the content is identical the dialog now states it plainly: *"The target matches source v3 — migrated with ArchyGUI and the content is still identical."* If the source has been re-versioned since but the content still matches: *"The target was built from source v3, which is now at v5. The content is still identical, so the source has only been re-versioned."*
- **A hint when `create` fails** — Choosing `create` when the flow already exists in the target makes Archy refuse and suggest `--recreate`. The error now adds what you actually want: pick **update** or **publish** in the Action dropdown.


### v1.14.1
---
**🇩🇰 Dansk**
- **Typefilteret på Migrer Flow manglede seks flowtyper** — Listen var hardkodet med syv typer og udelod **COMMONMODULE**, INQUEUECALL, INQUEUEEMAIL, INQUEUESHORTMESSAGE, SECURECALL, VOICEMAIL og VOICESURVEY. Man kunne altså ikke filtrere til common modules og migrere dem selvstændigt. Filteret fyldes nu ud fra de typer kilde-org'en faktisk har, med antal pr. type — så ingen type kan mangle igen. VF NL viser nu alle 13 typer.

---
**🇬🇧 English**
- **The type filter on Migrate Flow was missing six flow types** — The list was hardcoded with seven types and left out **COMMONMODULE**, INQUEUECALL, INQUEUEEMAIL, INQUEUESHORTMESSAGE, SECURECALL, VOICEMAIL and VOICESURVEY. That made it impossible to filter to common modules and migrate them on their own. The filter is now populated from the types the source org actually has, with a count per type — so no type can go missing again. VF NL now shows all 13 types.

### v1.14.0
---
**🇩🇰 Dansk**
- **📌 Sæt nulpunkt** — Ny knap på Flow Browser der noterer hvordan sammenlignings-org'ens flows ser ud lige nu: version, publiceringstidspunkt og om flowet er aktivt. Derefter kan værktøjet fange en ændring lavet direkte i mål-org'en — **også for flows det aldrig selv har migreret**. Nulpunktet bruger kun API-opslag og tager sekunder; en indholds-hash pr. flow ville kræve en Archy-eksport hver og tage over 20 minutter for 84 flows.
- **Et nulpunkt overskriver aldrig et rigtigt migreringsspor** — Har værktøjet migreret et flow, bevares den post med sin indholds-hash. Verificeret: 117 noteret, 1 sprunget over.
- **Rettet: drift-detektionen virkede aldrig** — Manifestet gemte flowtypen fra YAML-roden (`inboundCall`), mens opslaget brugte API'ets form (`INBOUNDCALL`). De kunne aldrig matche, så både drift og "publiceret efter migrering" fra v1.12/v1.13 var reelt død kode. Typen normaliseres nu ét sted.
- **Manifestet nøgles på Genesys' org-id, ikke vores kunde-id** — Med ti kunder der hver har dev/uat/prod er det afgørende at en post entydigt hører til én organisation. Kunde-id'er er lokale tidsstempler der skifter hvis en kunde slettes og oprettes igen; org-id'et følger organisationen. Ældre poster slås stadig op på kunde-id.
- **Publiceringstidspunktet sammenlignes mod Genesys' eget ur** — Nulpunktet gemmer mål-flowets `dateCheckedIn`, og senere sammenligninger holdes op mod den værdi frem for vores egen tidsstempel, som afhænger af maskinens ur.

> **Sæt nulpunkt pr. par af orgs.** Kør den én gang for hver kombination du arbejder med — fx `dev → uat` og `dev → prod` for hver kunde. Hver mål-org får sit eget sæt poster.

---
**🇬🇧 English**
- **📌 Set baseline** — A new button in Flow Browser that records how the comparison org's flows look right now: version, publish timestamp and whether the flow is active. From then on the tool can catch a change made directly in the target org — **including for flows it never migrated itself**. The baseline uses API calls only and takes seconds; a content hash per flow would need an Archy export each and take over 20 minutes for 84 flows.
- **A baseline never overwrites a real migration record** — If the tool migrated a flow, that record keeps its content hash. Verified: 117 recorded, 1 skipped.
- **Fixed: drift detection never worked** — The manifest stored the flow type from the YAML root (`inboundCall`) while the lookup used the API form (`INBOUNDCALL`). They could never match, so both the drift verdict and "published after migration" from v1.12/v1.13 were dead code in practice. The type is now normalised in one place.
- **The manifest is keyed on the Genesys org id, not our customer id** — With ten customers each having dev/uat/prod it matters that a record belongs unambiguously to one organisation. Customer ids are local timestamps that change if a customer is deleted and re-added; the org id follows the organisation. Older records are still matched on customer id.
- **Publish times are compared against Genesys' own clock** — The baseline stores the target flow's `dateCheckedIn`, and later comparisons are measured against that rather than our own timestamp, which depends on the machine's clock.

> **Set a baseline per pair of orgs.** Run it once for each combination you work with — e.g. `dev → uat` and `dev → prod` for each customer. Each target org gets its own set of records.

### v1.13.0
---
**🇩🇰 Dansk**
- **Typefilter i Flow Browser** — Rullemenu med de flowtyper der faktisk findes i org'en, med antal pr. type (`WORKFLOW (20)`). Vælges en type, vises kun den. Filteret virker sammen med fritekstsøgningen.
- **Publiceringstidspunkt i sammenligningen** — Sammenligningsdialogen viser nu hvornår hver side sidst blev publiceret, og af hvem. Er flowet aldrig publiceret, står det eksplicit — det er værd at vide, for så findes flowet i org'en uden at være i drift.
- **⚠️ Fanger ændringer lavet direkte i prod** — Er mål-flowet publiceret **efter** det tidspunkt hvor vi migrerede det, siger dialogen det tydeligt: *"Målet er publiceret EFTER migreringen — nogen har ændret det direkte i mål-org'en."* Det er præcis den situation hvor nogen har rettet i prod uden at føre ændringen tilbage til dev.
- Er brugeren der publicerede slettet siden, udelades navnet i stedet for at vise et rå GUID.

---
**🇬🇧 English**
- **Type filter in Flow Browser** — A dropdown with the flow types actually present in the org, with a count per type (`WORKFLOW (20)`). Picking a type shows only that type. The filter works together with the free-text search.
- **Publish timestamps in the comparison** — The comparison dialog now shows when each side was last published, and by whom. If a flow has never been published that is stated explicitly — worth knowing, since the flow then exists in the org without being live.
- **⚠️ Catches changes made directly in prod** — If the target flow was published **after** the time we migrated it, the dialog says so plainly: *"The target was published AFTER the migration — someone changed it directly in the target org."* That is exactly the case where someone fixed something in prod without carrying it back to dev.
- If the publishing user has since been deleted, the name is omitted rather than showing a raw GUID.

### v1.12.0
---
**🇩🇰 Dansk**
- **⇄ Sammenlign et flow i to orgs på indhold** — Genesys' versionsnumre er per-org tællere: samme flow kan stå som v37 i kilden og v1 i målet. Tallene kan derfor aldrig bruges til at afgøre om to flows er ens. På Flow Browser vælges nu en org at sammenligne mod, og hver række får en ⇄-knap der eksporterer flowet fra begge orgs og sammenligner **indholdet**.
- **Normalisering skiller støj fra reelle forskelle** — To slags Archy-intern nummerering fjernes først: `trackingId` og løbenumrene i `refId` / `[Navn_10]`. Målt på to flowpar: 8 rå forskelle blev til 1 (en ægte logikforskel), 296 blev til 280 (to reelt forskellige flows).
- **Tre udfald** — *identisk indhold*, *N forskelle* med de første vist linje for linje, eller *findes ikke i mål-org'en*.
- **Migreringsmanifest** — Hver vellykket flow-migrering noteres i `flows/.migrations.json` med kilde, mål, versioner og indholds-hash. Ved en senere sammenligning kan værktøjet derfor sige *hvad* der har flyttet sig: kilden er ændret (målet er forældet), målet er ændret (nogen har rettet direkte i mål-org'en), eller begge.

> **Læs hashen asymmetrisk.** Ens hash betyder med sikkerhed samme indhold. Forskellig hash betyder "se på diffen" — normaliseringen er bygget på de støjklasser der er observeret, og andre flowtyper kan have flere.

---
**🇬🇧 English**
- **⇄ Compare a flow across two orgs by content** — Genesys version numbers are per-org counters: the same flow can be v37 in the source and v1 in the target. The numbers can therefore never tell you whether two flows match. Flow Browser now has an org to compare against, and each row gets a ⇄ button that exports the flow from both orgs and compares the **content**.
- **Normalisation separates noise from real differences** — Two kinds of Archy-internal numbering are removed first: `trackingId` and the sequence numbers in `refId` / `[Name_10]`. Measured on two flow pairs: 8 raw differences became 1 (a genuine logic difference), 296 became 280 (two genuinely different flows).
- **Three verdicts** — *identical content*, *N differences* with the first shown line by line, or *does not exist in the target org*.
- **Migration manifest** — Every successful flow migration is recorded in `flows/.migrations.json` with source, target, versions and content hash. A later comparison can therefore say *what* moved: the source changed (the target is out of date), the target changed (someone edited it directly), or both.

> **Read the hash asymmetrically.** An equal hash means the content is certainly the same. A differing hash means "look at the diff" — the normalisation is built on the noise classes observed so far, and other flow types may have more.

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
