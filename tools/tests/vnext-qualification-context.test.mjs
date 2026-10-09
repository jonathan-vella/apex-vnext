import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EXPECTED_TAGS,
  FIREWALL_EXCEPTION_ID,
  qualificationContextIssues,
  qualificationSecurityExceptionIssues,
  validateQualificationContext,
  validateQualificationSecurityException,
} from "../scripts/validate-vnext-qualification-context.mjs";

const subscriptionId = "b47d2942-f5ad-4d3c-b28e-c23e4f83d97e";
const environment = {
  AZURE_SUBSCRIPTION_ID: subscriptionId,
  APEX_PROJECT_NAME: "vnext",
  APEX_LOCATION: "swedencentral",
  APEX_CONTROL_RESOURCE_GROUP: "rg-vnext-qualification-control",
  APEX_BICEP_RESOURCE_GROUP: "rg-vnext-qualification-bicep",
  APEX_TERRAFORM_RESOURCE_GROUP: "rg-vnext-qualification-terraform",
  APEX_BACKEND_STORAGE_ACCOUNT: "stvnexttfabc123",
  APEX_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID:
    `/subscriptions/${subscriptionId}/resourceGroups/rg-vnext-qualification-control/` +
    "providers/Microsoft.OperationalInsights/workspaces/log-vnext-qualification",
  APEX_QUALIFICATION_TAGS_JSON: JSON.stringify(EXPECTED_TAGS),
};
const now = new Date("2026-07-15T13:00:00Z");
const securityException = {
  id: FIREWALL_EXCEPTION_ID,
  control: "authenticated-public-network-session",
  requested_at: "2026-07-15T12:50:34Z",
  expires_at: "2026-07-16T12:50:34Z",
  reason: "Permit one bounded Entra-only endpoint session during qualification.",
  issue_link: "https://github.com/jonathan-vella/apex-vnext/issues/13",
  scope: {
    environment: "vnext-qualification",
    workload: "encrypted-handoff-backend",
    maximum_lifetime_hours: 24,
  },
  endpoint_lifecycle: {
    at_rest_public_network_access: "Disabled",
    at_rest_default_action: "Deny",
    session_authorization: "entra-rbac-only",
    policy_exclusion: {
      tag_name: "SecurityControl",
      tag_value: "Ignore",
      persistence: "session-only",
    },
    minimum_remaining_minutes: 75,
    open_sequence: [
      "validate-exception",
      "validate-at-rest-entra-only-posture",
      "add-transient-policy-exclusion",
      "enable-public-network-access",
      "set-firewall-default-allow",
    ],
    cleanup_sequence: [
      "set-firewall-default-deny",
      "disable-public-network-access",
      "remove-transient-policy-exclusion",
      "verify-deny-disabled-and-exclusion-absent",
    ],
  },
  compensating_controls: ["Default-deny firewall with unconditional cleanup."],
};
const governance = { subscription_id: subscriptionId, security_exceptions: [securityException] };

test("qualification validators require explicit readable governance with subscription identity", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "apex-qualification-context-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const filename = path.join(directory, "context.json");
  assert.throws(() => validateQualificationContext(environment), /Explicit qualification governance file/u);
  assert.throws(() => validateQualificationSecurityException(), /Explicit qualification governance file/u);
  assert.throws(() => validateQualificationContext(environment, filename, now), /ENOENT/u);
  writeFileSync(filename, "{invalid");
  assert.throws(() => validateQualificationSecurityException(filename, now), SyntaxError);
  writeFileSync(filename, JSON.stringify({ security_exceptions: [securityException] }));
  assert.throws(() => validateQualificationContext(environment, filename, now), /subscription_id/u);
  assert.throws(() => validateQualificationSecurityException(filename, now), /subscription_id/u);
  writeFileSync(filename, JSON.stringify(governance));
  assert.deepEqual(validateQualificationContext(environment, filename, now), []);
  assert.deepEqual(validateQualificationSecurityException(filename, now), []);
});

test("qualification CLI rejects missing, extra and unsupported arguments explicitly", () => {
  const script = path.resolve(import.meta.dirname, "../scripts/validate-vnext-qualification-context.mjs");
  for (const args of [
    [],
    ["--security-exception-only"],
    ["--unknown"],
    ["a", "b"],
    ["--security-exception-only", "a", "b"],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires <file>/u);
  }
});

