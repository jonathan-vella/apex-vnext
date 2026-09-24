import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "../../..");
const execFile = promisify(execFileCallback);
const skills = [
  ["apex-workflow", "apex.agent.md"],
  ["apex-requirements", "apex-requirements.agent.md"],
  ["apex-architecture", "apex-architect.agent.md"],
  ["apex-planning", "apex-planner.agent.md"],
  ["apex-codegen", "apex-codegen.agent.md"],
  ["apex-operations", "apex-operator.agent.md"],
];

const skillPath = (skill) => resolve(root, "customizations", ".github", "skills", skill, "SKILL.md");
const agentPath = (agent) => resolve(root, "customizations", ".github", "agents", agent);
const assetSkillPath = (assetRoot, skill) => resolve(assetRoot, ".github", "skills", skill, "SKILL.md");

test("native skills are internal, packaged, structured, and wired to their primary agents", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "customizations", "manifest.json"), "utf8"));

  for (const [skill, agent] of skills) {
    const [source, agentSource] = await Promise.all([
      readFile(skillPath(skill), "utf8"),
      readFile(agentPath(agent), "utf8"),
    ]);
    const packagedPath = `.github/skills/${skill}/SKILL.md`;

    assert.match(source, new RegExp(`^name: ${skill}$`, "mu"));
    assert.match(source, /^user-invocable: false$/mu);
    for (const heading of ["## Prerequisites", "## Workflow", "## Boundaries", "## Output"]) {
      assert.match(source, new RegExp(`^${heading}$`, "mu"));
    }
    assert.ok(manifest.managedFiles.includes(packagedPath), `${skill} must be packaged`);
    assert.match(agentSource, new RegExp(`\\.github/skills/${skill}/SKILL\\.md`, "u"));
  }
});

test("apex-next is a packaged, user-invocable routing skill used by the coordinator", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "customizations", "manifest.json"), "utf8"));
  const [source, coordinator] = await Promise.all([
    readFile(skillPath("apex-next"), "utf8"),
    readFile(agentPath("apex.agent.md"), "utf8"),
  ]);
  assert.match(source, /^name: apex-next$/mu);
  assert.doesNotMatch(source, /^user-invocable: false$|^disable-model-invocation: true$/mu);
  for (const heading of ["## Prerequisites", "## Workflow", "## Boundaries", "## Output"]) {
    assert.match(source, new RegExp(`^${heading}$`, "mu"));
  }
  assert.ok(manifest.managedFiles.includes(".github/skills/apex-next/SKILL.md"), "apex-next must be packaged");
  assert.match(coordinator, /\.github\/skills\/apex-next\/SKILL\.md/u);
});

test("native skills are copied to the bundle and the CLI projection", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const assetRoots = [
    resolve(root, "packages", "cli", "assets", "customizations"),
    resolve(root, "packages", "cli", "assets", "client-projections", "github-copilot-cli"),
  ];

  for (const skill of [...skills.map(([name]) => name), "apex-next"]) {
    const source = await readFile(skillPath(skill), "utf8");
    for (const assetRoot of assetRoots) {
      assert.equal(await readFile(assetSkillPath(assetRoot, skill), "utf8"), source);
    }
  }
});
