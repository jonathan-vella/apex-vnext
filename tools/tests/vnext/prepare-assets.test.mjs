import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
import { renderPluginAgents } from "../../scripts/build-plugin.mjs";

const execFile = promisify(execFileCallback);
let pluginAgents;
const pluginAgent = async (source) => {
  pluginAgents ??= renderPluginAgents("customizations/.github/agents");
  return (await pluginAgents).get(basename(source));
};
const PLUGIN = {
  name: "apex",
  marketplace: "apex-plugins",
  marketplaceRepository: "jonathan-vella/apex-plugins",
  ownedFiles: [".mcp.json"],
  ownedDirectories: [".github/agents", ".github/skills"],
  files: [".github/agents/apex.agent.md"],
};
const root = join(import.meta.dirname, "../../..");
const assessmentSkills = [
  "apex-azure-cloud-migrate",
  "apex-azure-compliance",
  "apex-azure-kusto",
  "apex-azure-quotas",
  "apex-azure-resources",
  "apex-azure-validate",
];

test("CLI projection keeps canonical agent names", async () => {
  const manifest = JSON.parse(await readFile(join(root, "customizations/manifest.json"), "utf8"));
  const inventory = JSON.parse(await readFile(join(root, "tools/registry/copilot-cli-agent-tools.json"), "utf8"));
  for (const role of manifest.roles) {
    const source = await readFile(join(root, "customizations", role.source), "utf8");
    const projected = renderClientAgentProjection(source, "github-copilot-cli", inventory, {
      delegates: roleDelegatesOnClient(role, "github-copilot-cli", manifest.roles, manifest.invocationEdges),
    });
    assert.equal(load(/^---\n([\s\S]*?)\n---/u.exec(projected)[1]).name, role.agent);
    assert.doesNotMatch(projected, /APEX CLI/u);
  }
});

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

test("the bundle ships only the thin Copilot CLI projection with plugin settings", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const assets = join(root, "packages/cli/assets");
  const manifest = JSON.parse(await readFile(join(assets, "manifest.json"), "utf8"));
  const customization = JSON.parse(await readFile(join(root, "customizations/manifest.json"), "utf8"));
  assert.deepEqual(
    manifest.projections.map(({ id }) => id),
    ["github-copilot-cli"],
  );
  assert.deepEqual(await readdir(join(assets, "client-projections")), ["github-copilot-cli"]);
  const [projection] = manifest.projections;
  const prefix = "client-projections/github-copilot-cli/";
  assert.deepEqual(
    projection.files.map((path) => path.slice(prefix.length)),
    [...customization.managedFiles].sort(),
  );
  assert.ok(projection.files.includes(`${prefix}.github/copilot/settings.json`));
  assert.ok(
    !projection.files.some((path) =>
      /\/(?:\.vscode|\.github)\/mcp\.json$|\/\.mcp\.json$|\/\.github\/(?:agents|skills)\//u.test(path),
    ),
  );
  for (const file of manifest.files.filter(({ path }) => path.startsWith(prefix))) {
    assert.equal(file.source.clientId, "github-copilot-cli");
    assert.equal(file.source.roleId, undefined);
    assert.equal(file.source.adapterVersion, "1.12.0");
  }
});

