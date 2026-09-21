import type {
  ApprovalEvidenceV1,
  ArchitectureV1,
  DeploymentPreviewV1,
  DiagnosisV1,
  OperationRecordV1,
  RequirementsV1,
  ResourceInventoryV1,
  RunConfigV1,
} from "@apexops/contracts";
import { escapeMarkdown, markdownTable, optional, stableJson } from "./markdown.js";

const compareText = (left: string, right: string): number => left.localeCompare(right);

function fieldList(fields: readonly (readonly [string, unknown])[]): string {
  return fields.map(([label, value]) => `- **${label}:** ${escapeMarkdown(value)}`).join("\n");
}

export function renderRequirements(requirements: RequirementsV1): string {
  const rows = [...requirements.requirements]
    .sort((left, right) => compareText(left.id, right.id))
    .map((item) => [item.id, item.priority, item.status, item.statement, item.source]);
  const assumptions = [...requirements.assumptions].sort(compareText);
  const unknowns = [...requirements.unknowns].sort(compareText);
  return [
    "# Requirements",
    "",
    fieldList([
      ["Project", requirements.projectId],
      ["Environment", requirements.environment],
      ["Workload", requirements.workload],
    ]),
    "",
    "## Requirements",
    "",
    markdownTable(["ID", "Priority", "Status", "Statement", "Source"], rows),
    "",
    "## Assumptions",
    "",
    assumptions.length === 0 ? "None." : assumptions.map((item) => `- ${escapeMarkdown(item)}`).join("\n"),
    "",
    "## Unknowns",
    "",
    unknowns.length === 0 ? "None." : unknowns.map((item) => `- ${escapeMarkdown(item)}`).join("\n"),
  ].join("\n");
}

export function renderRunStatus(run: RunConfigV1): string {
  const gates = [...run.gates]
    .sort((left, right) => left.gate - right.gate)
    .map((gate) => [
      gate.gate,
      gate.state,
      gate.state === "inherited" ? optional(gate.inheritedFromRunId) : "-",
      optional(gate.decidedAt),
      optional(gate.reason),
      gate.dependencyHash,
    ]);
  return [
    "# Run Status",
    "",
    fieldList([
      ["Project", run.projectId],
      ["Run", run.runId],
      ["Environment", run.environment],
      ["Target scope", run.targetScope],
      ["IaC tool", run.iacTool],
      ["Parent run", optional(run.parentRunId)],
      ["Owner epoch", run.ownerEpoch],
      ["Created", run.createdAt],
    ]),
    "",
    "## Gates",
    "",
    markdownTable(["Gate", "State", "Inherited From", "Decided", "Reason", "Dependency Hash"], gates),
  ].join("\n");
}

function previewAction(action: DeploymentPreviewV1["changes"][number]["action"]): string {
  return action === "delete" || action === "replace" ? `**${action.toUpperCase()}**` : action;
}

export function renderDeploymentPreview(preview: DeploymentPreviewV1): string {
  const changes = [...preview.changes]
    .sort((left, right) =>
      compareText(`${left.resourceId}\u0000${left.action}`, `${right.resourceId}\u0000${right.action}`),
    )
    .map((change) => [
      change.resourceId,
      previewAction(change.action),
      change.material ? "yes" : "no",
      optional(change.details),
    ]);
  const blockers = [...preview.blockers].sort(compareText);
  const destructive =
    preview.operation === "destroy" ||
    preview.changes.some(({ action }) => action === "delete" || action === "replace");
  return [
    "# Deployment Preview",
    "",
    destructive ? "> **DESTRUCTIVE CHANGES PRESENT**" : "> No destructive changes detected.",
    "",
    fieldList([
      ["Project", preview.projectId],
      ["Run", preview.runId],
      ["Environment", preview.environment],
      ["Track", preview.track],
      ["Operation", preview.operation],
      ["Target", preview.target],
      ["Created", preview.createdAt],
      ["Expires", preview.expiresAt],
      ["Preview hash", preview.previewHash],
    ]),
    "",
    "## Blockers",
    "",
    blockers.length === 0 ? "None." : blockers.map((blocker) => `- **BLOCKED:** ${escapeMarkdown(blocker)}`).join("\n"),
    "",
    "## Semantic Changes",
    "",
    changes.length === 0 ? "No changes." : markdownTable(["Resource", "Action", "Material", "Details"], changes),
  ].join("\n");
}

