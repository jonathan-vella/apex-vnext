import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProcessRunnerError } from "../process-runner.js";
import {
  TerraformProviderIntrospection,
  type TerraformDocumentationRequest,
  type TerraformMetadataRequest,
  type TerraformMetadataRunnerLike,
  type TerraformSchemaSelector,
} from "../terraform-provider-schema.js";
import { terraformProviderSchemaFixture as fixture } from "./fixtures/terraform-provider-schema.js";

class FixtureRunner implements TerraformMetadataRunnerLike {
  readonly requests: TerraformMetadataRequest[] = [];

  constructor(
    readonly schema: unknown = fixture.schema,
    readonly version: unknown = fixture.version,
  ) {}

  async run(request: TerraformMetadataRequest): Promise<string> {
    this.requests.push(request);
    return JSON.stringify(request.plan.args[0] === "providers" ? this.schema : this.version);
  }
}

test("inspects installed schemas with exact bounded native commands", async () => {
  const runner = new FixtureRunner();
  const client = new TerraformProviderIntrospection({ runner, timeoutMs: 123, maxOutputBytes: 456 });
  const result = await client.inspect("/iac");
  assert.equal(result.status, "ok");
  assert.deepEqual(
    runner.requests.map(({ plan, timeoutMs, maxOutputBytes }) => ({ plan, timeoutMs, maxOutputBytes })),
    [
      {
        plan: { executable: "terraform", args: ["providers", "schema", "-json"], cwd: "/iac" },
        timeoutMs: 123,
        maxOutputBytes: 456,
      },
      {
        plan: { executable: "terraform", args: ["version", "-json"], cwd: "/iac" },
        timeoutMs: 123,
        maxOutputBytes: 456,
      },
    ],
  );
  if (result.status === "ok") {
    assert.deepEqual(result.value.providers[0]?.resources, ["azurerm_storage_account"]);
    assert.equal(
      ((result.value.providers[0]?.schema.provider as Record<string, unknown>).block as Record<string, unknown>) !==
        undefined,
      true,
    );
    assert.equal(JSON.stringify(result.value).includes("client_secret"), true);
    assert.equal(JSON.stringify(result.value).includes("future_field"), true);
  }
});

test("selects exact schemas and distinguishes missing resources", async () => {
  const client = new TerraformProviderIntrospection({ runner: new FixtureRunner() });
  const selected = await client.select("/iac", {
    providerSource: "registry.terraform.io/hashicorp/azurerm",
    kind: "resource",
    name: "azurerm_storage_account",
  });
  assert.equal(selected.status === "ok" && selected.value.version, "4.81.0");
  assert.equal(
    (
      await client.select("/iac", {
        providerSource: "registry.terraform.io/hashicorp/azurerm",
        kind: "resource",
        name: "azurerm_missing",
      })
    ).status,
    "missing",
  );
});

test("routes explicit slugs to version-pinned official documentation", async () => {
  const client = new TerraformProviderIntrospection({ runner: new FixtureRunner() });
  const result = await client.documentation("/iac", {
    providerSource: "registry.terraform.io/hashicorp/azurerm",
    kind: "resources",
    schemaName: "azurerm_storage_account",
    slug: "storage_account",
  });
  assert.equal(
    result.status === "ok" && result.value.url,
    "https://registry.terraform.io/providers/hashicorp/azurerm/4.81.0/docs/resources/storage_account",
  );

  const listResult = await client.documentation("/iac", {
    providerSource: "registry.terraform.io/hashicorp/azurerm",
    kind: "list-resources",
    schemaName: "azurerm_storage_account",
    slug: "storage_account",
  });
  assert.equal(
    listResult.status === "ok" && listResult.value.url,
    "https://registry.terraform.io/providers/hashicorp/azurerm/4.81.0/docs/list-resources/storage_account",
  );
});

