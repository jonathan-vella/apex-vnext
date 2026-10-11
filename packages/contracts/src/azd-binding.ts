import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ContractVersionSchema,
  EnvironmentSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
  Sha256Schema,
} from "./common.js";
import { calculatePolicyValidationDigest } from "./policy-validation.js";

export const AZD_BINDING_LIMITS = {
  roots: 16,
  hooks: 128,
  extensions: 32,
  environmentKeys: 256,
} as const;

/** Exact azd release, for example `1.35.1`; ranges and pre-releases are not binding material. */
export const AzdVersionSchema = Type.String({ pattern: "^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)$" });

/** Project-relative POSIX path without empty, `.` or `..` segments. */
export const AzdRelativePathSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^(?!(?:.*/)?\\.{1,2}(?:/|$))[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$",
});

const AzdNameSchema = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" });

export const AzdHookV1Schema = Type.Object(
  {
    scope: Type.String({ pattern: "^(?:project|(?:service|layer):[A-Za-z0-9][A-Za-z0-9._-]{0,63})$" }),
    event: Type.String({ pattern: "^(?:pre|post)[a-z]{2,16}$" }),
    /** Zero-based position among the hooks declared for the same scope and event. */
    order: Type.Integer({ minimum: 0, maximum: 31 }),
    platform: Type.Union([Type.Literal("all"), Type.Literal("windows"), Type.Literal("posix")]),
    shell: Type.Union([Type.Literal("sh"), Type.Literal("pwsh")]),
    source: Type.Union([Type.Literal("script"), Type.Literal("inline")]),
    path: Type.Optional(AzdRelativePathSchema),
    workingDirectory: Type.Optional(AzdRelativePathSchema),
    /** SHA-256 of the script file bytes, or of the UTF-8 inline script text. */
    contentHash: Sha256Schema,
    continueOnError: Type.Boolean(),
    interactive: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AzdExtensionV1Schema = Type.Object(
  {
    id: Type.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,127}$" }),
    version: AzdVersionSchema,
    /** Only azd's pre-configured official registry is accepted; custom registries are unsupported. */
    source: Type.Literal("azd"),
  },
  { additionalProperties: false },
);

export const AzdInfraRootV1Schema = Type.Object(
  {
    /** `default` for an unlayered project, otherwise the declared layer name. */
    name: AzdNameSchema,
    path: AzdRelativePathSchema,
    module: AzdNameSchema,
    provider: Type.Literal("bicep"),
    dependsOn: Type.Array(AzdNameSchema, { uniqueItems: true, maxItems: AZD_BINDING_LIMITS.roots }),
    /** Digest of every file under `path`, so azd's recompilation sees the accepted source. */
    treeHash: Sha256Schema,
    parametersPath: Type.Optional(AzdRelativePathSchema),
    parametersFileHash: Type.Optional(Sha256Schema),
    /** Digest of the parameter object after azd environment substitution. */
    resolvedParametersHash: Sha256Schema,
  },
  { additionalProperties: false },
);

export const AzdEnvironmentV1Schema = Type.Object(
  {
    name: EnvironmentSchema,
    target: Type.Object(
      {
        subscriptionId: Type.String({
          pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        }),
        location: Type.String({ pattern: "^[a-z0-9]{2,64}$" }),
        tenantId: Type.Optional(
          Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
        ),
        resourceGroup: Type.Optional(Type.String({ minLength: 1, maxLength: 90 })),
      },
      { additionalProperties: false },
    ),
    /** Names only; values are hashed and never persisted. */
    keys: Type.Array(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]{0,127}$" }), {
      uniqueItems: true,
      maxItems: AZD_BINDING_LIMITS.environmentKeys,
    }),
    valuesHash: Sha256Schema,
    /** Digest of `.azure/<name>/config.json`, which azd consults for stored parameter values. */
    configHash: Type.Optional(Sha256Schema),
  },
  { additionalProperties: false },
);

