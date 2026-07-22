import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as yaml from "js-yaml";
import {
  loadLocalActionTexts,
  loadWorkflowTexts,
  validateGithubWorkflowContract,
  workflowContractDigest,
} from "../scripts/validate-github-workflows.mjs";

const contract = JSON.parse(readFileSync("tools/registry/github-workflow-contract.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/github-workflow-contract.schema.json", "utf8"));
const workflowTexts = loadWorkflowTexts();
const localActionTexts = loadLocalActionTexts(Object.keys(contract.localActions));

function validate(texts = workflowTexts, value = contract) {
  return validateGithubWorkflowContract({ contract: value, schema, workflowTexts: texts, localActionTexts });
}

function mutate(path, search, replacement) {
  const texts = structuredClone(workflowTexts);
  assert.ok(texts[path].includes(search), `${search} missing from ${path}`);
  texts[path] = texts[path].replace(search, replacement);
  return texts;
}

function rebaseline(path, texts, value = structuredClone(contract)) {
  const workflow = value.workflows.find((item) => item.path === path);
  assert.ok(workflow, `contract missing ${path}`);
  const parsed = yaml.load(texts[path]);
  workflow.triggerDigest = workflowContractDigest(parsed.on);
  workflow.permissionsDigest = workflowContractDigest(parsed.permissions);
  workflow.concurrencyDigest = workflowContractDigest(parsed.concurrency);
  workflow.jobsDigest = workflowContractDigest(parsed.jobs);
  workflow.jobs = Object.fromEntries(Object.entries(parsed.jobs).map(([id, job]) => [id, job.name ?? id]));
  return value;
}

test("current GitHub workflows satisfy the hosted contract", () => {
  assert.deepEqual(validate(), []);
});

test("rejects required context and external-runtime check drift", () => {
  const changedContract = structuredClone(contract);
  changedContract.expectedRequiredContexts[0] = "renamed-ci";
  assert.ok(
    validate(workflowTexts, changedContract).includes(
      "offline expected status contexts drift from the recorded branch-protection snapshot",
    ),
  );

  const errors = validate(
    mutate(
      ".github/workflows/ci.yml",
      "name: External Python tests (apex-recall + azure-pricing MCP)",
      "name: Combined tests",
    ),
  );
  assert.ok(errors.some((error) => error.includes("job/check name drift")));
  assert.ok(errors.some((error) => error.includes("separate required Node and external Python checks")));
});

test("rejects trigger, permission, and action-version drift", () => {
  assert.ok(
    validate(mutate(".github/workflows/docs.yml", '      - "docs/**"', '      - "other/**"')).some((error) =>
      error.includes("on contract drift"),
    ),
  );
  assert.ok(
    validate(
      mutate(".github/workflows/ci.yml", "permissions:\n  contents: read", "permissions:\n  contents: write"),
    ).some((error) => error.includes("permissions contract drift")),
  );
  assert.ok(
    validate(mutate(".github/workflows/ci.yml", "actions/checkout@v7", "actions/checkout@latest")).some((error) =>
      error.includes("mutable or malformed action reference"),
    ),
  );
});

test("rejects job permission escalation, no-op execution, and exact action substitution", () => {
  const path = ".github/workflows/ci.yml";
  assert.ok(
    validate(mutate(path, "  ci:\n    name: ci", "  ci:\n    name: ci\n    permissions:\n      contents: write")).some(
      (error) => error.includes("complete job contract drift"),
    ),
  );
  assert.ok(
    validate(mutate(path, "  ci:\n    name: ci", "  ci:\n    name: ci\n    if: false")).some((error) =>
      error.includes("complete job contract drift"),
    ),
  );
  assert.ok(
    validate(mutate(path, "actions/checkout@v7", "actions/checkout@v6")).some((error) =>
      error.includes("complete job contract drift"),
    ),
  );
  assert.ok(
    validate(mutate(path, "run: npm run test:apex-recall", "run: echo skipped-apex-recall")).some((error) =>
      error.includes("complete job contract drift"),
    ),
  );
});

test("rejects local composite action drift", () => {
  const changed = { ...localActionTexts, ".github/actions/setup-node-repo/action.yml": "name: changed\n" };
  const errors = validateGithubWorkflowContract({ contract, schema, workflowTexts, localActionTexts: changed });
  assert.ok(errors.includes(".github/actions/setup-node-repo/action.yml: local action content drift"));
});