export function renderApprovalEvidence(approval: ApprovalEvidenceV1): string {
  const summary = [
    "# Approval Evidence",
    "",
    fieldList([
      ["Project", approval.projectId],
      ["Run", approval.runId],
      ["Gate", approval.gate],
      ["Decision", approval.decision.toUpperCase()],
      ["Actor", approval.actor],
      ["Mechanism", approval.mechanism],
      ["Recipient identity", optional(approval.recipientIdentity)],
      ["Writer transfer claim hash", optional(approval.writerTransferClaimHash)],
      ["Writer epoch", approval.writerEpoch],
      ["Dependency hash", approval.dependencyHash],
      ["Preview hash", optional(approval.previewHash)],
      ["Decided", approval.decidedAt],
      ["Expires", optional(approval.expiresAt)],
    ]),
  ];
  return summary.join("\n");
}

export function renderArchitectureDecisionRecords(architecture: ArchitectureV1, architectureHash: string): string {
  const records = architecture.decisionRecords;
  if (records === undefined || records.length === 0)
    throw new Error("Structured Architecture decision records are unavailable");
  const list = (values: string[]) => values.map((value) => `- ${escapeMarkdown(value)}`).join("\n");
  return [
    "# Architecture Decision Records",
    "",
    `Architecture artifact: ${architectureHash}`,
    "",
    "Design decisions from accepted Architecture data. Gate approval and implemented state are separate evidence.",
    "",
    ...[...records]
      .sort((left, right) => compareText(left.id, right.id))
      .map((record) =>
        [
          `## ${escapeMarkdown(record.id)}: ${escapeMarkdown(record.title)}`,
          "",
          `Requirements: ${record.requirementIds.map(escapeMarkdown).join(", ")}`,
          "",
          "### Context",
          "",
          escapeMarkdown(record.context),
          "",
          "### Decision",
          "",
          escapeMarkdown(record.decision),
          "",
          "### Alternatives Considered",
          "",
          markdownTable(
            ["Option", "Benefits", "Drawbacks", "Rejection Reason"],
            record.alternatives.map((alternative) => [
              alternative.option,
              alternative.benefits,
              alternative.drawbacks,
              alternative.rejectionReason,
            ]),
          ),
          "",
          "### Consequences",
          "",
          "Positive:",
          "",
          list(record.positiveConsequences),
          "",
          "Negative:",
          "",
          list(record.negativeConsequences),
          "",
          "### WAF Pillar Analysis",
          "",
          markdownTable(
            ["Pillar", "Impact"],
            Object.entries(record.wafImpacts).sort(([left], [right]) => compareText(left, right)),
          ),
          "",
          "### Compliance Considerations",
          "",
          escapeMarkdown(record.complianceConsiderations),
          "",
          "### Implementation Notes",
          "",
          escapeMarkdown(record.implementationNotes),
          "",
        ].join("\n"),
      ),
  ].join("\n");
}

export function renderOperationsRunbook(diagnosis: DiagnosisV1, diagnosisHash: string): string {
  const handoff = diagnosis.operationalHandoff;
  if (handoff === undefined) throw new Error("Operational handoff data is unavailable");
  const list = (values: string[]) => values.map((value) => `- ${escapeMarkdown(value)}`).join("\n");
  const procedure = (title: string, value: typeof handoff.recovery): string =>
    [
      `## ${title}`,
      "",
      value.applicability === "not-applicable"
        ? `Not applicable: ${escapeMarkdown(value.rationale)}`
        : [
            `Owner: ${escapeMarkdown(value.owner)}`,
            "",
            "Execution status: untested. These instructions have not been executed by APEX.",
            "",
            "### Prerequisites",
            "",
            list(value.prerequisites),
            "",
            "### Steps",
            "",
            value.steps.map((step, index) => `${index + 1}. ${escapeMarkdown(step)}`).join("\n"),
            "",
            "### Verification",
            "",
            escapeMarkdown(value.verification),
          ].join("\n"),
      "",
    ].join("\n");
  return [
    "# Operations Runbook",
    "",
    `Diagnosis artifact: ${diagnosisHash}`,
    "",
    "Documented operational intent, not execution authorization. Obtain current approvals before changes or recovery actions.",
    "",
    "## Ownership And Access",
    "",
    fieldList([
      ["Project", diagnosis.projectId],
      ["Run", diagnosis.runId],
      ["Owner", handoff.owner],
      ["Escalation", handoff.escalation],
      ["Maintenance window", handoff.maintenanceWindow],
      ["Diagnosis recorded", diagnosis.diagnosedAt],
      ["Recorded diagnosis status", diagnosis.status],
    ]),
    "",
    list(handoff.accessPrerequisites),
    "",
    "## Configuration References",
    "",
    handoff.configurationReferences.length === 0
      ? "No configuration references recorded."
      : markdownTable(
          ["Name", "Source Reference"],
          handoff.configurationReferences.map(({ name, source }) => [name, source]),
        ),
    "",
    "## Health Checks And Monitoring",
    "",
    markdownTable(
      ["Resource", "Check", "Expected Outcome", "Pinned References"],
      handoff.healthChecks.map((check) => [
        check.resourceId,
        check.check,
        check.expectedOutcome,
        check.evidenceRefs.join(", ") || "None; not observed",
      ]),
    ),
    "",
    "Expected outcomes and evidence references do not establish that these checks ran or passed.",
    "",
    escapeMarkdown(handoff.monitoring),
    "",
    procedure("Incident Response", handoff.incidentResponse),
    procedure("Rollback", handoff.rollback),
    procedure("Backup And Recovery", handoff.recovery),
    "## Limitations",
    "",
    list(handoff.limitations),
  ].join("\n");
}

