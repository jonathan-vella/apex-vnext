import { load } from "js-yaml";
import {
  calculateAzdBindingHash,
  calculatePolicyValidationDigest,
  CONTRACT_VERSION,
  EnvironmentSchema,
  AzdEnvironmentV1Schema,
  AzdVersionSchema,
  hasValidAzdBinding,
  SECRET_FIELD_PATTERN,
  SECRET_VALUE_PATTERN,
  type AzdBindingV1,
  type AzdEnvironmentV1,
  type AzdHookV1,
  type AzdInfraRootV1,
} from "@apexops/contracts";
import { Value } from "@sinclair/typebox/value";
import { satisfiesAzdVersionConstraint } from "./azd-prerequisites.js";
import {
  AZD_FILE_LIMITS,
  AzdBindingError,
  AzdProjectFiles,
  sha256Hex,
  type AzdBindingErrorCode,
} from "./azd-project-files.js";

export interface AzdBindingTarget {
  readonly subscriptionId: string;
  readonly location: string;
  /** Needed when the environment records AZURE_TENANT_ID; any tenant recorded without an approved one is a mismatch. */
  readonly tenantId?: string;
  /**
   * The approved resource group. Omit only for subscription-scope deployments; a resource group declared by
   * azure.yaml then counts as a redirect.
   */
  readonly resourceGroup?: string;
}

export interface AzdBindingRequest {
  readonly projectId: string;
  readonly runId: string;
  /** Absolute directory containing `azure.yaml` and `.azure/<environmentName>/`. */
  readonly projectRoot: string;
  readonly environmentName: string;
  /** Exact azd release that will execute; the caller has already verified the installed binary reports it. */
  readonly azdVersion: string;
  readonly target: AzdBindingTarget;
}

const PROJECT_HOOK_EVENTS: ReadonlySet<string> = new Set([
  "preprovision",
  "postprovision",
  "preinfracreate",
  "postinfracreate",
  "preinfradelete",
  "postinfradelete",
  "predown",
  "postdown",
  "preup",
  "postup",
  "prepackage",
  "postpackage",
  "prepublish",
  "postpublish",
  "predeploy",
  "postdeploy",
  "prerestore",
  "postrestore",
]);
const SERVICE_HOOK_EVENTS: ReadonlySet<string> = new Set([
  "predeploy",
  "postdeploy",
  "prerestore",
  "postrestore",
  "prebuild",
  "postbuild",
  "prepackage",
  "postpackage",
  "prepublish",
  "postpublish",
]);
const LAYER_HOOK_EVENTS: ReadonlySet<string> = new Set(["preprovision", "postprovision"]);
const HOOK_FIELDS = ["shell", "kind", "dir", "run", "continueOnError", "interactive", "secrets", "config"] as const;
const TOP_LEVEL_KEYS = [
  "name",
  "metadata",
  "infra",
  "services",
  "hooks",
  "requiredVersions",
  "pipeline",
  "workflows",
  "resourceGroup",
] as const;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const RELATIVE_SEGMENT = /^[A-Za-z0-9._-]+$/u;
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([".", "..", ".azure", ".git"]);
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const EXACT_VERSION = /^=?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;
// Hook scripts may span lines; only characters that no shell treats as text are rejected.
// eslint-disable-next-line no-control-regex
const SCRIPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_ENV_ENTRIES = 256;
const MAX_ENV_VALUE = 4096;
const MAX_HOOKS_PER_EVENT = 32;

/**
 * Best-effort detection of hooks that run further azd operations or move the target. A hook is arbitrary code, so this
 * is not a sandbox: approval material still warns that hooks can act beyond the what-if.
 */
const UNBOUND_MUTATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\bazd(?:\.exe)?["']?\s+(?:up|deploy|provision|down|package|publish|restore|init|pipeline|extension|ext|config|auth|add|infra|hooks|template|mcp|x)\b/iu,
    "runs another azd operation",
  ],
  // Any environment write can change a value the binding hashed or a ${NAME} parameter after the preview.
  [
    /\bazd(?:\.exe)?["']?\s+env\s+(?:set|set-secret|new|select|remove|rm|refresh|config)\b/iu,
    "changes the azd environment",
  ],
  [/\.azure[\\/]/u, "touches the azd environment files directly (read values with azd env get-value)"],
  [/\baz(?:\.cmd)?\s+account\s+set\b/iu, "redirects the Azure subscription"],
];

function fail(code: AzdBindingErrorCode, message: string): never {
  throw new AzdBindingError(code, message);
}

