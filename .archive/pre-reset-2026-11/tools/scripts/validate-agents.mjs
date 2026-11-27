#!/usr/bin/env node
/**
 * Agent Validators (consolidated)
 *
 * Combines three agent validation checks into one script:
 * 1. Frontmatter validation (was validate-agent-frontmatter.mjs)
 * 2. Agent structural checks — body size + language density (was lint-agent-checks.mjs)
 * 3. Family-neutral vendor-prompting guidance checks
 *
 * @example
 * node tools/scripts/validate-agents.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Namespace import (not `import yaml from "js-yaml"`): js-yaml 5.x is pure ESM
// and exposes named exports only — no default export. A namespace import works
// under both js-yaml 4.x (CommonJS) and 5.x (ESM).
import * as yaml from "js-yaml";
import { getAgents, getPromptFiles } from "./_lib/workspace-index.mjs";
import { getBody } from "./_lib/parse-frontmatter.mjs";
import { Reporter } from "./_lib/reporter.mjs";
import { MAX_BODY_LINES } from "./_lib/paths.mjs";

let overallFailed = false;
/** Aggregated structured findings across all parts (used by --format=json). */
const allFindings = [];

/**
 * The repo's custom YAML-like parser flattens handoffs into a string array
 * (one entry per `key: value` line). For vendor-prompting checks that need
 * structured handoffs, re-parse the frontmatter with js-yaml.
 *
 * Returns an array of `{ label, agent, prompt, send, model }` objects, or
 * an empty array when the agent has no handoffs.
 */
function parseStructuredHandoffs(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  try {
    const parsed = yaml.load(m[1]);
    if (parsed && Array.isArray(parsed.handoffs)) return parsed.handoffs;
  } catch {
    // js-yaml may fail on edge-case YAML; degrade to empty array.
  }
  return [];
}

// ============================================================================
// Part 1: Agent Frontmatter Validation (was validate-agent-frontmatter.mjs)
// ============================================================================

const MAIN_AGENT_REQUIRED = ["name", "description", "user-invocable", "tools"];
const SUBAGENT_REQUIRED = ["name", "description", "user-invocable", "tools"];
const RETIRED_VSCODE_FIELDS = ["argument-hint", "handoffs", "agents"];
const RETIRED_VSCODE_TOOLS = new Map([
  ["vscode/askQuestions", "ask_user"],
  ["agent", "task"],
]);
const BLOCK_SCALAR_PATTERN = /^description:\s*[>|][-\s]*$/m;
// Description length cap: enforces concise routing-keyword-only descriptions.
// See customizations/.github/instructions/apex-agent-authoring.instructions.md.
// Anti-scope language belongs in the body, not in the description field —
// every char here ships with every model call (~10x compounding cost).
const DESCRIPTION_MAX_LEN = 350;
const DESCRIPTION_WARN_LEN = 300;

const ALLOWED_NON_INVOCABLE_MAIN_AGENTS = new Set(["e2e-orchestrator.agent.md"]);

