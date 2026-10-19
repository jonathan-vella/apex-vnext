import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { validateAzureMcpRegistry } from "../scripts/validate-azure-mcp.mjs";
import {
  azureLaunchErrors,
  azureRegistryPath,
  exactAzureMcpVersion,
  readJson,
} from "../scripts/_lib/mcp-contracts.mjs";
import { azureCommandPolicy, pricingReadTools, renderHookScript, renderMcpConfig } from "../scripts/build-plugin.mjs";
import { developerMcpConfig, verifyManagedCapture } from "../scripts/generate-azure-mcp-registry.mjs";
import { validateMcpConfig } from "../scripts/validate-mcp-config.mjs";
import { load as loadYaml } from "js-yaml";
import { parseAggregate } from "../scripts/validate-repository-validator-graph.mjs";

const root = resolve(import.meta.dirname, "../..");
const scratch = mkdtempSync(join(root, ".cp31-azure-test-"));
process.env.APEX_REVIEW_HOME = join(scratch, "reviews");
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const registry = readJson(azureRegistryPath);
const source = readFileSync(join(root, "plugin/hooks/apex-hook.mjs"), "utf8");
const builtSource = renderHookScript(source, await pricingReadTools()).toString();
const hook = await import(`data:text/javascript;base64,${Buffer.from(builtSource).toString("base64")}`);
const forms = [
  (tool) => `apex-azure-${tool}`,
  (tool) => `apex-azure/${tool}`,
  (tool) => `apex-azure:${tool}`,
  (tool) => `apex-azure.${tool}`,
  (tool) => `mcp__apex-azure__${tool}`,
  (tool) => `mcp_apex_azure_${tool}`,
];
const invoke = (name, args) => hook.run("preToolUse", JSON.stringify({ toolName: name, toolArgs: args }));
const denied = (name, args) => assert.equal(JSON.parse(invoke(name, args)).permissionDecision, "deny", name);

test("Azure MCP validation and real metadata capture remain required by CI and qualification", () => {
  const graph = readJson("tools/registry/repository-validator-graph.json");
  const scripts = readJson("package.json").scripts;
  const core = graph.aggregates.find(({ script }) => script === "validate:_node-core");
  for (const script of ["validate:azure-mcp", "test:azure-mcp"]) {
    assert.ok(graph.commands.some((command) => command.script === script && command.retirement.status === "active"));
    assert.ok(core.members.includes(script));
    assert.ok(parseAggregate(scripts["validate:_node-core"]).members.includes(script));
  }
  const captureTest = "tools/tests/vnext/azure-mcp-capture.test.mjs";
  for (const script of ["test:azure-mcp", "test:vnext-pack", "test:plugin"])
    assert.ok(scripts[script].includes(captureTest), `${script} must execute the installed-server metadata test`);
  assert.ok(scripts["qualify:vnext"].includes("npm run test:vnext-pack"));
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /npm run validate:_node-ci/u);
  assert.match(workflow, /npm run test:plugin/u);
});

function example(schema) {
  const type = Array.isArray(schema.type) ? schema.type.find((value) => value !== "null") : schema.type;
  if (schema.enum) return schema.enum[0];
  if (type === "object")
    return Object.fromEntries((schema.required ?? []).map((name) => [name, example(schema.properties[name])]));
  if (type === "array") return [];
  if (type === "boolean") return false;
  if (type === "integer" || type === "number") return 1;
  return schema.format === "date-time" ? "2026-10-19T10:00:00Z" : "example";
}

test("every captured nullable command field accepts explicit null without weakening required field types", () => {
  for (const [name, namespace] of Object.entries(registry.namespaces)) {
    const tools = namespace.kind === "direct" ? [[undefined, namespace]] : Object.entries(namespace.commands);
    for (const [command, { inputSchema }] of tools) {
      const args = (parameters) =>
        namespace.kind === "direct" ? parameters : { intent: "Read approved diagnostics", command, parameters };
      const nullable = Object.entries(inputSchema.properties ?? {}).filter(
        ([, schema]) => Array.isArray(schema.type) && schema.type.includes("null"),
      );
      for (const form of forms) {
        for (const [field] of nullable) {
          assert.equal(invoke(form(name), args({ ...example(inputSchema), [field]: null })), "", `${command}/${field}`);
        }
        if (nullable.length) {
          assert.equal(
            invoke(
              form(name),
              args({
                ...example(inputSchema),
                ...Object.fromEntries(nullable.map(([field]) => [field, null])),
              }),
            ),
            "",
            `${command}: all nullable fields`,
          );
        }
        for (const field of inputSchema.required ?? []) {
          const schema = inputSchema.properties[field];
          if (!(Array.isArray(schema.type) ? schema.type : [schema.type]).includes("null"))
            denied(form(name), args({ ...example(inputSchema), [field]: null }));
        }
      }
    }
  }
});

