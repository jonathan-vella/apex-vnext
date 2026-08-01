import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync } from "node:fs";
import test from "node:test";

const archivePath = ".archive/retired-automation/sync-workflows.mjs";
const provenancePath = ".archive/retired-automation/README.md";
const expectedHash = "e1111eb1f9a60e4273c1302a9af8666a555f7b5c6f079451ecaa37f50ec4cffa";
const terraformArchivePath = ".archive/retired-automation/terraform-mcp";
const e2eArchivePath = ".archive/retired-automation/e2e-v1";
const promptArchivePath = ".archive/retired-prompts/original-apex-v1";
const utilityArchivePath = ".archive/retired-utilities/original-apex-v1";
const qualificationArchivePath = ".archive/qualification/vnext-qualification-v1";
const preAgentArchivePath = ".archive/retired-automation/pre-agent-loop-v1";
const compatibilityArchivePath = ".archive/retired-compatibility/original-apex-v1";
const devcontainerArchivePath = ".archive/retired-automation/devcontainer-base-v1";
const npmUtilitiesArchivePath = ".archive/retired-utilities/npm-scripts-v1";
const devcontainerUtilitiesArchivePath = ".archive/retired-utilities/devcontainer-v1";
const rootConfigArchivePath = ".archive/retired-config/root-v1";
const guideArchivePath = ".archive/documentation/guides-v1";
const candidateDocumentationArchivePath = ".archive/documentation/candidate-evidence-v1";

function textSha256(path) {
  const normalized = readFileSync(path, "utf8").replace(/\r\n/gu, "\n");
  return createHash("sha256").update(normalized).digest("hex");
}

