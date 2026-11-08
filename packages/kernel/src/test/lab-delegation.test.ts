import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { ApprovalEvidenceV1Schema, type DeploymentPreviewV1 } from "@apexops/contracts";
import {
  evaluateLabDelegation,
  verifyLabDelegationApproval,
  LabDelegationError,
  type LabDelegationContext,
} from "../lab-delegation.js";
import { sha256Json } from "../canonical.js";

const now = "2026-10-31T12:00:00.000Z";
const scope = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/lab";
const resource = `${scope}/providers/Microsoft.Storage/storageAccounts/archive`;

function fixture(): LabDelegationContext {
  const requirements = {
    schemaVersion: "1.0.0" as const,
    projectId: "demo",
    environment: "dev",
    workload: "Synthetic non-sensitive document archive",
    requirements: [
      {
        id: "archive",
        statement: "Archive synthetic documents",
        status: "confirmed" as const,
        priority: "must" as const,
        source: "synthetic fixture",
      },
    ],
    unknowns: [],
    assumptions: [],
  };
  const policy = {
    schemaVersion: "1.0.0" as const,
    projectId: "demo",
    runId: "run",
    purpose: "lab" as const,
    environment: "dev",
    track: "bicep" as const,
    cloud: "AzureCloud" as const,
    tenantId: "22222222-2222-2222-2222-222222222222",
    subscriptionId: "11111111-1111-1111-1111-111111111111",
    targetScope: scope,
    requirementsHash: sha256Json(requirements),
    resourceIds: [resource],
    gates: [1, 4] as (1 | 4)[],
    operation: "apply" as const,
    writerEpoch: 1,
    recipientIdentity: "synthetic-writer",
    expiresAt: "2026-10-31T13:00:00.000Z",
  };
  const consent = {
    schemaVersion: "1.0.0" as const,
    policyHash: sha256Json(policy),
    actor: "fixture-human",
    mechanism: "terminal-policy-confirmation" as const,
    userOwnedScopeConfirmed: true as const,
    syntheticNonSensitiveConfirmed: true as const,
    futurePreviewReviewed: false as const,
    consentedAt: now,
    expiresAt: policy.expiresAt,
  };
  const previewBody = {
    schemaVersion: "1.0.0" as const,
    projectId: "demo",
    runId: "run",
    environment: "dev",
    track: "bicep" as const,
    operation: "apply" as const,
    target: scope,
    commit: "a".repeat(64),
    dependencyRevision: "a".repeat(64),
    ownerEpoch: 1,
    inputHash: "b".repeat(64),
    iacHash: "c".repeat(64),
    policyHash: "d".repeat(64),
    changes: [{ resourceId: resource, action: "create" as const, material: true }],
    blockers: [],
    createdAt: now,
    expiresAt: "2026-10-31T12:30:00.000Z",
  };
  const preview: DeploymentPreviewV1 = { ...previewBody, previewHash: sha256Json(previewBody) };
  return {
    policy,
    consent,
    consentHash: sha256Json(consent),
    activeConsentHash: sha256Json(consent),
    activePolicyHash: sha256Json(policy),
    run: {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: "run",
      environment: "dev",
      purpose: "lab",
      targetScope: scope,
      iacTool: "bicep",
      createdAt: now,
      runtimeLockHash: "e".repeat(64),
      ownerEpoch: 1,
      gates: [1, 2, 3, 4].map((gate) => ({
        gate,
        state: "open",
        dependencyHash: gate === 4 ? preview.previewHash : "f".repeat(64),
      })),
    },
    requirements,
    gate: 4,
    recipientIdentity: "synthetic-writer",
    now,
    reviewBlockers: [],
    dependencyRevision: preview.dependencyRevision,
    preview,
    approvalContextHash: "9".repeat(64),
    scope: {
      schemaVersion: "1.0.0",
      previewHash: preview.previewHash,
      cloud: "AzureCloud",
      tenantId: policy.tenantId,
      subscriptionId: policy.subscriptionId,
      targetScope: scope,
      executor: "azd",
      hooksAbsent: true,
      extensionsAbsent: true,
      resourceStates: [{ resourceId: resource, state: "absent" }],
    },
  };
}

