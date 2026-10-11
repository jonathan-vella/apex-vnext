import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { AZD_ENVIRONMENT_KEYS, hasValidAzdBinding } from "@apexops/contracts";
import {
  assertAzdBindingUnchanged,
  AzdBindingError,
  describeAzdBinding,
  inspectAzdBicepProject,
  type AzdBindingErrorCode,
  type AzdBindingRequest,
} from "../index.js";

const SUBSCRIPTION = "11111111-2222-3333-4444-555555555555";

const baseFiles = (): Record<string, string> => ({
  "azure.yaml": "name: demo\ninfra:\n  provider: bicep\n  path: infra\n",
  "infra/main.bicep": "targetScope = 'resourceGroup'\nparam location string\nparam name string\n",
  "infra/bicepconfig.json": '{"experimentalFeaturesEnabled":{"symbolicNameCodegen":true}}\n',
  "infra/main.parameters.json": JSON.stringify({
    $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: { location: { value: "${AZURE_LOCATION}" }, name: { value: "app-${AZURE_ENV_NAME}" } },
  }),
  ".azure/lab/.env": [
    "# azd environment",
    'AZURE_ENV_NAME="lab"',
    `AZURE_SUBSCRIPTION_ID="${SUBSCRIPTION}"`,
    'AZURE_LOCATION="swedencentral"',
    'AZURE_PRINCIPAL_ID="aaaaaaaa-0000-0000-0000-000000000001"',
  ].join("\n"),
  "hooks/pre.sh": "#!/bin/sh\necho preparing\n",
  "hooks/post.sh": "#!/bin/sh\necho done\n",
});

async function fixture(
  overrides: Record<string, string | null> = {},
): Promise<{ root: string; request: AzdBindingRequest }> {
  const root = await mkdtemp(join(tmpdir(), "apex-azd-binding-"));
  const files: Record<string, string | null> = { ...baseFiles(), ...overrides };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return {
    root,
    request: {
      projectId: "demo",
      runId: "run-1",
      projectRoot: root,
      environmentName: "lab",
      azdVersion: "1.35.1",
      target: { subscriptionId: SUBSCRIPTION, location: "swedencentral" },
      extensionDigests: {},
    },
  };
}

