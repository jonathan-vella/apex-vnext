import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { npmCommand } from "../../scripts/npm-command.mjs";

async function fakeNode() {
  const root = await mkdtemp(join(tmpdir(), "apex-npm-command-"));
  const cli = join(root, "node_modules", "npm", "bin", "npm-cli.js");
  await mkdir(join(root, "node_modules", "npm", "bin"), { recursive: true });
  await writeFile(cli, "");
  return { root, cli, execPath: join(root, "node.exe") };
}

test("npmCommand runs npm's CLI script with the current Node binary when npm_execpath is set", async () => {
  const { root, cli, execPath } = await fakeNode();
  try {
    assert.deepEqual(npmCommand(["run", "x"], { env: { npm_execpath: cli }, execPath }), [execPath, [cli, "run", "x"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("npmCommand finds the npm CLI beside Node when npm_execpath is absent", async () => {
  const { root, cli, execPath } = await fakeNode();
  try {
    assert.deepEqual(npmCommand(["ci"], { env: {}, execPath }), [execPath, [cli, "ci"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("npmCommand falls back to the npm executable when no CLI script exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-npm-command-"));
  try {
    assert.deepEqual(
      npmCommand(["ci"], { env: { npm_execpath: join(root, "missing.js") }, execPath: join(root, "node") }),
      ["npm", ["ci"]],
    );
    assert.deepEqual(npmCommand(["ci"], { env: { npm_execpath: "/usr/bin/npm" }, execPath: join(root, "node") }), [
      "npm",
      ["ci"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