function runFrontmatterValidation() {
  const r = new Reporter("Agent Frontmatter Validator");
  r.header();

  const agents = getAgents();
  let mainCount = 0;
  let subCount = 0;

  for (const [_file, agent] of agents) {
    r.tick();
    const { path: filePath, content, frontmatter, isSubagent } = agent;
    const relativePath = filePath;

    if (isSubagent) subCount++;
    else mainCount++;

    if (BLOCK_SCALAR_PATTERN.test(content)) {
      r.error(relativePath, "description uses a YAML block scalar (>, >-, | or |-). Use a single-line inline string.");
    }

    if (frontmatter && typeof frontmatter.description === "string") {
      const len = frontmatter.description.length;
      if (len > DESCRIPTION_MAX_LEN) {
        r.error(
          relativePath,
          `description is ${len} chars (max ${DESCRIPTION_MAX_LEN}). Trim USE FOR/INVOKES content into the body; keep WHEN keywords + a short anti-scope clause.`,
        );
      } else if (len > DESCRIPTION_WARN_LEN) {
        r.warn(
          relativePath,
          `description is ${len} chars (recommend ≤ ${DESCRIPTION_WARN_LEN}). Drop redundant USE FOR / INVOKES lines.`,
        );
      }
    }

    if (!frontmatter) {
      r.error(relativePath, "No frontmatter found");
      continue;
    }

    if ("target" in frontmatter) {
      r.error(relativePath, "Shared managed agent source must omit 'target'; client projections add it");
    }

    const requiredFields = isSubagent ? SUBAGENT_REQUIRED : MAIN_AGENT_REQUIRED;

    for (const field of requiredFields) {
      if (!(field in frontmatter)) {
        r.error(relativePath, `Missing required field '${field}'`);
      }
    }

    for (const field of RETIRED_VSCODE_FIELDS) {
      if (field in frontmatter)
        r.error(relativePath, `Retired VS Code field '${field}'; Copilot CLI agents do not use it`);
    }
    for (const tool of Array.isArray(frontmatter.tools) ? frontmatter.tools : []) {
      if (RETIRED_VSCODE_TOOLS.has(tool)) {
        r.error(relativePath, `Retired VS Code tool '${tool}'; use '${RETIRED_VSCODE_TOOLS.get(tool)}'`);
      }
    }
    if (isSubagent) {
      const ui = frontmatter["user-invocable"];
      if (ui !== "false" && ui !== "never" && ui !== false) {
        r.error(relativePath, `Subagent must have user-invocable: false or never (got: ${ui})`);
      }
    } else {
      const ui = frontmatter["user-invocable"];
      const filename = relativePath.split("/").pop();
      if (ui !== "true" && ui !== "always" && ui !== true && !ALLOWED_NON_INVOCABLE_MAIN_AGENTS.has(filename)) {
        r.warn(relativePath, `Main agent should have user-invocable: true (got: ${ui})`);
      }
    }

    if (content.includes("handoffs:")) {
      const handoffMatch = content.match(/handoffs:[\s\S]*?(?=\n[a-z-]+:|---|\n#|$)/i);
      if (handoffMatch) {
        const handoffSection = handoffMatch[0];
        const labelCount = (handoffSection.match(/label:/g) || []).length;
        const sendCount = (handoffSection.match(/send:/g) || []).length;
        if (labelCount > 0 && sendCount === 0) {
          r.warn(relativePath, "Handoffs missing 'send' property (1.109 feature)");
        }
      }
    }

    const fmEnd = content.indexOf("\n---", content.indexOf("---") + 3);
    if (fmEnd !== -1) {
      const body = content.substring(fmEnd + 4);
      const bodyLines = body.split("\n").length;
      if (bodyLines > MAX_BODY_LINES) {
        r.error(
          relativePath,
          `Body is ${bodyLines} lines (>${MAX_BODY_LINES}). Extract to skill references/ or scripts/.`,
        );
      }
    }
  }

  console.log(`\nFound ${mainCount} main agents and ${subCount} subagents`);

  r.summary();
  if (r.errors > 0) {
    overallFailed = true;
    console.log("❌ Agent frontmatter validation FAILED\n");
  } else {
    console.log("✅ All agents passed frontmatter validation\n");
  }
}

// ============================================================================
// Part 2: Agent Structural Checks (was lint-agent-checks.mjs)
// ============================================================================

const KEYWORDS = ["MANDATORY", "NEVER", "CRITICAL", "MUST", "HARD"];
const MAX_DENSITY_PER_100 = 5;

const EXCLUDE_PATTERNS = [
  /security baseline/i,
  /approval gate/i,
  /ONE-SHOT/,
  /HARD RULE.*ONE-SHOT/,
  /NEVER proceed past approval gates/i,
  /NEVER ask about IaC tool/i,
  /NEVER call `#runSubagent` for/i,
  /MUST be delegated via/i,
  /MUST include Challenger/i,
];

function stripCodeFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, "");
}

