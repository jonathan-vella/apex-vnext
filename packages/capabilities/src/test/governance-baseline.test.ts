import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { GovernanceConstraintsV1Schema, PolicyPropertyMapV1Schema } from "@apexops/contracts";
import { GovernanceBaselineError, importGovernanceBaseline, inspectGovernanceBaseline } from "../index.js";

const validate = new Ajv2020({ strict: false }).compile(
  JSON.parse(
    readFileSync(new URL("../../../../tools/schemas/governance-baseline.schema.json", import.meta.url), "utf8"),
  ),
);
const subscriptionId = "11111111-1111-1111-1111-111111111111";
const otherId = "22222222-2222-2222-2222-222222222222";
const discoveredAt = "2026-09-16T00:00:00Z";
const options = { subscriptionId, now: "2026-09-16T01:00:00Z" };
const managementScope = "/providers/Microsoft.Management/managementGroups/root";

function envelope(id = subscriptionId) {
  return {
    schema_version: "governance-constraints-v1",
    subscription_id: id,
    discovered_at: discoveredAt,
    source: "github-actions-baseline",
    discovery_status: "COMPLETE",
    discovery_metadata: {
      discovery_status: "COMPLETE",
      discovered_at: discoveredAt,
      scope: { subscription_id: id, management_groups: [] as string[] },
      api_versions: {
        policyAssignments: "2022-06-01",
        policyDefinitions: "2021-06-01",
        policyExemptions: "2022-07-01-preview",
      },
      page_counts: { policyAssignments: 0, policyDefinitions: 0, policyExemptions: 0 },
      completeness_signature: "",
      ttl_days: 7,
    },
    discovery_summary: {
      assignment_total: 0,
      assignment_kept: 0,
      defender_auto_filtered: 0,
      subscription_scope_count: 0,
      management_group_inherited_count: 0,
      blocker_count: 0,
      auto_remediate_count: 0,
      informational_count: 0,
      audit_count: 0,
      disabled_count: 0,
      exempted_count: 0,
    },
    assignment_inventory: [] as Record<string, unknown>[],
    findings: [] as Record<string, unknown>[],
    policies: [] as Record<string, unknown>[],
    tags_required: [] as Record<string, unknown>[],
    allowed_locations: [] as string[],
  };
}

function baseline() {
  return {
    schema_version: "governance-baseline-v1",
    management_group_id: "root",
    coverage_status: "COMPLETE",
    subscriptions_discovered: 1,
    subscriptions_processed: 1,
    subscriptions_skipped: [] as string[],
    subscriptions_excluded: [] as Record<string, unknown>[],
    summary: { total_findings: 0, total_blockers: 0, total_auto_remediate: 0, subscriptions_complete: 1 },
    subscriptions: { [subscriptionId]: envelope() } as Record<string, ReturnType<typeof envelope>>,
  };
}

function rejected(input: unknown, code: string, override = options) {
  assert.throws(
    () => importGovernanceBaseline(input, override, validate),
    (error: unknown) => error instanceof GovernanceBaselineError && error.code === code,
  );
}

test("selects only the active subscription and produces runtime-compatible compact constraints", () => {
  const source = baseline();
  source.subscriptions[otherId] = envelope(otherId);
  source.subscriptions_discovered = source.subscriptions_processed = source.summary.subscriptions_complete = 2;
  const selected = importGovernanceBaseline(source, options, validate);
  assert.equal(JSON.stringify(selected).includes(otherId), false);
  assert.deepEqual(selected.snapshot.findings, []);
  assert.equal(selected.snapshot.reconciliationRequired, true);
  assert.equal(selected.snapshot.provenance.signatureStatus, "unverified");
  assert.equal(selected.constraints.expiresAt, "2026-10-16T00:00:00.000Z");
  const validateConstraints = new Ajv2020({ strict: false, validateFormats: false }).compile(
    GovernanceConstraintsV1Schema,
  );
  assert.ok(
    validateConstraints({
      ...selected.constraints,
      projectId: "example",
      runId: "run-1",
      constraintsRef: {
        mediaType: "application/json",
        uri: "evidence/selected.json",
        digest: "a".repeat(64),
        bytes: 1,
      },
    }),
  );
  assert.deepEqual(importGovernanceBaseline(Buffer.from(JSON.stringify(source)), options, validate), selected);
  assert.deepEqual(importGovernanceBaseline(JSON.stringify(source), options, validate), selected);
});

