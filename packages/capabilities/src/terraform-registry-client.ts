const REGISTRY_ORIGIN = "https://registry.terraform.io";
const IDENTIFIER = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]+$/u;
const MAX_IDENTIFIER_LENGTH = 100;
const MAX_VERSION_LENGTH = 200;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_CACHE_TTL_MS = 3_600_000;
const MAX_RETRY_DELAY_MS = 10_000;
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

export type TerraformRegistryUnavailableReason =
  "http" | "malformed-response" | "rate-limited" | "response-too-large" | "timeout" | "transport";

export type TerraformRegistryResult<T> =
  | { readonly status: "ok"; readonly value: T; readonly cached: boolean }
  | { readonly status: "missing"; readonly note: string; readonly cached: boolean }
  | { readonly status: "invalid"; readonly note: string }
  | { readonly status: "unavailable"; readonly reason: TerraformRegistryUnavailableReason; readonly note: string };

export interface TerraformModuleSummary {
  readonly id: string;
  readonly namespace: string;
  readonly name: string;
  readonly provider: string;
  readonly version: string;
  readonly description: string;
  readonly verified: boolean;
  readonly downloads: number;
}

export interface TerraformModuleSearchResult {
  readonly modules: readonly TerraformModuleSummary[];
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly limit: number;
}

export interface TerraformModuleDetails extends TerraformModuleSummary {
  readonly source: string;
}

export interface TerraformVersionResult {
  readonly versions: readonly string[];
  readonly latestStable: string | null;
}

export interface TerraformRegistryClientOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly cacheTtlMs?: number;
  readonly maxCacheEntries?: number;
  readonly retries?: number;
  readonly retryDelayMs?: number;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly result: TerraformRegistryResult<unknown>;
}

interface ParsedSemver {
  readonly value: string;
  readonly major: bigint;
  readonly minor: bigint;
  readonly patch: bigint;
  readonly prerelease: string | null;
}

function invalid<T>(note: string): TerraformRegistryResult<T> {
  return { status: "invalid", note };
}

function identifier(value: string, label: string): string | TerraformRegistryResult<never> {
  return value.length <= MAX_IDENTIFIER_LENGTH && value !== "." && value !== ".." && IDENTIFIER.test(value)
    ? value
    : invalid(`${label} must be a Terraform Registry identifier`);
}

function parseSemver(value: string): ParsedSemver | null {
  if (value.length > MAX_VERSION_LENGTH) return null;
  const match = SEMVER.exec(value);
  if (match === null) return null;
  return {
    value,
    major: BigInt(match[1]!),
    minor: BigInt(match[2]!),
    patch: BigInt(match[3]!),
    prerelease: match[4] ?? null,
  };
}

function compareStableVersions(left: ParsedSemver, right: ParsedSemver): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] < right[key]) return 1;
    if (left[key] > right[key]) return -1;
  }
  return right.value.localeCompare(left.value);
}

function stableVersions(values: readonly string[]): readonly string[] | null {
  const parsed = values.map(parseSemver);
  if (parsed.some((value) => value === null)) return null;
  return [
    ...new Map(
      (parsed as ParsedSemver[]).filter(({ prerelease }) => prerelease === null).map((value) => [value.value, value]),
    ).values(),
  ]
    .sort(compareStableVersions)
    .map(({ value }) => value);
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

async function boundedText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (response.body === null) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new RangeError("response-too-large");
    return text;
  }
  const reader = response.body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RangeError("response-too-large");
      }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Error responses are already unavailable; cleanup failures do not replace that result.
  }
}

function moduleSummary(value: unknown): TerraformModuleSummary | null {
  const row = plainObject(value);
  if (row === null) return null;
  const id = stringValue(row.id);
  const namespace = stringValue(row.namespace);
  const name = stringValue(row.name);
  const provider = stringValue(row.provider);
  const version = stringValue(row.version);
  const description = stringValue(row.description);
  const downloads = nonNegativeInteger(row.downloads);
  if (
    id === null ||
    namespace === null ||
    name === null ||
    provider === null ||
    version === null ||
    description === null ||
    downloads === null ||
    typeof row.verified !== "boolean"
  ) {
    return null;
  }
  if (
    typeof identifier(namespace, "namespace") !== "string" ||
    typeof identifier(name, "name") !== "string" ||
    typeof identifier(provider, "provider") !== "string" ||
    parseSemver(version) === null ||
    id !== `${namespace}/${name}/${provider}/${version}`
  ) {
    return null;
  }
  return { id, namespace, name, provider, version, description, downloads, verified: row.verified };
}

export class TerraformRegistryClient {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #cacheTtlMs: number;
  readonly #maxCacheEntries: number;
  readonly #retries: number;
  readonly #retryDelayMs: number;
  readonly #cache = new Map<string, CacheEntry>();

