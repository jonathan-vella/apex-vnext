import assert from "node:assert/strict";
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

test("azd arguments always name the environment, never prompt and cannot express azd up", () => {
  const envelope = buildAzdExecutionEnvelope({ environmentName: "lab", target: TARGET });
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

const binding: Pick<AzdBindingV1, "executionEnvelope"> = {
  executionEnvelope: buildAzdExecutionEnvelope({ environmentName: "lab", target: TARGET }),
};
const observed = {
  cloud: "AzureCloud",
  tenantId: TARGET.tenantId,
  subscriptionId: TARGET.subscriptionId,
  azureCliDefaultSubscriptionId: TARGET.subscriptionId,
};

test("the identity preflight accepts only the approved cloud, tenant and subscription", () => {
  assertAzdIdentityMatchesBinding(observed, binding);
  assertAzdIdentityMatchesBinding(
    { ...observed, tenantId: TARGET.tenantId.toUpperCase(), subscriptionId: TARGET.subscriptionId.toUpperCase() },
    binding,
  );
  const mismatches: Array<[Record<string, string | undefined>, RegExp]> = [
    [{ cloud: "AzureUSGovernment" }, /cloud does not match/u],
    [{ tenantId: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee" }, /tenant does not match/u],
    [{ subscriptionId: "22222222-2222-3333-4444-555555555555" }, /subscription does not match/u],
    [
      { azureCliDefaultSubscriptionId: "22222222-2222-3333-4444-555555555555" },
      /CLI default subscription does not match/u,
    ],
    [{ cloud: undefined }, /cloud was not reported/u],
    [{ tenantId: undefined }, /tenant was not reported/u],
    [{ subscriptionId: "" }, /subscription was not reported/u],
    [{ azureCliDefaultSubscriptionId: undefined }, /CLI default subscription was not reported/u],
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