async function inspect(
  overrides: Record<string, string | null> = {},
  mutate?: (request: AzdBindingRequest) => AzdBindingRequest,
) {
  const { root, request } = await fixture(overrides);
  try {
    return await inspectAzdBicepProject(mutate === undefined ? request : mutate(request));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function rejects(
  code: AzdBindingErrorCode,
  overrides: Record<string, string | null> = {},
  mutate?: (request: AzdBindingRequest) => AzdBindingRequest,
): Promise<void> {
  await assert.rejects(
    inspect(overrides, mutate),
    (error: unknown) => error instanceof AzdBindingError && error.code === code,
    `expected ${code}`,
  );
}

const DIGESTS = {
  "microsoft.azd.demo": "d".repeat(64),
  "other.ext": "e".repeat(64),
};
const withDigests =
  (...ids: Array<keyof typeof DIGESTS>) =>
  (request: AzdBindingRequest): AzdBindingRequest => ({
    ...request,
    extensionDigests: Object.fromEntries(ids.map((id) => [id, DIGESTS[id]])),
  });

const withHooks = (yaml: string): string => `name: demo\n${yaml}`;
const PRE = "hooks:\n  preprovision:\n    run: hooks/pre.sh\n    shell: sh\n";

test("an unhooked project binds deterministically and persists no environment values", async () => {
  const first = await inspect();
  const second = await inspect();
  assert.equal(hasValidAzdBinding(first), true);
  assert.equal(first.bindingHash, second.bindingHash);
  assert.equal(first.executor, "azd");
  assert.equal(first.track, "bicep");
  assert.deepEqual(
    first.infra.roots.map(({ name, path }) => [name, path]),
    [["default", "infra"]],
  );
  assert.deepEqual(first.environment.keys, [
    "AZURE_ENV_NAME",
    "AZURE_LOCATION",
    "AZURE_PRINCIPAL_ID",
    "AZURE_SUBSCRIPTION_ID",
  ]);
  assert.equal(JSON.stringify(first).includes("aaaaaaaa-0000-0000-0000-000000000001"), false);
  assert.deepEqual([first.hooks, first.extensions], [[], []]);
});

test("every bound input changes the binding hash", async () => {
  const baseline = (await inspect()).bindingHash;
  const hashes = new Map<string, string>();
  const variants: Record<string, Record<string, string | null>> = {
    "azure.yaml whitespace": { "azure.yaml": "name: demo\ninfra:\n  provider: bicep\n  path: infra\n\n" },
    "bicep source": { "infra/main.bicep": "targetScope = 'resourceGroup'\nparam location string\n" },
    "extra infra file": { "infra/modules/extra.bicep": "param x string\n" },
    "parameter value": {
      "infra/main.parameters.json": JSON.stringify({ parameters: { location: { value: "westeurope" } } }),
    },
    "environment value": {
      ".azure/lab/.env": baseFiles()[".azure/lab/.env"]!.replace(
        "aaaaaaaa-0000-0000-0000-000000000001",
        "aaaaaaaa-0000-0000-0000-000000000002",
      ),
    },
    "environment config": { ".azure/lab/config.json": "{}" },
    "added hook": { "azure.yaml": withHooks(`infra:\n  provider: bicep\n${PRE}`) },
  };
  const extension = (
    await inspect(
      { "azure.yaml": withHooks("requiredVersions:\n  extensions:\n    microsoft.azd.demo: 1.2.3\n") },
      withDigests("microsoft.azd.demo"),
    )
  ).bindingHash;
  assert.notEqual(extension, baseline);
  variants["project config"] = { ".azure/config.json": '{"version":1,"defaultEnvironment":"lab"}' };
  for (const [name, overrides] of Object.entries(variants)) {
    const hash = (await inspect(overrides)).bindingHash;
    assert.notEqual(hash, baseline, name);
    hashes.set(name, hash);
  }
  assert.equal(new Set(hashes.values()).size, hashes.size);
});

test("an environment value change alone changes the environment hash but never lists the value", async () => {
  const before = await inspect();
  const after = await inspect({
    ".azure/lab/.env": baseFiles()[".azure/lab/.env"]!.replace(
      "aaaaaaaa-0000-0000-0000-000000000001",
      "aaaaaaaa-0000-0000-0000-000000000003",
    ),
  });
  assert.notEqual(before.environment.valuesHash, after.environment.valuesHash);
  assert.deepEqual(before.environment.keys, after.environment.keys);
  assert.equal(before.parametersHash, after.parametersHash);
});

test("a resolved parameter change is detected even when the parameter file is unchanged", async () => {
  const files = {
    "infra/main.parameters.json": JSON.stringify({ parameters: { suffix: { value: "${AZURE_PRINCIPAL_ID}" } } }),
  };
  const before = await inspect(files);
  const after = await inspect({
    ...files,
    ".azure/lab/.env": baseFiles()[".azure/lab/.env"]!.replace(
      "aaaaaaaa-0000-0000-0000-000000000001",
      "aaaaaaaa-0000-0000-0000-000000000004",
    ),
  });
  assert.equal(before.infra.roots[0]!.parametersFileHash, after.infra.roots[0]!.parametersFileHash);
  assert.notEqual(before.parametersHash, after.parametersHash);
});

test("hooks are inventoried with content hashes and deterministic ordering", async () => {
  const yaml = withHooks(
    [
      "infra:",
      "  provider: bicep",
      "hooks:",
      "  postprovision:",
      "    run: echo finished",
      "  preprovision:",
      "    - run: hooks/pre.sh",
      "      shell: sh",
      "      continueOnError: true",
      "    - windows:",
      "        run: hooks/second.ps1",
      "      posix:",
      "        run: hooks/post.sh",
      "",
    ].join("\n"),
  );
  const binding = await inspect({ "azure.yaml": yaml, "hooks/second.ps1": "Write-Host second\n" });
  assert.deepEqual(
    binding.hooks.map(({ event, order, platform, shell, source, path }) => [
      event,
      order,
      platform,
      shell,
      source,
      path,
    ]),
    [
      ["postprovision", 0, "all", "sh", "inline", undefined],
      ["preprovision", 0, "all", "sh", "script", "hooks/pre.sh"],
      ["preprovision", 1, "posix", "sh", "script", "hooks/post.sh"],
      ["preprovision", 1, "windows", "pwsh", "script", "hooks/second.ps1"],
    ],
  );
  assert.equal(binding.hooks[1]!.continueOnError, true);
  assert.equal(binding.hooks[0]!.contentHash.length, 64);
});

test("hook content, ordering, addition and removal each invalidate the binding", async () => {
  const two = (first: string, second: string): string =>
    withHooks(`hooks:\n  preprovision:\n    - run: ${first}\n      shell: sh\n    - run: ${second}\n      shell: sh\n`);
  const one = withHooks(`hooks:\n  preprovision:\n    - run: hooks/pre.sh\n      shell: sh\n`);
  const ordered = await inspect({ "azure.yaml": two("hooks/pre.sh", "hooks/post.sh") });
  const reordered = await inspect({ "azure.yaml": two("hooks/post.sh", "hooks/pre.sh") });
  const added = await inspect({ "azure.yaml": one });
  const removed = await inspect({ "azure.yaml": withHooks("") });
  const edited = await inspect({ "azure.yaml": one, "hooks/pre.sh": "#!/bin/sh\necho changed\n" });
  const original = await inspect({ "azure.yaml": one });
  assert.notEqual(ordered.bindingHash, reordered.bindingHash);
  assert.notEqual(added.bindingHash, ordered.bindingHash);
  assert.notEqual(removed.bindingHash, added.bindingHash);
  assert.notEqual(edited.bindingHash, original.bindingHash);
  assert.equal(original.bindingHash, added.bindingHash);
  assert.equal(edited.hooks[0]!.path, "hooks/pre.sh");
});

test("inline hook text is bound as content", async () => {
  const inline = (text: string): string => withHooks(`hooks:\n  postprovision:\n    run: |\n      ${text}\n`);
  const first = await inspect({ "azure.yaml": inline("echo one") });
  const second = await inspect({ "azure.yaml": inline("echo two") });
  assert.equal(first.hooks[0]!.source, "inline");
  assert.notEqual(first.hooks[0]!.contentHash, second.hooks[0]!.contentHash);
});

test("layered provisioning is inventoried per layer with layer hooks", async () => {
  const yaml = withHooks(
    [
      "infra:",
      "  layers:",
      "    - name: network",
      "      path: infra/network",
      "      hooks:",
      "        postprovision:",
      "          run: hooks/post.sh",
      "          shell: sh",
      "    - name: workload",
      "      path: infra/workload",
      "      module: app",
      "      dependsOn: [network]",
      "",
    ].join("\n"),
  );
  const files = {
    "azure.yaml": yaml,
    "infra/main.bicep": null,
    "infra/main.parameters.json": null,
    "infra/network/main.bicep": "param x string = 'a'\n",
    "infra/workload/app.bicep": "param y string = 'b'\n",
    "infra/network/bicepconfig.json": "{}\n",
    "infra/workload/bicepconfig.json": "{}\n",
  };
  const binding = await inspect(files);
  assert.equal(binding.infra.layered, true);
  assert.deepEqual(
    binding.infra.roots.map(({ name, module, dependsOn }) => [name, module, dependsOn]),
    [
      ["network", "main", []],
      ["workload", "app", ["network"]],
    ],
  );
  assert.deepEqual(
    binding.hooks.map(({ scope, event }) => [scope, event]),
    [["layer:network", "postprovision"]],
  );
  const changed = await inspect({ ...files, "infra/workload/app.bicep": "param y string = 'c'\n" });
  assert.notEqual(changed.bindingHash, binding.bindingHash);
  const reordered = await inspect({
    ...files,
    "azure.yaml": yaml.replace("dependsOn: [network]", "dependsOn: []"),
  });
  assert.notEqual(reordered.bindingHash, binding.bindingHash);
});

test("exact extension versions are bound and unpinned or non-default sources fail closed", async () => {
  const requirement = (versions: string): string => withHooks(`requiredVersions:\n  extensions:\n${versions}`);
  const both = withDigests("microsoft.azd.demo", "other.ext");
  const binding = await inspect(
    { "azure.yaml": requirement("    microsoft.azd.demo: =1.2.3\n    other.ext: 2.0.0\n") },
    both,
  );
  assert.deepEqual(binding.extensions, [
    { id: "microsoft.azd.demo", version: "1.2.3", source: "azd", installedDigest: DIGESTS["microsoft.azd.demo"] },
    { id: "other.ext", version: "2.0.0", source: "azd", installedDigest: DIGESTS["other.ext"] },
  ]);
  const bumped = await inspect(
    { "azure.yaml": requirement("    microsoft.azd.demo: 1.2.4\n    other.ext: 2.0.0\n") },
    both,
  );
  assert.notEqual(bumped.bindingHash, binding.bindingHash);
  const redigested = await inspect(
    { "azure.yaml": requirement("    microsoft.azd.demo: =1.2.3\n    other.ext: 2.0.0\n") },
    (request) => ({
      ...both(request),
      extensionDigests: { ...both(request).extensionDigests, "other.ext": "f".repeat(64) },
    }),
  );
  assert.notEqual(redigested.bindingHash, binding.bindingHash);
  // The installed digest is a required, well-formed observation for every required extension and only those.
  const declared = { "azure.yaml": requirement("    microsoft.azd.demo: 1.2.3\n") };
  await rejects("AZD_EXTENSION_UNVERIFIED", declared);
  await rejects("AZD_EXTENSION_UNVERIFIED", declared, (request) => ({
    ...request,
    extensionDigests: { "microsoft.azd.demo": "not-a-digest" },
  }));
  await rejects("AZD_EXTENSION_UNVERIFIED", declared, withDigests("microsoft.azd.demo", "other.ext"));
  await rejects("AZD_EXTENSION_UNVERIFIED", {}, withDigests("other.ext"));
  for (const constraint of ["latest", '">=1.0.0"', '"~1.2.0"', "1.2", "1.2.3-beta.1", '""', "null"])
    await rejects("AZD_EXTENSION_UNPINNED", { "azure.yaml": requirement(`    microsoft.azd.demo: ${constraint}\n`) });
  await rejects("AZD_EXTENSION_UNPINNED", { "azure.yaml": requirement("    https://example.com/ext: 1.2.3\n") });
});

test("unsupported project surfaces fail closed with stable codes", async () => {
  const cases: Array<[AzdBindingErrorCode, string]> = [
    ["AZD_PROVIDER_UNSUPPORTED", "infra:\n  provider: terraform\n"],
    ["AZD_PROVIDER_UNSUPPORTED", "infra:\n  provider: microsoft.foundry\n"],
    ["AZD_PROJECT_UNSUPPORTED", "resources:\n  api:\n    type: host.containerapp\n"],
    ["AZD_PROJECT_UNSUPPORTED", "platform:\n  type: devcenter\n"],
    ["AZD_PROJECT_UNSUPPORTED", "cloud:\n  name: AzureUSGovernment\n"],
    ["AZD_PROJECT_UNSUPPORTED", "state:\n  remote:\n    backend: AzureBlobStorage\n"],
    ["AZD_PROJECT_UNSUPPORTED", "unknownSetting: true\n"],
    ["AZD_PROJECT_UNSUPPORTED", "infra:\n  path: infra\n  unknown: 1\n"],
    ["AZD_PROJECT_UNSUPPORTED", "infra:\n  module: ../hooks/pre\n"],
    ["AZD_LAYER_UNSUPPORTED", "infra:\n  layers:\n    - name: a\n      path: infra\n      module: sub/main\n"],
    ["AZD_PATH_UNSAFE", "infra:\n  path: ../outside\n"],
    ["AZD_PATH_UNSAFE", "infra:\n  path: /etc\n"],
    ["AZD_PATH_UNSAFE", "infra:\n  path: .\n"],
    ["AZD_PATH_UNSAFE", "infra:\n  path: .azure\n"],
    ["AZD_PATH_UNSAFE", "infra:\n  path: infra\\\\win\n"],
    ["AZD_ENV_TARGET_MISMATCH", "resourceGroup: other-rg\n"],
    ["AZD_LAYER_UNSUPPORTED", "infra:\n  path: infra\n  layers:\n    - name: a\n      path: infra\n"],
    ["AZD_LAYER_UNSUPPORTED", "infra:\n  layers:\n    - name: default\n      path: infra\n"],
    ["AZD_LAYER_UNSUPPORTED", "infra:\n  layers:\n    - name: a\n      path: infra\n      dependsOn: [missing]\n"],
    ["AZD_LAYER_UNSUPPORTED", "infra:\n  layers:\n    - name: a\n      path: infra\n      config:\n        x: 1\n"],
    ["AZD_PROVIDER_UNSUPPORTED", "infra:\n  layers:\n    - name: a\n      path: infra\n      provider: terraform\n"],
  ];
  for (const [code, yaml] of cases) await rejects(code, { "azure.yaml": withHooks(yaml) });
  await rejects("AZD_LAYER_UNSUPPORTED", {
    "azure.yaml": withHooks(
      "infra:\n  layers:\n    - name: a\n      path: infra\n      dependsOn: [b]\n    - name: b\n      path: infra/b\n      dependsOn: [a]\n",
    ),
    "infra/b/main.bicep": "param x string = 'a'\n",
  });
});

test("unsupported hook surfaces fail closed", async () => {
  const hook = (body: string): string => withHooks(`hooks:\n  preprovision:\n${body}`);
  const cases: Array<[AzdBindingErrorCode, string, Record<string, string | null>?]> = [
    ["AZD_HOOK_UNSUPPORTED", hook("    run: hooks/pre.sh\n    kind: python\n")],
    ["AZD_HOOK_UNSUPPORTED", hook("    run: hooks/pre.sh\n    kind: js\n")],
    ["AZD_HOOK_UNSUPPORTED", hook("    run: hooks/pre.sh\n    shell: zsh\n")],
    ["AZD_HOOK_UNSUPPORTED", hook("    run: hooks/pre.sh\n    shell: sh\n    kind: pwsh\n")],
    ["AZD_HOOK_UNSUPPORTED", hook("    run: hooks/pre.sh\n    secrets:\n      TOKEN: akvs://vault/secret\n")],
    ["AZD_HOOK_UNSUPPORTED", hook("    run: hooks/pre.sh\n    config:\n      x: 1\n")],
    ["AZD_HOOK_UNSUPPORTED", hook("    shell: sh\n")],
    ["AZD_HOOK_UNSUPPORTED", hook("    run: hooks/pre.sh\n    shell: pwsh\n")],
    ["AZD_HOOK_UNSUPPORTED", hook("    run: hooks/tool.bin\n"), { "hooks/tool.bin": "x" }],
    ["AZD_HOOK_UNSUPPORTED", withHooks("hooks:\n  postbuild:\n    run: echo hi\n")],
    ["AZD_HOOK_SCRIPT_INVALID", hook("    run: hooks/missing.sh\n")],
    ["AZD_HOOK_SCRIPT_INVALID", hook("    run: /usr/bin/true.sh\n")],
    ["AZD_HOOK_SCRIPT_INVALID", hook("    run: ../outside.sh\n")],
    ["AZD_HOOK_SCRIPT_INVALID", hook("    run: hooks\\\\pre.sh\n")],
    ["AZD_HOOK_SCRIPT_INVALID", hook("    run: echo hi\n    dir: missing-dir\n")],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: azd up --no-prompt\n")],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: |\n      echo start\n      azd deploy api\n")],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: azd env set AZURE_LOCATION westeurope\n")],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: azd env select other\n")],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: azd env set CUSTOM_SETTING changed\n")],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: azd env set-secret SOME_VALUE\n")],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: echo CUSTOM_SETTING=x >> .azure/lab/.env\n")],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: azd extension install foo\n")],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: hooks/pre.sh\n"), { "hooks/pre.sh": "#!/bin/sh\nazd provision\n" }],
    ["AZD_HOOK_UNBOUND_MUTATION", hook("    run: az account set --subscription other\n")],
  ];
  for (const [code, yaml, files] of cases) await rejects(code, { "azure.yaml": yaml, ...files });
  const readOnly = await inspect({ "azure.yaml": hook("    run: azd env get-value AZURE_LOCATION\n") });
  assert.equal(readOnly.hooks.length, 1);
});

