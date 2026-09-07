# Changelog — Archy GUI

> Alle ændringer, nyeste først. Installation og brug står i [README](README.md).
> All changes, newest first. Installation and usage live in the [README](README.md).

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
