import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { load } from "js-yaml";
import {
  canonicalJson,
  pinSourceRoot,
  readSourceFile,
  renderClientAgentProjection,
  roleDelegatesOnClient,
  roleSupportsClient,
  validateBundleDeclarations,
  validateClientProjectionDeclarations,
} from "../../../packages/cli/scripts/prepare-assets.mjs";

const execFile = promisify(execFileCallback);
const root = join(import.meta.dirname, "../../..");
const assessmentSkills = [
  "apex-azure-cloud-migrate",
  "apex-azure-compliance",
  "apex-azure-kusto",
  "apex-azure-quotas",
  "apex-azure-resources",
  "apex-azure-validate",
];

test("governance collection files ship from canonical sources to both client projections", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const assets = join(root, "packages/cli/assets");
  const manifest = JSON.parse(await readFile(join(assets, "manifest.json"), "utf8"));
  const customization = JSON.parse(await readFile(join(root, "customizations/manifest.json"), "utf8"));
  const paths = [
    ".github/workflows/governance-policy-baseline.yml",
    "tools/scripts/collect-governance-baseline.ps1",
    "tools/schemas/governance-baseline.schema.json",
  ];
  for (const path of paths) assert.ok(customization.sharedFiles.includes(path));
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.ok(customization.managedFiles.includes(path));
    await assert.rejects(readFile(join(root, "customizations", path)), { code: "ENOENT" });
    for (const prefix of [
      "customizations",
      ...customization.clientProjections.map(({ generatedRoot }) => generatedRoot),
    ]) {
      const target = `${prefix}/${path}`;
      assert.deepEqual(await readFile(join(assets, target)), bytes);
      const entry = manifest.files.find(({ path: candidate }) => candidate === target);
      assert.equal(entry.sha256, hash);
      if (prefix === "customizations") {
        assert.equal(entry.source.kind, "repository-file");
        assert.equal(entry.source.path, path);
        const mapping = manifest.composition.mappings.find(({ id }) => id === entry.source.mapping);
        assert.equal(mapping.mode, "copy-entries");
        assert.deepEqual(mapping.entries, [{ source: path, target }]);
      } else {
        assert.equal(entry.source.sourcePath, path);
        assert.equal(entry.source.sourceHash, hash);
      }
    }
  }
});

test("assessment skill mappings ship to managed client projections", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const manifest = JSON.parse(await readFile(join(root, "customizations", "manifest.json"), "utf8"));
  assert.ok(manifest.sharedDirectories.includes(".github/skills"), "managed skills must ship as a shared directory");
  for (const skill of assessmentSkills) {
    const skillPath = `.github/skills/${skill}/SKILL.md`;
    assert.ok(manifest.managedFiles.includes(skillPath), `${skillPath} must be manifest-owned`);
  }
});

