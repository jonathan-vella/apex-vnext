/**
 * Shared Workspace Index
 *
 * Scans agents, skills, and instructions once and caches content +
 * parsed frontmatter. All accessors are lazy-initialized on first call.
 *
 * Usage:
 *   import { getAgents, getSkills, getInstructions } from "./_lib/workspace-index.mjs";
 *   const agents = getAgents();   // Map<filename, { path, dir, content, frontmatter }>
 *   const skills = getSkills();   // Map<skillName, { dir, content, frontmatter, hasRefs, refFiles }>
 *   const shipped = getSkills(SHIPPED_SKILLS_DIR); // same shape, another skill root
 *   const instructions = getInstructions(); // Map<filename, { path, content, frontmatter }>
 */

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./parse-frontmatter.mjs";
import { AGENTS_DIR, SUBAGENTS_DIR, SKILLS_DIR, INSTRUCTIONS_DIR, PROMPT_SOURCE_DIRS } from "./paths.mjs";

let _agents = null;
const _skills = new Map();
let _instructions = null;
let _prompts = null;

/**
 * Returns a Map of all agent files: filename → { path, dir, content, frontmatter, isSubagent }
 */
export function getAgents() {
  if (_agents) return _agents;
  _agents = new Map();
  for (const [dir, isSubagent] of [
    [AGENTS_DIR, false],
    [SUBAGENTS_DIR, true],
  ]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".agent.md")) continue;
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const hiddenWorker = [false, "false", "never"].includes(frontmatter?.["user-invocable"]);
      _agents.set(file, {
        path: filePath,
        dir,
        content,
        frontmatter,
        isSubagent: isSubagent || hiddenWorker,
      });
    }
  }
  return _agents;
}

/**
 * Returns a Map of the skills under `root` (default: the repository authoring
 * skills in `SKILLS_DIR`): skillName → { dir, content, frontmatter, hasRefs, refFiles }
 *
 * @param {string} [root] - Skill root directory; results are cached per root.
 */
export function getSkills(root = SKILLS_DIR) {
  if (_skills.has(root)) return _skills.get(root);
  const skills = new Map();
  _skills.set(root, skills);
  if (!fs.existsSync(root)) return skills;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(root, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    // Skip container directories like `archived_skills/` that have no SKILL.md
    // at the top level — those are inactive skill stores, not active skills.
    if (!fs.existsSync(skillFile)) continue;
    const refsDir = path.join(skillDir, "references");
    const hasRefs = fs.existsSync(refsDir);
    const content = fs.readFileSync(skillFile, "utf-8");
    const frontmatter = parseFrontmatter(content);
    const refFiles = hasRefs ? fs.readdirSync(refsDir).filter((f) => f.endsWith(".md")) : [];
    skills.set(entry.name, {
      dir: skillDir,
      content,
      frontmatter,
      hasRefs,
      refFiles,
    });
  }
  return skills;
}

/**
 * Returns a Set of skill directory names under `root` (default: `SKILLS_DIR`).
 *
 * @param {string} [root]
 */
export function getSkillNames(root = SKILLS_DIR) {
  return new Set(getSkills(root).keys());
}

/**
 * Returns a Map of all instructions: filename → { path, content, frontmatter }
 */
export function getInstructions() {
  if (_instructions) return _instructions;
  _instructions = new Map();
  if (!fs.existsSync(INSTRUCTIONS_DIR)) return _instructions;
  for (const entry of fs.readdirSync(INSTRUCTIONS_DIR, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".instructions.md")) continue;
    const filePath = path.join(entry.parentPath || entry.path, entry.name);
    const content = fs.readFileSync(filePath, "utf-8");
    const frontmatter = parseFrontmatter(content);
    _instructions.set(entry.name, { path: filePath, content, frontmatter });
  }
  return _instructions;
}

/** Reset all caches (useful for testing). */
export function resetIndex() {
  _agents = null;
  _skills.clear();
  _instructions = null;
  _prompts = null;
}

/**
 * Returns a Map of all prompt files: filename → { path, content, frontmatter, body }.
 * `body` is the markdown after the closing `---`.
 *
 * Scans every directory listed in `PROMPT_SOURCE_DIRS` (production prompts in
 * `tools/apex-prompts/`, maintainer prompts in `.github/prompts/` and E2E test
 * prompts in `tools/tests/prompts/`).
 */
export function getPromptFiles() {
  if (_prompts) return _prompts;
  _prompts = new Map();
  for (const dir of PROMPT_SOURCE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir, { recursive: true })) {
      if (!file.endsWith(".prompt.md")) continue;
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const fmEnd = content.indexOf("\n---", content.indexOf("---") + 3);
      const body = fmEnd !== -1 ? content.substring(fmEnd + 4) : content;
      _prompts.set(file, { path: filePath, content, frontmatter, body });
    }
  }
  return _prompts;
}
