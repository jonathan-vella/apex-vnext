#!/usr/bin/env node
/**
 * Skill Validators
 *
 * Validates two skill roots with explicit per-root rules:
 *   - shipped   `customizations/.github/skills/` — projected into the Agent Plugin (primary)
 *   - authoring `.github/skills/` — the repository's own maintenance skills (never shipped)
 * plus repository-wide checks (instruction references, retired skill names).
 *
 * Pre-existing error findings are suppressed only by explicit, dated entries in
 * `tools/registry/skill-validation-baseline.json`. The baseline is shrink-only:
 * an entry whose violation no longer occurs, that names an unknown root, skill
 * or rule, or that is absent from the baseline at the merge base with the
 * target branch fails validation. Warnings are never baselined.
 *
 * @example
 * node tools/scripts/validate-skills.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { load as loadYaml } from "js-yaml";
import { getAgents, getSkills, getInstructions } from "./_lib/workspace-index.mjs";
import { getRawFrontmatter } from "./_lib/parse-frontmatter.mjs";
import { loadValidator } from "./_lib/ajv-validator.mjs";
import { MAX_SKILL_LINES_WITHOUT_REFS, SKILLS_DIR, SHIPPED_SKILLS_DIR, INSTRUCTIONS_DIR } from "./_lib/paths.mjs";

export const BASELINE_PATH = "tools/registry/skill-validation-baseline.json";
export const BASELINE_SCHEMA_PATH = "tools/registry/schemas/skill-validation-baseline.schema.json";

export const SKILL_ROOTS = [
  { id: "shipped", dir: SHIPPED_SKILLS_DIR, label: "Shipped skills (Agent Plugin)" },
  { id: "authoring", dir: SKILLS_DIR, label: "Repository authoring skills" },
];

const ALL_ROOTS = SKILL_ROOTS.map((root) => root.id);
const SHIPPED_ONLY = ["shipped"];
const REPOSITORY = [];

/**
 * Rule catalog. `roots` lists the skill roots a rule applies to; an empty list
 * marks a repository-wide or configuration rule. Only `baselinable` rules can
 * be suppressed by a baseline entry.
 */
export const RULES = {
  "skill-frontmatter-missing": { severity: "error", roots: ALL_ROOTS, baselinable: true },
  "skill-description-missing": { severity: "error", roots: ALL_ROOTS, baselinable: true },
  "skill-description-block-scalar": { severity: "error", roots: ALL_ROOTS, baselinable: true },
  "skill-description-max-length": { severity: "error", roots: ALL_ROOTS, baselinable: true },
  "skill-description-recommended-length": { severity: "warn", roots: ALL_ROOTS, baselinable: false },
  "skill-description-too-short": { severity: "warn", roots: ALL_ROOTS, baselinable: false },
  "skill-name-mismatch": { severity: "error", roots: ALL_ROOTS, baselinable: true },
  "skill-deprecated-pattern": { severity: "warn", roots: ALL_ROOTS, baselinable: false },
  "skill-deprecated-json": { severity: "warn", roots: ALL_ROOTS, baselinable: false },
  "skill-size-without-references": { severity: "error", roots: ALL_ROOTS, baselinable: true },
  "skill-size-with-references": { severity: "warn", roots: ALL_ROOTS, baselinable: false },
  "skill-reference-orphaned": { severity: "warn", roots: ALL_ROOTS, baselinable: false },
  "skill-redirect-missing-target": { severity: "error", roots: ALL_ROOTS, baselinable: true },
  "skill-frontmatter-yaml": { severity: "error", roots: SHIPPED_ONLY, baselinable: true },
  "skill-user-invocable-explicit": { severity: "error", roots: SHIPPED_ONLY, baselinable: true },
  "skill-model-invocation-routed": { severity: "error", roots: SHIPPED_ONLY, baselinable: true },
  "instruction-reference-orphaned": { severity: "warn", roots: REPOSITORY, baselinable: false },
  "retired-skill-reference": { severity: "error", roots: REPOSITORY, baselinable: false },
  "config-stale-entry": { severity: "error", roots: REPOSITORY, baselinable: false },
  "baseline-invalid": { severity: "error", roots: REPOSITORY, baselinable: false },
  "baseline-entry-unused": { severity: "error", roots: REPOSITORY, baselinable: false },
  "baseline-entry-added": { severity: "error", roots: REPOSITORY, baselinable: false },
  // Downgraded to a warning outside GitHub Actions.
  "baseline-base-unavailable": { severity: "error", roots: REPOSITORY, baselinable: false },
};