test("governance workflow is opt-in, protected, and publishes only a reviewed baseline", async () => {
  const text = await readFile(join(root, ".github/workflows/governance-policy-baseline.yml"), "utf8");
  const workflow = load(text);
  assert.deepEqual(Object.keys(workflow.on).sort(), ["schedule", "workflow_dispatch"]);
  const job = workflow.jobs["collect-baseline"];
  assert.equal(job.if, "vars.GOVERNANCE_BASELINE_ENABLED == 'true'");
  assert.equal(job.environment, "governance");
  assert.equal(job.permissions["id-token"], "write");
  const validation = job.steps.findIndex(({ name }) => name === "Validate collection configuration");
  const login = job.steps.findIndex(({ uses }) => uses?.startsWith("azure/login@"));
  assert.ok(validation >= 0 && login > validation);
  for (const name of ["CLIENT", "TENANT", "SUBSCRIPTION"]) {
    assert.equal(job.env[`AZURE_${name}_ID`], `\${{ vars.AZURE_${name}_ID || secrets.AZURE_${name}_ID }}`);
    assert.equal(job.steps[login].with[`${name.toLowerCase()}-id`], `\${{ env.AZURE_${name}_ID }}`);
  }
  assert.equal(job.env.GOVERNANCE_MG_ID, "${{ vars.GOVERNANCE_MG_ID }}");
  assert.equal(job.env.GOVERNANCE_SUBSCRIPTION_ID, "${{ vars.GOVERNANCE_SUBSCRIPTION_ID }}");
  assert.equal(job.env.GOVERNANCE_MAX_SUBSCRIPTIONS, "${{ vars.GOVERNANCE_MAX_SUBSCRIPTIONS || '100' }}");
  for (const step of job.steps) assert.doesNotMatch(step.run ?? "", /\$\{\{/u);
  const collection = job.steps.find(({ name }) => name === "Collect governance baseline");
  assert.match(collection.run, /collect-governance-baseline\.ps1 @parameters/u);
  assert.match(collection.run, /IncludeDefenderAuto = \$true/u);
  assert.match(collection.run, /IncludeDescendants = \$true/u);
  assert.match(collection.run, /Test-Json .*governance-baseline\.schema\.json/u);
  assert.match(collection.run, /\*> \$null/u);
  const pullRequest = job.steps.find(({ uses }) => uses?.startsWith("peter-evans/create-pull-request@"));
  assert.equal(pullRequest.with["add-paths"], ".github/data/governance-policy-baseline.json");
  assert.match(pullRequest.with.body, /Human review and manual merge are required/u);
  assert.doesNotMatch(
    text,
    /upload-artifact|download-artifact|--auto|enable-auto-merge|AZURE_CREDENTIALS|CLIENT_SECRET|governance-policy-raw/u,
  );
});

test("governance workflow rejects invalid scope and limits before any login", async () => {
  const workflow = load(await readFile(join(root, ".github/workflows/governance-policy-baseline.yml"), "utf8"));
  const validation = workflow.jobs["collect-baseline"].steps.find(
    ({ name }) => name === "Validate collection configuration",
  );
  const guid = "11111111-1111-1111-1111-111111111111";
  const valid = {
    PATH: process.env.PATH,
    AZURE_CLIENT_ID: guid,
    AZURE_TENANT_ID: guid,
    AZURE_SUBSCRIPTION_ID: guid,
    GOVERNANCE_MG_ID: "test-mg",
    GOVERNANCE_SUBSCRIPTION_ID: "",
    GOVERNANCE_MAX_SUBSCRIPTIONS: "100",
  };
  const validate = (changes) =>
    execFile("pwsh", ["-NoProfile", "-NonInteractive", "-Command", validation.run], {
      env: { ...valid, ...changes },
    });
  await validate({});
  await validate({ GOVERNANCE_MG_ID: "", GOVERNANCE_SUBSCRIPTION_ID: guid, GOVERNANCE_MAX_SUBSCRIPTIONS: "1" });
  for (const changes of [
    { GOVERNANCE_MG_ID: "" },
    { GOVERNANCE_SUBSCRIPTION_ID: guid },
    { GOVERNANCE_MG_ID: "../unsafe" },
    { GOVERNANCE_MG_ID: "$(throw 'interpolated')" },
    { GOVERNANCE_MG_ID: "", GOVERNANCE_SUBSCRIPTION_ID: "invalid" },
    { AZURE_CLIENT_ID: "" },
    { AZURE_TENANT_ID: "invalid" },
    { AZURE_SUBSCRIPTION_ID: "invalid" },
    ...["0", "-1", "1.5", "2147483648", "1; exit 0"].map((value) => ({ GOVERNANCE_MAX_SUBSCRIPTIONS: value })),
  ])
    await assert.rejects(validate(changes));
});

test("asset generator canonical JSON ignores object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, x: "value" } }),
    canonicalJson({ a: { x: "value", y: true }, z: 1 }),
  );
});