export function renderDeploymentSummary(input: {
  operation: OperationRecordV1;
  inventory: ResourceInventoryV1;
  approval: ApprovalEvidenceV1;
  operationHash: string;
  inventoryHash: string;
  provider: "fake" | "bicep" | "terraform";
  evidenceMode: "simulated" | "native";
}): string {
  const { operation, inventory, approval } = input;
  const simulated = input.evidenceMode === "simulated" || input.provider === "fake";
  const rows = [...inventory.resources]
    .sort((left, right) =>
      compareText(`${left.logicalId}\u0000${left.resourceId}`, `${right.logicalId}\u0000${right.resourceId}`),
    )
    .map((resource) => [resource.logicalId, resource.resourceId, resource.type, resource.location]);
  return [
    "# Deployment Summary",
    "",
    simulated
      ? "> Simulated evidence only. No cloud deployment is established by this record."
      : "> Native-adapter evidence. This summary does not independently verify live cloud execution.",
    "",
    "## Recorded Operation",
    "",
    fieldList([
      ["Project", operation.projectId],
      ["Run", operation.runId],
      ["Operation", operation.operation],
      ["State", operation.state],
      ["Provider", input.provider],
      ["Provider operation", optional(operation.providerOperationId)],
      ["Recorded", operation.updatedAt],
      ["Error code", optional(operation.errorCode)],
    ]),
    "",
    "## Resource Inventory",
    "",
    `Collected: ${escapeMarkdown(inventory.collectedAt)}`,
    "",
    rows.length === 0
      ? "No resources are recorded in this inventory. This is not proof of absence outside the recorded scope."
      : markdownTable(["Logical ID", "Resource ID", "Type", "Location"], rows),
    "",
    "## Authorization And Provenance",
    "",
    fieldList([
      ["Operation hash", input.operationHash],
      ["Inventory hash", input.inventoryHash],
      ["Preview hash", operation.previewHash],
      ["Approval hash", operation.approvalHash],
      ["Approval actor", approval.actor],
      ["Approval recorded", approval.decidedAt],
      ["Writer epoch at execution", operation.ownerEpoch],
    ]),
    "",
    "Historical authorization applies only to the recorded operation. It does not authorize another apply, rollback, or destroy.",
    "",
    "## Operational Evidence Gaps",
    "",
    "Health checks, application endpoints, diagnostic coverage, recovery procedures, restore tests, actual spend, and compliance certification are not established by these operation and inventory records.",
    "",
    "Review workload-specific operational evidence before handoff. Further changes require a current preview and new approval.",
  ].join("\n");
}

export function renderResourceInventory(inventory: ResourceInventoryV1): string {
  const rows = [...inventory.resources]
    .sort((left, right) =>
      compareText(`${left.logicalId}\u0000${left.resourceId}`, `${right.logicalId}\u0000${right.resourceId}`),
    )
    .map((resource) => [
      resource.logicalId,
      resource.resourceId,
      resource.type,
      resource.location,
      stableJson(resource.properties),
    ]);
  return [
    "# Resource Inventory",
    "",
    fieldList([
      ["Project", inventory.projectId],
      ["Run", inventory.runId],
      ["Deployment hash", inventory.deploymentHash],
      ["Collected", inventory.collectedAt],
    ]),
    "",
    "## Resources",
    "",
    rows.length === 0
      ? "No resources."
      : markdownTable(["Logical ID", "Resource ID", "Type", "Location", "Properties"], rows),
  ].join("\n");
}
