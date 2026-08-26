import type { RequirementsV1 } from "@apexops/contracts";
import { escapeMarkdown, markdownTable } from "./markdown.js";

export const REQUIREMENTS_TEMPLATE_SLOTS = [
  "workload",
  "artifact-hash",
  "template-hash",
  "environment",
  "artifact-status",
  "business-context",
  "success-criteria",
  "requirements-table",
  "nfr-table",
  "security-and-compliance-table",
  "budget-and-operations",
  "regional-constraints",
  "assumptions-list",
  "unknowns-list",
  "architecture-handoff",
] as const;

type RequirementsTemplateSlot = (typeof REQUIREMENTS_TEMPLATE_SLOTS)[number];

type DocumentAvailability = "available" | "reference-only" | "unavailable";

interface DocumentDefinition {
  readonly sourceArtifactKind?: string;
  readonly sourceAvailability: DocumentAvailability;
  readonly templateAvailability: DocumentAvailability | "not-applicable";
  readonly renderer: string;
  readonly template?: {
    readonly assetPath: string;
    readonly slots: readonly string[];
  };
}

export const DOCUMENT_REGISTRY: Readonly<Record<string, DocumentDefinition>> = {
  requirements: {
    sourceArtifactKind: "requirements",
    sourceAvailability: "available",
    templateAvailability: "available",
    renderer: "requirements-template-v1",
    template: {
      assetPath: ".github/skills/apex-artifacts/templates/requirements.md",
      slots: REQUIREMENTS_TEMPLATE_SLOTS,
    },
  },
  status: {
    sourceArtifactKind: "run-config",
    sourceAvailability: "available",
    templateAvailability: "not-applicable",
    renderer: "run-status-v1",
  },
  preview: {
    sourceArtifactKind: "deployment-preview",
    sourceAvailability: "available",
    templateAvailability: "not-applicable",
    renderer: "deployment-preview-v1",
  },
  approval: {
    sourceArtifactKind: "approval-evidence",
    sourceAvailability: "available",
    templateAvailability: "not-applicable",
    renderer: "approval-evidence-v1",
  },
  inventory: {
    sourceArtifactKind: "resource-inventory",
    sourceAvailability: "available",
    templateAvailability: "not-applicable",
    renderer: "resource-inventory-v1",
  },
  "architecture-assessment": {
    sourceArtifactKind: "architecture",
    sourceAvailability: "unavailable",
    templateAvailability: "reference-only",
    renderer: "unavailable",
  },
  "cost-estimate": {
    sourceArtifactKind: "cost-estimate",
    sourceAvailability: "unavailable",
    templateAvailability: "reference-only",
    renderer: "unavailable",
  },
  "governance-constraints": {
    sourceArtifactKind: "governance-constraints",
    sourceAvailability: "unavailable",
    templateAvailability: "reference-only",
    renderer: "unavailable",
  },
  "implementation-plan": {
    sourceAvailability: "unavailable",
    templateAvailability: "reference-only",
    renderer: "unavailable",
  },
  "deployment-summary": {
    sourceAvailability: "unavailable",
    templateAvailability: "reference-only",
    renderer: "unavailable",
  },
  "operations-runbook": {
    sourceAvailability: "unavailable",
    templateAvailability: "reference-only",
    renderer: "unavailable",
  },
  "resource-inventory-template": {
    sourceArtifactKind: "resource-inventory",
    sourceAvailability: "available",
    templateAvailability: "reference-only",
    renderer: "unavailable",
  },
};

function assertExactSlots(template: string, expectedSlots: readonly string[]): void {
  const slots = [...template.matchAll(/\{([a-z][a-z-]*)\}/gu)].map((match) => match[1]!);
  if (
    slots.length !== expectedSlots.length ||
    new Set(slots).size !== expectedSlots.length ||
    expectedSlots.some((slot) => !slots.includes(slot))
  ) {
    throw new Error("Requirements document template has invalid slots");
  }
}

function unavailable(field: string): string {
  return `Unavailable: RequirementsV1 does not represent ${field}.`;
}

export function renderRequirementsDocument(
  requirements: RequirementsV1,
  template: string,
  artifactHash: string,
  templateHash: string,
): string {
  const templateDefinition = DOCUMENT_REGISTRY.requirements?.template;
  if (templateDefinition === undefined) throw new Error("Requirements document template is not registered");
  assertExactSlots(template, templateDefinition.slots);

  const requirementsRows = [...requirements.requirements]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => [item.id, item.priority, item.status, item.statement, item.source]);
  const list = (items: readonly string[]): string =>
    items.length === 0
      ? "None."
      : [...items]
          .sort((left, right) => left.localeCompare(right))
          .map((item) => `- ${escapeMarkdown(item)}`)
          .join("\n");
  const replacements: Record<RequirementsTemplateSlot, string> = {
    workload: escapeMarkdown(requirements.workload),
    "artifact-hash": artifactHash,
    "template-hash": templateHash,
    environment: escapeMarkdown(requirements.environment),
    "artifact-status": "accepted",
    "business-context": escapeMarkdown(requirements.businessContext ?? unavailable("business context")),
    "success-criteria": escapeMarkdown(requirements.successCriteria ?? unavailable("success criteria")),
    "requirements-table": markdownTable(["ID", "Priority", "Status", "Statement", "Source"], requirementsRows),
    "nfr-table": escapeMarkdown(
      requirements.nonFunctionalRequirements ?? unavailable("non-functional requirement classifications"),
    ),
    "security-and-compliance-table": escapeMarkdown(
      requirements.securityAndCompliance ?? unavailable("security or compliance classifications"),
    ),
    "budget-and-operations": escapeMarkdown(
      requirements.budgetAndOperations ?? unavailable("budget or operations data"),
    ),
    "regional-constraints": escapeMarkdown(
      requirements.regionalConstraints ?? unavailable("regional or residency constraints"),
    ),
    "assumptions-list": list(requirements.assumptions),
    "unknowns-list": list(requirements.unknowns),
    "architecture-handoff": escapeMarkdown(
      requirements.architectureHandoff ?? "Architecture must validate candidate services against current evidence.",
    ),
  };
  return REQUIREMENTS_TEMPLATE_SLOTS.reduce(
    (document, slot) => document.replaceAll(`{${slot}}`, () => replacements[slot]),
    template,
  );
}