test("requiredVersions.azd must be satisfied by the bound azd and use simple comparators", async () => {
  const required = (constraint: string): Record<string, string> => ({
    "azure.yaml": withHooks(`requiredVersions:\n  azd: "${constraint}"\n`),
  });
  for (const constraint of [
    ">= 0.6.0-beta.3",
    ">=1.35.1",
    "1.35.1",
    ">=1.0.0 <2.0.0",
    ">1.0.0, <1.36.0",
    "<1.0.0 || >=1.35.0",
  ])
    assert.equal((await inspect(required(constraint))).azdVersion, "1.35.1", constraint);
  for (const constraint of [">= 1.36.0", "<1.35.1", "!=1.35.1", "1.35.0", ">=2.0.0 || <1.0.0"])
    await rejects("AZD_VERSION_CONSTRAINT", required(constraint));
  for (const constraint of ["~1.35", "^1.0.0", "1.x", "latest", ">=1.35", "|| >=1.0.0", ">=1.0.0 || "])
    await rejects("AZD_PROJECT_UNSUPPORTED", required(constraint));
});

test("service hooks are inventoried and an ambiguous script location fails closed", async () => {
  const yaml = (project: string): string =>
    withHooks(
      `services:\n  api:\n    host: containerapp\n${project}    hooks:\n      predeploy:\n        run: scripts/build.sh\n        shell: sh\n`,
    );
  const binding = await inspect({ "azure.yaml": yaml(""), "scripts/build.sh": "echo build\n" });
  assert.deepEqual(
    binding.hooks.map(({ scope, event, path }) => [scope, event, path]),
    [["service:api", "predeploy", "scripts/build.sh"]],
  );
  await rejects("AZD_HOOK_SCRIPT_INVALID", {
    "azure.yaml": yaml("    project: src/api\n"),
    "scripts/build.sh": "echo a\n",
    "src/api/scripts/build.sh": "echo b\n",
  });
  await rejects("AZD_ENV_TARGET_MISMATCH", {
    "azure.yaml": withHooks("services:\n  api:\n    host: containerapp\n    resourceGroup: elsewhere\n"),
  });
});

