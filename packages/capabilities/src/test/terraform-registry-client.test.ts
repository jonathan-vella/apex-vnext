import assert from "node:assert/strict";
import test from "node:test";
import { TerraformRegistryClient } from "../terraform-registry-client.js";
import { terraformRegistryFixtures as fixtures } from "./fixtures/terraform-registry.js";

function response(name: keyof typeof fixtures, status = 200): Response {
  return new Response(JSON.stringify(fixtures[name]), { status, headers: { "content-type": "application/json" } });
}

test("searches modules with bounded pagination and caches until expiry", async () => {
  const urls: string[] = [];
  let now = 100;
  const client = new TerraformRegistryClient({
    now: () => now,
    cacheTtlMs: 10,
    fetch: async (input) => {
      urls.push(String(input));
      return response("search");
    },
  });
  const first = await client.searchModules("key vault", { offset: 0, limit: 1 });
  assert.equal(first.status, "ok");
  if (first.status === "ok") {
    assert.equal(first.cached, false);
    assert.equal(first.value.modules[0]?.id, "Azure/avm-res-keyvault-vault/azurerm/0.10.0");
    assert.equal(first.value.nextOffset, 1);
  }
  const cached = await client.searchModules("key vault", { offset: 0, limit: 1 });
  assert.equal(cached.status === "ok" && cached.cached, true);
  now = 111;
  await client.searchModules("key vault", { offset: 0, limit: 1 });
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /^https:\/\/registry\.terraform\.io\/v1\/modules\/search\?/u);
  assert.match(urls[0]!, /q=key\+vault/u);
});

test("treats omitted next_offset as a terminal search page", async () => {
  const terminal = structuredClone(fixtures.search) as Record<string, unknown>;
  delete (terminal.meta as Record<string, unknown>).next_offset;
  const client = new TerraformRegistryClient({ fetch: async () => new Response(JSON.stringify(terminal)) });
  const result = await client.searchModules("key vault", { limit: 1 });
  assert.equal(result.status === "ok" && result.value.nextOffset, null);
});

test("returns module details and stable module/provider versions", async () => {
  const client = new TerraformRegistryClient({
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/providers/")) return response("providerVersions");
      if (url.endsWith("/versions")) return response("moduleVersions");
      return response("details");
    },
  });
  const details = await client.getModuleDetails("Azure", "avm-res-keyvault-vault", "azurerm", "0.10.0");
  assert.equal(details.status === "ok" && details.value.version, "0.10.0");
  const modules = await client.getModuleVersions("Azure", "avm-res-keyvault-vault", "azurerm");
  assert.deepEqual(modules.status === "ok" && modules.value, { versions: ["0.10.0", "0.9.0"], latestStable: "0.10.0" });
  const providers = await client.getProviderVersions("hashicorp", "azurerm");
  assert.deepEqual(providers.status === "ok" && providers.value, {
    versions: ["4.10.0", "4.2.0"],
    latestStable: "4.10.0",
  });
});

test("chains search coordinates into case-normalized module versions", async () => {
  const client = new TerraformRegistryClient({
    fetch: async (input) => (String(input).includes("/search?") ? response("search") : response("moduleVersions")),
  });
  const search = await client.searchModules("key vault", { limit: 1 });
  assert.equal(search.status, "ok");
  if (search.status === "ok") {
    const module = search.value.modules[0]!;
    const versions = await client.getModuleVersions(module.namespace, module.name, module.provider);
    assert.equal(versions.status === "ok" && versions.value.latestStable, "0.10.0");
  }
});

test("accepts Registry-canonical casing for module details", async () => {
  const client = new TerraformRegistryClient({ fetch: async () => response("details") });
  const details = await client.getModuleDetails("azure", "avm-res-keyvault-vault", "AZURERM", "0.10.0");
  assert.equal(details.status === "ok" && details.value.namespace, "Azure");
});

