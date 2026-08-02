import { Type, type Static } from "@sinclair/typebox";
import {
  ContractVersionSchema,
  EnvironmentSchema,
  IacToolSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
} from "./common.js";

export const BootstrapClientSchema = Type.Union([
  Type.Literal("github-copilot-vscode"),
  Type.Literal("github-copilot-cli"),
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
