import type { AzdBindingV1, AzdExecutionEnvelopeV1 } from "@apexops/contracts";
import { isAbsolute } from "node:path";
import { AzdBindingError } from "./azd-project-files.js";

export interface AzdEnvelopeRequest {
  readonly environmentName: string;
  readonly cloud?: AzdExecutionEnvelopeV1["identityPreflight"]["cloud"];
  /** The approved target the identity preflight compares against. */
  readonly target: { readonly tenantId: string; readonly subscriptionId: string };
}

/**
 * How the executor runs azd for a bound project: an explicit environment from the project root without prompts, after
 * an identity preflight. azd's own configuration and extensions and the user's Azure CLI sign-in are left alone.
 */
export function buildAzdExecutionEnvelope(request: AzdEnvelopeRequest): AzdExecutionEnvelopeV1 {
  return {
    workingDirectory: "project-root",
    environmentName: request.environmentName,
    prompts: "disabled",
    identityPreflight: {
      cloud: request.cloud ?? "AzureCloud",
      tenantId: request.target.tenantId,
      subscriptionId: request.target.subscriptionId,
      onMismatch: "stop",
    },
  };
}

export type AzdOperation = "provision-preview" | "provision" | "down";

/**
 * azd arguments for the operations a bound project supports; `azd up`, `azd deploy`, `--purge` and every other command
 * are unrepresentable. The project root is passed with `--cwd` so azd never depends on the process directory.
 *
 * - `--no-state` makes `provision` always deploy the approved Bicep instead of skipping when azd's stored deployment
 *   state hash is unchanged, which would hide drift the approved what-if showed.
 * - `down` needs `--force` to run without a prompt; the approval of the destroy preview replaces that prompt. It never
 *   passes `--purge`, so soft-deleted resources such as Key Vaults stay recoverable.
 * - The preview asks for `--output json`, the only machine-readable form azd offers for `--preview`.
 */
export function buildAzdArguments(
  envelope: AzdExecutionEnvelopeV1,
  operation: AzdOperation,
  projectRoot: string,
): string[] {
  if (operation !== "provision-preview" && operation !== "provision" && operation !== "down")
    throw new AzdBindingError(
      "AZD_BINDING_INPUT_INVALID",
      "Only azd provision and azd down can be run for a bound project",
    );
  if (!isAbsolute(projectRoot) || projectRoot.startsWith("-"))
    throw new AzdBindingError("AZD_BINDING_INPUT_INVALID", "The azd project root must be an absolute path");
  const command =
    operation === "provision-preview"
      ? ["provision", "--preview", "--no-state"]
      : operation === "provision"
        ? ["provision", "--no-state"]
        : ["down", "--force"];
  return [
    ...command,
    "--environment",
    envelope.environmentName,
    "--cwd",
    projectRoot,
    "--no-prompt",
    ...(operation === "provision-preview" ? ["--output", "json"] : []),
  ];
}

/**
 * Identity the executor observed from the Azure CLI (`az account show`) immediately before running azd. azd keeps its own
 * credential store and reports no account that can be read cheaply, so nothing here claims to be azd's login. azd's
 * target subscription and tenant are the values of the bound azd environment, which the binding already covers.
 */
export interface ObservedAzdIdentity {
  /** Active cloud name of the Azure CLI session. */
  readonly cloud?: string;
  /** Tenant of the Azure CLI session. */
  readonly tenantId?: string;
  /** Default subscription of the Azure CLI session. */
  readonly azureCliDefaultSubscriptionId?: string;
}

/**
 * Identity preflight the executor must pass before every preview, apply and destroy: the cloud, tenant and default
 * subscription the Azure CLI reports must equal the approved target. A missing or different value stops the run; values
 * are never echoed. It verifies the Azure CLI identity only; a different azd login can still act on the bound
 * subscription with that principal's permissions, which Azure RBAC governs.
 */
export function assertAzdIdentityMatchesBinding(
  observed: ObservedAzdIdentity,
  binding: Pick<AzdBindingV1, "executionEnvelope">,
): void {
  const expected = binding.executionEnvelope.identityPreflight;
  const fail = (message: string): never => {
    throw new AzdBindingError("AZD_IDENTITY_MISMATCH", message);
  };
  const check = (name: string, actual: string | undefined, wanted: string, fold: boolean): void => {
    if (typeof actual !== "string" || actual.length === 0)
      fail(`The active Azure ${name} was not reported; sign in to the approved target and run the preflight again`);
    else if ((fold ? actual.toLowerCase() : actual) !== wanted)
      fail(`The active Azure ${name} does not match the approved target; sign in to the approved target`);
  };
  check("cloud", observed.cloud, expected.cloud, false);
  check("tenant", observed.tenantId, expected.tenantId, true);
  check("CLI subscription", observed.azureCliDefaultSubscriptionId, expected.subscriptionId, true);
}
