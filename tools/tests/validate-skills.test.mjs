import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadValidator } from "../scripts/_lib/ajv-validator.mjs";
import { parseFrontmatter } from "../scripts/_lib/parse-frontmatter.mjs";
import {
  applyBaseline,
  checkRetiredSkillConfig,
  collectModelLoadedSkills,
  findRetiredReferences,
  hasBlockingErrors,
  loadBaseBaseline,
  loadRepositoryInputs,
  runSkillValidation,
} from "../scripts/validate-skills.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const validateSchema = loadValidator(
  path.join(repoRoot, "tools/registry/schemas/skill-validation-baseline.schema.json"),
);

function skill(name, frontmatter, { body = "Body.\n", refFiles = [] } = {}) {
  const content = `---\nname: ${name}\n${frontmatter}\n---\n${body}`;
  return [name, { content, frontmatter: parseFrontmatter(content), hasRefs: refFiles.length > 0, refFiles, files: [] }];
}

const description = 'description: "Guides a bounded APEX task with explicit triggers."';
const oversizedBody = "line\n".repeat(220);

function agentsMap() {
  const content = "---\nname: APEX\n---\nLoad `.github/skills/apex-next/SKILL.md` before stage work.\n";
  return new Map([["apex.agent.md", { content, frontmatter: parseFrontmatter(content) }]]);
}

function shippedSkills(overrides = []) {
  return new Map([
    skill("apex-next", `${description}\nuser-invocable: true`, { body: "Route `apex-workflow` tasks.\n" }),
    skill("apex-workflow", `${description}\nuser-invocable: false`),
    skill("apex-azure-diagnostics", `${description}\nuser-invocable: false`),
    ...overrides,
  ]);
}

function emptyBaseline(entries = []) {
  return { schemaVersion: "1.0.0", policy: "Shrink-only.", entries };
}

function entry(skillName, rule, root = "shipped") {
  return { root, skill: skillName, rule, violation: "pre-existing", recorded: "2026-10-08", tracking: "#401" };
}

function run({ shipped = shippedSkills(), authoring = new Map(), baseline = emptyBaseline(), ...rest } = {}) {
  return runSkillValidation({
    roots: [
      { id: "shipped", skills: shipped },
      { id: "authoring", skills: authoring },
    ],
    agents: agentsMap(),
    instructions: new Map(),
    baseline,
    validateSchema,
    retiredSkills: [],
    ...rest,
  });
}

const rules = (findings, root) =>
  findings.filter((item) => root === undefined || item.root === root).map((item) => `${item.rule}:${item.skill}`);

test("validates shipped and authoring roots with explicit per-root rules", () => {
  const { findings } = run({
    shipped: shippedSkills([skill("apex-big", `${description}\nuser-invocable: false`, { body: oversizedBody })]),
    authoring: new Map([
      skill("docs-writer", description),
      skill("big-authoring", description, { body: oversizedBody }),
    ]),
  });

  assert.deepEqual(rules(findings, "shipped"), ["skill-size-without-references:apex-big"]);
  assert.deepEqual(rules(findings, "authoring"), ["skill-size-without-references:big-authoring"]);
  assert.equal(hasBlockingErrors(findings), true);
});

test("shipped skills must declare user-invocable explicitly; authoring skills need not", () => {
  const { findings } = run({
    shipped: shippedSkills([
      skill("apex-missing", description),
      skill("apex-bad-value", `${description}\nuser-invocable: sometimes`),
    ]),
    authoring: new Map([skill("docs-writer", description)]),
  });

  assert.deepEqual(rules(findings).sort(), [
    "skill-user-invocable-explicit:apex-bad-value",
    "skill-user-invocable-explicit:apex-missing",
  ]);
});

test("routed skills reject disable-model-invocation: true; other skills may set it", () => {
  const routed = "user-invocable: false\ndisable-model-invocation: true";
  const { findings } = run({
    shipped: new Map([
      skill("apex-next", `${description}\nuser-invocable: true`, { body: "Route `apex-workflow` tasks.\n" }),
      skill("apex-workflow", `${description}\n${routed}`),
      skill("apex-manual", `${description}\n${routed}`),
      skill("apex-azure-diagnostics", `${description}\nuser-invocable: false`),
    ]),
  });

  assert.deepEqual(rules(findings), ["skill-model-invocation-routed:apex-workflow"]);
});

test("invocation fields are read as YAML, so inline comments and quoting are interpreted", () => {
  const { findings } = run({
    shipped: new Map([
      skill("apex-next", `${description}\nuser-invocable: true`, { body: "Route `apex-workflow` tasks.\n" }),
      skill(
        "apex-workflow",
        `${description}\nuser-invocable: false # hidden\ndisable-model-invocation: true # manual-only`,
      ),
      skill("apex-quoted", `${description}\nuser-invocable: "true"`),
      skill("apex-commented", `${description}\nuser-invocable: false # hidden stage skill`),
    ]),
  });
  assert.deepEqual(rules(findings).sort(), [
    "skill-model-invocation-routed:apex-workflow",
    "skill-user-invocable-explicit:apex-quoted",
  ]);
});