test("preserves legacy management-group provenance and accepts an exclusive standalone root", () => {
  const { management_group_id, ...source } = baseline();
  assert.equal(management_group_id, "root");
  const standalone = { ...source, subscription_id: subscriptionId };
  assert.deepEqual(importGovernanceBaseline(standalone, options, validate).snapshot.provenance.root, {
    kind: "subscription",
    subscriptionId,
  });
  rejected({ ...standalone, management_group_id: "root" }, "invalid-input");
  rejected(source, "invalid-input");
  rejected({ ...standalone, subscription_id: otherId }, "target-mismatch");
});

test("rejects incomplete empty evidence, errors and inconsistent counts", () => {
  const mutations: Array<(source: ReturnType<typeof baseline>) => void> = [
    (source) => {
      source.coverage_status = "PARTIAL";
    },
    (source) => {
      source.subscriptions_skipped.push(otherId);
    },
    (source) => {
      source.subscriptions[subscriptionId]!.discovery_status = "PARTIAL";
    },
    (source) => {
      source.subscriptions[subscriptionId]!.discovery_metadata.discovery_status = "FAILED";
    },
    (source) => {
      source.subscriptions_processed = 2;
    },
    (source) => {
      source.subscriptions_discovered = 2;
    },
    (source) => {
      source.summary.subscriptions_complete = 0;
    },
    (source) => {
      source.summary.total_findings = 1;
    },
    (source) => {
      source.subscriptions[subscriptionId]!.discovery_summary.assignment_kept = 1;
    },
    (source) => {
      Object.assign(source.subscriptions[subscriptionId]!, { error: { message: "secret" } });
    },
    (source) => {
      source.subscriptions_excluded.push({ subscription_id: otherId, reason: "processing_error" });
    },
  ];
  for (const mutate of mutations) {
    const source = baseline();
    mutate(source);
    rejected(source, "incomplete");
  }
  const source = baseline();
  delete (source.subscriptions[subscriptionId] as Record<string, unknown>).discovery_metadata;
  rejected(source, "invalid-input");
});

test("inspection admits old metadata only while preserving all non-age validation", () => {
  const old = { ...options, now: new Date(Date.parse(discoveredAt) + 30 * 86_400_000).toISOString() };
  assert.deepEqual(inspectGovernanceBaseline(baseline(), old, validate), {
    observedAt: new Date(discoveredAt).toISOString(),
    refreshRequired: true,
  });
  assert.deepEqual(inspectGovernanceBaseline(baseline(), options, validate), {
    observedAt: new Date(discoveredAt).toISOString(),
    refreshRequired: false,
  });
  assert.throws(() => importGovernanceBaseline(baseline(), old, validate), /stale/);
  assert.throws(
    () => inspectGovernanceBaseline(baseline(), { ...options, now: "2026-09-15T00:00:00Z" }, validate),
    /stale/,
  );
  assert.throws(
    () => inspectGovernanceBaseline(baseline(), { ...old, subscriptionId: otherId }, validate),
    /target-mismatch/,
  );
  const partial = baseline();
  partial.coverage_status = "PARTIAL";
  assert.throws(() => inspectGovernanceBaseline(partial, old, validate), /incomplete|invalid-input/);
  assert.throws(() => inspectGovernanceBaseline("{", old, validate), /invalid-input/);
});

