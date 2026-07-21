#!/usr/bin/env node
/** Run and compact all non-cloud release qualification for one immutable candidate. */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function parseReleaseQualificationArguments(argv) {
  const options = { output: undefined, collectedAt: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") options.output = resolve(argv[++index]);
    else if (argument === "--collected-at") options.collectedAt = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.collectedAt === undefined || Number.isNaN(Date.parse(options.collectedAt))) {
    throw new Error("--collected-at must be an ISO date-time");
  }
  return options;
}

function commandLabel(command, args) {
  return [command, ...args].join(" ");
}

async function runCommand(command, args, { cwd, log }) {
  await mkdir(resolve(log, ".."), { recursive: true });
  const stream = createWriteStream(log, { flags: "w", mode: 0o600 });
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    // The shared log closes only after both child streams drain; console streams must remain open for later commands.
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      stream.end(() => {
        if (code === 0) resolvePromise();
        else reject(new Error(`${commandLabel(command, args)} failed (${signal ?? `exit ${code}`})`));
      });
    });
  });
}

async function capture(command, args, cwd) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`${commandLabel(command, args)} failed: ${stderr.trim()}`));
    });
  });
}

async function artifact(path, root) {
  const bytes = await readFile(path);
  const size = (await stat(path)).size;
  if (size !== bytes.length) throw new Error(`Artifact changed while hashing: ${relative(root, path)}`);
  return {
    path: relative(root, path),
    bytes: size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function runReleaseQualification(options, dependencies = {}) {
  const root = dependencies.root ?? ROOT;
  const run = dependencies.run ?? runCommand;
  const captureCommand = dependencies.capture ?? capture;
  const candidate = await captureCommand("git", ["rev-parse", "HEAD"], root);
  if (!SHA_PATTERN.test(candidate)) throw new Error("Candidate commit must be an exact lowercase SHA");
  const trackedStatus = await captureCommand("git", ["status", "--porcelain", "--untracked-files=no"], root);
  if (trackedStatus.length > 0) throw new Error("Release qualification requires a clean tracked worktree");

  const output = options.output ?? join(root, "dist", "vnext-release", candidate);
  const scorecard = join(output, "scorecard");
  const logs = join(output, "logs");
  await rm(output, { recursive: true, force: true });
  await mkdir(logs, { recursive: true });
  const commands = [
    { command: "npm", args: ["run", "prepare:vnext-assets"], log: "prepare-assets.log" },
    { command: "npm", args: ["run", "validate:all"], log: "validate-all.log" },
    { command: "npm", args: ["run", "qualify:vnext"], log: "qualify.log" },
    {
      command: "node",
      args: [
        "tools/scripts/qualify-vnext.mjs",
        "--release",
        "--collected-at",
        options.collectedAt,
        "--output",
        scorecard,
      ],
      log: "scorecard.log",
    },
  ];
  for (const entry of commands) {
    await run(entry.command, entry.args, { cwd: root, log: join(logs, entry.log) });
  }

  const evaluation = JSON.parse(await readFile(join(scorecard, "evaluation.json"), "utf8"));
  if (evaluation.status !== "pass" || evaluation.evaluations?.some(({ decision }) => decision !== "pass")) {
    throw new Error("Release scorecard did not pass every evaluated rule");
  }
  await rm(join(scorecard, "workspace"), { recursive: true, force: true });
  const finalStatus = await captureCommand("git", ["status", "--porcelain", "--untracked-files=no"], root);
  if (finalStatus.length > 0) throw new Error("Release qualification changed tracked source files");

  const artifactPaths = [
    join(scorecard, "qualification.json"),
    join(scorecard, "measurements.json"),
    join(scorecard, "evaluation.json"),
    join(scorecard, "evaluation.md"),
    ...commands.map(({ log }) => join(logs, log)),
  ];
  const artifacts = await Promise.all(artifactPaths.map((path) => artifact(path, output)));
  const receipt = {
    schemaVersion: "1.0.0",
    kind: "apex-vnext-release-qualification",
    candidate,
    collectedAt: options.collectedAt,
    status: "pass",
    commands: commands.map(({ command, args }) => commandLabel(command, args)),
    evaluations: evaluation.evaluations,
    artifacts,
    remainingManualGates: [
      "Independent security and CodeQL-or-approved-equivalent review",
      "Supported VS Code and cross-device scenarios",
      "Local Gate 4 decisions for each exact live preview",
      "Final maintainer validation and promotion authorization",
    ],
    authorization: {
      merge: false,
      cloudDispatch: false,
      packagePublication: false,
      tagCreation: false,
      cutover: false,
    },
  };
  const receiptPath = join(output, "receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const receiptArtifact = await artifact(receiptPath, output);
  await writeFile(
    join(output, "SHA256SUMS"),
    `${[...artifacts, receiptArtifact].map(({ sha256, path }) => `${sha256}  ${path}`).join("\n")}\n`,
    "utf8",
  );
  return { ...receipt, output, receipt: basename(receiptPath) };
}

async function main() {
  const result = await runReleaseQualification(parseReleaseQualificationArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
