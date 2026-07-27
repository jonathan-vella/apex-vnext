import assert from "node:assert/strict";
import test from "node:test";
import { validateMcpConfig } from "../scripts/validate-mcp-config.mjs";

function validConfig() {
  return {
    servers: {
      github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      "azure-pricing": {
        type: "stdio",
        command: "python",
        args: ["-m", "azure_pricing_mcp"],
      },
      terraform: {
        type: "stdio",
        command: "/go/bin/terraform-mcp-server",
        args: ["stdio", "--toolsets", "registry"],
      },
      drawio: {
        type: "stdio",
        command: "deno",
        args: ["run", "tools/mcp-servers/drawio/src/index.ts"],
      },
    },
  };
}

test("accepts the active MCP contract without Astro", () => {
  assert.deepEqual(validateMcpConfig(validConfig()), []);
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

test("preserves GitHub, Azure Pricing, Terraform, and Draw.io requirements", () => {
  const config = validConfig();
  const azurePricing = structuredClone(config.servers["azure-pricing"]);
  const terraform = structuredClone(config.servers.terraform);
  delete config.servers.github;
  config.servers.drawio.command = "node";
  assert.deepEqual(validateMcpConfig(config), [
    "Missing required MCP server: servers.github",
    'drawio command must be "deno", got "node"',
  ]);
  assert.deepEqual(config.servers["azure-pricing"], azurePricing);
  assert.deepEqual(config.servers.terraform, terraform);
});

test("malformed server maps fail without valid-server assumptions", () => {
  assert.deepEqual(validateMcpConfig({}), ["MCP config must define a servers object"]);
  assert.deepEqual(validateMcpConfig({ servers: [] }), ["MCP config must define a servers object"]);
});
