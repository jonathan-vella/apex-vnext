import type { AzdBindingV1, AzdExecutionEnvelopeV1 } from "@apexops/contracts";
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

/** azd arguments for the operations a bound project supports; `azd up` and every other command are unrepresentable. */
export function buildAzdArguments(
  envelope: AzdExecutionEnvelopeV1,
  operation: "provision-preview" | "provision",
): string[] {
  if (operation !== "provision-preview" && operation !== "provision")
    throw new AzdBindingError("AZD_BINDING_INPUT_INVALID", "Only azd provision can be run for a bound project");
  const command = operation === "provision-preview" ? ["provision", "--preview"] : ["provision"];
  return [...command, "--environment", envelope.environmentName, "--no-prompt"];
}

/** Identity the executor observed from the Azure CLI and azd immediately before running azd. */
export interface ObservedAzdIdentity {
  /** Active cloud name, for example `az cloud show`. */
  readonly cloud?: string;
  /** Tenant of the signed-in session azd will use. */
  readonly tenantId?: string;
  /** Subscription azd will use (the environment's `AZURE_SUBSCRIPTION_ID` as resolved by azd). */
  readonly subscriptionId?: string;
  /** Default subscription of the Azure CLI session. */
  readonly azureCliDefaultSubscriptionId?: string;
}

/**
 * Identity preflight the executor must pass before every provision: the cloud, tenant and subscription azd and the
 * Azure CLI report must equal the approved target. A missing or different value stops the run; values are never echoed.
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
  check("subscription", observed.subscriptionId, expected.subscriptionId, true);
  check("CLI default subscription", observed.azureCliDefaultSubscriptionId, expected.subscriptionId, true);
}