function analyzeLanguage(body) {
  const stripped = stripCodeFences(body);
  const lines = stripped.split("\n");
  const perKeyword = new Map(KEYWORDS.map((k) => [k, 0]));
  let total = 0;

  for (const line of lines) {
    if (EXCLUDE_PATTERNS.some((pat) => pat.test(line))) continue;
    for (const keyword of KEYWORDS) {
      const regex = new RegExp(`\\b${keyword}\\b`, "g");
      const matches = line.match(regex);
      if (matches) {
        perKeyword.set(keyword, perKeyword.get(keyword) + matches.length);
        total += matches.length;
      }
    }
  }

  return { total, perKeyword, lines: lines.length };
}

function runAgentChecks() {
  const r = new Reporter("Agent Structural Checks");
  r.header();

  const agents = getAgents();

  // Known subagent names and manifest edges feed the body invocation check below.
  const manifestEdges =
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "customizations", "manifest.json"), "utf8")).invocationEdges ??
    [];
  const knownSubagents = new Set();
  for (const [, agent] of agents) {
    if (agent.isSubagent && agent.frontmatter?.name) {
      knownSubagents.add(agent.frontmatter.name);
    }
  }

  // Invocation verbs that imply a real subagent call (vs. a prose mention).
  // Conservative on purpose — false negatives are preferable to false positives
  // here; documentation references should not trigger errors.
  const INVOCATION_VERB_RE =
    /(?:invoke|delegate(?:\s+to)?|dispatch|call|run|hand[\s-]?off|@|#runSubagent|via\s+`?#runSubagent`?)/i;

  for (const [file, agent] of agents) {
    r.tick();
    const { path: filePath, content, isSubagent } = agent;
    const body = getBody(content);
    const bodyLines = body.split("\n").length;

    if (bodyLines > MAX_BODY_LINES) {
      const totalLines = content.split("\n").length;
      r.errorAnnotation(filePath, `${file} body is ${bodyLines} lines (>${MAX_BODY_LINES}; total: ${totalLines})`);
      console.log(`  Fix: Extract verbose sections to skill references/ or scripts/.`);
    }

    const { total, perKeyword, lines } = analyzeLanguage(body);
    const density = lines > 0 ? (total / lines) * 100 : 0;

    if (density > MAX_DENSITY_PER_100) {
      const breakdown = KEYWORDS.filter((k) => perKeyword.get(k) > 0)
        .map((k) => `${k}=${perKeyword.get(k)}`)
        .join(", ");
      r.warnAnnotation(
        filePath,
        `${file}: ${total} absolute-language keywords in ${lines} lines (${density.toFixed(1)}/100 > ${MAX_DENSITY_PER_100}/100). Breakdown: ${breakdown}`,
      );
      console.log(`  Fix: Soften language or extract content to skill references.`);
    }

    // A body that invokes a subagent needs a matching manifest subagent edge;
    // the kernel and renderer derive delegation from those edges.
    if (!isSubagent) {
      const declared = new Set(
        manifestEdges
          .filter(({ from, type }) => from === agent.frontmatter?.name && type === "subagent")
          .map(({ to }) => to),
      );
      const missing = new Set();
      for (const subagentName of knownSubagents) {
        if (declared.has(subagentName)) continue;
        // Look for invocation patterns within ±60 chars of the name.
        const escaped = subagentName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        const proximityRe = new RegExp(`.{0,60}\`?${escaped}\`?.{0,60}`, "gi");
        const matches = body.match(proximityRe) || [];
        for (const m of matches) {
          if (INVOCATION_VERB_RE.test(m)) {
            missing.add(subagentName);
            break;
          }
        }
      }
      for (const name of missing) {
        r.errorAnnotation(
          filePath,
          `${file} invokes \`${name}\` in body but customizations/manifest.json declares no subagent edge for it`,
        );
        console.log(`  Fix: Add a subagent invocation edge for "${name}" to customizations/manifest.json.`);
      }
    }

    // No-direct-markdownlint-on-agent-output rule.
    // Agents must not improvise `markdownlint-cli2 agent-output/...` in a tool
    // span. The path is globally excluded from `lint:md` and the contract is
    // owned by lefthook + 10-Challenger. See agent-authoring.instructions.md.
    // Match the literal CLI invocation form only — prose references that
    // *describe* the prohibition are fine because they don't contain the
    // bare command followed by the path token.
    const directMdLintRe = /markdownlint(?:-cli2)?\s+agent-output\//g;
    const directMdLintMatches = body.match(directMdLintRe);
    if (directMdLintMatches) {
      r.errorAnnotation(
        filePath,
        `${file} contains forbidden direct markdownlint invocation against agent-output/ (${directMdLintMatches.length} occurrence${directMdLintMatches.length === 1 ? "" : "s"}). The path is already excluded from lint:md; pre-commit + 10-Challenger own the artifact contract.`,
      );
      console.log(
        `  Fix: Remove the direct \`markdownlint-cli2 agent-output/...\` call. See agent-authoring.instructions.md "No-direct-markdownlint-on-agent-output rule".`,
      );
    }
  }

  r.summary();
  if (r.errors > 0) {
    overallFailed = true;
    console.log("❌ Agent structural checks FAILED\n");
  } else {
    console.log("✅ Agent structural checks passed\n");
  }
}

