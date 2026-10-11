import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { hasValidAzdBinding, type AzdBindingV1 } from "@apexops/contracts";
import {
  assertAzdExtensionsVerified,
  AzdBindingError,
  buildAzdArguments,
  buildAzdExecutionEnvelope,
  resolveAzdProcessEnvironment,
} from "../index.js";

const absolute = (...segments: string[]): string => join(process.cwd(), ...segments);

test("the envelope is explicit, non-interactive and inherits nothing from AZURE_* or AZD_*", () => {
  for (const platform of ["linux", "win32"] as const) {
    const envelope = buildAzdExecutionEnvelope({ environmentName: "lab", platform });
    assert.deepEqual(
      [envelope.workingDirectory, envelope.environmentName, envelope.prompts, envelope.azdConfigDirectory],
      ["project-root", "lab", "disabled", "isolated"],
    );
    assert.equal(
      envelope.inheritedEnvironment.some((name) => /^(?:AZURE|AZD)_/iu.test(name)),
      false,
    );
    assert.ok(envelope.inheritedEnvironment.includes("PATH"));
    assert.equal(envelope.azureCliConfigDirectory, "unset");
  }
  assert.ok(
    buildAzdExecutionEnvelope({ environmentName: "lab", platform: "win32" }).inheritedEnvironment.includes(
      "SystemRoot",
    ),
  );
  assert.ok(
    !buildAzdExecutionEnvelope({ environmentName: "lab", platform: "linux" }).inheritedEnvironment.includes(
      "SystemRoot",
    ),
  );
});

test("the process environment is rebuilt from an allowlist and redirects never reach azd", () => {
  const envelope = buildAzdExecutionEnvelope({ environmentName: "lab", platform: "linux" });
  const parent = {
    PATH: "/usr/bin",
    HOME: "/home/user",
    AZURE_SUBSCRIPTION_ID: "redirected",
    AZURE_LOCATION: "westeurope",
    AZURE_ENV_NAME: "prod",
    AZURE_CONFIG_DIR: "/attacker/azure",
    AZD_CONFIG_DIR: "/attacker/azd",
    AZD_DEBUG: "1",
    HTTPS_PROXY: "http://proxy",
    GITHUB_TOKEN: "ghp_example",
    LD_PRELOAD: "/attacker/lib.so",
  };
  const environment = resolveAzdProcessEnvironment(
    envelope,
    parent,
    { azdConfigDirectory: absolute("run", "azd") },
    "linux",
  );
  assert.deepEqual(environment, {
    HOME: "/home/user",
    PATH: "/usr/bin",
    AZD_SKIP_UPDATE_CHECK: "true",
    AZURE_DEV_COLLECT_TELEMETRY: "no",
    AZD_CONFIG_DIR: absolute("run", "azd"),
  });

  const explicit = buildAzdExecutionEnvelope({
    environmentName: "lab",
    platform: "linux",
    azureCliConfigDirectory: "explicit",
  });
  const withAzureCli = resolveAzdProcessEnvironment(
    explicit,
    parent,
    { azdConfigDirectory: absolute("run", "azd"), azureCliConfigDirectory: absolute("run", "az") },
    "linux",
  );
  assert.equal(withAzureCli.AZURE_CONFIG_DIR, absolute("run", "az"));
  assert.equal(withAzureCli.AZURE_SUBSCRIPTION_ID, undefined);

  const windows = resolveAzdProcessEnvironment(
    buildAzdExecutionEnvelope({ environmentName: "lab", platform: "win32" }),
    { Path: "C:\\Windows", SYSTEMROOT: "C:\\Windows", AZURE_SUBSCRIPTION_ID: "x" },
    { azdConfigDirectory: absolute("run", "azd") },
    "win32",
  );
  assert.deepEqual(
    [windows.Path, windows.SYSTEMROOT, windows.AZURE_SUBSCRIPTION_ID],
    ["C:\\Windows", "C:\\Windows", undefined],
  );

  const invalid: Array<() => unknown> = [
    () => resolveAzdProcessEnvironment(envelope, parent, { azdConfigDirectory: "relative/azd" }, "linux"),
    () =>
      resolveAzdProcessEnvironment(
        envelope,
        parent,
        { azdConfigDirectory: absolute("a"), azureCliConfigDirectory: absolute("b") },
        "linux",
      ),
    () => resolveAzdProcessEnvironment(explicit, parent, { azdConfigDirectory: absolute("a") }, "linux"),
    () =>
      resolveAzdProcessEnvironment(
        explicit,
        parent,
        { azdConfigDirectory: absolute("a"), azureCliConfigDirectory: "relative" },
        "linux",
      ),
    () =>
      resolveAzdProcessEnvironment(
        { ...envelope, inheritedEnvironment: ["PATH", "AZD_CONFIG_DIR"] },
        parent,
        { azdConfigDirectory: absolute("a") },
        "linux",
      ),
  ];
  for (const attempt of invalid)
    assert.throws(
      attempt,
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_BINDING_INPUT_INVALID",
    );
});

test("azd arguments always name the environment, never prompt and cannot express azd up", () => {
  const envelope = buildAzdExecutionEnvelope({ environmentName: "lab" });
  assert.deepEqual(buildAzdArguments(envelope, "provision-preview"), [
    "provision",
    "--preview",
    "--environment",
    "lab",
    "--no-prompt",
  ]);
  assert.deepEqual(buildAzdArguments(envelope, "provision"), ["provision", "--environment", "lab", "--no-prompt"]);
  for (const operation of ["up", "deploy", "down", ""])
    assert.throws(
      () => buildAzdArguments(envelope, operation as never),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_BINDING_INPUT_INVALID",
    );
});

const bound = (extensions: AzdBindingV1["extensions"]): Pick<AzdBindingV1, "extensions"> => ({ extensions });
const demo = { id: "microsoft.azd.demo", version: "1.2.3", source: "azd" as const, installedDigest: "d".repeat(64) };

test("extension preflight requires the exact installed set, source, version and digest", () => {
  assertAzdExtensionsVerified(bound([demo]), [demo]);
  assertAzdExtensionsVerified(bound([]), []);
  const rejected: Array<[Parameters<typeof assertAzdExtensionsVerified>[1], RegExp]> = [
    [[], /not installed exactly once/u],
    [[demo, demo], /not installed exactly once/u],
    [[{ ...demo, installedDigest: "e".repeat(64) }], /digest/u],
    [[{ ...demo, installedDigest: "" }], /digest/u],
    [[{ ...demo, version: "1.2.4" }], /not the bound 1\.2\.3/u],
    [[{ ...demo, source: "https://example.com/registry.json" }], /default registry/u],
    [[{ ...demo, source: "dev" }], /default registry/u],
    [[demo, { ...demo, id: "other.ext" }], /does not list/u],
  ];
  for (const [observed, message] of rejected)
    assert.throws(
      () => assertAzdExtensionsVerified(bound([demo]), observed),
      (error: unknown) =>
        error instanceof AzdBindingError && error.code === "AZD_EXTENSION_UNVERIFIED" && message.test(error.message),
    );
  assert.throws(
    () => assertAzdExtensionsVerified(bound([]), [demo]),
    (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_EXTENSION_UNVERIFIED",
  );
  assert.equal(hasValidAzdBinding(null), false);
});