function plain(value: unknown, context: string, code: AzdBindingErrorCode): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${context} must be a mapping`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).includes("__proto__")) fail(code, `${context} contains a reserved key`);
  return result;
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
  code: AzdBindingErrorCode,
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(code, `${context} declares unsupported setting '${safeKey(key)}'`);
}

function safeKey(key: string): string {
  return /^[A-Za-z0-9._-]{1,48}$/u.test(key) ? key : "(unprintable)";
}

function text(value: unknown, context: string, code: AzdBindingErrorCode, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL.test(value))
    fail(code, `${context} must be a non-empty single-line string of at most ${max} characters`);
  return value;
}

function moduleName(value: unknown, context: string, code: AzdBindingErrorCode): string {
  const name = text(value, context, code, 64);
  if (!NAME.test(name)) fail(code, `${context} must be a bare module name without path separators`);
  return name;
}

function bool(value: unknown, fallback: boolean, context: string, code: AzdBindingErrorCode): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(code, `${context} must be true or false`);
  return value;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Normalizes a project-relative POSIX path; returns undefined for anything that could leave the project. */
function relativePath(value: string): string | undefined {
  const trimmed = value.startsWith("./") ? value.slice(2) : value;
  if (trimmed.length === 0 || trimmed.length > 512) return undefined;
  const segments = trimmed.split("/");
  const valid = segments.every(
    (segment) => RELATIVE_SEGMENT.test(segment) && !RESERVED_SEGMENTS.has(segment.toLowerCase()),
  );
  return valid ? segments.join("/") : undefined;
}

function projectPath(value: unknown, context: string, code: AzdBindingErrorCode = "AZD_PATH_UNSAFE"): string {
  const path = relativePath(text(value, context, code, 512));
  if (path === undefined)
    fail(code, `${context} must be a project-relative path without links, '..' or protected folders`);
  return path;
}

function parseYaml(bytes: Buffer): Record<string, unknown> {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("AZD_YAML_INVALID", "azure.yaml is not valid UTF-8");
  }
  let document: unknown;
  try {
    document = load(source, { maxAliases: 0, maxDepth: 24 });
  } catch {
    return fail("AZD_YAML_INVALID", "azure.yaml is not a single plain YAML document (aliases are not supported)");
  }
  return plain(assertPlainYaml(document), "azure.yaml", "AZD_YAML_INVALID");
}

/**
 * azd's YAML parser honors merge keys that js-yaml's core schema reads as an ordinary key, which would hide hooks from
 * the inventory, so any merge key is refused along with unbounded documents.
 */
function assertPlainYaml(document: unknown): unknown {
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 10_000 || depth > 24) fail("AZD_YAML_INVALID", "azure.yaml is too large or deeply nested");
    if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
    else if (value !== null && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (key === "<<" || key === "__proto__") fail("AZD_YAML_INVALID", "azure.yaml uses a merge or reserved key");
        visit(child, depth + 1);
      }
  };
  visit(document, 0);
  return document;
}

interface DotenvResult {
  readonly values: ReadonlyMap<string, string>;
}

function parseDotenv(source: string): DotenvResult {
  const lines = source.split(/\r?\n/u);
  if (lines.length > MAX_ENV_ENTRIES * 4) fail("AZD_ENV_INVALID", "The azd environment file has too many lines");
  const values = new Map<string, string>();
  for (const [index, raw] of lines.entries()) {
    const label = `line ${index + 1}`;
    if (raw.trim().length === 0 || raw.trim().startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]{0,127})=(.*)$/u.exec(raw);
    if (match === null) fail("AZD_ENV_INVALID", `The azd environment file has an unsupported ${label}`);
    const key = match[1]!;
    const rest = match[2]!;
    let value: string;
    if (rest.startsWith('"')) {
      let parsed = "";
      let position = 1;
      let closed = false;
      while (position < rest.length) {
        const char = rest[position]!;
        if (char === '"') {
          closed = true;
          position += 1;
          break;
        }
        if (char === "\\") {
          const next = rest[position + 1];
          if (next !== '"' && next !== "\\")
            fail("AZD_ENV_INVALID", `The azd environment file has an unsupported escape on ${label}`);
          parsed += next;
          position += 2;
          continue;
        }
        parsed += char;
        position += 1;
      }
      if (!closed || rest.slice(position).trim().length > 0)
        fail("AZD_ENV_INVALID", `The azd environment file has an unterminated or trailing value on ${label}`);
      value = parsed;
    } else if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      if (end === -1 || rest.slice(end + 1).trim().length > 0)
        fail("AZD_ENV_INVALID", `The azd environment file has an unterminated or trailing value on ${label}`);
      value = rest.slice(1, end);
    } else {
      if (!/^[^\s"'#$`\\]*$/u.test(rest))
        fail("AZD_ENV_INVALID", `The azd environment file has an ambiguous unquoted value on ${label}`);
      value = rest;
    }
    // azd expands variables in values and falls back to the process environment, which cannot be bound.
    if (value.includes("$") || CONTROL.test(value) || value.length > MAX_ENV_VALUE)
      fail(
        "AZD_ENV_INVALID",
        `The azd environment value on ${label} uses expansion, control characters or exceeds its limit`,
      );
    if (values.has(key)) fail("AZD_ENV_INVALID", `The azd environment file repeats ${key}`);
    values.set(key, value);
    if (values.size > MAX_ENV_ENTRIES) fail("AZD_ENV_INVALID", "The azd environment file has too many entries");
  }
  return { values };
}

function assertNoSecrets(values: ReadonlyMap<string, string>): void {
  for (const [key, value] of values)
    if (SECRET_FIELD_PATTERN.test(key) || SECRET_VALUE_PATTERN.test(value))
      fail(
        "AZD_ENV_SECRET",
        `The azd environment holds a secret-like entry (${key}); secrets cannot be bound or persisted, so keep them in Key Vault`,
      );
}

function assertConfigHasNoSecrets(value: unknown, depth = 0): void {
  if (depth > 16) fail("AZD_ENV_INVALID", "The azd environment config is nested too deeply");
  if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value))
    fail("AZD_ENV_SECRET", "The azd environment config holds a secret-like value");
  if (Array.isArray(value)) for (const item of value) assertConfigHasNoSecrets(item, depth + 1);
  else if (value !== null && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_FIELD_PATTERN.test(key))
        fail("AZD_ENV_SECRET", `The azd environment config holds a secret-like entry (${safeKey(key)})`);
      assertConfigHasNoSecrets(child, depth + 1);
    }
}