// ============================================================================
// Part 3: Vendor Prompting
// ============================================================================

/**
 * Inline rule registry. Each entry mirrors a row in
 * `.github/skills/vendor-prompting/rules.json`. The validator does not load
 * that file at runtime (avoids circularity); instead `--list-rules` dumps
 * this catalog and `validate-vendor-rules.mjs` cross-checks both directions.
 *
 * Severity here is final; rules are model neutral.
 */
const VENDOR_RULES = [
  {
    id: "cross-language-density-001",
    severity: "info",
    appliesTo: "agent",
    sourceUrl:
      "https://github.com/openai/skills/blob/724cd511c96593f642bddf13187217aa155d2554/skills/.curated/openai-docs/references/prompting-guide.md#outcome-first-prompts-and-stopping-conditions",
  },
  {
    id: "handoff-enrichment-001",
    severity: "warn",
    appliesTo: "agent",
    sourceUrl:
      "https://github.com/jonathan-vella/apex-vnext/blob/main/customizations/.github/instructions/apex-agent-authoring.instructions.md",
  },
  {
    id: "personality-scoping-001",
    severity: "info",
    appliesTo: "agent",
    sourceUrl:
      "https://github.com/openai/skills/blob/724cd511c96593f642bddf13187217aa155d2554/skills/.curated/openai-docs/references/prompting-guide.md#personality-and-behavior",
  },
  {
    id: "model-pin-001",
    severity: "error",
    appliesTo: "both",
    sourceUrl:
      "https://github.com/jonathan-vella/apex-vnext/blob/main/docs/vnext/DECISIONS.md#decision-033-support-native-windows-clients-and-deliver-apex-as-an-agent-plugin",
  },
];

function ruleById(id) {
  return VENDOR_RULES.find((rule) => rule.id === id);
}

/** Permitted absolute-language paragraph keywords (Check 8R). */
const PERMITTED_ABSOLUTE_CONTEXTS = [/security baseline/i, /governance/i, /approval gate/i, /non-negotiable/i];

const ABSOLUTE_WORDS = ["ALWAYS", "NEVER", "MUST", "HARD RULE"];
const ABSOLUTE_DENSITY_THRESHOLD = 0.05;

/** Check 8R: cross-language-density-001 */
function checkAbsoluteLanguageDensity(r, agent, file) {
  const body = getBody(agent.content);
  const lines = body.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return;
  let count = 0;
  for (const line of lines) {
    if (PERMITTED_ABSOLUTE_CONTEXTS.some((re) => re.test(line))) continue;
    for (const w of ABSOLUTE_WORDS) {
      const m = line.match(new RegExp(`\\b${w}\\b`, "g"));
      if (m) count += m.length;
    }
  }
  const density = count / lines.length;
  if (density > ABSOLUTE_DENSITY_THRESHOLD) {
    emit(
      r,
      "cross-language-density-001",
      file,
      `Absolute words density ${density.toFixed(3)} (count ${count} / ${lines.length} lines) exceeds ${ABSOLUTE_DENSITY_THRESHOLD} outside permitted contexts`,
    );
  }
}

