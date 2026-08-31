# Archy GUI — Flow Manager · v1.20.1

> 🇩🇰 [Dansk](#dansk) · 🇬🇧 [English](#english)

---

## Changelog

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

> Oplysningerne gemmes i `flows/.migrations.json`, nøglet på Genesys' org-id. Filen er maskinspecifik og deles ikke via Git.

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

> Current version: **v1.20.1** — see [Changelog](#changelog) above.

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

> The records live in `flows/.migrations.json`, keyed on the Genesys org id. The file is machine-specific and is not shared through Git.

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