function sameText(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase();
}

function assertTarget(values: ReadonlyMap<string, string>, request: AzdBindingRequest): void {
  const redirect = (name: string): never =>
    fail("AZD_ENV_TARGET_MISMATCH", `The azd environment ${name} does not match the approved target`);
  if (values.get("AZURE_ENV_NAME") !== request.environmentName) redirect("AZURE_ENV_NAME");
  if (!sameText(values.get("AZURE_SUBSCRIPTION_ID"), request.target.subscriptionId)) redirect("AZURE_SUBSCRIPTION_ID");
  if (!sameText(values.get("AZURE_LOCATION"), request.target.location)) redirect("AZURE_LOCATION");
  const tenant = values.get("AZURE_TENANT_ID");
  if (tenant !== undefined && !sameText(tenant, request.target.tenantId)) redirect("AZURE_TENANT_ID");
  const group = values.get("AZURE_RESOURCE_GROUP");
  // Without an approved resource group (subscription scope) azd records the group it created here as an output.
  if (
    request.target.resourceGroup !== undefined &&
    group !== undefined &&
    !sameText(group, request.target.resourceGroup)
  )
    redirect("AZURE_RESOURCE_GROUP");
}

function assertDeclaredGroup(value: unknown, request: AzdBindingRequest, context: string): void {
  if (value === undefined) return;
  const group = text(value, context, "AZD_PROJECT_UNSUPPORTED");
  if (!sameText(group, request.target.resourceGroup))
    fail("AZD_ENV_TARGET_MISMATCH", `${context} redirects the deployment away from the approved resource group`);
}

async function inventoryEnvironment(
  files: AzdProjectFiles,
  request: AzdBindingRequest,
): Promise<{ environment: AzdEnvironmentV1; values: ReadonlyMap<string, string> }> {
  const directory = `.azure/${request.environmentName}`;
  const bytes = await files.read(`${directory}/.env`, AZD_FILE_LIMITS.fileBytes, "AZD_ENV_MISSING");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("AZD_ENV_INVALID", "The azd environment file is not valid UTF-8");
  }
  const { values } = parseDotenv(source);
  assertNoSecrets(values);
  assertTarget(values, request);
  let configHash: string | undefined;
  if ((await files.stat(`${directory}/config.json`)) !== undefined) {
    const config = await files.read(`${directory}/config.json`, AZD_FILE_LIMITS.fileBytes, "AZD_ENV_MISSING");
    try {
      assertConfigHasNoSecrets(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(config)));
    } catch (error) {
      if (error instanceof AzdBindingError) throw error;
      fail("AZD_ENV_INVALID", "The azd environment config is not valid JSON");
    }
    configHash = sha256Hex(config);
  }
  const entries = [...values.entries()].sort(([left], [right]) => compare(left, right));
  return {
    values,
    environment: {
      name: request.environmentName,
      target: {
        subscriptionId: request.target.subscriptionId,
        location: request.target.location,
        ...(request.target.tenantId === undefined ? {} : { tenantId: request.target.tenantId }),
        ...(request.target.resourceGroup === undefined ? {} : { resourceGroup: request.target.resourceGroup }),
      },
      keys: entries.map(([key]) => key),
      valuesHash: calculatePolicyValidationDigest(entries),
      ...(configHash === undefined ? {} : { configHash }),
    },
  };
}

interface ParameterResolution {
  readonly fileHash: string;
  readonly resolvedHash: string;
}

function resolveParameters(bytes: Buffer, values: ReadonlyMap<string, string>): ParameterResolution {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("AZD_PARAMETERS_UNSUPPORTED", "The Bicep parameter file is not valid UTF-8");
  }
  // azd substitutes into the raw file text, so only plain ${NAME} references with inert values are supported.
  const stripped = source.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, "").replaceAll('"$schema"', "");
  if (stripped.includes("$"))
    fail("AZD_PARAMETERS_UNSUPPORTED", "The Bicep parameter file uses substitution other than ${NAME}");
  const resolved = source.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_match, name: string) => {
    const value = values.get(name);
    if (value === undefined)
      fail("AZD_PARAMETERS_UNRESOLVED", `Bicep parameter substitution ${name} is not defined in the azd environment`);
    if (/["\\]/u.test(value))
      fail(
        "AZD_PARAMETERS_UNSUPPORTED",
        `Bicep parameter substitution ${name} holds characters that alter JSON structure`,
      );
    return value;
  });
  let document: unknown;
  try {
    document = JSON.parse(resolved);
  } catch {
    return fail("AZD_PARAMETERS_UNSUPPORTED", "The Bicep parameter file is not valid JSON after substitution");
  }
  const root = plain(document, "The Bicep parameter file", "AZD_PARAMETERS_UNSUPPORTED");
  onlyKeys(root, ["$schema", "contentVersion", "parameters"], "The Bicep parameter file", "AZD_PARAMETERS_UNSUPPORTED");
  const parameters = plain(root.parameters ?? {}, "The Bicep parameters", "AZD_PARAMETERS_UNSUPPORTED");
  const entries: Array<[string, unknown]> = [];
  for (const [name, definition] of Object.entries(parameters)) {
    if (!PARAMETER_NAME.test(name))
      fail("AZD_PARAMETERS_UNSUPPORTED", `Bicep parameter name ${safeKey(name)} is not supported`);
    const parameter = plain(definition, `Bicep parameter ${name}`, "AZD_PARAMETERS_UNSUPPORTED");
    onlyKeys(parameter, ["value", "reference"], `Bicep parameter ${name}`, "AZD_PARAMETERS_UNSUPPORTED");
    if ((parameter.value === undefined) === (parameter.reference === undefined))
      fail("AZD_PARAMETERS_UNSUPPORTED", `Bicep parameter ${name} must declare exactly one of value or reference`);
    if (parameter.value !== undefined && SECRET_FIELD_PATTERN.test(name))
      fail(
        "AZD_PARAMETERS_SECRET",
        `Bicep parameter ${name} carries a secret-named literal; use a Key Vault reference`,
      );
    if (SECRET_VALUE_PATTERN.test(JSON.stringify(parameter)))
      fail("AZD_PARAMETERS_SECRET", `Bicep parameter ${name} holds a secret-like value; use a Key Vault reference`);
    entries.push([name, parameter]);
  }
  entries.sort(([left], [right]) => compare(left, right));
  return { fileHash: sha256Hex(bytes), resolvedHash: calculatePolicyValidationDigest(entries) };
}

