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
  remoteModules: 256,
  hookDependencies: 16,
} as const;

/**
 * Keys azd itself manages in `.azure/<env>/.env` and the only ones whose values (or hashes of them) are persisted.
 * Anything else is custom input: it belongs in the reviewed parameter file or the typed environment inputs, never in
 * the azd environment, because an unsalted digest of a low-entropy value would be enumerable offline.
 */
export const AZD_ENVIRONMENT_KEYS = [
  "AZURE_ENV_NAME",
  "AZURE_LOCATION",
  "AZURE_PRINCIPAL_ID",
  "AZURE_PRINCIPAL_TYPE",
  "AZURE_RESOURCE_GROUP",
  "AZURE_SUBSCRIPTION_ID",
  "AZURE_TENANT_ID",
] as const;

/** The Microsoft public Bicep registry; its tags are immutable. */
export const AZD_PUBLIC_BICEP_REGISTRY = "mcr.microsoft.com";
export const AZD_EXACT_TAG_PATTERN =
  "^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,63})?$";

/** Exact azd release, for example `1.35.1`; ranges and pre-releases are not binding material. */
export const AzdVersionSchema = Type.String({ pattern: "^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)$" });

/** Project-relative POSIX path without empty, `.` or `..` segments. */
export const AzdRelativePathSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^(?!(?:.*/)?\\.{1,2}(?:/|$))[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$",
});

const AzdNameSchema = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" });

const AzdFileDigestSchema = Type.Object(
  { path: AzdRelativePathSchema, hash: Sha256Schema },
  { additionalProperties: false },
);

