import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ARTIFACT_HEADINGS } from "../scripts/_lib/artifact-headings.mjs";
import {
  buildArtifactHeadings,
  renderArtifactHeadingsModule,
  renderArtifactHeadingsSummary,
  validateArtifactHeadingSources,
} from "../scripts/_lib/artifact-heading-generator.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("canonical templates reproduce the existing artifact heading contract", () => {
  const generated = buildArtifactHeadings(repoRoot);
  assert.deepEqual(
    generated,
    Object.fromEntries(Object.entries(ARTIFACT_HEADINGS).sort(([left], [right]) => left.localeCompare(right))),
  );
  assert.deepEqual(generated["00-handoff.md"], [
    "## Completed Steps",
    "## Key Decisions",
    "## Open Challenger Findings (must_fix only)",
    "## Context for Next Step",
    "## Skill Context",
    "## Artifacts",
  ]);
});

test("artifact heading rendering is deterministic", async () => {
  const generated = buildArtifactHeadings(repoRoot);
  const firstModule = await renderArtifactHeadingsModule(generated);
  const regenerated = buildArtifactHeadings(repoRoot);
  const secondModule = await renderArtifactHeadingsModule(regenerated);
  assert.equal(firstModule, secondModule);
  assert.equal(renderArtifactHeadingsSummary(generated), renderArtifactHeadingsSummary(regenerated));
  assert.equal(
    renderArtifactHeadingsSummary(generated),
    readFileSync(resolve(repoRoot, "tools/scripts/_lib/artifact-headings-summary.json"), "utf8"),
  );
});

test("template heading mutations change generated metadata", () => {
  const baseline = buildArtifactHeadings(repoRoot);
  const mutated = buildArtifactHeadings(repoRoot, (path, encoding) => {
    const text = readFileSync(path, encoding);
    return path.endsWith("01-requirements.template.md")
      ? text.replace("## 🎯 Project Overview", "## 🎯 Mutated Project Overview")
      : text;
  });
  assert.notDeepEqual(mutated, baseline);
  assert.equal(mutated["01-requirements.md"][0], "## 🎯 Mutated Project Overview");
});

test("duplicate required template headings fail generation", () => {
  assert.throws(
    () =>
      buildArtifactHeadings(repoRoot, (path, encoding) => {
        const text = readFileSync(path, encoding);
        return path.endsWith("01-requirements.template.md")
          ? text.replace("## 🚀 Functional Requirements", "## 🎯 Project Overview")
          : text;
      }),
    /duplicate required H2 headings/,
  );
});

test("an artifact cannot have both template and non-template heading sources", () => {
  assert.throws(
    () =>
      validateArtifactHeadingSources(
        { "fixture.md": "templates/fixture.md" },
        { "fixture.md": ["## Fixture"] },
        { "fixture.md": [] },
      ),
    /heading sources overlap: fixture\.md/,
  );
});
