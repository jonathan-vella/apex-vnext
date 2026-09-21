import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("JSON lint excludes generated output but rejects invalid source JSON", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-json-lint-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("../scripts/lint-json.mjs", import.meta.url));
  for (const directory of ["dist/probe", "build", "packages/example/dist", "node_modules/dependency", "config"]) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, "config.json"), directory === "config" ? "{}" : "// generated JSONC\n{}");
  }
  assert.match(execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8" }), /All 1 JSON files valid/u);
  await writeFile(join(root, "config/config.json"), "{broken");
  assert.throws(() => execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe" }), { status: 1 });
});