export const AzdHookV1Schema = Type.Object(
  {
    scope: Type.String({ pattern: "^(?:project|(?:service|layer):[A-Za-z0-9][A-Za-z0-9._-]{0,63})$" }),
    event: Type.String({ pattern: "^(?:pre|post)[a-z]{2,16}$" }),
    /** Zero-based position among the hooks declared for the same scope and event. */
    order: Type.Integer({ minimum: 0, maximum: 31 }),
    platform: Type.Union([Type.Literal("all"), Type.Literal("windows"), Type.Literal("posix")]),
    shell: Type.Union([Type.Literal("sh"), Type.Literal("pwsh")]),
    source: Type.Union([Type.Literal("script"), Type.Literal("inline")]),
    /** Interpreter of a `<interpreter> <script> [args]` command; absent for a bare script path or inline text. */
    interpreter: Type.Optional(
      Type.Union([
        Type.Literal("sh"),
        Type.Literal("bash"),
        Type.Literal("zsh"),
        Type.Literal("pwsh"),
        Type.Literal("powershell"),
        Type.Literal("cmd"),
      ]),
    ),
    path: Type.Optional(AzdRelativePathSchema),
    workingDirectory: Type.Optional(AzdRelativePathSchema),
    /** SHA-256 of the script file bytes, or of the UTF-8 inline script text. */
    contentHash: Sha256Schema,
    /** SHA-256 of the exact `run` text, so changed arguments or interpreters invalidate the binding. */
    commandHash: Sha256Schema,
    /** Project-contained files the hook loads (sourced, dot-sourced, imported or run), each hashed. */
    dependencies: Type.Array(AzdFileDigestSchema, { maxItems: AZD_BINDING_LIMITS.hookDependencies }),
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
    /**
     * Digest of the installed extension that the executor observed in its isolated azd configuration directory. The
     * binding is only valid when the installed extension still matches it at preflight.
     */
    installedDigest: Sha256Schema,
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

const AzdEnvironmentKeySchema = Type.Union(AZD_ENVIRONMENT_KEYS.map((key) => Type.Literal(key)));

export const AZD_AZURE_CLOUDS = ["AzureCloud", "AzureUSGovernment", "AzureChinaCloud"] as const;

const AZD_HOME_VARIABLES = ["HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE"] as const;

export const AzdEnvironmentV1Schema = Type.Object(
  {
    name: EnvironmentSchema,
    target: Type.Object(
      {
        subscriptionId: Type.String({
          pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        }),
        location: Type.String({ pattern: "^[a-z0-9]{2,64}$" }),
        /** Required: the identity preflight compares the signed-in tenant with it. */
        tenantId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
        resourceGroup: Type.Optional(Type.String({ minLength: 1, maxLength: 90 })),
      },
      { additionalProperties: false },
    ),
    /** Allowlisted azd-managed keys present in the environment; no other key can exist. */
    keys: Type.Array(AzdEnvironmentKeySchema, { uniqueItems: true, maxItems: AZD_ENVIRONMENT_KEYS.length }),
    /** Digest over the allowlisted key/value pairs only; custom values are refused, never hashed. */
    valuesHash: Sha256Schema,
    /** Digest of `.azure/<name>/config.json`, which azd consults for stored parameter values; only `{}` is accepted. */
    configHash: Type.Optional(Sha256Schema),
    /** Digest of `.azure/config.json` (azd's default environment pointer). */
    projectConfigHash: Type.Optional(Sha256Schema),
  },
  { additionalProperties: false },
);

/** Immutable Bicep module reference found in the infrastructure tree. */
export const AzdRemoteModuleV1Schema = Type.Object(
  {
    root: AzdNameSchema,
    file: AzdRelativePathSchema,
    kind: Type.Union([Type.Literal("br"), Type.Literal("ts")]),
    /** The reference exactly as written in the Bicep file. */
    reference: Type.String({ minLength: 1, maxLength: 512 }),
    /** Registry host for `br`; `<subscriptionId>/<resourceGroup>` for `ts`. */
    registry: Type.String({ minLength: 1, maxLength: 256 }),
    path: Type.String({ minLength: 1, maxLength: 256 }),
    pin: Type.Union([
      Type.Object(
        { type: Type.Literal("tag"), value: Type.String({ pattern: AZD_EXACT_TAG_PATTERN }) },
        { additionalProperties: false },
      ),
      Type.Object({ type: Type.Literal("digest"), value: Sha256Schema }, { additionalProperties: false }),
      Type.Object(
        { type: Type.Literal("version"), value: Type.String({ minLength: 1, maxLength: 64 }) },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);

/**
 * How the executor must run azd so that nothing outside the binding changes what it does. Policy only: the executor
 * supplies the concrete run-scoped directories and parent environment to `buildAzdExecutionEnvelope`'s helpers.
 */
export const AzdExecutionEnvelopeV1Schema = Type.Object(
  {
    workingDirectory: Type.Literal("project-root"),
    /** Passed explicitly with `--environment`; the default-environment pointer is never consulted. */
    environmentName: EnvironmentSchema,
    prompts: Type.Literal("disabled"),
    /** The only variables copied from the parent process; never `AZURE_*` or `AZD_*`. */
    inheritedEnvironment: Type.Array(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]{0,63}$" }), {
      uniqueItems: true,
      maxItems: 24,
    }),
    fixedEnvironment: Type.Object(
      { AZD_SKIP_UPDATE_CHECK: Type.Literal("true"), AZURE_DEV_COLLECT_TELEMETRY: Type.Literal("no") },
      { additionalProperties: false },
    ),
    /** `AZD_CONFIG_DIR` is a run-scoped directory, so user-level azd config, sources and extensions are never read. */
    azdConfigDirectory: Type.Literal("isolated"),
    /**
     * `inherited-user-default`: Azure CLI state (cloud, accounts, default subscription, extensions) comes from the
     * user's own configuration, so it is ambient and only checked by `identityPreflight`. `isolated-directory`: the
     * executor supplies a run-scoped `AZURE_CONFIG_DIR` holding exactly the sign-in the run needs; CI and production
     * executors must use it.
     */
    azureCliState: Type.Union([Type.Literal("inherited-user-default"), Type.Literal("isolated-directory")]),
    /** Whether the user's home directory variables (HOME, USERPROFILE, ...) reach azd and its hooks. */
    userHome: Type.Union([Type.Literal("inherited"), Type.Literal("withheld")]),
    /** The executor must observe exactly this identity before provisioning and stop on any difference. */
    identityPreflight: Type.Object(
      {
        cloud: Type.Union(AZD_AZURE_CLOUDS.map((cloud) => Type.Literal(cloud))),
        tenantId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
        subscriptionId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
        onMismatch: Type.Literal("stop"),
      },
      { additionalProperties: false },
    ),
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
    remoteModules: Type.Array(AzdRemoteModuleV1Schema, { maxItems: AZD_BINDING_LIMITS.remoteModules }),
    executionEnvelope: AzdExecutionEnvelopeV1Schema,
    bindingHash: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/azd-binding-v1.json", additionalProperties: false },
);

export type AzdHookV1 = Static<typeof AzdHookV1Schema>;
export type AzdExtensionV1 = Static<typeof AzdExtensionV1Schema>;
export type AzdInfraRootV1 = Static<typeof AzdInfraRootV1Schema>;
export type AzdEnvironmentV1 = Static<typeof AzdEnvironmentV1Schema>;
export type AzdRemoteModuleV1 = Static<typeof AzdRemoteModuleV1Schema>;
export type AzdExecutionEnvelopeV1 = Static<typeof AzdExecutionEnvelopeV1Schema>;
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

function hasValidRemoteModules(binding: Omit<AzdBindingV1, "bindingHash">): boolean {
  const roots = new Set(binding.infra.roots.map(({ name }) => name));
  const exact = new RegExp(AZD_EXACT_TAG_PATTERN, "u");
  const keys: string[] = [];
  for (const module of binding.remoteModules) {
    if (!roots.has(module.root)) return false;
    keys.push(`${module.root}\n${module.file}\n${module.reference}`);
    const { pin } = module;
    if (module.kind === "ts") {
      if (pin.type !== "version") return false;
    } else if (pin.type === "version") return false;
    else if (pin.type === "tag") {
      // Only the Microsoft public registry has immutable tags; every other registry must pin a digest.
      if (module.registry !== AZD_PUBLIC_BICEP_REGISTRY || !module.path.startsWith("bicep/") || !exact.test(pin.value))
        return false;
    }
  }
  return unique(keys);
}

function hasValidEnvelope(binding: Omit<AzdBindingV1, "bindingHash">): boolean {
  const envelope = binding.executionEnvelope;
  const homeInherited = envelope.inheritedEnvironment.some((name) =>
    AZD_HOME_VARIABLES.some((home) => home.toLowerCase() === name.toLowerCase()),
  );
  const target = binding.environment.target;
  return (
    envelope.environmentName === binding.environment.name &&
    !envelope.inheritedEnvironment.some((name) => /^(?:AZURE|AZD)_/iu.test(name)) &&
    (envelope.azureCliState === "inherited-user-default") === (envelope.userHome === "inherited") &&
    (envelope.userHome === "inherited") === homeInherited &&
    envelope.identityPreflight.subscriptionId === target.subscriptionId &&
    envelope.identityPreflight.tenantId === target.tenantId
  );
}

/** Schema, structural-uniqueness and self-hash check for a persisted azd binding. */
export function hasValidAzdBinding(value: unknown): value is AzdBindingV1 {
  try {
    if (!Value.Check(AzdBindingV1Schema, value)) return false;
    const { bindingHash, ...binding } = value;
    if (!hasValidInfra(binding.infra, binding.hooks)) return false;
    if (!hasValidRemoteModules(binding) || !hasValidEnvelope(binding)) return false;
    if (binding.hooks.some((hook) => !unique(hook.dependencies.map(({ path }) => path)))) return false;
    if (binding.hooks.some((hook) => hook.interpreter !== undefined && hook.source !== "script")) return false;
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
