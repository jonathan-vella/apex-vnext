/**
 * Kernel guard for pending rubber-duck reviews (DECISION-031 amendment of 2026-10-08). Rubber-duck inherits the
 * caller's APEX tools and the managed hooks fail open when missing or timed out, so while any review in the workspace
 * waits for its capture, the service refuses every operation that approves, deletes or publishes. Reads, staging,
 * task flow (nextTask, taskContext, reviewComplete) and installation management stay allowed; completing the review
 * or cancelling it lifts the guard. Cancelling (`apex task cancel`) is CLI only: the user stops any running rubber-duck
 * first, because the kernel cannot see whether it is still running.
 */
export type ReviewGuardedEffect = "approve" | "delete" | "publish";

/** The single classification of ApexService operations the guard blocks, keyed by method name. */
export const REVIEW_GUARDED_OPERATIONS = {
  decideGateNumber: "approve",
  decideReview: "approve",
  resolveReview: "approve",
  improvementDecide: "approve",
  acceptWriterTransfer: "approve",
  deleteProject: "delete",
  improvementDeleteObservation: "delete",
  improvementPrune: "delete",
  deleteTelemetry: "delete",
  promote: "publish",
  acceptEvidence: "publish",
  deploy: "publish",
  publishRepository: "publish",
  provisionGovernance: "publish",
  createWriterTransfer: "publish",
} as const satisfies Record<string, ReviewGuardedEffect>;

export type ReviewGuardedOperation = keyof typeof REVIEW_GUARDED_OPERATIONS;
