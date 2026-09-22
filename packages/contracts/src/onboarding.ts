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