test("fails closed on invalid input without starting Terraform", async () => {
  const runner = new FixtureRunner();
  const client = new TerraformProviderIntrospection({ runner });
  assert.equal((await client.inspect("")).status, "invalid");
  assert.equal((await client.inspect("bad\0cwd")).status, "invalid");
  assert.equal(
    (
      await client.select("/iac", {
        providerSource: "https://example.com/hashicorp/azurerm",
        kind: "resource",
        name: "azurerm_storage_account",
      })
    ).status,
    "invalid",
  );
  assert.equal(
    (
      await client.documentation("/iac", {
        providerSource: "registry.terraform.io/hashicorp/azurerm",
        kind: "resources",
        schemaName: "azurerm_storage_account",
        slug: "../unsafe",
      })
    ).status,
    "invalid",
  );
  assert.equal(runner.requests.length, 0);
  assert.throws(() => new TerraformProviderIntrospection({ timeoutMs: 60_001 }), /bounds are invalid/u);
  assert.throws(() => new TerraformProviderIntrospection({ maxOutputBytes: 50_000_001 }), /bounds are invalid/u);
});

test("rejects runtime-invalid selector and documentation values", async () => {
  const runner = new FixtureRunner();
  const client = new TerraformProviderIntrospection({ runner });
  assert.equal(
    (
      await client.select("/iac", {
        providerSource: "registry.terraform.io/hashicorp/azurerm",
        kind: "unknown" as "resource",
        name: "azurerm_storage_account",
      })
    ).status,
    "invalid",
  );
  assert.equal(
    (
      await client.select("/iac", {
        providerSource: "registry.terraform.io/hashicorp/azurerm",
        kind: "provider",
        name: "unexpected",
      })
    ).status,
    "invalid",
  );
  assert.equal(
    (
      await client.documentation("/iac", {
        providerSource: "registry.terraform.io/hashicorp/azurerm",
        kind: "unknown" as "resources",
        schemaName: "azurerm_storage_account",
        slug: "storage_account",
      })
    ).status,
    "invalid",
  );
  assert.equal((await client.inspect(null as unknown as string)).status, "invalid");
  assert.equal((await client.select("/iac", null as unknown as TerraformSchemaSelector)).status, "invalid");
  assert.equal(
    (
      await client.select("/iac", {
        providerSource: 42 as unknown as string,
        kind: "resource",
        name: "azurerm_storage_account",
      })
    ).status,
    "invalid",
  );
  assert.equal(
    (await client.documentation("/iac", null as unknown as TerraformDocumentationRequest)).status,
    "invalid",
  );
  assert.equal(
    (
      await client.documentation("/iac", {
        providerSource: "registry.terraform.io/hashicorp/azurerm",
        kind: "resources",
        schemaName: "azurerm_storage_account",
        slug: null as unknown as string,
      })
    ).status,
    "invalid",
  );
  assert.equal(runner.requests.length, 0);
});

test("treats a valid provider-free root as an empty installed schema set", async () => {
  const result = await new TerraformProviderIntrospection({
    runner: new FixtureRunner({ format_version: "1.0" }, { terraform_version: "1.15.8", provider_selections: {} }),
  }).inspect("/iac");
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.deepEqual(result.value.providers, []);
});

test("accepts built-in providers and ignores unrelated installed selections", async () => {
  const schema = structuredClone(fixture.schema) as {
    provider_schemas: Record<string, Record<string, unknown>>;
  };
  schema.provider_schemas["terraform.io/builtin/terraform"] = {
    provider: { version: 0, block: { attributes: {} } },
    resource_schemas: { terraform_data: { version: 0, block: { attributes: {} } } },
    data_source_schemas: {},
  };
  const version = structuredClone(fixture.version) as { provider_selections: Record<string, string> };
  version.provider_selections["registry.terraform.io/hashicorp/random"] = "3.7.2";
  const result = await new TerraformProviderIntrospection({ runner: new FixtureRunner(schema, version) }).inspect(
    "/iac",
  );
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(
      result.value.providers.find(({ source }) => source === "terraform.io/builtin/terraform")?.version,
      null,
    );
  }
});