function rebindPreview(context: LabDelegationContext): void {
  const { previewHash: _old, ...body } = context.preview!;
  context.preview!.previewHash = sha256Json(body);
  context.run.gates[3]!.dependencyHash = context.preview!.previewHash;
  context.scope!.previewHash = context.preview!.previewHash;
}

test("delegated Gates 1 and apply Gate 4 retain distinct honest consent and agent decision provenance", () => {
  const context = fixture();
  const gate1 = evaluateLabDelegation({ ...context, gate: 1 });
  const gate4 = evaluateLabDelegation(context);
  for (const approval of [gate1, gate4]) {
    assert.equal(Value.Check(ApprovalEvidenceV1Schema, approval), true);
    assert.equal(approval.mechanism, "lab-delegation");
    assert.equal(approval.actor, "agent:synthetic-writer");
    assert.notEqual(approval.actor, context.consent.actor);
    assert.equal(context.consent.futurePreviewReviewed, false);
  }
  assert.equal(gate1.previewHash, undefined);
  assert.equal(gate4.previewHash, context.preview!.previewHash);
  assert.notEqual(sha256Json(gate1), sha256Json(gate4));
  assert.equal(gate4.expiresAt, context.preview!.expiresAt);
  context.run.gates[3]!.state = "approved";
  verifyLabDelegationApproval({ ...context, now: "2026-10-31T12:01:00.000Z" }, gate4);
  assert.equal(Value.Check(ApprovalEvidenceV1Schema, { ...gate4, mechanism: "tty" }), false);
});

test("a provider-observed allowlisted non-material no-op is permitted but not a creation receipt", () => {
  const context = fixture();
  context.preview!.changes[0]!.action = "no-op";
  context.preview!.changes[0]!.material = false;
  context.scope!.resourceStates[0]!.state = "present";
  rebindPreview(context);
  assert.equal(evaluateLabDelegation(context).decision, "approved");
});