test("plugin ownership rejects workspace copies of agents, skills or MCP config", () => {
  const declaration = (change) => {
    const manifest = {
      sharedFiles: [".github/copilot-instructions.md"],
      sharedDirectories: [".github/instructions"],
      managedFiles: [".github/copilot-instructions.md"],
      clientProjections: [
        { id: "github-copilot-cli", generatedRoot: "client-projections/github-copilot-cli", files: [] },
      ],
      plugin: {
        name: "apex",
        marketplace: "apex-plugins",
        marketplaceRepository: "jonathan-vella/apex-plugins",
        ownedFiles: [".mcp.json"],
        ownedDirectories: [".github/agents", ".github/skills"],
        files: [".github/agents/apex.agent.md"],
      },
      roles: [
        {
          id: "coordinator",
          source: ".github/agents/apex.agent.md",
          agent: "APEX",
          supportedTargets: ["github-copilot"],
        },
      ],
    };
    change(manifest);
    return () => validateClientProjectionDeclarations(manifest);
  };
  declaration(() => {})();
  for (const change of [
    (manifest) => manifest.sharedDirectories.push(".github/skills"),
    (manifest) => manifest.sharedDirectories.push(".github"),
    (manifest) => manifest.sharedFiles.push(".github/agents/apex.agent.md"),
    (manifest) => manifest.managedFiles.push(".github/skills/apex-next/SKILL.md"),
    (manifest) => manifest.clientProjections[0].files.push(".mcp.json"),
  ])
    assert.throws(declaration(change), /Plugin-owned path must not return/u);
  assert.throws(
    declaration((manifest) => manifest.plugin.files.push("README.md")),
    /Plugin declaration is invalid/u,
  );
  assert.throws(
    declaration((manifest) => delete manifest.plugin),
    /Plugin declaration is invalid/u,
  );
});

test("assessment skill mappings ship through the plugin", async () => {
  const manifest = JSON.parse(await readFile(join(root, "customizations", "manifest.json"), "utf8"));
  assert.ok(manifest.plugin.ownedDirectories.includes(".github/skills"), "managed skills must ship in the plugin");
  for (const skill of assessmentSkills) {
    const skillPath = `.github/skills/${skill}/SKILL.md`;
    assert.ok(manifest.plugin.files.includes(skillPath), `${skillPath} must be plugin-owned`);
    assert.ok(!manifest.managedFiles.includes(skillPath), `${skillPath} must not be copied into the workspace`);
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
    coordinator: [
      "status",
      "releaseWriter",
      "nextTask",
      "projectCreate",
      "projectList",
      "projectUse",
      "projectDelete",
      "recordInput",
      "taskContext",
      "readTaskInput",
      "requirementsComplete",
      "architectureComplete",
      "planComplete",
      "completeTask",
      "reviewComplete",
      "reviewDecide",
      "gateDecide",
      "governanceImport",
      "governanceSelect",
      "preview",
      "reconcile",
      "inventory",
      "diagnose",
    ],
    "code-generation": ["taskContext", "stageFile", "generateIac", "completeTask"],
    validation: ["taskContext", "validateTask", "completeTask"],
  };
  const requiredArm = {
    coordinator: arm.managedPolicy.candidateReadAllowlist,
    "code-generation": [],
    validation: [],
  };
  const readTools = ["view", "glob", "rg"];
  const explorers = ["coordinator"];
  const webTools = { coordinator: ["web_fetch"] };
  assert.deepEqual(manifest.roles.map(({ id }) => id).sort(), Object.keys(requiredApex).sort());
  for (const client of ["github-copilot-cli"]) {
    for (const role of manifest.roles) {
      if (["code-generation", "validation"].includes(role.id)) {
        assert.deepEqual(role.supportedTargets, ["github-copilot"], `${role.id} must ship to Copilot CLI`);
      }
      if (!roleSupportsClient(role, client)) {
        assert.equal(await pluginAgent(role.source), undefined);
        continue;
      }
      const content = await pluginAgent(role.source);
      const metadata = load(content.match(/^---\r?\n([\s\S]*?)\r?\n---/u)[1]);
      const label = `${client}/${role.id}`;
      if (role.id === "coordinator") {
        assert.match(content, /apex\/governanceImport/u, label);
      }
      const apexTools = requiredApex[role.id].map((tool) => `apex/${tool}`);
      const armTools = requiredArm[role.id].map((tool) => `apex-azure-pricing/${tool}`);
      assert.deepEqual(metadata.tools.filter((tool) => tool.startsWith("apex/")).sort(), apexTools.sort(), label);
      assert.deepEqual(
        metadata.tools.filter((tool) => tool.startsWith("apex-azure-pricing/")).sort(),
        armTools.sort(),
        label,
      );
      const interactive = ["ask_user", "task"];
      if (client === "github-copilot-cli")
        assert.equal(
          metadata.tools.includes("task"),
          roleDelegatesOnClient(role, client, manifest.roles, manifest.invocationEdges),
          `${label}: delegation must match supported worker edges`,
        );
      const nativeRead = explorers.includes(role.id) ? readTools : [];
      assert.deepEqual(
        metadata.tools.filter((tool) => readTools.includes(tool)),
        nativeRead,
        `${label}: read tools`,
      );
      const mechanics = content.split("<!-- apex-shared-body -->")[0];
      if (explorers.includes(role.id)) {
        assert.match(mechanics, /Explore is advisory and read-only/u, label);
        assert.match(mechanics, /never for requirements intake/u, label);
        assert.match(mechanics, /never treat its output as kernel evidence, task completion or approval/u, label);
      } else {
        assert.doesNotMatch(mechanics, /Explore is advisory/u, label);
      }
      if (metadata.tools.includes("task") && role.id !== "coordinator") {
        assert.match(
          mechanics,
          /never for general-purpose, rubber-duck, code-review, security-review or research agents/u,
          label,
        );
      }
      assert.ok(!metadata.tools.some((tool) => /^(bash|shell)/u.test(tool)), `${label}: no shell`);
      assert.deepEqual(
        metadata.tools.filter((tool) => tool === "web_fetch"),
        webTools[role.id] ?? [],
        `${label}: web tools`,
      );
      const allowed = new Set([...apexTools, ...armTools, ...interactive, ...nativeRead, ...(webTools[role.id] ?? [])]);
      for (const tool of metadata.tools) assert.ok(allowed.has(tool), `${label}: unexpected tool ${tool}`);
      for (const tool of [...arm.managedPolicy.denyBeforeTransport, ...arm.managedPolicy.deferredTools]) {
        assert.ok(!metadata.tools.includes(`apex-azure-pricing/${tool}`), `${label}: forbidden ARM tool ${tool}`);
      }
      if (role.interactionType === "autonomous-subagent") {
        assert.equal(metadata["user-invocable"], false, label);
        assert.ok(!metadata.tools.includes("vscode/askQuestions"), label);
      }
    }
  }
});