test("captured nullable timestamp fields still reject malformed strings", () => {
  for (const [name, namespace] of Object.entries(registry.namespaces)) {
    for (const [command, { inputSchema }] of Object.entries(namespace.commands ?? {})) {
      for (const [field, schema] of Object.entries(inputSchema.properties ?? {})) {
        if (schema.format !== "date-time") continue;
        for (const value of ["not-a-date", "2026-10-19", "2026-99-19T10:00:00Z"]) {
          denied(`apex-azure-${name}`, {
            intent: "Read approved diagnostics",
            command,
            parameters: { ...example(inputSchema), [field]: value },
          });
        }
      }
    }
  }
});

test("captured registry, explicit reviewed command set and generated hook policy agree", () => {
  assert.deepEqual(validateAzureMcpRegistry(registry), []);
  assert.deepEqual(azureCommandPolicy(), registry.namespaces);
  assert.deepEqual(hook.AZURE_COMMAND_POLICY, registry.namespaces);
  assert.equal(Object.keys(registry.namespaces).length, 44);
  assert.equal(registry.capture.azureOperationsExecuted, false);
  assert.equal(registry.capture.credentialsUsed, false);
  for (const mutate of [
    (value) => {
      value.package.version = "3.0.1";
    },
    (value) => {
      value.package.binaryVersion = `3.0.0+${"f".repeat(40)}`;
    },
    (value) => {
      value.namespaces.pricing.commands.delete_all = value.namespaces.pricing.commands.pricing_get;
    },
    (value) => {
      value.namespaces.pricing.commands.pricing_get.inputSchema.properties.unknown = { type: "string" };
    },
    (value) => {
      value.namespaces.pricing.commands.pricing_get.annotations.readOnlyHint = false;
    },
  ]) {
    const changed = structuredClone(registry);
    mutate(changed);
    assert.ok(validateAzureMcpRegistry(changed).length);
  }
});

test("final-launch verification rejects tools/list or pure-learn schema drift", () => {
  const managed = {
    binaryVersion: registry.package.binaryVersion,
    initialized: { serverInfo: { version: registry.package.version } },
    tools: Object.entries(registry.namespaces).map(([name, namespace]) => ({
      name,
      inputSchema: namespace.kind === "direct" ? namespace.inputSchema : registry.routerInputSchema,
    })),
    learned: Object.fromEntries(
      Object.entries(registry.namespaces)
        .filter(([, namespace]) => namespace.kind === "router")
        .map(([name, namespace]) => [
          name,
          {
            content: [
              {
                type: "text",
                text: `Available commands:\n${JSON.stringify(
                  Object.entries(namespace.commands).map(([command, tool]) => ({
                    command,
                    inputSchema: tool.inputSchema,
                  })),
                )}`,
              },
            ],
          },
        ]),
    ),
  };
  assert.deepEqual(verifyManagedCapture(registry, managed), registry.capture.managedLaunch);
  const missingTool = structuredClone(managed);
  missingTool.tools.pop();
  assert.throws(() => verifyManagedCapture(registry, missingTool), /does not match approved grants/u);
  const badSchema = structuredClone(managed);
  badSchema.learned.pricing.content[0].text = 'Commands:\n[{"command":"pricing_get","inputSchema":{"type":"string"}}]';
  assert.throws(() => verifyManagedCapture(registry, badSchema), /command schema drifted/u);
  const failedLearn = structuredClone(managed);
  failedLearn.learned.pricing.isError = true;
  assert.throws(() => verifyManagedCapture(registry, failedLearn), /pure-learn failed/u);
});

test("all reviewed commands accept native required parameter shapes in every client name form", () => {
  for (const [name, namespace] of Object.entries(registry.namespaces)) {
    for (const form of forms) {
      if (namespace.kind === "direct") {
        assert.equal(invoke(form(name), example(namespace.inputSchema)), "");
      } else {
        for (const [command, tool] of Object.entries(namespace.commands)) {
          assert.equal(
            invoke(form(name), {
              intent: "Read approved evidence",
              command,
              parameters: example(tool.inputSchema),
            }),
            "",
            `${form(name)} ${command}`,
          );
        }
        assert.equal(invoke(form(name), { intent: "", learn: true }), "");
      }
    }
  }
});

test("routers deny unknown, cross-namespace, mutation, secret, local-write and management commands", () => {
  for (const [namespace, command] of [
    ["pricing", "pricing_get_v2"],
    ["pricing", "storage_account_get"],
    ["storage", "pricing_get"],
    ["appservice", "appservice_webapp_settings_get-appsettings"],
    ["azureterraform", "azureterraform_aztfexport_resource"],
    ["azureterraform", "azureterraform_conftest_plan"],
    ["cosmos", "cosmos_database_container_item_query"],
    ["kusto", "kusto_query"],
    ["deploy", "deploy_architecture_diagram_generate"],
    ["storage", "storage_account_create"],
    ["documentation", "arm_execute_query"],
    ["documentation", "microsoft_docs_search_v2"],
  ])
    for (const form of forms) denied(form(namespace), { intent: "", command, parameters: {} });
  for (const name of ["arm", "azd", "foundry", "keyvault", "speech", "sreagent", "extension_cli_install", "unknown"]) {
    denied(`apex-azure-${name}`, { intent: "", learn: true });
    denied(`apex-azure-${name}`, { intent: "", command: "get", parameters: {} });
  }
});

