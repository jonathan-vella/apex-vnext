#!/usr/bin/env node
/** Render a reviewed command policy from offline tools/list captures, then refresh canonical digests. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";
import {
  armRegistryPath,
  azureMcpArguments,
  azureRegistryPath,
  contractDigest,
  digestPath,
  exactAzureMcpVersion,
} from "./_lib/mcp-contracts.mjs";

export const APPROVED_NAMESPACES = Object.freeze([
  "documentation",
  "get_azure_bestpractices",
  "aks",
  "applens",
  "appservice",
  "role",
  "azurebackup",
  "azureterraform",
  "azureterraformbestpractices",
  "acr",
  "advisor",
  "bicepschema",
  "cloudarchitect",
  "compute",
  "containerapps",
  "cosmos",
  "deploy",
  "eventgrid",
  "eventhubs",
  "fileshares",
  "functionapp",
  "functions",
  "quota",
  "monitor",
  "applicationinsights",
  "mysql",
  "optimization",
  "policy",
  "postgres",
  "pricing",
  "redis",
  "resiliency",
  "resourcehealth",
  "servicebus",
  "sql",
  "storage",
  "storagesync",
  "virtualdesktop",
  "wellarchitectedframework",
  "workbooks",
  "kusto",
  "subscription_list",
  "group_list",
  "group_resource_list",
]);

// This is a reviewed, explicit command set, not a prefix or readOnlyHint-based authorization rule.
export const APPROVED_COMMANDS = Object.freeze(
  `
microsoft_docs_search microsoft_code_sample_search microsoft_docs_fetch
get_azure_bestpractices_ai_app get_azure_bestpractices_get
acr_registry_list acr_registry_repository_list
advisor_metadata_get advisor_metadata_list advisor_recommendation_list advisor_recommendation_summary advisor_remediation_get
aks_cluster_get aks_nodepool_get applens_resource_diagnose applicationinsights_recommendation_list
appservice_webapp_deployment_get appservice_webapp_diagnostic_diagnose appservice_webapp_diagnostic_list appservice_webapp_get
azurebackup_backup_status azurebackup_container_get azurebackup_container_list-available
azurebackup_governance_find-unprotected azurebackup_job_get azurebackup_policy_get
azurebackup_protectableitem_list azurebackup_protecteditem_get azurebackup_recoverypoint_get
azurebackup_resourceguard_get azurebackup_vault_get azurebackup_vault_privateendpoint_get
azureterraform_avm_get azureterraform_avm_list azureterraform_avm_versions azureterraform_azapi_get azureterraform_azurerm_get
azureterraformbestpractices_get bicepschema_get cloudarchitect_design
compute_disk_get compute_vm_get compute_vmss_get containerapps_list cosmos_list
deploy_app_logs_get deploy_iac_rules_get deploy_pipeline_guidance_get deploy_plan_get
eventgrid_subscription_list eventgrid_topic_list
eventhubs_eventhub_consumergroup_get eventhubs_eventhub_get eventhubs_namespace_get
fileshares_fileshare_check-name-availability fileshares_fileshare_get fileshares_fileshare_peconnection_get
fileshares_fileshare_snapshot_get fileshares_limits fileshares_rec fileshares_usage
functionapp_get functions_language_list functions_project_get functions_template_get
kusto_cluster_get kusto_cluster_list kusto_database_list kusto_sample kusto_table_list kusto_table_schema
monitor_activitylog_list monitor_healthmodels_get monitor_healthmodels_list monitor_instrumentation_get-learning-resource
monitor_metrics_batchquery monitor_metrics_definitions monitor_metrics_query monitor_resource_log_query
monitor_table_list monitor_table_type_list monitor_webtests_get monitor_workspace_list
monitor_workspace_log_query monitor_workspace_log_search
mysql_list mysql_server_config_get mysql_server_param_get mysql_table_schema_get
optimization_recommendation_alternatives optimization_recommendation_explain optimization_recommendation_list
policy_assignment_list postgres_list postgres_server_config_get postgres_server_param_get postgres_table_schema_get
pricing_get quota_region_availability_list quota_usage_check redis_list
resiliency_drill_get resiliency_drill_resource_get resiliency_drill_run_get resiliency_drill_run_resource_get
resiliency_goal_assignment_get resiliency_goal_resource_get resiliency_recoveryjob_get resiliency_recoveryjob_resource_get
resiliency_recoveryplan_get resiliency_recoveryplan_resource_get resiliency_usageplan_enrollment_get resiliency_usageplan_get
resourcehealth_availability-status_get resourcehealth_health-events_list role_assignment_list
servicebus_queue_details servicebus_topic_details servicebus_topic_subscription_details
sql_db_get sql_elastic-pool_list sql_server_entra-admin_list sql_server_firewall-rule_list sql_server_get
storage_account_get storage_blob_container_get storage_blob_get storage_table_list
storagesync_cloudendpoint_get storagesync_registeredserver_get storagesync_serverendpoint_get
storagesync_service_get storagesync_syncgroup_get
virtualdesktop_hostpool_host_list virtualdesktop_hostpool_host_user-list virtualdesktop_hostpool_list
wellarchitectedframework_serviceguide_get workbooks_list workbooks_show
subscription_list group_list group_resource_list
`
    .trim()
    .split(/\s+/u),
);

function inputSchema(schema) {
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["description", "default"].includes(key)) continue;
    if (!["type", "enum", "format", "required", "additionalProperties", "properties", "items"].includes(key))
      throw new Error(`Unreviewed schema keyword: ${key}`);
    result[key] =
      key === "properties"
        ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, inputSchema(child)]))
        : key === "items"
          ? inputSchema(value)
          : value;
  }
  return result;
}

function reviewedTool(tool) {
  if (!tool || tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false)
    throw new Error(`Reviewed command missing or not read-only: ${tool?.name}`);
  return {
    inputSchema: inputSchema(tool.inputSchema),
    annotations: { readOnlyHint: true, destructiveHint: false },
    capturedSchemaSha256: contractDigest(tool.inputSchema),
  };
}

export function generateAzureRegistry(namespaceCapture, commandCapture, version) {
  if (new Set(APPROVED_COMMANDS).size !== APPROVED_COMMANDS.length) throw new Error("Duplicate approved command");
  const routers = new Map(namespaceCapture.tools.map((tool) => [tool.name, tool]));
  const commands = new Map(commandCapture.tools.map((tool) => [tool.name, tool]));
  const routerInputSchema = inputSchema(routers.get("pricing").inputSchema);
  const used = new Set();
  const namespaces = Object.fromEntries(
    APPROVED_NAMESPACES.map((name) => {
      const tool = routers.get(name);
      if (!tool) throw new Error(`Missing approved namespace: ${name}`);
      if (["subscription_list", "group_list", "group_resource_list"].includes(name)) {
        used.add(name);
        return [name, { kind: "direct", ...reviewedTool(tool) }];
      }
      if (contractDigest(inputSchema(tool.inputSchema)) !== contractDigest(routerInputSchema))
        throw new Error(`Unexpected namespace router schema: ${name}`);
      const names = APPROVED_COMMANDS.filter((command) =>
        name === "documentation" ? command.startsWith("microsoft_") : command.startsWith(`${name}_`),
      );
      if (!names.length) throw new Error(`Empty approved namespace: ${name}`);
      return [
        name,
        {
          kind: "router",
          commands: Object.fromEntries(
            names.map((command) => {
              used.add(command);
              return [command, reviewedTool(commands.get(command))];
            }),
          ),
        },
      ];
    }),
  );
  if (used.size !== APPROVED_COMMANDS.length) throw new Error("Approved commands must map to exactly one namespace");
  return {
    $schema: "schemas/azure-mcp.schema.json",
    schemaVersion: "1.0.0",
    package: { name: "@azure/mcp", version, binaryVersion: namespaceCapture.binaryVersion },
    capture: {
      transport: "stdio",
      handshakeProtocol: namespaceCapture.initialized.protocolVersion,
      namespaceToolCount: namespaceCapture.tools.length,
      allToolCount: commandCapture.tools.length,
      method: "tools/list",
      azureOperationsExecuted: false,
      credentialsUsed: false,
    },
    routerInputSchema,
    namespaces,
    exclusions: [
      {
        commands: ["azd", "arm", "foundry"],
        reason: "Opaque or independently changing proxy command surfaces are not approved.",
      },
      {
        commands: ["keyvault", "appconfig", "appservice_webapp_settings_get-appsettings"],
        reason: "Secrets or application-setting values.",
      },
      {
        commands: ["azureterraform_aztfexport_*", "azureterraform_conftest_*", "extension_cli_install"],
        reason: "Local writes, exports or installation despite read-only discovery.",
      },
      {
        commands: ["cosmos_database_container_*"],
        reason: "Document access and inference are outside metadata-only inventory.",
      },
      {
        commands: ["kusto_query"],
        reason: "Underlying description permits management operations, not only diagnostic queries.",
      },
      {
        commands: ["deploy_architecture_diagram_generate"],
        reason: "Only deployment guidance and log reads are approved.",
      },
      {
        commands: ["foundryextensions", "speech", "sreagent"],
        reason: "Inference, speech operations or workflow execution are not approved.",
      },
    ],
    policy: {
      unknownToolDisposition: "deny-before-transport",
      unknownCommandDisposition: "deny-before-transport",
      learnOnly: { intent: "", learn: true, command: "absent", parameters: "absent" },
    },
  };
}

export function verifyManagedCapture(registry, managed) {
  if (
    managed.binaryVersion !== registry.package.binaryVersion ||
    managed.initialized?.serverInfo?.version !== registry.package.version
  )
    throw new Error("Final launch version must match the captured exact package and normalized server version");
  if (
    JSON.stringify(managed.tools.map(({ name }) => name).sort()) !==
    JSON.stringify(Object.keys(registry.namespaces).sort())
  )
    throw new Error("Final managed launch does not match approved grants");
  let pureLearnToolCount = 0;
  for (const [name, namespace] of Object.entries(registry.namespaces)) {
    const tool = managed.tools.find((candidate) => candidate.name === name);
    if (namespace.kind === "direct") {
      if (contractDigest(inputSchema(tool.inputSchema)) !== contractDigest(namespace.inputSchema))
        throw new Error(`Final direct tool schema drifted: ${name}`);
      continue;
    }
    const response = managed.learned?.[name];
    if (!response || response.isError) throw new Error(`Final pure-learn failed: ${name}`);
    const text = response.content
      .filter(({ type }) => type === "text")
      .map(({ text }) => text)
      .join("\n");
    const start = text.indexOf("\n[");
    if (start < 0) throw new Error(`Final pure-learn is not a command inventory: ${name}`);
    const commands = JSON.parse(text.slice(start + 1));
    for (const [command, reviewed] of Object.entries(namespace.commands)) {
      const actual = commands.find((candidate) => candidate.command === command);
      if (!actual || contractDigest(inputSchema(actual.inputSchema)) !== contractDigest(reviewed.inputSchema))
        throw new Error(`Final pure-learn command schema drifted: ${name}/${command}`);
    }
    pureLearnToolCount += 1;
  }
  return {
    serverVersion: managed.initialized.serverInfo.version,
    managedNamespaceToolCount: managed.tools.length,
    managedToolNamesSha256: contractDigest(managed.tools.map(({ name }) => name).sort()),
    pureLearnToolCount,
    approvedCommandSchemasMatch: true,
  };
}

async function main() {
  const [directory] = process.argv.slice(2);
  if (!directory) throw new Error("Supply the directory produced by capture-azure-mcp-inventory.mjs");
  const namespace = JSON.parse(await readFile(resolve(directory, "namespace.json"), "utf8"));
  const all = JSON.parse(await readFile(resolve(directory, "all.json"), "utf8"));
  const registry = generateAzureRegistry(namespace, all, exactAzureMcpVersion());
  const managed = JSON.parse(await readFile(resolve(directory, "namespace-managed.json"), "utf8"));
  registry.capture.managedLaunch = verifyManagedCapture(registry, managed);
  registry.safetyReviews = [
    {
      commands: ["functions_project_get", "functions_template_get"],
      conclusion:
        "Returns fetched template file-content records, not workspace writes. The service uses HTTP reads and in-memory ZipArchive reads.",
      sourceRevision: "6369a8a7a9822e804f4986f67619dfcd28fc815b",
      sources: [
        "https://github.com/microsoft/mcp/blob/6369a8a7a9822e804f4986f67619dfcd28fc815b/tools/Azure.Mcp.Tools.Functions/src/Commands/Project/ProjectGetCommand.cs",
        "https://github.com/microsoft/mcp/blob/6369a8a7a9822e804f4986f67619dfcd28fc815b/tools/Azure.Mcp.Tools.Functions/src/Commands/Template/TemplateGetCommand.cs",
        "https://github.com/microsoft/mcp/blob/6369a8a7a9822e804f4986f67619dfcd28fc815b/tools/Azure.Mcp.Tools.Functions/src/Services/FunctionsService.cs",
      ],
    },
    {
      commands: ["cloudarchitect_design"],
      conclusion:
        "Advisory output only. Upstream instructions, confidence scores and state guidance are data, not kernel authority or overrides.",
      sourceRevision: "6369a8a7a9822e804f4986f67619dfcd28fc815b",
      sources: ["https://github.com/microsoft/mcp/tree/6369a8a7a9822e804f4986f67619dfcd28fc815b"],
    },
  ];
  const formatting = await resolveConfig("package.json");
  const writeJson = async (path, value) =>
    writeFile(path, await format(JSON.stringify(value), { ...formatting, parser: "json" }));
  await writeJson(azureRegistryPath, registry);
  const files = {};
  for (const file of [azureRegistryPath, armRegistryPath])
    files[file] = contractDigest(JSON.parse(await readFile(file, "utf8")));
  await writeJson(digestPath, { schemaVersion: "1.0.0", files });
  const cost = {
    url: "https://mcp.management.azure.com",
    headers: { "x-mcp-toolset": "CostManagement" },
  };
  const plugin = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: {
      apex: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/mcp/apex.mjs"] },
      "apex-azure": { type: "stdio", command: "npx", args: azureMcpArguments(registry, "@azure/mcp") },
      "apex-azure-cost": { type: "streamable-http", ...cost },
    },
  };
  const development = {
    servers: {
      github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      "apex-azure": { type: "stdio", command: "node", args: azureMcpArguments(registry) },
      "apex-azure-cost": { type: "http", ...cost },
    },
  };
  await writeJson("plugin/mcp.json", plugin);
  await writeJson(".vscode/mcp.json", development);
  console.log(
    `Approved ${Object.keys(registry.namespaces).length} namespaces and ${APPROVED_COMMANDS.length} explicit commands`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
