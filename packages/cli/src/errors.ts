import { GovernanceBaselineError } from "@apexops/capabilities";

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
  | "APEX_VALIDATION"
  | "APEX_STALE"
  | "APEX_AUTHORIZATION"
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

export function normalizeError(error: unknown): ApexError {
  if (error instanceof ApexError) return error;
  if (error instanceof GovernanceBaselineError) return governanceBaselineApexError(error);
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