test("managed routing distinguishes input, review dispositions, and exact task context", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const agents = ["apex"];
  const skills = [
    "apex-workflow",
    "apex-next",
    "apex-requirements",
    "apex-architecture",
    "apex-planning",
    "apex-operations",
  ];
  for (const client of ["github-copilot-cli"]) {
    const apex = await pluginAgent(".github/agents/apex.agent.md");
    const mechanics = apex.split("<!-- apex-shared-body -->")[0];
    assert.match(mechanics, /same APEX agent/);
    assert.match(mechanics, /kernel-owned input or review decisions/);
    assert.match(apex, /Carry the user's requested outcome, stop point and prohibited operations/);
    assert.match(apex, /Route the `apex\/status` or `apex\/nextTask` result through `apex-next`/);
    assert.match(apex, /Do not print `\/agent` switches/);
    assert.match(apex, /Never use `session_store_sql`, SQL, session-history searches/);
    assert.match(apex, /Reuse project values the user already stated/);
    assert.match(apex, /Do not call\s+`apex\/nextTask` after `apex\/reviewDecide` or `apex\/reviewComplete`/u);
    if (client === "github-copilot-cli") {
      assert.match(mechanics, /Route through the `apex-next` skill/);
      assert.match(
        mechanics,
        /Use `task` only for the hidden workers and kernel rubber-duck reviews it names, never for interactive intake/,
      );
    }
    assert.equal(await pluginAgent(".github/agents/apex-reviewer.agent.md"), undefined);
    const next = await readFile(join(root, "customizations/.github/skills/apex-next/SKILL.md"), "utf8");
    assert.match(next, /`agent_type: "rubber-duck"`, `mode: "sync"` and `prompt` set to `reviewRequest.prompt`/u);
    assert.match(next, /Call `apex\/reviewComplete` with only the task ID/u);
    for (const agent of agents) {
      const content = await pluginAgent(`${agent}.agent.md`);
      for (const state of ["status=needs_input", "status=needs_review", "status=task", "task.taskId"]) {
        assert.ok(content.includes(state), `${client}/${agent}: missing ${state} routing`);
      }
      assert.match(content, /do not poll|not.*poll/iu, `${client}/${agent}: unresolved results must not be polled`);
      assert.doesNotMatch(content, /loop on[\s\S]*?until it returns `status=task`/iu);
    }
    for (const skill of skills) {
      const relative = `.github/skills/${skill}/SKILL.md`;
      const content = await readFile(join(root, "customizations", relative), "utf8");
      if (skill === "apex-operations") {
        assert.match(content, /For governance candidate selection, call `apex\/governanceSelect`/u);
        assert.match(content, /Return the service's `outputHash` and `summary`, never baseline bytes/u);
        assert.match(content, /never approve Gate 4 through chat/u);
      }
      if (skill === "apex-requirements") {
        assert.match(content, /Use this skill only when the kernel routes the active foreground `APEX` agent/u);
        assert.match(content, /intake-only scope, stop after the matching intake context/u);
        assert.match(content, /Never invent a project value/u);
        assert.match(content, /Performance and scale: check later/u);
        assert.match(content, /Recommendations are proposed, not confirmed requirements/u);
      }
      if (skill === "apex-workflow") {
        assert.match(content, /status-only request, report that result and stop/);
        assert.match(content, /route the next step with the `apex-next` skill/);
      }
      if (skill === "apex-next") {
        assert.match(content, /Do not ask the user to choose a role and do not search\s+session history/u);
        assert.match(content, /No `\/agent` switching/u);
        assert.match(content, /Continue in the same foreground `APEX` agent/u);
        assert.match(content, /\| `quality-owner`\s+\| `apex-operations`/u);
        assert.match(content, /Never delegate intake, user questions, gate decisions/u);
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
    version: "0.11.0-next.0",
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
    bundleVersion: "0.11.0-next.0",
    components: {
      customizationBundle: {
        version: "0.11.0-next.0",
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
        id: "github-copilot-cli",
        generatedRoot: "client-projections/github-copilot-cli",
        files: [".github/copilot/settings.json"],
      },
    ],
    plugin: PLUGIN,
    roles: [
      {
        id: "coordinator",
        source: ".github/agents/apex.agent.md",
        agent: "APEX",
        supportedTargets: ["github-copilot"],
      },
    ],
  };
  assert.deepEqual(validateClientProjectionDeclarations(valid), { ...valid, plugin: PLUGIN });
  for (const mutate of [
    (manifest) => {
      manifest.sharedFiles.push(manifest.sharedFiles[0]);
    },
    (manifest) => {
      manifest.clientProjections[0].files = ".github/copilot/settings.json";
    },
    (manifest) => {
      manifest.clientProjections[0].files.push(manifest.clientProjections[0].files[0]);
    },
    (manifest) => {
      manifest.clientProjections[0].id = "github-copilot-vscode";
    },
    (manifest) => {
      manifest.clientProjections.push({
        id: "both",
        generatedRoot: "client-projections/both",
        files: [".vscode/mcp.json", ".github/copilot/settings.json"],
      });
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
    (manifest) => {
      manifest.roles[0].supportedTargets = ["vscode"];
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
        id: "github-copilot-cli",
        generatedRoot: "client-projections/github-copilot-cli",
        files: [".github/copilot/settings.json"],
      },
    ],
    plugin: PLUGIN,
    roles: [
      {
        id: "validator",
        source: ".github/agents/apex-validator.agent.md",
        agent: "APEX Validator",
        supportedTargets: ["github-copilot"],
      },
    ],
  };
  assert.deepEqual(validateClientProjectionDeclarations(manifest), { ...manifest, plugin: PLUGIN });
  assert.equal(roleSupportsClient(manifest.roles[0], "github-copilot-cli"), true);
  assert.throws(() => roleSupportsClient(manifest.roles[0], "github-copilot-vscode"), /Unsupported client projection/u);
});

test("delegation is enabled only when a destination is supported by the client", () => {
  const parent = { agent: "APEX", supportedTargets: ["github-copilot"] };
  const worker = { agent: "APEX CodeGen", supportedTargets: ["github-copilot"] };
  const edges = [{ from: parent.agent, to: worker.agent, type: "subagent" }];
  assert.equal(roleDelegatesOnClient(parent, "github-copilot-cli", [parent, worker], edges), true);
  assert.equal(
    roleDelegatesOnClient(parent, "github-copilot-cli", [parent, { ...worker, supportedTargets: [] }], edges),
    false,
  );
  assert.throws(
    () => roleDelegatesOnClient(parent, "github-copilot-vscode", [parent, worker], edges),
    /Unsupported client projection/u,
  );
});

test("asset generator renders the CLI APEX projection and rejects retired VS Code fields", () => {
  const source = `---
name: APEX
description: Run workflow.
user-invocable: true
tools:
  - ask_user
  - task
  - apex/status
  - apex/recordInput
---

## Role

Gather requirements through the kernel.
`;
  const cli = renderClientAgentProjection(source, "github-copilot-cli");
  assert.match(cli, /\n\s+- ask_user/u);
  assert.match(cli, /\n\s+- task/u);
  assert.doesNotMatch(cli, /^(?:model|model-policy|reasoning-effort):/mu);
  assert.match(cli, /target: github-copilot/u);
  assert.match(cli, /disable-model-invocation: false/u);
  assert.match(cli, /collect one free-text answer/u);
  assert.match(cli, /use `ask_user` checkboxes when the client offers them/u);
  assert.match(cli, /number every exact kernel option in its original order/u);
  assert.match(cli, /request correction for out-of-range, duplicate, non-numeric, empty, or ambiguous entries/u);
  assert.match(cli, /when every value matches, the checkbox answer needs no further confirmation/u);
  assert.match(cli, /resolved selection as an array in kernel order/u);
  assert.match(cli, /A correction requires a fresh confirmation of the complete set/u);
  assert.match(cli, /only after the checkbox answer or confirmation/u);
  assert.match(cli, /Cancellation means no submission/u);
  assert.match(cli, /Never pass unsupported question-tool parameters/u);
  assert.match(cli, /<!-- apex-shared-body -->\n+## Role\n\nGather requirements through the kernel\./u);
  const render = (text) => () => renderClientAgentProjection(text, "github-copilot-cli");
  for (const field of ["argument-hint: Describe the workload", "agents: [APEX CodeGen]", "handoffs: []"])
    assert.throws(render(source.replace("user-invocable:", `${field}\nuser-invocable:`)), /must not declare/u);
  for (const tool of ["vscode/askQuestions", "agent"])
    assert.throws(render(source.replace("  - ask_user", `  - ${tool}`)), /must not use/u);
  for (const field of ["model: gpt-6-sol", "model-policy: preferred", "reasoning-effort: max"])
    assert.throws(
      render(source.replace("user-invocable:", `${field}\nuser-invocable:`)),
      /must not declare .*session model applies/u,
    );
  assert.throws(render(source.replace("name:", "target: github-copilot\nname:")), /must not declare target/u);
});

test("CLI projection keeps hidden workers noninteractive and rejects unpinned APEX operations", () => {
  const hidden = `---
name: APEX Validator
description: Validate one result.
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
  const delegable = renderClientAgentProjection(
    hidden.replace("disable-model-invocation: true\n", ""),
    "github-copilot-cli",
    {
      interactiveTools: { askUser: "ask_user", delegate: "task" },
      workspaceServer: "apex",
      operationIds: ["status"],
    },
  );
  const enabled = load(/^---\n([\s\S]*?)\n---/u.exec(delegable)[1]);
  assert.equal(enabled["user-invocable"], false);
  assert.equal(enabled["disable-model-invocation"], false);
  assert.deepEqual(enabled.tools, ["apex/status"]);
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
        id: "github-copilot-cli",
        generatedRoot: "client-projections/github-copilot-cli",
        files: [".github/copilot/settings.json"],
      },
    ],
    plugin: PLUGIN,
    roles: [
      {
        id: "coordinator",
        source: ".github/agents/apex.agent.md",
        agent: "APEX",
        supportedTargets: ["github-copilot"],
      },
    ],
  };
  for (const root of ["../escaped", "/absolute", "client-projections\\windows", "client-projections/../escape"]) {
    const invalid = structuredClone(base);
    invalid.clientProjections[0].generatedRoot = root;
    assert.throws(() => validateClientProjectionDeclarations(invalid), /declarations are invalid/u);
  }
});

test("APEX CLI projections leave model selection to the session", async () => {
  const manifest = JSON.parse(await readFile(join(root, "customizations/manifest.json"), "utf8"));
  const inventory = JSON.parse(await readFile(join(root, "tools/registry/copilot-cli-agent-tools.json"), "utf8"));
  for (const role of manifest.roles) {
    const source = await readFile(join(root, "customizations", role.source), "utf8");
    const rendered = renderClientAgentProjection(source, "github-copilot-cli", inventory, { delegates: false });
    const frontmatter = load(/^---\n([\s\S]*?)\n---/u.exec(rendered)[1]);
    assert.equal(role.model, undefined, `${role.agent} manifest model`);
    for (const field of ["model", "model-policy", "reasoning-effort"])
      assert.equal(frontmatter[field], undefined, `${role.agent} ${field}`);
  }
});

test("retired interactive handoffs do not grant background task delegation", () => {
  const coordinator = { agent: "APEX", supportedTargets: ["github-copilot"] };
  const requirements = { agent: "APEX Requirements", supportedTargets: ["github-copilot"] };
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
user-invocable: true
tools:
  - ask_user
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
  assert.match(rendered, /collect one free-text answer/u);
  assert.match(rendered, /Route through the `apex-next` skill/);
});

test("restored managed skills ship through the plugin, not the workspace projection", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const manifest = JSON.parse(await readFile(join(root, "customizations/manifest.json"), "utf8"));
  for (const skill of ["apex-azure-adr", "apex-azure-defaults", "apex-azure-rbac", "apex-microsoft-docs"]) {
    const skillPath = `.github/skills/${skill}/SKILL.md`;
    assert.ok(manifest.plugin.files.includes(skillPath), `${skill} should ship in the plugin`);
    await assert.rejects(readFile(join(root, "packages/cli/assets/client-projections/github-copilot-cli", skillPath)), {
      code: "ENOENT",
    });
  }
});

test("plugin skills include operational references", async () => {
  const manifest = JSON.parse(await readFile(join(root, "customizations/manifest.json"), "utf8"));
  for (const relativePath of [
    ".github/skills/apex-azure-governance/references/operational-checklist.md",
    ".github/skills/apex-azure-deploy/references/operational-checklist.md",
  ]) {
    assert.ok(manifest.plugin.files.includes(relativePath));
    assert.match(await readFile(join(root, "customizations", relativePath), "utf8"), /Operational Checklist/u);
  }
});
