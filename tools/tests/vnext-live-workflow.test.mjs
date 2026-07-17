import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  approvedDispatchState,
  canonicalRecipient,
  handoffRecipient,
  isAcceptedLocalOwnership,
  parseArgs,
  validateDispatchRunState,
  validateGitStatus,
  validateTransportKey,
  validateWorkflowBootstrap,
  withFirewall,
  workflowRef,
} from "../scripts/vnext-live-handoff.mjs";
import { validateWorkflowText } from "../scripts/validate-vnext-live-workflow.mjs";

const baseline = readFileSync(new URL("../../.github/workflows/vnext-live-qualification.yml", import.meta.url), "utf8");
const launcher = readFileSync(new URL("../scripts/vnext-live-handoff.mjs", import.meta.url), "utf8");
const closedBackendState = JSON.stringify({
  publicNetworkAccess: "Disabled",
  defaultAction: "Deny",
  ipRules: [],
  securityControl: null,
  allowSharedKeyAccess: false,
  allowBlobPublicAccess: false,
  defaultToOAuthAuthentication: true,
});

function rejectsMutation(name, mutate, expected) {
  test(name, () => {
    const errors = validateWorkflowText(mutate(baseline));
    assert.ok(
      errors.some((error) => error.includes(expected)),
      errors.join("\n"),
    );
  });
}

test("baseline live workflow passes", () => assert.deepEqual(validateWorkflowText(baseline), []));

test("live workflow imports approval and cannot decide Gate 4 in CI", () => {
  assert.doesNotMatch(baseline, /\bgate decide\b/);
});