test("allows reuse below 30 days and requires refresh at exactly 30 days independent of legacy TTL", () => {
  for (const ttl of [1, 7, 30, 90]) {
    const source = baseline();
    source.subscriptions[subscriptionId]!.discovery_metadata.ttl_days = ttl;
    const selected = importGovernanceBaseline(source, { ...options, now: "2026-10-15T23:59:59.999Z" }, validate);
    assert.equal(selected.constraints.expiresAt, "2026-10-16T00:00:00.000Z");
    rejected(source, "stale", { ...options, now: "2026-10-16T00:00:00Z" });
    rejected(source, "stale", { ...options, now: "2026-10-17T00:00:00Z" });
  }
});

test("rejects future and invalid timestamps using explicit time", () => {
  rejected(baseline(), "stale", { ...options, now: "2026-09-15T23:59:59Z" });
  rejected(baseline(), "invalid-options", { ...options, now: "2026-02-30T00:00:00Z" });
  const source = baseline();
  source.subscriptions[subscriptionId]!.discovery_metadata.discovered_at = "2026-09-16T00:01:00Z";
  rejected(source, "incomplete");
});

test("successful unchanged observation renews age without changing selected policy content", () => {
  const previous = baseline();
  const refreshed = baseline();
  refreshed.subscriptions[subscriptionId]!.discovered_at = "2026-09-17T00:00:00Z";
  refreshed.subscriptions[subscriptionId]!.discovery_metadata.discovered_at = "2026-09-17T00:00:00Z";
  const at = { ...options, now: "2026-09-17T01:00:00Z" };
  const before = importGovernanceBaseline(previous, at, validate);
  const after = importGovernanceBaseline(refreshed, at, validate);
  assert.deepEqual(before.snapshot, after.snapshot);
  assert.notEqual(before.constraints.discoveredAt, after.constraints.discoveredAt);
  assert.equal(Date.parse(after.constraints.expiresAt) - Date.parse(before.constraints.expiresAt), 86_400_000);
});

test("rejects absent, mismatched and malformed other subscriptions", () => {
  rejected(baseline(), "target-mismatch", { ...options, subscriptionId: otherId });
  const source = baseline();
  source.subscriptions[subscriptionId]!.discovery_metadata.scope.subscription_id = otherId;
  rejected(source, "target-mismatch");
  source.subscriptions[subscriptionId] = envelope();
  source.subscriptions[otherId] = envelope(otherId);
  source.subscriptions_discovered = source.subscriptions_processed = source.summary.subscriptions_complete = 2;
  source.subscriptions[otherId]!.findings.push({ arbitrary: "malformed" });
  source.subscriptions[otherId]!.policies = source.subscriptions[otherId]!.findings;
  rejected(source, "invalid-input");
});

test("rejects duplicate IDs and stale or incomplete nonselected subscriptions", () => {
  const duplicate = baseline();
  duplicate.subscriptions_excluded.push({ subscription_id: subscriptionId, reason: "disabled" });
  rejected(duplicate, "target-mismatch");
  const source = baseline();
  source.subscriptions[otherId] = envelope(otherId);
  source.subscriptions_discovered = source.subscriptions_processed = source.summary.subscriptions_complete = 2;
  source.subscriptions[otherId]!.discovery_status = "PARTIAL";
  rejected(source, "incomplete");
  source.subscriptions[otherId]!.discovery_status = "COMPLETE";
  source.subscriptions[otherId]!.discovered_at = "2026-08-01T00:00:00Z";
  source.subscriptions[otherId]!.discovery_metadata.discovered_at = "2026-08-01T00:00:00Z";
  rejected(source, "stale");
});

