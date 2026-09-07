// Prøve-YAML til testene. Formen er taget fra en RIGTIG Archy-eksport
// (flows/Sabio APS/DEV_WeekNumber_v2-0.yaml) og ikke opdigtet — indrykningen og
// rækkefølgen er netop det regexerne i server.js læser efter, så en fri
// gengivelse ville teste noget andet end det programmet møder.

// Et flow i et præfikset dev-miljø: eget navn, egen division, og referencer til
// den præfiksede datatabel og det præfiksede common module.
const DEV_FLOW = `inboundCall:
  name: DEV_WeekNumber
  description: ""
  division: DEV
  startUpRef: "/inboundCall/tasks/task[RouteCallByWeekNumber_12]"
  defaultLanguage: da-dk
  supportedLanguages:
    da-dk:
      defaultLanguageSkill:
        noValue: true
  tasks:
    - task:
        name: RouteCallByWeekNumber
        refId: RouteCallByWeekNumber_12
        actions:
          - dataTableLookup:
              name: Slaa uge op
              trackingId: 42
              dataTable:
                DEV_By Week Routing:
                  foundOutputs:
                    PhoneNumber:
                      var: Task.toPhoneNumber
                  failureOutputs:
                    errorType:
                      var: Task.errorType
          - transferToAcd:
              targetQueue:
                lit:
                  name: Support DK
          - callCommonModule:
              commonModule:
                DEV_Faelles logning:
                  inputs:
                    Flow.Step: 1
`;

// Samme flow som det ser ud i prod: uden præfiks, med prods division. En
// fejlfri forfremmelse skal give præcis disse forskelle — og kun dem.
const PROD_FLOW = DEV_FLOW
  .replace('name: DEV_WeekNumber', 'name: WeekNumber')
  .replace('division: DEV', 'division: Home')
  .replace('DEV_By Week Routing:', 'By Week Routing:')
  .replace('DEV_Faelles logning:', 'Faelles logning:');

// Et common module. Formen er fra flows/Sabio APS - PROD/Create Logitems_v3-0.yaml.
//
// Det afgørende er at 'commonModule:' står på INDRYKNING 0 — dér er det flowets
// egen type, ikke en reference til et andet modul — og at linjen under er
// flowets navnefelt. Det var netop dét prefixDependenciesInYaml forvekslede
// med en afhængighed, så 'name:' blev til 'DEV_name:'.
const MODUL_FLOW = `commonModule:
  name: Create Logitems
  division: Home
  supportedLanguages:
    da-dk:
      none: true
  variables:
    - integerVariable:
        name: Common.i_log_Index
        initialValue:
          lit: 0
  tasks:
    - task:
        name: Log
        actions:
          - callCommonModule:
              commonModule:
                NRD_SplitDate:
                  ver_latestPublished: true
          - dataTableLookup:
              dataTable:
                By Week Routing:
                  foundOutputs:
                    x:
                      var: Task.x
`;

// Fire miljøer i én gruppe — den opsætning pipelinen er bygget til.
const KUNDE = {
  dev:  { id: 'k-dev',  name: 'Kunde DEV',  tenant: 'Kunde A/S', group: 'DK', stage: 'dev',  prefix: 'DEV_',  division: 'DEV',  clientId: 'cid', region: 'mypurecloud.de' },
  test: { id: 'k-test', name: 'Kunde TEST', tenant: 'Kunde A/S', group: 'DK', stage: 'test', prefix: 'TEST_', division: 'TEST', clientId: 'cid', region: 'mypurecloud.de' },
  uat:  { id: 'k-uat',  name: 'Kunde UAT',  tenant: 'Kunde A/S', group: 'DK', stage: 'uat',  prefix: 'UAT_',  division: 'UAT',  clientId: 'cid', region: 'mypurecloud.de' },
  prod: { id: 'k-prod', name: 'Kunde PROD', tenant: 'Kunde A/S', group: 'DK', stage: 'prod',                                    clientId: 'cid', region: 'mypurecloud.de' }
};
KUNDE.alle = [KUNDE.dev, KUNDE.test, KUNDE.uat, KUNDE.prod];

// En helt anden kunde — bruges til at vise at vagten spærrer på tværs.
const ANDEN = { id: 'a-dev', name: 'Anden DEV', tenant: 'Anden A/S', group: 'SE', stage: 'dev' };

// Et miljø uden opsætning. Det hører ikke sammen med noget — heller ikke med
// et andet miljø uden opsætning.
const LOES = { id: 'loes', name: 'Løs org' };

module.exports = { DEV_FLOW, PROD_FLOW, MODUL_FLOW, KUNDE, ANDEN, LOES };