const FORBIDDEN_FRONTMATTER_PATTERNS = [
  {
    rule: "skill-description-block-scalar",
    pattern: /^description:\s*[>|][-\s]*$/m,
    message: "description uses a YAML block scalar (>, >-, | or |-). Use a single-line inline string instead.",
  },
];

const DEPRECATED_PATTERNS = [
  { pattern: /skill-version:\s*beta/i, message: "skill-version: beta is deprecated, remove for GA" },
  { pattern: /\.skill\.json/i, message: ".skill.json files are deprecated, use SKILL.md frontmatter" },
];

/**
 * Non-skill, non-agent targets that may appear in `(use ...)` description
 * redirects, per root. Every entry must be used by a description in that root
 * and must not shadow a real skill name, so stale entries cannot linger.
 */
export const NON_SKILL_REDIRECTS = { shipped: [], authoring: [] };

/** Retired skill names. Every replacement must be a current skill in some root. */
export const RETIRED_SKILLS = [
  {
    old: "azure-troubleshooting",
    replacements: ["apex-azure-diagnostics", "azure-diagnostics"],
    since: "Issue #240 — Azure Skills Plugin integration",
  },
];

/**
 * Sources that make a shipped skill model-loaded: the shipped agents (the
 * APEX agent and its hidden workers) and the `apex-next` router skill. Such
 * skills must stay model-loadable (no `disable-model-invocation: true`).
 */
export const ROUTER_SKILL = "apex-next";

