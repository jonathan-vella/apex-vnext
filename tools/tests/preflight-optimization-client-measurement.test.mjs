import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("preflight reports ready for the bound candidate and minimum supported client versions", () => {
  const run = commandRun({
    "git rev-parse HEAD": `${gate.candidate.commit}\n`,
    "git rev-parse HEAD^{tree}": `${gate.candidate.tree}\n`,
    "git status --porcelain --untracked-files=no": "",
    "code --version": `${toolchain.core.vscode.minimumSupportedVersion}\n`,
    "code --list-extensions --show-versions": `github.copilot-chat@${toolchain.core.vscode.installedCopilotChatVersion}\n`,
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
    "code --version": "1.129.0\n",
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

test("preflight schema rejects incomplete client coverage and reports unavailable extensions", () => {
  const run = commandRun({
    "git rev-parse HEAD": `${gate.candidate.commit}\n`,
    "git rev-parse HEAD^{tree}": `${gate.candidate.tree}\n`,
    "git status --porcelain --untracked-files=no": "",
    "code --version": `${toolchain.core.vscode.minimumSupportedVersion}\n`,
    "code --list-extensions --show-versions": "example.other@0.57.0\n",
    "copilot --version": `${toolchain.core.copilotCli.selectedExactVersion}\n`,
  });
  const receipt = buildOptimizationClientPreflight({ gate, toolchain, run });
  assert.equal(receipt.clients[0].status, "extension-unavailable");
  const incomplete = structuredClone(receipt);
  incomplete.clients = [incomplete.clients[0]];
  assert.ok(validateOptimizationClientPreflight(incomplete, schema).length > 0);
});

test("preflight detects host-bundled Copilot Chat when extension inventory omits built-ins", (context) => {
  const home = mkdtempSync(join(tmpdir(), "apex-client-preflight-"));
  context.after(() => rmSync(home, { recursive: true, force: true }));
  const commit = "a".repeat(40);
  const manifestDirectory = join(home, ".vscode-server", "bin", commit, "extensions", "copilot");
  mkdirSync(manifestDirectory, { recursive: true });
  writeFileSync(
    join(manifestDirectory, "package.json"),
    `${JSON.stringify({
      name: "copilot-chat",
      publisher: "GitHub",
      version: toolchain.core.vscode.installedCopilotChatVersion,
      engines: { vscode: `^${toolchain.core.vscode.minimumSupportedVersion}` },
    })}\n`,
  );
  const run = commandRun({
    "git rev-parse HEAD": `${gate.candidate.commit}\n`,
    "git rev-parse HEAD^{tree}": `${gate.candidate.tree}\n`,
    "git status --porcelain --untracked-files=no": "",
    "code --version": `${toolchain.core.vscode.minimumSupportedVersion}\n${commit}\nx64\n`,
    "code --list-extensions --show-versions": "example.other@1.0.0\n",
    "copilot --version": `${toolchain.core.copilotCli.selectedExactVersion}\n`,
  });
  const receipt = buildOptimizationClientPreflight({ gate, toolchain, run, home });
  assert.equal(receipt.status, "ready");
  assert.equal(receipt.clients[0].observedExtensionVersion, toolchain.core.vscode.installedCopilotChatVersion);

  writeFileSync(
    join(manifestDirectory, "package.json"),
    `${JSON.stringify({ name: "copilot-chat", publisher: "Other", version: "0.66.0" })}\n`,
  );
  assert.throws(() => buildOptimizationClientPreflight({ gate, toolchain, run, home }), /manifest is invalid/u);
});

test("preflight accepts newer VS Code and records the observed Copilot Chat version", () => {
  const [major, minor] = toolchain.core.vscode.minimumSupportedVersion.split(".").map(Number);
  const newerVersion = `${major}.${minor + 1}.0`;
  const run = commandRun({
    "git rev-parse HEAD": `${gate.candidate.commit}\n`,
    "git rev-parse HEAD^{tree}": `${gate.candidate.tree}\n`,
    "git status --porcelain --untracked-files=no": "",
    "code --version": `${newerVersion}\n`,
    "code --list-extensions --show-versions": "github.copilot-chat@0.60.0\n",
    "copilot --version": `${toolchain.core.copilotCli.selectedExactVersion}\n`,
  });
  assert.equal(buildOptimizationClientPreflight({ gate, toolchain, run }).status, "ready");
});

test("preflight reports unparseable VS Code version output without claiming it is below minimum", () => {
  const run = commandRun({
    "git rev-parse HEAD": `${gate.candidate.commit}\n`,
    "git rev-parse HEAD^{tree}": `${gate.candidate.tree}\n`,
    "git status --porcelain --untracked-files=no": "",
    "code --version": "unparseable\n",
    "code --list-extensions --show-versions": "github.copilot-chat@0.60.0\n",
    "copilot --version": `${toolchain.core.copilotCli.selectedExactVersion}\n`,
  });
  const receipt = buildOptimizationClientPreflight({ gate, toolchain, run });
  assert.equal(receipt.clients[0].status, "version-unavailable");
  assert.match(receipt.clients[0].reason, /unavailable/);
});