function inheritedBaseline() {
  const source = baseline();
  const entry = source.subscriptions[subscriptionId]!;
  entry.discovery_metadata.scope.management_groups = ["root"];
  entry.discovery_metadata.page_counts = { policyAssignments: 1, policyDefinitions: 2, policyExemptions: 1 };
  entry.assignment_inventory = [
    {
      displayName: "Inherited initiative",
      scope: managementScope,
      assignmentType: "management-group",
      policyDefinitionId: "initiative",
    },
  ];
  entry.findings = ["policy-b", "policy-a"].map((policyId) => ({
    policy_id: policyId,
    display_name: policyId,
    effect: "deny",
    scope: managementScope,
    assignment_id: `${managementScope}/providers/Microsoft.Authorization/policyAssignments/inherited`,
    classification: "informational",
    resource_types: ["Microsoft.Storage/storageAccounts"],
    exemption: { category: "Waiver", policyDefinitionReferenceIds: ["member-b", "member-a"] },
  }));
  entry.policies = structuredClone(entry.findings);
  Object.assign(entry.discovery_summary, {
    assignment_total: 1,
    assignment_kept: 1,
    management_group_inherited_count: 1,
    informational_count: 2,
    exempted_count: 2,
  });
  source.summary.total_findings = 2;
  return source;
}

test("preserves inherited findings and reported exemptions deterministically without granting mappings", () => {
  const source = inheritedBaseline();
  const selected = importGovernanceBaseline(source, options, validate);
  assert.deepEqual(
    selected.snapshot.findings.map((item) => item.policyId),
    ["policy-a", "policy-b"],
  );
  assert.equal(selected.constraints.summary.assignmentCount, 1);
  assert.equal(selected.constraints.summary.exemptionCount, 1);
  assert.equal(selected.constraints.summary.denyCount, 2);
  assert.ok(
    selected.snapshot.findings.every(
      (item) =>
        item.mappingStatus === "unmapped" &&
        item.scope === managementScope &&
        item.exemption?.verificationStatus === "unverified",
    ),
  );
  const entry = source.subscriptions[subscriptionId]!;
  entry.findings.reverse();
  entry.policies.reverse();
  const reordered = importGovernanceBaseline(source, options, validate);
  assert.deepEqual(reordered.snapshot.findings, selected.snapshot.findings);
  assert.notEqual(reordered.snapshot.contentHash, selected.snapshot.contentHash);
  assert.deepEqual(
    (source.subscriptions[subscriptionId]!.findings[0]!.exemption as Record<string, unknown>)
      .policyDefinitionReferenceIds,
    ["member-b", "member-a"],
  );
});

test("retains effective constraints while excluding arbitrary metadata and collector mapping guesses", () => {
  const source = inheritedBaseline();
  const entry = source.subscriptions[subscriptionId]!;
  Object.assign(entry, { unknown: { instruction: "MALICIOUS_PAYLOAD" } });
  Object.assign(entry.findings[0]!, {
    unknown: "MALICIOUS_PAYLOAD",
    required_value: { nested: [false, 3, null, "enforced"] },
    assignment_parameters: { mode: "enforced", ports: [443] },
    azurePropertyPath: "MALICIOUS_PAYLOAD",
    policyDefinitionReferenceId: "member-b",
  });
  entry.tags_required = [
    { name: "owner", allowed_values: ["team-b", "team-a"], default: "team-a", unknown: "MALICIOUS_PAYLOAD" },
  ];
  entry.allowed_locations = ["swedencentral", "germanywestcentral"];
  entry.policies = structuredClone(entry.findings);
  const result = importGovernanceBaseline(source, options, validate);
  assert.equal(JSON.stringify(result).includes("MALICIOUS_PAYLOAD"), false);
  assert.equal(JSON.stringify(result).includes("policies"), false);
  const selected = result.snapshot.findings.find((item) => item.policyId === "policy-b")!;
  assert.deepEqual(selected.requiredValue, { nested: [false, 3, null, "enforced"] });
  assert.deepEqual(selected.effectiveParameters, { mode: "enforced", ports: [443] });
  assert.equal(selected.policyDefinitionReferenceId, "member-b");
  assert.deepEqual(result.snapshot.tagsRequired, [
    { name: "owner", allowedValues: ["team-a", "team-b"], default: "team-a" },
  ]);
  assert.deepEqual(result.snapshot.allowedLocations, ["germanywestcentral", "swedencentral"]);
  assert.deepEqual(importGovernanceBaseline(JSON.stringify(source), options, validate), result);
});

