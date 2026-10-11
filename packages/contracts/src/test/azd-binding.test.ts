import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  AzdBindingV1Schema,
  calculateAzdBindingHash,
  CONTRACT_VERSION,
  contractMetadata,
  hasValidAzdBinding,
  type AzdBindingV1,
} from "../index.js";

const digest = (character: string): string => character.repeat(64);

function binding(change: (body: Omit<AzdBindingV1, "bindingHash">) => void = () => undefined): AzdBindingV1 {
  const body: Omit<AzdBindingV1, "bindingHash"> = {
    schemaVersion: CONTRACT_VERSION,
    projectId: "demo",
    runId: "run-1",
    track: "bicep",
    executor: "azd",
    azdVersion: "1.35.1",
    projectName: "demo",
    configHash: digest("a"),
    infra: {
      provider: "bicep",
      layered: false,
      roots: [
        {
          name: "default",
          path: "infra",
          module: "main",
          provider: "bicep",
          dependsOn: [],
          treeHash: digest("b"),
          parametersPath: "infra/main.parameters.json",
          parametersFileHash: digest("c"),
          resolvedParametersHash: digest("d"),
        },
      ],
    },
    environment: {
      name: "lab",
      target: { subscriptionId: "11111111-2222-3333-4444-555555555555", location: "swedencentral" },
      keys: ["AZURE_ENV_NAME", "AZURE_LOCATION"],
      valuesHash: digest("e"),
    },
    parametersHash: digest("f"),
    hooks: [
      {
        scope: "project",
        event: "preprovision",
        order: 0,
        platform: "all",
        shell: "sh",
        source: "script",
        path: "hooks/pre.sh",
        contentHash: digest("1"),
        commandHash: digest("7"),
        dependencies: [{ path: "hooks/lib.sh", hash: digest("8") }],
        continueOnError: false,
        interactive: false,
      },
    ],
    extensions: [{ id: "microsoft.azd.demo", version: "1.2.3", source: "azd", installedDigest: digest("9") }],
    remoteModules: [
      {
        root: "default",
        file: "infra/main.bicep",
        kind: "br",
        reference: "br/public:avm/res/storage/storage-account:0.14.0",
        registry: "mcr.microsoft.com",
        path: "bicep/avm/res/storage/storage-account",
        pin: { type: "tag", value: "0.14.0" },
      },
    ],
    executionEnvelope: {
      workingDirectory: "project-root",
      environmentName: "lab",
      prompts: "disabled",
      inheritedEnvironment: ["HOME", "PATH"],
      fixedEnvironment: { AZD_SKIP_UPDATE_CHECK: "true", AZURE_DEV_COLLECT_TELEMETRY: "no" },
      azdConfigDirectory: "isolated",
      azureCliConfigDirectory: "unset",
    },
  };
  change(body);
  return { ...body, bindingHash: calculateAzdBindingHash(body) };
}