/** Check 14: handoff-enrichment-001 */
function checkHandoffEnrichment(r, agent, file) {
  const handoffs = parseStructuredHandoffs(agent.content);
  if (handoffs.length === 0) return;
  for (const [i, h] of handoffs.entries()) {
    if (!h?.prompt || typeof h.prompt !== "string") continue;
    const hasInput = /agent-output\/.+\.md/i.test(h.prompt) || /\bInput\b/i.test(h.prompt);
    const hasOutput = /Output\s*:/i.test(h.prompt) || /agent-output\/.+\.md/i.test(h.prompt);
    if (!hasInput || !hasOutput) {
      const missing = [!hasInput && "input reference", !hasOutput && "output reference"].filter(Boolean).join(" and ");
      emit(r, "handoff-enrichment-001", file, `handoffs[${i}] (${h.label || h.agent || "?"}) missing ${missing}`);
    }
  }
}

function checkPersonalityScoping(r, agent, file) {
  const ui = agent.frontmatter?.["user-invocable"];
  const isUserFacing =
    (ui === true || ui === "true" || ui === "always") && /(?:APEX|Orchestrator)/i.test(agent.frontmatter?.name || "");
  if (/^# Personality\b/m.test(getBody(agent.content)) && !isUserFacing && !agent.isSubagent) {
    emit(
      r,
      "personality-scoping-001",
      file,
      `# Personality block on internal pipeline agent "${agent.frontmatter?.name}" — reserve for user-facing agents`,
    );
  }
}

/** Check 15: model-pin-001 — the user picks the session model. */
const MODEL_PIN_FIELDS = ["model", "model-policy", "reasoning-effort"];

function checkModelPin(r, item, file) {
  const fields = MODEL_PIN_FIELDS.filter((field) => item.frontmatter && field in item.frontmatter);
  if (fields.length === 0) return;
  emit(r, "model-pin-001", file, `remove ${fields.join(", ")}; the session model applies`);
}

/**
 * Emit a finding via the Reporter.
 */
function emit(r, ruleId, file, message) {
  const rule = ruleById(ruleId);
  if (!rule) {
    r.warn(file, `[unregistered rule ${ruleId}] ${message}`);
    return;
  }
  const sev = rule.severity;
  if (sev === "error") r.error(file, `[${ruleId}] ${message}`);
  else if (sev === "warn") r.warn(file, `[${ruleId}] ${message}`);
  else r.info(file, `[${ruleId}] ${message}`);
  r.record({
    ruleId,
    severity: sev,
    file,
    message,
    sourceUrl: rule.sourceUrl,
  });
}

function runVendorPrompting() {
  const r = new Reporter("Vendor Prompting Rules");
  r.header();

  const agents = getAgents();
  const prompts = getPromptFiles();

  for (const [_file, agent] of agents) {
    r.tick();
    const relPath = path.relative(process.cwd(), agent.path);

    checkModelPin(r, agent, relPath);
    checkAbsoluteLanguageDensity(r, agent, relPath);
    checkHandoffEnrichment(r, agent, relPath);
    checkPersonalityScoping(r, agent, relPath);
  }

  for (const [_file, prompt] of prompts) {
    r.tick();
    const relPath = path.relative(process.cwd(), prompt.path);

    checkModelPin(r, prompt, relPath);
  }

  r.summary();
  if (r.errors > 0) {
    overallFailed = true;
    console.log("❌ Vendor prompting check FAILED\n");
  } else {
    console.log("✅ Vendor prompting check passed\n");
  }
  allFindings.push(...r.findings);
}

// ============================================================================
// Self-check: cross-reference VENDOR_RULES vs rules.json
// ============================================================================