test("different enforced values remain distinct and absent values differ from null", () => {
  for (const field of ["required_value", "assignment_parameters"]) {
    const source = inheritedBaseline();
    const entry = source.subscriptions[subscriptionId]!;
    const original = importGovernanceBaseline(source, options, validate);
    entry.findings[0]![field] = field === "required_value" ? null : { mode: "deny" };
    entry.policies = structuredClone(entry.findings);
    const first = importGovernanceBaseline(source, options, validate);
    assert.notDeepEqual(first, original);
    entry.findings[0]![field] = field === "required_value" ? false : { mode: "audit" };
    entry.policies = structuredClone(entry.findings);
    assert.notDeepEqual(importGovernanceBaseline(source, options, validate), first);
  }
});

test("content digest covers the entire selected raw envelope and root except observation timestamps and TTL", () => {
  const source = inheritedBaseline();
  const original = importGovernanceBaseline(source, options, validate);
  const refreshed = structuredClone(source);
  const entry = refreshed.subscriptions[subscriptionId]!;
  entry.discovered_at = entry.discovery_metadata.discovered_at = options.now;
  entry.discovery_metadata.ttl_days = 90;
  Object.assign(entry, { ttl_days: 30 });
  assert.equal(
    importGovernanceBaseline(refreshed, options, validate).snapshot.contentHash,
    original.snapshot.contentHash,
  );
  const mutations: Array<(value: ReturnType<typeof inheritedBaseline>) => void> = [
    (value) => {
      value.management_group_id = "different-root";
    },
    (value) => {
      value.subscriptions[subscriptionId]!.assignment_inventory[0]!.displayName = "changed";
    },
    (value) => {
      Object.assign(value.subscriptions[subscriptionId]!.discovery_summary, { audit_notes: "changed" });
    },
    (value) => {
      Object.assign(value.subscriptions[subscriptionId]!.discovery_metadata, { collector: "changed" });
    },
    (value) => {
      Object.assign(value.subscriptions[subscriptionId]!, { unrelated: "changed" });
    },
    (value) => {
      value.subscriptions[subscriptionId]!.findings[0]!.required_value = false;
      value.subscriptions[subscriptionId]!.policies = structuredClone(value.subscriptions[subscriptionId]!.findings);
    },
    (value) => {
      value.subscriptions[subscriptionId]!.findings[0]!.audit = { discovered_at: "not-a-collection-time", ttl_days: 2 };
      value.subscriptions[subscriptionId]!.policies = structuredClone(value.subscriptions[subscriptionId]!.findings);
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(source);
    mutate(changed);
    assert.notEqual(
      importGovernanceBaseline(changed, options, validate).snapshot.contentHash,
      original.snapshot.contentHash,
    );
  }
  const reorderedKeys = JSON.parse(
    JSON.stringify(source, (_key, value: unknown) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  );
  assert.equal(
    importGovernanceBaseline(reorderedKeys, options, validate).snapshot.contentHash,
    original.snapshot.contentHash,
  );
});

test("rejects nonfinite and oversized effective JSON constraints", () => {
  const nested = Array.from({ length: 17 }).reduce<unknown>((value) => ({ nested: value }), null);
  for (const field of ["required_value", "assignment_parameters"]) {
    for (const value of [Infinity, NaN, nested, "x".repeat(65_537), Array.from({ length: 4097 }, () => 0)]) {
      const source = inheritedBaseline();
      const entry = source.subscriptions[subscriptionId]!;
      entry.findings[0]![field] = field === "assignment_parameters" ? { value } : value;
      entry.policies = structuredClone(entry.findings);
      rejected(source, "invalid-input");
    }
    const source = inheritedBaseline();
    const entry = source.subscriptions[subscriptionId]!;
    entry.findings[0]![field] = { value: "OVERFLOW_NUMBER" };
    entry.policies = structuredClone(entry.findings);
    rejected(JSON.stringify(source).replaceAll('"OVERFLOW_NUMBER"', "1e400"), "invalid-input");
  }
  const source = inheritedBaseline();
  const entry = source.subscriptions[subscriptionId]!;
  entry.findings[0]!.assignment_parameters = ["not-an-object"];
  entry.policies = structuredClone(entry.findings);
  rejected(source, "invalid-input");
});

test("fails closed on malformed JSON, invalid UTF-8 and full-schema violations", () => {
  rejected("{", "invalid-input");
  rejected(new Uint8Array([0xff]), "invalid-input");
  rejected({ ...baseline(), unknown: "secret" }, "invalid-input");
  rejected(null, "invalid-input");
  const source = inheritedBaseline();
  source.subscriptions[subscriptionId]!.policies = [];
  rejected(source, "incomplete");
});

test("distinguishes repeated initiative policies by member reference and rejects duplicate identities", () => {
  const source = inheritedBaseline();
  const entry = source.subscriptions[subscriptionId]!;
  entry.findings = ["member-a", "member-b"].map((memberId) => ({
    ...entry.findings[0]!,
    policyDefinitionReferenceId: memberId,
  }));
  entry.policies = structuredClone(entry.findings);
  const selected = importGovernanceBaseline(source, options, validate);
  assert.deepEqual(
    selected.snapshot.findings.map((item) => item.policyDefinitionReferenceId),
    ["member-a", "member-b"],
  );
  entry.findings[1]!.policyDefinitionReferenceId = "member-a";
  entry.policies = structuredClone(entry.findings);
  rejected(source, "incomplete");
  for (const item of entry.findings) delete item.policyDefinitionReferenceId;
  entry.policies = structuredClone(entry.findings);
  rejected(source, "incomplete");
});

test("fails closed on unclassified kept assignments but accepts audit and disabled members", () => {
  const source = inheritedBaseline();
  const entry = source.subscriptions[subscriptionId]!;
  entry.findings = entry.policies = [];
  entry.discovery_summary.informational_count = entry.discovery_summary.exempted_count = 0;
  source.summary.total_findings = 0;
  rejected(source, "incomplete");
  entry.discovery_summary.audit_count = 2;
  assert.equal(importGovernanceBaseline(source, options, validate).constraints.summary.auditCount, 2);
  entry.discovery_summary.audit_count = 0;
  entry.discovery_summary.disabled_count = 2;
  assert.deepEqual(importGovernanceBaseline(source, options, validate).snapshot.findings, []);
  const uncovered = inheritedBaseline();
  const uncoveredEntry = uncovered.subscriptions[subscriptionId]!;
  uncoveredEntry.assignment_inventory.push({ ...uncoveredEntry.assignment_inventory[0]! });
  Object.assign(uncoveredEntry.discovery_summary, {
    assignment_total: 2,
    assignment_kept: 2,
    management_group_inherited_count: 2,
  });
  uncoveredEntry.discovery_metadata.page_counts.policyAssignments = 2;
  rejected(uncovered, "incomplete");
});

test("validates optional explicit classification coverage without equating members to assignments", () => {
  const source = inheritedBaseline();
  const entry = source.subscriptions[subscriptionId]!;
  const coverage = {
    assignment_count: 1,
    member_count: 2,
    finding_count: 2,
    audit_count: 0,
    disabled_count: 0,
    unclassified_count: 0,
  };
  Object.assign(entry.discovery_summary, { classification_coverage: coverage });
  assert.equal(importGovernanceBaseline(source, options, validate).snapshot.findings.length, 2);
  for (const key of Object.keys(coverage) as Array<keyof typeof coverage>) {
    coverage[key]++;
    rejected(source, "incomplete");
    coverage[key]--;
  }
  Object.assign(entry.discovery_summary, { classification_coverage: {} });
  rejected(source, "invalid-input");
});

test("includes not-scope exclusions exactly in assignment arithmetic and round trips", () => {
  const source = inheritedBaseline();
  const entry = source.subscriptions[subscriptionId]!;
  Object.assign(entry.discovery_summary, { assignment_total: 4, defender_auto_filtered: 1, not_scope_excluded: 2 });
  entry.discovery_metadata.page_counts.policyAssignments = 4;
  const selected = importGovernanceBaseline(source, options, validate);
  assert.equal(selected.constraints.summary.assignmentCount, 4);
  assert.deepEqual(importGovernanceBaseline(JSON.stringify(source), options, validate), selected);
  assert.deepEqual(importGovernanceBaseline(Buffer.from(JSON.stringify(source)), options, validate), selected);
  Object.assign(entry.discovery_summary, { not_scope_excluded: 1 });
  rejected(source, "incomplete");
  Object.assign(entry.discovery_summary, { not_scope_excluded: -1 });
  rejected(source, "invalid-input");
  Object.assign(entry.discovery_summary, { not_scope_excluded: null });
  rejected(source, "invalid-input");
});

test("round trips allowed excluded subscriptions without retaining their metadata", () => {
  const source = baseline();
  source.subscriptions_discovered = 2;
  for (const reason of ["disabled", "AAD_quota"]) {
    source.subscriptions_excluded = [{ subscription_id: otherId, reason, detail: "EXCLUDED_METADATA" }];
    const selected = importGovernanceBaseline(source, options, validate);
    assert.deepEqual(importGovernanceBaseline(JSON.stringify(source), options, validate), selected);
    assert.equal(JSON.stringify(selected).includes("EXCLUDED_METADATA"), false);
  }
});

test("mapping contract accepts optional definition and member identities without loosening other fields", () => {
  const validateMap = new Ajv2020({ strict: false, validateFormats: false }).compile(PolicyPropertyMapV1Schema);
  const mapping = {
    policyAssignmentId: "assignment",
    effect: "deny",
    logicalResourceId: "storage",
    propertyPath: "httpsOnly",
    disposition: "planned",
  };
  const document = {
    schemaVersion: "1.0.0",
    projectId: "example",
    runId: "run-1",
    governanceHash: "a".repeat(64),
    mappings: [mapping],
  };
  assert.ok(validateMap(document));
  for (const identities of [
    { policyDefinitionId: "policy" },
    { policyDefinitionReferenceId: "member" },
    { policyDefinitionId: "policy", policyDefinitionReferenceId: "member" },
  ]) {
    assert.ok(validateMap({ ...document, mappings: [{ ...mapping, ...identities }] }));
  }
  for (const invalid of [{ policyDefinitionId: "" }, { policyDefinitionReferenceId: 1 }, { verified: true }]) {
    assert.equal(validateMap({ ...document, mappings: [{ ...mapping, ...invalid }] }), false);
  }
});

test("rejects excessive nesting, hidden errors and missing inherited ancestry", () => {
  rejected("[".repeat(66) + "0" + "]".repeat(66), "invalid-input");
  rejected(baseline(), "invalid-options", { ...options, now: "2026-09-16T24:00:00Z" });
  const source = baseline();
  Object.assign(source.subscriptions[subscriptionId]!.discovery_metadata, { errors: ["failure"] });
  rejected(source, "incomplete");
  const inherited = inheritedBaseline();
  inherited.subscriptions[subscriptionId]!.discovery_metadata.scope.management_groups = [];
  rejected(inherited, "target-mismatch");
});
