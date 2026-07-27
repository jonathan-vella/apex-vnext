import { spawn } from "node:child_process";
import { TerraformCommandAdapter, type CommandPlan } from "./command-plans.js";
import { ProcessRunnerError, type ProcessErrorCode } from "./process-runner.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 20_000_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 50_000_000;
const MAX_INPUT_LENGTH = 4096;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9_-]{0,98}[a-z0-9])?$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const FORMAT_VERSION = /^(\d+)\.(\d+)$/u;

export type TerraformSchemaKind = "provider" | "resource" | "data-source" | "list-resource";
export type TerraformDocumentationKind = "resources" | "data-sources" | "list-resources";
export type TerraformProviderUnavailableReason =
  | "process-exit"
  | "spawn"
  | "timeout"
  | "output-limit"
  | "malformed-response"
  | "unsupported-format"
  | "version-mismatch";

export type TerraformProviderResult<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: TerraformProviderUnavailableReason };

export interface TerraformMetadataRequest {
  readonly plan: CommandPlan;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface TerraformMetadataRunnerLike {
  run(request: TerraformMetadataRequest): Promise<string>;
}

export interface TerraformInstalledProvider {
  readonly source: string;
  readonly version: string | null;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly resources: readonly string[];
  readonly dataSources: readonly string[];
  readonly listResources: readonly string[];
}

export interface TerraformInstalledSchemas {
  readonly formatVersion: string;
  readonly terraformVersion: string;
  readonly providers: readonly TerraformInstalledProvider[];
}

export interface TerraformSchemaSelector {
  readonly providerSource: string;
  readonly kind: TerraformSchemaKind;
  readonly name?: string;
}

export interface TerraformSelectedSchema {
  readonly providerSource: string;
  readonly version: string | null;
  readonly kind: TerraformSchemaKind;
  readonly name?: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export interface TerraformDocumentationRequest {
  readonly providerSource: string;
  readonly kind: TerraformDocumentationKind;
  readonly schemaName: string;
  readonly slug: string;
}

export interface TerraformDocumentationRoute {
  readonly providerSource: string;
  readonly version: string;
  readonly kind: TerraformDocumentationKind;
  readonly slug: string;
  readonly url: string;
}

export interface TerraformProviderIntrospectionOptions {
  readonly runner?: TerraformMetadataRunnerLike;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validPositiveInteger(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function validProviderSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return (
    value.length <= MAX_INPUT_LENGTH &&
    parts.length === 3 &&
    parts[0] === "registry.terraform.io" &&
    IDENTIFIER.test(parts[1]!) &&
    IDENTIFIER.test(parts[2]!)
  );
}

function validSchemaProviderSource(value: unknown): value is string {
  return value === "terraform.io/builtin/terraform" || validProviderSource(value);
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_INPUT_LENGTH && IDENTIFIER.test(value);
}

function schemaRepresentation(value: unknown): Record<string, unknown> | null {
  const schema = plainObject(value);
  return schema !== null &&
    Number.isSafeInteger(schema.version) &&
    Number(schema.version) >= 0 &&
    plainObject(schema.block) !== null
    ? schema
    : null;
}

function sortedSchemaKeys(value: unknown): readonly string[] | null {
  const object = plainObject(value);
  if (object === null) return null;
  if (Object.entries(object).some(([name, entry]) => !validName(name) || schemaRepresentation(entry) === null)) {
    return null;
  }
  return Object.keys(object).sort();
}

function unavailableReason(error: unknown): TerraformProviderUnavailableReason {
  if (!(error instanceof ProcessRunnerError)) return "spawn";
  const reasons: Record<ProcessErrorCode, TerraformProviderUnavailableReason> = {
    PROCESS_EXIT_NONZERO: "process-exit",
    PROCESS_OUTPUT_LIMIT: "output-limit",
    PROCESS_SPAWN_ERROR: "spawn",
    PROCESS_TIMEOUT: "timeout",
  };
  return reasons[error.code];
}

class TerraformMetadataRunner implements TerraformMetadataRunnerLike {
  async run(request: TerraformMetadataRequest): Promise<string> {
    if (
      request.plan.executable !== "terraform" ||
      (request.plan.args.join("\0") !== "providers\0schema\0-json" && request.plan.args.join("\0") !== "version\0-json")
    ) {
      throw new TypeError("Terraform metadata runner accepts only schema and version plans");
    }

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(request.plan.executable, [...request.plan.args], {
        shell: false,
        windowsHide: true,
        env: Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("TF_CLI_ARGS")),
        ),
        ...(request.plan.cwd === undefined ? {} : { cwd: request.plan.cwd }),
      });
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderrBytes = 0;
      let outputTruncated = false;
      let timedOut = false;

