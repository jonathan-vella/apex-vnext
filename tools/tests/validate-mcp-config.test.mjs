import assert from "node:assert/strict";
import test from "node:test";
import { validateMcpConfig } from "../scripts/validate-mcp-config.mjs";

function validConfig() {
  return {
    servers: {
      github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      "apex-azure-cost": {
        type: "http",
        url: "https://mcp.management.azure.com",
        headers: { "x-mcp-toolset": "CostManagement" },
      },
    },
  };
}

test("accepts the active MCP contract without Astro", () => {
  assert.deepEqual(validateMcpConfig(validConfig()), []);
});

test("developer workspace rejects standalone Azure namespaces and tools even with --read-only", () => {
  for (const [namespace, excludedCommand] of [
    ["appservice", "appservice_webapp_settings_get-appsettings"],
    ["azureterraform", "azureterraform_aztfexport_resource"],
  ]) {
    for (const selection of [
      ["--namespace", namespace],
      ["--tool", excludedCommand],
    ]) {
      const config = validConfig();
      config.servers["apex-azure"] = {
        type: "stdio",
        command: "node",
        args: ["${workspaceFolder}/node_modules/@azure/mcp/index.js", "server", "start", "--read-only", ...selection],
      };
      assert.deepEqual(
        validateMcpConfig(config),
        [
          "Unguarded developer Azure MCP launch must not be active: servers.apex-azure; use the registry-guarded APEX plugin",
        ],
        excludedCommand,
      );
    }
  }
});

test("renaming an official Azure MCP launch does not bypass developer workspace rejection", () => {
  for (const server of [
    {
      type: "stdio",
      command: "node",
      args: ["${workspaceFolder}/node_modules/@azure/mcp/index.js", "server", "start"],
    },
    { type: "stdio", command: "npx", args: ["--yes", "@azure/mcp@3.0.0", "server", "start", "--read-only"] },
    { type: "stdio", command: "azmcp", args: ["server", "start", "--read-only"] },
    { type: "stdio", command: "C:\\tools\\azmcp.exe", args: ["server", "start", "--read-only"] },
  ]) {
    const config = validConfig();
    config.servers.renamed = server;
    assert.deepEqual(validateMcpConfig(config), [
      "Unguarded developer Azure MCP launch must not be active: servers.renamed; use the registry-guarded APEX plugin",
    ]);
  }
});

test("rejects Astro by legacy key or retired URL under another key", () => {
  const legacy = validConfig();
  legacy.servers["astro-docs"] = { type: "http", url: "https://example.invalid/mcp" };
  assert.deepEqual(validateMcpConfig(legacy), ["Retired Astro MCP server must not be active: servers.astro-docs"]);

  const renamed = validConfig();
  renamed.servers.docs = { type: "http", url: "https://mcp.docs.astro.build/mcp" };
  assert.deepEqual(validateMcpConfig(renamed), ["Retired Astro MCP server must not be active: servers.docs"]);

  for (const equivalent of [
    "https://mcp.docs.astro.build/mcp/",
    "https://MCP.DOCS.ASTRO.BUILD/mcp#active",
    "https://mcp.docs.astro.build./mcp",
    "https://mcp.docs.astro.build/another-path?source=workspace",
  ]) {
    const disguised = validConfig();
    disguised.servers.docs = { type: "http", url: equivalent };
    assert.deepEqual(validateMcpConfig(disguised), ["Retired Astro MCP server must not be active: servers.docs"]);
  }
});

test("rejects Terraform MCP by key, executable, source, path, or toolset signature", () => {
  const cases = [
    ["terraform", { type: "stdio", command: "other" }, "legacy server key"],
    ["renamed", { type: "stdio", command: "terraform-mcp-server" }, "server executable"],
    ["renamed", { type: "stdio", command: "C:\\tools\\terraform-mcp-server" }, "server executable"],
    ["renamed", { type: "stdio", command: "terraform-mcp-server.exe" }, "server executable"],
    ["renamed", { type: "stdio", command: "C:\\tools\\terraform-mcp-server.exe" }, "server executable"],
    ["renamed", { type: "stdio", command: "other", args: ["hashicorp/terraform-mcp-server"] }, "upstream source"],
    ["renamed", { type: "stdio", command: "other", args: ["/go/bin/terraform-mcp-server"] }, "legacy executable path"],
    [
      "renamed",
      { type: "stdio", command: "other", args: ["stdio", "--toolsets", "registry"] },
      "registry toolset signature",
    ],
  ];
  for (const [name, server, marker] of cases) {
    const config = validConfig();
    config.servers[name] = server;
    assert.deepEqual(validateMcpConfig(config), [
      `Retired Terraform MCP server must not be active: servers.${name} (${marker})`,
    ]);
  }
});

test("requires GitHub and Microsoft ARM MCP", () => {
  const config = validConfig();
  delete config.servers["apex-azure-cost"];
  delete config.servers.github;
  assert.deepEqual(validateMcpConfig(config), [
    "Missing required MCP server: servers.github",
    "Missing required MCP server: servers.apex-azure-cost",
  ]);
});

test("rejects Draw.io server by key, executable signature, or embedded source path", () => {
  const byKey = validConfig();
  byKey.servers.drawio = { type: "stdio", command: "node", args: ["index.js"] };
  assert.deepEqual(validateMcpConfig(byKey), [
    "Retired Draw.io MCP server must not be active: servers.drawio (legacy server key)",
  ]);

  const byExecutable = validConfig();
  byExecutable.servers.diagrams = {
    type: "stdio",
    command: "deno",
    args: ["run", "tools/mcp-servers/drawio/src/index.ts"],
  };
  assert.deepEqual(validateMcpConfig(byExecutable), [
    "Retired Draw.io MCP server must not be active: servers.diagrams (server executable)",
  ]);

  const bySource = validConfig();
  bySource.servers.diagrams = {
    type: "stdio",
    command: "node",
    args: ["/tmp/drawio-mcp-server.js"],
  };
  assert.deepEqual(validateMcpConfig(bySource), [
    "Retired Draw.io MCP server must not be active: servers.diagrams (upstream source)",
  ]);
});

test("rejects ARM MCP endpoint or toolset drift and custom pricing reactivation", () => {
  const wrongEndpoint = validConfig();
  wrongEndpoint.servers["apex-azure-cost"].url = "https://example.invalid";
  assert.deepEqual(validateMcpConfig(wrongEndpoint), [
    "apex-azure-cost must use the managed endpoint: https://mcp.management.azure.com",
  ]);

  const wrongToolset = validConfig();
  wrongToolset.servers["apex-azure-cost"].headers["x-mcp-toolset"] = "Pricing";
  assert.deepEqual(validateMcpConfig(wrongToolset), ["apex-azure-cost must enable x-mcp-toolset: CostManagement"]);

  const retired = validConfig();
  retired.servers.legacy = { type: "stdio", command: "python", args: ["-m", "azure_pricing_mcp"] };
  assert.deepEqual(validateMcpConfig(retired), [
    "Retired custom Azure Pricing MCP server must not be active: servers.legacy",
  ]);
});

test("malformed server maps fail without valid-server assumptions", () => {
  assert.deepEqual(validateMcpConfig({}), ["MCP config must define a servers object"]);
  assert.deepEqual(validateMcpConfig({ servers: [] }), ["MCP config must define a servers object"]);
});