test("target identifiers are normalized and a subscription-scope group output is tolerated", async () => {
  const lower = await inspect();
  const upper = await inspect({}, (request) => ({
    ...request,
    target: { subscriptionId: SUBSCRIPTION.toUpperCase(), location: "SwedenCentral" },
  }));
  assert.equal(upper.bindingHash, lower.bindingHash);
  const output = { ".azure/lab/.env": `${baseFiles()[".azure/lab/.env"]!}\nAZURE_RESOURCE_GROUP="rg-created"` };
  assert.equal((await inspect(output)).environment.keys.includes("AZURE_RESOURCE_GROUP"), true);
  await rejects("AZD_ENV_TARGET_MISMATCH", output, (request) => ({
    ...request,
    target: { ...request.target, resourceGroup: "rg-approved" },
  }));
  await rejects("AZD_BINDING_INPUT_INVALID", {}, (request) => ({
    ...request,
    target: { ...request.target, subscriptionId: "not-a-guid" },
  }));
});

test("environment redirects, secrets and ambiguous syntax fail closed", async () => {
  const env = (edit: (text: string) => string): Record<string, string> => ({
    ".azure/lab/.env": edit(baseFiles()[".azure/lab/.env"]!),
  });
  await rejects(
    "AZD_ENV_TARGET_MISMATCH",
    env((text) => text.replace(SUBSCRIPTION, "99999999-2222-3333-4444-555555555555")),
  );
  await rejects(
    "AZD_ENV_TARGET_MISMATCH",
    env((text) => text.replace("swedencentral", "westeurope")),
  );
  await rejects(
    "AZD_ENV_TARGET_MISMATCH",
    env((text) => text.replace('"lab"', '"prod"')),
  );
  await rejects(
    "AZD_ENV_TARGET_MISMATCH",
    env((text) => `${text}\nAZURE_RESOURCE_GROUP="rg-other"`),
    (request) => ({ ...request, target: { ...request.target, resourceGroup: "rg-approved" } }),
  );
  await rejects(
    "AZD_ENV_TARGET_MISMATCH",
    env((text) => `${text}\nAZURE_TENANT_ID="${SUBSCRIPTION}"`),
  );
  await rejects(
    "AZD_ENV_TARGET_MISMATCH",
    env((text) => text.replace(/AZURE_LOCATION.*\n?/u, "")),
  );
  await rejects(
    "AZD_ENV_UNAPPROVED_KEY",
    env((text) => `${text}\nSQL_ADMIN_PASSWORD="hunter2hunter2"`),
  );
  await rejects(
    "AZD_ENV_UNAPPROVED_KEY",
    env((text) => `${text}\nCUSTOM_ENDPOINT="https://user:pass@example.com/x"`),
  );
  await rejects("AZD_ENV_UNAPPROVED_KEY", {
    ".azure/lab/config.json": '{"infra":{"parameters":{"adminPassword":"x"}}}',
  });
  await rejects("AZD_ENV_UNAPPROVED_KEY", { ".azure/lab/config.json": '{"infra":{"parameters":{"name":"manual"}}}' });
  await rejects(
    "AZD_ENV_SECRET",
    env((text) => text.replace(/AZURE_PRINCIPAL_ID=.*/u, 'AZURE_PRINCIPAL_ID="https://user:pass@example.com/x"')),
  );
  await rejects(
    "AZD_ENV_INVALID",
    env((text) => `${text}\nOTHER="${"$"}{AZURE_PRINCIPAL_ID}"`),
  );
  await rejects(
    "AZD_ENV_INVALID",
    env((text) => `${text}\nAZURE_PRINCIPAL_ID="again"`),
  );
  await rejects(
    "AZD_ENV_INVALID",
    env((text) => `${text}\nexport EXTRA=1`),
  );
  await rejects(
    "AZD_ENV_INVALID",
    env((text) => `${text}\nMULTI="a\\nb"`),
  );
  await rejects(
    "AZD_ENV_INVALID",
    env((text) => `${text}\nSPACED=a b`),
  );
  await rejects("AZD_ENV_INVALID", { ".azure/lab/config.json": "{not json" });
  await rejects("AZD_ENV_MISSING", { ".azure/lab/.env": null });
  await rejects("AZD_BINDING_INPUT_INVALID", {}, (request) => ({ ...request, environmentName: "../lab" }));
});