test("learn is pure discovery only and malformed arguments cannot reach protected transports", () => {
  for (const args of [
    { intent: "sample and execute", learn: true },
    { intent: " ", learn: true },
    { intent: "", learn: true, command: "pricing_get" },
    { intent: "", learn: true, parameters: {} },
    { intent: "", learn: "true" },
    { intent: "" },
    { intent: "", command: "pricing_get", parameters: [] },
    { intent: "", command: "pricing_get", parameters: null },
    { intent: "", command: "pricing_get", parameters: { service: 9 } },
    { intent: "", command: "pricing_get", parameters: { unreviewed: true } },
    { intent: "", command: "pricing_get", parameters: {}, arbitrary: true },
    { command: "pricing_get", parameters: {} },
    null,
    [],
    "not JSON",
  ])
    denied("apex-azure-pricing", args);
  denied("apex-azure-subscription_list", { intent: "", learn: true });
  denied("apex-azure-group_resource_list", {});
  denied("apex-azure-cost-query_costs", []);
  denied("apex-azure-cost-get_retail_prices", {});
  for (const name of ["apex-azure", "apex-azure-", "x-apex-azure-pricing", "apex-azure-pricing extra"])
    denied(name, { intent: "", learn: true });
  for (const name of ["apex-azure-pricing", "mcp_apex_azure_pricing", "apex-azure-cost-query_costs"]) {
    const output = hook.run("preToolUse", `{"toolName":"${name}","toolArgs":`, { stderr: { write() {} } });
    assert.equal(JSON.parse(output).permissionDecision, "deny");
  }
});

test("source and rendered launches derive exact version and namespaces, never a floating range", () => {
  const sourceConfig = readJson("plugin/mcp.json");
  const rendered = renderMcpConfig(sourceConfig);
  assert.deepEqual(azureLaunchErrors(sourceConfig.mcpServers["apex-azure"], { source: true }), []);
  assert.deepEqual(azureLaunchErrors(rendered.mcpServers["apex-azure"]), []);
  assert.ok(rendered.mcpServers["apex-azure"].args.includes(`@azure/mcp@${exactAzureMcpVersion()}`));
  for (const value of ["@azure/mcp@3", "@azure/mcp@^3.0.0", "@azure/mcp@latest", "@azure/mcp@3.0.1"]) {
    const changed = structuredClone(rendered.mcpServers["apex-azure"]);
    changed.args[1] = value;
    assert.ok(azureLaunchErrors(changed).length);
  }
  for (const mutate of [
    (server) => {
      server.args.splice(server.args.indexOf("--read-only"), 1);
    },
    (server) => {
      server.args.push("--namespace", "keyvault");
    },
    (server) => {
      server.args.push("--disable-proxy-tools");
    },
    (server) => {
      server.command = "azmcp";
    },
  ]) {
    const server = structuredClone(rendered.mcpServers["apex-azure"]);
    mutate(server);
    assert.ok(azureLaunchErrors(server).length);
  }
  const lock = readJson("package-lock.json");
  for (const version of ["^3.0.0", "3", "4.0.0", "3.1.0-beta.1"]) {
    writeFileSync(join(scratch, "package.json"), JSON.stringify({ devDependencies: { "@azure/mcp": version } }));
    writeFileSync(join(scratch, "package-lock.json"), JSON.stringify(lock));
    assert.throws(() => exactAzureMcpVersion(scratch), /exact stable 3.x/u);
  }
  const dependencyUpdates = loadYaml(readFileSync(join(root, ".github/dependabot.yml"), "utf8"));
  const npm = dependencyUpdates.updates.find(
    (entry) => entry["package-ecosystem"] === "npm" && entry.directory === "/",
  );
  assert.equal(npm["versioning-strategy"], "increase");
  assert.ok(
    npm.ignore.some((entry) => entry["dependency-name"] === "@azure/mcp" && entry.versions.includes(">=4.0.0")),
  );
  const retailReactivated = structuredClone(sourceConfig);
  retailReactivated.mcpServers["apex-azure-cost"].headers["x-mcp-toolset"] = "CostManagement,Pricing";
  assert.throws(() => renderMcpConfig(retailReactivated), /CostManagement only/u);
});

test("developer config generation omits general Azure MCP until equivalent command guards exist", () => {
  const development = developerMcpConfig();
  assert.deepEqual(readJson(".vscode/mcp.json"), development);
  assert.deepEqual(Object.keys(development.servers), ["github", "apex-azure-cost"]);
  assert.deepEqual(validateMcpConfig(development), []);
  assert.deepEqual(development.servers["apex-azure-cost"].headers, { "x-mcp-toolset": "CostManagement" });
});
