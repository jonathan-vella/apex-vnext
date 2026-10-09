import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadValidator } from "../scripts/_lib/ajv-validator.mjs";
import test from "node:test";
import { load } from "js-yaml";
import { validateVscodeConfiguration } from "../scripts/validate-vscode-config.mjs";
import { parseFrontmatter } from "../scripts/_lib/parse-frontmatter.mjs";
import { validateReviewDependencies } from "../scripts/validate-challenger-presence.mjs";

test("current region guidance uses the canonical runtime reference without a legacy mirror", () => {
  const defaults = JSON.parse(readFileSync("config/defaults.v1.json", "utf8"));
  assert.equal(defaults.azureDefaults.regionReference, ".github/copilot-instructions.md#default-regions");
  const skill = readFileSync("customizations/.github/skills/apex-azure-defaults/SKILL.md", "utf8");
  assert.match(skill, /runtime `securityInvariants` and `azureDefaults` configuration owns/u);
  assert.match(skill, /`apex\/taskContext` projects/u);
  assert.doesNotMatch(skill, /^###\s+Default Regions\s*$/mu);
  const validator = readFileSync("tools/scripts/validate-region-canonical.mjs", "utf8");
  assert.doesNotMatch(validator, /["']\.github\/skills\/azure-defaults\/SKILL\.md["']/u);
  assert.match(validator, /config\/defaults\.v1\.json/u);
});

test("retired paths remain absent without requiring historical evidence", () => {
  const policy = JSON.parse(readFileSync("tools/registry/retired-paths.v1.json", "utf8"));
  assert.equal(policy.schemaVersion, "1.0.0");
  assert.ok(policy.paths.length > 0);
  assert.equal(new Set(policy.paths).size, policy.paths.length);
  for (const path of policy.paths) {
    assert.equal(path.startsWith("/"), false);
    assert.equal(path.split("/").includes(".."), false);
    assert.equal(existsSync(path), false, `${path} must stay retired`);
  }
});

test("historical operational originals are absent from tracked development source, not forbidden in consumers", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const existing = tracked.filter((path) => existsSync(path));
  assert.deepEqual(
    existing.filter((path) => path.startsWith(".apex/") || path.startsWith("agent-output/")),
    [],
  );
});

test("obsolete snake_case sidecars cannot satisfy current typed contracts", () => {
  for (const [name, payload] of [
    ["implementation-intent", { schema_version: "1.0", modules: { bicep: [], terraform: [] }, resource_inventory: [] }],
    ["iac-binding", { schema_version: "1.0", source_hash: "a".repeat(64), resources: [] }],
    ["environment-inputs", { schema_version: "1.0", environment: "prod", parameters: {}, secrets: {} }],
    ["policy-property-map", { schema_version: "1.0", policy_assignments: [], property_map: {} }],
    ["iac-handoff", { schema_version: "1.0", validation_summary: {}, artifact_paths: [], tree_hash: "a".repeat(64) }],
    ["policy-validation", { schema_version: "policy-precheck-v2", compliance_status: "passed", findings: [] }],
    ["review-findings", { schema_version: "1.0", reviewer: "challenger", findings: [], decision: "approved" }],
    [
      "deployment-preview",
      { schema_version: "1.0", preview_hash: "a".repeat(64), approved: true, expires_at: "2099-01-01T00:00:00Z" },
    ],
  ]) {
    const schemaPath = `packages/contracts/schemas/${name}-v1.schema.json`;
    assert.equal(existsSync(schemaPath), true, `Current schema required: ${name}`);
    assert.equal(loadValidator(schemaPath)(payload), false, `Old ${name} shape must be rejected`);
  }
});

test("all review requirements survive workflow cleanup", () => {
  const workflow = JSON.parse(readFileSync("config/workflow.v1.json", "utf8"));
  assert.deepEqual(validateReviewDependencies(workflow), []);
  for (const review of ["requirements-review", "architecture-review", "plan-review"]) {
    const changed = structuredClone(workflow);
    for (const node of changed.nodes)
      node.sourceDependencies = node.sourceDependencies.filter((dependency) => dependency !== review);
    assert.ok(validateReviewDependencies(changed).some((error) => error.includes(review)));
  }
});

test("retired automation commands remain unavailable", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  for (const command of [
    "fix:artifact-h2",
    "check:h2-order",
    "render:headings-summary",
    "validate:headings-summary",
    "validate:guidance-migration",
    "test:guidance-migration",
    "validate:challenger-findings",
    "validate:iac-contract",
    "validate:iac-contract-consistency",
    "validate:policy-property-map",
    "validate:environment-manifest",
    "validate:iac-handoff",
    "validate:plan-avm-pins",
    "validate:policy-precheck",
    "validate:session-state",
    "validate:context-budget",
    "validate:governance-trace",
    "validate:lens-references",
    "measure:baseline",
    "test:governance-discovery",
    "test:apex-recall",
    "sync:workflows",
    "validate:terraform-mcp-characterization",
    "test:terraform-mcp-characterization",
    "test:devcontainer-verdicts",
    "check:context-redundancy",
    "derive:sku-allowlist",
    "fetch:deprecations",
    "fix:artifacts",
    "lint:docs-frontmatter",
    "lint:policy-precheck",
    "lint:yaml",
    "lint:vnext",
    "measure:precommit-baseline",
    "report:challenger-gaps",
    "test:context-budget",
    "test:orphan-skill-discovery",
    "test:precommit-baseline",
    "test:subagent-file-contract",
    "test:vnext-live-workflow",
    "validate:avm-versions:ci",
    "validate:avm-versions:offline",
    "validate:challenger-decisions",
    "validate:plan-avm-pins:local",
    "e2e:validate",
    "e2e:benchmark",
    "e2e:combine",
    "smoke:verify",
    "export:agent-output-html",
    "init",
    "setup",
    "test:lib-e2e",
    "validate:pre-agent-loop",
    "pre-agent-loop",
    "test:pre-agent-loop",
    "validate:modernization-ownership",
    "test:modernization-ownership",
    "assess:agents",
    "challenger-telemetry",
    "lint:workflow-handoffs",
    "validate:azure-mcp-latest",
  ])
    assert.equal(scripts[command], undefined, `${command} must stay retired`);
  const cli = readFileSync("packages/cli/src/cli.ts", "utf8");
  assert.match(cli, /case "project promote":/u);
  assert.doesNotMatch(cli, /case "promote":/u);
  for (const path of [
    "tools/scripts/setup-wsl.sh",
    "tools/scripts/setup-windows.ps1",
    "config/workflow.v1.json",
    "packages/contracts/schemas/workload-decision-manifest-v1.schema.json",
  ])
    assert.equal(existsSync(path), true, `${path} replacement is required`);
  const qualification = readFileSync("tools/scripts/validate-vnext-qualification-context.mjs", "utf8");
  const launcher = readFileSync("tools/scripts/vnext-live-handoff.mjs", "utf8");
  assert.doesNotMatch(qualification + launcher, /agent-output\/vnext-qualification\/04-governance-constraints\.json/u);
  assert.match(qualification, /Explicit qualification governance file is required/u);
  assert.match(launcher, /governance_file/u);
});

test("Functions guidance cannot route into retired materialization", () => {
  const paths = [
    "customizations/.github/skills/apex-azure-prepare/SKILL.md",
    "customizations/.github/skills/apex-azure-prepare/references/preparation-lineage.md",
  ];
  const guidance = paths.map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(
    guidance,
    /composition algorithm|templates\/selection\.md|templates\/README\.md|azd init -t|az functionapp create|resource "azurerm_linux_function_app"/iu,
  );
});

test("consumer Node prerequisites match the canonical tool pin", () => {
  const minimum = JSON.parse(readFileSync("tools/registry/tool-version-pins.json", "utf8")).pins.node.min;
  const paths = [
    "docs/how-to/prepare-windows-11.md",
    "docs/tutorials/first-run.md",
    "docs/tutorials/wsl2-vscode-consumer-runbook.md",
    "packages/cli/src/version.ts",
  ];
  for (const path of paths) {
    const content = readFileSync(path, "utf8");
    assert.match(content, new RegExp(minimum.replaceAll(".", "\\."), "u"), `${path} must use ${minimum}`);
    assert.doesNotMatch(content, /Node(?:\.js)? 24 or (?:later|newer)/u);
  }
  const service = readFileSync("packages/cli/src/service.ts", "utf8");
  assert.match(service, /meetsMinimumVersion\(process\.versions\.node, MINIMUM_NODE_VERSION\)/u);
  assert.doesNotMatch(service, /Node(?:\.js)? 24 or (?:later|newer)/u);
});

test("current toolchain and validator use only canonical tool pins", () => {
  const pins = JSON.parse(readFileSync("tools/registry/tool-version-pins.json", "utf8")).pins;
  assert.match(pins.bicep.min, /^\d+\.\d+\.\d+$/u);
  assert.match(pins.az.min, /^\d+\.\d+\.\d+$/u);
  assert.equal(existsSync("packages/contracts/schemas/iac-handoff-v1.schema.json"), true);
  const validator = readFileSync("tools/scripts/validate-tool-versions.mjs", "utf8");
  assert.doesNotMatch(validator, /DEFAULT_PINS|ensureDefaultPins|writeFileSync\(PINS_PATH/u);
  assert.match(validator, /tool-version-pins\.json is required/u);
});

test("WSL editor validation retains settings, discovery and exact extension guards", () => {
  const settings = JSON.parse(readFileSync(".vscode/settings.json", "utf8"));
  const extensions = JSON.parse(readFileSync(".vscode/extensions.json", "utf8")).recommendations;
  assert.deepEqual(validateVscodeConfiguration(settings, extensions), []);
  assert.ok(validateVscodeConfiguration(settings, extensions.slice(1)).length > 0);
  assert.ok(validateVscodeConfiguration(settings, [...extensions, extensions[0].toUpperCase()]).length > 0);
  assert.ok(validateVscodeConfiguration(settings, [...extensions, "unapproved.extension"]).length > 0);
  assert.ok(validateVscodeConfiguration(settings, [null]).length > 0);
  assert.ok(validateVscodeConfiguration(null, extensions).length > 0);
  const drifted = structuredClone(settings);
  drifted["chat.agentFilesLocations"][".github/agents"] = true;
  drifted["chat.agentSkillsLocations"]["~/.copilot/skills"] = true;
  drifted["chat.useAgentSkills"] = false;
  assert.equal(validateVscodeConfiguration(drifted, extensions).length, 3);
});

test("retired host and branch automation have no updater or required check", () => {
  const dependabot = load(readFileSync(".github/dependabot.yml", "utf8"));
  assert.equal(
    dependabot.updates.some((entry) => entry["package-ecosystem"] === "devcontainers"),
    false,
  );
  const workflows = JSON.parse(readFileSync("tools/registry/github-workflow-contract.json", "utf8"));
  assert.equal(
    workflows.workflows.some(({ id }) => id === "sensei-branch-maintenance"),
    false,
  );
  assert.deepEqual(workflows.expectedRequiredContexts, ["ci", "CodeQL"]);
});

test("docs-writer is manual-only and loads scoped unslop without recursion", () => {
  const writer = readFileSync(".github/skills/docs-writer/SKILL.md", "utf8");
  const unslop = readFileSync(".github/skills/apex-unslop/SKILL.md", "utf8");
  assert.equal(parseFrontmatter(writer)["disable-model-invocation"], "true");
  assert.equal(parseFrontmatter(writer)["user-invocable"], "true");
  assert.equal(parseFrontmatter(unslop)["disable-model-invocation"], "false");
  assert.match(writer, /Load \[apex-unslop\]/u);
  assert.match(unslop, /do not invoke it recursively/u);
});

test("context guidance uses current task authority without recall checkpoints", () => {
  const skill = readFileSync(".github/skills/context-management/SKILL.md", "utf8");
  const frontmatter = parseFrontmatter(skill);
  assert.equal(frontmatter["disable-model-invocation"], "true");
  assert.equal(frontmatter["user-invocable"], "true");
  assert.match(frontmatter.description, /WHEN: explicitly invoked as \/context-management/u);
  assert.match(skill, /references to this skill are not invocation requests/u);
  const vendorRules = JSON.parse(readFileSync(".github/skills/vendor-prompting/rules.json", "utf8"));
  assert.deepEqual(vendorRules.rules.map(({ id }) => id).sort(), [
    "cross-language-density-001",
    "handoff-enrichment-001",
    "model-pin-001",
    "personality-scoping-001",
  ]);
  assert.doesNotMatch(skill, /apex-recall|01-Orchestrator|hard-checkpoints\.md|compression-templates\.md/u);
  assert.match(skill, /apex-context\.instructions\.md/u);
  assert.match(skill, /expiry and writer authority/u);
  assert.match(skill, /Do not discard policy, security/u);
  const methodology = readFileSync(".github/skills/context-management/references/analysis-methodology.md", "utf8");
  const profiling = readFileSync(".github/skills/context-management/references/log-profiling.md", "utf8");
  assert.doesNotMatch(methodology + profiling, /11-Context Optimizer|apex-recall|npm run snapshot:baseline/u);
  assert.match(methodology, /Latency alone does not identify context size/u);
});

test("recall package and installation entry points remain retired", () => {
  for (const path of [
    "tools/apex-recall/pyproject.toml",
    "tools/apex-recall/src/apex_recall/cli.py",
    "tools/tests/test_apex_recall/conftest.py",
  ]) {
    assert.equal(existsSync(path), false, path);
  }
  const dependabot = load(readFileSync(".github/dependabot.yml", "utf8"));
  assert.equal(
    dependabot.updates.some(({ directory }) => directory === "/tools/apex-recall"),
    false,
  );
  const workflow = load(readFileSync(".github/workflows/ci.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.jobs), ["ci", "windows-package-tests"]);
  assert.doesNotMatch(readFileSync("tools/scripts/setup-wsl.sh", "utf8"), /apex-recall/u);
  assert.doesNotMatch(readFileSync(".github/actions/setup-python-validation/action.yml", "utf8"), /apex-recall/u);
});

test("local governance discovery is not a shipped capability", () => {
  const installationGuide = readFileSync("docs/how-to/manage-installation.md", "utf8");
  assert.doesNotMatch(installationGuide, /--pack\s+azure-governance-discovery/u);
  assert.match(installationGuide, /registry is currently empty/u);
  const policy = JSON.parse(readFileSync("config/capability-packs.v1.json", "utf8"));
  assert.equal(
    policy.packs.some(({ id }) => id === "azure-governance-discovery"),
    false,
  );
  assert.equal(existsSync(".github/skills/azure-governance-discovery/scripts/discover.py"), false);
  assert.equal(existsSync("tools/scripts/collect-governance-baseline.ps1"), true);
});