test("parameters that cannot be resolved deterministically fail closed", async () => {
  const parameters = (value: unknown): Record<string, string> => ({
    "infra/main.parameters.json": typeof value === "string" ? value : JSON.stringify(value),
  });
  const single = (value: unknown): unknown => ({ parameters: { p: { value } } });
  await rejects("AZD_PARAMETERS_UNRESOLVED", parameters(single("${NOT_DEFINED}")));
  await rejects("AZD_PARAMETERS_UNSUPPORTED", parameters(single("${AZURE_PRINCIPAL_ID:-fallback}")));
  await rejects("AZD_PARAMETERS_UNSUPPORTED", parameters(single("$AZURE_PRINCIPAL_ID")));
  await rejects("AZD_PARAMETERS_UNSUPPORTED", parameters("{not json"));
  await rejects("AZD_PARAMETERS_UNSUPPORTED", parameters({ parameters: { p: { value: 1, extra: 2 } } }));
  await rejects("AZD_PARAMETERS_UNSUPPORTED", parameters({ parameters: { p: {} } }));
  await rejects("AZD_PARAMETERS_UNSUPPORTED", parameters({ other: {} }));
  await rejects("AZD_PARAMETERS_SECRET", parameters({ parameters: { adminPassword: { value: "x" } } }));
  await rejects("AZD_PARAMETERS_SECRET", parameters(single("Bearer abcdefghijklmnopqrstuvwxyz0123")));
  await rejects("AZD_PARAMETERS_UNSUPPORTED", {
    ".azure/lab/.env": baseFiles()[".azure/lab/.env"]!.replace(/AZURE_PRINCIPAL_ID=.*/u, "AZURE_PRINCIPAL_ID='a\"b'"),
    "infra/main.parameters.json": JSON.stringify(single("${AZURE_PRINCIPAL_ID}")),
  });
  await rejects("AZD_PARAMETERS_UNSUPPORTED", { "infra/main.bicepparam": "using './main.bicep'\n" });
  const reference = await inspect(
    parameters({
      parameters: {
        adminPassword: {
          reference: {
            keyVault: { id: "/subscriptions/x/resourceGroups/r/providers/Microsoft.KeyVault/vaults/v" },
            secretName: "sql",
          },
        },
      },
    }),
  );
  assert.equal(reference.infra.roots[0]!.resolvedParametersHash.length, 64);
});

test("YAML that could hide structure is rejected", async () => {
  await rejects("AZD_YAML_INVALID", { "azure.yaml": "name: &a demo\nhooks: *a\n" });
  await rejects("AZD_YAML_INVALID", { "azure.yaml": "name: demo\nname: other\n" });
  await rejects("AZD_YAML_INVALID", { "azure.yaml": "name: demo\n---\nname: other\n" });
  await rejects("AZD_YAML_INVALID", { "azure.yaml": "- not\n- a mapping\n" });
  await rejects("AZD_YAML_INVALID", { "azure.yaml": "name: !!python/object demo\n" });
  await rejects("AZD_PROJECT_MISSING", { "azure.yaml": null });
  await rejects("AZD_INFRA_MISSING", { "infra/main.bicep": null });
  await rejects("AZD_INFRA_MISSING", { "infra/bicepconfig.json": null });
});

test("Bicep references outside the bound tree and merge keys cannot hide inputs", async () => {
  const bicep = (line: string): Record<string, string> => ({
    "infra/main.bicep": `param x string = 'a'\n${line}\n`,
  });
  for (const line of [
    "module shared '../shared/main.bicep' = { name: 'x' }",
    "module shared './nested/../../shared.bicep' = { name: 'x' }",
    "module shared '/abs/main.bicep' = { name: 'x' }",
    "var text = loadTextContent('../secret.txt')",
    "var text = loadJsonContent('C:\\\\data.json')",
    "import { thing } from '../types.bicep'",
  ])
    await rejects("AZD_PATH_UNSAFE", bicep(line));
  const allowed = await inspect({
    ...bicep(
      "module local './modules/app.bicep' = { name: 'x' }\nmodule avm 'br/public:avm/res/storage/storage-account:0.14.0' = { name: 'y' }\nvar id = '/subscriptions/00000000-0000-0000-0000-000000000000'",
    ),
    "infra/modules/app.bicep": "param n string = 'a'\n",
  });
  assert.equal(allowed.infra.roots[0]!.name, "default");
  await rejects("AZD_YAML_INVALID", {
    "azure.yaml":
      "name: demo\nservices:\n  api:\n    host: containerapp\n    <<:\n      hooks:\n        predeploy:\n          run: echo hidden\n",
  });
});

test("oversize files and trees fail closed", async () => {
  await rejects("AZD_FILE_LIMIT_EXCEEDED", { "azure.yaml": `name: demo\n# ${"x".repeat(300_000)}\n` });
  await rejects("AZD_FILE_LIMIT_EXCEEDED", {
    "azure.yaml": withHooks(PRE),
    "hooks/pre.sh": `#!/bin/sh\n# ${"x".repeat(300_000)}\n`,
  });
  const many = Object.fromEntries(Array.from({ length: 2100 }, (_, index) => [`infra/files/f${index}.txt`, "x"]));
  await rejects("AZD_FILE_LIMIT_EXCEEDED", many);
});