const RETIRED_SCAN_DIRS = [".github", "customizations", "docs"];
const RETIRED_SCAN_ROOT_FILES = ["AGENTS.md", "CHANGELOG.md", "README.md"];
const RETIRED_SCAN_SKIP_PATTERNS = [/node_modules/, /\.git\//, /site\//, /\.venv/, /PLUGIN_VERSION\.md/, /migration\//];
const RETIRED_SCAN_EXTENSIONS = new Set([
  ".md",
  ".json",
  ".jsonc",
  ".mjs",
  ".js",
  ".ts",
  ".yml",
  ".yaml",
  ".sh",
  ".ps1",
  ".py",
  ".txt",
]);

function finding(rule, root, skill, message, file) {
  const result = { rule, severity: RULES[rule].severity, root, skill, message };
  if (file) result.file = file;
  return result;
}

function listSkillJsonFiles(skill) {
  if (Array.isArray(skill.files)) return skill.files.filter((file) => file.endsWith(".skill.json"));
  if (!skill.dir || !fs.existsSync(skill.dir)) return [];
  return fs.readdirSync(skill.dir).filter((file) => file.endsWith(".skill.json"));
}

// ============================================================================
// Per-root checks
// ============================================================================

/** Frontmatter, description, deprecated-pattern and size rules (all roots). */
export function checkFormat(rootId, skills) {
  const findings = [];
  for (const [skillName, skill] of skills) {
    const { content, frontmatter, hasRefs, refFiles = [] } = skill;
    const file = skill.dir ? path.join(skill.dir, "SKILL.md") : undefined;

    if (!frontmatter) {
      findings.push(finding("skill-frontmatter-missing", rootId, skillName, "No frontmatter found in SKILL.md", file));
      continue;
    }

    if (!frontmatter.description) {
      findings.push(
        finding("skill-description-missing", rootId, skillName, "Missing required frontmatter field 'description'"),
      );
    }

    const rawFrontmatter = getRawFrontmatter(content);
    for (const { rule, pattern, message } of FORBIDDEN_FRONTMATTER_PATTERNS) {
      if (pattern.test(rawFrontmatter)) findings.push(finding(rule, rootId, skillName, message));
    }

    for (const { pattern, message } of DEPRECATED_PATTERNS) {
      if (pattern.test(content)) findings.push(finding("skill-deprecated-pattern", rootId, skillName, message));
    }

    const jsonFiles = listSkillJsonFiles(skill);
    if (jsonFiles.length > 0) {
      findings.push(
        finding(
          "skill-deprecated-json",
          rootId,
          skillName,
          `Found deprecated .skill.json file(s): ${jsonFiles.join(", ")}`,
        ),
      );
    }

    if (frontmatter.name && frontmatter.name !== skillName) {
      findings.push(
        finding(
          "skill-name-mismatch",
          rootId,
          skillName,
          `Frontmatter 'name' ("${frontmatter.name}") does not match directory name ("${skillName}")`,
        ),
      );
    }

    // Description length cap — see
    // customizations/.github/instructions/apex-agent-authoring.instructions.md
    if (frontmatter.description) {
      const length = frontmatter.description.length;
      if (length < 10) {
        findings.push(
          finding("skill-description-too-short", rootId, skillName, `Description is too short (${length} chars)`),
        );
      }
      if (length > 500) {
        findings.push(
          finding(
            "skill-description-max-length",
            rootId,
            skillName,
            `description is ${length} chars (max 500). Keep WHEN keywords + short anti-scope; move detail into the body.`,
          ),
        );
      } else if (length > 400) {
        findings.push(
          finding(
            "skill-description-recommended-length",
            rootId,
            skillName,
            `description is ${length} chars (recommend ≤ 400)`,
          ),
        );
      }
    }

    const lineCount = content.split("\n").length;
    if (lineCount > MAX_SKILL_LINES_WITHOUT_REFS && !hasRefs) {
      findings.push(
        finding(
          "skill-size-without-references",
          rootId,
          skillName,
          `SKILL.md is ${lineCount} lines (>${MAX_SKILL_LINES_WITHOUT_REFS}) without references/`,
          file,
        ),
      );
    } else if (lineCount > MAX_SKILL_LINES_WITHOUT_REFS) {
      findings.push(
        finding(
          "skill-size-with-references",
          rootId,
          skillName,
          `SKILL.md is ${lineCount} lines (>${MAX_SKILL_LINES_WITHOUT_REFS}) but has ${refFiles.length} reference files`,
        ),
      );
    }
  }
  return findings;
}

/** Every `references/*.md` file must be reachable from an agent, instruction or same-root skill. */
export function checkReferences(rootId, skills, searchableContent) {
  const findings = [];
  for (const [skillName, info] of skills) {
    if (!info.hasRefs) continue;
    for (const refFile of info.refFiles) {
      const refRelPath = `${skillName}/references/${refFile}`;
      const refName = refFile.replace(/\.md$/, "");
      const isReferenced =
        searchableContent.includes(refRelPath) ||
        searchableContent.includes(`references/${refFile}`) ||
        searchableContent.includes(`${skillName}/references/${refName}`);
      if (!isReferenced) {
        findings.push(
          finding(
            "skill-reference-orphaned",
            rootId,
            skillName,
            `${refRelPath} is not referenced by any agent, skill, or instruction`,
            info.dir ? path.join(info.dir, "references", refFile) : undefined,
          ),
        );
      }
    }
  }
  return findings;
}

/** Derive valid agent redirect targets from agent file IDs and normalized role names. */
export function agentRedirectNames(agents) {
  const names = new Set();
  for (const [file, agent] of agents) {
    names.add(file.replace(/\.agent\.md$/, ""));
    const roleName = agent.frontmatter?.name;
    if (typeof roleName === "string") {
      names.add(
        roleName
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, "-")
          .replaceAll(/^-|-$/g, ""),
      );
    }
  }
  return names;
}

// Digit-prefixed agent ids like "03-architect" and an optional " MCP" suffix are allowed.
const REDIRECT_PATTERN = /\(use\s+([a-z0-9][a-z0-9-]*(?:\s+MCP)?)\)/gi;

