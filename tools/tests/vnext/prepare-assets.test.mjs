import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  canonicalJson,
  pinSourceRoot,
  readSourceFile,
  renderClientAgentProjection,
  validateBundleDeclarations,
  validateClientProjectionDeclarations,
} from "../../../packages/cli/scripts/prepare-assets.mjs";

test("asset generator canonical JSON ignores object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, x: "value" } }),
    canonicalJson({ a: { x: "value", y: true }, z: 1 }),
  );
});

test("asset generator refuses a source replaced by a symlink before open", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-asset-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.txt");
  const outside = join(root, "outside.txt");
  await writeFile(source, "expected\n");
  await writeFile(outside, "outside\n");

  await assert.rejects(
    readSourceFile(root, source, async () => {
      await unlink(source);
      await symlink(outside, source);
    }),
    /ELOOP|symbolic link|symlink/iu,
  );
});

test("asset generator refuses a parent directory replaced before open", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-asset-parent-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, "parent");
  const moved = join(root, "moved");
  await mkdir(parent);
  await writeFile(join(parent, "source.txt"), "expected\n");
  await assert.rejects(
    readSourceFile(root, join(parent, "source.txt"), async () => {
      await rename(parent, moved);
      await mkdir(parent);
      await writeFile(join(parent, "source.txt"), "outside\n");
    }),
    /changed during generation/,
  );
});

test("asset generator refuses a source root replaced before pinning completes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-asset-root-"));
  const moved = `${root}-moved`;
  context.after(() => rm(root, { recursive: true, force: true }));
  context.after(() => rm(moved, { recursive: true, force: true }));
  await assert.rejects(
    pinSourceRoot(root, async () => {
      await rename(root, moved);
      await mkdir(root);
    }),
    /directory changed during generation/,
  );
});

test("asset generator rejects inconsistent bundle declarations", () => {
  const customization = {
    version: "0.10.0",
    bundle: {
      id: "apex-managed-workspace",
      authority: "npm:@apex/cli",
      composition: "copy-tree",
      sourceRoot: "customizations",
      generatedRoot: "customizations",
    },
  };
  const runtime = {
    schemaVersion: "1.0.0",
    bundleVersion: "0.10.0",
    components: {
      customizationBundle: {
        version: "0.10.0",
        manifest: "@apex/cli/assets/customizations/manifest.json",
        assetManifest: "@apex/cli/assets/manifest.json",
        compositionId: "apex-managed-workspace",
      },
    },
  };
  assert.equal(validateBundleDeclarations(customization, runtime).authority, "npm:@apex/cli");
  const missingVersions = structuredClone(runtime);
  delete missingVersions.schemaVersion;
  assert.throws(() => validateBundleDeclarations(customization, missingVersions), /declarations are inconsistent/);
  runtime.components.customizationBundle.compositionId = "other";
  assert.throws(() => validateBundleDeclarations(customization, runtime), /declarations are inconsistent/);
});