test("qualification context matches the approved bootstrap and tag contract", () => {
  assert.deepEqual(qualificationContextIssues(environment, governance, now), []);
  assert.deepEqual(
    qualificationContextIssues(
      {
        ...environment,
        APEX_QUALIFICATION_TAGS_JSON: JSON.stringify(Object.fromEntries(Object.entries(EXPECTED_TAGS).reverse())),
      },
      governance,
      now,
    ),
    [],
  );
});

test("qualification context rejects every mutable contract boundary", () => {
  for (const [name, value] of [
    ["AZURE_SUBSCRIPTION_ID", "10858ffc-dded-4f0f-8bbf-e17fff0d47d9"],
    ["APEX_PROJECT_NAME", "other"],
    ["APEX_LOCATION", "westeurope"],
    ["APEX_CONTROL_RESOURCE_GROUP", "other"],
    ["APEX_BICEP_RESOURCE_GROUP", "other"],
    ["APEX_TERRAFORM_RESOURCE_GROUP", "other"],
    ["APEX_BACKEND_STORAGE_ACCOUNT", "invalid"],
    ["APEX_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID", "/invalid"],
  ]) {
    assert.ok(qualificationContextIssues({ ...environment, [name]: value }, governance, now).length > 0, name);
  }
  assert.ok(
    qualificationContextIssues(
      { ...environment, APEX_QUALIFICATION_TAGS_JSON: JSON.stringify({ ...EXPECTED_TAGS, owner: "other" }) },
      governance,
      now,
    ).length > 0,
  );
  assert.ok(qualificationContextIssues(environment, { ...governance, subscription_id: "invalid" }, now).length > 0);
});

test("qualification firewall exception rejects expiry and inactive windows", () => {
  assert.deepEqual(qualificationSecurityExceptionIssues(governance, now), []);
  assert.ok(
    qualificationSecurityExceptionIssues(
      { ...governance, security_exceptions: [{ ...securityException, expires_at: "2026-07-15T12:59:59Z" }] },
      now,
    ).includes("exception is expired"),
  );
  assert.ok(
    qualificationSecurityExceptionIssues(
      { ...governance, security_exceptions: [{ ...securityException, requested_at: "2026-07-15T13:00:01Z" }] },
      now,
    ).includes("exception is not active yet"),
  );
  assert.ok(
    qualificationSecurityExceptionIssues(
      { ...governance, security_exceptions: [{ ...securityException, expires_at: "2026-07-15T14:15:00Z" }] },
      now,
    ).some((issue) => issue.includes("75 minutes remaining")),
  );
});

test("qualification firewall exception rejects scope and duration mutations", () => {
  for (const [name, value, expected] of [
    ["environment", "other", "scope.environment"],
    ["workload", "other", "scope.workload"],
    ["maximum_lifetime_hours", 25, "maximum_lifetime_hours"],
  ]) {
    const mutated = {
      ...securityException,
      scope: { ...securityException.scope, [name]: value },
    };
    assert.ok(
      qualificationSecurityExceptionIssues({ ...governance, security_exceptions: [mutated] }, now).some((issue) =>
        issue.includes(expected),
      ),
      name,
    );
  }
  const longLived = { ...securityException, expires_at: "2026-07-16T12:50:35Z" };
  assert.ok(
    qualificationSecurityExceptionIssues({ ...governance, security_exceptions: [longLived] }, now).some((issue) =>
      issue.includes("lifetime"),
    ),
  );
  assert.ok(
    qualificationSecurityExceptionIssues(
      {
        ...governance,
        security_exceptions: [{ ...securityException, issue_link: "https://github.com/example/other" }],
      },
      now,
    ).some((issue) => issue.includes("issue_link")),
  );
});

test("qualification firewall exception rejects endpoint lifecycle drift", () => {
  for (const [name, value] of [
    ["at_rest_public_network_access", "Enabled"],
    ["at_rest_default_action", "Allow"],
    ["session_authorization", "shared-key"],
    ["policy_exclusion", { tag_name: "Other", tag_value: "Ignore", persistence: "session-only" }],
    ["minimum_remaining_minutes", 60],
    ["open_sequence", ["set-firewall-default-allow"]],
    ["cleanup_sequence", ["set-firewall-default-deny"]],
  ]) {
    const mutated = {
      ...securityException,
      endpoint_lifecycle: { ...securityException.endpoint_lifecycle, [name]: value },
    };
    assert.ok(
      qualificationSecurityExceptionIssues({ ...governance, security_exceptions: [mutated] }, now).length > 0,
      name,
    );
  }
});