/**
 * `(use foo)` redirects in descriptions must name a skill in the same root, an
 * agent, or an explicit non-skill target. Allowlist entries must be in use and
 * must not shadow a skill name.
 */
export function checkRedirects(rootId, skills, agentNames, nonSkillRedirects = []) {
  const findings = [];
  const allowlist = new Set(nonSkillRedirects);
  const used = new Set();

  for (const [skillName, skill] of skills) {
    const description = skill.frontmatter?.description;
    if (!description) continue;
    for (const match of description.matchAll(REDIRECT_PATTERN)) {
      const target = match[1].trim();
      if (allowlist.has(target)) {
        used.add(target);
        continue;
      }
      if (target === skillName || skills.has(target) || agentNames.has(target)) continue;
      findings.push(
        finding(
          "skill-redirect-missing-target",
          rootId,
          skillName,
          `frontmatter description references missing skill/agent "${target}" — fix the (use ${target}) redirect`,
        ),
      );
    }
  }

  for (const entry of allowlist) {
    if (skills.has(entry) || agentNames.has(entry)) {
      findings.push(
        finding(
          "config-stale-entry",
          "repository",
          null,
          `NON_SKILL_REDIRECTS.${rootId} entry "${entry}" names a real skill or agent; remove it`,
        ),
      );
    } else if (!used.has(entry)) {
      findings.push(
        finding(
          "config-stale-entry",
          "repository",
          null,
          `NON_SKILL_REDIRECTS.${rootId} entry "${entry}" is not used by any ${rootId} skill description; remove it`,
        ),
      );
    }
  }
  return findings;
}

const SKILL_PATH_PATTERN = /skills\/([a-z0-9][a-z0-9-]*)\/SKILL\.md/g;
const BACKTICK_NAME_PATTERN = /`([a-z0-9][a-z0-9-]*)`/g;

/**
 * Shipped skills the APEX agent, its hidden workers or the router skill load:
 * `skills/<name>/SKILL.md` paths and backticked skill names in those sources.
 */
export function collectModelLoadedSkills({ agents, skills, routerSkill = ROUTER_SKILL }) {
  const loaded = new Set();
  const sources = [...agents.values()].map((agent) => agent.content);
  const router = skills.get(routerSkill);
  if (router) {
    loaded.add(routerSkill);
    sources.push(router.content);
  }
  for (const source of sources) {
    for (const pattern of [SKILL_PATH_PATTERN, BACKTICK_NAME_PATTERN]) {
      for (const match of source.matchAll(pattern)) {
        if (skills.has(match[1])) loaded.add(match[1]);
      }
    }
  }
  return loaded;
}

/**
 * Shipped-only invocation consistency (maintainer decision 2026-10-07): every
 * shipped skill declares `user-invocable` explicitly as a YAML boolean, and
 * skills loaded by the APEX agent, its workers or `apex-next` routing stay
 * model-loadable. Fields are read with a YAML parser (as the plugin build
 * does), so inline comments and quoting are interpreted correctly.
 */
export function checkInvocation(rootId, skills, modelLoadedSkills) {
  const findings = [];
  for (const [skillName, skill] of skills) {
    if (!skill.frontmatter) continue;
    let frontmatter;
    try {
      frontmatter = loadYaml(getRawFrontmatter(skill.content));
    } catch (error) {
      findings.push(
        finding("skill-frontmatter-yaml", rootId, skillName, `frontmatter is not valid YAML: ${error.reason ?? error}`),
      );
      continue;
    }
    if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
      findings.push(finding("skill-frontmatter-yaml", rootId, skillName, "frontmatter must be a YAML mapping"));
      continue;
    }
    if (!Object.hasOwn(frontmatter, "user-invocable")) {
      findings.push(
        finding(
          "skill-user-invocable-explicit",
          rootId,
          skillName,
          "frontmatter must declare 'user-invocable' explicitly (true or false)",
        ),
      );
    } else if (typeof frontmatter["user-invocable"] !== "boolean") {
      findings.push(
        finding(
          "skill-user-invocable-explicit",
          rootId,
          skillName,
          `'user-invocable' must be a YAML boolean (got ${JSON.stringify(frontmatter["user-invocable"])})`,
        ),
      );
    }
    if (modelLoadedSkills.has(skillName) && frontmatter["disable-model-invocation"] === true) {
      findings.push(
        finding(
          "skill-model-invocation-routed",
          rootId,
          skillName,
          "skill is loaded by the APEX agent, a hidden worker or apex-next routing; 'disable-model-invocation: true' would stop it auto-loading",
        ),
      );
    }
  }
  return findings;
}

