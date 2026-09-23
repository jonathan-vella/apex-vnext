import { Value } from "@sinclair/typebox/value";
import {
  GovernanceSetupConfigV1Schema,
  GovernanceSetupPlanV1Schema,
  GovernanceProvisionPlanV1Schema,
  calculatePolicyValidationDigest,
  type GovernanceSetupConfigV1,
  type GovernanceSetupPlanV1,
  type GovernanceProvisionPlanV1,
} from "@apexops/contracts";

export interface GovernanceProvisionEvidence {
  account: unknown;
  application: unknown;
  principal: unknown;
  environment: unknown;
  readerRole: unknown;
  federations: unknown;
  assignments: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const sameId = (actual: unknown, expected: string) =>
  typeof actual === "string" && actual.toLowerCase() === expected.toLowerCase();

export function planGovernanceProvision(
  setup: GovernanceSetupPlanV1,
  evidence: GovernanceProvisionEvidence,
): GovernanceProvisionPlanV1 {
  setup = structuredClone(setup);
  if (!Value.Check(GovernanceSetupPlanV1Schema, setup)) throw new TypeError("Invalid governance setup plan");
  const { planHash, ...setupBody } = setup;
  if (calculatePolicyValidationDigest(setupBody) !== planHash)
    throw new TypeError("Governance setup plan digest differs");
  evidence = structuredClone(evidence);
  const evidenceHash = calculatePolicyValidationDigest(evidence);
  const { federations, assignments, ...context } = evidence;
  const contextHash = calculatePolicyValidationDigest({ setup, ...context });
  const blockers = [...setup.blockers];
  const actions: GovernanceProvisionPlanV1["actions"] = [];
  const federationName = `apex-governance-${calculatePolicyValidationDigest({ repository: setup.config.repository, subject: setup.federation?.subject ?? null }).slice(0, 24)}`;
  const account = record(evidence.account),
    application = record(evidence.application),
    principal = record(evidence.principal);
  const environment = record(evidence.environment),
    branches = record(environment.deployment_branch_policy);
  const role = record(evidence.readerRole);
  const appId = application.id;
  const validAppId = typeof appId === "string" && Value.Check(GovernanceSetupConfigV1Schema.properties.tenantId, appId);
  if (setup.config.identity.mode !== "reuse")
    blockers.push(
      "Dedicated identity creation requires a separate approved administrator operation; provide its verified client and principal IDs to provision trust.",
    );
  else {
    const identity = setup.config.identity;
    if (
      !sameId(account.tenantId, setup.config.tenantId) ||
      !sameId(account.id, setup.config.subscriptionId) ||
      account.state !== "Enabled" ||
      account.environmentName !== "AzureCloud"
    )
      blockers.push("The active Azure tenant or subscription differs from the approved setup target.");
    if (
      !validAppId ||
      !sameId(application.appId, identity.clientId) ||
      application.signInAudience !== "AzureADMyOrg" ||
      !sameId(principal.id, identity.principalId) ||
      !sameId(principal.appId, identity.clientId) ||
      !sameId(principal.appOwnerOrganizationId, setup.config.tenantId) ||
      principal.accountEnabled !== true ||
      principal.servicePrincipalType !== "Application"
    )
      blockers.push(
        "The reused single-tenant application and enabled service principal are not verified in the selected tenant.",
      );
  }
  const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
  if (
    environment.name !== "governance" ||
    branches.protected_branches !== true ||
    branches.custom_branch_policies !== false ||
    !rules.some(
      (rule) =>
        record(rule).type === "required_reviewers" &&
        record(rule).prevent_self_review === true &&
        Array.isArray(record(rule).reviewers) &&
        (record(rule).reviewers as unknown[]).length > 0,
    )
  )
    blockers.push(
      "An existing governance environment must require reviewers, prevent self-review, and allow protected branches only; configure protections administratively.",
    );
  const permissions = Array.isArray(role.permissions) ? role.permissions : [];
  const permission = record(permissions[0]);
  if (
    !sameId(role.name, setup.proposedRole.id) ||
    role.roleType !== "BuiltInRole" ||
    role.roleName !== "Reader" ||
    permissions.length !== 1 ||
    JSON.stringify(permission.actions) !== '["*/read"]' ||
    JSON.stringify(permission.notActions) !== "[]" ||
    JSON.stringify(permission.dataActions) !== "[]" ||
    JSON.stringify(permission.notDataActions) !== "[]"
  )
    blockers.push("The Reader role definition is missing or differs from its approved read-only permissions.");
  if (!Array.isArray(federations) || federations.length > 100)
    blockers.push("Federated credential inventory is missing or exceeds bounds.");
  else if (setup.federation !== undefined) {
    const matches = federations.filter((item) => {
      const credential = record(item);
      return (
        credential.issuer === setup.federation!.issuer &&
        credential.subject === setup.federation!.subject &&
        JSON.stringify(credential.audiences) === JSON.stringify([setup.federation!.audience])
      );
    });
    const collision = federations.some(
      (item) =>
        (record(item).name === federationName ||
          (record(item).issuer === setup.federation!.issuer && record(item).subject === setup.federation!.subject)) &&
        !matches.includes(item),
    );
    if (collision || matches.length > 1)
      blockers.push(
        "Existing federation conflicts with the proposed exact trust or is duplicated; no credential will be overwritten.",
      );
    else if (matches.length === 0) actions.push("create-federation");
  }
  if (!Array.isArray(assignments) || assignments.length > 1000)
    blockers.push("Role assignment inventory is missing or exceeds bounds.");
  else if (setup.config.identity.mode === "reuse") {
    const identity = setup.config.identity;
    const readerDefinition = new RegExp(
      `^/(?:subscriptions/[a-f0-9-]{36}/)?providers/microsoft\\.authorization/roledefinitions/${setup.proposedRole.id}$`,
      "i",
    );
    const unexpectedGrant = assignments.some((item) => {
      const assignment = record(item);
      return (
        !sameId(assignment.principalId, identity.principalId) ||
        typeof assignment.scope !== "string" ||
        assignment.scope.length === 0 ||
        typeof assignment.roleDefinitionId !== "string" ||
        !readerDefinition.test(assignment.roleDefinitionId) ||
        (assignment.condition !== undefined && assignment.condition !== null && assignment.condition !== "")
      );
    });
    if (unexpectedGrant)
      blockers.push(
        "Observed direct or inherited access is not exclusively unconditional Reader; review the identity's existing privileges before adding federation.",
      );
    const matches = assignments.filter((item) => {
      const assignment = record(item);
      return (
        sameId(assignment.principalId, identity.principalId) &&
        sameId(assignment.scope, setup.proposedRole.scope) &&
        typeof assignment.roleDefinitionId === "string" &&
        assignment.roleDefinitionId.toLowerCase().endsWith(`/roledefinitions/${setup.proposedRole.id}`) &&
        (assignment.condition === undefined || assignment.condition === null || assignment.condition === "")
      );
    });
    const constrained = assignments.some((item) => {
      const assignment = record(item);
      return (
        sameId(assignment.principalId, identity.principalId) &&
        sameId(assignment.scope, setup.proposedRole.scope) &&
        typeof assignment.roleDefinitionId === "string" &&
        assignment.roleDefinitionId.toLowerCase().endsWith(`/roledefinitions/${setup.proposedRole.id}`) &&
        assignment.condition !== undefined &&
        assignment.condition !== null &&
        assignment.condition !== ""
      );
    });
    if (constrained)
      blockers.push(
        "Existing constrained Reader access requires administrator review; no unconstrained duplicate will be created.",
      );
    else if (matches.length > 1) blockers.push("Duplicate exact Reader assignments require administrator review.");
    else if (matches.length === 0) actions.push("assign-reader");
  }
  const body = {
    schemaVersion: "1.0.0" as const,
    setup,
    contextHash,
    evidenceHash,
    status: blockers.length ? ("blocked" as const) : ("ready" as const),
    ...(validAppId ? { applicationObjectId: appId as string } : {}),
    federationName,
    actions: blockers.length ? [] : actions,
    blockers,
    executionAuthorized: false as const,
    deploymentAuthorized: false as const,
  };
  const plan = { ...body, planHash: calculatePolicyValidationDigest(body) };
  if (!Value.Check(GovernanceProvisionPlanV1Schema, plan)) throw new TypeError("Invalid governance provisioning plan");
  return plan;
}

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
