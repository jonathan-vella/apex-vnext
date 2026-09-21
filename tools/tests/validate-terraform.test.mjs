import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateTerraformRoots } from "../scripts/validate-terraform.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "apex-terraform-validation-"));
  await mkdir(join(root, "empty"));
  await mkdir(join(root, "valid"));
  await mkdir(join(root, "invalid"));
  await writeFile(join(root, "valid", "main.tf"), "terraform {}\n");
  await writeFile(join(root, "invalid", "main.tf"), "terraform {}\n");
  return root;
}

test("skips empty directories and reports every failed Terraform stage", async () => {
  const root = await fixture();
  const calls = [];
  try {
    const failures = await validateTerraformRoots({
      root,
      run: async (cwd, args, options) => {
        calls.push({ cwd, args, options });
        if (cwd.endsWith("invalid") && args[0] === "init") return { code: 1, signal: null };
        return { code: 0, signal: null };
      },
    });
    assert.deepEqual(failures, [{ cwd: join(root, "invalid"), stage: "init", code: 1, signal: null }]);
    assert.deepEqual(
      calls.map(({ cwd, args }) => [cwd.slice(root.length + 1), args[0]]),
      [
        ["invalid", "init"],
        ["valid", "init"],
        ["valid", "validate"],
      ],
    );
    assert.ok(calls.every(({ options }) => options.env.TF_DATA_DIR.includes("apex-terraform-data-")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports validation failure after a successful initialization", async () => {
  const root = await fixture();
  try {
    const failures = await validateTerraformRoots({
      root,
      run: async (cwd, args) => ({ code: cwd.endsWith("invalid") && args[0] === "validate" ? 1 : 0, signal: null }),
    });
    assert.deepEqual(failures, [{ cwd: join(root, "invalid"), stage: "validate", code: 1, signal: null }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