interface RootDeclaration {
  readonly name: string;
  readonly path: string;
  readonly module: string;
  readonly dependsOn: readonly string[];
  readonly hooks: unknown;
}

function declareRoots(infra: Record<string, unknown>): { layered: boolean; roots: RootDeclaration[] } {
  onlyKeys(infra, ["provider", "path", "module", "layers"], "infra", "AZD_PROJECT_UNSUPPORTED");
  if (infra.provider !== undefined && infra.provider !== "bicep")
    fail(
      "AZD_PROVIDER_UNSUPPORTED",
      "Only the built-in bicep infra provider is supported; Terraform and extension providers are not",
    );
  if (infra.layers === undefined)
    return {
      layered: false,
      roots: [
        {
          name: "default",
          path: projectPath(infra.path ?? "infra", "infra.path"),
          module: moduleName(infra.module ?? "main", "infra.module", "AZD_PROJECT_UNSUPPORTED"),
          dependsOn: [],
          hooks: undefined,
        },
      ],
    };
  if (infra.path !== undefined || infra.module !== undefined)
    fail("AZD_LAYER_UNSUPPORTED", "infra.layers cannot be combined with infra.path or infra.module");
  if (!Array.isArray(infra.layers) || infra.layers.length === 0 || infra.layers.length > 16)
    fail("AZD_LAYER_UNSUPPORTED", "infra.layers must list between 1 and 16 layers");
  const roots: RootDeclaration[] = [];
  const seen = new Set<string>();
  const paths = new Set<string>();
  for (const candidate of infra.layers as unknown[]) {
    const layer = plain(candidate, "An infra layer", "AZD_LAYER_UNSUPPORTED");
    onlyKeys(
      layer,
      ["name", "path", "module", "provider", "config", "dependsOn", "hooks"],
      "An infra layer",
      "AZD_LAYER_UNSUPPORTED",
    );
    const name = text(layer.name, "An infra layer name", "AZD_LAYER_UNSUPPORTED", 64);
    if (!NAME.test(name) || name.toLowerCase() === "default" || seen.has(name.toLowerCase()))
      fail("AZD_LAYER_UNSUPPORTED", `Infra layer name ${safeKey(name)} is invalid, reserved or repeated`);
    seen.add(name.toLowerCase());
    if (layer.provider !== undefined && layer.provider !== "bicep")
      fail("AZD_PROVIDER_UNSUPPORTED", `Infra layer ${name} must use the built-in bicep provider`);
    if (
      layer.config !== undefined &&
      Object.keys(plain(layer.config, `Infra layer ${name} config`, "AZD_LAYER_UNSUPPORTED")).length > 0
    )
      fail("AZD_LAYER_UNSUPPORTED", `Infra layer ${name} provider configuration is not supported`);
    const path = projectPath(layer.path, `Infra layer ${name} path`);
    if (paths.has(path.toLowerCase())) fail("AZD_LAYER_UNSUPPORTED", `Infra layer ${name} repeats another layer path`);
    paths.add(path.toLowerCase());
    const dependsOn =
      layer.dependsOn === undefined
        ? []
        : Array.isArray(layer.dependsOn)
          ? (layer.dependsOn as unknown[]).map((item) =>
              text(item, `Infra layer ${name} dependency`, "AZD_LAYER_UNSUPPORTED", 64),
            )
          : fail("AZD_LAYER_UNSUPPORTED", `Infra layer ${name} dependsOn must be a list`);
    roots.push({
      name,
      path,
      module: moduleName(layer.module ?? "main", `Infra layer ${name} module`, "AZD_LAYER_UNSUPPORTED"),
      dependsOn,
      hooks: layer.hooks,
    });
  }
  const names = roots.map(({ name }) => name);
  const graph = new Map(roots.map((root) => [root.name, root.dependsOn]));
  for (const root of roots) {
    const invalid = root.dependsOn.some((dependency) => !names.includes(dependency) || dependency === root.name);
    if (invalid || new Set(root.dependsOn).size !== root.dependsOn.length)
      fail("AZD_LAYER_UNSUPPORTED", `Infra layer ${root.name} has an unknown, repeated or self dependency`);
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string): void => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") fail("AZD_LAYER_UNSUPPORTED", "Infra layer dependencies are cyclic");
    state.set(name, "visiting");
    for (const dependency of graph.get(name) ?? []) visit(dependency);
    state.set(name, "done");
  };
  for (const name of names) visit(name);
  return { layered: true, roots };
}

