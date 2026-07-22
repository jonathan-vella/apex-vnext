#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BASE = "b27d17350870a0ed3d5411346701cbb2eb6a4d4b";
const SAMPLE_COUNT = 3;
export const PRECOMMIT_SCENARIOS = [
  {
    id: "documentation",
    file: "CHANGELOG.md",
    mutation: "\n<!-- pre-commit benchmark fixture -->\n",
    expectedHooks: ["markdown-lint", "secrets-baseline"],
  },
  {
    id: "javascript",
    file: "tools/scripts/validate-hooks.mjs",
    mutation: "\nexport const precommitBenchmarkFixture = true;\n",
    expectedHooks: ["js-format", "js-lint", "secrets-baseline"],
  },
  {
    id: "workflow",
    file: ".github/workflows/ci.yml",
    mutation: "\n# pre-commit benchmark fixture\n",
    expectedHooks: ["secrets-baseline"],
  },
  {
    id: "artifact",
    file: "agent-output/vnext-qualification/03-des-adr-0001-use-split-encrypted-ci-transport.md",
    mutation: "\n<!-- pre-commit benchmark fixture -->\n",
    expectedHooks: ["artifact-validation", "markdown-lint", "secrets-baseline"],
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...options.env },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

function requireSuccess(result, description) {
  if (result.status !== 0) {
    throw new Error(`${description} failed (${result.status})\n${result.stdout}${result.stderr}`);
  }
}

export function median(values) {
  if (values.length === 0) throw new Error("median requires at least one value");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export function parseSelectedHooks(output) {
  return [...output.matchAll(/^✓ ([a-z0-9-]+) \(/gmu)].map((match) => match[1]).sort();
}

export function evaluateScenario(base, candidate, expectedHooks) {
  const toleranceMs = Math.max(250, base.medianMs * 0.25);
  const timingLimitMs = base.medianMs + toleranceMs;
  const expected = [...expectedHooks].sort();
  const baseHooks = [...base.selectedHooks].sort();
  const candidateHooks = [...candidate.selectedHooks].sort();
  const hooksMatch =
    JSON.stringify(baseHooks) === JSON.stringify(expected) &&
    JSON.stringify(candidateHooks) === JSON.stringify(expected);
  const exitsPass =
    base.exitStatuses.every((status) => status === 0) && candidate.exitStatuses.every((status) => status === 0);
  const timingPass = candidate.medianMs <= timingLimitMs;
  return { hooksMatch, exitsPass, timingPass, toleranceMs, timingLimitMs, pass: hooksMatch && exitsPass && timingPass };
}

function benchmarkScenario(worktree, scenario) {
  const filePath = path.join(worktree, scenario.file);
  const original = readFileSync(filePath);
  appendFileSync(filePath, scenario.mutation);
  requireSuccess(run("git", ["add", "--", scenario.file], { cwd: worktree }), `stage ${scenario.id}`);

  try {
    requireSuccess(
      run("npx", ["lefthook", "run", "pre-commit", "--no-tty", "--colors=off"], { cwd: worktree }),
      `${scenario.id} warmup`,
    );
    const samples = [];
    const exitStatuses = [];
    let selectedHooks = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const startedAt = process.hrtime.bigint();
      const result = run("npx", ["lefthook", "run", "pre-commit", "--no-tty", "--colors=off"], { cwd: worktree });
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const hooks = parseSelectedHooks(`${result.stdout}${result.stderr}`);
      if (index === 0) selectedHooks = hooks;
      else if (JSON.stringify(hooks) !== JSON.stringify(selectedHooks)) {
        throw new Error(`${scenario.id} selected hooks changed between samples`);
      }
      samples.push(Math.round(elapsedMs));
      exitStatuses.push(result.status);
    }
    return { samplesMs: samples, medianMs: median(samples), exitStatuses, selectedHooks };
  } finally {
    writeFileSync(filePath, original);
    requireSuccess(run("git", ["add", "--", scenario.file], { cwd: worktree }), `restore ${scenario.id}`);
  }
}

function prepareWorktree(root, label, ref) {
  const worktree = path.join(root, label);
  requireSuccess(run("git", ["worktree", "add", "--detach", worktree, ref]), `create ${label} worktree`);
  const dependencies = path.join(REPO_ROOT, "node_modules");
  if (!existsSync(dependencies)) throw new Error(`Dependencies are missing: ${dependencies}`);
  symlinkSync(dependencies, path.join(worktree, "node_modules"), "dir");
  return worktree;
}

function resolveRef(ref) {
  const result = run("git", ["rev-parse", `${ref}^{commit}`]);
  requireSuccess(result, `resolve ${ref}`);
  return result.stdout.trim();
}

export function parseArgs(args) {
  const options = { base: DEFAULT_BASE, candidate: "HEAD", output: null };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (["--base", "--candidate", "--output"].includes(value)) {
      const optionValue = args[index + 1];
      if (optionValue === undefined || optionValue.startsWith("--")) throw new Error(`${value} requires a value`);
      options[value.slice(2)] = optionValue;
      index += 1;
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function removeWorktree(worktree) {
  const result = run("git", ["worktree", "remove", "--force", worktree]);
  if (result.status === 0) return;
  rmSync(worktree, { recursive: true, force: true });
  requireSuccess(run("git", ["worktree", "prune"]), `prune stale worktree ${worktree}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const refs = { base: resolveRef(options.base), candidate: resolveRef(options.candidate) };
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "apex-precommit-baseline-"));
  const worktrees = [];

  try {
    const baseWorktree = prepareWorktree(tempRoot, "base", refs.base);
    worktrees.push(baseWorktree);
    const candidateWorktree = prepareWorktree(tempRoot, "candidate", refs.candidate);
    worktrees.push(candidateWorktree);

    const scenarios = PRECOMMIT_SCENARIOS.map((scenario) => {
      const base = benchmarkScenario(baseWorktree, scenario);
      const candidate = benchmarkScenario(candidateWorktree, scenario);
      return { ...scenario, base, candidate, evaluation: evaluateScenario(base, candidate, scenario.expectedHooks) };
    });
    const report = {
      schemaVersion: "1.0.0",
      refs,
      sampleCount: SAMPLE_COUNT,
      scenarios,
      pass: scenarios.every(({ evaluation }) => evaluation.pass),
    };
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output !== null) {
      const outputPath = path.resolve(REPO_ROOT, options.output);
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, output);
    }
    process.stdout.write(output);
    process.exitCode = report.pass ? 0 : 1;
  } finally {
    for (const worktree of worktrees.reverse()) removeWorktree(worktree);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