test("asset generator inventories only the reviewed governance baseline schema", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const assets = join(root, "packages/cli/assets");
  const schemaName = "governance-baseline.schema.json";
  const sourcePath = `tools/schemas/${schemaName}`;
  const source = await readFile(join(root, sourcePath));
  assert.deepEqual(await readdir(join(assets, "schemas")), [schemaName]);
  assert.deepEqual(await readFile(join(assets, "schemas", schemaName)), source);
  const manifest = JSON.parse(await readFile(join(assets, "manifest.json"), "utf8"));
  assert.deepEqual(
    manifest.files.filter(({ path }) => path.startsWith("schemas/")),
    [
      {
        path: `schemas/${schemaName}`,
        source: { kind: "repository-file", path: sourcePath, mapping: "governance-baseline-schema" },
        sha256: createHash("sha256").update(source).digest("hex"),
        bytes: source.byteLength,
      },
    ],
  );
  assert.deepEqual(
    manifest.composition.mappings.find(({ id }) => id === "governance-baseline-schema"),
    {
      id: "governance-baseline-schema",
      mode: "copy-entries",
      sourceRoot: "tools/schemas",
      generatedRoot: "schemas",
    },
  );
});

test("managed role projections retain required tools and exclude unrelated grants", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const manifest = JSON.parse(await readFile(join(root, "customizations/manifest.json"), "utf8"));
  const arm = JSON.parse(await readFile(join(root, "tools/registry/arm-mcp-cost-pricing.v1.json"), "utf8"));
  const requiredApex = {
    coordinator: ["status", "nextTask", "projectCreate", "projectList", "projectUse", "projectDelete", "gateDecide"],
    requirements: [
      "status",
      "nextTask",
      "recordInput",
      "taskContext",
      "readTaskInput",
      "requirementsComplete",
      "reviewDecide",
      "gateDecide",
    ],
    architecture: [
      "status",
      "nextTask",
      "recordInput",
      "taskContext",
      "readTaskInput",
      "architectureComplete",
      "reviewDecide",
      "gateDecide",
    ],
    planning: ["status", "nextTask", "taskContext", "readTaskInput", "planComplete", "reviewDecide", "gateDecide"],
    operations: [
      "status",
      "nextTask",
      "taskContext",
      "governanceImport",
      "governanceSelect",
      "recordInput",
      "preview",
      "reconcile",
      "inventory",
      "diagnose",
      "completeTask",
    ],
    "code-generation": ["taskContext", "stageFile", "generateIac", "completeTask"],
    review: ["taskContext", "readTaskInput", "reviewComplete"],
    validation: ["taskContext", "validateTask", "completeTask"],
  };
  const requiredArm = {
    coordinator: [],
    requirements: ["get_retail_prices"],
    architecture: ["get_retail_prices"],
    planning: [],
    operations: arm.managedPolicy.candidateReadAllowlist,
    "code-generation": [],
    review: [],
    validation: [],
  };
  assert.deepEqual(manifest.roles.map(({ id }) => id).sort(), Object.keys(requiredApex).sort());
  for (const client of ["github-copilot-vscode", "github-copilot-cli"]) {
    for (const role of manifest.roles) {
      const path = join(root, "packages/cli/assets/client-projections", client, role.source);
      if (["code-generation", "review", "validation"].includes(role.id)) {
        assert.deepEqual(role.supportedTargets, ["vscode"], `${role.id} must remain VS Code-only`);
      }
      if (!roleSupportsClient(role, client)) {
        await assert.rejects(readFile(path), { code: "ENOENT" });
        continue;
      }
      const content = await readFile(path, "utf8");
      const metadata = load(content.match(/^---\r?\n([\s\S]*?)\r?\n---/u)[1]);
      const label = `${client}/${role.id}`;
      if (role.id === "operations") {
        assert.match(content, /apex\/governanceImport.*only the local `path`/u, label);
        assert.match(content, /Never read or paste baseline bytes/u, label);
      }
      const apexTools = requiredApex[role.id].map((tool) => `apex/${tool}`);
      const armTools = requiredArm[role.id].map((tool) => `azure-resource-manager-mcp/${tool}`);
      assert.deepEqual(metadata.tools.filter((tool) => tool.startsWith("apex/")).sort(), apexTools.sort(), label);
      assert.deepEqual(
        metadata.tools.filter((tool) => tool.startsWith("azure-resource-manager-mcp/")).sort(),
        armTools.sort(),
        label,
      );
      const interactive = client === "github-copilot-cli" ? ["ask_user", "task"] : ["vscode/askQuestions", "agent"];
      if (client === "github-copilot-cli")
        assert.ok(!metadata.tools.includes("task"), `${label}: no supported worker edge`);
      const allowed = new Set([...apexTools, ...armTools, ...interactive]);
      for (const tool of metadata.tools) assert.ok(allowed.has(tool), `${label}: unexpected tool ${tool}`);
      for (const tool of [...arm.managedPolicy.denyBeforeTransport, ...arm.managedPolicy.deferredTools]) {
        assert.ok(
          !metadata.tools.includes(`azure-resource-manager-mcp/${tool}`),
          `${label}: forbidden ARM tool ${tool}`,
        );
      }
      if (role.interactionType === "autonomous-subagent") {
        assert.equal(metadata["user-invocable"], false, label);
        assert.ok(!metadata.tools.includes("vscode/askQuestions"), label);
      }
    }
  }
});

