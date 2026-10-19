import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { captureInventory } from "../../scripts/capture-azure-mcp-inventory.mjs";
import { verifyManagedCapture } from "../../scripts/generate-azure-mcp-registry.mjs";
import {
  azureLaunchErrors,
  azureRegistryPath,
  exactAzureMcpVersion,
  readJson,
} from "../../scripts/_lib/mcp-contracts.mjs";

const root = resolve(import.meta.dirname, "../../..");

test(
  "installed Azure MCP exposes the final managed namespaces and learns approved schemas without Azure operations",
  { timeout: 90_000 },
  async (context) => {
    const directory = await mkdtemp(join(root, ".apex-mcp-capture-test-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const home = join(directory, "isolated-home");
    await mkdir(home);
    const registry = readJson(azureRegistryPath);
    assert.equal(registry.package.version, exactAzureMcpVersion());
    assert.deepEqual(azureLaunchErrors(readJson("plugin/mcp.json").mcpServers["apex-azure"], { source: true }), []);
    const requests = [];
    const captured = await captureInventory(root, "namespace", home, Object.keys(registry.namespaces), {
      learn: true,
      onRequest: (request) => requests.push(request),
    });
    assert.deepEqual(verifyManagedCapture(registry, captured), registry.capture.managedLaunch);
    assert.deepEqual(
      requests.slice(0, 2).map(({ method }) => method),
      ["initialize", "tools/list"],
    );
    const learns = requests.slice(2);
    assert.equal(learns.length, registry.capture.managedLaunch.pureLearnToolCount);
    for (const { method, params } of learns) {
      assert.equal(method, "tools/call");
      assert.deepEqual(params.arguments, { intent: "", learn: true });
      assert.equal(registry.namespaces[params.name]?.kind, "router");
    }
  },
);