/** Runs every rule that applies to one skill root. */
export function validateSkillRoot({ rootId, skills, agents, searchableContent, nonSkillRedirects = [] }) {
  const findings = [
    ...checkFormat(rootId, skills),
    ...checkReferences(rootId, skills, searchableContent),
    ...checkRedirects(rootId, skills, agentRedirectNames(agents), nonSkillRedirects),
  ];
  if (RULES["skill-user-invocable-explicit"].roots.includes(rootId)) {
    if (!skills.has(ROUTER_SKILL)) {
      findings.push(
        finding(
          "config-stale-entry",
          "repository",
          null,
          `ROUTER_SKILL "${ROUTER_SKILL}" does not exist in the ${rootId} skill root`,
        ),
      );
    }
    findings.push(...checkInvocation(rootId, skills, collectModelLoadedSkills({ agents, skills })));
  }
  return findings.filter((item) => item.root !== rootId || RULES[item.rule].roots.includes(rootId));
}

// ============================================================================
// Repository-wide checks
// ============================================================================

/** Retired skill names must not exist and every replacement must exist in some root. */
export function checkRetiredSkillConfig(retiredSkills, skillNamesByRoot) {
  const findings = [];
  const allNames = new Set([...skillNamesByRoot.values()].flatMap((names) => [...names]));
  for (const retired of retiredSkills) {
    if (allNames.has(retired.old)) {
      findings.push(
        finding(
          "config-stale-entry",
          "repository",
          null,
          `RETIRED_SKILLS entry "${retired.old}" is still a current skill; remove the entry or the skill`,
        ),
      );
    }
    for (const replacement of retired.replacements) {
      if (!allNames.has(replacement)) {
        findings.push(
          finding(
            "config-stale-entry",
            "repository",
            null,
            `RETIRED_SKILLS replacement "${replacement}" for "${retired.old}" is not a current skill in any root`,
          ),
        );
      }
    }
  }
  return findings;
}

/** Finds retired skill names in text; returns findings with `file:line` locations. */
export function findRetiredReferences(filePath, content, retiredSkills = RETIRED_SKILLS) {
  const findings = [];
  const lines = content.split("\n");
  for (const retired of retiredSkills) {
    for (let index = 0; index < lines.length; index++) {
      if (lines[index].includes(retired.old)) {
        findings.push(
          finding(
            "retired-skill-reference",
            "repository",
            null,
            `${filePath}:${index + 1}: stale reference to "${retired.old}" — rename to ${retired.replacements
              .map((name) => `"${name}"`)
              .join(" or ")} (${retired.since})`,
            filePath,
          ),
        );
      }
    }
  }
  return findings;
}

function scanRetiredReferences() {
  const findings = [];
  const skip = (filePath) => RETIRED_SCAN_SKIP_PATTERNS.some((pattern) => pattern.test(filePath));

  const scanFile = (filePath) => {
    if (skip(filePath) || !RETIRED_SCAN_EXTENSIONS.has(path.extname(filePath))) return;
    findings.push(...findRetiredReferences(filePath, fs.readFileSync(filePath, "utf-8")));
  };
  const scanDir = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (skip(fullPath)) continue;
      if (entry.isDirectory()) scanDir(fullPath);
      else if (entry.isFile()) scanFile(fullPath);
    }
  };

  for (const target of [...RETIRED_SCAN_DIRS, ...RETIRED_SCAN_ROOT_FILES]) {
    if (!fs.existsSync(target)) {
      findings.push(
        finding("config-stale-entry", "repository", null, `retired-skill scan target "${target}" does not exist`),
      );
      continue;
    }
    if (fs.statSync(target).isDirectory()) scanDir(target);
    else scanFile(target);
  }
  return findings;
}