test("rejects mismatched module details and malformed version entries", async () => {
  const mismatched = structuredClone(fixtures.details) as Record<string, unknown>;
  mismatched.namespace = "Other";
  const detailClient = new TerraformRegistryClient({ fetch: async () => new Response(JSON.stringify(mismatched)) });
  const details = await detailClient.getModuleDetails("Azure", "avm-res-keyvault-vault", "azurerm", "0.10.0");
  assert.equal(details.status === "unavailable" && details.reason, "malformed-response");

  const malformed = { versions: [{ version: 42 }] };
  const versionClient = new TerraformRegistryClient({ fetch: async () => new Response(JSON.stringify(malformed)) });
  const versions = await versionClient.getProviderVersions("hashicorp", "azurerm");
  assert.equal(versions.status === "unavailable" && versions.reason, "malformed-response");

  const wrongSource = structuredClone(fixtures.moduleVersions) as unknown as {
    modules: Array<Record<string, unknown>>;
  };
  wrongSource.modules[0]!.source = "Other/different/azurerm";
  const moduleClient = new TerraformRegistryClient({ fetch: async () => new Response(JSON.stringify(wrongSource)) });
  const moduleVersions = await moduleClient.getModuleVersions("Azure", "avm-res-keyvault-vault", "azurerm");
  assert.equal(moduleVersions.status === "unavailable" && moduleVersions.reason, "malformed-response");

  const wrongProvider = structuredClone(fixtures.providerVersions) as { id: string };
  wrongProvider.id = "evil/other";
  const providerClient = new TerraformRegistryClient({
    fetch: async () => new Response(JSON.stringify(wrongProvider)),
  });
  const providerVersions = await providerClient.getProviderVersions("hashicorp", "azurerm");
  assert.equal(providerVersions.status === "unavailable" && providerVersions.reason, "malformed-response");

  const oversizedVersion = {
    id: "hashicorp/azurerm",
    versions: [{ version: `1.0.0+${"x".repeat(201)}` }],
  };
  const oversizedClient = new TerraformRegistryClient({
    fetch: async () => new Response(JSON.stringify(oversizedVersion)),
  });
  const oversized = await oversizedClient.getProviderVersions("hashicorp", "azurerm");
  assert.equal(oversized.status === "unavailable" && oversized.reason, "malformed-response");
});

test("uses SemVer precedence and accepts stable build metadata", async () => {
  const body = {
    id: "hashicorp/azurerm",
    versions: [
      { version: "1.2.3+build.1" },
      { version: "1.10.0" },
      { version: "1.10.0-alpha+build.2" },
      { version: "2.0.0" },
    ],
  };
  const client = new TerraformRegistryClient({ fetch: async () => new Response(JSON.stringify(body)) });
  const versions = await client.getProviderVersions("hashicorp", "azurerm");
  assert.deepEqual(versions.status === "ok" && versions.value, {
    versions: ["2.0.0", "1.10.0", "1.2.3+build.1"],
    latestStable: "2.0.0",
  });
  const details = await client.getModuleDetails("Azure", "module", "azurerm", "01.2.3");
  assert.equal(details.status, "invalid");
});

test("orders arbitrary-precision SemVer components exactly", async () => {
  const body = {
    id: "hashicorp/azurerm",
    versions: [{ version: "9999999999999999999.0.0" }, { version: "10000000000000000000.0.0" }],
  };
  const client = new TerraformRegistryClient({ fetch: async () => new Response(JSON.stringify(body)) });
  const versions = await client.getProviderVersions("hashicorp", "azurerm");
  assert.equal(versions.status === "ok" && versions.value.latestStable, "10000000000000000000.0.0");
});

test("distinguishes missing, invalid, rate-limited, and malformed responses", async () => {
  let calls = 0;
  const missing = new TerraformRegistryClient({ fetch: async () => new Response("", { status: 404 }) });
  assert.equal((await missing.getProviderVersions("hashicorp", "missing")).status, "missing");
  assert.equal((await missing.getProviderVersions("bad/path", "name")).status, "invalid");

  const limited = new TerraformRegistryClient({
    retries: 1,
    retryDelayMs: 0,
    sleep: async () => undefined,
    fetch: async () => {
      calls += 1;
      return new Response("", { status: 429 });
    },
  });
  const rateLimited = await limited.searchModules("module");
  assert.equal(rateLimited.status === "unavailable" && rateLimited.reason, "rate-limited");
  assert.equal(calls, 2);

  const malformed = new TerraformRegistryClient({ fetch: async () => new Response("{}") });
  const result = await malformed.searchModules("module");
  assert.equal(result.status === "unavailable" && result.reason, "malformed-response");

  const invalidJson = new TerraformRegistryClient({ fetch: async () => new Response("not-json") });
  const invalidJsonResult = await invalidJson.searchModules("module");
  assert.equal(invalidJsonResult.status === "unavailable" && invalidJsonResult.reason, "malformed-response");
});

test("fails closed on timeout and response byte limits", async () => {
  const timeout = new TerraformRegistryClient({
    timeoutMs: 1,
    retries: 0,
    fetch: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      }),
  });
  const timedOut = await timeout.searchModules("module");
  assert.equal(timedOut.status === "unavailable" && timedOut.reason, "timeout");

  const oversized = new TerraformRegistryClient({ maxResponseBytes: 10, fetch: async () => response("search") });
  const tooLarge = await oversized.searchModules("module");
  assert.equal(tooLarge.status === "unavailable" && tooLarge.reason, "response-too-large");
});

test("does not await non-cooperative oversized-body cancellation", async () => {
  let canceled = false;
  const client = new TerraformRegistryClient({
    maxResponseBytes: 1,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("too large"));
          },
          cancel() {
            canceled = true;
            return new Promise<void>(() => undefined);
          },
        }),
      ),
  });

  const result = await client.searchModules("module");
  assert.equal(result.status === "unavailable" && result.reason, "response-too-large");
  assert.equal(canceled, true);
});

