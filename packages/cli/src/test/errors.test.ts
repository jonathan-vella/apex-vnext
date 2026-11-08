import assert from "node:assert/strict";
import { test } from "./test-shard.js";
import { GovernanceBaselineError, IacProviderError } from "@apexops/capabilities";
import { EXIT_CODES, governanceBaselineApexError, normalizeError } from "../errors.js";

test("governance baseline rejections map to typed errors with an actionable hint", () => {
  const incomplete = normalizeError(new GovernanceBaselineError("incomplete"));
  assert.equal(incomplete.code, "APEX_VALIDATION");
  assert.equal(incomplete.exitCode, EXIT_CODES.validation);
  assert.match(incomplete.message, /^Governance baseline rejected: incomplete: .*-IncludeDescendants/u);
  assert.deepEqual(incomplete.details, { reason: "GOVERNANCE_BASELINE_INCOMPLETE" });

  const stale = governanceBaselineApexError(new GovernanceBaselineError("stale"));
  assert.equal(stale.code, "APEX_STALE");
  assert.equal(stale.exitCode, EXIT_CODES.stale);

  for (const code of ["invalid-input", "invalid-options", "target-mismatch"] as const) {
    const mapped = normalizeError(new GovernanceBaselineError(code));
    assert.equal(mapped.code, "APEX_VALIDATION", code);
    assert.equal(mapped.message.startsWith(`Governance baseline rejected: ${code}: `), true, code);
  }

  const reference = governanceBaselineApexError(new GovernanceBaselineError("incomplete"), "reference");
  assert.equal(reference.code, "APEX_VALIDATION");
  assert.match(reference.message, /bundled governance reference is unusable/u);
  assert.doesNotMatch(reference.message, /collect-governance-baseline/u);
  assert.deepEqual(reference.details, { reason: "GOVERNANCE_REFERENCE_INCOMPLETE" });
});

test("native provider failures keep their code and bounded detail instead of becoming APEX_INTERNAL", () => {
  const mapped = normalizeError(
    new IacProviderError("NATIVE_VALIDATION_FAILED", "Native policy property validation failed: 1 of 1 mappings"),
  );
  assert.equal(mapped.code, "APEX_VALIDATION");
  assert.equal(mapped.exitCode, EXIT_CODES.validation);
  assert.equal(
    mapped.message,
    "Native validation failed: NATIVE_VALIDATION_FAILED: Native policy property validation failed: 1 of 1 mappings",
  );
  assert.ok(normalizeError(new IacProviderError("NATIVE_VALIDATION_FAILED", "x\n".repeat(5000))).message.length < 2200);
  assert.equal(normalizeError(new Error("boom")).code, "APEX_INTERNAL");
});