function checkInstructionReferences(searchableContent) {
  const findings = [];
  const refsDir = path.join(INSTRUCTIONS_DIR, "references");
  if (!fs.existsSync(refsDir)) return findings;
  for (const refFile of fs.readdirSync(refsDir).filter((file) => file.endsWith(".md"))) {
    const refName = refFile.replace(/\.md$/, "");
    if (!searchableContent.includes(refFile) && !searchableContent.includes(refName)) {
      findings.push(
        finding(
          "instruction-reference-orphaned",
          "repository",
          null,
          `instructions/references/${refFile} is not referenced anywhere`,
          path.join(refsDir, refFile),
        ),
      );
    }
  }
  return findings;
}

// ============================================================================
// Baseline
// ============================================================================

const baselineKey = (root, skill, rule) => `${root}\u0000${skill}\u0000${rule}`;

/**
 * Applies the shrink-only baseline. Matching error findings are marked
 * `baselined`; invalid, stale or unused entries become non-baselinable errors.
 * When `baseBaseline` (the baseline at the trusted base revision) is given,
 * entries absent from it are rejected and suppress nothing, so the baseline
 * cannot grow.
 *
 * @returns {{ findings: object[], entries: object[] }}
 */
export function applyBaseline({ findings, baseline, validateSchema, skillNamesByRoot, baseBaseline }) {
  const problems = [];
  const invalid = (message) => problems.push(finding("baseline-invalid", "repository", null, message));

  if (validateSchema && !validateSchema(baseline)) {
    for (const error of validateSchema.errors ?? []) {
      invalid(`${BASELINE_PATH}${error.instancePath || ""}: ${error.message}`);
    }
    return { findings: [...findings, ...problems], entries: [] };
  }

  const baseEntryKeys = Array.isArray(baseBaseline?.entries)
    ? new Set(baseBaseline.entries.map((entry) => baselineKey(entry.root, entry.skill, entry.rule)))
    : null;
  const entries = new Map();
  for (const entry of baseline.entries) {
    const label = `${entry.root}/${entry.skill} [${entry.rule}]`;
    const key = baselineKey(entry.root, entry.skill, entry.rule);
    const rule = RULES[entry.rule];
    if (entries.has(key)) {
      invalid(`duplicate baseline entry ${label}`);
      continue;
    }
    if (!skillNamesByRoot.has(entry.root)) {
      invalid(`baseline entry ${label} names unknown skill root "${entry.root}"`);
      continue;
    }
    if (!skillNamesByRoot.get(entry.root).has(entry.skill)) {
      invalid(`baseline entry ${label} names skill "${entry.skill}" that does not exist in the ${entry.root} root`);
      continue;
    }
    if (!rule) {
      invalid(`baseline entry ${label} names unknown rule "${entry.rule}"`);
      continue;
    }
    if (!rule.baselinable || !rule.roots.includes(entry.root)) {
      invalid(`baseline entry ${label}: rule "${entry.rule}" cannot be baselined for the ${entry.root} root`);
      continue;
    }
    if (baseEntryKeys && !baseEntryKeys.has(key)) {
      problems.push(
        finding(
          "baseline-entry-added",
          "repository",
          null,
          `baseline entry ${label} is not in the baseline at the base revision; the baseline is shrink-only — fix the violation instead`,
        ),
      );
      continue;
    }
    entries.set(key, { entry, used: false });
  }

  const annotated = findings.map((item) => {
    if (item.severity !== "error" || !item.skill) return item;
    const match = entries.get(baselineKey(item.root, item.skill, item.rule));
    if (!match) return item;
    match.used = true;
    return { ...item, baselined: match.entry };
  });

  for (const { entry, used } of entries.values()) {
    if (!used) {
      problems.push(
        finding(
          "baseline-entry-unused",
          "repository",
          null,
          `baseline entry ${entry.root}/${entry.skill} [${entry.rule}] (recorded ${entry.recorded}) no longer matches a violation; remove it — the baseline is shrink-only`,
        ),
      );
    }
  }

  return { findings: [...annotated, ...problems], entries: [...entries.values()].map(({ entry }) => entry) };
}

