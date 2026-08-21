#!/usr/bin/env node
/** Detect supported-client measurement readiness without installing or interacting with either client. */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const GATE_PATH = "tools/registry/optimization-gate.v1.json";
const TOOLCHAIN_PATH = "config/toolchain.v1.json";
const SCHEMA_PATH = "tools/registry/schemas/optimization-client-preflight.schema.json";

function commandOutput(file, args, run = execFileSync) {
  try {
    return { ok: true, output: run(file, args, { encoding: "utf8", input: "n\n", timeout: 10_000 }).trim() };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim() };
  }
}

function firstVersion(output) {
  return output.match(/\b\d+\.\d+(?:\.\d+)?\b/u)?.[0];
}

function candidate(run = execFileSync) {
  return {
    commit: run("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree: run("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
    worktreeClean: run("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() === "",
  };
}

function extensionVersion(output) {
  return output
    .split("\n")
    .map((line) => line.match(/^github\.copilot-chat@(\S+)$/u)?.[1])
    .find(Boolean);
}

export function parsePreflightArgs(args) {
  if (args.length !== 2 || args[0] !== "--output" || !args[1] || args[1].startsWith("--")) {
    throw new Error("only --output <path> is supported");
  }
  return { output: args[1] };
}

export function buildOptimizationClientPreflight({ gate, toolchain, run = execFileSync }) {
  if (
    gate.state !== "authorized" ||
    gate.authorization.status !== "approved" ||
    gate.authorization.budget.maxTrackedMutations !== 0 ||
    !gate.authorization.allowedCommands.includes("npm run preflight:optimization-client-measurement")
  ) {
    throw new Error("authorized zero-mutation gate with client preflight command scope is required");
  }
  const observedCandidate = candidate(run);
  const vscode = commandOutput("code", ["--version"], run);
  const vscodeExtensions = commandOutput("code", ["--list-extensions", "--show-versions"], run);
  const cli = commandOutput("copilot", ["--version"], run);
  const vscodeVersion = firstVersion(vscode.output);
  const copilotChatVersion = extensionVersion(vscodeExtensions.output);
  const cliVersion = firstVersion(cli.output);
  const expectedVscode = toolchain.core.vscode.selectedExactVersion;
  const expectedCopilotChat = toolchain.core.vscode.selectedExactCopilotChatVersion;
  const expectedCli = toolchain.core.copilotCli.selectedExactVersion;
  const clients = [
    {
      id: "github-copilot-vscode",
      expectedVersion: expectedVscode,
      expectedExtensionVersion: expectedCopilotChat,
      ...(vscodeVersion ? { observedVersion: vscodeVersion } : {}),
      ...(copilotChatVersion ? { observedExtensionVersion: copilotChatVersion } : {}),
      status: !vscode.ok
        ? "missing"
        : vscodeVersion !== expectedVscode
          ? "version-mismatch"
          : !vscodeExtensions.ok || copilotChatVersion !== expectedCopilotChat
            ? "extension-version-mismatch"
            : "ready",
      ...(!vscode.ok
        ? { reason: "VS Code executable is unavailable." }
        : vscodeVersion !== expectedVscode
          ? { reason: "Observed VS Code version differs from the selected qualification version." }
          : !vscodeExtensions.ok || copilotChatVersion !== expectedCopilotChat
            ? { reason: "Observed Copilot Chat extension version differs from the selected qualification version." }
            : {}),
    },
    {
      id: "github-copilot-cli",
      expectedVersion: expectedCli,
      ...(cliVersion ? { observedVersion: cliVersion } : {}),
      status: /Install GitHub Copilot CLI\?/u.test(cli.output)
        ? "interactive-install-required"
        : !cli.ok
          ? "missing"
          : cliVersion !== expectedCli
            ? "version-mismatch"
            : "ready",
      ...(/Install GitHub Copilot CLI\?/u.test(cli.output)
        ? { reason: "Copilot CLI requires an interactive install; preflight declined it." }
        : !cli.ok
          ? { reason: "Copilot CLI executable is unavailable." }
          : cliVersion !== expectedCli
            ? { reason: "Observed Copilot CLI version differs from the selected qualification version." }
            : {}),
    },
  ];
  const candidateMatches =
    observedCandidate.commit === gate.candidate.commit && observedCandidate.tree === gate.candidate.tree;
  return {
    schemaVersion: "1.0.0",
    candidate: observedCandidate,
    gateCandidate: { commit: gate.candidate.commit, tree: gate.candidate.tree },
    status:
      candidateMatches && observedCandidate.worktreeClean && clients.every(({ status }) => status === "ready")
        ? "ready"
        : "blocked",
    clients,
  };
}

export function validateOptimizationClientPreflight(receipt, schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  if (ajv.validate(schema, receipt)) return [];
  return (ajv.errors ?? []).map(({ instancePath, message }) => `schema ${instancePath || "/"}: ${message}`);
}

function main() {
  try {
    const { output } = parsePreflightArgs(process.argv.slice(2));
    const gate = JSON.parse(readFileSync(GATE_PATH, "utf8"));
    const toolchain = JSON.parse(readFileSync(TOOLCHAIN_PATH, "utf8"));
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const receipt = buildOptimizationClientPreflight({ gate, toolchain });
    const errors = validateOptimizationClientPreflight(receipt, schema);
    if (errors.length > 0) throw new Error(errors.join("; "));
    const outputPath = resolve(output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    console.log(`✅ Client measurement preflight is ${receipt.status}`);
    return receipt.status === "ready" ? 0 : 2;
  } catch (error) {
    console.error(`❌ Client measurement preflight failed: ${error.message}`);
    return 1;
  }
}

if (process.argv[1]?.endsWith("preflight-optimization-client-measurement.mjs")) process.exitCode = main();