  constructor(options: TerraformRegistryClientOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
    this.#cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.#maxCacheEntries = options.maxCacheEntries ?? 128;
    this.#retries = options.retries ?? 1;
    this.#retryDelayMs = options.retryDelayMs ?? 250;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs <= 0 ||
      this.#timeoutMs > MAX_TIMEOUT_MS ||
      !Number.isSafeInteger(this.#maxResponseBytes) ||
      this.#maxResponseBytes <= 0 ||
      this.#maxResponseBytes > MAX_RESPONSE_BYTES ||
      !Number.isSafeInteger(this.#cacheTtlMs) ||
      this.#cacheTtlMs < 0 ||
      this.#cacheTtlMs > MAX_CACHE_TTL_MS ||
      !Number.isSafeInteger(this.#maxCacheEntries) ||
      this.#maxCacheEntries < 1 ||
      this.#maxCacheEntries > 1_024 ||
      !Number.isSafeInteger(this.#retries) ||
      this.#retries < 0 ||
      this.#retries > 3 ||
      !Number.isSafeInteger(this.#retryDelayMs) ||
      this.#retryDelayMs < 0 ||
      this.#retryDelayMs > MAX_RETRY_DELAY_MS
    ) {
      throw new TypeError("Terraform Registry client bounds are invalid");
    }
  }

  async searchModules(
    query: string,
    options: { readonly offset?: number; readonly limit?: number } = {},
  ): Promise<TerraformRegistryResult<TerraformModuleSearchResult>> {
    const normalizedQuery = query.trim();
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;
    if (normalizedQuery.length === 0 || normalizedQuery.length > 100)
      return invalid("query must contain 1-100 characters");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000)
      return invalid("offset must be between 0 and 1000");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return invalid("limit must be between 1 and 50");
    const params = new URLSearchParams({ q: normalizedQuery, offset: String(offset), limit: String(limit) });
    return await this.#request(`/v1/modules/search?${params}`, (body) => {
      const root = plainObject(body);
      const metadata = plainObject(root?.meta);
      if (root === null || metadata === null || !Array.isArray(root.modules)) return null;
      const modules = root.modules.map(moduleSummary);
      const currentOffset = nonNegativeInteger(metadata.current_offset);
      const responseLimit = nonNegativeInteger(metadata.limit);
      const rawNextOffset = metadata.next_offset;
      const nextOffset =
        rawNextOffset === null || rawNextOffset === undefined ? null : nonNegativeInteger(rawNextOffset);
      if (
        modules.some((module) => module === null) ||
        currentOffset === null ||
        responseLimit === null ||
        currentOffset !== offset ||
        responseLimit < 1 ||
        responseLimit > limit ||
        modules.length > responseLimit ||
        (nextOffset === null && rawNextOffset !== null && rawNextOffset !== undefined) ||
        (nextOffset !== null && (nextOffset <= currentOffset || nextOffset > 1_000))
      ) {
        return null;
      }
      return { modules: modules as TerraformModuleSummary[], offset: currentOffset, nextOffset, limit: responseLimit };
    });
  }

  async getModuleDetails(
    namespace: string,
    name: string,
    provider: string,
    version: string,
  ): Promise<TerraformRegistryResult<TerraformModuleDetails>> {
    const parts = [identifier(namespace, "namespace"), identifier(name, "name"), identifier(provider, "provider")];
    if (parts.some((part) => typeof part !== "string")) return parts.find((part) => typeof part !== "string")!;
    if (version.length > MAX_VERSION_LENGTH || parseSemver(version) === null) {
      return invalid("version must be a bounded exact semantic version");
    }
    return await this.#request(`/v1/modules/${parts.join("/")}/${version}`, (body) => {
      const summary = moduleSummary(body);
      const source = stringValue(plainObject(body)?.source);
      const expectedId = `${namespace}/${name}/${provider}/${version}`;
      return summary === null ||
        source === null ||
        summary.namespace.toLowerCase() !== namespace.toLowerCase() ||
        summary.name.toLowerCase() !== name.toLowerCase() ||
        summary.provider.toLowerCase() !== provider.toLowerCase() ||
        summary.version !== version ||
        summary.id.toLowerCase() !== expectedId.toLowerCase()
        ? null
        : { ...summary, source };
    });
  }

  async getModuleVersions(
    namespace: string,
    name: string,
    provider: string,
  ): Promise<TerraformRegistryResult<TerraformVersionResult>> {
    return await this.#versions(`/v1/modules/${namespace}/${name}/${provider}/versions`, [namespace, name, provider], {
      shape: "modules",
      expectedSource: `${namespace}/${name}/${provider}`,
    });
  }

  async getProviderVersions(namespace: string, name: string): Promise<TerraformRegistryResult<TerraformVersionResult>> {
    return await this.#versions(`/v1/providers/${namespace}/${name}/versions`, [namespace, name], {
      shape: "versions",
      expectedSource: `${namespace}/${name}`,
    });
  }

  async #versions(
    path: string,
    segments: readonly string[],
    options: { readonly shape: "modules" | "versions"; readonly expectedSource?: string },
  ): Promise<TerraformRegistryResult<TerraformVersionResult>> {
    for (const [index, segment] of segments.entries()) {
      const checked = identifier(segment, `segment ${index + 1}`);
      if (typeof checked !== "string") return checked;
    }
    return await this.#request(path, (body) => {
      const root = plainObject(body);
      let rawVersions: unknown;
      if (
        options.shape === "versions" &&
        typeof root?.id === "string" &&
        root.id.toLowerCase() === options.expectedSource?.toLowerCase()
      ) {
        rawVersions = root.versions;
      } else if (Array.isArray(root?.modules) && root.modules.length === 1) {
        const module = plainObject(root.modules[0]);
        rawVersions =
          module !== null &&
          typeof module.source === "string" &&
          module.source.toLowerCase() === options.expectedSource?.toLowerCase()
            ? module.versions
            : undefined;
      }
      if (!Array.isArray(rawVersions)) return null;
      const versionValues = rawVersions.map((entry) => stringValue(plainObject(entry)?.version));
      if (versionValues.some((value) => value === null)) return null;
      const versions = stableVersions(versionValues as string[]);
      if (versions === null) return null;
      return { versions, latestStable: versions[0] ?? null };
    });
  }

  async #request<T>(path: string, parse: (body: unknown) => T | null): Promise<TerraformRegistryResult<T>> {
    const url = new URL(path, REGISTRY_ORIGIN);
    if (url.origin !== REGISTRY_ORIGIN) return invalid("Registry request origin is not allowed");
    const cached = this.#cache.get(url.href);
    if (cached !== undefined && cached.expiresAt > this.#now()) {
      return { ...structuredClone(cached.result), cached: true } as TerraformRegistryResult<T>;
    }
    this.#cache.delete(url.href);

    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      const controller = new AbortController();
      let response: Response | undefined;
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DOMException("Registry request timed out", "AbortError"));
        }, this.#timeoutMs);
      });
      try {
        response = await Promise.race([
          this.#fetch(url, {
            method: "GET",
            headers: { accept: "application/json" },
            redirect: "error",
            signal: controller.signal,
          }),
          deadline,
        ]);
        if (response.status === 404) {
          await cancelBody(response);
          return this.#cacheResult(url.href, {
            status: "missing",
            note: "Registry resource was not found",
            cached: false,
          });
        }
        if (response.status === 429) {
          await cancelBody(response);
          if (attempt < this.#retries) {
            await this.#sleep(this.#retryDelayMs * 2 ** attempt);
            continue;
          }
          return { status: "unavailable", reason: "rate-limited", note: "Registry request was rate-limited" };
        }
        if (!response.ok) {
          await cancelBody(response);
          if (response.status >= 500 && attempt < this.#retries) {
            await this.#sleep(this.#retryDelayMs * 2 ** attempt);
            continue;
          }
          return { status: "unavailable", reason: "http", note: `Registry returned HTTP ${response.status}` };
        }
        const text = await Promise.race([boundedText(response, this.#maxResponseBytes, controller.signal), deadline]);
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return { status: "unavailable", reason: "malformed-response", note: "Registry response was not valid JSON" };
        }
        const value = parse(body);
        if (value === null)
          return {
            status: "unavailable",
            reason: "malformed-response",
            note: "Registry response did not match the expected schema",
          };
        return this.#cacheResult(url.href, { status: "ok", value, cached: false });
      } catch (error) {
        if (error instanceof RangeError && error.message === "response-too-large") {
          return {
            status: "unavailable",
            reason: "response-too-large",
            note: "Registry response exceeded the byte limit",
          };
        }
        const timeout = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
        if (attempt < this.#retries) {
          await this.#sleep(this.#retryDelayMs * 2 ** attempt);
          continue;
        }
        return {
          status: "unavailable",
          reason: timeout ? "timeout" : "transport",
          note: timeout ? "Registry request timed out" : "Registry transport was unavailable",
        };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    return { status: "unavailable", reason: "transport", note: "Registry transport was unavailable" };
  }

  #cacheResult<T>(key: string, result: TerraformRegistryResult<T>): TerraformRegistryResult<T> {
    if (this.#cacheTtlMs > 0 && (result.status === "ok" || result.status === "missing")) {
      while (this.#cache.size >= this.#maxCacheEntries) {
        const oldest = this.#cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.#cache.delete(oldest);
      }
      this.#cache.set(key, { expiresAt: this.#now() + this.#cacheTtlMs, result: structuredClone(result) });
    }
    return result;
  }
}