function listRules() {
  const rulesJsonPath = ".github/skills/vendor-prompting/rules.json";
  let registry = null;
  if (fs.existsSync(rulesJsonPath)) {
    try {
      registry = JSON.parse(fs.readFileSync(rulesJsonPath, "utf-8"));
    } catch (e) {
      console.error(`Failed to parse ${rulesJsonPath}: ${e.message}`);
      process.exit(2);
    }
  }
  console.log("Inline rule catalog (validate-agents.mjs):\n");
  console.log("  ── vendor-prompting ─────────────────────────");
  for (const rule of VENDOR_RULES) {
    console.log(`  ${rule.id.padEnd(36)} severity=${rule.severity.padEnd(5)} appliesTo=${rule.appliesTo}`);
  }
  if (!registry) {
    console.log("\n(no rules.json present to cross-check)");
    return;
  }
  const inlineIds = new Set(VENDOR_RULES.map((r) => r.id));
  const registryIds = new Set(registry.rules.map((r) => r.id));
  const inlineOnly = [...inlineIds].filter((id) => !registryIds.has(id));
  const registryOnly = [...registryIds].filter((id) => !inlineIds.has(id));
  console.log("\nCross-check vs rules.json (vendor-prompting only — workflow-handoff rules intentionally separate):");
  if (inlineOnly.length === 0 && registryOnly.length === 0) {
    console.log("  ✅ inline catalog and rules.json are in sync");
  } else {
    if (inlineOnly.length > 0) {
      console.log(`  ❌ in inline catalog but missing from rules.json: ${inlineOnly.join(", ")}`);
    }
    if (registryOnly.length > 0) {
      console.log(`  ❌ in rules.json but missing from inline catalog: ${registryOnly.join(", ")}`);
    }
    process.exit(1);
  }
}

// ============================================================================
// Main entry point
// ============================================================================

const PARTS = {
  frontmatter: runFrontmatterValidation,
  structural: runAgentChecks,
  "vendor-prompting": runVendorPrompting,
};

function parseArgs(argv) {
  const opts = { only: null, format: "text", listRules: false, color: true, suggest: false };
  for (const a of argv) {
    if (a === "--list-rules") opts.listRules = true;
    else if (a === "--no-color") opts.color = false;
    else if (a === "--suggest") opts.suggest = true;
    else if (a.startsWith("--only=")) {
      opts.only = a
        .slice(7)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith("--format=")) {
      opts.format = a.slice(9);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.listRules) {
    listRules();
    return;
  }

  const isJson = opts.format === "json";
  const log = isJson ? () => {} : console.log;
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  if (isJson) {
    // suppress text output during JSON mode (findings still accumulated)
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
  }

  log("🤖 Agent Validators (consolidated)\n");

  const partsToRun = opts.only && opts.only.length > 0 ? opts.only.filter((p) => PARTS[p]) : Object.keys(PARTS);

  if (opts.only && opts.only.some((p) => !PARTS[p])) {
    const unknown = opts.only.filter((p) => !PARTS[p]);
    if (!isJson) {
      origErr(`Unknown --only parts: ${unknown.join(", ")}`);
      origErr(`Valid: ${Object.keys(PARTS).join(", ")}`);
    }
    process.exit(2);
  }

  for (const part of partsToRun) {
    log(`═══ Part: ${part} ═══`);
    try {
      PARTS[part]();
    } catch (e) {
      origErr(`Validator crashed in ${part}: ${e.message}`);
      process.exit(2);
    }
  }

  if (isJson) {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
    const summary = {
      errors: allFindings.filter((f) => f.severity === "error").length,
      warns: allFindings.filter((f) => f.severity === "warn").length,
      infos: allFindings.filter((f) => f.severity === "info").length,
    };
    console.log(JSON.stringify({ summary, findings: allFindings }, null, 2));
    process.exit(summary.errors > 0 ? 1 : 0);
  }

  if (overallFailed) {
    log("❌ Agent validation FAILED");
    process.exit(1);
  }
  log("✅ All agent validations passed");
}

// Run main() only when invoked directly (not when imported by tests).
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main();
}
