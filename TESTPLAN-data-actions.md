# Testplan: data actions, setup-forslag, pipeline-tjek og FDA-mærke (v1.49–v1.55)

> 🇬🇧 English version: [TESTPLAN-data-actions.en.md](TESTPLAN-data-actions.en.md)

Formålet er at afprøve det, der er bygget og enhedstestet, men aldrig kørt mod to rigtige orgs. Rækkefølgen er lagt, så alt der kun læser, kommer først, og alt der skriver, kun rammer en **test-org** (aldrig prod).

## Før du starter

- **To forskellige Genesys-orgs** i Archy, i samme kunde og gruppe: **A** (kilde, fx test) og **B** (mål, en test- eller sandbox-org). Ikke Sabios fælles org, og ikke prod som mål i første omgang.
- Archy GUI på **v1.55.0** eller nyere (versionen står nederst i sidebaren). Genstart efter opdatering.
- Rettigheder på begge orgs' klienter: `integrations:integration:view`, `integrations:action:view`, `architect:dependencyTracking:view`. På **B** desuden `integrations:action:add` (til test 4 og 6).
- Et par **harmløse** data actions i A, som kan oprettes i B og slettes igen (fx tre simple Web Services-actions).
- Et flow i A, der bruger mindst én data action, helst én hvis navn findes under en **anden kategori** i B. Et flow med en **Function Data Action** til test 7.
- Notér hvor du kigger efter fejl: **Systemlog** i Archy (kategorien MIGRATE).

---

## Del 1 — kun læsning

### Test 1: Totaltjek

*Migrér ressourcer → vælg A som kilde og B som mål → fanen Totaltjek → Kør totaltjek.*

| Forventet | Tjek |
|---|---|
| Tallene *I kilden*, *Matcher*, *Gemt valg*, *Skal vælges*, *Mangler*, *FDA mangler* står der | ☐ |
| *I kilden* passer med antallet af data actions i A (Genesys: Admin → Integrations → Actions) | ☐ |
| Genesys' egne indbyggede actions (id begynder med `static_`) står **ikke** som mangler | ☐ |
| Et klik på et tal filtrerer listen; søgning virker | ☐ |
| En action med samme navn, men en **anden kategori** i B, står som *vælg* med kandidaten | ☐ |
| **Tjek kontrakter** kører med fremgang (x af y) og viser felter, der mangler, er ekstra eller har anden type | ☐ |
| Vælg to miljøer i **samme org** → fanen siger, at der intet er at sammenligne | ☐ |

Hvis noget ikke passer: skriv navnet på action'en og hvad du forventede.

### Test 2: Setup-forslag (læsning, før noget oprettes)

*Fanen Setup-forslag → sæt grænsen pr. integration → Lav forslag.*