const negatives: [string, (context: LabDelegationContext) => void][] = [
  [
    "wrong policy",
    (c) => {
      c.activePolicyHash = "0".repeat(64);
    },
  ],
  [
    "wrong or revoked consent",
    (c) => {
      c.activeConsentHash = "0".repeat(64);
    },
  ],
  [
    "expired policy",
    (c) => {
      c.now = "2026-10-31T13:00:00.000Z";
    },
  ],
  [
    "overlong policy",
    (c) => {
      c.policy.expiresAt = "2026-11-02T12:00:00.000Z";
    },
  ],
  [
    "expired writer authority",
    (c) => {
      c.authorityExpiresAt = now;
    },
  ],
  [
    "wrong run",
    (c) => {
      c.run.runId = "another";
    },
  ],
  [
    "wrong environment",
    (c) => {
      c.run.environment = "test";
    },
  ],
  [
    "wrong writer",
    (c) => {
      c.run.ownerEpoch++;
    },
  ],
  [
    "wrong recipient",
    (c) => {
      c.recipientIdentity = "another-agent";
    },
  ],
  [
    "wrong target",
    (c) => {
      c.preview!.target = `${scope}-other`;
      rebindPreview(c);
    },
  ],
  [
    "wrong tenant",
    (c) => {
      c.scope!.tenantId = "33333333-3333-3333-3333-333333333333";
    },
  ],
  [
    "wrong subscription",
    (c) => {
      c.scope!.subscriptionId = "33333333-3333-3333-3333-333333333333";
    },
  ],
  [
    "unknown requirement",
    (c) => {
      c.requirements.unknowns.push("Unknown owner");
    },
  ],
  [
    "unseen Requirements",
    (c) => {
      c.requirements.workload = "Changed";
    },
  ],
  [
    "review blocker",
    (c) => {
      c.reviewBlockers = ["Unresolved policy risk"];
    },
  ],
  [
    "preview blocker",
    (c) => {
      c.preview!.blockers.push("Policy blocker");
      rebindPreview(c);
    },
  ],
  [
    "stale preview",
    (c) => {
      c.preview!.expiresAt = now;
      rebindPreview(c);
    },
  ],
  [
    "future preview",
    (c) => {
      c.preview!.createdAt = "2026-10-31T12:01:00.000Z";
      rebindPreview(c);
    },
  ],
  [
    "stale dependency",
    (c) => {
      c.dependencyRevision = "0".repeat(64);
    },
  ],
  [
    "unbound context",
    (c) => {
      delete c.approvalContextHash;
    },
  ],
  [
    "unbound scope",
    (c) => {
      delete c.scope;
    },
  ],
  [
    "unknown change",
    (c) => {
      c.preview!.changes[0]!.action = "unknown";
      rebindPreview(c);
    },
  ],
  [
    "update",
    (c) => {
      c.preview!.changes[0]!.action = "update";
      rebindPreview(c);
    },
  ],
  [
    "delete",
    (c) => {
      c.preview!.changes[0]!.action = "delete";
      rebindPreview(c);
    },
  ],
  [
    "replace",
    (c) => {
      c.preview!.changes[0]!.action = "replace";
      rebindPreview(c);
    },
  ],
  [
    "material no-op",
    (c) => {
      c.preview!.changes[0]!.action = "no-op";
      rebindPreview(c);
    },
  ],
  [
    "pre-existing resource create",
    (c) => {
      c.scope!.resourceStates[0]!.state = "present";
    },
  ],
  [
    "out-of-policy resource",
    (c) => {
      c.preview!.changes[0]!.resourceId = `${scope}/providers/Microsoft.Storage/storageAccounts/other`;
      c.scope!.resourceStates[0]!.resourceId = c.preview!.changes[0]!.resourceId;
      rebindPreview(c);
    },
  ],
  [
    "out-of-scope policy ID",
    (c) => {
      c.policy.resourceIds[0] = `${scope}-other/providers/Microsoft.Storage/storageAccounts/archive`;
    },
  ],
  [
    "ambiguous states",
    (c) => {
      c.scope!.resourceStates.push(c.scope!.resourceStates[0]!);
    },
  ],
  [
    "path traversal in policy",
    (c) => {
      c.policy.resourceIds[0] = `${scope}/providers/Microsoft.Storage/storageAccounts/../outside`;
    },
  ],
  [
    "distinct destroy evidence",
    (c) => {
      c.preview!.operation = "destroy";
      rebindPreview(c);
    },
  ],
  [
    "production purpose",
    (c) => {
      c.run.purpose = "production";
    },
  ],
  [
    "production environment disguised as lab",
    (c) => {
      c.run.environment = "prod";
      c.policy.environment = "prod";
    },
  ],
];
for (const [name, change] of negatives) {
  test(`delegation refuses ${name} in an isolated data fixture`, () => {
    const context = fixture();
    change(context);
    assert.throws(() => evaluateLabDelegation(context), LabDelegationError);
  });
}

test("execution rechecks current consent, context and scope instead of trusting an old approval", () => {
  const context = fixture();
  const approval = evaluateLabDelegation(context);
  context.run.gates[3]!.state = "approved";
  for (const update of [
    { approvalContextHash: "8".repeat(64) },
    { activeConsentHash: "0".repeat(64) },
    { recipientIdentity: "another-agent" },
  ]) {
    assert.throws(() => verifyLabDelegationApproval({ ...context, ...update }, approval), LabDelegationError);
  }
  context.scope!.resourceStates[0]!.state = "present";
  assert.throws(() => verifyLabDelegationApproval(context, approval), LabDelegationError);
});