describe("azd-binding-v1", () => {
  it("accepts a bound inventory and registers metadata", () => {
    assert.equal(hasValidAzdBinding(binding()), true);
    assert.deepEqual(contractMetadata["https://schemas.apexops.dev/azd-binding-v1.json"], {
      maxBytes: 524_288,
      sensitivity: "confidential",
      compatibility: "strict-v1",
    });
  });

  it("changes the hash for any hook, extension, layer or environment edit", () => {
    const base = binding().bindingHash;
    const edits: Array<(body: Omit<AzdBindingV1, "bindingHash">) => void> = [
      (body) => (body.hooks[0]!.contentHash = digest("2")),
      (body) => (body.hooks[0]!.order = 1),
      (body) => body.hooks.pop(),
      (body) => (body.extensions[0]!.version = "1.2.4"),
      (body) => body.extensions.pop(),
      (body) => (body.environment.valuesHash = digest("0")),
      (body) => (body.infra.roots[0]!.treeHash = digest("0")),
      (body) => (body.azdVersion = "1.35.2"),
    ];
    for (const edit of edits) assert.notEqual(binding(edit).bindingHash, base);
  });

  it("rejects a tampered or inconsistent binding", () => {
    const valid = binding();
    assert.equal(hasValidAzdBinding({ ...valid, bindingHash: digest("0") }), false);
    assert.equal(hasValidAzdBinding({ ...valid, hooks: [] }), false);
    assert.equal(hasValidAzdBinding({ ...valid, extra: true }), false);
    assert.equal(hasValidAzdBinding(null), false);
    const invalid: Array<(body: Omit<AzdBindingV1, "bindingHash">) => void> = [
      (body) => (body.infra.layered = true),
      (body) => body.infra.roots[0]!.dependsOn.push("missing"),
      (body) => body.hooks.push({ ...body.hooks[0]! }),
      (body) => body.extensions.push({ ...body.extensions[0]! }),
      (body) => delete body.hooks[0]!.path,
      (body) => (body.hooks[0]!.source = "inline"),
      (body) => body.environment.keys.push("AZURE_ENV_NAME"),
    ];
    for (const edit of invalid) assert.equal(hasValidAzdBinding(binding(edit)), false);
  });

  it("rejects dependency, parameter and scope inconsistencies a producer would never emit", () => {
    const layered = (body: Omit<AzdBindingV1, "bindingHash">): void => {
      const [root] = body.infra.roots;
      body.infra.layered = true;
      body.remoteModules[0]!.root = "network";
      body.infra.roots = [
        { ...root!, name: "network", path: "infra/network", parametersPath: "infra/network/main.parameters.json" },
        { ...root!, name: "workload", path: "infra/workload", parametersPath: "infra/workload/main.parameters.json" },
      ];
    };
    const valid = binding(layered);
    assert.equal(hasValidAzdBinding(valid), true);
    const invalid: Array<(body: Omit<AzdBindingV1, "bindingHash">) => void> = [
      (body) => (body.infra.roots[0]!.dependsOn = ["network"]),
      (body) => {
        body.infra.roots[0]!.dependsOn = ["workload"];
        body.infra.roots[1]!.dependsOn = ["network"];
      },
      (body) => (body.infra.roots[1]!.name = "NETWORK"),
      (body) => (body.infra.roots[1]!.path = "INFRA/network"),
      (body) => delete body.infra.roots[0]!.parametersFileHash,
      (body) => delete body.infra.roots[0]!.parametersPath,
      (body) => (body.infra.roots[0]!.parametersPath = "infra/other/main.parameters.json"),
      (body) => (body.hooks[0]!.scope = "layer:missing"),
    ];
    for (const edit of invalid)
      assert.equal(
        hasValidAzdBinding(
          binding((body) => {
            layered(body);
            edit(body);
          }),
        ),
        false,
      );
    assert.equal(
      hasValidAzdBinding(
        binding((body) => {
          body.hooks[0]!.scope = "layer:default";
        }),
      ),
      false,
    );
  });

  it("rejects mutable remote modules, unsafe envelopes and unapproved environment keys", () => {
    type Body = Omit<AzdBindingV1, "bindingHash">;
    const valid = binding((body) => {
      body.remoteModules.push({
        root: "default",
        file: "infra/main.bicep",
        kind: "br",
        reference: "br:example.azurecr.io/modules/net@sha256:" + digest("a"),
        registry: "example.azurecr.io",
        path: "modules/net",
        pin: { type: "digest", value: digest("a") },
      });
    });
    assert.equal(hasValidAzdBinding(valid), true);
    const invalid: Array<(body: Body) => void> = [
      (body) => (body.remoteModules[0]!.root = "missing"),
      (body) => (body.remoteModules[0]!.registry = "example.azurecr.io"),
      (body) => (body.remoteModules[0]!.path = "avm/res/x"),
      (body) => (body.remoteModules[0]!.pin = { type: "tag", value: "latest" }),
      (body) => (body.remoteModules[0]!.pin = { type: "tag", value: "1.2" }),
      (body) => (body.remoteModules[0]!.pin = { type: "version", value: "1.0" }),
      (body) => (body.remoteModules[0]!.kind = "ts"),
      (body) => body.remoteModules.push({ ...body.remoteModules[0]! }),
      (body) => (body.executionEnvelope.environmentName = "other"),
      (body) => body.executionEnvelope.inheritedEnvironment.push("AZURE_CONFIG_DIR"),
      (body) => body.executionEnvelope.inheritedEnvironment.push("azd_config_dir"),
      (body) => {
        body.hooks[0]!.source = "inline";
        delete body.hooks[0]!.path;
        body.hooks[0]!.interpreter = "bash";
      },
      (body) => body.hooks[0]!.dependencies.push({ path: "hooks/lib.sh", hash: digest("b") }),
    ];
    for (const edit of invalid) assert.equal(hasValidAzdBinding(binding(edit)), false);
    const schemaInvalid: Array<(body: Body) => void> = [
      (body) => ((body.environment.keys as string[]) = ["CUSTOM_SETTING"]),
      (body) => delete (body.extensions[0] as { installedDigest?: string }).installedDigest,
      (body) => delete (body.hooks[0] as { commandHash?: string }).commandHash,
      (body) => ((body.executionEnvelope as { azdConfigDirectory: string }).azdConfigDirectory = "user"),
      (body) => ((body.executionEnvelope as { prompts: string }).prompts = "enabled"),
      (body) =>
        ((body.executionEnvelope.fixedEnvironment as Record<string, string>).AZURE_CONFIG_DIR = "/home/user/.azure"),
    ];
    for (const edit of schemaInvalid) assert.equal(Value.Check(AzdBindingV1Schema, binding(edit)), false);
    const interpreted = binding((body) => {
      body.hooks[0]!.interpreter = "bash";
    });
    assert.equal(hasValidAzdBinding(interpreted), true);
  });

  it("only describes Bicep through azd with exact versions and safe relative paths", () => {
    const check = (change: (body: Omit<AzdBindingV1, "bindingHash">) => void): boolean =>
      Value.Check(AzdBindingV1Schema, binding(change));
    assert.equal(
      check(() => undefined),
      true,
    );
    assert.equal(
      check((body) => ((body as { track: string }).track = "terraform")),
      false,
    );
    assert.equal(
      check((body) => ((body.infra as { provider: string }).provider = "terraform")),
      false,
    );
    for (const version of ["1.35", "v1.35.1", "1.35.1-beta.1", ">=1.35.1", "latest"])
      assert.equal(
        check((body) => (body.azdVersion = version)),
        false,
        version,
      );
    for (const path of ["../infra", "/infra", "infra/../x", "infra//x", "infra\\x", "./infra", "."])
      assert.equal(
        check((body) => (body.infra.roots[0]!.path = path)),
        false,
        path,
      );
    assert.equal(
      check((body) => ((body.extensions[0] as { source: string }).source = "https://example.com/registry")),
      false,
    );
  });

  it("carries no field that could hold a secret value", () => {
    const names = JSON.stringify(AzdBindingV1Schema);
    for (const forbidden of ["secret", "password", "token"]) assert.equal(names.includes(forbidden), false);
  });
});