      const consume = (
        current: Buffer<ArrayBufferLike>,
        chunk: Buffer<ArrayBufferLike>,
        retain: boolean,
      ): Buffer<ArrayBufferLike> => {
        const remaining = request.maxOutputBytes - stdout.length - stderrBytes;
        if (remaining <= 0 || chunk.length > remaining) {
          outputTruncated = true;
          child.kill("SIGKILL");
          if (!retain || remaining <= 0) return current;
          return Buffer.concat([current, chunk.subarray(0, remaining)]);
        }
        if (!retain) {
          stderrBytes += chunk.length;
          return current;
        }
        return Buffer.concat([current, chunk]);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = consume(stdout, chunk, true);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        consume(Buffer.alloc(0), chunk, false);
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, request.timeoutMs);

      child.once("error", () => {
        clearTimeout(timeout);
        reject(new ProcessRunnerError("PROCESS_SPAWN_ERROR", "Terraform metadata process could not start"));
      });
      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(new ProcessRunnerError("PROCESS_TIMEOUT", "Terraform metadata process timed out"));
        } else if (outputTruncated) {
          reject(new ProcessRunnerError("PROCESS_OUTPUT_LIMIT", "Terraform metadata output exceeded its limit"));
        } else if (exitCode !== 0) {
          reject(new ProcessRunnerError("PROCESS_EXIT_NONZERO", "Terraform metadata process failed"));
        } else {
          resolve(stdout.toString("utf8"));
        }
      });
    });
  }
}

export class TerraformProviderIntrospection {
  readonly #runner: TerraformMetadataRunnerLike;
  readonly #commands = new TerraformCommandAdapter();
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;

  constructor(options: TerraformProviderIntrospectionOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (
      !validPositiveInteger(this.#timeoutMs, MAX_TIMEOUT_MS) ||
      !validPositiveInteger(this.#maxOutputBytes, MAX_OUTPUT_BYTES)
    ) {
      throw new TypeError("Terraform provider introspection bounds are invalid");
    }
    this.#runner = options.runner ?? new TerraformMetadataRunner();
  }

  async inspect(cwd: string): Promise<TerraformProviderResult<TerraformInstalledSchemas>> {
    if (typeof cwd !== "string" || cwd.trim().length === 0 || cwd.length > MAX_INPUT_LENGTH || cwd.includes("\0")) {
      return { status: "invalid", reason: "invalid-cwd" };
    }
    try {
      const [schemaResult, versionResult] = await Promise.allSettled([
        this.#run(this.#commands.providerSchemas(cwd)),
        this.#run(this.#commands.versionJson(cwd)),
      ]);
      if (schemaResult.status === "rejected") throw schemaResult.reason;
      if (versionResult.status === "rejected") throw versionResult.reason;
      return this.#parse(schemaResult.value, versionResult.value);
    } catch (error) {
      return { status: "unavailable", reason: unavailableReason(error) };
    }
  }

  async select(
    cwd: string,
    selector: TerraformSchemaSelector,
  ): Promise<TerraformProviderResult<TerraformSelectedSchema>> {
    if (selector === null || typeof selector !== "object") {
      return { status: "invalid", reason: "invalid-selector" };
    }
    if (!validSchemaProviderSource(selector.providerSource)) {
      return { status: "invalid", reason: "invalid-provider-source" };
    }
    if (!(["provider", "resource", "data-source", "list-resource"] as readonly unknown[]).includes(selector.kind)) {
      return { status: "invalid", reason: "invalid-schema-kind" };
    }
    if (selector.kind === "provider" && selector.name !== undefined) {
      return { status: "invalid", reason: "invalid-schema-name" };
    }
    if (selector.kind !== "provider" && (selector.name === undefined || !validName(selector.name))) {
      return { status: "invalid", reason: "invalid-schema-name" };
    }
    const inspected = await this.inspect(cwd);
    if (inspected.status !== "ok") return inspected;
    const provider = inspected.value.providers.find(({ source }) => source === selector.providerSource);
    if (provider === undefined) return { status: "missing" };
    const collectionKey = {
      resource: "resource_schemas",
      "data-source": "data_source_schemas",
      "list-resource": "list_resource_schemas",
    } as const;
    const schema =
      selector.kind === "provider"
        ? plainObject(provider.schema.provider)
        : plainObject(plainObject(provider.schema[collectionKey[selector.kind]])?.[selector.name!]);
    if (schema === null) return { status: "missing" };
    return {
      status: "ok",
      value: {
        providerSource: provider.source,
        version: provider.version,
        kind: selector.kind,
        ...(selector.name === undefined ? {} : { name: selector.name }),
        schema: structuredClone(schema),
      },
    };
  }

  async documentation(
    cwd: string,
    request: TerraformDocumentationRequest,
  ): Promise<TerraformProviderResult<TerraformDocumentationRoute>> {
    if (request === null || typeof request !== "object") {
      return { status: "invalid", reason: "invalid-documentation-request" };
    }
    if (!(["resources", "data-sources", "list-resources"] as readonly unknown[]).includes(request.kind)) {
      return { status: "invalid", reason: "invalid-documentation-kind" };
    }
    if (!validName(request.slug)) return { status: "invalid", reason: "invalid-documentation-slug" };
    if (!validProviderSource(request.providerSource)) {
      return { status: "invalid", reason: "invalid-provider-source" };
    }
    const schemaKind = {
      resources: "resource",
      "data-sources": "data-source",
      "list-resources": "list-resource",
    } as const;
    const selected = await this.select(cwd, {
      providerSource: request.providerSource,
      kind: schemaKind[request.kind],
      name: request.schemaName,
    });
    if (selected.status !== "ok") return selected;
    if (selected.value.version === null) return { status: "unavailable", reason: "version-mismatch" };
    const [, namespace, name] = request.providerSource.split("/");
    return {
      status: "ok",
      value: {
        providerSource: request.providerSource,
        version: selected.value.version,
        kind: request.kind,
        slug: request.slug,
        url: `https://registry.terraform.io/providers/${namespace}/${name}/${selected.value.version}/docs/${request.kind}/${request.slug}`,
      },
    };
  }

  async #run(plan: CommandPlan): Promise<string> {
    return await this.#runner.run({ plan, timeoutMs: this.#timeoutMs, maxOutputBytes: this.#maxOutputBytes });
  }

  #parse(schemaText: string, versionText: string): TerraformProviderResult<TerraformInstalledSchemas> {
    let schemaValue: unknown;
    let versionValue: unknown;
    try {
      schemaValue = JSON.parse(schemaText) as unknown;
      versionValue = JSON.parse(versionText) as unknown;
    } catch {
      return { status: "unavailable", reason: "malformed-response" };
    }
    const schema = plainObject(schemaValue);
    const version = plainObject(versionValue);
    const formatVersion = typeof schema?.format_version === "string" ? schema.format_version : "";
    const format = FORMAT_VERSION.exec(formatVersion);
    if (format === null) return { status: "unavailable", reason: "malformed-response" };
    if (format[1] !== "1") return { status: "unavailable", reason: "unsupported-format" };
    const providerSchemas = schema?.provider_schemas === undefined ? {} : plainObject(schema.provider_schemas);
    const providerSelections = plainObject(version?.provider_selections);
    const terraformVersion = typeof version?.terraform_version === "string" ? version.terraform_version : "";
    if (providerSchemas === null || providerSelections === null || !VERSION.test(terraformVersion)) {
      return { status: "unavailable", reason: "malformed-response" };
    }

    const providers: TerraformInstalledProvider[] = [];
    for (const source of Object.keys(providerSchemas).sort()) {
      const providerSchema = plainObject(providerSchemas[source]);
      const selectedVersion = providerSelections[source];
      const builtIn = source === "terraform.io/builtin/terraform";
      if (!validSchemaProviderSource(source) || providerSchema === null) {
        return { status: "unavailable", reason: "version-mismatch" };
      }
      if (!builtIn && (typeof selectedVersion !== "string" || !VERSION.test(selectedVersion))) {
        return { status: "unavailable", reason: "version-mismatch" };
      }
      if (builtIn && selectedVersion !== undefined) {
        return { status: "unavailable", reason: "version-mismatch" };
      }
      const resources = sortedSchemaKeys(providerSchema.resource_schemas);
      const dataSources = sortedSchemaKeys(providerSchema.data_source_schemas);
      const listResources =
        providerSchema.list_resource_schemas === undefined
          ? []
          : sortedSchemaKeys(providerSchema.list_resource_schemas);
      if (
        resources === null ||
        dataSources === null ||
        listResources === null ||
        schemaRepresentation(providerSchema.provider) === null
      ) {
        return { status: "unavailable", reason: "malformed-response" };
      }
      providers.push({
        source,
        version: builtIn ? null : (selectedVersion as string),
        schema: structuredClone(providerSchema),
        resources,
        dataSources,
        listResources,
      });
    }
    return { status: "ok", value: { formatVersion, terraformVersion, providers } };
  }
}