test("links and escapes are refused", async (context) => {
  const { root, request } = await fixture({ "azure.yaml": withHooks(PRE) });
  const outside = await mkdtemp(join(tmpdir(), "apex-azd-outside-"));
  try {
    await writeFile(join(outside, "secret.sh"), "echo outside\n", "utf8");
    try {
      await rm(join(root, "hooks/pre.sh"));
      await symlink(join(outside, "secret.sh"), join(root, "hooks/pre.sh"));
    } catch {
      context.skip("symbolic links are unavailable on this host");
      return;
    }
    await assert.rejects(
      inspectAzdBicepProject(request),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_PATH_UNSAFE",
    );
    await rm(join(root, "hooks/pre.sh"));
    await writeFile(join(root, "hooks/pre.sh"), "echo ok\n", "utf8");
    await link(join(root, "hooks/pre.sh"), join(root, "hooks/alias.sh"));
    await assert.rejects(
      inspectAzdBicepProject(request),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_PATH_UNSAFE",
    );
    await rm(join(root, "hooks/alias.sh"));
    await rm(join(root, "infra"), { recursive: true });
    await symlink(outside, join(root, "infra"));
    await assert.rejects(
      inspectAzdBicepProject(request),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_PATH_UNSAFE",
    );
    const linkedRoot = join(outside, "linked-root");
    await symlink(root, linkedRoot);
    await assert.rejects(
      inspectAzdBicepProject({ ...request, projectRoot: linkedRoot }),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_PROJECT_MISSING",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a symlinked infrastructure file is refused inside the tree", async (context) => {
  const { root, request } = await fixture();
  try {
    try {
      await symlink(join(root, "azure.yaml"), join(root, "infra", "linked.bicep"));
    } catch {
      context.skip("symbolic links are unavailable on this host");
      return;
    }
    await assert.rejects(
      inspectAzdBicepProject(request),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_PATH_UNSAFE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval material lists every hook and warns that hooks act beyond the what-if", async () => {
  const withHook = await inspect(
    { "azure.yaml": withHooks(`${PRE}requiredVersions:\n  extensions:\n    microsoft.azd.demo: 1.2.3\n`) },
    withDigests("microsoft.azd.demo"),
  );
  const material = describeAzdBinding(withHook);
  assert.equal(material.bindingHash, withHook.bindingHash);
  assert.ok(material.warnings.some((line) => /beyond what the what-if predicts/u.test(line)));
  assert.ok(material.warnings.some((line) => /not an immutable plan/u.test(line)));
  assert.ok(
    material.inventory.some((line) => line.startsWith("hook project preprovision #0") && line.includes("hooks/pre.sh")),
  );
  assert.ok(material.inventory.some((line) => line.startsWith("extension microsoft.azd.demo 1.2.3")));
  const plain = describeAzdBinding(await inspect());
  assert.equal(
    plain.warnings.some((line) => /hook/u.test(line)),
    false,
  );
});

const hookYaml = (run: string): string =>
  withHooks(`hooks:\n  preprovision:\n    run: ${JSON.stringify(run)}\n    shell: sh\n`);

test("an interpreter command binds the script it runs and the arguments it passes", async () => {
  const run = "sh hooks/pre.sh --flag";
  const first = await inspect({ "azure.yaml": hookYaml(run) });
  const [hook] = first.hooks;
  assert.deepEqual([hook!.source, hook!.interpreter, hook!.path], ["script", "sh", "hooks/pre.sh"]);
  const edited = await inspect({ "azure.yaml": hookYaml(run), "hooks/pre.sh": "#!/bin/sh\necho changed\n" });
  assert.notEqual(edited.hooks[0]!.contentHash, hook!.contentHash);
  assert.notEqual(edited.bindingHash, first.bindingHash);
  const otherArgs = await inspect({ "azure.yaml": hookYaml("sh hooks/pre.sh --other") });
  assert.notEqual(otherArgs.hooks[0]!.commandHash, hook!.commandHash);
  assert.equal(otherArgs.hooks[0]!.contentHash, hook!.contentHash);
  const forms: Array<[string, string, string]> = [
    ["bash -e hooks/pre.sh one two", "bash", "hooks/pre.sh"],
    ["bash.exe hooks/pre.sh", "bash", "hooks/pre.sh"],
    ["zsh ./hooks/pre.sh", "zsh", "hooks/pre.sh"],
    ["pwsh -NoProfile -ExecutionPolicy Bypass -File hooks/x.ps1", "pwsh", "hooks/x.ps1"],
    ["powershell hooks/x.ps1 -Arg 1", "powershell", "hooks/x.ps1"],
    ["cmd /c hooks/x.cmd", "cmd", "hooks/x.cmd"],
  ];
  for (const [command, interpreter, path] of forms) {
    const binding = await inspect({
      "azure.yaml": hookYaml(command),
      "hooks/x.ps1": "Write-Host x\n",
      "hooks/x.cmd": "@echo off\n",
    });
    assert.deepEqual([binding.hooks[0]!.interpreter, binding.hooks[0]!.path], [interpreter, path], command);
  }
  await rejects("AZD_HOOK_SCRIPT_INVALID", { "azure.yaml": hookYaml("sh hooks/missing.sh") });
  await rejects("AZD_HOOK_SCRIPT_INVALID", { "azure.yaml": hookYaml("sh ../outside.sh") });
  await rejects("AZD_HOOK_SCRIPT_INVALID", { "azure.yaml": hookYaml("bash /usr/local/bin/tool.sh") });
  await rejects("AZD_HOOK_UNBOUND_CONTENT", { "azure.yaml": hookYaml('sh "$SCRIPT_DIR/pre.sh"') });
  await rejects("AZD_HOOK_UNBOUND_CONTENT", { "azure.yaml": hookYaml("sh hooks/*.sh") });
});

test("files a hook sources, imports or runs are hashed and nested loads are followed", async () => {
  const body = (text: string): Record<string, string> => ({
    "azure.yaml": hookYaml("sh hooks/pre.sh"),
    "hooks/pre.sh": `#!/bin/sh\n${text}\n`,
    "hooks/lib.sh": "echo lib\n",
  });
  const sourced = await inspect(body(". ./hooks/lib.sh"));
  assert.deepEqual(
    sourced.hooks[0]!.dependencies.map(({ path }) => path),
    ["hooks/lib.sh"],
  );
  const material = describeAzdBinding(sourced);
  assert.ok(material.inventory.some((line) => line.includes("loads hooks/lib.sh")));
  assert.ok(material.warnings.some((line) => /load further project files/u.test(line)));
  const changed = await inspect({ ...body(". ./hooks/lib.sh"), "hooks/lib.sh": "echo changed\n" });
  assert.notEqual(changed.bindingHash, sourced.bindingHash);
  assert.notEqual(changed.hooks[0]!.dependencies[0]!.hash, sourced.hooks[0]!.dependencies[0]!.hash);
  for (const line of ["source hooks/lib.sh", "echo start; . hooks/lib.sh", "./hooks/lib.sh", "bash hooks/lib.sh arg"]) {
    const binding = await inspect(body(line));
    assert.equal(binding.hooks[0]!.dependencies.length, 1, line);
  }
  const nested = await inspect({
    ...body(". ./hooks/lib.sh"),
    "hooks/lib.sh": "echo lib\n. ./hooks/deep.sh\n",
    "hooks/deep.sh": "echo deep\n",
  });
  assert.deepEqual(
    nested.hooks[0]!.dependencies.map(({ path }) => path),
    ["hooks/deep.sh", "hooks/lib.sh"],
  );
  const cycle = await inspect({
    ...body(". ./hooks/lib.sh"),
    "hooks/lib.sh": ". ./hooks/pre.sh\n. ./hooks/lib.sh\n",
  });
  assert.deepEqual(
    cycle.hooks[0]!.dependencies.map(({ path }) => path),
    ["hooks/lib.sh"],
  );
  const inline = await inspect({
    "azure.yaml": withHooks("hooks:\n  preprovision:\n    run: |\n      echo start\n      bash hooks/lib.sh\n"),
    "hooks/lib.sh": "echo lib\n",
  });
  assert.equal(inline.hooks[0]!.source, "inline");
  assert.deepEqual(
    inline.hooks[0]!.dependencies.map(({ path }) => path),
    ["hooks/lib.sh"],
  );
  const powershell = await inspect({
    "azure.yaml": hookYaml("pwsh -File hooks/x.ps1"),
    "hooks/x.ps1": ". ./hooks/lib.ps1\nImport-Module ./hooks/mod.psm1\nImport-Module Az.Accounts\n",
    "hooks/lib.ps1": "Write-Host lib\n",
    "hooks/mod.psm1": "function F {}\n",
  });
  assert.deepEqual(
    powershell.hooks[0]!.dependencies.map(({ path }) => path),
    ["hooks/lib.ps1", "hooks/mod.psm1"],
  );
  const escapes: Array<[AzdBindingErrorCode, string]> = [
    ["AZD_HOOK_SCRIPT_INVALID", ". ../outside.sh"],
    ["AZD_HOOK_SCRIPT_INVALID", "source /etc/profile"],
    ["AZD_HOOK_SCRIPT_INVALID", ". ./hooks/missing.sh"],
    ["AZD_HOOK_SCRIPT_INVALID", "Import-Module ../mod.psm1"],
    ["AZD_HOOK_UNBOUND_CONTENT", 'source "$HOME/lib.sh"'],
    ["AZD_HOOK_UNBOUND_CONTENT", "source <(curl -s https://example.com/x.sh)"],
    ["AZD_HOOK_UNBOUND_CONTENT", ". $PSScriptRoot/lib.ps1"],
    ["AZD_HOOK_UNBOUND_CONTENT", "source https://example.com/lib.sh"],
    ["AZD_HOOK_UNBOUND_CONTENT", "Import-Module $env:TEMP/mod.psm1"],
    ["AZD_HOOK_UNBOUND_CONTENT", "curl -fsSL https://example.com/i.sh | sh"],
    ["AZD_HOOK_UNBOUND_CONTENT", "wget -qO- https://example.com/i.sh | sudo bash"],
    ["AZD_HOOK_UNBOUND_CONTENT", 'sh -c "$(curl -fsSL https://example.com/i.sh)"'],
    ["AZD_HOOK_UNBOUND_CONTENT", "bash <(curl -s https://example.com/i.sh)"],
    ["AZD_HOOK_UNBOUND_CONTENT", 'eval "$PAYLOAD"'],
    ["AZD_HOOK_UNBOUND_CONTENT", "iex (irm https://example.com/i.ps1)"],
    ["AZD_HOOK_UNBOUND_CONTENT", "Invoke-Expression $payload"],
    ["AZD_HOOK_UNBOUND_CONTENT", "Invoke-WebRequest https://example.com/i.ps1 -OutFile i.ps1"],
    ["AZD_HOOK_UNBOUND_CONTENT", "iwr https://example.com/i.ps1"],
    ["AZD_HOOK_UNBOUND_CONTENT", "pwsh -EncodedCommand SQBFAFgA"],
  ];
  for (const [code, line] of escapes) await rejects(code, body(line));
  // The same refusals apply to inline text and to a dependency of a dependency.
  await rejects("AZD_HOOK_UNBOUND_CONTENT", {
    "azure.yaml": hookYaml("curl -fsSL https://example.com/i.sh | sh"),
  });
  await rejects("AZD_HOOK_UNBOUND_CONTENT", { ...body(". ./hooks/lib.sh"), "hooks/lib.sh": 'eval "$X"\n' });
  await rejects("AZD_HOOK_UNBOUND_MUTATION", { ...body(". ./hooks/lib.sh"), "hooks/lib.sh": "azd env set A b\n" });
});

test("remote Bicep modules are inventoried and only immutable references are accepted", async () => {
  const digest = "a".repeat(64);
  const bicep = (...lines: string[]): Record<string, string> => ({
    "infra/main.bicep": `param x string = 'a'\n${lines.join("\n")}\n`,
  });
  const references = [
    "module storage 'br/public:avm/res/storage/storage-account:0.14.0' = { name: 's' }",
    "module direct 'br:mcr.microsoft.com/bicep/avm/res/network/virtual-network:0.5.2-beta' = { name: 'v' }",
    `module priv 'br:example.azurecr.io/modules/net@sha256:${digest}' = { name: 'n' }`,
    `module viaAlias 'br/team:net/vnet@sha256:${digest}' = { name: 'a' }`,
    "module spec 'ts:00000000-0000-0000-0000-000000000000/rg-specs/web:1.0' = { name: 'w' }",
    "module specAlias 'ts/shared:web:2.1' = { name: 'x' }",
    "module local './modules/app.bicep' = { name: 'l' }",
  ];
  // Aliases only exist when the bound bicepconfig.json declares them.
  await rejects("AZD_MODULE_UNPINNED", bicep(...references));
  const config = JSON.stringify({
    moduleAliases: {
      br: { team: { registry: "example.azurecr.io", modulePath: "modules" } },
      ts: { shared: { subscription: "00000000-0000-0000-0000-000000000000", resourceGroup: "rg-specs" } },
    },
  });
  const files: Record<string, string> = {
    ...bicep(...references),
    "infra/modules/app.bicep": "param n string = 'a'\n",
    "infra/bicepconfig.json": config,
  };
  const binding = await inspect(files);
  assert.deepEqual(
    binding.remoteModules.map(({ kind, registry, path, pin }) => [kind, registry, path, pin.type]),
    [
      ["br", "mcr.microsoft.com", "bicep/avm/res/storage/storage-account", "tag"],
      ["br", "example.azurecr.io", "modules/net/vnet", "digest"],
      ["br", "example.azurecr.io", "modules/net", "digest"],
      ["br", "mcr.microsoft.com", "bicep/avm/res/network/virtual-network", "tag"],
      ["ts", "00000000-0000-0000-0000-000000000000/rg-specs", "web", "version"],
      ["ts", "00000000-0000-0000-0000-000000000000/rg-specs", "web", "version"],
    ],
  );
  const remoteMaterial = describeAzdBinding(binding);
  assert.ok(remoteMaterial.inventory.some((line) => line.startsWith("module default infra/main.bicep: br/public")));
  assert.ok(remoteMaterial.warnings.some((line) => /verify the resolved artifact/u.test(line)));
  const bumped = await inspect({
    ...files,
    "infra/main.bicep": files["infra/main.bicep"]!.replace("storage-account:0.14.0", "storage-account:0.14.1"),
  });
  assert.notEqual(bumped.bindingHash, binding.bindingHash);
  assert.notEqual(bumped.remoteModules[0]!.pin.value, binding.remoteModules[0]!.pin.value);
  const digested = await inspect({
    ...files,
    "infra/main.bicep": files["infra/main.bicep"]!.replace(digest, "b".repeat(64)),
  });
  assert.notEqual(digested.bindingHash, binding.bindingHash);

  const rejected: string[] = [
    "module a 'br/public:avm/res/storage/storage-account:latest' = { name: 'a' }",
    "module a 'br/public:avm/res/storage/storage-account:0' = { name: 'a' }",
    "module a 'br/public:avm/res/storage/storage-account:0.14' = { name: 'a' }",
    "module a 'br/public:avm/res/storage/storage-account:v0.14.0' = { name: 'a' }",
    "module a 'br/public:avm/res/storage/storage-account' = { name: 'a' }",
    "module a 'br/public:avm/res/storage/storage-account:' = { name: 'a' }",
    "module a 'br/public:avm/res/storage/storage-account@sha256:abc' = { name: 'a' }",
    "module a 'br:example.azurecr.io/modules/net:1.2.3' = { name: 'a' }",
    "module a 'br:mcr.microsoft.com/other/thing:1.2.3' = { name: 'a' }",
    "module a 'br:example.azurecr.io/modules/net:latest' = { name: 'a' }",
    "module a 'br:example.azurecr.io' = { name: 'a' }",
    "module a 'br/undefined:thing:1.0.0' = { name: 'a' }",
    "module a 'ts:00000000-0000-0000-0000-000000000000/rg/web' = { name: 'a' }",
    "module a 'ts/undefined:web:1.0' = { name: 'a' }",
    "module a 'https://example.com/main.bicep' = { name: 'a' }",
    "module a 'git://example.com/repo' = { name: 'a' }",
    "extension 'br:example.azurecr.io/ext/thing:1.0.0'",
  ];
  for (const line of rejected) await rejects("AZD_MODULE_UNPINNED", bicep(line));
  await rejects("AZD_MODULE_UNPINNED", {
    ...bicep("module a 'br/public:avm/res/x/y:1.0.0' = { name: 'a' }"),
    "infra/bicepconfig.json": JSON.stringify({
      moduleAliases: { br: { public: { registry: "evil.azurecr.io", modulePath: "bicep" } } },
    }),
  });
  await rejects("AZD_PROJECT_UNSUPPORTED", { ...bicep("var x = 1"), "infra/bicepconfig.json": "{ // comment\n}" });
  const nested = await inspect({
    ...bicep("var x = 1"),
    "infra/modules/inner.bicep": "module n 'br/team:thing@sha256:" + digest + "' = { name: 'n' }\n",
    "infra/modules/bicepconfig.json": config,
  });
  assert.equal(nested.remoteModules[0]!.file, "infra/modules/inner.bicep");
  await rejects("AZD_MODULE_UNPINNED", {
    ...bicep("var x = 1"),
    "infra/modules/inner.bicep": "module n 'br/team:thing@sha256:" + digest + "' = { name: 'n' }\n",
  });
});

test("a low-entropy secret under an innocuous key is refused instead of hashed", async () => {
  const env = `${baseFiles()[".azure/lab/.env"]!}\nX="123456"`;
  const parameters = JSON.stringify({ parameters: { sqlPin: { value: "${X}" } } });
  const files = { ".azure/lab/.env": env, "infra/main.parameters.json": parameters };
  for (const overrides of [files, { ".azure/lab/.env": env }]) {
    await assert.rejects(
      inspect(overrides),
      (error: unknown) =>
        error instanceof AzdBindingError &&
        error.code === "AZD_ENV_UNAPPROVED_KEY" &&
        !error.message.includes("123456") &&
        /main\.parameters\.json|Key Vault/u.test(error.message),
    );
  }
  // Without the environment entry the reference cannot be resolved, and the error points to the reviewed file.
  await assert.rejects(
    inspect({ "infra/main.parameters.json": parameters }),
    (error: unknown) =>
      error instanceof AzdBindingError &&
      error.code === "AZD_PARAMETERS_UNRESOLVED" &&
      /not an approved azd-managed value/u.test(error.message),
  );
  // Only allowlisted azd-managed values are ever digested into the persisted binding.
  const binding = await inspect();
  assert.deepEqual(
    binding.environment.keys.filter((key) => !AZD_ENVIRONMENT_KEYS.includes(key)),
    [],
  );
  for (const key of ["API_KEY", "TOKEN", "AZURE_CUSTOM", "azure_location", "AZURE_CLIENT_SECRET"])
    await rejects("AZD_ENV_UNAPPROVED_KEY", { ".azure/lab/.env": `${baseFiles()[".azure/lab/.env"]!}\n${key}="v"` });
});

test("ambient azd configuration is hashed or refused", async () => {
  const baseline = await inspect();
  const pointer = await inspect({ ".azure/config.json": '{"version":1,"defaultEnvironment":"lab"}' });
  const other = await inspect({ ".azure/config.json": '{"version":1,"defaultEnvironment":"prod"}' });
  assert.notEqual(pointer.environment.projectConfigHash, undefined);
  assert.notEqual(pointer.bindingHash, baseline.bindingHash);
  assert.notEqual(pointer.bindingHash, other.bindingHash);
  await rejects("AZD_ENV_INVALID", { ".azure/config.json": '{"version":1,"extension":{"sources":[]}}' });
  await rejects("AZD_ENV_INVALID", { ".azure/config.json": '{"defaultEnvironment":5}' });
  await rejects("AZD_ENV_INVALID", { ".azure/config.json": "not json" });
  await rejects("AZD_ENV_UNAPPROVED_KEY", { ".azure/lab/config.json": '{"auth":{"useAzCliAuth":"true"}}' });
  assert.notEqual((await inspect({ ".azure/lab/config.json": "{}" })).bindingHash, baseline.bindingHash);
  // The binding carries the execution envelope, so a different envelope is a different binding.
  assert.equal(baseline.executionEnvelope.environmentName, "lab");
  assert.equal(baseline.executionEnvelope.azdConfigDirectory, "isolated");
  const explicit = await inspect({}, (request) => ({ ...request, azureCliConfigDirectory: "explicit" }));
  assert.notEqual(explicit.bindingHash, baseline.bindingHash);
  const windows = await inspect({}, (request) => ({ ...request, platform: "win32" }));
  assert.notEqual(windows.bindingHash, baseline.bindingHash);
});

test("an accepted binding is re-verified and a change names the changed sections", async () => {
  const { root, request } = await fixture({ "azure.yaml": withHooks(PRE) });
  try {
    const accepted = await inspectAzdBicepProject(request);
    assert.equal((await assertAzdBindingUnchanged(accepted, request)).bindingHash, accepted.bindingHash);
    await writeFile(join(root, "hooks/pre.sh"), "#!/bin/sh\necho swapped\n", "utf8");
    await assert.rejects(
      assertAzdBindingUnchanged(accepted, request),
      (error: unknown) =>
        error instanceof AzdBindingError && error.code === "AZD_BINDING_CHANGED" && /hooks/u.test(error.message),
    );
    await assert.rejects(
      assertAzdBindingUnchanged({ ...accepted, bindingHash: "0".repeat(64) }, request),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_BINDING_CHANGED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