test("invalid shipped frontmatter YAML is reported", () => {
  const { findings } = run({
    shipped: shippedSkills([skill("apex-broken", `${description}\nuser-invocable: [true`)]),
  });
  assert.deepEqual(rules(findings), ["skill-frontmatter-yaml:apex-broken"]);
});

test("model-loaded skills come from shipped agent paths and apex-next routing", () => {
  const skills = shippedSkills([skill("apex-unrouted", description)]);
  const loaded = collectModelLoadedSkills({ agents: agentsMap(), skills });
  assert.deepEqual([...loaded].sort(), ["apex-next", "apex-workflow"]);
});

test("a missing router skill is a configuration error", () => {
  const shipped = new Map([skill("apex-workflow", `${description}\nuser-invocable: false`)]);
  const { findings } = run({ shipped, retiredSkills: [] });
  assert.deepEqual(rules(findings), ["config-stale-entry:null"]);
  assert.match(findings[0].message, /ROUTER_SKILL "apex-next"/);
});

test("stale allowlist entries fail", () => {
  const { findings } = run({
    nonSkillRedirects: { shipped: ["apex-workflow", "unused-tool MCP"], authoring: [] },
  });
  const messages = findings.filter((item) => item.rule === "config-stale-entry").map((item) => item.message);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /"apex-workflow" names a real skill/);
  assert.match(messages[1], /"unused-tool MCP" is not used/);
  assert.equal(hasBlockingErrors(findings), true);

  const retired = checkRetiredSkillConfig(
    [
      { old: "apex-workflow", replacements: ["apex-azure-diagnostics"], since: "test" },
      { old: "azure-troubleshooting", replacements: ["azure-diagnostics"], since: "test" },
    ],
    new Map([["shipped", new Set(["apex-workflow", "apex-azure-diagnostics"])]]),
  );
  assert.deepEqual(
    retired.map((item) => item.message),
    [
      'RETIRED_SKILLS entry "apex-workflow" is still a current skill; remove the entry or the skill',
      'RETIRED_SKILLS replacement "azure-diagnostics" for "azure-troubleshooting" is not a current skill in any root',
    ],
  );
});

test("redirects resolve only within the same root or to agents", () => {
  const { findings } = run({
    shipped: shippedSkills([
      skill("apex-redirect", `description: "Guides APEX tasks. (use docs-writer)"\nuser-invocable: false`),
    ]),
    authoring: new Map([
      skill("docs-writer", 'description: "Writes repository docs. (use apex)"'),
      skill("mermaid", 'description: "Draws inline diagrams. (use docs-writer)"'),
    ]),
  });
  assert.deepEqual(rules(findings), ["skill-redirect-missing-target:apex-redirect"]);
});

test("baselined violations pass and are reported", () => {
  const { findings, entries } = run({
    shipped: shippedSkills([skill("apex-missing", description)]),
    baseline: emptyBaseline([entry("apex-missing", "skill-user-invocable-explicit")]),
  });
  assert.equal(entries.length, 1);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].baselined.tracking, "#401");
  assert.equal(hasBlockingErrors(findings), false);
});

test("a new violation not in the baseline fails", () => {
  const { findings } = run({
    shipped: shippedSkills([skill("apex-missing", description), skill("apex-new", description)]),
    baseline: emptyBaseline([entry("apex-missing", "skill-user-invocable-explicit")]),
  });
  const blocking = findings.filter((item) => item.severity === "error" && !item.baselined);
  assert.deepEqual(rules(blocking), ["skill-user-invocable-explicit:apex-new"]);
  assert.equal(hasBlockingErrors(findings), true);
});

test("a baseline entry that is no longer needed fails", () => {
  const { findings } = run({
    baseline: emptyBaseline([entry("apex-workflow", "skill-user-invocable-explicit")]),
  });
  assert.deepEqual(rules(findings), ["baseline-entry-unused:null"]);
  assert.match(findings[0].message, /shrink-only/);
  assert.equal(hasBlockingErrors(findings), true);
});

test("a new violation and its baseline entry added together fail", () => {
  const baseBaseline = emptyBaseline([entry("apex-missing", "skill-user-invocable-explicit")]);
  const { findings, entries } = run({
    shipped: shippedSkills([skill("apex-missing", description), skill("apex-new", description)]),
    baseline: emptyBaseline([
      entry("apex-missing", "skill-user-invocable-explicit"),
      entry("apex-new", "skill-user-invocable-explicit"),
    ]),
    baseBaseline,
  });
  assert.deepEqual(
    entries.map((item) => item.skill),
    ["apex-missing"],
  );
  const blocking = findings.filter((item) => item.severity === "error" && !item.baselined);
  assert.deepEqual(rules(blocking).sort(), ["baseline-entry-added:null", "skill-user-invocable-explicit:apex-new"]);
  assert.equal(hasBlockingErrors(findings), true);

  const shrunk = run({
    shipped: shippedSkills([skill("apex-missing", description)]),
    baseline: emptyBaseline([entry("apex-missing", "skill-user-invocable-explicit")]),
    baseBaseline: emptyBaseline([
      entry("apex-missing", "skill-user-invocable-explicit"),
      entry("apex-workflow", "skill-user-invocable-explicit"),
    ]),
  });
  assert.equal(hasBlockingErrors(shrunk.findings), false);
});