test("managed routing distinguishes input, review dispositions, and exact task context in both clients", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const agents = ["apex", "apex-requirements", "apex-architect", "apex-planner", "apex-operator"];
  const skills = ["apex-workflow", "apex-requirements", "apex-operations"];
  for (const client of ["github-copilot-vscode", "github-copilot-cli"]) {
    const projection = join(root, "packages/cli/assets/client-projections", client);
    const coordinator = await readFile(join(projection, ".github/agents/apex.agent.md"), "utf8");
    const mechanics = coordinator.split("<!-- apex-shared-body -->")[0];
    assert.match(mechanics, /never intake/);
    assert.match(coordinator, /exactly `APEX Requirements`, never Explore or a generic agent/);
    assert.match(coordinator, /user's stop boundary/);
    assert.match(coordinator, /If handoff is unavailable, ask the user/);
    assert.match(coordinator, /Never use `session_store_sql`, SQL, session-history searches/);
    assert.match(coordinator, /Do not ask the user which role should handle it/);
    assert.match(coordinator, /status-only request calls `apex\/status` once and stops/);
    if (client === "github-copilot-cli") {
      assert.match(mechanics, /select `APEX Requirements` as the foreground agent/);
      assert.doesNotMatch(mechanics, /for declared worker delegation/);
      assert.match(mechanics, /Print the scope note verbatim for continuation/);
      assert.match(mechanics, /Do not use `task` for interactive intake/);
      assert.match(mechanics, /If the original scope is unavailable, limit continuation to intake through taskContext/);
    } else {
      assert.match(mechanics, /present the declared Gather requirements handoff/);
      assert.match(mechanics, /stop for the user's interactive transition/);
      assert.match(mechanics, /State the user's scope and stop point beside the handoff/);
      const frontmatter = load(coordinator.split("---")[1]);
      const handoff = frontmatter.handoffs.find(({ agent }) => agent === "APEX Requirements");
      assert.match(handoff.prompt, /If the original scope is unavailable, stop after taskContext/);
      assert.match(
        handoff.prompt,
        /Handoff selection is not permission to submit artifacts, run review, request gate approval/,
      );
      assert.doesNotMatch(handoff.prompt, /Output: complete typed requirements through APEX MCP/);
    }
    const requirements = await readFile(join(projection, ".github/agents/apex-requirements.agent.md"), "utf8");
    const submission = requirements.indexOf("Immediately after the user answers a panel, call `apex/recordInput`");
    const acknowledgment = requirements.indexOf("Wait for `recorded: true` with the same request ID");
    assert.ok(submission > 0 && acknowledgment > submission);
    for (const field of ["schemaVersion", "requestId", "expectedHead", "ownerEpoch", "questionId", "value"]) {
      assert.ok(requirements.slice(submission, acknowledgment).includes(field), `Missing submission field ${field}`);
    }
    assert.match(requirements, /question-tool response is not kernel\s+acceptance/);
    assert.match(requirements, /Never silently replace an invalid value with a default recommendation/);
    if (client === "github-copilot-cli") {
      assert.match(requirements, /foreground agent using `ask_user`, not as a delegated background task/);
      assert.match(requirements, /If the question tool is unavailable, report the limitation and stop/);
    }
    assert.match(requirements, /intake-only check ending at task context, stop here/);
    assert.ok(requirements.indexOf("# Requested Scope") < requirements.indexOf("# Success criteria"));
    assert.match(requirements, /handoff prompt or button cannot broaden the original request/);
    assert.match(requirements, /If the original scope is unavailable, default to intake/);
    assert.match(
      requirements,
      /Do not call `requirementsComplete`, request another task, delegate review, ask Proceed\/Revise, or call `gateDecide`/,
    );
    assert.match(requirements, /no-gate-approvals request, never ask for approval/);
    assert.match(requirements, /Do not ask supplemental owner-assignment questions/);
    assert.match(requirements, /Recommendations are proposed, not confirmed requirements or compliance evidence/);
    assert.doesNotMatch(requirements, /Acknowledge and assign|ask only for the responsible role/);
    if (client === "github-copilot-vscode") {
      const reviewer = await readFile(join(projection, ".github/agents/apex-reviewer.agent.md"), "utf8");
      assert.match(reviewer, /Do not create blocking findings or\s+owner-assignment requests solely/);
      assert.match(reviewer, /violated\s+Azure Policy constraints/);
    }
    for (const agent of agents) {
      const content = await readFile(join(projection, ".github/agents", `${agent}.agent.md`), "utf8");
      for (const state of ["status=needs_input", "status=needs_review", "status=task", "task.taskId"]) {
        assert.ok(content.includes(state), `${client}/${agent}: missing ${state} routing`);
      }
      assert.match(content, /do not poll|not.*poll/iu, `${client}/${agent}: unresolved results must not be polled`);
      assert.doesNotMatch(content, /loop on[\s\S]*?until it returns `status=task`/iu);
    }
    for (const skill of skills) {
      const relative = `.github/skills/${skill}/SKILL.md`;
      const content = await readFile(join(projection, relative), "utf8");
      assert.equal(content, await readFile(join(root, "customizations", relative), "utf8"));
      if (skill === "apex-operations") {
        assert.match(content, /apex\/governanceImport.*\{ "path": "<local-baseline-path>" \}.*only/u);
        assert.match(content, /apex governance import --path <local-baseline-path>/u);
        assert.match(content, /Import preserves reconciliation, governance review, and Gate 2/u);
      }
      if (skill === "apex-requirements") {
        assert.match(content, /If scope is unavailable, stop after intake\s+and task context/);
        assert.match(content, /Only for explicitly requested full Requirements completion/);
        assert.match(content, /stop without an approval question/);
        assert.match(content, /instead of asking\s+supplemental owner questions/);
        assert.doesNotMatch(content, /ask for a responsible\s+role/);
      }
      if (skill === "apex-workflow") {
        assert.match(content, /status-only request, report that result and stop/);
        assert.match(content, /do not ask the user to choose a role or search session history/);
      }
      for (const state of ["needs_input", "needs_review", "status=task", "task.taskId"]) {
        assert.ok(content.includes(state), `${client}/${skill}: missing ${state} routing`);
      }
      assert.doesNotMatch(content, /returns only `needs_input` or `task`/u);
    }
  }
});

test("asset generator refuses a source replaced by a symlink before open", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-asset-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.txt");
  const outside = join(root, "outside.txt");
  await writeFile(source, "expected\n");
  await writeFile(outside, "outside\n");

  await assert.rejects(
    readSourceFile(root, source, async () => {
      await unlink(source);
      await symlink(outside, source);
    }),
    /ELOOP|symbolic link|symlink/iu,
  );
});

test("asset generator refuses a parent directory replaced before open", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-asset-parent-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, "parent");
  const moved = join(root, "moved");
  await mkdir(parent);
  await writeFile(join(parent, "source.txt"), "expected\n");
  await assert.rejects(
    readSourceFile(root, join(parent, "source.txt"), async () => {
      await rename(parent, moved);
      await mkdir(parent);
      await writeFile(join(parent, "source.txt"), "outside\n");
    }),
    /changed during generation/,
  );
});