test("rejects Python validation setup weakening and caller removal", () => {
  const actionPath = ".github/actions/setup-python-validation/action.yml";
  for (const [search, replacement, expected] of [
    ['python-version: "3.14"', 'python-version: "3.13"', "version or cache contract drift"],
    ["cache: pip", "cache: none", "version or cache contract drift"],
    ["set -euo pipefail", "set -e", "dependency bootstrap drift"],
    ["[admin,dev]", "[dev]", "dependency bootstrap drift"],
    ["using: composite", "using: node20", "structure or runtime drift"],
    ["      shell: bash", "      continue-on-error: true\n      shell: bash", "dependency bootstrap drift"],
    [
      "      shell: bash",
      "      env:\n        BASH_ENV: ./bootstrap.sh\n      shell: bash",
      "dependency bootstrap drift",
    ],
    ["      shell: bash", "      working-directory: tools\n      shell: bash", "dependency bootstrap drift"],
  ]) {
    assert.ok(localActionTexts[actionPath].includes(search), `${search} missing from ${actionPath}`);
    const changed = { ...localActionTexts, [actionPath]: localActionTexts[actionPath].replace(search, replacement) };
    const changedContract = structuredClone(contract);
    changedContract.localActions[actionPath] = createHash("sha256").update(changed[actionPath]).digest("hex");
    const errors = validateGithubWorkflowContract({
      contract: changedContract,
      schema,
      workflowTexts,
      localActionTexts: changed,
    });
    assert.ok(errors.some((error) => error.startsWith(`${actionPath}: `) && error.includes(expected)));
  }

  for (const path of [".github/workflows/ci.yml", ".github/workflows/release-candidate-qualification.yml"]) {
    const texts = mutate(
      path,
      "      - name: Setup Python validation\n        uses: ./.github/actions/setup-python-validation\n",
      "",
    );
    assert.ok(validate(texts).some((error) => error.includes("complete job contract drift")));
  }
});

test("reports a missing local composite action without throwing", () => {
  const missingPath = ".github/actions/does-not-exist/action.yml";
  const changedContract = structuredClone(contract);
  changedContract.localActions = { [missingPath]: "0".repeat(64) };
  const changedTexts = loadLocalActionTexts([missingPath]);
  const errors = validateGithubWorkflowContract({
    contract: changedContract,
    schema,
    workflowTexts,
    localActionTexts: changedTexts,
  });
  assert.ok(errors.includes(`${missingPath}: local action is missing`));
});

test("rejects release exact-head, credential, artifact, and authority drift", () => {
  const path = ".github/workflows/release-candidate-qualification.yml";
  assert.ok(
    validate(mutate(path, "ref: ${{ github.event.pull_request.head.sha || github.sha }}", "ref: main")).some((error) =>
      error.includes("exact candidate"),
    ),
  );
  assert.ok(
    validate(mutate(path, "persist-credentials: false", "persist-credentials: true")).some((error) =>
      error.includes("persisted credentials"),
    ),
  );
  assert.ok(
    validate(mutate(path, "retention-days: 30", "retention-days: 1")).some((error) =>
      error.includes("artifact version or retention drift"),
    ),
  );
  assert.ok(
    validate(
      mutate(
        path,
        "      - name: Setup Node repository",
        "      - name: Extra checkout\n        uses: actions/checkout@v6\n        with:\n          ref: main\n      - name: Setup Node repository",
      ),
    ).some((error) => error.includes("exact candidate")),
  );
  assert.ok(
    validate(
      mutate(
        path,
        "      - name: Upload compact qualification evidence",
        "      - name: Extra upload\n        uses: actions/upload-artifact@v4\n        with:\n          name: extra\n          path: package-lock.json\n      - name: Upload compact qualification evidence",
      ),
    ).some((error) => error.includes("artifact version or retention drift")),
  );
  assert.ok(
    validate(
      mutate(
        path,
        "          npm run qualify:vnext-release -- \\",
        "          npm publish\n          npm run qualify:vnext-release -- \\",
      ),
    ).some((error) => error.includes("forbidden mutation authority")),
  );
});

