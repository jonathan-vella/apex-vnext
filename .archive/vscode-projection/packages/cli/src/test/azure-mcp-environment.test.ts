import assert from "node:assert/strict";
import test from "node:test";
import { azureMcpEnvironment } from "../azure-mcp-environment.js";

test("Azure MCP launcher defaults .NET globalization to invariant mode", () => {
  assert.equal(azureMcpEnvironment({}).DOTNET_SYSTEM_GLOBALIZATION_INVARIANT, "1");
});

test("Azure MCP launcher preserves an explicit .NET globalization setting", () => {
  assert.equal(
    azureMcpEnvironment({ DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "0" }).DOTNET_SYSTEM_GLOBALIZATION_INVARIANT,
    "0",
  );
});