export const AzdBindingV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    track: Type.Literal("bicep"),
    executor: Type.Literal("azd"),
    azdVersion: AzdVersionSchema,
    projectName: NonEmptyStringSchema,
    /** Digest of the exact `azure.yaml` bytes. */
    configHash: Sha256Schema,
    infra: Type.Object(
      {
        provider: Type.Literal("bicep"),
        layered: Type.Boolean(),
        roots: Type.Array(AzdInfraRootV1Schema, { minItems: 1, maxItems: AZD_BINDING_LIMITS.roots }),
      },
      { additionalProperties: false },
    ),
    environment: AzdEnvironmentV1Schema,
    parametersHash: Sha256Schema,
    hooks: Type.Array(AzdHookV1Schema, { maxItems: AZD_BINDING_LIMITS.hooks }),
    extensions: Type.Array(AzdExtensionV1Schema, { maxItems: AZD_BINDING_LIMITS.extensions }),
    bindingHash: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/azd-binding-v1.json", additionalProperties: false },
);

export type AzdHookV1 = Static<typeof AzdHookV1Schema>;
export type AzdExtensionV1 = Static<typeof AzdExtensionV1Schema>;
export type AzdInfraRootV1 = Static<typeof AzdInfraRootV1Schema>;
export type AzdEnvironmentV1 = Static<typeof AzdEnvironmentV1Schema>;
export type AzdBindingV1 = Static<typeof AzdBindingV1Schema>;

export function calculateAzdBindingHash(binding: Omit<AzdBindingV1, "bindingHash">): string {
  return calculatePolicyValidationDigest(binding);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasValidInfra(infra: AzdBindingV1["infra"], hooks: AzdBindingV1["hooks"]): boolean {
  const roots = infra.roots;
  const names = roots.map(({ name }) => name);
  // Producers compare names and paths case-insensitively, so a persisted binding must too.
  if (!unique(names.map((name) => name.toLowerCase())) || !unique(roots.map(({ path }) => path.toLowerCase())))
    return false;
  if (infra.layered === (names.length === 1 && names[0] === "default")) return false;
  const dependencies = new Map(roots.map((root) => [root.name, root.dependsOn]));
  for (const root of roots) {
    if (root.dependsOn.some((name) => name === root.name || !dependencies.has(name))) return false;
    if ((root.parametersPath === undefined) !== (root.parametersFileHash === undefined)) return false;
    if (root.parametersPath !== undefined && root.parametersPath !== `${root.path}/${root.module}.parameters.json`)
      return false;
  }
  const state = new Map<string, "visiting" | "done">();
  const cyclic = (name: string): boolean => {
    if (state.get(name) === "done") return false;
    if (state.get(name) === "visiting") return true;
    state.set(name, "visiting");
    if ((dependencies.get(name) ?? []).some(cyclic)) return true;
    state.set(name, "done");
    return false;
  };
  if (names.some(cyclic)) return false;
  return hooks.every(
    (hook) => !hook.scope.startsWith("layer:") || (infra.layered && names.includes(hook.scope.slice("layer:".length))),
  );
}

/** Schema, structural-uniqueness and self-hash check for a persisted azd binding. */
export function hasValidAzdBinding(value: unknown): value is AzdBindingV1 {
  try {
    if (!Value.Check(AzdBindingV1Schema, value)) return false;
    const { bindingHash, ...binding } = value;
    if (!hasValidInfra(binding.infra, binding.hooks)) return false;
    if (!unique(binding.extensions.map(({ id }) => id))) return false;
    if (!unique(binding.environment.keys)) return false;
    if (!unique(binding.hooks.map((hook) => `${hook.scope}\n${hook.event}\n${hook.platform}\n${hook.order}`)))
      return false;
    if (binding.hooks.some((hook) => (hook.source === "script") !== (hook.path !== undefined))) return false;
    return bindingHash === calculateAzdBindingHash(binding);
  } catch {
    return false;
  }
}