/** True when any error is not covered by the baseline. */
export function hasBlockingErrors(findings) {
  return findings.some((item) => item.severity === "error" && !item.baselined);
}

// ============================================================================
// Orchestration
// ============================================================================

/**
 * Validates every skill root plus the repository-wide rules, then applies the
 * baseline. Inputs are plain data so tests can run without the filesystem.
 */
export function runSkillValidation({
  roots,
  agents,
  instructions,
  baseline,
  baseBaseline,
  validateSchema,
  nonSkillRedirects = NON_SKILL_REDIRECTS,
  retiredSkills = RETIRED_SKILLS,
  repositoryFindings = [],
}) {
  const agentAndInstructionContent = [
    ...[...agents.values()].map((agent) => agent.content),
    ...[...instructions.values()].map((instruction) => instruction.content),
  ];
  const skillNamesByRoot = new Map(roots.map((root) => [root.id, new Set(root.skills.keys())]));

  const findings = [];
  for (const root of roots) {
    const searchableContent = [
      ...agentAndInstructionContent,
      ...[...root.skills.values()].map((skill) => skill.content ?? ""),
    ].join("\n");
    findings.push(
      ...validateSkillRoot({
        rootId: root.id,
        skills: root.skills,
        agents,
        searchableContent,
        nonSkillRedirects: nonSkillRedirects[root.id] ?? [],
      }),
    );
  }
  findings.push(...checkRetiredSkillConfig(retiredSkills, skillNamesByRoot), ...repositoryFindings);

  return applyBaseline({ findings, baseline, baseBaseline, validateSchema, skillNamesByRoot });
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Reads the baseline at the trusted base revision: the merge base of HEAD and
 * `SKILL_BASELINE_BASE_REF`, `origin/$GITHUB_BASE_REF` or `origin/main`.
 * Returns `baseBaseline: null` when the baseline does not exist there yet
 * (the change that introduces it). An unreachable base fails in CI and warns
 * locally.
 *
 * @returns {{ baseBaseline: object | null, revision: string | null, findings: object[] }}
 */
export function loadBaseBaseline({ env = process.env, git = runGit } = {}) {
  const ref = env.SKILL_BASELINE_BASE_REF || (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : "origin/main");
  let revision;
  try {
    revision = git(["merge-base", "HEAD", ref]).trim();
  } catch {
    const item = finding(
      "baseline-base-unavailable",
      "repository",
      null,
      `cannot resolve the merge base with ${ref}; baseline growth was not checked (set SKILL_BASELINE_BASE_REF or fetch ${ref})`,
    );
    return {
      baseBaseline: null,
      revision: null,
      findings: [env.GITHUB_ACTIONS === "true" ? item : { ...item, severity: "warn" }],
    };
  }
  try {
    git(["cat-file", "-e", `${revision}:${BASELINE_PATH}`]);
  } catch {
    return { baseBaseline: null, revision, findings: [] };
  }
  return { baseBaseline: JSON.parse(git(["show", `${revision}:${BASELINE_PATH}`])), revision, findings: [] };
}

/** Loads repository inputs relative to the current working directory. */
export function loadRepositoryInputs() {
  const agents = getAgents();
  const instructions = getInstructions();
  const roots = SKILL_ROOTS.map((root) => ({ ...root, skills: getSkills(root.dir) }));
  const searchableContent = [
    ...[...agents.values()].map((agent) => agent.content),
    ...[...instructions.values()].map((instruction) => instruction.content),
    ...roots.flatMap((root) => [...root.skills.values()].map((skill) => skill.content ?? "")),
  ].join("\n");
  const missingRoots = roots
    .filter((root) => !fs.existsSync(root.dir))
    .map((root) => finding("config-stale-entry", "repository", null, `skill root "${root.dir}" does not exist`));
  const base = loadBaseBaseline();
  return {
    roots,
    agents,
    instructions,
    baseline: JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")),
    baseBaseline: base.baseBaseline,
    baseRevision: base.revision,
    validateSchema: loadValidator(BASELINE_SCHEMA_PATH),
    repositoryFindings: [
      ...missingRoots,
      ...base.findings,
      ...checkInstructionReferences(searchableContent),
      ...scanRetiredReferences(),
    ],
  };
}

// ============================================================================
// Reporting
// ============================================================================

function printFinding(item) {
  const where = item.skill ? `${item.skill}: ` : "";
  const text = `[${item.rule}] ${where}${item.message}`;
  if (item.baselined) {
    console.log(`  ⏸️  ${text} (baselined ${item.baselined.recorded}, ${item.baselined.tracking})`);
  } else if (item.severity === "error") {
    console.error(`  ❌ ${text}`);
  } else {
    console.warn(`  ⚠️  ${text}`);
  }
  if (item.file && process.env.GITHUB_ACTIONS === "true" && !item.baselined) {
    console.log(`::${item.severity === "error" ? "error" : "warning"} file=${item.file}::${item.message}`);
  }
}

function countFindings(findings) {
  return {
    errors: findings.filter((item) => item.severity === "error" && !item.baselined).length,
    baselined: findings.filter((item) => item.baselined).length,
    warnings: findings.filter((item) => item.severity === "warn").length,
  };
}

function printSection(title, findings, rulesLine) {
  console.log(`\n═══ ${title} ═══`);
  if (rulesLine) console.log(`  rules: ${rulesLine}`);
  for (const item of findings) printFinding(item);
  const counts = countFindings(findings);
  console.log(`  Errors: ${counts.errors} | Baselined: ${counts.baselined} | Warnings: ${counts.warnings}`);
  return counts;
}

function main() {
  console.log("📚 Skill Validators");
  const inputs = loadRepositoryInputs();
  const { findings, entries } = runSkillValidation(inputs);

  const summary = [];
  for (const root of inputs.roots) {
    const rootRules = Object.entries(RULES)
      .filter(([, rule]) => rule.roots.includes(root.id))
      .map(([id]) => id);
    const counts = printSection(
      `${root.id} — ${root.dir} (${root.skills.size} skills; ${root.label})`,
      findings.filter((item) => item.root === root.id),
      rootRules.join(", "),
    );
    summary.push({ scope: root.id, skills: root.skills.size, ...counts });
  }
  const repositoryCounts = printSection(
    "repository-wide — instruction references, retired skill names, configuration and baseline",
    findings.filter((item) => item.root === "repository"),
  );
  summary.push({ scope: "repository", skills: "-", ...repositoryCounts });

  const byRule = {};
  for (const entry of entries) byRule[entry.rule] = (byRule[entry.rule] ?? 0) + 1;
  const ruleCounts = Object.entries(byRule).map(([rule, count]) => `${rule} ×${count}`);
  console.log(`\n═══ baseline — ${BASELINE_PATH} ═══`);
  console.log(`  entries: ${entries.length}${ruleCounts.length ? ` (${ruleCounts.join(", ")})` : ""}`);
  if (inputs.baseRevision) {
    console.log(
      inputs.baseBaseline
        ? `  growth check: compared with the baseline at ${inputs.baseRevision.slice(0, 12)}`
        : `  growth check: no baseline at ${inputs.baseRevision.slice(0, 12)} yet (introducing change)`,
    );
  }

  console.log("\n═══ summary ═══");
  for (const row of summary) {
    console.log(
      `  ${row.scope.padEnd(10)} skills: ${String(row.skills).padEnd(3)} errors: ${row.errors}  baselined: ${row.baselined}  warnings: ${row.warnings}`,
    );
  }

  if (hasBlockingErrors(findings)) {
    console.log("\n❌ Skill validation FAILED");
    process.exit(1);
  }
  console.log("\n✅ All skill validations passed");
}

if (process.argv[1]?.endsWith("validate-skills.mjs")) main();