rejectsMutation(
  "missing destination repository guard fails",
  (text) => text.replace('          test "$GITHUB_REPOSITORY" = "jonathan-vella/apex-vnext"\n', ""),
  "destination repository guard",
);
rejectsMutation(
  "missing protected environment fails",
  (text) => text.replace("    environment: vnext-qualification\n", ""),
  "apply environment",
);
rejectsMutation(
  "missing id-token permission fails",
  (text) => text.replace("      id-token: write\n", ""),
  "id-token write",
);
rejectsMutation(
  "workflow-level id-token permission fails",
  (text) => text.replace("permissions:\n  contents: read\n", "permissions:\n  contents: read\n  id-token: write\n"),
  "workflow permissions must be contents read only",
);
rejectsMutation(
  "missing preview hash input fails",
  (text) => text.replace("      preview_hash:\n", "      ignored_preview_hash:\n"),
  "exact dispatch input set",
);
rejectsMutation(
  "extra dispatch input fails",
  (text) => text.replace("      preview_hash:\n", "      unexpected:\n        required: false\n      preview_hash:\n"),
  "exact dispatch input set",
);
rejectsMutation(
  "old preview job fails",
  (text) => text.replace("  apply:\n", "  preview:\n    runs-on: ubuntu-latest\n    steps: []\n\n  apply:\n"),
  "exact validate_dispatch and apply jobs",
);
rejectsMutation(
  "apply without validation dependency fails",
  (text) => text.replace("    needs: validate_dispatch\n", ""),
  "apply must need validate_dispatch",
);
rejectsMutation(
  "job-wide transport key fails",
  (text) =>
    text.replace(
      "      APEX_CONTROL_RESOURCE_GROUP: ${{ vars.APEX_CONTROL_RESOURCE_GROUP }}",
      "      APEX_PLAN_TRANSPORT_KEY: ${{ secrets.APEX_PLAN_TRANSPORT_KEY }}\n      APEX_CONTROL_RESOURCE_GROUP: ${{ vars.APEX_CONTROL_RESOURCE_GROUP }}",
    ),
  "transport key must not be job-wide",
);
rejectsMutation(
  "exported ARM token fails",
  (text) => text.replace("            return token;", '            core.exportVariable("ARM_OIDC_TOKEN", token);'),
  "masked step output",
);
rejectsMutation(
  "missing refreshed deploy ARM token fails",
  (text) => text.replace("      - name: Refresh ARM OIDC token for deploy", "      - name: Missing deploy token"),
  "refreshed ARM token",
);
rejectsMutation(
  "missing data-plane readiness fails",
  (text) => text.replace("az storage blob list --auth-mode login", "az storage container list --auth-mode login"),
  "readiness probe",
);
rejectsMutation(
  "missing exact qualification context validation fails",
  (text) => text.replace("node tools/scripts/validate-vnext-qualification-context.mjs", "node -e 'process.exit(0)'"),
  "exact qualification context",
);
rejectsMutation(
  "qualification validation after endpoint opening fails",
  (text) => {
    const validation = "          node tools/scripts/validate-vnext-qualification-context.mjs\n";
    const firewall =
      '          az storage account update --resource-group "$APEX_CONTROL_RESOURCE_GROUP" --name "$APEX_BACKEND_STORAGE_ACCOUNT" --default-action Allow --only-show-errors --output none\n';
    return text.replace(validation, "").replace(firewall, `${firewall}${validation}`);
  },
  "apply security exception validation must precede endpoint opening",
);
rejectsMutation(
  "missing firewall boundary exception recheck fails",
  (text) =>
    text.replace(
      "          node tools/scripts/validate-vnext-qualification-context.mjs --security-exception-only\n",
      "",
    ),
  "apply firewall boundary transaction",
);
rejectsMutation(
  "storage IP rule fails",
  (text) =>
    text.replace(
      "          for attempt in 1 2 3 4 5; do",
      '          az storage account network-rule add --account-name "$APEX_BACKEND_STORAGE_ACCOUNT" --ip-address 203.0.113.10\n          for attempt in 1 2 3 4 5; do',
    ),
  "IP rules forbidden",
);
rejectsMutation(
  "missing transient policy exclusion fails",
  (text) =>
    text.replace(
      '          az storage account update --resource-group "$APEX_CONTROL_RESOURCE_GROUP" --name "$APEX_BACKEND_STORAGE_ACCOUNT" --set tags.SecurityControl=Ignore --only-show-errors --output none\n',
      "",
    ),
  "apply firewall boundary transaction",
);
rejectsMutation(
  "missing endpoint disable cleanup fails",
  (text) =>
    text.replace(
      '          az storage account update --resource-group "$APEX_CONTROL_RESOURCE_GROUP" --name "$APEX_BACKEND_STORAGE_ACCOUNT" --public-network-access Disabled --only-show-errors --output none\n',
      "",
    ),
  "apply unconditional cleanup",
);
rejectsMutation(
  "missing policy exclusion cleanup fails",
  (text) =>
    text.replace(
      '          az storage account update --resource-group "$APEX_CONTROL_RESOURCE_GROUP" --name "$APEX_BACKEND_STORAGE_ACCOUNT" --remove tags.SecurityControl --only-show-errors --output none\n',
      "",
    ),
  "apply unconditional cleanup",
);
rejectsMutation(
  "missing unconditional cleanup fails",
  (text) =>
    text.replace(
      "      - name: Close temporary Entra-only endpoint session\n        if: always()",
      "      - name: Close temporary Entra-only endpoint session",
    ),
  "unconditional cleanup",
);
rejectsMutation(
  "missing at-rest endpoint validation fails",
  (text) =>
    text.replace("      - name: Validate at-rest endpoint boundary", "      - name: Skip at-rest endpoint check"),
  "at-rest endpoint validation",
);
rejectsMutation(
  "deploy without exact preview fails",
  (text) => text.replace('deploy --preview "${{ inputs.preview_hash }}"', "deploy"),
  "exact dispatch preview hash",
);
rejectsMutation(
  "CI Gate decision fails",
  (text) =>
    text.replace(
      "npm run build:vnext",
      "npm run build:vnext\n          node packages/cli/dist/cli.js gate decide --gate 4",
    ),
  "forbidden direct mutation",
);
rejectsMutation(
  "workflow preview creation fails",
  (text) => text.replace("npm run build:vnext", "npm run build:vnext\n          apex preview"),
  "forbidden direct mutation",
);
rejectsMutation(
  "wrong stable recipient fails",
  (text) => text.replace(":handoff:${HANDOFF_ID}:apply", ":${GITHUB_RUN_ID}:1:apply"),
  "stable handoff apply recipient",
);
rejectsMutation(
  "wrong incoming blob path fails",
  (text) => text.replace("incoming/${{ inputs.handoff_id }}/${object}.json", "incoming/${{ inputs.handoff_id }}.json"),
  "exact incoming state/provider downloads",
);
rejectsMutation(
  "missing provider import fails",
  (text) => text.replace("provider transfer-import", "provider inspect"),
  "apply imports",
);
rejectsMutation(
  "missing isolated runtime fails",
  (text) => text.replace("      APEX_RUNTIME_ROOT: ${{ github.workspace }}/apex-live/runtime\n", ""),
  "isolated APEX runtime",
);
rejectsMutation(
  "checkout-root state import fails",
  (text) =>
    text.replace(
      '          cd "$APEX_RUNTIME_ROOT"\n          node "$cli" state transfer-import',
      '          cd "$GITHUB_WORKSPACE"\n          node "$cli" state transfer-import',
    ),
  "import state in the isolated runtime",
);
rejectsMutation(
  "missing writer acceptance fails",
  (text) => text.replace("writer transfer-accept", "writer inspect"),
  "import, accept, approval, and deletion order",
);
rejectsMutation(
  "missing approval show fails",
  (text) => text.replace("approval show --json", "approval inspect --json"),
  "import, accept, approval, and deletion order",
);
rejectsMutation(
  "missing Gate 4 approval binding fails",
  (text) => text.replace("gate:4,decision", "gate:3,decision"),
  "imported tty approval validation",
);
rejectsMutation(
  "wrong approval mechanism fails",
  (text) => text.replace('mechanism:"tty"', 'mechanism:"github-environment"'),
  "imported tty approval validation",
);
rejectsMutation(
  "missing prior writer epoch check fails",
  (text) => text.replace("run?.ownerEpoch!==approval.writerEpoch+1", "run?.ownerEpoch!==approval.writerEpoch"),
  "imported tty approval validation",
);
rejectsMutation(
  "early incoming deletion fails",
  (text) =>
    text.replace(
      '          node "$cli" approval show --json',
      '          az storage blob delete --name early\n          node "$cli" approval show --json',
    ),
  "import, accept, approval, and deletion order",
);
rejectsMutation(
  "missing provider preview binding fails",
  (text) => text.replace(".result.previewHash", ".result.unboundHash"),
  "imported provider binding validation",
);
rejectsMutation(
  "missing apply lock binding fails",
  (text) => text.replace('            test "$lock_hash" = "$attested_lock_hash"\n', ""),
  "current Terraform lock hash",
);
rejectsMutation(
  "direct terraform apply fails",
  (text) =>
    text.replace(
      "terraform -chdir=infra/terraform/vnext-qualification init -input=false",
      "terraform -chdir=infra/terraform/vnext-qualification apply -auto-approve",
    ),
  "forbidden direct mutation",
);
rejectsMutation(
  "direct Azure deployment fails",
  (text) => text.replace("npm run build:vnext", "az stack group create --name bypass"),
  "forbidden direct mutation",
);
rejectsMutation(
  "key path artifact fails",
  (text) => text.replace("          path: apex-live/evidence/", "          path: plan-transport.key"),
  "plaintext/key path",
);
rejectsMutation(
  "state path artifact fails",
  (text) => text.replace("          path: apex-live/evidence/", "          path: terraform.tfstate"),
  "plaintext/key path",
);
rejectsMutation(
  "plain plan path artifact fails",
  (text) => text.replace("          path: apex-live/evidence/", "          path: qualification.tfplan"),
  "plaintext/key path",
);
rejectsMutation(
  "hidden artifact parent fails",
  (text) => text.replace("          path: apex-live/evidence/", "          path: .apex-live/evidence/"),
  "hidden path segment",
);
rejectsMutation(
  "wrong upload action version fails",
  (text) => text.replace("actions/upload-artifact@v4", "actions/upload-artifact@v3"),
  "apply artifacts invalid",
);
rejectsMutation(
  "unsafe return fallback settings fail",
  (text) => text.replace("          compression-level: 0", "          compression-level: 6"),
  "encrypted return fallback artifact",
);
rejectsMutation(
  "wrong checkout action version fails",
  (text) => text.replace("actions/checkout@v6", "actions/checkout@v5"),
  "checkout must use v6",
);
rejectsMutation(
  "wrong checkout ref fails",
  (text) => text.replace("          ref: ${{ inputs.candidate_sha }}", "          ref: refs/heads/main"),
  "candidate SHA",
);
rejectsMutation(
  "persisted checkout credentials fail",
  (text) => text.replace("          persist-credentials: false", "          persist-credentials: true"),
  "persisted credentials disabled",
);
rejectsMutation(
  "run-attempt rollover allowance fails",
  (text) => text.replace('test "$GITHUB_RUN_ATTEMPT" = "1"', 'test "$GITHUB_RUN_ATTEMPT" -gt "0"'),
  "attempt-one guard",
);