test("rejects malformed, unsupported, and inconsistent native output", async () => {
  const malformed = new TerraformProviderIntrospection({
    runner: { run: async () => "not json" },
  });
  assert.equal((await malformed.inspect("/iac")).status, "unavailable");

  const unsupported = structuredClone(fixture.schema) as { format_version: string };
  unsupported.format_version = "2.0";
  const unsupportedResult = await new TerraformProviderIntrospection({
    runner: new FixtureRunner(unsupported),
  }).inspect("/iac");
  assert.equal(unsupportedResult.status === "unavailable" && unsupportedResult.reason, "unsupported-format");

  const mismatched = structuredClone(fixture.version) as { provider_selections: Record<string, string> };
  mismatched.provider_selections = {};
  const mismatchResult = await new TerraformProviderIntrospection({
    runner: new FixtureRunner(fixture.schema, mismatched),
  }).inspect("/iac");
  assert.equal(mismatchResult.status === "unavailable" && mismatchResult.reason, "version-mismatch");

  for (const collection of ["resource_schemas", "data_source_schemas", "list_resource_schemas"] as const) {
    const malformedSchema = structuredClone(fixture.schema) as {
      provider_schemas: Record<string, Record<string, Record<string, unknown>>>;
    };
    malformedSchema.provider_schemas["registry.terraform.io/hashicorp/azurerm"]![collection] = {
      malformed: 42,
    } as never;
    const malformedResult = await new TerraformProviderIntrospection({
      runner: new FixtureRunner(malformedSchema),
    }).inspect("/iac");
    assert.equal(malformedResult.status === "unavailable" && malformedResult.reason, "malformed-response");
  }
});

test("waits for both bounded metadata operations before returning failure", async () => {
  let siblingCompleted = false;
  const client = new TerraformProviderIntrospection({
    runner: {
      async run(request) {
        if (request.plan.args[0] === "providers") {
          throw new ProcessRunnerError("PROCESS_EXIT_NONZERO", "failed");
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        siblingCompleted = true;
        return JSON.stringify(fixture.version);
      },
    },
  });
  const result = await client.inspect("/iac");
  assert.equal(result.status === "unavailable" && result.reason, "process-exit");
  assert.equal(siblingCompleted, true);
});

test("strips ambient Terraform argument injection from spawned metadata commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apex-terraform-metadata-"));
  const executable = join(directory, "terraform");
  const script = `#!/usr/bin/env node
if (Object.keys(process.env).some((key) => key.toUpperCase().startsWith("TF_CLI_ARGS"))) process.exit(91);
const schema = ${JSON.stringify(fixture.schema)};
const version = ${JSON.stringify(fixture.version)};
process.stdout.write(JSON.stringify(process.argv[2] === "providers" ? schema : version));
`;
  await writeFile(executable, script, "utf8");
  await chmod(executable, 0o700);
  const priorPath = process.env.PATH;
  const priorArgs = process.env.TF_CLI_ARGS;
  const priorVersionArgs = process.env.TF_CLI_ARGS_version;
  try {
    process.env.PATH = `${directory}:${priorPath ?? ""}`;
    process.env.TF_CLI_ARGS = "-no-color";
    process.env.TF_CLI_ARGS_version = "-invalid";
    const result = await new TerraformProviderIntrospection().inspect(directory);
    assert.equal(result.status, "ok");
  } finally {
    process.env.PATH = priorPath;
    if (priorArgs === undefined) delete process.env.TF_CLI_ARGS;
    else process.env.TF_CLI_ARGS = priorArgs;
    if (priorVersionArgs === undefined) delete process.env.TF_CLI_ARGS_version;
    else process.env.TF_CLI_ARGS_version = priorVersionArgs;
    await rm(directory, { recursive: true, force: true });
  }
});

test("maps bounded process failures without exposing ambient errors", async () => {
  for (const [code, reason] of [
    ["PROCESS_EXIT_NONZERO", "process-exit"],
    ["PROCESS_OUTPUT_LIMIT", "output-limit"],
    ["PROCESS_SPAWN_ERROR", "spawn"],
    ["PROCESS_TIMEOUT", "timeout"],
  ] as const) {
    const client = new TerraformProviderIntrospection({
      runner: { run: async () => Promise.reject(new ProcessRunnerError(code, "ambient secret")) },
    });
    const result = await client.inspect("/iac");
    assert.equal(result.status === "unavailable" && result.reason, reason);
    assert.equal(JSON.stringify(result).includes("ambient secret"), false);
  }
});

test("exposes no Terraform lifecycle or arbitrary command surface", () => {
  assert.deepEqual(Object.getOwnPropertyNames(TerraformProviderIntrospection.prototype).sort(), [
    "constructor",
    "documentation",
    "inspect",
    "select",
  ]);
});
