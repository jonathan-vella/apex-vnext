import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateContextBudget } from "../../scripts/context-budget.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("evaluateContextBudget passes on the repository baseline", () => {
  const report = evaluateContextBudget(repoRoot);
  assert.equal(report.ok, true, report.violations.join("\n"));
  assert.equal(report.violations.length, 0);
  for (const surface of report.surfaces) {
    assert.ok(surface.actualBytes > 0, `${surface.id} must have positive byte count`);
    assert.ok(
      surface.actualBytes <= surface.maxBytes,
      `${surface.id} (${surface.actualBytes}) must not exceed ${surface.maxBytes}`,
    );
  }
});

test("evaluateContextBudget fails closed when any surface exceeds its configured byte cap", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "apex-context-budget-"));
  try {
    cpSync(path.join(repoRoot, "config"), path.join(tempRoot, "config"), { recursive: true });
    cpSync(
      path.join(repoRoot, "packages", "cli", "src", "test", "fixtures"),
      path.join(tempRoot, "packages", "cli", "src", "test", "fixtures"),
      { recursive: true },
    );
    cpSync(path.join(repoRoot, "customizations"), path.join(tempRoot, "customizations"), { recursive: true });

    writeFileSync(
      path.join(tempRoot, "config", "context-budget.v1.json"),
      JSON.stringify(
        {
          schemaVersion: "1.0.0",
          budgets: {
            mcpToolsListMaxBytes: 100,
            apexAgentMaxBytes: 12500,
            skillFrontmatterMaxBytes: 17000,
            managedInstructionsMaxBytes: 13000,
          },
        },
        null,
        2,
      ),
    );

    const report = evaluateContextBudget(tempRoot);
    assert.equal(report.ok, false);
    assert.ok(report.violations.some((item) => item.includes("mcpToolsList")));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