test("launcher derives canonical GitHub identities", () => {
  assert.equal(canonicalRecipient("owner/repo", "42", 1, "preview"), "github-actions:owner/repo:42:1:preview");
  assert.equal(
    workflowRef("owner/repo", "main"),
    "owner/repo/.github/workflows/vnext-live-qualification.yml@refs/heads/main",
  );
  assert.throws(() => canonicalRecipient("owner/repo", "42", 2, "preview"));
});

test("launcher binds local approval to the stable handoff recipient", () => {
  const handoffId = "123e4567-e89b-42d3-a456-426614174000";
  const recipient = handoffRecipient("jonathan-vella/apex-vnext", handoffId);
  assert.equal(recipient, `github-actions:jonathan-vella/apex-vnext:handoff:${handoffId}:apply`);
  assert.equal(
    approvedDispatchState(
      {
        result: {
          run: {
            iacTool: "bicep",
            ownerEpoch: 3,
            gates: [
              { gate: 3, state: "approved" },
              { gate: 4, state: "approved" },
            ],
          },
        },
      },
      {
        result: {
          gate: 4,
          decision: "approved",
          mechanism: "tty",
          writerEpoch: 3,
          recipientIdentity: recipient,
          previewHash: "a".repeat(64),
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
      "bicep",
      recipient,
    ),
    "a".repeat(64),
  );
  assert.throws(
    () =>
      approvedDispatchState(
        {
          result: {
            run: {
              iacTool: "bicep",
              ownerEpoch: 3,
              gates: [
                { gate: 3, state: "approved" },
                { gate: 4, state: "approved" },
              ],
            },
          },
        },
        { result: {} },
        "bicep",
        recipient,
      ),
    /approved local Gate 4/,
  );
});

test("dispatch permits only repository-backed APEX state drift", () => {
  assert.doesNotThrow(() => validateGitStatus(" M .apex/config.json\n?? .apex/objects/sha256/ab/object\n", true));
  assert.doesNotThrow(() => validateGitStatus("M .apex/config.json\n?? .apex/objects/sha256/ab/object", true));
  assert.throws(() => validateGitStatus(" M .apex/config.json\n"), /permitted APEX state boundary/);
  assert.throws(
    () => validateGitStatus(" M .apex/config.json\n M .github/workflows/vnext-live-qualification.yml\n", true),
    /permitted APEX state boundary/,
  );
  assert.throws(() => validateGitStatus("R  .apex/old -> .apex/new\n", true), /permitted APEX state boundary/);
});

test("launcher validates the exception and at-rest posture before opening its endpoint session", () => {
  const helper = launcher.slice(
    launcher.indexOf("async function withFirewall"),
    launcher.indexOf("async function discoverRun"),
  );
  assert.ok(helper.lastIndexOf("assertException()") < helper.indexOf('"--default-action"'));
  assert.ok(helper.indexOf("allowSharedKeyAccess") < helper.indexOf('"tags.SecurityControl=Ignore"'));
  assert.ok(helper.indexOf('"tags.SecurityControl=Ignore"') < helper.indexOf('"--public-network-access"'));
  assert.ok(helper.indexOf('"public-network-access",\n      "Enabled"') < helper.indexOf('"--default-action"'));
  assert.ok(helper.lastIndexOf('"--default-action"') > helper.indexOf('"storage", "blob"'));
  assert.ok(helper.lastIndexOf('"--public-network-access"') > helper.indexOf('"storage", "blob"'));
  assert.doesNotMatch(helper, /network-rule/);
});

test("launcher rejects an invalid exception before endpoint mutation", async () => {
  const commands = [];
  await assert.rejects(
    withFirewall(
      {
        resource_group: "control-rg",
        storage_account: "storage",
        container: "handoff",
      },
      async () => undefined,
      {
        validateException: () => ["exception is expired"],
        run: async (file, args) => commands.push([file, ...args]),
      },
    ),
    /exception is invalid/,
  );
  assert.deepEqual(commands, []);
});

test("launcher restores and verifies Deny and Disabled after a local endpoint session", async () => {
  const commands = [];
  const result = await withFirewall(
    {
      resource_group: "control-rg",
      storage_account: "storage",
      container: "handoff",
    },
    async () => "complete",
    {
      validateException: () => [],
      run: async (file, args) => {
        commands.push([file, ...args]);
        return args.includes("show") ? closedBackendState : "";
      },
    },
  );
  assert.equal(result, "complete");
  const rendered = commands.map((command) => command.join(" "));
  assert.ok(rendered.some((command) => command.includes("--set tags.SecurityControl=Ignore")));
  assert.ok(rendered.some((command) => command.includes("--public-network-access Enabled")));
  assert.ok(rendered.some((command) => command.includes("--default-action Allow")));
  assert.ok(rendered.some((command) => command.includes("--default-action Deny")));
  assert.ok(rendered.every((command) => !command.includes("network-rule")));
  assert.ok(rendered.some((command) => command.includes("--public-network-access Disabled")));
  assert.ok(rendered.some((command) => command.includes("--remove tags.SecurityControl")));
  assert.ok(rendered.some((command) => command.includes("account show") && command.includes("publicNetworkAccess")));
});

test("launcher cleans up before propagating a protected operation failure", async () => {
  const commands = [];
  await assert.rejects(
    withFirewall(
      {
        resource_group: "control-rg",
        storage_account: "storage",
        container: "handoff",
      },
      async () => {
        throw new Error("protected operation failed");
      },
      {
        validateException: () => [],
        run: async (file, args) => {
          commands.push([file, ...args]);
          return args.includes("show") ? closedBackendState : "";
        },
      },
    ),
    /protected operation failed/,
  );
  const rendered = commands.map((command) => command.join(" "));
  assert.ok(rendered.some((command) => command.includes("--default-action Deny")));
  assert.ok(rendered.some((command) => command.includes("--public-network-access Disabled")));
  assert.ok(rendered.some((command) => command.includes("--remove tags.SecurityControl")));
  assert.ok(rendered.some((command) => command.includes("account show") && command.includes("publicNetworkAccess")));
});

test("launcher validates transport keys without exposing values", () => {
  assert.equal(validateTransportKey(Buffer.alloc(32, 7).toString("base64")), true);
  assert.throws(() => validateTransportKey(Buffer.alloc(31).toString("base64")), /exactly 32 bytes/);
});

test("launcher preflights selected track and gate state before dispatch", () => {
  const status = {
    result: {
      run: {
        iacTool: "bicep",
        gates: [
          { gate: 3, state: "approved" },
          { gate: 4, state: "closed" },
        ],
      },
    },
  };
  assert.equal(validateDispatchRunState(status, "bicep"), true);
  assert.throws(() => validateDispatchRunState(status, "terraform"), /does not match/);
  assert.throws(
    () =>
      validateDispatchRunState(
        { result: { run: { ...status.result.run, gates: [{ gate: 3, state: "open" }] } } },
        "bicep",
      ),
    /Gate 3/,
  );
  assert.throws(
    () =>
      validateDispatchRunState(
        {
          result: {
            run: {
              ...status.result.run,
              gates: [
                { gate: 3, state: "approved" },
                { gate: 4, state: "inherited" },
              ],
            },
          },
        },
        "bicep",
      ),
    /unsupported Gate 4/,
  );
  assert.equal(
    validateDispatchRunState(
      {
        result: {
          run: {
            ...status.result.run,
            gates: [
              { gate: 3, state: "approved" },
              { gate: 4, state: "approved" },
            ],
          },
        },
      },
      "bicep",
    ),
    true,
  );
});

test("launcher recognizes only the exact accepted local return owner", () => {
  const ownership = {
    result: {
      ownerId: "local:123e4567-e89b-42d3-a456-426614174000",
      ownerEpoch: 3,
      claimHash: "a".repeat(64),
      commit: "b".repeat(40),
    },
  };
  assert.equal(isAcceptedLocalOwnership(ownership, "local:123e4567-e89b-42d3-a456-426614174000", "b".repeat(40)), true);
  assert.equal(isAcceptedLocalOwnership(ownership, "local:other", "b".repeat(40)), false);
  assert.equal(isAcceptedLocalOwnership(ownership, ownership.result.ownerId, "c".repeat(40)), false);
});

test("launcher requires the workflow file on the default branch before dispatch", () => {
  const repository = { nameWithOwner: "jonathan-vella/apex-vnext", defaultBranchRef: { name: "main" } };
  const sha = "a".repeat(40);
  const workflow = {
    type: "file",
    path: ".github/workflows/vnext-live-qualification.yml",
    sha,
  };
  assert.deepEqual(validateWorkflowBootstrap(repository, workflow, workflow, sha), {
    repository: "jonathan-vella/apex-vnext",
    defaultBranch: "main",
  });
  assert.throws(
    () => validateWorkflowBootstrap({ ...repository, nameWithOwner: "owner/repo" }, workflow, workflow, sha),
    /destination repository/,
  );
  assert.throws(
    () => validateWorkflowBootstrap(repository, { ...workflow, path: ".github/workflows/other.yml" }, workflow, sha),
    /reviewed onto main/,
  );
  assert.throws(
    () => validateWorkflowBootstrap(repository, workflow, { ...workflow, sha: "b".repeat(40) }, sha),
    /byte-identical/,
  );
  assert.throws(() => validateWorkflowBootstrap({ nameWithOwner: "owner/repo" }, null, null, null), /metadata/);
});

test("launcher strictly parses dispatch and retrieve arguments", () => {
  const handoffId = "123e4567-e89b-42d3-a456-426614174000";
  const common = [
    "--yes",
    "--track",
    "bicep",
    "--operation",
    "apply",
    "--resource-group",
    "control-rg",
    "--storage-account",
    "storage",
  ];
  assert.equal(parseArgs(["preview", ...common]).container, "handoff");
  assert.equal(parseArgs(["preview", ...common, "--handoff-id", handoffId]).handoff_id, handoffId);
  assert.equal(parseArgs(["dispatch", ...common, "--ref", "main", "--handoff-id", handoffId]).container, "handoff");
  const retrieved = parseArgs(["retrieve", ...common, "--handoff-id", handoffId, "--destination", "/tmp/candidate"]);
  assert.equal(retrieved.stage, "apply");
  assert.throws(() => parseArgs(["preview", ...common, "--handoff-id", "not-a-uuid"]), /UUID/);
  assert.throws(() => parseArgs(["dispatch", ...common, "--ref", "main"]), /requires --handoff-id UUID/);
  assert.throws(
    () => parseArgs(["dispatch", ...common, "--ref", "feat/apex-vnext-rewrite", "--handoff-id", handoffId]),
    /must be main/,
  );
  assert.throws(() => parseArgs(["dispatch", ...common, "--ref", "main", "--handoff-id", handoffId, "--extra", "x"]));
});
