import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { load } from "js-yaml";
import { validateVscodeConfiguration } from "../scripts/validate-vscode-config.mjs";
import { parseFrontmatter } from "../scripts/_lib/parse-frontmatter.mjs";
import { validateManagedHandoffs } from "../scripts/_lib/managed-handoffs.mjs";
import { validateReviewDependencies } from "../scripts/validate-challenger-presence.mjs";

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

test("all four review requirements survive workflow cleanup", () => {
  const workflow = JSON.parse(readFileSync("config/workflow.v1.json", "utf8"));
  assert.deepEqual(validateReviewDependencies(workflow), []);
  for (const review of [
    "requirements-review",
    "architecture-review",
    "governance-reconciliation-review",
    "plan-review",
  ]) {
    const changed = structuredClone(workflow);
    for (const node of changed.nodes)
      node.sourceDependencies = node.sourceDependencies.filter((dependency) => dependency !== review);
    assert.ok(validateReviewDependencies(changed).some((error) => error.includes(review)));
  }
});

test("managed handoffs reject unknown targets, wildcard dispatch and unbounded loops", () => {
  const agents = [{ name: "APEX", agents: ["Reviewer"], handoffs: [{ agent: "Reviewer" }] }, { name: "Reviewer" }];
  assert.deepEqual(validateManagedHandoffs(agents), []);
  assert.ok(validateManagedHandoffs([{ name: "APEX", agents: ["*"] }]).length > 0);
  assert.ok(validateManagedHandoffs([{ name: "APEX", handoffs: [{ agent: "missing" }] }]).length > 0);
  assert.ok(validateManagedHandoffs([{ name: "APEX", handoffs: [{}] }]).length > 0);
  assert.ok(validateManagedHandoffs([{ name: "APEX", agents: "Reviewer" }]).length > 0);
  const self = { agent: "APEX", prompt: "Input task. Output: result." };
  assert.deepEqual(validateManagedHandoffs([{ name: "APEX", handoffs: [self] }]), []);
  assert.ok(validateManagedHandoffs([{ name: "APEX", handoffs: Array(7).fill(self) }]).length > 0);
  assert.ok(validateManagedHandoffs([{ name: "APEX", handoffs: [{ agent: "APEX" }] }]).length > 0);
});

test("retired automation commands remain unavailable", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  for (const command of [
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
  ])
    assert.equal(scripts[command], undefined, `${command} must stay retired`);
  for (const path of [
    "tools/scripts/setup-wsl.sh",
    "tools/scripts/setup-windows.ps1",
    "config/workflow.v1.json",
    "agent-output/vnext-qualification/04-governance-constraints.json",
    "packages/contracts/schemas/workload-decision-manifest-v1.schema.json",
  ])
    assert.equal(existsSync(path), true, `${path} replacement is required`);
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
  assert.deepEqual(Object.keys(workflow.jobs), ["ci"]);
  assert.doesNotMatch(readFileSync("tools/scripts/setup-wsl.sh", "utf8"), /apex-recall/u);
  assert.doesNotMatch(readFileSync(".github/actions/setup-python-validation/action.yml", "utf8"), /apex-recall/u);
});

test("local governance discovery is not a shipped capability", () => {
  const policy = JSON.parse(readFileSync("config/capability-packs.v1.json", "utf8"));
  assert.equal(
    policy.packs.some(({ id }) => id === "azure-governance-discovery"),
    false,
  );
  assert.equal(existsSync(".github/skills/azure-governance-discovery/scripts/discover.py"), false);
  assert.equal(existsSync("tools/scripts/collect-governance-baseline.ps1"), true);
});
