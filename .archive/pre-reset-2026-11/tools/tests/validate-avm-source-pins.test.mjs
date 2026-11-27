import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectSourcePaths,
  parseArgs,
  scanBicepFile,
  scanTerraformFile,
} from "../scripts/validate-avm-module-versions.mjs";

function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), "apex-avm-source-"));
  context.after(() => rmSync(root, { recursive: true }));
  mkdirSync(join(root, "infra/bicep/example"), { recursive: true });
  mkdirSync(join(root, "infra/terraform/example"), { recursive: true });
  const bicep = join(root, "infra/bicep/example/main.bicep");
  const terraform = join(root, "infra/terraform/example/main.tf");
  writeFileSync(bicep, "module store 'br/public:avm/res/storage/storage-account:0.5.0' = {}\n");
  writeFileSync(
    terraform,
    'module "store" {\n source = "Azure/avm-res-storage-storageaccount/azurerm"\n version = "0.5.0"\n}\n',
  );
  return { root, bicep, terraform };
}

function reporter() {
  const events = [];
  return {
    events,
    tick() {},
    ...Object.fromEntries(
      ["ok", "warn", "error", "info"].map((level) => [
        level,
        (...message) => events.push({ level, message: message.join(" ") }),
      ]),
    ),
  };
}

test("source selection never reads historical JSON and explicit unsupported or absent targets fail", (context) => {
  const { root, bicep, terraform } = fixture(context);
  assert.deepEqual(collectSourcePaths(parseArgs([]), root), { bicepPaths: [bicep], tfPaths: [terraform] });
  assert.deepEqual(collectSourcePaths(parseArgs([bicep]), root), { bicepPaths: [bicep], tfPaths: [] });
  const json = join(root, "old.json");
  writeFileSync(json, "{}");
  assert.throws(() => collectSourcePaths(parseArgs([json]), root), /Unsupported source target/u);
  assert.throws(() => collectSourcePaths(parseArgs(["absent.json"]), root), /ENOENT/u);
  assert.throws(() => collectSourcePaths(parseArgs(["absent.bicep"]), root), /ENOENT/u);
  assert.throws(() => parseArgs(["--unknown"]), /Unsupported argument/u);
  assert.throws(() => parseArgs(["--mode=old"]), /local\|ci\|freeze/u);
});

test("exact source pins use the existing classifier and pass offline mode to the resolver", async (context) => {
  const { bicep, terraform } = fixture(context);
  for (const [scan, filename, tool] of [
    [scanBicepFile, bicep, "bicep"],
    [scanTerraformFile, terraform, "terraform"],
  ]) {
    const r = reporter();
    await scan(r, parseArgs(["--mode=ci", "--no-network"]), filename, async (options) => {
      assert.equal(options.tool, tool);
      assert.equal(options.mode, "ci");
      assert.equal(options.allowNetwork, false);
      return { status: "ok", latest: "0.5.0", known_versions: ["0.5.0"], source: "cache" };
    });
    assert.deepEqual(
      r.events.map(({ level }) => level),
      ["ok"],
    );
  }
});

test("unavailable lookup preserves local warnings and fail-closed ci/freeze modes", async (context) => {
  const { bicep, terraform } = fixture(context);
  for (const scan of [scanBicepFile, scanTerraformFile]) {
    for (const mode of ["local", "ci", "freeze"]) {
      const r = reporter();
      await scan(
        r,
        parseArgs([`--mode=${mode}`, "--no-network"]),
        scan === scanBicepFile ? bicep : terraform,
        async () => ({ status: "unreachable", note: "offline cache unavailable" }),
      );
      assert.equal(r.events[0].level, mode === "local" ? "warn" : "error");
    }
  }
});

test("source audit preserves missing-version rejection and stale-pin warning semantics", async (context) => {
  const { bicep, terraform } = fixture(context);
  for (const [scan, filename] of [
    [scanBicepFile, bicep],
    [scanTerraformFile, terraform],
  ]) {
    for (const [resolved, expected] of [
      [{ status: "missing" }, "error"],
      [{ status: "ok", latest: "0.6.0", known_versions: ["0.5.0", "0.6.0"] }, "warn"],
    ]) {
      const r = reporter();
      await scan(r, parseArgs(["--no-network"]), filename, async () => resolved);
      assert.equal(r.events[0].level, expected);
    }
  }
});

test("CLI explicitly rejects unsupported historical JSON targets without network access", (context) => {
  const { root } = fixture(context);
  const json = join(root, "old.json");
  writeFileSync(json, "{}");
  const result = spawnSync(
    process.execPath,
    [new URL("../scripts/validate-avm-module-versions.mjs", import.meta.url).pathname, "--no-network", json],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Unsupported source target/u);
});
