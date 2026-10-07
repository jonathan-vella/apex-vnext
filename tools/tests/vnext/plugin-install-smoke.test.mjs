import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  installedPlugin,
  parseArguments,
  parseCopilotConfig,
  serverLaunch,
} from "../../scripts/smoke-plugin-install.mjs";

test("install smoke reads the Copilot CLI config with its leading comment lines", () => {
  const config = parseCopilotConfig(
    [
      "// User settings belong in settings.json.",
      "// This file is managed automatically.",
      JSON.stringify({
        installedPlugins: [{ name: "apex", cache_path: "/home/x/.copilot/installed-plugins/_direct/a" }],
      }),
    ].join("\n"),
  );
  assert.equal(installedPlugin(config, "apex").cache_path, "/home/x/.copilot/installed-plugins/_direct/a");
  assert.throws(() => installedPlugin(config, "other"), /Expected one installed other plugin, found 0/u);
  assert.throws(() => installedPlugin({ installedPlugins: [{ name: "apex" }, { name: "apex" }] }, "apex"), /found 2/u);
  assert.throws(() => installedPlugin({}, "apex"), /found 0/u);
});

test("install smoke launches the installed stdio server with PLUGIN_ROOT expanded", () => {
  const pluginRoot = resolve("installed", "apex");
  const mcp = { mcpServers: { apex: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/mcp/apex.mjs"] } } };
  assert.deepEqual(serverLaunch(mcp, "apex", pluginRoot), {
    command: "node",
    args: [`${pluginRoot}/mcp/apex.mjs`],
    cwd: pluginRoot,
    env: {},
  });
  const withCwd = structuredClone(mcp);
  withCwd.mcpServers.apex.cwd = "${PLUGIN_ROOT}/mcp";
  withCwd.mcpServers.apex.env = { APEX_MODE: "${PLUGIN_ROOT}/x" };
  const launch = serverLaunch(withCwd, "apex", pluginRoot);
  assert.equal(launch.cwd, resolve(pluginRoot, "mcp"));
  assert.deepEqual(launch.env, { APEX_MODE: `${pluginRoot}/x` });
  assert.throws(() => serverLaunch(mcp, "missing", pluginRoot), /no stdio server missing/u);
  assert.throws(
    () => serverLaunch({ mcpServers: { apex: { type: "http", url: "https://x" } } }, "apex", pluginRoot),
    /no stdio server apex/u,
  );
});

test("install smoke accepts only exact Copilot CLI version pins", () => {
  assert.equal(parseArguments(["--cli-version", "1.0.93"]).cliVersion, "1.0.93");
  assert.equal(parseArguments([]).cliVersion, undefined);
  assert.equal(parseArguments([]).keep, false);
  assert.equal(parseArguments(["--plugin-dir", "out/plugin"]).pluginDirectory, resolve("out/plugin"));
  for (const version of ["latest", "^1.0.93", "1.0", "1.0.93-1"]) {
    assert.throws(() => parseArguments(["--cli-version", version]), /exact x\.y\.z version/u);
  }
  assert.throws(() => parseArguments(["--cli-version"]), /Missing value/u);
  assert.throws(() => parseArguments(["--force"]), /Unknown argument/u);
});