test("asset generator rejects malformed and duplicate client projection declarations", () => {
  const valid = {
    sharedFiles: [".github/copilot-instructions.md"],
    clientProjections: [
      {
        id: "github-copilot-vscode",
        generatedRoot: "client-projections/github-copilot-vscode",
        files: [".vscode/mcp.json"],
      },
      {
        id: "github-copilot-cli",
        generatedRoot: "client-projections/github-copilot-cli",
        files: [".github/mcp.json"],
      },
    ],
    roles: [{ id: "coordinator", source: ".github/agents/apex.agent.md", agent: "APEX" }],
  };
  assert.deepEqual(validateClientProjectionDeclarations(valid), valid);
  for (const mutate of [
    (manifest) => {
      manifest.sharedFiles.push(manifest.sharedFiles[0]);
    },
    (manifest) => {
      manifest.clientProjections[0].files = ".vscode/mcp.json";
    },
    (manifest) => {
      manifest.clientProjections[0].files.push(manifest.clientProjections[0].files[0]);
    },
    (manifest) => {
      manifest.clientProjections[1].id = manifest.clientProjections[0].id;
    },
    (manifest) => {
      manifest.roles.push({ id: "other", source: ".github/agents/other.agent.md", agent: "APEX" });
    },
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(() => validateClientProjectionDeclarations(invalid), /declarations are invalid/);
  }
});

test("asset generator renders client-valid Requirements projections from one shared body", () => {
  const source = `---
name: APEX Requirements
description: Gather requirements.
argument-hint: Describe the workload
model: ["Claude Sonnet 5"]
user-invocable: true
tools:
  - vscode/askQuestions
  - agent
  - apex/status
  - apex/recordInput
agents:
  - APEX Reviewer
handoffs:
  - label: Continue
    agent: APEX Architect
    prompt: "Input: requirements. Output: architecture."
    send: true
---

## Role

Gather requirements through the kernel.
`;
  const vscode = renderClientAgentProjection(source, "github-copilot-vscode");
  const cli = renderClientAgentProjection(source, "github-copilot-cli");
  assert.match(vscode, /vscode\/askQuestions/u);
  assert.match(vscode, /handoffs:/u);
  assert.match(vscode, /agents:/u);
  assert.match(vscode, /model:\n\s+- Claude Sonnet 5/u);
  assert.match(cli, /\n\s+- ask_user/u);
  assert.match(cli, /\n\s+- task/u);
  assert.match(cli, /model: Claude Sonnet 5/u);
  assert.match(cli, /disable-model-invocation: false/u);
  assert.doesNotMatch(cli, /vscode\/askQuestions|handoffs:|agents:|argument-hint:/u);
  const marker = "<!-- apex-shared-body -->";
  assert.equal(vscode.slice(vscode.indexOf(marker)), cli.slice(cli.indexOf(marker)));
  assert.notEqual(vscode, cli);
});

test("CLI projection keeps hidden workers noninteractive and rejects unpinned APEX operations", () => {
  const hidden = `---
name: APEX Validator
description: Validate one result.
model: ["Claude Sonnet 5"]
user-invocable: false
disable-model-invocation: true
tools:
  - apex/status
---

## Role

Validate one result.
`;
  const rendered = renderClientAgentProjection(hidden, "github-copilot-cli", {
    interactiveTools: { askUser: "ask_user", delegate: "task" },
    workspaceServer: "apex",
    operationIds: ["status"],
  });
  assert.match(rendered, /user-invocable: false/u);
  assert.match(rendered, /disable-model-invocation: true/u);
  assert.doesNotMatch(rendered, /ask_user|\n\s+- task/u);
  assert.throws(
    () =>
      renderClientAgentProjection(hidden.replace("apex/status", "apex/unknown"), "github-copilot-cli", {
        interactiveTools: { askUser: "ask_user", delegate: "task" },
        workspaceServer: "apex",
        operationIds: ["status"],
      }),
    /Unpinned CLI APEX operation/u,
  );
});

test("asset generator rejects unsafe projection roots before generation", () => {
  const base = {
    sharedFiles: [".github/copilot-instructions.md"],
    clientProjections: [
      {
        id: "github-copilot-vscode",
        generatedRoot: "client-projections/github-copilot-vscode",
        files: [".vscode/mcp.json"],
      },
      {
        id: "github-copilot-cli",
        generatedRoot: "client-projections/github-copilot-cli",
        files: [".github/mcp.json"],
      },
    ],
    roles: [{ id: "coordinator", source: ".github/agents/apex.agent.md", agent: "APEX" }],
  };
  for (const root of ["../escaped", "/absolute", "client-projections\\windows", "client-projections/../escape"]) {
    const invalid = structuredClone(base);
    invalid.clientProjections[0].generatedRoot = root;
    assert.throws(() => validateClientProjectionDeclarations(invalid), /declarations are invalid/u);
  }
});

test("CLI coordinator receives task delegation from semantic invocation edges", () => {
  const source = `---
name: APEX
description: Coordinate workflow.
model: ["MAI-Code-1-Flash"]
user-invocable: true
tools:
  - vscode/askQuestions
  - apex/status
---

## Role

Coordinate.
`;
  const rendered = renderClientAgentProjection(
    source,
    "github-copilot-cli",
    {
      interactiveTools: { askUser: "ask_user", delegate: "task" },
      workspaceServer: "apex",
      operationIds: ["status"],
    },
    { delegates: true },
  );
  assert.match(rendered, /\n\s+- task/u);
});