test("times out non-cooperative fetch and response streams", async () => {
  const stalledFetch = new TerraformRegistryClient({
    timeoutMs: 5,
    retries: 0,
    fetch: async () => await new Promise<Response>(() => undefined),
  });
  const fetchResult = await stalledFetch.searchModules("module");
  assert.equal(fetchResult.status === "unavailable" && fetchResult.reason, "timeout");

  let canceled = 0;
  const stalledBody = new TerraformRegistryClient({
    timeoutMs: 5,
    retries: 0,
    fetch: async () =>
      new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => undefined);
          },
          cancel() {
            canceled += 1;
          },
        }),
      ),
  });
  const bodyResult = await stalledBody.searchModules("module");
  assert.equal(bodyResult.status === "unavailable" && bodyResult.reason, "timeout");
  assert.equal(canceled, 1);
});

test("does not await non-cooperative error-body cancellation", async () => {
  const client = new TerraformRegistryClient({
    timeoutMs: 5,
    retries: 0,
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            return new Promise(() => undefined);
          },
        }),
        { status: 404 },
      ),
  });
  const result = await client.getProviderVersions("hashicorp", "missing");
  assert.equal(result.status, "missing");
});

test("rejects unbounded response pagination and cancels retry bodies", async () => {
  const unbounded = structuredClone(fixtures.search) as Record<string, unknown>;
  (unbounded.meta as Record<string, unknown>).next_offset = 1001;
  const pagination = new TerraformRegistryClient({ fetch: async () => new Response(JSON.stringify(unbounded)) });
  const invalidPage = await pagination.searchModules("module", { limit: 1 });
  assert.equal(invalidPage.status === "unavailable" && invalidPage.reason, "malformed-response");

  let canceled = 0;
  const throttled = new TerraformRegistryClient({
    retries: 1,
    retryDelayMs: 0,
    sleep: async () => undefined,
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled += 1;
          },
        }),
        { status: 429 },
      ),
  });
  await throttled.searchModules("module");
  assert.equal(canceled, 2);
});

test("rejects invalid identifiers in search responses", async () => {
  const invalid = structuredClone(fixtures.search) as unknown as { modules: Array<Record<string, unknown>> };
  const module = invalid.modules[0]!;
  module.namespace = "..";
  module.id = `../${String(module.name)}/${String(module.provider)}/${String(module.version)}`;
  const client = new TerraformRegistryClient({ fetch: async () => new Response(JSON.stringify(invalid)) });
  const result = await client.searchModules("module", { limit: 1 });
  assert.equal(result.status === "unavailable" && result.reason, "malformed-response");
});

test("rejects invalid constructor and request bounds without transport", async () => {
  assert.throws(() => new TerraformRegistryClient({ retries: 4 }), /bounds are invalid/u);
  assert.throws(() => new TerraformRegistryClient({ maxCacheEntries: 0 }), /bounds are invalid/u);
  for (const options of [
    { timeoutMs: 60_001 },
    { maxResponseBytes: 5_000_001 },
    { cacheTtlMs: 3_600_001 },
    { retryDelayMs: 10_001 },
  ]) {
    assert.throws(() => new TerraformRegistryClient(options), /bounds are invalid/u);
  }
  let calls = 0;
  const client = new TerraformRegistryClient({
    fetch: async () => {
      calls += 1;
      return response("search");
    },
  });
  assert.equal((await client.searchModules("", { limit: 51 })).status, "invalid");
  assert.equal((await client.getModuleDetails("../bad", "name", "provider", "latest")).status, "invalid");
  assert.equal((await client.getProviderVersions("..", "name")).status, "invalid");
  assert.equal((await client.getProviderVersions(".", "name")).status, "invalid");
  assert.equal((await client.getProviderVersions("x".repeat(101), "name")).status, "invalid");
  assert.equal(
    (await client.getModuleDetails("Azure", "module", "azurerm", `1.0.0+${"x".repeat(201)}`)).status,
    "invalid",
  );
  assert.equal(calls, 0);
});

test("bounds cache entries and exposes no lifecycle or arbitrary URL methods", async () => {
  const urls: string[] = [];
  const client = new TerraformRegistryClient({
    maxCacheEntries: 1,
    fetch: async (input) => {
      urls.push(String(input));
      return response("search");
    },
  });
  await client.searchModules("first");
  await client.searchModules("second");
  await client.searchModules("first");
  assert.equal(urls.length, 3);
  assert.deepEqual(Object.getOwnPropertyNames(TerraformRegistryClient.prototype).sort(), [
    "constructor",
    "getModuleDetails",
    "getModuleVersions",
    "getProviderVersions",
    "searchModules",
  ]);
});

test("isolates cached values from caller mutation", async () => {
  const client = new TerraformRegistryClient({ fetch: async () => response("providerVersions") });
  const first = await client.getProviderVersions("hashicorp", "azurerm");
  assert.equal(first.status, "ok");
  if (first.status === "ok") {
    (first.value.versions as string[])[0] = "not-semver";
  }
  const cached = await client.getProviderVersions("hashicorp", "azurerm");
  assert.equal(cached.status === "ok" && cached.value.versions[0], "4.10.0");
});