test("asset generator refuses a source root replaced before pinning completes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-asset-root-"));
  const moved = `${root}-moved`;
  context.after(() => rm(root, { recursive: true, force: true }));
  context.after(() => rm(moved, { recursive: true, force: true }));
  await assert.rejects(
    pinSourceRoot(root, async () => {
      await rename(root, moved);
      await mkdir(root);
    }),
    /directory changed during generation/,
  );
});

test("asset generator rejects inconsistent bundle declarations", () => {
  const customization = {
    version: "0.10.0-next.5",
    bundle: {
      id: "apex-managed-workspace",
      authority: "npm:@apexops/cli",
      composition: "copy-tree",
      sourceRoot: "customizations",
      generatedRoot: "customizations",
    },
  };
  const runtime = {
    schemaVersion: "1.0.0",
    bundleVersion: "0.10.0-next.5",
    components: {
      customizationBundle: {
        version: "0.10.0-next.5",
        manifest: "@apexops/cli/assets/customizations/manifest.json",
        assetManifest: "@apexops/cli/assets/manifest.json",
        compositionId: "apex-managed-workspace",
      },
    },
  };
  assert.equal(validateBundleDeclarations(customization, runtime).authority, "npm:@apexops/cli");
  const missingVersions = structuredClone(runtime);
  delete missingVersions.schemaVersion;
  assert.throws(() => validateBundleDeclarations(customization, missingVersions), /declarations are inconsistent/);
  runtime.components.customizationBundle.compositionId = "other";
  assert.throws(() => validateBundleDeclarations(customization, runtime), /declarations are inconsistent/);
});

