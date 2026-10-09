import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectArtifactSourceInputs, validateArtifactSourceInputs } from "../scripts/validate-artifacts.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const assetPath = ".github/skills/apex-artifacts/templates/requirements.md";
const current = () => structuredClone(collectArtifactSourceInputs(root));
const expectedHeadings = [
  "Project Overview",
  "Functional Requirements",
  "Non-Functional Requirements",
  "Security And Compliance",
  "Budget And Operations",
  "Regional And Residency Constraints",
  "Assumptions",
  "Unknowns And Deferrals",
  "Architecture Handoff",
];

test("current template matches the golden shape and pure validation leaves inputs unchanged", () => {
  const inputs = current();
  const before = structuredClone(inputs);
  assert.deepEqual(
    inputs.template.text
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3)),
    expectedHeadings,
  );
  assert.deepEqual(validateArtifactSourceInputs(inputs), []);
  assert.deepEqual(inputs, before);
  assert.equal(inputs.registry["governance-constraints"].sourceAvailability, "unavailable");
  assert.equal(inputs.registry["architecture-assessment"].templateAvailability, "reference-only");
});

for (const [name, mutate, diagnostic] of [
  [
    "missing slot",
    (x) => {
      x.template.text = x.template.text.replace("{environment}", "none");
    },
    /exactly one \{environment\}/u,
  ],
  [
    "duplicate slot",
    (x) => {
      x.template.text += "\n{environment}\n";
    },
    /exactly one \{environment\}/u,
  ],
  [
    "unknown slot",
    (x) => {
      x.template.text += "\n{unexpected}\n";
    },
    /unknown slot/u,
  ],
  [
    "duplicate H1",
    (x) => {
      x.template.text += "\n# Duplicate\n";
    },
    /one H1/u,
  ],
  [
    "duplicate H2",
    (x) => {
      x.template.text += "\n## Project Overview\n";
    },
    /unique ordered H2/u,
  ],
  [
    "unmanaged template",
    (x) => {
      x.manifest.plugin.files = x.manifest.plugin.files.filter((name) => name !== assetPath);
    },
    /plugin manifest entry/u,
  ],
  [
    "missing template",
    (x) => {
      delete x.template;
    },
    /source is missing/u,
  ],
  [
    "unavailable requirements",
    (x) => {
      x.registry.requirements.sourceAvailability = "unavailable";
    },
    /availability/u,
  ],
  [
    "reference-only requirements",
    (x) => {
      x.registry.requirements.templateAvailability = "reference-only";
    },
    /availability/u,
  ],
  [
    "wrong renderer",
    (x) => {
      x.registry.requirements.renderer = "unavailable";
    },
    /renderer/u,
  ],
  [
    "registry slot drift",
    (x) => {
      x.registry.requirements.template.slots = ["wrong"];
    },
    /registry slots/u,
  ],
  ...["/tmp/template.md", "../template.md", ".github/../template.md", "C:\\template.md"].map((name) => [
    `path escape ${name}`,
    (x) => {
      x.registry.requirements.template.assetPath = name;
    },
    /safe and relative/u,
  ]),
]) {
  test(`rejects ${name} without mutating inputs`, () => {
    const inputs = current();
    mutate(inputs);
    const before = structuredClone(inputs);
    assert.match(validateArtifactSourceInputs(inputs).join("\n"), diagnostic);
    assert.deepEqual(inputs, before);
  });
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "apex-artifact-source-"));
  mkdirSync(path.join(directory, "customizations", path.dirname(assetPath)), { recursive: true });
  cpSync(path.join(root, "customizations/manifest.json"), path.join(directory, "customizations/manifest.json"));
  cpSync(path.join(root, "customizations", assetPath), path.join(directory, "customizations", assetPath));
  return directory;
}

test("collects current sources with no root Azure templates or installed state, without writing files", () => {
  const directory = fixture();
  try {
    const filename = path.join(directory, "customizations", assetPath);
    const bytes = readFileSync(filename);
    assert.deepEqual(validateArtifactSourceInputs(collectArtifactSourceInputs(directory)), []);
    assert.deepEqual(readFileSync(filename), bytes);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("missing and invalid manifest/source fail explicitly", () => {
  const directory = fixture();
  try {
    const filename = path.join(directory, "customizations", assetPath);
    rmSync(filename);
    assert.throws(() => collectArtifactSourceInputs(directory), /ENOENT/u);
    writeFileSync(path.join(directory, "customizations/manifest.json"), "{invalid");
    assert.throws(() => collectArtifactSourceInputs(directory), SyntaxError);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("rejects symlink templates and parent directories", () => {
  const directory = fixture();
  try {
    const filename = path.join(directory, "customizations", assetPath);
    rmSync(filename);
    symlinkSync(path.join(root, "customizations", assetPath), filename);
    assert.throws(() => collectArtifactSourceInputs(directory), /must not use symlinks/u);
    rmSync(path.join(directory, "customizations"), { recursive: true });
    symlinkSync(path.join(root, "customizations"), path.join(directory, "customizations"));
    assert.throws(() => collectArtifactSourceInputs(directory), /must not use symlinks/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("CLI rejects unknown and retired mutation arguments without changing the template", () => {
  const filename = path.join(root, "customizations", assetPath);
  const before = readFileSync(filename);
  for (const args of [["--fix", filename], ["project"], ["--format=json"]]) {
    const result = spawnSync(process.execPath, [path.join(root, "tools/scripts/validate-artifacts.mjs"), ...args], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /Unknown arguments/u);
  }
  assert.deepEqual(readFileSync(filename), before);
});
