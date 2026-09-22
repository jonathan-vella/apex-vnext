import { Value } from "@sinclair/typebox/value";
import {
  GovernanceSetupConfigV1Schema,
  GovernanceSetupPlanV1Schema,
  calculatePolicyValidationDigest,
  type GovernanceSetupConfigV1,
  type GovernanceSetupPlanV1,
} from "@apexops/contracts";

export function planGovernanceSetup(
  config: GovernanceSetupConfigV1,
  repositoryEvidence: unknown,
  oidcEvidence: unknown,
): GovernanceSetupPlanV1 {
  config = structuredClone(config);
  if (!Value.Check(GovernanceSetupConfigV1Schema, config))
    throw new TypeError("Invalid governance setup configuration");
  const evidenceHash = calculatePolicyValidationDigest({ repository: repositoryEvidence, oidc: oidcEvidence });
  const repository = repositoryEvidence as {
    id?: unknown;
    full_name?: unknown;
    owner?: { id?: unknown; login?: unknown };
    name?: unknown;
  } | null;
  const oidc = oidcEvidence as {
    use_default?: unknown;
    use_immutable_subject?: unknown;
    sub_claim_prefix?: unknown;
  } | null;
  const blockers: string[] = [];
  let subject: string | undefined;
  if (
    !repository ||
    typeof repository.full_name !== "string" ||
    repository.full_name.toLowerCase() !== config.repository.toLowerCase() ||
    !Number.isSafeInteger(repository.id) ||
    Number(repository.id) <= 0 ||
    !Number.isSafeInteger(repository.owner?.id) ||
    Number(repository.owner?.id) <= 0 ||
    typeof repository.owner?.login !== "string" ||
    typeof repository.name !== "string" ||
    `${repository.owner.login}/${repository.name}` !== repository.full_name ||
    !Value.Check(GovernanceSetupConfigV1Schema.properties.repository, repository.full_name)
  ) {
    blockers.push("Repository identity is missing or does not match the requested repository.");
  } else if (
    !oidc ||
    oidc.use_default !== true ||
    typeof oidc.use_immutable_subject !== "boolean" ||
    typeof oidc.sub_claim_prefix !== "string"
  ) {
    blockers.push(
      "OIDC subject settings are incomplete or customized; obtain reviewed subject evidence without changing organization policy.",
    );
  } else {
    const expectedPrefix = oidc.use_immutable_subject
      ? `repo:${repository.owner.login}@${repository.owner.id}/${repository.name}@${repository.id}`
      : `repo:${repository.full_name}`;
    if (oidc.sub_claim_prefix !== expectedPrefix)
      blockers.push("Observed OIDC prefix does not match the repository identity and subject mode.");
    else subject = `${expectedPrefix}:environment:governance`;
  }
  const variables: Record<string, string> = {
    AZURE_TENANT_ID: config.tenantId,
    AZURE_SUBSCRIPTION_ID: config.subscriptionId,
    GOVERNANCE_MG_ID: config.managementGroupId ?? "",
    GOVERNANCE_SUBSCRIPTION_ID: config.managementGroupId === undefined ? config.subscriptionId : "",
    GOVERNANCE_MAX_SUBSCRIPTIONS: "100",
    GOVERNANCE_BASELINE_ENABLED: "false",
  };
  if (config.identity.mode === "reuse") variables.AZURE_CLIENT_ID = config.identity.clientId;
  const body = {
    schemaVersion: "1.0.0" as const,
    config,
    evidenceHash,
    status: blockers.length === 0 ? ("pending" as const) : ("blocked" as const),
    ...(subject === undefined
      ? {}
      : {
          federation: {
            issuer: "https://token.actions.githubusercontent.com" as const,
            audience: "api://AzureADTokenExchange" as const,
            subject,
          },
        }),
    environment: "governance" as const,
    proposedRole: {
      id: "acdd72a7-3385-48ef-bd42-f606fba81ae7" as const,
      name: "Reader" as const,
      scope:
        config.managementGroupId === undefined
          ? `/subscriptions/${config.subscriptionId}`
          : `/providers/Microsoft.Management/managementGroups/${config.managementGroupId}`,
    },
    variables,
    blockers,
    pendingActions: [
      "Confirm the exact setup plan before any remote mutation.",
      config.identity.mode === "reuse"
        ? "Verify tenant, application and service-principal binding and existing grants."
        : "Create a dedicated application and service principal without client secrets after approval.",
      "Verify collection scope and inherited policy-definition read access; request administrator assistance for missing access.",
      "Review governance environment protections and permitted branches; preserve existing restrictions.",
      "Reconcile exact federation and Reader assignment without duplicates or overwriting conflicts.",
      "Verify the shipped collection workflow and repository permissions before configuring variables.",
      "After approval, enable collection and dispatch the first baseline review PR.",
      "Human baseline review and merge remain required before import; no deployment approval follows.",
    ],
    filesModified: false as const,
    executionAuthorized: false as const,
    deploymentAuthorized: false as const,
  };
  const plan = { ...body, planHash: calculatePolicyValidationDigest(body) };
  if (!Value.Check(GovernanceSetupPlanV1Schema, plan)) throw new TypeError("Invalid governance setup plan");
  return plan;
}
