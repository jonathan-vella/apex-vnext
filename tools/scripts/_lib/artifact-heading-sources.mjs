export const TEMPLATE_DIR = ".github/skills/azure-artifacts/templates";

export const ARTIFACT_TEMPLATE_PATHS = {
  "01-requirements.md": `${TEMPLATE_DIR}/01-requirements.template.md`,
  "02-architecture-assessment.md": `${TEMPLATE_DIR}/02-architecture-assessment.template.md`,
  "03-des-cost-estimate.md": `${TEMPLATE_DIR}/03-des-cost-estimate.template.md`,
  "04-governance-constraints.md": `${TEMPLATE_DIR}/04-governance-constraints.template.md`,
  "04-implementation-plan.md": `${TEMPLATE_DIR}/04-implementation-plan.template.md`,
  "04-preflight-check.md": `${TEMPLATE_DIR}/04-preflight-check.template.md`,
  "05-implementation-reference.md": `${TEMPLATE_DIR}/05-implementation-reference.template.md`,
  "06-deployment-summary.md": `${TEMPLATE_DIR}/06-deployment-summary.template.md`,
  "07-ab-cost-estimate.md": `${TEMPLATE_DIR}/07-ab-cost-estimate.template.md`,
  "07-backup-dr-plan.md": `${TEMPLATE_DIR}/07-backup-dr-plan.template.md`,
  "07-compliance-matrix.md": `${TEMPLATE_DIR}/07-compliance-matrix.template.md`,
  "07-design-document.md": `${TEMPLATE_DIR}/07-design-document.template.md`,
  "07-documentation-index.md": `${TEMPLATE_DIR}/07-documentation-index.template.md`,
  "07-operations-runbook.md": `${TEMPLATE_DIR}/07-operations-runbook.template.md`,
  "07-resource-inventory.md": `${TEMPLATE_DIR}/07-resource-inventory.template.md`,
  "09-lessons-learned.md": `${TEMPLATE_DIR}/09-lessons-learned.template.md`,
  "README.md": `${TEMPLATE_DIR}/PROJECT-README.template.md`,
};

export const OPTIONAL_ARTIFACT_HEADINGS = {
  "00-handoff.md": [],
  "01-requirements.md": ["## References"],
  "02-architecture-assessment.md": ["## References"],
  "03-des-cost-estimate.md": ["## References"],
  "04-governance-constraints.md": ["## 📜 Compliance Frameworks", "## References"],
  "04-implementation-plan.md": ["## References"],
  "04-preflight-check.md": ["## References"],
  "05-implementation-reference.md": ["## Next Steps", "## References"],
  "06-deployment-summary.md": ["## References"],
  "07-ab-cost-estimate.md": ["## References"],
  "07-backup-dr-plan.md": ["## 3. Disaster Recovery Architecture", "## References"],
  "07-compliance-matrix.md": ["## Security Controls Summary", "## References"],
  "07-design-document.md": ["## References"],
  "07-documentation-index.md": ["## Architecture Overview", "## References"],
  "07-operations-runbook.md": ["## References"],
  "07-resource-inventory.md": [
    "## Resource Configuration Details",
    "## Tags Applied",
    "## Resource Dependencies",
    "## Cost Summary by Resource",
    "## Cost by Resource",
    "## Private DNS Zones",
    "## IP Address Allocation",
    "## Module Summary",
    "## Validation Commands",
    "## References",
  ],
  "09-lessons-learned.md": ["## References"],
  "README.md": [],
};

export const TEMPLATE_META_HEADINGS = ["## Template Instructions", "## Required Structure"];

export const NON_TEMPLATE_ARTIFACT_HEADINGS = {
  "00-handoff.md": [
    "## Completed Steps",
    "## Key Decisions",
    "## Open Challenger Findings (must_fix only)",
    "## Context for Next Step",
    "## Skill Context",
    "## Artifacts",
  ],
};
