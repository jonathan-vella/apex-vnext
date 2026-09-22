import { Type, type Static } from "@sinclair/typebox";
import {
  ContractVersionSchema,
  EnvironmentSchema,
  IacToolSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  Sha256Schema,
} from "./common.js";

export const BootstrapClientSchema = Type.Union([
  Type.Literal("github-copilot-vscode"),
  Type.Literal("github-copilot-cli"),
  Type.Literal("both"),
]);

export const OnboardingConfigV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    displayName: Type.Optional(NonEmptyStringSchema),
    client: Type.Optional(BootstrapClientSchema),
    environment: Type.Optional(EnvironmentSchema),
    targetScope: Type.Optional(NonEmptyStringSchema),
    iacTool: Type.Optional(IacToolSchema),
    createRepository: Type.Optional(Type.Boolean()),
  },
  { $id: "https://schemas.apexops.dev/onboarding-config-v1.json", additionalProperties: false },
);

export type BootstrapClient = Static<typeof BootstrapClientSchema>;
export type OnboardingConfigV1 = Static<typeof OnboardingConfigV1Schema>;

export const BootstrapPlanV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    config: OnboardingConfigV1Schema,
    configHash: Sha256Schema,
    runtimeVersion: NonEmptyStringSchema,
    scope: Type.Literal("local-bootstrap-preflight-v1"),
    status: Type.Union([Type.Literal("ready"), Type.Literal("pending"), Type.Literal("blocked")]),
    checks: Type.Array(
      Type.Object(
        {
          id: Type.Union([Type.Literal("repository"), Type.Literal("workspace-runtime"), Type.Literal("apex-state")]),
          status: Type.Union([Type.Literal("ready"), Type.Literal("pending"), Type.Literal("blocked")]),
          reason: Type.String({ minLength: 1, maxLength: 1024 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 3, maxItems: 3 },
    ),
    unassessed: Type.Tuple([
      Type.Literal("machine-prerequisites"),
      Type.Literal("client-health"),
      Type.Literal("remote-coe"),
      Type.Literal("github-repository"),
      Type.Literal("governance-oidc"),
      Type.Literal("reviewed-baseline"),
    ]),
    filesModified: Type.Literal(false),
    executionAuthorized: Type.Literal(false),
  },
  { $id: "https://schemas.apexops.dev/bootstrap-plan-v1.json", additionalProperties: false },
);

export type BootstrapPlanV1 = Static<typeof BootstrapPlanV1Schema>;

const AzureId = Type.String({
  pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$(?![\\s\\S])",
});
export const GovernanceSetupConfigV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    repository: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$(?![\\s\\S])" }),
    tenantId: AzureId,
    subscriptionId: AzureId,
    managementGroupId: Type.Optional(
      Type.String({ pattern: "^[A-Za-z0-9](?:[A-Za-z0-9_().-]{0,88}[A-Za-z0-9_()-])?$(?![\\s\\S])" }),
    ),
    identity: Type.Union([
      Type.Object(
        { mode: Type.Literal("reuse"), clientId: AzureId, principalId: AzureId },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          mode: Type.Literal("create"),
          displayName: Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,79}$(?![\\s\\S])" }),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  { $id: "https://schemas.apexops.dev/governance-setup-config-v1.json", additionalProperties: false },
);
export type GovernanceSetupConfigV1 = Static<typeof GovernanceSetupConfigV1Schema>;

export const GovernanceSetupPlanV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    config: GovernanceSetupConfigV1Schema,
    evidenceHash: Sha256Schema,
    status: Type.Union([Type.Literal("pending"), Type.Literal("blocked")]),
    federation: Type.Optional(
      Type.Object(
        {
          issuer: Type.Literal("https://token.actions.githubusercontent.com"),
          audience: Type.Literal("api://AzureADTokenExchange"),
          subject: Type.String({ minLength: 1, maxLength: 512 }),
        },
        { additionalProperties: false },
      ),
    ),
    environment: Type.Literal("governance"),
    proposedRole: Type.Object(
      {
        id: Type.Literal("acdd72a7-3385-48ef-bd42-f606fba81ae7"),
        name: Type.Literal("Reader"),
        scope: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
    variables: Type.Record(Type.String({ pattern: "^[A-Z_]+$" }), Type.String({ maxLength: 256 })),
    blockers: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 16 }),
    pendingActions: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 16 }),
    filesModified: Type.Literal(false),
    executionAuthorized: Type.Literal(false),
    deploymentAuthorized: Type.Literal(false),
    planHash: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/governance-setup-plan-v1.json", additionalProperties: false },
);
export type GovernanceSetupPlanV1 = Static<typeof GovernanceSetupPlanV1Schema>;

export const GovernanceProvisionPlanV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    setup: GovernanceSetupPlanV1Schema,
    contextHash: Sha256Schema,
    evidenceHash: Sha256Schema,
    planHash: Sha256Schema,
    status: Type.Union([Type.Literal("ready"), Type.Literal("blocked")]),
    applicationObjectId: Type.Optional(AzureId),
    federationName: Type.String({ pattern: "^apex-governance-[a-f0-9]{24}$" }),
    actions: Type.Array(Type.Union([Type.Literal("create-federation"), Type.Literal("assign-reader")]), {
      maxItems: 2,
      uniqueItems: true,
    }),
    blockers: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 16 }),
    executionAuthorized: Type.Literal(false),
    deploymentAuthorized: Type.Literal(false),
  },
  { $id: "https://schemas.apexops.dev/governance-provision-plan-v1.json", additionalProperties: false },
);
export type GovernanceProvisionPlanV1 = Static<typeof GovernanceProvisionPlanV1Schema>;