| Forventet | Tjek |
|---|---|
| Kapacitetsbjælker for hver **aktive** integration i B, med det der findes | ☐ |
| **Inaktive** integrationer i B står i en linje under bjælkerne og foreslås aldrig | ☐ |
| En kildeintegration uden aktiv integration af samme type i B: der står hvad den skal hedde | ☐ |
| Sæt grænsen lavt (fx 5): bjælker bliver gule/røde, og "uden plads" vises | ☐ |
| Flyt en gruppe til en anden integration i listen: bjælkerne følger med | ☐ |
| **Eksportér til Excel** giver en CSV, der åbner i Excel med æ/ø/å i orden og kolonnerne adskilt | ☐ |
| **Printvenlig side** åbner en side; Ctrl+P giver en læsbar PDF | ☐ |
| Eksporten indeholder kun navne og tal (ingen id'er eller hemmeligheder) | ☐ |

### Test 3a: Pipeline-tjek (læsning)

*Pipeline → vis gruppen → ✔ Tjek ved Forfrem for et flow, der bruger data actions.*

| Forventet | Tjek |
|---|---|
| Rapporten har grupperne *blokerer*, *skal afklares* og *håndteres undervejs* | ☐ |
| Mangler en Function Data Action i B, står den under *blokerer* | ☐ |
| En data action under en anden kategori står under *skal afklares* med kandidaten | ☐ |
| Ingenting er ændret i B bagefter (kig i B's Architect og Integrations) | ☐ |
| Samme flow bagefter via **⟶ Forfrem**: dialogen viser det samme som rapporten | ☐ |

### Test 3b: FDA-mærke på tavlen (læsning)

*Pipeline → vis gruppen. Brug et flow, der **direkte** bruger en Function Data Action i A (publiceret), og som ikke findes som FDA i B. Mærkerne kommer i baggrunden, få sekunder efter at tavlen er tegnet.*

| Forventet | Tjek |
|---|---|
| Flowet i A's kolonne har et gult **⚙ FDA**; tooltip nævner FDA'ens navn | ☐ |
| Samme flow i B's kolonne har et rødt **✗ FDA mangler her**; tooltip nævner navnet | ☐ |
| Et flow **uden** FDA har ingen af mærkerne | ☐ |
| Opret en function med samme navn i B, vent et par minutter, og tryk Pipeline igen: det røde mærke er væk (gult står i A og B) | ☐ |
| Tavlen blev ikke mærkbart langsommere at åbne (mærkerne dukker op bagefter) | ☐ |
| **? Knapperne** nævner mærkerne | ☐ |
| ⟶ Forfrem af flowet med rødt mærke viser samme blokering som ✔ Tjek (test 3a) | ☐ |

> Afhængighedssporingen kender kun den **publicerede** udgave og kan være få minutter bagud. Mangler mærket lige efter en publicering, så vent og prøv igen, før du melder det som fejl. Et flow, der bruger en FDA **gennem et common module**, får ikke selv mærket; modulet gør.

---

## Del 2 — skriver (kun til B, og kun test-org)

### Test 4: Migrér efter planen — **det vigtigste punkt**

*Setup-forslag → vælg et lille udsnit, hvis du kan (ellers hele forslaget) → **Migrér efter planen**.*

| Forventet | Tjek |
|---|---|
| Bekræftelsen nævner antal og antal integrationer; integrationer over grænsen nævnes | ☐ |
| Loggen viser hver action: *Oprettet og publiceret* eller *findes allerede* | ☐ |
| **Stop** midt i en kørsel: det oprettede bliver stående, resten springes over | ☐ |
| I Genesys (B → Integrations → den valgte integration) ligger actions i den **rigtige** integration | ☐ |
| **Kategorien på den nye action er integrationens navn** (se action'ens detaljer i Genesys) | ☐ |
| Vælg en integration, der er fuld: fejlen står i loggen, og kørslen fortsætter | ☐ |
| Bjælkerne tælles igen bagefter og viser de nye actions | ☐ |

> **Punktet om kategorien afgør, om rettelsen i v1.51.1 holder.** Antagelsen er, at en actions kategori er integrationens navn. Det passer med Sabios eksisterende actions, men er ikke afprøvet for en *oprettet* action. Hvis kategorien i Genesys står som kilden i stedet, så sig det til mig, før du går videre.

### Test 5: Gemt kortlægning

| Forventet | Tjek |
|---|---|
| Efter test 4 kører Totaltjek igen: de migrerede actions står som *gemt valg* eller *matcher* | ☐ |
| Ryd feltet for et gemt valg og tryk **Gem kortlægning**: rækken går tilbage til *vælg* | ☐ |
| Kortlægningen ligger i B's manifest-tabel (rækken `ArchyGUI_DataActionMap`), eller i `flows\.data-action-map.json` hvis B ingen manifest-tabel har | ☐ |

### Test 6: Forfremmelse af et flow med data actions

*Forfrem flowet fra test 3a fra A til B.*

| Forventet | Tjek |
|---|---|
| Hvis navnene ikke passer: en liste *Data actions i flowet* med status pr. action | ☐ |
| Vælg målets action; fortsæt; importen lykkes | ☐ |
| Åbn flowet i B (Architect): data action'en peger på **målets** action og kategori | ☐ |
| Release-noten for forfremmelsen nævner de omskrevne referencer | ☐ |
| Version og navn er som før (udligning af versionsnummer virker uændret) | ☐ |
| Kør forfremmelsen **igen**: listen kommer ikke, for valget er gemt og bruges automatisk | ☐ |
| Kildens eget flow i A er uændret | ☐ |

### Test 7: Function Data Action blokerer

*Forfrem et flow, der bruger en Function Data Action, som ikke findes i B.*

| Forventet | Tjek |
|---|---|
| Dialogen viser den i rødt som blokerende; *Fortsæt uden* og *Migrér valgte* er skjult | ☐ |
| **Kopiér tjekliste** lægger en liste på udklipsholderen | ☐ |
| Opret en function med samme navn i B og tryk **Tjek igen**: blokeringen er væk | ☐ |
| Intet er importeret i B, mens blokeringen stod | ☐ |

---

## Del 3 — prod-vagten (kun hvis prod er sat op)

| Forventet | Tjek |
|---|---|
| Totaltjek, Setup-forslag og ✔ Tjek mod et prod-mål virker **uden** prod-login (de læser kun) | ☐ |
| **Gem kortlægning** og **Migrér efter planen** mod prod uden login afvises med en besked om prod-login | ☐ |
| Efter login som dig selv virker de, og prod-bekræftelsen vises | ☐ |

Skriv kun til prod, når del 2 er gennemført rent.

---

## Oprydning efter testen

1. Slet de actions, du oprettede i B (Genesys → Admin → Integrations → Actions).
2. Fjern kortlægningen for org-parret (ryd felterne i Totaltjek og tryk Gem kortlægning), eller slet filen `flows\.data-action-map.json`.
3. Slet det importerede testflow i B, hvis du ikke vil beholde det.

## Det vil jeg gerne have tilbage

- Hvilke punkter der **ikke** passede, med navnet på action eller flow og hvad du forventede.
- De relevante linjer fra **Systemlog** (kategori MIGRATE) for alt, der fejlede.
- Svaret på punktet om kategorien i test 4.

## Kendte begrænsninger (ikke fejl)

- Credentials på integrationerne tjekkes ikke. En action i en integration uden gyldig credential kan oprettes, men kører ikke.
- Grænsen pr. integration er et tal, du taster. Archy kender den ikke.
- FDA-mærket på tavlen følger ikke en FDA gennem et common module, og kender kun den publicerede udgave.
- Mærket er kun set med simulerede data og mod en org uden brugte FDA'er. Test 3b er første gang, det ses med en rigtig, brugt FDA.
- Actions, der mangler, migreres også på fanen *Data Actions*; *Migrér efter planen* er den nye vej.