test("workflow synchronization remains provenance-only retired automation", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  assert.equal(scripts["sync:workflows"], undefined);
  assert.equal(existsSync("tools/scripts/sync-workflows.mjs"), false);
  assert.equal(existsSync(archivePath), true);
  assert.equal(textSha256(archivePath), expectedHash);

  const provenance = readFileSync(provenancePath, "utf8");
  assert.match(provenance, new RegExp(expectedHash));
  assert.match(provenance, /946c72c5c7785e16ded06b4dc26dbf189b194677/u);
  assert.match(provenance, /## Workflow Synchronization/u);
  assert.match(provenance, /### Replacement Owner/u);
  assert.match(provenance, /### Rollback/u);

  const activeFiles = globSync(
    ["package.json", "tools/**/*.{mjs,js,json,md,sh}", "docs/**/*.md", ".github/**/*.{yml,yaml,json,md,mjs,js,sh}"],
    { exclude: ["**/node_modules/**", "docs/vnext/phase-0a/**"] },
  ).filter((path) => path !== "tools/tests/retired-automation.test.mjs");
  const activeReferences = activeFiles.filter((path) => {
    const content = readFileSync(path, "utf8");
    return content.includes("sync:workflows") || content.includes("tools/scripts/sync-workflows.mjs");
  });
  assert.deepEqual(activeReferences, [], `active retirement references: ${activeReferences.join(", ")}`);
});

test("Terraform MCP characterization remains provenance-only retired automation", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  assert.equal(scripts["validate:terraform-mcp-characterization"], undefined);
  assert.equal(scripts["test:terraform-mcp-characterization"], undefined);
  assert.equal(existsSync("tools/scripts/validate-terraform-mcp-characterization.mjs"), false);
  assert.equal(existsSync("tools/registry/terraform-mcp-characterization.json"), false);
  assert.equal(existsSync(`${terraformArchivePath}/README.md`), true);

  const provenance = readFileSync(`${terraformArchivePath}/README.md`, "utf8");
  assert.match(provenance, /69bac4e1d6e463a72d4a16111d1163ec30589094/u);
  assert.match(provenance, /7b3dee20b2713430c7302f5cdfc7b4a19e5a73e4/u);
  assert.match(provenance, /## Replacement Owners/u);
  assert.match(provenance, /## Rollback/u);
});

test("disabled devcontainer CI remains provenance-only", () => {
  const provenance = JSON.parse(readFileSync(`${devcontainerArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.decision, "DECISION-009");
  for (const artifact of provenance.artifacts) {
    assert.equal(existsSync(artifact.path), false, `${artifact.path} must stay retired`);
    const archiveFile = `${devcontainerArchivePath}/${artifact.path}`;
    assert.equal(existsSync(archiveFile), true, `missing archived devcontainer artifact: ${artifact.path}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
  }
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  assert.equal(scripts["test:devcontainer-verdicts"], undefined);
});

test("retired npm utilities remain provenance-only", () => {
  const provenance = JSON.parse(readFileSync(`${npmUtilitiesArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.archivedFrom, "f6ef8c3");
  for (const artifact of provenance.artifacts) {
    assert.equal(existsSync(artifact.path), false, `${artifact.path} must stay retired`);
    const archiveFile = `${npmUtilitiesArchivePath}/${artifact.path}`;
    assert.equal(existsSync(archiveFile), true, `missing archived npm utility: ${artifact.path}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
  }

  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  for (const command of [
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
  ]) {
    assert.equal(scripts[command], undefined, `${command} must stay retired`);
  }
});

test("original devcontainer utilities remain provenance-only", () => {
  const provenance = JSON.parse(readFileSync(`${devcontainerUtilitiesArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.archivedFrom, "2c3a42b8c42136dc85b01de5aea5f2f3e6983c0e");

  for (const artifact of provenance.artifacts) {
    const activePath = artifact.path;
    const archiveFile = `${devcontainerUtilitiesArchivePath}/${activePath}`;
    assert.equal(existsSync(archiveFile), true, `missing archived devcontainer utility: ${activePath}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
    if (activePath !== ".devcontainer/post-create.sh") {
      assert.equal(existsSync(activePath), false, `${activePath} must stay retired`);
    }
  }

  const activeBootstrap = readFileSync(".devcontainer/post-create.sh", "utf8");
  for (const retiredTool of ["checkov", "deno", "graphviz", "k6", "matplotlib", "pillow", "tflint"]) {
    assert.equal(
      activeBootstrap.toLowerCase().includes(retiredTool),
      false,
      `${retiredTool} must stay out of bootstrap`,
    );
  }
});

test("zero-consumer root configuration remains provenance-only", () => {
  const provenance = JSON.parse(readFileSync(`${rootConfigArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.archivedFrom, "ab8cea2b1d9767ca33e905072c6f83b1439b86ce");

  for (const artifact of provenance.artifacts) {
    assert.equal(existsSync(artifact.path), false, `${artifact.path} must stay retired`);
    const archiveFile = `${rootConfigArchivePath}/${artifact.path}`;
    assert.equal(existsSync(archiveFile), true, `missing archived root configuration: ${artifact.path}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
  }
});

test("superseded documentation remains provenance-only", () => {
  for (const archiveRoot of [guideArchivePath, candidateDocumentationArchivePath]) {
    const provenance = JSON.parse(readFileSync(`${archiveRoot}/provenance.json`, "utf8"));
    assert.equal(provenance.archivedFrom, "da708ef5e0ff63a9ff1bf1a43112c6670e3bfc0a");
    for (const artifact of provenance.artifacts) {
      assert.equal(existsSync(artifact.path), false, `${artifact.path} must stay out of active documentation`);
      const archiveFile = `${archiveRoot}/${artifact.path}`;
      assert.equal(existsSync(archiveFile), true, `missing archived documentation: ${artifact.path}`);
      assert.equal(textSha256(archiveFile), artifact.sha256);
    }
  }
});

test("original APEX E2E automation remains provenance-only", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  for (const command of ["e2e:validate", "e2e:benchmark", "e2e:combine"]) {
    assert.equal(scripts[command], undefined, `${command} must stay retired`);
  }
  for (const path of [
    ".github/workflows/e2e-validation.yml",
    "tools/scripts/benchmark-e2e.mjs",
    "tools/scripts/combine-e2e-runs.mjs",
    "tools/scripts/validate-e2e-step.mjs",
    "tools/scripts/_lib/e2e-helpers.mjs",
    "tools/tests/lib/e2e-helpers.test.mjs",
    "tools/tests/prompts/e2e-contoso-rfp.prompt.md",
  ]) {
    assert.equal(existsSync(path), false, `${path} must stay out of active paths`);
  }

  const provenance = JSON.parse(readFileSync(`${e2eArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.archivedFrom, "901adcbc4b033c912cfbd198307c44b4979b089e");
  assert.equal(provenance.introducedBy, "946c72c5c7785e16ded06b4dc26dbf189b194677");
  for (const artifact of provenance.artifacts) {
    const archiveFile = `${e2eArchivePath}/${artifact.path}`;
    assert.equal(existsSync(archiveFile), true, `missing archived artifact: ${artifact.path}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
  }

  const activeFiles = globSync(
    ["package.json", "tools/**/*.{mjs,js,json,md,sh}", "docs/**/*.md", ".github/**/*.{yml,yaml,json,md,mjs,js,sh}"],
    { exclude: ["**/node_modules/**", ".archive/**", "docs/vnext/phase-0a/**", "CHANGELOG.md"] },
  ).filter((path) => path !== "tools/tests/retired-automation.test.mjs");
  const forbidden = [
    "e2e:validate",
    "e2e:benchmark",
    "e2e:combine",
    ".github/workflows/e2e-validation.yml",
    "tools/scripts/benchmark-e2e.mjs",
    "tools/scripts/combine-e2e-runs.mjs",
    "tools/scripts/validate-e2e-step.mjs",
  ];
  const activeReferences = activeFiles.filter((path) =>
    forbidden.some((marker) => readFileSync(path, "utf8").includes(marker)),
  );
  assert.deepEqual(activeReferences, [], `active E2E retirement references: ${activeReferences.join(", ")}`);
});

test("original APEX workflow prompts remain provenance-only", () => {
  const provenance = JSON.parse(readFileSync(`${promptArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.archivedFrom, "901adcbc4b033c912cfbd198307c44b4979b089e");
  for (const artifact of provenance.artifacts) {
    assert.equal(existsSync(artifact.path), false, `${artifact.path} must stay out of active paths`);
    const archiveFile = `${promptArchivePath}/${artifact.path}`;
    assert.equal(existsSync(archiveFile), true, `missing archived prompt: ${artifact.path}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
  }

  const activeFiles = globSync(
    ["package.json", "tools/**/*.{mjs,js,json,md,sh}", "docs/**/*.md", ".github/**/*.{yml,yaml,json,md,mjs,js,sh}"],
    {
      exclude: [
        "**/node_modules/**",
        ".archive/**",
        "docs/vnext/phase-0a/**",
        "docs/vnext/pre-agent-loop/**",
        "CHANGELOG.md",
        "tools/registry/modernization-ownership.json",
      ],
    },
  ).filter((path) => path !== "tools/tests/retired-automation.test.mjs");
  const forbidden = [
    "tools/apex-prompts/workflow-prompts/",
    "tools/apex-prompts/utility-prompts/as-built-from-azure.prompt.md",
    "tools/apex-prompts/utility-prompts/review-imported-iac.prompt.md",
    ".github/prompts/apex-resume-workflow.prompt.md",
  ];
  const activeReferences = activeFiles.filter((path) =>
    forbidden.some((marker) => readFileSync(path, "utf8").includes(marker)),
  );
  assert.deepEqual(activeReferences, [], `active prompt retirement references: ${activeReferences.join(", ")}`);
});

test("original APEX utilities remain provenance-only", () => {
  const provenance = JSON.parse(readFileSync(`${utilityArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.archivedFrom, "901adcbc4b033c912cfbd198307c44b4979b089e");
  for (const artifact of provenance.artifacts) {
    assert.equal(existsSync(artifact.path), false, `${artifact.path} must stay out of active paths`);
    const archiveFile = `${utilityArchivePath}/${artifact.path}`;
    assert.equal(existsSync(archiveFile), true, `missing archived utility: ${artifact.path}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
  }

  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  for (const command of ["smoke:verify", "export:agent-output-html", "init", "setup", "test:lib-e2e"]) {
    assert.equal(scripts[command], undefined, `${command} must stay retired`);
  }

  const activeFiles = globSync(
    [
      "package.json",
      "tools/**/*.{mjs,js,py,json,md,sh}",
      "tests/**/*.{mjs,js,py,json,md,sh}",
      "docs/**/*.md",
      ".github/**/*.{yml,yaml,json,md,mjs,js,py,sh}",
      "AGENTS.md",
    ],
    {
      exclude: [
        "**/node_modules/**",
        ".archive/**",
        "docs/vnext/phase-0a/**",
        "docs/vnext/pre-agent-loop/**",
        "CHANGELOG.md",
        "tools/registry/modernization-ownership.json",
      ],
    },
  ).filter((path) => path !== "tools/tests/retired-automation.test.mjs");
  const forbidden = provenance.artifacts.map(({ path }) => path);
  const activeReferences = activeFiles.filter((path) =>
    forbidden.some((marker) => readFileSync(path, "utf8").includes(marker)),
  );
  assert.deepEqual(activeReferences, [], `active utility retirement references: ${activeReferences.join(", ")}`);
});

test("stale vNext qualification narrative remains provenance-only", () => {
  const provenance = JSON.parse(readFileSync(`${qualificationArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.archivedFrom, "901adcbc4b033c912cfbd198307c44b4979b089e");
  for (const artifact of provenance.artifacts) {
    assert.equal(existsSync(artifact.path), false, `${artifact.path} must stay out of active qualification paths`);
    const archiveFile = `${qualificationArchivePath}/${artifact.path}`;
    assert.equal(existsSync(archiveFile), true, `missing archived qualification artifact: ${artifact.path}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
  }

  for (const activeContract of [
    "agent-output/vnext-qualification/04-governance-constraints.json",
    "agent-output/vnext-qualification/sku-manifest.json",
    "agent-output/vnext-qualification/sku-manifest.md",
  ]) {
    assert.equal(existsSync(activeContract), true, `missing active qualification contract: ${activeContract}`);
  }
});

test("completed pre-agent maintenance loop remains provenance-only", () => {
  const provenance = JSON.parse(readFileSync(`${preAgentArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.completedCommit, "901adcbc4b033c912cfbd198307c44b4979b089e");
  for (const artifact of provenance.artifacts) {
    assert.equal(existsSync(artifact.path), false, `${artifact.path} must stay retired`);
    const archiveFile = `${preAgentArchivePath}/${artifact.path}`;
    assert.equal(existsSync(archiveFile), true, `missing archived controller artifact: ${artifact.path}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
  }
  assert.equal(existsSync(`${preAgentArchivePath}/docs/vnext/pre-agent-loop/completion-handoff.md`), true);

  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  for (const command of [
    "validate:pre-agent-loop",
    "pre-agent-loop",
    "test:pre-agent-loop",
    "validate:modernization-ownership",
    "test:modernization-ownership",
  ]) {
    assert.equal(scripts[command], undefined, `${command} must stay retired`);
  }
});

test("original APEX compatibility utilities remain provenance-only", () => {
  const provenance = JSON.parse(readFileSync(`${compatibilityArchivePath}/provenance.json`, "utf8"));
  assert.equal(provenance.archivedFrom, "901adcbc4b033c912cfbd198307c44b4979b089e");
  for (const artifact of provenance.artifacts) {
    assert.equal(existsSync(artifact.path), false, `${artifact.path} must stay retired`);
    const archiveFile = `${compatibilityArchivePath}/${artifact.path}`;
    assert.equal(existsSync(archiveFile), true, `missing archived compatibility artifact: ${artifact.path}`);
    assert.equal(textSha256(archiveFile), artifact.sha256);
  }

  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  assert.equal(scripts["assess:agents"], undefined);
  assert.equal(scripts["challenger-telemetry"], undefined);
});