const LOCAL_REFERENCE =
  /\b(?:module\s+[A-Za-z_]\w*\s+|(?:loadTextContent|loadFileAsBase64|loadJsonContent|loadYamlContent)\(\s*|from\s+)(['"])([^'"\r\n]*)\1/gu;

/** Local module and file references must stay inside the hashed tree; remote registry references are not bound. */
function assertLocalReferences(root: string, path: string, content: Buffer): void {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return fail("AZD_INFRA_MISSING", `Infra ${root} file ${path} is not valid UTF-8`);
  }
  for (const match of source.matchAll(LOCAL_REFERENCE)) {
    const reference = match[2]!;
    if (/^(?:br|ts)[:/]/iu.test(reference) || /^[a-z][a-z0-9+.-]*:\/\//iu.test(reference)) continue;
    if (/^(?:[\\/]|[A-Za-z]:)/u.test(reference) || reference.split(/[\\/]/u).includes(".."))
      fail("AZD_PATH_UNSAFE", `Infra ${root} file ${path} references a file outside its bound tree`);
  }
}

async function inventoryRoot(
  files: AzdProjectFiles,
  root: RootDeclaration,
  values: ReadonlyMap<string, string>,
): Promise<AzdInfraRootV1> {
  const template = await files.stat(`${root.path}/${root.module}.bicep`);
  if (template === undefined || !template.isFile())
    fail("AZD_INFRA_MISSING", `Infra ${root.name} has no ${root.module}.bicep under ${root.path}`);
  if ((await files.stat(`${root.path}/${root.module}.bicepparam`)) !== undefined)
    fail(
      "AZD_PARAMETERS_UNSUPPORTED",
      `Infra ${root.name} uses .bicepparam, which cannot be resolved deterministically`,
    );
  if ((await files.stat(`${root.path}/bicepconfig.json`)) === undefined)
    fail(
      "AZD_INFRA_MISSING",
      `Infra ${root.name} needs ${root.path}/bicepconfig.json so Bicep configuration is never inherited from outside the bound tree`,
    );
  const parametersPath = `${root.path}/${root.module}.parameters.json`;
  const parameters =
    (await files.stat(parametersPath)) === undefined
      ? undefined
      : resolveParameters(await files.read(parametersPath, AZD_FILE_LIMITS.fileBytes, "AZD_INFRA_MISSING"), values);
  return {
    name: root.name,
    path: root.path,
    module: root.module,
    provider: "bicep",
    dependsOn: [...root.dependsOn],
    treeHash: await files.hashTree(root.path, (path, content) => {
      if (path.endsWith(".bicep")) assertLocalReferences(root.name, path, content);
    }),
    ...(parameters === undefined ? {} : { parametersPath, parametersFileHash: parameters.fileHash }),
    resolvedParametersHash: parameters?.resolvedHash ?? calculatePolicyValidationDigest([]),
  };
}

interface HookSite {
  readonly scope: string;
  readonly events: ReadonlySet<string>;
  readonly declaration: unknown;
  /** Project-relative directories scripts are looked up in; a script found in two of them is ambiguous. */
  readonly bases: readonly string[];
}

async function inventoryHooks(files: AzdProjectFiles, site: HookSite): Promise<AzdHookV1[]> {
  const result: AzdHookV1[] = [];
  const hooks = plain(site.declaration, `${site.scope} hooks`, "AZD_HOOK_UNSUPPORTED");
  for (const [event, declared] of Object.entries(hooks)) {
    if (!site.events.has(event))
      fail("AZD_HOOK_UNSUPPORTED", `${site.scope} declares unsupported hook event ${safeKey(event)}`);
    const list = Array.isArray(declared) ? (declared as unknown[]) : [declared];
    if (list.length > MAX_HOOKS_PER_EVENT)
      fail("AZD_HOOK_UNSUPPORTED", `${site.scope} ${event} declares too many hooks`);
    for (const [order, candidate] of list.entries()) {
      const entry = plain(candidate, `${site.scope} ${event} hook`, "AZD_HOOK_UNSUPPORTED");
      onlyKeys(entry, [...HOOK_FIELDS, "windows", "posix"], `${site.scope} ${event} hook`, "AZD_HOOK_UNSUPPORTED");
      const variants: Array<["all" | "windows" | "posix", Record<string, unknown>]> = [];
      if (entry.run !== undefined) variants.push(["all", entry]);
      else if (HOOK_FIELDS.some((field) => entry[field] !== undefined))
        fail("AZD_HOOK_UNSUPPORTED", `${site.scope} ${event} hook configures a runner without a run command`);
      for (const platform of ["windows", "posix"] as const) {
        if (entry[platform] === undefined) continue;
        const override = plain(entry[platform], `${site.scope} ${event} ${platform} hook`, "AZD_HOOK_UNSUPPORTED");
        onlyKeys(override, HOOK_FIELDS, `${site.scope} ${event} ${platform} hook`, "AZD_HOOK_UNSUPPORTED");
        variants.push([platform, override]);
      }
      if (variants.length === 0) fail("AZD_HOOK_UNSUPPORTED", `${site.scope} ${event} hook has no run command`);
      for (const [platform, definition] of variants)
        result.push(await inventoryHook(files, site, event, order, platform, definition));
    }
  }
  return result;
}

async function inventoryHook(
  files: AzdProjectFiles,
  site: HookSite,
  event: string,
  order: number,
  platform: "all" | "windows" | "posix",
  definition: Record<string, unknown>,
): Promise<AzdHookV1> {
  const context = `${site.scope} ${event} hook`;
  const run = definition.run;
  if (
    typeof run !== "string" ||
    run.trim().length === 0 ||
    run.length > AZD_FILE_LIMITS.fileBytes ||
    SCRIPT_CONTROL.test(run)
  )
    fail("AZD_HOOK_UNSUPPORTED", `${context} run must be a non-empty script or script path`);
  for (const field of ["shell", "kind"] as const)
    if (definition[field] !== undefined && definition[field] !== "sh" && definition[field] !== "pwsh")
      fail("AZD_HOOK_UNSUPPORTED", `${context} uses an unsupported runner; only sh and pwsh hooks are supported`);
  if (definition.shell !== undefined && definition.kind !== undefined && definition.shell !== definition.kind)
    fail("AZD_HOOK_UNSUPPORTED", `${context} declares conflicting shell and kind`);
  const declared = (definition.shell ?? definition.kind) as "sh" | "pwsh" | undefined;
  for (const field of ["secrets", "config"] as const)
    if (
      definition[field] !== undefined &&
      Object.keys(plain(definition[field], `${context} ${field}`, "AZD_HOOK_UNSUPPORTED")).length > 0
    )
      fail(
        "AZD_HOOK_UNSUPPORTED",
        `${context} ${field} are not supported because they resolve values outside the binding`,
      );
  let workingDirectory: string | undefined;
  if (definition.dir !== undefined && definition.dir !== ".") {
    workingDirectory = projectPath(definition.dir, `${context} dir`, "AZD_HOOK_SCRIPT_INVALID");
    const directory = await files.stat(workingDirectory);
    if (directory === undefined || !directory.isDirectory())
      fail("AZD_HOOK_SCRIPT_INVALID", `${context} dir is not a project directory`);
  }

  let source: "script" | "inline" = "inline";
  let path: string | undefined;
  let content: Buffer = Buffer.from(run, "utf8");
  if (!/\s/u.test(run)) {
    const pathLike = /[\\/]/u.test(run) || /\.(?:sh|ps1)$/iu.test(run);
    const candidate = relativePath(run);
    const found: string[] = [];
    if (candidate !== undefined)
      for (const base of site.bases) {
        const full = base.length === 0 ? candidate : `${base}/${candidate}`;
        if ((await files.stat(full)) !== undefined) found.push(full);
      }
    if (found.length > 1)
      fail("AZD_HOOK_SCRIPT_INVALID", `${context} script is ambiguous between project and service folders`);
    if (found.length === 1) {
      const full = found[0]!;
      const metadata = await files.stat(full);
      if (metadata === undefined || !metadata.isFile())
        fail("AZD_HOOK_SCRIPT_INVALID", `${context} script is not a regular file`);
      source = "script";
      path = full;
      content = await files.readFile(full, metadata, AZD_FILE_LIMITS.fileBytes);
    } else if (pathLike)
      fail("AZD_HOOK_SCRIPT_INVALID", `${context} script path is missing, absolute or outside the project`);
  }

  const extension = path === undefined ? undefined : /\.([A-Za-z0-9]+)$/u.exec(path)?.[1]?.toLowerCase();
  const inferred = extension === "sh" ? "sh" : extension === "ps1" ? "pwsh" : undefined;
  if (source === "script" && declared === undefined && inferred === undefined)
    fail("AZD_HOOK_UNSUPPORTED", `${context} script has no sh or ps1 extension and no declared shell`);
  if (declared !== undefined && inferred !== undefined && declared !== inferred)
    fail("AZD_HOOK_UNSUPPORTED", `${context} declares a shell that conflicts with its script extension`);
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return fail("AZD_HOOK_SCRIPT_INVALID", `${context} script is not valid UTF-8`);
  }
  for (const [pattern, reason] of UNBOUND_MUTATIONS)
    if (pattern.test(body))
      fail(
        "AZD_HOOK_UNBOUND_MUTATION",
        `${context} ${reason}, which the bound preview cannot cover; remove it or run that work as its own approved operation`,
      );
  return {
    scope: site.scope,
    event,
    order,
    platform,
    shell: declared ?? inferred ?? "sh",
    source,
    ...(path === undefined ? {} : { path }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    contentHash: sha256Hex(content),
    continueOnError: bool(definition.continueOnError, false, `${context} continueOnError`, "AZD_HOOK_UNSUPPORTED"),
    interactive: bool(definition.interactive, false, `${context} interactive`, "AZD_HOOK_UNSUPPORTED"),
  };
}

function inventoryExtensions(required: unknown, azdVersion: string): AzdBindingV1["extensions"] {
  if (required === undefined) return [];
  const declaration = plain(required, "requiredVersions", "AZD_PROJECT_UNSUPPORTED");
  onlyKeys(declaration, ["azd", "extensions"], "requiredVersions", "AZD_PROJECT_UNSUPPORTED");
  if (declaration.azd !== undefined) {
    const constraint = text(declaration.azd, "requiredVersions.azd", "AZD_PROJECT_UNSUPPORTED", 64);
    const satisfied = satisfiesAzdVersionConstraint(azdVersion, constraint);
    if (satisfied === undefined)
      fail("AZD_PROJECT_UNSUPPORTED", "requiredVersions.azd must use simple comparators such as '>= 1.35.0'");
    if (!satisfied)
      fail(
        "AZD_VERSION_CONSTRAINT",
        `azure.yaml requires azd ${constraint}, which the bound azd ${azdVersion} does not meet`,
      );
  }
  if (declaration.extensions === undefined) return [];
  const extensions = plain(declaration.extensions, "requiredVersions.extensions", "AZD_PROJECT_UNSUPPORTED");
  const result: Array<AzdBindingV1["extensions"][number]> = [];
  for (const [id, constraint] of Object.entries(extensions)) {
    const version = typeof constraint === "string" ? EXACT_VERSION.exec(constraint.trim())?.[1] : undefined;
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(id) || version === undefined)
      fail(
        "AZD_EXTENSION_UNPINNED",
        `azd extension ${safeKey(id)} must declare an exact x.y.z version; latest, ranges and omitted versions are not allowed`,
      );
    result.push({ id, version, source: "azd" });
  }
  return result.sort((left, right) => compare(left.id, right.id));
}

function assertSupportedProject(project: Record<string, unknown>, request: AzdBindingRequest): void {
  for (const unsupported of ["resources", "platform", "state", "cloud"])
    if (project[unsupported] !== undefined)
      fail(
        "AZD_PROJECT_UNSUPPORTED",
        `azure.yaml '${unsupported}' is not supported: it generates infrastructure or redirects state, platform or cloud`,
      );
  onlyKeys(project, TOP_LEVEL_KEYS, "azure.yaml", "AZD_PROJECT_UNSUPPORTED");
  assertDeclaredGroup(project.resourceGroup, request, "azure.yaml resourceGroup");
}

/**
 * Inspect a Bicep azd project and bind every input azd recompiles or executes at provision time: the manifest,
 * infrastructure trees, resolved parameters, environment values, hooks, extensions and layers. Unsupported or
 * unverifiable surfaces fail closed with a stable {@link AzdBindingError} code. Nothing here runs azd or reads Azure.
 */
export async function inspectAzdBicepProject(input: AzdBindingRequest): Promise<AzdBindingV1> {
  const request: AzdBindingRequest = {
    ...input,
    target: {
      ...input.target,
      subscriptionId: input.target.subscriptionId.toLowerCase(),
      location: input.target.location.toLowerCase(),
      ...(input.target.tenantId === undefined ? {} : { tenantId: input.target.tenantId.toLowerCase() }),
    },
  };
  if (!Value.Check(EnvironmentSchema, request.environmentName))
    fail("AZD_BINDING_INPUT_INVALID", "The azd environment name is invalid");
  if (!Value.Check(AzdEnvironmentV1Schema.properties.target, request.target))
    fail("AZD_BINDING_INPUT_INVALID", "The approved azd target is invalid");
  if (!Value.Check(AzdVersionSchema, request.azdVersion))
    fail("AZD_BINDING_INPUT_INVALID", "The azd version must be an exact x.y.z release");
  const files = await AzdProjectFiles.open(request.projectRoot);
  const manifest = await files.read("azure.yaml", AZD_FILE_LIMITS.fileBytes, "AZD_PROJECT_MISSING");
  const project = parseYaml(manifest);
  assertSupportedProject(project, request);
  const projectName = text(project.name, "azure.yaml name", "AZD_PROJECT_UNSUPPORTED", 128);

  const { environment, values } = await inventoryEnvironment(files, request);
  const { layered, roots: declarations } = declareRoots(
    project.infra === undefined ? {} : plain(project.infra, "infra", "AZD_PROJECT_UNSUPPORTED"),
  );
  const roots: AzdInfraRootV1[] = [];
  for (const declaration of declarations) roots.push(await inventoryRoot(files, declaration, values));

  const sites: HookSite[] = [];
  if (project.hooks !== undefined)
    sites.push({ scope: "project", events: PROJECT_HOOK_EVENTS, declaration: project.hooks, bases: [""] });
  for (const declaration of declarations)
    if (declaration.hooks !== undefined)
      sites.push({
        scope: `layer:${declaration.name}`,
        events: LAYER_HOOK_EVENTS,
        declaration: declaration.hooks,
        bases: [""],
      });
  if (project.services !== undefined) {
    const services = plain(project.services, "services", "AZD_PROJECT_UNSUPPORTED");
    if (Object.keys(services).length > 64) fail("AZD_PROJECT_UNSUPPORTED", "azure.yaml declares too many services");
    for (const [name, candidate] of Object.entries(services)) {
      if (!NAME.test(name)) fail("AZD_PROJECT_UNSUPPORTED", `Service name ${safeKey(name)} is not supported`);
      const service = plain(candidate, `Service ${name}`, "AZD_PROJECT_UNSUPPORTED");
      assertDeclaredGroup(service.resourceGroup, request, `Service ${name} resourceGroup`);
      if (service.hooks === undefined) continue;
      const serviceDirectory =
        service.project === undefined || service.project === "."
          ? ""
          : projectPath(service.project, `Service ${name} project`);
      sites.push({
        scope: `service:${name}`,
        events: SERVICE_HOOK_EVENTS,
        declaration: service.hooks,
        bases: serviceDirectory.length === 0 ? [""] : ["", serviceDirectory],
      });
    }
  }
  const hooks: AzdHookV1[] = [];
  for (const site of sites) hooks.push(...(await inventoryHooks(files, site)));
  hooks.sort(
    (left, right) =>
      compare(left.scope, right.scope) ||
      compare(left.event, right.event) ||
      left.order - right.order ||
      compare(left.platform, right.platform),
  );

  const body: Omit<AzdBindingV1, "bindingHash"> = {
    schemaVersion: CONTRACT_VERSION,
    projectId: request.projectId,
    runId: request.runId,
    track: "bicep",
    executor: "azd",
    azdVersion: request.azdVersion,
    projectName,
    configHash: sha256Hex(manifest),
    infra: { provider: "bicep", layered, roots },
    environment,
    parametersHash: calculatePolicyValidationDigest(
      roots.map(({ name, resolvedParametersHash }) => [name, resolvedParametersHash]),
    ),
    hooks,
    extensions: inventoryExtensions(project.requiredVersions, request.azdVersion),
  };
  const binding = { ...body, bindingHash: calculateAzdBindingHash(body) };
  if (!hasValidAzdBinding(binding))
    fail("AZD_BINDING_INPUT_INVALID", "The azd binding inputs exceed the supported contract bounds");
  return binding;
}

/** Names the sections that differ between an accepted binding and the current one, never their values. */
export function diffAzdBindings(accepted: AzdBindingV1, current: AzdBindingV1): string[] {
  const section = (name: string, left: unknown, right: unknown): string[] =>
    calculatePolicyValidationDigest(left) === calculatePolicyValidationDigest(right) ? [] : [name];
  return [
    ...section("azd version", accepted.azdVersion, current.azdVersion),
    ...section("azure.yaml", accepted.configHash, current.configHash),
    ...section("infrastructure", accepted.infra, current.infra),
    ...section("environment", accepted.environment, current.environment),
    ...section("parameters", accepted.parametersHash, current.parametersHash),
    ...section("hooks", accepted.hooks, current.hooks),
    ...section("extensions", accepted.extensions, current.extensions),
    ...section("run identity", [accepted.projectId, accepted.runId], [current.projectId, current.runId]),
  ];
}

/** Re-inspect the project and fail closed when anything bound at preview time has changed. */
export async function assertAzdBindingUnchanged(
  accepted: AzdBindingV1,
  request: AzdBindingRequest,
): Promise<AzdBindingV1> {
  if (!hasValidAzdBinding(accepted)) fail("AZD_BINDING_CHANGED", "The accepted azd binding is not a valid binding");
  const current = await inspectAzdBicepProject(request);
  if (current.bindingHash !== accepted.bindingHash) {
    const changed = diffAzdBindings(accepted, current);
    fail(
      "AZD_BINDING_CHANGED",
      `The azd binding changed since the preview (${changed.length === 0 ? "binding" : changed.join(", ")}); create a new preview and approval`,
    );
  }
  return current;
}

export interface AzdApprovalMaterial {
  readonly bindingHash: string;
  readonly warnings: readonly string[];
  readonly inventory: readonly string[];
}

/** Reviewer-facing inventory and warnings; hooks, extensions and layers are always listed, never summarized away. */
export function describeAzdBinding(binding: AzdBindingV1): AzdApprovalMaterial {
  const warnings = [
    `azd ${binding.azdVersion} recompiles the Bicep source and re-resolves parameters when it provisions; the what-if is a prediction against current Azure state, not an immutable plan.`,
  ];
  if (binding.hooks.length > 0)
    warnings.push(
      `${binding.hooks.length} hook(s) will run arbitrary scripts during azd operations and can change resources, settings or data beyond what the what-if predicts. Review each hook listed below.`,
    );
  if (binding.extensions.length > 0)
    warnings.push(
      `${binding.extensions.length} azd extension(s) are required and can extend azd behavior beyond the what-if.`,
    );
  if (binding.infra.layered)
    warnings.push(
      `Provisioning runs ${binding.infra.roots.length} layers in dependency order; each layer is previewed on its own.`,
    );
  const inventory = [
    ...binding.infra.roots.map(
      (root) =>
        `infra ${root.name}: ${root.path}/${root.module}.bicep tree ${root.treeHash.slice(0, 12)} parameters ${root.resolvedParametersHash.slice(0, 12)}${root.dependsOn.length === 0 ? "" : ` after ${root.dependsOn.join(", ")}`}`,
    ),
    ...binding.hooks.map(
      (hook) =>
        `hook ${hook.scope} ${hook.event} #${hook.order} (${hook.platform}, ${hook.shell}, ${hook.source === "script" ? hook.path : "inline"}) content ${hook.contentHash.slice(0, 12)}${hook.continueOnError ? ", continues on error" : ""}${hook.interactive ? ", interactive" : ""}`,
    ),
    ...binding.extensions.map((extension) => `extension ${extension.id} ${extension.version} (${extension.source})`),
  ];
  return { bindingHash: binding.bindingHash, warnings, inventory };
}
