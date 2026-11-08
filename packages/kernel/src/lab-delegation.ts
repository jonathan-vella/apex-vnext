import {
  CONTRACT_VERSION,
  registerContractFormats,
  LabApplyScopeV1Schema,
  LabDelegationConsentV1Schema,
  LabDelegationPolicyV1Schema,
  RequirementsV1Schema,
  RunConfigV1Schema,
  DeploymentPreviewV1Schema,
  type ApprovalEvidenceV1,
  type DeploymentPreviewV1,
  type LabApplyScopeV1,
  type LabDelegationConsentV1,
  type LabDelegationPolicyV1,
  type RequirementsV1,
  type RunConfigV1,
} from "@apexops/contracts";
import { Value } from "@sinclair/typebox/value";
import { sha256Json } from "./canonical.js";

registerContractFormats();

export const LAB_DELEGATION_MAX_TTL_MS = 24 * 60 * 60 * 1000;

export class LabDelegationError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "LabDelegationError";
  }
}

function requireFact(valid: boolean, reason: string, message: string): void {
  if (!valid) throw new LabDelegationError(reason, message);
}

export function assertLabDelegationPolicy(
  policy: LabDelegationPolicyV1,
  run: RunConfigV1,
  requirements: RequirementsV1,
  recipientIdentity: string,
  now: string,
): void {
  requireFact(
    Value.Check(LabDelegationPolicyV1Schema, policy),
    "LAB_DELEGATION_POLICY_INVALID",
    "Invalid delegation policy",
  );
  requireFact(
    Value.Check(RunConfigV1Schema, run) && Value.Check(RequirementsV1Schema, requirements),
    "LAB_DELEGATION_INPUT_INVALID",
    "Current validated run and Requirements contracts are required",
  );
  requireFact(
    run.purpose === "lab" && !/(?:^|-)(?:prod|production)(?:-|$)/u.test(run.environment),
    "LAB_DELEGATION_PRODUCTION_BLOCKED",
    "Delegation is limited to non-production lab runs",
  );
  requireFact(
    policy.projectId === run.projectId &&
      policy.runId === run.runId &&
      policy.environment === run.environment &&
      policy.targetScope === run.targetScope &&
      policy.track === run.iacTool &&
      policy.writerEpoch === run.ownerEpoch &&
      policy.recipientIdentity === recipientIdentity,
    "LAB_DELEGATION_RUN_MISMATCH",
    "Delegation policy does not name the selected run, target, track and current writer/recipient",
  );
  const target = /^\/subscriptions\/([0-9a-f-]+)\/resourceGroups\/([A-Za-z0-9_()-][A-Za-z0-9_.()-]*)$/u.exec(
    policy.targetScope,
  );
  requireFact(
    target !== null && target[1] === policy.subscriptionId,
    "LAB_DELEGATION_TARGET_INVALID",
    "An exact subscription/resource-group scope is required",
  );
  const prefix = `${policy.targetScope}/providers/`;
  requireFact(
    policy.resourceIds.every(
      (id) =>
        id.startsWith(prefix) &&
        /^Microsoft\.[A-Za-z0-9.]+(?:\/[A-Za-z0-9_().-]+)+$/u.test(id.slice(prefix.length)) &&
        !id
          .slice(prefix.length)
          .split("/")
          .some((part) => part === "." || part === "..") &&
        id.slice(prefix.length).split("/").length % 2 === 1,
    ) && new Set(policy.resourceIds.map((id) => id.toLowerCase())).size === policy.resourceIds.length,
    "LAB_DELEGATION_SCOPE_INVALID",
    "The policy must allowlist unique exact ARM resource IDs inside its user-confirmed resource group",
  );
  requireFact(
    policy.requirementsHash === sha256Json(requirements) &&
      requirements.projectId === run.projectId &&
      requirements.environment === run.environment &&
      requirements.unknowns.length === 0 &&
      requirements.requirements.every(({ status }) => status === "confirmed"),
    "LAB_DELEGATION_REQUIREMENTS_UNPROVEN",
    "Delegation requires exact accepted Requirements with no unknown or deferred requirements",
  );
  const ttl = Date.parse(policy.expiresAt) - Date.parse(now);
  requireFact(
    Number.isFinite(ttl) && ttl > 0 && ttl <= LAB_DELEGATION_MAX_TTL_MS,
    "LAB_DELEGATION_EXPIRED",
    "Delegation must expire within 24 hours and must still be current",
  );
}

