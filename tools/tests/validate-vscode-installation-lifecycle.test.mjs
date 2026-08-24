import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateVscodeInstallationLifecycle } from "../scripts/validate-vscode-installation-lifecycle.mjs";

const matrix = JSON.parse(readFileSync("tools/registry/vscode-installation-lifecycle.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/vscode-installation-lifecycle.schema.json", "utf8"));

test("VS Code lifecycle matrix declares complete deterministic and pending live evidence", () => {
  assert.deepEqual(validateVscodeInstallationLifecycle(matrix, schema), []);
  assert.ok(matrix.scenarios.every(({ liveStatus }) => liveStatus === "not-run"));
});

test("VS Code lifecycle matrix rejects missing scenarios and unbound passed evidence", () => {
  const missing = structuredClone(matrix);
  missing.scenarios.pop();
  assert.ok(
    validateVscodeInstallationLifecycle(missing, schema).includes(
      "scenario IDs must match the approved VS Code lifecycle matrix",
    ),
  );
  const unbound = structuredClone(matrix);
  unbound.scenarios[0].liveStatus = "passed";
  assert.ok(
    validateVscodeInstallationLifecycle(unbound, schema).includes(
      "VSCODE-LIFECYCLE-001: passed live status requires live evidence",
    ),
  );
});