test("the base baseline comes from the merge base and fails closed in CI", () => {
  const baseline = emptyBaseline([entry("apex-missing", "skill-user-invocable-explicit")]);
  const calls = [];
  const found = loadBaseBaseline({
    env: { GITHUB_BASE_REF: "main" },
    git: (args) => {
      calls.push(args.join(" "));
      if (args[0] === "merge-base") return "abc123\n";
      return args[0] === "show" ? JSON.stringify(baseline) : "";
    },
  });
  assert.deepEqual(calls, [
    "merge-base HEAD origin/main",
    "cat-file -e abc123:tools/registry/skill-validation-baseline.json",
    "show abc123:tools/registry/skill-validation-baseline.json",
  ]);
  assert.deepEqual(found.baseBaseline, baseline);
  assert.deepEqual(found.findings, []);

  const introducing = loadBaseBaseline({
    env: { SKILL_BASELINE_BASE_REF: "upstream/main" },
    git: (args) => {
      if (args[0] === "merge-base") return "def456\n";
      throw new Error("missing");
    },
  });
  assert.equal(introducing.baseBaseline, null);
  assert.equal(introducing.revision, "def456");

  const unreachable = (env) =>
    loadBaseBaseline({
      env,
      git: () => {
        throw new Error("no ref");
      },
    }).findings[0];
  assert.equal(unreachable({ GITHUB_ACTIONS: "true" }).severity, "error");
  assert.equal(unreachable({}).severity, "warn");
  assert.equal(unreachable({}).rule, "baseline-base-unavailable");
});

test("baseline entries for unknown skills, roots, rules or non-baselinable rules fail", () => {
  const { findings } = run({
    authoring: new Map([skill("docs-writer", description)]),
    baseline: emptyBaseline([
      entry("azure-adr", "skill-size-without-references"),
      entry("apex-workflow", "skill-not-a-rule"),
      entry("apex-workflow", "skill-reference-orphaned"),
      entry("docs-writer", "skill-user-invocable-explicit", "authoring"),
    ]),
  });
  const messages = findings.map((item) => `${item.rule}: ${item.message}`);
  assert.equal(messages.length, 4);
  assert.match(messages[0], /baseline-invalid: .*skill "azure-adr" that does not exist in the shipped root/);
  assert.match(messages[1], /baseline-invalid: .*unknown rule "skill-not-a-rule"/);
  assert.match(messages[2], /baseline-invalid: .*"skill-reference-orphaned" cannot be baselined for the shipped root/);
  assert.match(
    messages[3],
    /baseline-invalid: .*"skill-user-invocable-explicit" cannot be baselined for the authoring root/,
  );
});

test("duplicate or schema-invalid baselines fail without suppressing findings", () => {
  const duplicate = run({
    shipped: shippedSkills([skill("apex-missing", description)]),
    baseline: emptyBaseline([
      entry("apex-missing", "skill-user-invocable-explicit"),
      entry("apex-missing", "skill-user-invocable-explicit"),
    ]),
  });
  assert.ok(duplicate.findings.some((item) => /duplicate baseline entry/.test(item.message)));

  const invalid = applyBaseline({
    findings: [
      {
        rule: "skill-user-invocable-explicit",
        severity: "error",
        root: "shipped",
        skill: "apex-missing",
        message: "x",
      },
    ],
    baseline: {
      schemaVersion: "1.0.0",
      policy: "p",
      entries: [{ ...entry("apex-missing", "skill-user-invocable-explicit"), recorded: "yesterday" }],
    },
    validateSchema,
    skillNamesByRoot: new Map([["shipped", new Set(["apex-missing"])]]),
  });
  assert.equal(invalid.entries.length, 0);
  assert.equal(invalid.findings[0].baselined, undefined);
  assert.equal(invalid.findings[1].rule, "baseline-invalid");
});

test("retired skill names are reported with their location", () => {
  const findings = findRetiredReferences("docs/example.md", "ok\nuse azure-troubleshooting here\n");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /^docs\/example\.md:2: stale reference to "azure-troubleshooting"/);
});

test("the committed skills pass with the committed baseline", () => {
  const cwd = process.cwd();
  process.chdir(repoRoot);
  try {
    const inputs = loadRepositoryInputs();
    assert.deepEqual(
      inputs.roots.map((root) => root.dir),
      ["customizations/.github/skills", ".github/skills"],
    );
    assert.ok(inputs.roots.every((root) => root.skills.size > 0));
    const { findings } = runSkillValidation(inputs);
    assert.deepEqual(
      findings.filter((item) => item.severity === "error" && !item.baselined).map((item) => item.message),
      [],
    );
  } finally {
    process.chdir(cwd);
  }
});