export interface LabDelegationContext {
  policy: LabDelegationPolicyV1;
  consent: LabDelegationConsentV1;
  consentHash: string;
  activePolicyHash: string;
  activeConsentHash: string;
  run: RunConfigV1;
  requirements: RequirementsV1;
  gate: 1 | 4;
  recipientIdentity: string;
  now: string;
  reviewBlockers: readonly string[];
  dependencyRevision: string;
  preview?: DeploymentPreviewV1;
  approvalContextHash?: string;
  scope?: LabApplyScopeV1;
  phase?: "decision" | "execution";
  authorityExpiresAt?: string;
}

export function evaluateLabDelegation(context: LabDelegationContext): ApprovalEvidenceV1 {
  const { policy, consent, run, gate, now, preview, scope } = context;
  assertLabDelegationPolicy(policy, run, context.requirements, context.recipientIdentity, now);
  const policyHash = sha256Json(policy);
  requireFact(
    Value.Check(LabDelegationConsentV1Schema, consent) &&
      consent.policyHash === policyHash &&
      context.activePolicyHash === policyHash &&
      sha256Json(consent) === context.consentHash &&
      context.activeConsentHash === context.consentHash &&
      consent.expiresAt === policy.expiresAt &&
      Date.parse(consent.consentedAt) <= Date.parse(now) &&
      Date.parse(consent.expiresAt) - Date.parse(consent.consentedAt) > 0 &&
      Date.parse(consent.expiresAt) - Date.parse(consent.consentedAt) <= LAB_DELEGATION_MAX_TTL_MS,
    "LAB_DELEGATION_CONSENT_INVALID",
    "Current, explicitly recorded human policy consent is required; a policy file or agent prose is not consent",
  );
  const record = run.gates.find((item) => item.gate === gate);
  requireFact(
    record?.state === (context.phase === "execution" ? "approved" : "open") && policy.gates.includes(gate),
    "LAB_DELEGATION_GATE_INVALID",
    "The gate is not current or is not delegated",
  );
  requireFact(
    context.reviewBlockers.length === 0,
    "LAB_DELEGATION_BLOCKED",
    "Unresolved review blockers cannot be delegated away",
  );
  const authorityExpiry =
    context.authorityExpiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(context.authorityExpiresAt);
  requireFact(
    authorityExpiry > Date.parse(now),
    "LAB_DELEGATION_WRITER_EXPIRED",
    "Delegated writer authority has expired",
  );
  let expiresAt = new Date(Math.min(Date.parse(policy.expiresAt), authorityExpiry)).toISOString();
  if (gate === 4) {
    requireFact(
      preview !== undefined && Value.Check(DeploymentPreviewV1Schema, preview),
      "LAB_DELEGATION_PREVIEW_INVALID",
      "A validated exact preview contract is required",
    );
    requireFact(
      preview !== undefined && preview.operation === "apply",
      "LAB_DELEGATION_DESTROY_UNSUPPORTED",
      "Delegated destroy is unsupported; it requires its own current preview and normal human approval",
    );
    requireFact(
      preview !== undefined &&
        preview.projectId === run.projectId &&
        preview.runId === run.runId &&
        preview.environment === run.environment &&
        preview.track === "bicep" &&
        preview.target === policy.targetScope &&
        preview.ownerEpoch === run.ownerEpoch &&
        preview.dependencyRevision === context.dependencyRevision &&
        preview.commit === context.dependencyRevision &&
        record?.dependencyHash === preview.previewHash &&
        Date.parse(preview.createdAt) <= Date.parse(now) &&
        Date.parse(preview.expiresAt) > Date.parse(now),
      "LAB_DELEGATION_PREVIEW_STALE",
      "The exact preview, dependency revision, target and writer must be current",
    );
    if (preview === undefined) throw new LabDelegationError("LAB_DELEGATION_PREVIEW_STALE", "Preview is missing");
    const { previewHash, ...body } = preview;
    requireFact(
      sha256Json(body) === previewHash && /^[a-f0-9]{64}$/u.test(context.approvalContextHash ?? ""),
      "LAB_DELEGATION_CONTEXT_INVALID",
      "Exact immutable preview and approval-context hashes are required",
    );
    requireFact(preview.blockers.length === 0, "LAB_DELEGATION_BLOCKED", "Preview blockers cannot be delegated away");
    requireFact(
      scope !== undefined &&
        Value.Check(LabApplyScopeV1Schema, scope) &&
        scope.previewHash === previewHash &&
        scope.targetScope === policy.targetScope &&
        scope.cloud === policy.cloud &&
        scope.tenantId === policy.tenantId &&
        scope.subscriptionId === policy.subscriptionId,
      "LAB_DELEGATION_SCOPE_UNPROVEN",
      "Native provider identity and exact resource-state observations are required; tags or an external ledger are not authorization",
    );
    const states = new Map(scope?.resourceStates.map(({ resourceId, state }) => [resourceId, state]));
    const ids = preview.changes.map(({ resourceId }) => resourceId);
    requireFact(
      states.size === scope?.resourceStates.length &&
        ids.length === new Set(ids).size &&
        states.size === ids.length &&
        ids.every((id) => states.has(id)),
      "LAB_DELEGATION_SCOPE_UNPROVEN",
      "Every exact preview resource needs its own unambiguous provider observation",
    );
    requireFact(
      preview.changes.every(
        ({ resourceId, action, material }) =>
          policy.resourceIds.includes(resourceId) &&
          ((action === "create" && material && states.get(resourceId) === "absent") ||
            (action === "no-op" && !material && states.get(resourceId) === "present")),
      ),
      "LAB_DELEGATION_CHANGE_BLOCKED",
      "Only allowlisted creates of absent resources and non-material no-ops are delegated; updates, deletes, replacements, unknowns and pre-existing creates are blocked",
    );
    expiresAt = new Date(Math.min(Date.parse(expiresAt), Date.parse(preview.expiresAt))).toISOString();
  }

  const base = {
    schemaVersion: CONTRACT_VERSION,
    projectId: run.projectId,
    runId: run.runId,
    decision: "approved" as const,
    mechanism: "lab-delegation" as const,
    actor: `agent:${context.recipientIdentity}`,
    recipientIdentity: context.recipientIdentity,
    evaluator: "kernel-lab-delegation-v1" as const,
    policyHash,
    consentHash: context.consentHash,
    dependencyHash: record!.dependencyHash,
    writerEpoch: run.ownerEpoch,
    decidedAt: now,
    expiresAt,
  };
  if (gate === 1) return { ...base, gate: 1 };
  if (preview === undefined || scope === undefined || context.approvalContextHash === undefined)
    throw new LabDelegationError("LAB_DELEGATION_SCOPE_UNPROVEN", "Gate 4 requires exact scope and context evidence");
  return {
    ...base,
    gate: 4,
    previewHash: preview.previewHash,
    approvalContextHash: context.approvalContextHash,
    scopeEvidenceHash: sha256Json(scope),
  };
}

export function verifyLabDelegationApproval(context: LabDelegationContext, approval: ApprovalEvidenceV1): void {
  const expected = evaluateLabDelegation({ ...context, phase: "execution" });
  const { decidedAt: expectedTime, expiresAt: expectedExpiry, ...expectedBinding } = expected;
  const { decidedAt, expiresAt, ...binding } = approval;
  requireFact(
    sha256Json(binding) === sha256Json(expectedBinding) &&
      Date.parse(decidedAt) >= Date.parse(context.consent.consentedAt) &&
      Date.parse(decidedAt) <= Date.parse(expectedTime) &&
      expiresAt !== undefined &&
      Date.parse(expiresAt) > Date.parse(expectedTime) &&
      Date.parse(expiresAt) <= Date.parse(expectedExpiry!),
    "LAB_DELEGATION_APPROVAL_INVALID",
    "Delegated approval does not bind the current consent, preview, context, scope and agent provenance",
  );
}
