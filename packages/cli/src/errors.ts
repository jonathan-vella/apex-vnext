import { GovernanceBaselineError } from "@apexops/capabilities";
import { RunWriterConflictError } from "@apexops/kernel";
import { APEX_VERSION } from "./version.js";

export const EXIT_CODES = {
  success: 0,
  usage: 2,
  notFound: 3,
  conflict: 4,
  validation: 5,
  stale: 6,
  authorization: 7,
  internal: 10,
} as const;

export type ApexErrorCode =
  | "APEX_USAGE"
  | "APEX_NOT_FOUND"
  | "APEX_CONFLICT"
  | "APEX_WRITER_CONFLICT"
  | "APEX_WORKSPACE_UNSUPPORTED"
  | "APEX_RUNTIME_MISMATCH"
  | "APEX_VALIDATION"
  | "APEX_STALE"
  | "APEX_AUTHORIZATION"
  | "APEX_CURSOR_INVALID"
  | "APEX_RESULT_TOO_LARGE"
  | "APEX_REVIEW_PENDING"
  | "APEX_INTERNAL";

export class ApexError extends Error {
  constructor(
    readonly code: ApexErrorCode,
    message: string,
    readonly exitCode: number,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApexError";
  }
}

const REMEDIATION_BY_CODE: Record<ApexErrorCode, string> = {
  APEX_USAGE: "Fix the tool arguments to match the input schema, then call the tool again.",
  APEX_NOT_FOUND: "Call status first, refresh the identifiers, and retry only with an existing project, run, or task.",
  APEX_CONFLICT:
    "Call status and retry only if the refreshed state still requires this action; never retry mutations blindly after cancellation or timeout.",
  APEX_WRITER_CONFLICT:
    "Continue from the owning worktree, release the writer lease there, or wait for the lease to expire before retrying.",
  APEX_WORKSPACE_UNSUPPORTED:
    "Use the absolute path of a supported APEX checkout or git worktree, or start a workspace-aware MCP server.",
  APEX_RUNTIME_MISMATCH:
    "Make this APEX runtime and the workspace runtime lock the same version: run `apex update` for an older workspace, or install the matching APEX plugin or @apexops/cli version for a newer one.",
  APEX_VALIDATION: "Correct the validation issues against the current tool contract, then call the tool again.",
  APEX_STALE: "Call status to refresh state and use the latest expected head, epoch, task, or cursor before retrying.",
  APEX_AUTHORIZATION: "Call status and obtain the required human approval or decision before retrying.",
  APEX_CURSOR_INVALID:
    "Discard the cursor, call the same tool again without it, and continue only from the new result; cursors do not survive an MCP server restart.",
  APEX_RESULT_TOO_LARGE:
    "Request a smaller bounded result, use a paging-capable read tool, or narrow the requested document or collection.",
  APEX_REVIEW_PENDING:
    "Finish the pending rubber-duck review with reviewComplete, or have the user stop any running rubber-duck and then cancel the review from a terminal with apex task cancel; then retry.",
  APEX_INTERNAL:
    "Report this with the server log; retry only after checking status because side effects may have completed.",
};

export type RuntimeMismatchReason = "RUNTIME_WORKSPACE_OLDER" | "RUNTIME_WORKSPACE_NEWER" | "RUNTIME_LOCK_INVALID";

const RUNTIME_MISMATCH_REMEDIATION: Record<RuntimeMismatchReason, string> = {
  RUNTIME_WORKSPACE_OLDER: `Run \`apex update\` in the workspace with @apexops/cli@${APEX_VERSION}, the runtime this server runs, then call status again.`,
  RUNTIME_WORKSPACE_NEWER:
    "Install the APEX plugin or @apexops/cli version named by the workspace runtime lock and restart the MCP server; do not downgrade the workspace with an older runtime.",
  RUNTIME_LOCK_INVALID: `Inspect .apex/apex.lock.json; if a newer APEX runtime did not write it, run \`apex doctor --fix --yes\` in the workspace with @apexops/cli@${APEX_VERSION} to rewrite it, then call status again.`,
};

// Remediation is a fixed hint per stable code (and, for a runtime mismatch, per fixed reason) so error details,
// causes, and paths never reach MCP clients.
export function remediationForApexError(error: ApexError): string {
  if (error.code === "APEX_RUNTIME_MISMATCH") {
    const reason = (error.details as { reason?: unknown } | undefined)?.reason;
    if (typeof reason === "string" && Object.hasOwn(RUNTIME_MISMATCH_REMEDIATION, reason))
      return RUNTIME_MISMATCH_REMEDIATION[reason as RuntimeMismatchReason];
  }
  return REMEDIATION_BY_CODE[error.code];
}

export function normalizeError(error: unknown): ApexError {
  if (error instanceof ApexError) return error;
  if (error instanceof GovernanceBaselineError) return governanceBaselineApexError(error);
  if (error instanceof RunWriterConflictError) {
    return new ApexError(
      "APEX_WRITER_CONFLICT",
      `${error.message}; retry from that worktree, release the writer lease there, or wait for it to expire`,
      EXIT_CODES.conflict,
      { ownerWorktree: error.ownerWorktree, expiresAt: error.expiresAt },
      { cause: error },
    );
  }
  if (error instanceof Error && /expired|stale/i.test(error.message)) {
    return new ApexError("APEX_STALE", error.message, EXIT_CODES.stale, undefined, { cause: error });
  }
  if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
    return new ApexError("APEX_NOT_FOUND", error.message, EXIT_CODES.notFound, undefined, { cause: error });
  }
  return new ApexError(
    "APEX_INTERNAL",
    error instanceof Error ? error.message : String(error),
    EXIT_CODES.internal,
    undefined,
    { cause: error },
  );
}

const GOVERNANCE_BASELINE_HINTS: Record<GovernanceBaselineError["code"], string> = {
  incomplete:
    "the baseline does not fully cover the target scope; recollect it with tools/scripts/collect-governance-baseline.ps1 -IncludeDescendants and confirm coverage_status is COMPLETE",
  "target-mismatch":
    "the baseline scope does not match the project target scope; collect it for the target subscription or its management group",
  stale: "the baseline is too old; collect a fresh baseline",
  "invalid-input":
    "the file does not match the governance baseline schema; recollect it with tools/scripts/collect-governance-baseline.ps1",
  "invalid-options": "the project target scope cannot be checked against a baseline; check the project target scope",
};

export function governanceBaselineApexError(
  error: GovernanceBaselineError,
  source: "baseline" | "reference" = "baseline",
): ApexError {
  const stale = error.code === "stale";
  const hint =
    source === "reference"
      ? "the bundled governance reference is unusable; run apex doctor --fix --yes or update APEX"
      : GOVERNANCE_BASELINE_HINTS[error.code];
  return new ApexError(
    stale ? "APEX_STALE" : "APEX_VALIDATION",
    `${error.message}: ${hint}`,
    stale ? EXIT_CODES.stale : EXIT_CODES.validation,
    { reason: `GOVERNANCE_${source.toUpperCase()}_${error.code.toUpperCase().replaceAll("-", "_")}` },
    { cause: error },
  );
}

export function retiredProjectionError(): ApexError {
  return new ApexError(
    "APEX_VALIDATION",
    "The VS Code projection is retired; run `apex init --client github-copilot-cli`",
    EXIT_CODES.validation,
    { reason: "CLIENT_PROJECTION_RETIRED" },
  );
}
