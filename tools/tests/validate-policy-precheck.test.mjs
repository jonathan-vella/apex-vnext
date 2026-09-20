import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function validate(precheck, args = []) {
  const root = await mkdtemp(join(tmpdir(), "apex-policy-precheck-"));
  try {
    await mkdir(join(root, "tools/scripts"), { recursive: true });
    await cp(
      new URL("../scripts/validate-policy-precheck.mjs", import.meta.url),
      join(root, "tools/scripts/validate-policy-precheck.mjs"),
    );
    await cp(new URL("../scripts/_lib", import.meta.url), join(root, "tools/scripts/_lib"), { recursive: true });
    await mkdir(join(root, "agent-output/test"), { recursive: true });
    await writeFile(join(root, "agent-output/test/06-policy-precheck.json"), JSON.stringify(precheck));
    return spawnSync(process.execPath, [join(root, "tools/scripts/validate-policy-precheck.mjs"), ...args], {
      encoding: "utf8",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const schemaVersion of [undefined, null, "", "policy-precheck-v1", "policy-precheck-v3"]) {
  test(`rejects unsupported precheck version ${JSON.stringify(schemaVersion)}`, async () => {
    const result = await validate({ schema_version: schemaVersion, status: "CLEAN", deploy_gate: "PROCEED" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout + result.stderr, /schema_version must be policy-precheck-v2/u);
  });
}

test("accepts current clean prechecks", async () => {
  const result = await validate({ schema_version: "policy-precheck-v2", status: "CLEAN", deploy_gate: "PROCEED" }, [
    "--strict",
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const precheck of [
  { status: "CLEAN" },
  { status: "DRIFT", deploy_gate: "PROCEED" },
  { status: "BLOCKED", deploy_gate: "BLOCK" },
  { status: "CLEAN", deploy_gate: "PROCEED", policies_that_will_block_deploy: [{}] },
  { status: "CLEAN", deploy_gate: "PROCEED", attestation: { envelope_status: "STALE" } },
]) {
  test(`rejects current precheck contradictions ${JSON.stringify(precheck)}`, async () => {
    const result = await validate({ schema_version: "policy-precheck-v2", ...precheck });
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
}
