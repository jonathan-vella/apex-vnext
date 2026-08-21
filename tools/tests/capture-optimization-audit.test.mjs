import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOptimizationAudit,
  parseAuditArguments,
  validateOptimizationAudit,
} from "../scripts/capture-optimization-audit.mjs";

const manifest = JSON.parse(readFileSync("tools/registry/optimization-gate.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/optimization-audit-receipt.schema.json", "utf8"));
const candidatePaths = [".github/workflows/ci.yml", "package.json"];

function runGit(_command, args) {
  if (args[0] === "ls-tree") return `${candidatePaths.join("\n")}\n`;
  if (args[0] === "cat-file") return args[2].endsWith("package.json") ? "12\n" : "8\n";
  if (args[0] === "show") return '{"scripts":{"validate:all":"node validate.mjs"}}\n';
  throw new Error(`unexpected git call: ${args.join(" ")}`);
}

test("audit receipt inventories the bound candidate without mutation authority", () => {
  const receipt = buildOptimizationAudit({ manifest, observedAt: "2026-08-21T00:00:00.000Z", runGit });
  assert.deepEqual(validateOptimizationAudit(receipt, schema), []);
  assert.equal(receipt.authorization.maxTrackedMutations, 0);
  assert.deepEqual(
    receipt.inventory.map(({ path }) => path),
    candidatePaths,
  );
});

test("audit receipt rejects an unowned candidate path and incomplete arguments", () => {
  assert.throws(
    () =>
      buildOptimizationAudit({ manifest, observedAt: "2026-08-21T00:00:00.000Z", runGit: () => "unknown/file.txt\n" }),
    /unowned candidate path: unknown\/file.txt/,
  );
  assert.throws(() => parseAuditArguments(["--output", "audit.json"]), /required/);
  assert.deepEqual(parseAuditArguments(["--output", "audit.json", "--collected-at", "2026-08-21T00:00:00.000Z"]), {
    output: "audit.json",
    observedAt: "2026-08-21T00:00:00.000Z",
  });
});
