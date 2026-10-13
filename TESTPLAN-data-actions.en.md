# Test plan: data actions, setup proposal, pre-promotion check and FDA marker (v1.49–v1.55)

> 🇩🇰 Dansk version: [TESTPLAN-data-actions.md](TESTPLAN-data-actions.md)

The purpose is to try out what has been built and unit-tested but never run against two real orgs. The order is set so that everything that only reads comes first, and everything that writes only hits a **test org** (never prod).

## Before you start

- **Two different Genesys orgs** in Archy, in the same customer and group: **A** (source, e.g. test) and **B** (target, a test or sandbox org). Not Sabio's shared org, and not prod as the target to begin with.
- Archy GUI on **v1.55.0** or later (the version is at the bottom of the sidebar). Restart after updating.
- Permissions on both orgs' clients: `integrations:integration:view`, `integrations:action:view`, `architect:dependencyTracking:view`. On **B** also `integrations:action:add` (for tests 4 and 6).
- A few **harmless** data actions in A that can be created in B and deleted again (e.g. three simple Web Services actions).
- A flow in A that uses at least one data action, preferably one whose name exists under a **different category** in B. A flow with a **Function Data Action** for test 7.
- Know where to look for errors: the **System log** in Archy (category MIGRATE).

---

## Part 1 — read only

### Test 1: Full check

*Migrate resources → choose A as source and B as target → the Full check tab → Run full check.*

| Expected | Done |
|---|---|
| The numbers *In the source*, *Match*, *Saved choice*, *To choose*, *Missing*, *FDA missing* are there | ☐ |
| *In the source* agrees with the number of data actions in A (Genesys: Admin → Integrations → Actions) | ☐ |
| Genesys' own built-in actions (id starts with `static_`) are **not** listed as missing | ☐ |
| A click on a number filters the list; search works | ☐ |
| An action with the same name but a **different category** in B shows as *choose* with the candidate | ☐ |
| **Check contracts** runs with progress (x of y) and shows fields that are missing, extra or have another type | ☐ |
| Choose two environments in the **same org** → the tab says there is nothing to compare | ☐ |

If something does not match: write down the name of the action and what you expected.

### Test 2: Setup proposal (read only, before anything is created)

*The Setup proposal tab → set the limit per integration → Make proposal.*

| Expected | Done |
|---|---|
| Capacity bars for every **active** integration in B, showing what exists | ☐ |
| **Inactive** integrations in B are listed in one line under the bars and are never proposed | ☐ |
| A source integration with no active integration of the same type in B: it says what it should be called | ☐ |
| Set the limit low (e.g. 5): bars turn yellow/red and "without room" is shown | ☐ |
| Move a group to another integration in the list: the bars follow | ☐ |
| **Export to Excel** gives a CSV that opens in Excel with æ/ø/å intact and the columns separated | ☐ |
| **Printable page** opens a page; Ctrl+P gives a readable PDF | ☐ |
| The export contains only names and numbers (no ids or secrets) | ☐ |

### Test 3a: Pre-promotion check (read only)

*Pipeline → show the group → ✔ Check next to Promote for a flow that uses data actions.*

| Expected | Done |
|---|---|
| The report has the groups *blocks*, *must be decided* and *handled along the way* | ☐ |
| If a Function Data Action is missing in B, it is listed under *blocks* | ☐ |
| A data action under a different category is listed under *must be decided* with the candidate | ☐ |
| Nothing has changed in B afterwards (look in B's Architect and Integrations) | ☐ |
| The same flow afterwards via **⟶ Promote**: the dialog shows the same as the report | ☐ |

### Test 3b: FDA marker on the board (read only)

*Pipeline → show the group. Use a flow that **directly** uses a Function Data Action in A (published), and which does not exist as an FDA in B. The markers arrive in the background, a few seconds after the board is drawn.*

| Expected | Done |
|---|---|
| The flow in A's column has a yellow **⚙ FDA**; the tooltip names the FDA | ☐ |
| The same flow in B's column has a red **✗ FDA missing here**; the tooltip names it | ☐ |
| A flow **without** an FDA has neither marker | ☐ |
| Create a function with the same name in B, wait a couple of minutes and press Pipeline again: the red marker is gone (yellow stays in A and B) | ☐ |
| The board did not become noticeably slower to open (the markers appear afterwards) | ☐ |
| **? Buttons** mentions the markers | ☐ |
| ⟶ Promote of the flow with the red marker shows the same block as ✔ Check (test 3a) | ☐ |

> The dependency tracking only knows the **published** version and can lag a few minutes. If a marker is missing right after a publish, wait and try again before reporting it as a fault. A flow that uses an FDA **through a common module** does not get the marker itself; the module does.

---

## Part 2 — writes (only to B, and only a test org)

### Test 4: Migrate by the plan — **the most important item**

*Setup proposal → choose a small subset if you can (otherwise the whole proposal) → **Migrate by the plan**.*

| Expected | Done |
|---|---|
| The confirmation mentions the count and the number of integrations; integrations over the limit are named | ☐ |
| The log shows every action: *Created and published* or *already exists* | ☐ |
| **Stop** in the middle of a run: what has been created stays, the rest is skipped | ☐ |
| In Genesys (B → Integrations → the chosen integration) the actions are in the **right** integration | ☐ |
| **The category of the new action is the integration's name** (see the action's details in Genesys) | ☐ |
| Choose an integration that is full: the error is in the log, and the run continues | ☐ |
| The bars are counted again afterwards and show the new actions | ☐ |

