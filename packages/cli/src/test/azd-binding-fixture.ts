import { buildAzdExecutionEnvelope } from "@apexops/capabilities";
import { calculateAzdBindingHash, CONTRACT_VERSION, type AzdBindingV1 } from "@apexops/contracts";

const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SUBSCRIPTION = "11111111-2222-3333-4444-555555555555";

/** A structurally valid azd binding for persisted-binding tests; it is never executed. */
export function azdBindingFixture(projectId = "demo", runId = "run-1"): AzdBindingV1 {
  const body: Omit<AzdBindingV1, "bindingHash"> = {
    schemaVersion: CONTRACT_VERSION,
    projectId,
    runId,
    track: "bicep",
    executor: "azd",
    azdVersion: "1.35.1",
    projectName: "demo",
    configHash: "a".repeat(64),
    infra: {
      provider: "bicep",
      layered: false,
      roots: [
        {
          name: "default",
          path: "infra",
          module: "main",
          provider: "bicep",
          dependsOn: [],
          treeHash: "b".repeat(64),
          resolvedParametersHash: "d".repeat(64),
        },
      ],
    },
    environment: {
      name: "dev",
      target: { subscriptionId: SUBSCRIPTION, location: "swedencentral", tenantId: TENANT, resourceGroup: "rg" },
      keys: ["AZURE_ENV_NAME", "AZURE_LOCATION"],
      valuesHash: "e".repeat(64),
    },
    parametersHash: "f".repeat(64),
    hooks: [],
    extensions: [],
    remoteModules: [],
    executionEnvelope: buildAzdExecutionEnvelope({
      environmentName: "dev",
      target: { tenantId: TENANT, subscriptionId: SUBSCRIPTION },
    }),
  };
  return { ...body, bindingHash: calculateAzdBindingHash(body) };
}