test("asset generator rejects malformed and duplicate client projection declarations", () => {
  const valid = {
    sharedFiles: [".github/copilot-instructions.md"],
    sharedDirectories: [],
    clientProjections: [
      {
        id: "github-copilot-vscode",
        generatedRoot: "client-projections/github-copilot-vscode",
        files: [".vscode/mcp.json"],
      },
      {
        id: "github-copilot-cli",
        generatedRoot: "client-projections/github-copilot-cli",
        files: [".github/mcp.json"],
      },
    ],
    roles: [
      {
        id: "coordinator",
        source: ".github/agents/apex.agent.md",
        agent: "APEX",
        supportedTargets: ["vscode", "github-copilot"],
      },
    ],
  };
  assert.deepEqual(validateClientProjectionDeclarations(valid), valid);
  for (const mutate of [
    (manifest) => {
      manifest.sharedFiles.push(manifest.sharedFiles[0]);
    },
    (manifest) => {
      manifest.clientProjections[0].files = ".vscode/mcp.json";
    },
    (manifest) => {
      manifest.clientProjections[0].files.push(manifest.clientProjections[0].files[0]);
    },
    (manifest) => {
      manifest.clientProjections[1].id = manifest.clientProjections[0].id;
    },
    (manifest) => {
      manifest.roles.push({ id: "other", source: ".github/agents/other.agent.md", agent: "APEX" });
    },
    (manifest) => {
      manifest.roles[0].supportedTargets = [];
    },
    (manifest) => {
      manifest.roles[0].supportedTargets = ["unsupported"];
    },
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(() => validateClientProjectionDeclarations(invalid), /declarations are invalid/);
  }
});

test("asset generator accepts a role supported by only one client target", () => {
  const manifest = {
    sharedFiles: [".github/copilot-instructions.md"],
    sharedDirectories: [],
    clientProjections: [
      {
        id: "github-copilot-vscode",
        generatedRoot: "client-projections/github-copilot-vscode",
        files: [".vscode/mcp.json"],
      },
      {
        id: "github-copilot-cli",
        generatedRoot: "client-projections/github-copilot-cli",
        files: [".github/mcp.json"],
      },
    ],
    roles: [
      {
        id: "validator",
        source: ".github/agents/apex-validator.agent.md",
        agent: "APEX Validator",
        supportedTargets: ["vscode"],
      },
    ],
  };
  assert.deepEqual(validateClientProjectionDeclarations(manifest), manifest);
  assert.equal(roleSupportsClient(manifest.roles[0], "github-copilot-vscode"), true);
  assert.equal(roleSupportsClient(manifest.roles[0], "github-copilot-cli"), false);
});

test("delegation is enabled only when a destination is supported by the client", () => {
  const parent = { agent: "APEX Planner", supportedTargets: ["vscode", "github-copilot"] };
  const worker = { agent: "APEX CodeGen", supportedTargets: ["vscode"] };
  const edges = [{ from: parent.agent, to: worker.agent, type: "subagent" }];
  assert.equal(roleDelegatesOnClient(parent, "github-copilot-vscode", [parent, worker], edges), true);
  assert.equal(roleDelegatesOnClient(parent, "github-copilot-cli", [parent, worker], edges), false);
});

test("asset generator renders client-valid Requirements projections from one shared body", () => {
  const source = `---
name: APEX Requirements
description: Gather requirements.
argument-hint: Describe the workload
model: ["Claude Sonnet 5"]
user-invocable: true
tools:
  - vscode/askQuestions
  - agent
  - apex/status
  - apex/recordInput
agents:
  - APEX Reviewer
handoffs:
  - label: Continue
    agent: APEX Architect
    prompt: "Input: requirements. Output: architecture."
    send: true
---

## Role

Gather requirements through the kernel.
`;
  const vscode = renderClientAgentProjection(source, "github-copilot-vscode");
  const cli = renderClientAgentProjection(source, "github-copilot-cli");
  assert.match(vscode, /vscode\/askQuestions/u);
  assert.match(vscode, /target: vscode/u);
  assert.match(vscode, /handoffs:/u);
  assert.match(vscode, /agents:/u);
  assert.match(vscode, /model:\n\s+- Claude Sonnet 5/u);
  assert.match(cli, /\n\s+- ask_user/u);
  assert.match(cli, /\n\s+- task/u);
  assert.match(cli, /model: Claude Sonnet 5/u);
  assert.match(cli, /target: github-copilot/u);
  assert.match(cli, /disable-model-invocation: false/u);
  assert.doesNotMatch(cli, /vscode\/askQuestions|handoffs:|agents:|argument-hint:/u);
  const marker = "<!-- apex-shared-body -->";
  assert.equal(vscode.slice(vscode.indexOf(marker)), cli.slice(cli.indexOf(marker)));
  assert.notEqual(vscode, cli);
  assert.throws(
    () => renderClientAgentProjection(source.replace("name:", "target: vscode\nname:"), "github-copilot-vscode"),
    /must not declare target/u,
  );
});

test("CLI projection keeps hidden workers noninteractive and rejects unpinned APEX operations", () => {
  const hidden = `---
name: APEX Validator
description: Validate one result.
model: ["Claude Sonnet 5"]
user-invocable: false
disable-model-invocation: true
tools:
  - apex/status
---

## Role

Validate one result.
`;
  const rendered = renderClientAgentProjection(hidden, "github-copilot-cli", {
    interactiveTools: { askUser: "ask_user", delegate: "task" },
    workspaceServer: "apex",
    operationIds: ["status"],
  });
  assert.match(rendered, /user-invocable: false/u);
  assert.match(rendered, /disable-model-invocation: true/u);
  assert.doesNotMatch(rendered, /ask_user|\n\s+- task/u);
  assert.throws(
    () =>
      renderClientAgentProjection(hidden.replace("apex/status", "apex/unknown"), "github-copilot-cli", {
        interactiveTools: { askUser: "ask_user", delegate: "task" },
        workspaceServer: "apex",
        operationIds: ["status"],
      }),
    /Unpinned CLI APEX operation/u,
  );
});

test("asset generator rejects unsafe projection roots before generation", () => {
  const base = {
    sharedFiles: [".github/copilot-instructions.md"],
    clientProjections: [
      {
        id: "github-copilot-vscode",
        generatedRoot: "client-projections/github-copilot-vscode",
        files: [".vscode/mcp.json"],
      },
      {
        id: "github-copilot-cli",
        generatedRoot: "client-projections/github-copilot-cli",
        files: [".github/mcp.json"],
      },
    ],
    roles: [
      {
        id: "coordinator",
        source: ".github/agents/apex.agent.md",
        agent: "APEX",
        supportedTargets: ["vscode", "github-copilot"],
      },
    ],
  };
  for (const root of ["../escaped", "/absolute", "client-projections\\windows", "client-projections/../escape"]) {
    const invalid = structuredClone(base);
    invalid.clientProjections[0].generatedRoot = root;
    assert.throws(() => validateClientProjectionDeclarations(invalid), /declarations are invalid/u);
  }
});

test("CLI interactive handoffs do not grant background task delegation", () => {
  const coordinator = { agent: "APEX", supportedTargets: ["vscode", "github-copilot"] };
  const requirements = { agent: "APEX Requirements", supportedTargets: ["vscode", "github-copilot"] };
  const delegates = roleDelegatesOnClient(
    coordinator,
    "github-copilot-cli",
    [coordinator, requirements],
    [{ from: "APEX", to: "APEX Requirements", type: "handoff" }],
  );
  assert.equal(delegates, false);
  const source = `---
name: APEX
description: Coordinate workflow.
model: ["MAI-Code-1.1-Flash"]
user-invocable: true
tools:
  - vscode/askQuestions
  - apex/status
---

## Role

Coordinate.
`;
  const rendered = renderClientAgentProjection(
    source,
    "github-copilot-cli",
    {
      interactiveTools: { askUser: "ask_user", delegate: "task" },
      workspaceServer: "apex",
      operationIds: ["status"],
    },
    { delegates },
  );
  assert.doesNotMatch(rendered, /\n\s+- task/u);
  assert.match(rendered, /foreground agent/);
});

test("asset lifecycle carries restored managed skills to both clients", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const restoredSkills = ["apex-azure-adr", "apex-azure-defaults", "apex-azure-rbac", "apex-microsoft-docs"];
  const clients = ["github-copilot-cli", "github-copilot-vscode"];

  for (const skill of restoredSkills) {
    const source = await readFile(join("customizations", ".github", "skills", skill, "SKILL.md"));
    for (const client of clients) {
      const projection = await readFile(
        join("packages", "cli", "assets", "client-projections", client, ".github", "skills", skill, "SKILL.md"),
      );
      assert.deepEqual(projection, source, `${skill} should be available to ${client}`);
    }
  }
});

test("asset preparation includes operational skill references for both clients", async () => {
  const relativePaths = [
    ".github/skills/apex-azure-governance/references/operational-checklist.md",
    ".github/skills/apex-azure-deploy/references/operational-checklist.md",
  ];
  for (const client of ["github-copilot-vscode", "github-copilot-cli"]) {
    for (const relativePath of relativePaths) {
      const content = await readFile(
        join(process.cwd(), "packages", "cli", "assets", "client-projections", client, relativePath),
        "utf8",
      );
      assert.match(content, /Operational Checklist/u);
    }
  }
});
