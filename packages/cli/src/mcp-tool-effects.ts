import type { MCP_OUTPUT_SCHEMAS } from "./mcp-output-schemas.js";

export type McpToolName = keyof typeof MCP_OUTPUT_SCHEMAS;

/**
 * Effect class of every MCP tool, keyed by the output-schema registry so a new tool cannot be added unclassified.
 * - `read-only`: never writes state.
 * - `read`: adds no new effect; it may only finish recovering an already-committed run or customization transaction,
 *   so it holds the workspace lock like every other writer. While a CLI command holds the lock only to wait for an
 *   external process, such as a provider preview or apply, it is answered from a validated snapshot without the lock
 *   instead, and waits for the lock when it would need to recover.
 * - `repeat-guarded`: changes state; each call runs through the kernel repeat guard, so an identical repeat while the
 *   selected run is unchanged returns the original result instead of executing again.
 * - `convergent`: changes state outside the run, so the run-scoped guard cannot tell whether a repeat is stale, and
 *   converges on its own: `doctor` re-applies the same repair to workspace installation files, and
 *   `improvementObserve` content-addresses observations, so a repeat returns the stored observation as deduplicated
 *   or recreates it after a supported deletion.
 */
export type McpToolEffect = "read-only" | "read" | "repeat-guarded" | "convergent";
export const MCP_TOOL_EFFECTS = {
  status: "read-only",
  projectList: "read-only",
  doctorChecks: "read",
  capabilityList: "read",
  capabilityStatus: "read",
  taskContext: "read",
  readTaskInput: "read",
  preview: "read",
  inventory: "read",
  diagnose: "read",
  render: "read",
  improvementObservations: "read",
  improvementProposals: "read",
  releaseWriter: "repeat-guarded",
  nextTask: "repeat-guarded",
  recordInput: "repeat-guarded",
  governanceImport: "repeat-guarded",
  governanceSelect: "repeat-guarded",
  projectCreate: "repeat-guarded",
  projectUse: "repeat-guarded",
  projectDelete: "repeat-guarded",
  gateDecide: "repeat-guarded",
  reviewDecide: "repeat-guarded",
  stageArtifact: "repeat-guarded",
  stageFile: "repeat-guarded",
  generateIac: "repeat-guarded",
  validateTask: "repeat-guarded",
  completeTask: "repeat-guarded",
  requirementsComplete: "repeat-guarded",
  architectureComplete: "repeat-guarded",
  reviewComplete: "repeat-guarded",
  planComplete: "repeat-guarded",
  reconcile: "repeat-guarded",
  promote: "repeat-guarded",
  submitEvidence: "repeat-guarded",
  improvementObserve: "convergent",
  doctor: "convergent",
} as const satisfies Record<McpToolName, McpToolEffect>;

/** Tools that change state: the `repeat-guarded` and `convergent` effect classes. */
export type McpStateChangingTool = {
  [Name in McpToolName]: (typeof MCP_TOOL_EFFECTS)[Name] extends "repeat-guarded" | "convergent" ? Name : never;
}[McpToolName];

/**
 * Pending-review guard of every state-changing tool (DECISION-031 amendment of 2026-10-08), so a new state-changing
 * tool cannot be added without deciding. Rubber-duck inherits the caller's APEX tools and the managed hooks fail open
 * when missing or timed out, so while a review waits for its capture, the service refuses each operation marked
 * `approve`, `delete` or `publish` with APEX_REVIEW_PENDING, on MCP and on the CLI command for the same operation.
 * `null` leaves the tool to its usual kernel checks: task flow, staging, the review's own `reviewComplete`, project
 * creation and selection, governance import, reconciliation and the convergent installation and observation tools.
 * CLI-only commands are outside this table: they need a terminal, which neither the APEX agent nor rubber-duck has.
 */
export type ReviewGuard = "approve" | "delete" | "publish";
export const MCP_TOOL_REVIEW_GUARDS = {
  releaseWriter: null,
  nextTask: null,
  recordInput: "approve",
  governanceImport: null,
  governanceSelect: null,
  projectCreate: null,
  projectUse: null,
  projectDelete: "delete",
  gateDecide: "approve",
  reviewDecide: "approve",
  stageArtifact: null,
  stageFile: null,
  generateIac: null,
  validateTask: null,
  completeTask: null,
  requirementsComplete: null,
  architectureComplete: null,
  reviewComplete: null,
  planComplete: null,
  reconcile: null,
  promote: "publish",
  submitEvidence: "publish",
  improvementObserve: null,
  doctor: null,
} as const satisfies Record<McpStateChangingTool, ReviewGuard | null>;

/** Tools the pending-review guard refuses. */
export type ReviewGuardedTool = {
  [Name in McpStateChangingTool]: (typeof MCP_TOOL_REVIEW_GUARDS)[Name] extends ReviewGuard ? Name : never;
}[McpStateChangingTool];
