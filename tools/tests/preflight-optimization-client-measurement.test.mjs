import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOptimizationClientPreflight,
  parsePreflightArgs,
  validateOptimizationClientPreflight,
} from "../scripts/preflight-optimization-client-measurement.mjs";

const gate = JSON.parse(readFileSync("tools/registry/optimization-gate.v1.json", "utf8"));
const toolchain = JSON.parse(readFileSync("config/toolchain.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/optimization-client-preflight.schema.json", "utf8"));

function commandRun(outputs) {
  return (file, args) => {
    const key = `${file} ${args.join(" ")}`;
    const output = outputs[key];
    if (output instanceof Error) throw output;
    return output;
  };
}

test("preflight reports ready only for exact candidate and selected client versions", () => {
  const run = commandRun({
    "git rev-parse HEAD": `${gate.candidate.commit}\n`,
    "git rev-parse HEAD^{tree}": `${gate.candidate.tree}\n`,
    "git status --porcelain --untracked-files=no": "",
    "code --version": `${toolchain.core.vscode.selectedExactVersion}\n`,
    "code --list-extensions --show-versions": `github.copilot-chat@${toolchain.core.vscode.selectedExactCopilotChatVersion}\n`,
    "copilot --version": `${toolchain.core.copilotCli.selectedExactVersion}\n`,
  });
  const receipt = buildOptimizationClientPreflight({ gate, toolchain, run });
  assert.equal(receipt.status, "ready");
  assert.deepEqual(validateOptimizationClientPreflight(receipt, schema), []);
});

test("preflight blocks drift and interactive client installation without installing it", () => {
  const run = commandRun({
    "git rev-parse HEAD": `${"a".repeat(40)}\n`,
    "git rev-parse HEAD^{tree}": `${"b".repeat(40)}\n`,
    "git status --porcelain --untracked-files=no": " M package.json\n",
    "code --version": "1.134.0\n",
    "code --list-extensions --show-versions": "github.copilot-chat@0.58.0\n",
    "copilot --version": "Install GitHub Copilot CLI? ['y/N']\n",
  });
  const receipt = buildOptimizationClientPreflight({ gate, toolchain, run });
  assert.equal(receipt.status, "blocked");
  assert.equal(receipt.clients[0].status, "version-mismatch");
  assert.equal(receipt.clients[1].status, "interactive-install-required");
  assert.equal(receipt.candidate.worktreeClean, false);
  assert.throws(() => parsePreflightArgs(["--output", "first.json", "--output", "second.json"]), /only --output/);
});

test("preflight schema rejects incomplete client coverage and reports extension drift", () => {
  const run = commandRun({
    "git rev-parse HEAD": `${gate.candidate.commit}\n`,
    "git rev-parse HEAD^{tree}": `${gate.candidate.tree}\n`,
    "git status --porcelain --untracked-files=no": "",
    "code --version": `${toolchain.core.vscode.selectedExactVersion}\n`,
    "code --list-extensions --show-versions": "github.copilot-chat@0.57.0\n",
    "copilot --version": `${toolchain.core.copilotCli.selectedExactVersion}\n`,
  });
  const receipt = buildOptimizationClientPreflight({ gate, toolchain, run });
  assert.equal(receipt.clients[0].status, "extension-version-mismatch");
  const incomplete = structuredClone(receipt);
  incomplete.clients = [incomplete.clients[0]];
  assert.ok(validateOptimizationClientPreflight(incomplete, schema).length > 0);
});
