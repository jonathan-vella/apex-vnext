import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { type AzdBindingV1 } from "@apexops/contracts";
import {
  assertAzdIdentityMatchesBinding,
  AzdBindingError,
  buildAzdArguments,
  buildAzdExecutionEnvelope,
} from "../index.js";

const TARGET = {
  tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  subscriptionId: "11111111-2222-3333-4444-555555555555",
};

test("the envelope names the environment, runs from the project root without prompts and records the identity", () => {
  const envelope = buildAzdExecutionEnvelope({ environmentName: "lab", target: TARGET });
  assert.deepEqual(envelope, {
    workingDirectory: "project-root",
    environmentName: "lab",
    prompts: "disabled",
    identityPreflight: { cloud: "AzureCloud", ...TARGET, onMismatch: "stop" },
  });
  assert.equal(
    buildAzdExecutionEnvelope({ environmentName: "lab", target: TARGET, cloud: "AzureUSGovernment" }).identityPreflight
      .cloud,
    "AzureUSGovernment",
  );
});

test("azd arguments name the environment and project root, never prompt and cannot express up, deploy or purge", () => {
  const envelope = buildAzdExecutionEnvelope({ environmentName: "lab", target: TARGET });
  const root = resolve("/work/project");
  assert.deepEqual(buildAzdArguments(envelope, "provision-preview", root), [
    "provision",
    "--preview",
    "--no-state",
    "--environment",
    "lab",
    "--cwd",
    root,
    "--no-prompt",
    "--output",
    "json",
  ]);
  assert.deepEqual(buildAzdArguments(envelope, "provision", root), [
    "provision",
    "--no-state",
    "--environment",
    "lab",
    "--cwd",
    root,
    "--no-prompt",
  ]);
  assert.deepEqual(buildAzdArguments(envelope, "down", root), [
    "down",
    "--force",
    "--environment",
    "lab",
    "--cwd",
    root,
    "--no-prompt",
  ]);
  for (const operation of ["up", "deploy", "pipeline", "env", ""])
    assert.throws(
      () => buildAzdArguments(envelope, operation as never, root),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_BINDING_INPUT_INVALID",
    );
  for (const unsafe of ["", "relative/project", "--purge"])
    assert.throws(
      () => buildAzdArguments(envelope, "provision", unsafe),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_BINDING_INPUT_INVALID",
    );
  for (const operation of ["provision-preview", "provision", "down"] as const)
    assert.ok(!buildAzdArguments(envelope, operation, root).includes("--purge"));
});

const binding: Pick<AzdBindingV1, "executionEnvelope"> = {
  executionEnvelope: buildAzdExecutionEnvelope({ environmentName: "lab", target: TARGET }),
};
const observed = {
  cloud: "AzureCloud",
  tenantId: TARGET.tenantId,
  azureCliDefaultSubscriptionId: TARGET.subscriptionId,
};

test("the identity preflight accepts only the approved cloud, tenant and Azure CLI subscription", () => {
  assertAzdIdentityMatchesBinding(observed, binding);
  assertAzdIdentityMatchesBinding(
    {
      ...observed,
      tenantId: TARGET.tenantId.toUpperCase(),
      azureCliDefaultSubscriptionId: TARGET.subscriptionId.toUpperCase(),
    },
    binding,
  );
  const mismatches: Array<[Record<string, string | undefined>, RegExp]> = [
    [{ cloud: "AzureUSGovernment" }, /cloud does not match/u],
    [{ tenantId: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee" }, /tenant does not match/u],
    [{ azureCliDefaultSubscriptionId: "22222222-2222-3333-4444-555555555555" }, /CLI subscription does not match/u],
    [{ cloud: undefined }, /cloud was not reported/u],
    [{ tenantId: undefined }, /tenant was not reported/u],
    [{ azureCliDefaultSubscriptionId: undefined }, /CLI subscription was not reported/u],
  ];
  for (const [change, message] of mismatches)
    assert.throws(
      () => assertAzdIdentityMatchesBinding({ ...observed, ...change }, binding),
      (error: unknown) =>
        error instanceof AzdBindingError &&
        error.code === "AZD_IDENTITY_MISMATCH" &&
        message.test(error.message) &&
        !error.message.includes(TARGET.tenantId) &&
        !error.message.includes(TARGET.subscriptionId),
    );
});
