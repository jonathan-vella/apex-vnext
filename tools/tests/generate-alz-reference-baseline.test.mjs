import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractResourceTypes, resolveEffectiveEffect } from "../scripts/generate-alz-reference-baseline.mjs";

const baselinePath = new URL("../../config/governance-reference.v1.json", import.meta.url);
const allowedEffects = new Set([
  "deny",
  "audit",
  "auditIfNotExists",
  "append",
  "modify",
  "deployIfNotExists",
  "disabled",
]);
const requiredPolicyKeys = [
  "policy_id",
  "display_name",
  "effect",
  "enforcementMode",
  "scope",
  "assignment_display_name",
  "assignment_id",
  "classification",
  "category",
  "resource_types",
  "required_value",
  "exemption",
  "override",
  "reported_exemptions",
];

function expectedClassification(effect) {
  if (effect === "deny") return "blocker";
  if (["modify", "deployIfNotExists"].includes(effect)) return "auto-remediate";
  return "informational";
}

function comparePolicies(left, right) {
  const assignment = left.assignment_id.localeCompare(right.assignment_id);
  if (assignment !== 0) return assignment;
  const reference = (left.policyDefinitionReferenceId ?? "").localeCompare(right.policyDefinitionReferenceId ?? "");
  if (reference !== 0) return reference;
  return left.policy_id.localeCompare(right.policy_id);
}

test("generated ALZ Corp reference baseline matches governance reference contract", async () => {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));

  assert.equal(baseline.schema_version, "governance-reference-v1");
  assert.equal(baseline.source, "alz-corp-reference");
  assert.equal(baseline.library.repository, "Azure/Azure-Landing-Zones-Library");
  assert.equal(baseline.library.platform, "alz");
  assert.match(baseline.library.release, /^platform\/alz\/\d{4}\.\d{2}\.\d+$/u);
  assert.match(baseline.library.commit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(baseline.library.archetypes, ["root", "landing_zones", "corp"]);
  assert.equal(baseline.builtins_resolved_via, "arm-api-2023-04-01");
  assert.deepEqual(baseline.tags_required, []);
  assert.deepEqual(baseline.allowed_locations, []);
  assert.ok(Array.isArray(baseline.policies));
  assert.ok(baseline.policies.some((policy) => policy.effect === "deny"));

  const sorted = [...baseline.policies].sort(comparePolicies);
  assert.deepEqual(
    baseline.policies.map((policy) => [
      policy.assignment_id,
      policy.policyDefinitionReferenceId ?? "",
      policy.policy_id,
    ]),
    sorted.map((policy) => [policy.assignment_id, policy.policyDefinitionReferenceId ?? "", policy.policy_id]),
  );

  const counts = { blocker: 0, auto_remediate: 0, informational: 0 };
  for (const policy of baseline.policies) {
    for (const key of requiredPolicyKeys)
      assert.ok(Object.hasOwn(policy, key), `missing ${key} on ${policy.policy_id}`);
    assert.ok(allowedEffects.has(policy.effect), `unexpected effect ${policy.effect}`);
    assert.equal(policy.classification, expectedClassification(policy.effect));
    assert.match(policy.scope, /^\/providers\/Microsoft\.Management\/managementGroups\/(alz|landingzones|corp)$/u);
    assert.ok(
      policy.assignment_id.startsWith(`${policy.scope}/providers/Microsoft.Authorization/policyAssignments/`),
      `assignment_id does not start with scope: ${policy.assignment_id}`,
    );
    const assignmentName = policy.assignment_id.slice(
      `${policy.scope}/providers/Microsoft.Authorization/policyAssignments/`.length,
    );
    assert.doesNotMatch(assignmentName, /[/?#%\s]/u);
    assert.ok(Array.isArray(policy.resource_types));
    assert.ok(Array.isArray(policy.reported_exemptions));
    assert.equal(policy.exemption, null);
    assert.equal(policy.assignment_parameters, undefined);
    if (policy.classification === "auto-remediate") counts.auto_remediate += 1;
    else counts[policy.classification] += 1;
  }

  assert.equal(baseline.summary.policies, baseline.policies.length);
  assert.equal(baseline.summary.blocker, counts.blocker);
  assert.equal(baseline.summary.auto_remediate, counts.auto_remediate);
  assert.equal(baseline.summary.informational, counts.informational);
  assert.equal(
    baseline.summary.policies,
    baseline.summary.blocker + baseline.summary.auto_remediate + baseline.summary.informational,
  );
  assert.equal(typeof baseline.summary.assignments, "number");
  assert.equal(typeof baseline.summary.skipped, "number");
});

test("effect resolution follows set member, assignment, set default, and policy default precedence", () => {
  const policyDefinition = {
    properties: {
      parameters: {
        policyEffect: { defaultValue: "Disabled" },
      },
      policyRule: { then: { effect: "[parameters('policyEffect')]" } },
    },
  };
  const policySetDefinition = {
    properties: {
      parameters: {
        setEffect: { defaultValue: "Audit" },
      },
    },
  };

  assert.deepEqual(
    resolveEffectiveEffect(policyDefinition, {
      assignmentParameters: { setEffect: "Deny" },
      memberParameters: { policyEffect: { value: "[parameters('setEffect')]" } },
      policyDefinition,
      policySetDefinition,
    }),
    { effect: "deny", rawEffect: "Deny", override: null },
  );

  assert.deepEqual(
    resolveEffectiveEffect(policyDefinition, {
      assignmentParameters: {},
      memberParameters: { policyEffect: { value: "[parameters('setEffect')]" } },
      policyDefinition,
      policySetDefinition,
    }),
    { effect: "audit", rawEffect: "Audit", override: null },
  );

  assert.equal(
    resolveEffectiveEffect(
      { properties: { parameters: {}, policyRule: { then: { effect: "manual" } } } },
      { assignmentParameters: {}, memberParameters: {} },
    ).effect,
    "audit",
  );
  assert.equal(
    resolveEffectiveEffect(
      { properties: { parameters: {}, policyRule: { then: { effect: "denyAction" } } } },
      { assignmentParameters: {}, memberParameters: {} },
    ).effect,
    "deny",
  );
});

test("resource type extraction collects literal type conditions deterministically", () => {
  const policyRule = {
    if: {
      allOf: [
        { field: "type", equals: "Microsoft.Storage/storageAccounts" },
        {
          anyOf: [
            { field: "TYPE", in: ["Microsoft.Network/networkInterfaces", "Microsoft.Storage/storageAccounts", 42] },
            { field: "type", like: "Microsoft.Compute/virtualMachines*" },
            { field: "type", like: "Microsoft.Network/*" },
          ],
        },
        { not: { field: "type", equals: "Microsoft.Ignored/resources" } },
      ],
    },
  };

  assert.deepEqual(extractResourceTypes(policyRule), [
    "Microsoft.Compute/virtualMachines",
    "Microsoft.Network/networkInterfaces",
    "Microsoft.Storage/storageAccounts",
  ]);
});
