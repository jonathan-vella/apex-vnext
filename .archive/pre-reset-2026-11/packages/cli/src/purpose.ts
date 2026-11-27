import { DeploymentPurposeSchema, type DeploymentPurpose } from "@apexops/contracts";
import { Value } from "@sinclair/typebox/value";
import { ApexError, EXIT_CODES } from "./errors.js";

export const DEFAULT_DEPLOYMENT_PURPOSE: DeploymentPurpose = "lab";

export const PURPOSE_PRODUCTION_UNAVAILABLE = "PURPOSE_PRODUCTION_UNAVAILABLE";

export function isDeploymentPurpose(value: unknown): value is DeploymentPurpose {
  return Value.Check(DeploymentPurposeSchema, value);
}

/** Production is a valid contract value but fails closed until CP-28/CP-29 (#457/#458) ship the CI-owned flow. */
export function assertDeploymentPurposeUsable(purpose: DeploymentPurpose): void {
  if (purpose === "production")
    throw new ApexError(
      "APEX_VALIDATION",
      "Deployment purpose 'production' is unavailable until CP-28/CP-29 (#457/#458) ship the CI-owned production flow; use purpose 'lab'",
      EXIT_CODES.validation,
      { reason: PURPOSE_PRODUCTION_UNAVAILABLE, purpose },
    );
}