> **The item about the category decides whether the fix in v1.51.1 holds.** The assumption is that an action's category is the integration's name. That matches Sabio's existing actions, but has not been tried for a *created* action. If the category in Genesys shows the source's instead, tell me before you go on.

### Test 5: Saved mapping

| Expected | Done |
|---|---|
| After test 4 run the Full check again: the migrated actions show as *saved choice* or *match* | ☐ |
| Clear the field of a saved choice and press **Save mapping**: the row goes back to *choose* | ☐ |
| The mapping is in B's manifest table (the row `ArchyGUI_DataActionMap`), or in `flows\.data-action-map.json` if B has no manifest table | ☐ |

### Test 6: Promoting a flow with data actions

*Promote the flow from test 3a from A to B.*

| Expected | Done |
|---|---|
| If the names do not match: a list *Data actions in the flow* with a status per action | ☐ |
| Choose the target's action; continue; the import succeeds | ☐ |
| Open the flow in B (Architect): the data action points at the **target's** action and category | ☐ |
| The release note for the promotion mentions the rewritten references | ☐ |
| Version and name are as before (version number alignment works unchanged) | ☐ |
| Run the promotion **again**: the list does not appear, because the choice is saved and used automatically | ☐ |
| The source's own flow in A is unchanged | ☐ |

### Test 7: A Function Data Action blocks

*Promote a flow that uses a Function Data Action that does not exist in B.*

| Expected | Done |
|---|---|
| The dialog shows it in red as blocking; *Continue anyway* and *Migrate selected* are hidden | ☐ |
| **Copy checklist** puts a list on the clipboard | ☐ |
| Create a function with the same name in B and press **Check again**: the block is gone | ☐ |
| Nothing was imported into B while the block stood | ☐ |

---

## Part 3 — the prod guard (only if prod is set up)

| Expected | Done |
|---|---|
| Full check, Setup proposal and ✔ Check against a prod target work **without** a prod login (they only read) | ☐ |
| **Save mapping** and **Migrate by the plan** against prod without a login are refused with a message about the prod login | ☐ |
| After logging in as yourself they work, and the prod confirmation is shown | ☐ |

Only write to prod once part 2 has gone through cleanly.

---

## Clean-up after the test

1. Delete the actions you created in B (Genesys → Admin → Integrations → Actions).
2. Remove the mapping for the org pair (clear the fields in the Full check and press Save mapping), or delete the file `flows\.data-action-map.json`.
3. Delete the imported test flow in B if you do not want to keep it.

## What I would like back

- Which items did **not** match, with the name of the action or flow and what you expected.
- The relevant lines from the **System log** (category MIGRATE) for anything that failed.
- The answer to the item about the category in test 4.

## Known limitations (not faults)

- Credentials on the integrations are not checked. An action in an integration without a valid credential can be created, but does not run.
- The limit per integration is a number you type in. Archy does not know it.
- The FDA marker on the board does not follow an FDA through a common module, and only knows the published version.
- The marker has only been seen with simulated data and against an org without used FDAs. Test 3b is the first time it is seen with a real, used FDA.
- Actions that are missing can also be migrated on the *Data Actions* tab; *Migrate by the plan* is the new way.