test("release authority and evidence invariants survive contract rebaselining", () => {
  const path = ".github/workflows/release-candidate-qualification.yml";
  for (const command of [
    "terraform -chdir=infra apply",
    "azd --cwd infra deploy",
    "gh release create v1",
    "gh api --method POST repos/example/releases",
    "gh api -X POST repos/example/releases",
    "gh api --method=POST repos/example/releases",
    "gh api -XPOST repos/example/releases",
    "gh api repos/example/releases -f tag_name=v1",
    "gh api repos/example/releases -F tag_name=v1",
    "gh api repos/example/releases -Ftag_name=v1",
    "gh api repos/example/releases -ftag_name=v1",
    "gh api repos/example/releases --raw-field tag_name=v1",
    "gh api repos/example/releases --input payload.json",
    "gh api repos/example/releases --input=payload.json",
    "/usr/bin/npm publish",
    "npm pub",
  ]) {
    const texts = mutate(
      path,
      "          npm run qualify:vnext-release -- \\",
      ["          ", command, "\n          npm run qualify:vnext-release -- \\"].join(""),
    );
    assert.ok(validate(texts, rebaseline(path, texts)).some((error) => error.includes("forbidden mutation authority")));
  }

  const permissionTexts = mutate(
    path,
    "  qualify:\n    name: Exact-head release qualification",
    "  qualify:\n    name: Exact-head release qualification\n    permissions:\n      contents: write",
  );
  assert.ok(
    validate(permissionTexts, rebaseline(path, permissionTexts)).some((error) =>
      error.includes("permissions must remain exactly contents read"),
    ),
  );

  const extraJobTexts = mutate(
    path,
    "jobs:\n  qualify:",
    "jobs:\n  mutate:\n    permissions:\n      contents: write\n      pull-requests: write\n    runs-on: ubuntu-latest\n    steps:\n      - uses: peter-evans/create-pull-request@v8\n  qualify:",
  );
  assert.ok(
    validate(extraJobTexts, rebaseline(path, extraJobTexts)).some((error) =>
      error.includes("exactly the single qualify job"),
    ),
  );

  const actionTexts = mutate(
    path,
    "      - name: Setup Node repository",
    "      - name: Open pull request\n        uses: peter-evans/create-pull-request@v8\n      - name: Setup Node repository",
  );
  assert.ok(validate(actionTexts, rebaseline(path, actionTexts)).some((error) => error.includes("unapproved action")));

  const removedActionTexts = mutate(
    path,
    "      - name: Setup Terraform\n        uses: hashicorp/setup-terraform@v4\n        with:\n          terraform_version: 1.15.8\n          terraform_wrapper: false\n\n",
    "",
  );
  assert.ok(
    validate(removedActionTexts, rebaseline(path, removedActionTexts)).some((error) =>
      error.includes("unapproved action"),
    ),
  );

  const localActionTextsMutation = mutate(
    path,
    "      - name: Setup Node repository",
    "      - name: New local action\n        uses: ./.github/actions/other\n      - name: Setup Node repository",
  );
  assert.ok(
    validate(localActionTextsMutation, rebaseline(path, localActionTextsMutation)).some((error) =>
      error.includes("local action reference inventory drift"),
    ),
  );

  const payloadTexts = mutate(
    path,
    "            dist/release-candidate/receipt.json",
    "            dist/release-candidate/receipt.json\n            package-lock.json",
  );
  assert.ok(
    validate(payloadTexts, rebaseline(path, payloadTexts)).some((error) =>
      error.includes("artifact version or retention drift"),
    ),
  );
});

test("reports malformed but parseable workflow shapes without crashing", () => {
  const missingPermissions = mutate(".github/workflows/ci.yml", "permissions:\n  contents: read\n", "");
  assert.ok(validate(missingPermissions).some((error) => error.includes("permissions contract cannot be hashed")));
  const scalar = { ...workflowTexts, ".github/workflows/docs.yml": "valid-scalar\n" };
  assert.ok(validate(scalar).includes(".github/workflows/docs.yml: workflow root must be an object"));
  const nullJob = {
    ...workflowTexts,
    ".github/workflows/docs.yml": "name: docs\non: {}\npermissions: {}\nconcurrency: {}\njobs:\n  validate: null\n",
  };
  assert.ok(validate(nullJob).some((error) => error.includes("job validate must be an object")));
  const objectSteps = {
    ...workflowTexts,
    ".github/workflows/docs.yml":
      "name: docs\non: {}\npermissions: {}\nconcurrency: {}\njobs:\n  validate:\n    name: Markdown docs\n    steps: {}\n",
  };
  assert.ok(validate(objectSteps).some((error) => error.includes("steps must be an array")));
  const releaseObjectSteps = {
    ...workflowTexts,
    ".github/workflows/release-candidate-qualification.yml":
      "name: Release Candidate Qualification\non: {}\npermissions:\n  contents: read\nconcurrency: {}\njobs:\n  qualify:\n    name: Exact-head release qualification\n    steps: {}\n",
  };
  assert.ok(validate(releaseObjectSteps).some((error) => error.includes("steps must be an array")));
  const releaseNullStep = {
    ...workflowTexts,
    ".github/workflows/release-candidate-qualification.yml":
      "name: Release Candidate Qualification\non: {}\npermissions:\n  contents: read\nconcurrency: {}\njobs:\n  qualify:\n    name: Exact-head release qualification\n    steps:\n      - null\n",
  };
  assert.ok(validate(releaseNullStep).some((error) => error.includes("step 0 must be an object")));
});

test("rejects missing workflow files", () => {
  const texts = structuredClone(workflowTexts);
  delete texts[".github/workflows/docs.yml"];
  const errors = validate(texts);
  assert.ok(errors.includes("workflow file inventory drift"));
  assert.ok(errors.includes(".github/workflows/docs.yml: workflow file is missing"));

  const missingRelease = structuredClone(workflowTexts);
  delete missingRelease[".github/workflows/release-candidate-qualification.yml"];
  const releaseErrors = validate(missingRelease);
  assert.ok(releaseErrors.includes(".github/workflows/release-candidate-qualification.yml: workflow file is missing"));
});
