import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { ApexError } from "../errors.js";
import { ApexService } from "../service.js";
import { tempRoot } from "./helpers.js";

test("init installs and update refreshes managed customizations", async () => {
  const root = await tempRoot();
  const source = await tempRoot();
  await mkdir(join(source, ".github"), { recursive: true });
  await writeFile(join(source, ".github", "managed.md"), "v1\n");
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner", customizationsSource: source });
  const assertPortableLock = async () => {
    const lock = JSON.parse(await readFile(join(root, ".apex", "customizations.lock.json"), "utf8")) as {
      files: Array<{ path: string; baseRef: string }>;
      runtime: Array<{ path: string; baseRef: string }>;
      previousLockRef?: string;
    };
    assert.ok(lock.files.some(({ path }) => path === ".github/managed.md"));
    for (const file of [...lock.files, ...lock.runtime]) {
      assert.equal(file.path.includes("\\"), false);
      assert.equal(file.baseRef.includes("\\"), false);
      assert.match(file.baseRef, /^\.apex\/customization-bases\//u);
    }
    if (lock.previousLockRef !== undefined) {
      assert.match(lock.previousLockRef, /^\.apex\/customization-bases\/locks\/[a-f0-9]+\.json$/u);
    }
    const doctor = await service.doctor();
    const managedChecks = doctor.checks.filter(({ id }) => id.startsWith("managed:") || id === "managed-files");
    assert.ok(managedChecks.length > 0);
    assert.ok(managedChecks.every(({ ok }) => ok));
  };
  await assertPortableLock();
  const runtimeLockHash = (await service.status()).run.runtimeLockHash;
  assert.equal(await readFile(join(root, ".github", "managed.md"), "utf8"), "v1\n");
  await writeFile(join(source, ".github", "managed.md"), "v2\n");
  await service.update(source);
  await assertPortableLock();
  assert.equal(await readFile(join(root, ".github", "managed.md"), "utf8"), "v2\n");
  assert.equal((await service.status()).run.runtimeLockHash, runtimeLockHash);
  assert.deepEqual((await service.rollbackCustomizations()).conflicts, []);
  await assertPortableLock();
  assert.equal(await readFile(join(root, ".github", "managed.md"), "utf8"), "v1\n");
  assert.equal((await service.nextTask()).status, "needs_input");
});

const THIN_PROJECTION = [
  ".github/copilot-instructions.md",
  ".github/copilot/settings.json",
  ".github/instructions/apex-agent-authoring.instructions.md",
  ".github/instructions/apex-artifact-contracts.instructions.md",
  ".github/instructions/apex-automation.instructions.md",
  ".github/instructions/apex-azure-yaml.instructions.md",
  ".github/instructions/apex-bicep.instructions.md",
  ".github/instructions/apex-code-quality.instructions.md",
  ".github/instructions/apex-context.instructions.md",
  ".github/instructions/apex-documentation.instructions.md",
  ".github/instructions/apex-governance.instructions.md",
  ".github/instructions/apex-instruction-authoring.instructions.md",
  ".github/instructions/apex-javascript.instructions.md",
  ".github/instructions/apex-json.instructions.md",
  ".github/instructions/apex-markdown.instructions.md",
  ".github/instructions/apex-powershell.instructions.md",
  ".github/instructions/apex-prompt-authoring.instructions.md",
  ".github/instructions/apex-python.instructions.md",
  ".github/instructions/apex-safe-file-edits.instructions.md",
  ".github/instructions/apex-safe-shell.instructions.md",
  ".github/instructions/apex-shell.instructions.md",
  ".github/instructions/apex-skill-authoring.instructions.md",
  ".github/instructions/apex-terraform.instructions.md",
  ".github/workflows/governance-policy-baseline.yml",
  "tools/schemas/governance-baseline.schema.json",
  "tools/scripts/collect-governance-baseline.ps1",
];

const PLUGIN_SETTINGS = {
  enabledPlugins: { "apex@apex-plugins": true },
  extraKnownMarketplaces: {
    "apex-plugins": { source: { source: "github", repo: "jonathan-vella/apex-plugins" } },
  },
};

interface TestLock {
  clientId?: string;
  files: Array<{ path: string; sourceHash: string; baseHash: string; currentHash: string; baseRef?: string }>;
  runtime: Array<{ sourceHash: string }>;
  externallyManaged?: {
    class: string;
    owner: string;
    files: string[];
    directories: string[];
    retained: Array<{ path: string; currentHash: string }>;
  };
  previousLockRef?: string;
}

async function workspaceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(root, path).split(sep).join("/");
      if (name === ".apex" || name === ".git") continue;
      if (entry.isDirectory()) await visit(path);
      else files.push(name);
    }
  };
  await visit(root);
  return files.sort();
}

async function readLock(root: string): Promise<TestLock> {
  return JSON.parse(await readFile(join(root, ".apex", "customizations.lock.json"), "utf8")) as TestLock;
}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Rewrites a thin workspace into the shape the previous (thick) projection installed: copies plus lock entries. */
async function simulateThickProjection(root: string, copies: Record<string, string>): Promise<void> {
  const lockPath = join(root, ".apex", "customizations.lock.json");
  const lock = await readLock(root);
  for (const [path, content] of Object.entries(copies)) {
    const hash = sha256(content);
    const baseRef = `.apex/customization-bases/${hash}/customization/${path}`;
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
    await mkdir(join(root, baseRef, ".."), { recursive: true });
    await writeFile(join(root, baseRef), content);
    lock.files.push({ path, sourceHash: hash, baseHash: hash, currentHash: hash, baseRef });
  }
  lock.files = lock.files.filter(({ path }) => path !== ".github/copilot/settings.json");
  await rm(join(root, ".github", "copilot", "settings.json"));
  delete lock.externallyManaged;
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

const THICK_COPIES = {
  ".github/agents/apex.agent.md": "---\nname: APEX\ndescription: Thick copy\n---\n\nBody\n",
  ".github/agents/apex-codegen.agent.md": "---\nname: APEX CodeGen\ndescription: Thick copy\n---\n\nBody\n",
  ".github/skills/apex-next/SKILL.md": "---\nname: apex-next\ndescription: Thick copy\n---\n\nBody\n",
  ".mcp.json": '{"mcpServers":{"apex":{"type":"local","command":"npx"}}}\n',
};

test("init writes only the thin projection with plugin settings and no plugin-owned copies", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  assert.deepEqual(await workspaceFiles(root), THIN_PROJECTION);
  assert.deepEqual(
    JSON.parse(await readFile(join(root, ".github", "copilot", "settings.json"), "utf8")),
    PLUGIN_SETTINGS,
  );
  for (const retired of [".mcp.json", ".github/agents", ".github/skills", ".vscode/mcp.json", ".github/mcp.json"])
    await assert.rejects(lstat(join(root, retired)), { code: "ENOENT" });
  for (const path of THIN_PROJECTION.filter((file) => file.startsWith(".github/instructions/")))
    assert.match(await readFile(join(root, path), "utf8"), /^---\n[\s\S]*?^applyTo: "[^"]+"$/mu, path);
  assert.match(
    await readFile(join(root, ".github", "instructions", "apex-terraform.instructions.md"), "utf8"),
    /APEX Terraform Rules/u,
  );
  assert.equal(
    await readFile(join(root, ".apex", ".gitignore"), "utf8"),
    "/cache/\n/local/\n/work/\n/runtime/capability-packs/\n",
  );
  assert.match(await readFile(join(root, ".apex", "runtime", "workflow.v1.json"), "utf8"), /apex-workflow-v1/);
  const registry = JSON.parse(
    await readFile(join(root, ".apex", "runtime", "capability-packs.registry.json"), "utf8"),
  ) as { packs: Array<{ id: string }> };
  assert.deepEqual(registry.packs, []);
  const lock = await readLock(root);
  assert.equal(lock.clientId, "github-copilot-cli");
  assert.deepEqual(lock.files.map(({ path }) => path).sort(), THIN_PROJECTION);
  assert.ok([...lock.files, ...lock.runtime].every(({ sourceHash }) => /^[a-f0-9]{64}$/.test(sourceHash)));
  assert.deepEqual(lock.externallyManaged, {
    class: "externally-managed",
    owner: "apex@apex-plugins",
    files: [".mcp.json"],
    directories: [".github/agents", ".github/skills"],
    retained: [],
  });
  const doctor = await service.doctor();
  assert.ok(doctor.checks.filter(({ id }) => id.startsWith("managed:")).every(({ ok }) => ok));
  assert.equal(
    doctor.checks.some(({ id }) => id.startsWith("plugin-owned:")),
    false,
  );
  await writeFile(join(root, "unrelated.txt"), "preserve\n");
  assert.deepEqual(await service.update(), { updated: lock.files.map(({ path }) => path), retired: [], conflicts: [] });
  assert.deepEqual((await service.rollbackCustomizations()).conflicts, []);
  assert.deepEqual((await service.uninstallCustomizations()).conflicts, []);
  assert.equal(await readFile(join(root, "unrelated.txt"), "utf8"), "preserve\n");
  await assert.rejects(lstat(join(root, ".github", "copilot", "settings.json")), { code: "ENOENT" });
  assert.equal((await service.reinstallCustomizations()).clientId, "github-copilot-cli");
  assert.deepEqual(
    (await workspaceFiles(root)).filter((path) => path !== "unrelated.txt"),
    THIN_PROJECTION,
  );
});

test("customization sources cannot reintroduce plugin-owned agents, skills or MCP config", async () => {
  for (const path of [".github/agents/apex.agent.md", ".github/skills/apex-next/SKILL.md", ".mcp.json"]) {
    const root = await tempRoot();
    const source = await tempRoot();
    await mkdir(join(source, path, ".."), { recursive: true });
    await writeFile(join(source, path), "copy\n");
    await assert.rejects(
      new ApexService(root).init({ projectId: "demo", riskOwner: "partner", customizationsSource: source }),
      (error: unknown) =>
        error instanceof ApexError && error.code === "APEX_VALIDATION" && error.message.includes("plugin provides it"),
    );
    await assert.rejects(lstat(join(root, path)), { code: "ENOENT" });
    await assert.rejects(lstat(join(root, ".apex")), { code: "ENOENT" });
  }
});

test("update retires untouched thick-projection copies and keeps edited ones as reported conflicts", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  await simulateThickProjection(root, THICK_COPIES);
  const edited = ".github/agents/apex-codegen.agent.md";
  const editedContent = `${THICK_COPIES[edited]}\nMy local edit\n`;
  await writeFile(join(root, edited), editedContent);
  await mkdir(join(root, ".github", "agents"), { recursive: true });
  await writeFile(join(root, ".github", "agents", "my-own.agent.md"), "user agent\n");

  const before = await service.doctor();
  assert.deepEqual(
    before.checks
      .filter(({ id, ok }) => id.startsWith("plugin-owned:") && !ok)
      .map(({ id }) => id)
      .sort(),
    Object.keys(THICK_COPIES)
      .map((path) => `plugin-owned:${path}`)
      .sort(),
  );

  const result = await service.update();
  assert.deepEqual(result.retired, [".github/agents/apex.agent.md", ".github/skills/apex-next/SKILL.md", ".mcp.json"]);
  assert.deepEqual(result.conflicts, [edited]);
  for (const path of result.retired) await assert.rejects(lstat(join(root, path)), { code: "ENOENT" });
  assert.equal(await readFile(join(root, edited), "utf8"), editedContent);
  assert.equal(await readFile(join(root, ".github", "agents", "my-own.agent.md"), "utf8"), "user agent\n");
  assert.deepEqual(
    JSON.parse(await readFile(join(root, ".github", "copilot", "settings.json"), "utf8")),
    PLUGIN_SETTINGS,
  );
  const lock = await readLock(root);
  assert.deepEqual(lock.files.map(({ path }) => path).sort(), THIN_PROJECTION);
  assert.equal(lock.externallyManaged?.class, "externally-managed");
  assert.deepEqual(lock.externallyManaged?.retained, [{ path: edited, currentHash: sha256(editedContent) }]);

  const rollback = await service.rollbackCustomizations();
  assert.deepEqual(rollback.conflicts, []);
  assert.equal(
    await readFile(join(root, ".github", "agents", "apex.agent.md"), "utf8"),
    THICK_COPIES[".github/agents/apex.agent.md"],
  );
  assert.equal(await readFile(join(root, edited), "utf8"), editedContent);
  assert.equal((await readLock(root)).externallyManaged, undefined);
  assert.deepEqual((await service.update()).conflicts, [edited]);

  const doctor = await service.doctor(true, true);
  for (const path of result.retired) await assert.rejects(lstat(join(root, path)), { code: "ENOENT" });
  assert.equal(await readFile(join(root, edited), "utf8"), editedContent);
  const pluginChecks = doctor.checks.filter(({ id }) => id.startsWith("plugin-owned:"));
  assert.deepEqual(
    pluginChecks.map(({ id, ok }) => ({ id, ok })),
    [{ id: `plugin-owned:${edited}`, ok: false }],
  );
  assert.match(pluginChecks[0]!.remedy ?? "", /plugin provides this file/u);
  assert.ok(doctor.checks.filter(({ id }) => id.startsWith("managed:")).every(({ ok }) => ok));

  await rm(join(root, edited));
  const cleared = await service.update();
  assert.deepEqual(cleared.conflicts, []);
  assert.deepEqual((await readLock(root)).externallyManaged?.retained, []);
  assert.equal(
    (await service.doctor()).checks.some(({ id }) => id.startsWith("plugin-owned:")),
    false,
  );
  const uninstall = await service.uninstallCustomizations();
  assert.deepEqual(uninstall.conflicts, []);
  assert.equal(await readFile(join(root, ".github", "agents", "my-own.agent.md"), "utf8"), "user agent\n");
});

test("doctor --fix migrates a thick workspace without recopying plugin-owned files", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.initializeWorkspace({});
  await simulateThickProjection(root, THICK_COPIES);
  const edited = ".mcp.json";
  await writeFile(join(root, edited), '{"mcpServers":{"mine":{}}}\n');
  await rm(join(root, ".github", "agents", "apex.agent.md"));
  const doctor = await service.doctor(true, true);
  assert.deepEqual(await workspaceFiles(root), [...THIN_PROJECTION, edited].sort());
  assert.equal(await readFile(join(root, edited), "utf8"), '{"mcpServers":{"mine":{}}}\n');
  assert.deepEqual(
    doctor.checks.filter(({ id }) => id.startsWith("plugin-owned:")).map(({ id }) => id),
    [`plugin-owned:${edited}`],
  );
  const lock = await readLock(root);
  assert.deepEqual(
    lock.externallyManaged?.retained.map(({ path }) => path),
    [edited],
  );
  assert.equal(
    lock.files.some(({ path }) => path.startsWith(".github/agents/") || path === edited),
    false,
  );
});

test("missing customization selection fails closed and custom sources require explicit updates", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  await rm(join(root, ".apex", "customizations.selection.json"));
  await assert.rejects(service.update(), /Customization selection is missing/);
  await assert.rejects(service.reinstallCustomizations(), /Customization selection is missing/);
  await assert.rejects(service.doctor(true, true), /Customization selection is missing/);
  assert.ok(await stat(join(root, ".github", "copilot", "settings.json")));

  const customRoot = await tempRoot();
  const customSource = await tempRoot();
  await writeFile(join(customSource, "custom.txt"), "custom\n");
  const custom = new ApexService(customRoot);
  await custom.init({ projectId: "custom", riskOwner: "partner", customizationsSource: customSource });
  await assert.rejects(custom.update(), (error: unknown) => error instanceof ApexError && error.code === "APEX_USAGE");
  await assert.rejects(
    custom.doctor(true, true),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_USAGE",
  );
  assert.equal(await readFile(join(customRoot, "custom.txt"), "utf8"), "custom\n");
  await custom.uninstallCustomizations();
  await custom.reinstallCustomizations(customSource);
  assert.equal(await readFile(join(customRoot, "custom.txt"), "utf8"), "custom\n");
});

test("rollback and recovery reject lock-controlled path escapes", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const lockPath = join(root, ".apex", "customizations.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
  await writeFile(lockPath, `${JSON.stringify({ ...lock, previousLockRef: "../outside.json" })}\n`);
  await assert.rejects(
    service.rollbackCustomizations(),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );

  const pointer = join(root, ".apex", "local", "customization-transaction.json");
  await mkdir(join(root, ".apex", "local"), { recursive: true });
  await writeFile(pointer, `${JSON.stringify({ transactionPath: join(root, "outside-transaction.json") })}\n`);
  await writeFile(
    join(root, "outside-transaction.json"),
    `${JSON.stringify({ version: 1, status: "applying", entries: [] })}\n`,
  );
  await assert.rejects(service.uninstallCustomizations(), /escapes|unsafe|outside/iu);
});

test("update rejects lock-controlled customization base escapes", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const lockPath = join(root, ".apex", "customizations.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    files: Array<{ path: string; baseRef?: string }>;
  };
  const instructions = lock.files.find(({ path }) => path === ".github/copilot-instructions.md")!;
  instructions.baseRef = "../outside-review.txt";
  await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
  await writeFile(join(root, ".github", "copilot-instructions.md"), "local edit\n");
  await assert.rejects(
    service.update(),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
});

test("doctor does not read lock-controlled paths outside the workspace", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const outside = join(root, "..", "doctor-outside.txt");
  await writeFile(outside, "external sentinel\n");
  const outsideHash = createHash("sha256")
    .update(await readFile(outside))
    .digest("hex");
  const lockPath = join(root, ".apex", "customizations.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as { files: Array<{ path: string }> };
  lock.files[0]!.path = "../doctor-outside.txt";
  await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
  const result = await service.doctor();
  assert.equal(
    result.checks.some(({ value }) => value === outsideHash),
    false,
  );
  assert.match(result.checks.find(({ id }) => id === "managed-files")?.value ?? "", /unsafe/u);
  await rm(outside, { force: true });
});

test("update refuses local managed-file conflicts", async () => {
  const root = await tempRoot();
  const source = await tempRoot();
  await writeFile(join(source, "managed.txt"), "base\n");
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner", customizationsSource: source });
  await writeFile(join(root, "managed.txt"), "local\n");
  await writeFile(join(source, "managed.txt"), "upstream\n");
  await assert.rejects(
    service.update(source),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_CONFLICT",
  );
});

test("update rolls back every managed file after an injected apply failure", async () => {
  const root = await tempRoot();
  const source = await tempRoot();
  await writeFile(join(source, "a.txt"), "a1\n");
  await writeFile(join(source, "b.txt"), "b1\n");
  await new ApexService(root).init({ projectId: "demo", riskOwner: "partner", customizationsSource: source });
  await writeFile(join(source, "a.txt"), "a2\n");
  await writeFile(join(source, "b.txt"), "b2\n");
  const failing = new ApexService(root, {
    customizationFailureInjector: (index) => {
      if (index === 1) throw new Error("injected-update-failure");
    },
  });
  await assert.rejects(failing.update(source), /injected-update-failure/);
  assert.equal(await readFile(join(root, "a.txt"), "utf8"), "a1\n");
  assert.equal(await readFile(join(root, "b.txt"), "utf8"), "b1\n");
});

test("update merges nonoverlapping text changes and deletes unchanged removed files", async () => {
  const root = await tempRoot();
  const source = await tempRoot();
  await writeFile(join(source, "managed.txt"), "one\ntwo\nthree\n");
  await writeFile(join(source, "removed.txt"), "remove\n");
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner", customizationsSource: source });
  await writeFile(join(root, "managed.txt"), "ONE\ntwo\nthree\n");
  await writeFile(join(source, "managed.txt"), "one\ntwo\nTHREE\n");
  await import("node:fs/promises").then(({ rm }) => rm(join(source, "removed.txt")));
  await service.update(source);
  assert.equal(await readFile(join(root, "managed.txt"), "utf8"), "ONE\ntwo\nTHREE\n");
  await assert.rejects(stat(join(root, "removed.txt")), /ENOENT/);
});

test("customization install rejects symlinked destination ancestors", async () => {
  const root = await tempRoot();
  const source = await tempRoot();
  const outside = await tempRoot();
  await mkdir(join(source, ".github"), { recursive: true });
  await writeFile(join(source, ".github", "managed.md"), "managed\n");
  await symlink(outside, join(root, ".github"));
  await assert.rejects(
    new ApexService(root).init({ projectId: "demo", riskOwner: "partner", customizationsSource: source }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
  await assert.rejects(stat(join(outside, "managed.md")), /ENOENT/);
});

test("rollback restores the prior bundle and uninstall preserves modified files and project history", async () => {
  const root = await tempRoot();
  const source = await tempRoot();
  await writeFile(join(source, "managed.txt"), "v1\n");
  await writeFile(join(source, "modified.txt"), "v1\n");
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner", customizationsSource: source });
  await writeFile(join(source, "managed.txt"), "v2\n");
  await writeFile(join(source, "modified.txt"), "v2\n");
  await service.update(source);
  assert.deepEqual((await service.rollbackCustomizations()).conflicts, []);
  assert.equal(await readFile(join(root, "managed.txt"), "utf8"), "v1\n");
  await writeFile(join(root, "modified.txt"), "local\n");
  const uninstall = await service.uninstallCustomizations();
  assert(uninstall.removed.includes("managed.txt"));
  assert(uninstall.conflicts.includes("modified.txt"));
  assert.equal(await readFile(join(root, "modified.txt"), "utf8"), "local\n");
  assert.equal((await service.status()).run.projectId, "demo");
  assert.equal(await stat(join(root, ".apex", "runtime")).then(() => true), true);
});

test("init refuses to overwrite an unrelated workspace file", async () => {
  const root = await tempRoot();
  const source = await tempRoot();
  await writeFile(join(source, "managed.txt"), "managed\n");
  await writeFile(join(root, "managed.txt"), "unrelated\n");
  await assert.rejects(
    new ApexService(root).init({ projectId: "demo", riskOwner: "partner", customizationsSource: source }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_CONFLICT",
  );
  assert.equal(await readFile(join(root, "managed.txt"), "utf8"), "unrelated\n");
});

test("promotion invalidates environment-specific gates when target scope changes", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const state = await service.status();
  const runPath = join(service.root, ".apex", "projects", "demo", "runs", state.run.runId, "run.json");
  const approved = {
    ...state.run,
    gates: state.run.gates.map((gate) => ({
      ...gate,
      state: "approved" as const,
      decidedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
  await writeFile(runPath, JSON.stringify(approved));
  const promoted = await service.promote("prod", "subscription/prod");
  assert.deepEqual(
    promoted.gates.map((gate) => gate.state),
    ["inherited", "closed", "closed", "closed"],
  );
});

test("doctor previews remedies without applying fixes", async () => {
  const result = await new ApexService(await tempRoot()).doctor(true, false);
  assert.equal(result.healthy, false);
  assert.match(result.remedies.join(" "), /Preview: Run apex init/);
});

test("update rejects and doctor repairs a modified local Git boundary", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const boundary = join(root, ".apex", ".gitignore");
  await writeFile(boundary, "/local/\n");
  await assert.rejects(service.update(), /local Git boundary was modified/);
  const doctor = await service.doctor();
  const boundaryCheck = doctor.checks.find(({ id }) => id === "local-git-boundary");
  assert.equal(boundaryCheck?.ok, false);
  assert.match(boundaryCheck?.value ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(boundaryCheck?.value, "/local/\n");
  await service.doctor(true, true);
  assert.equal(await readFile(boundary, "utf8"), "/cache/\n/local/\n/work/\n/runtime/capability-packs/\n");
});

test("init writes a real runtime lock and doctor detects managed tampering", async () => {
  const root = await tempRoot();
  const service = new ApexService(root, {
    executableChecker: async () => true,
    azureAuthStatus: async () => ({ authenticated: true, detail: "injected" }),
  });
  const initialized = await service.init({ projectId: "demo", riskOwner: "partner" });
  const lockBytes = await readFile(join(root, ".apex", "apex.lock.json"));
  const lock = JSON.parse(lockBytes.toString("utf8")) as {
    workflowHash: string;
    defaultsHash: string;
    validatorHash: string;
    qualityScorecardHash: string;
    requiredCapabilityPacks: string[];
  };
  assert.ok(
    [lock.workflowHash, lock.defaultsHash, lock.validatorHash, lock.qualityScorecardHash].every((hash) =>
      /^[a-f0-9]{64}$/.test(hash),
    ),
  );
  assert.deepEqual(lock.requiredCapabilityPacks, []);
  assert.equal((await service.status()).run.runId, initialized.runId);
  await writeFile(join(root, ".apex", "runtime", "defaults.v1.json"), "{}\n");
  const doctor = await service.doctor();
  assert.equal(doctor.healthy, false);
  assert.equal(doctor.checks.find(({ id }) => id === "runtime-lock:defaults")?.ok, true);
  assert.equal(doctor.checks.find(({ id }) => id === "managed:.apex/runtime/defaults.v1.json")?.ok, false);
  assert.equal(doctor.nextAction, "Run doctor --fix --yes to reinstall bundled managed files");
  const fixed = await service.doctor(true, true);
  assert.equal(fixed.checks.find(({ id }) => id === "runtime-lock:defaults")?.ok, true);
  await writeFile(join(root, ".apex", "runtime", "quality-scorecard.v1.json"), "{}\n");
  const scorecardDoctor = await service.doctor();
  assert.equal(scorecardDoctor.checks.find(({ id }) => id === "runtime-lock:quality-scorecard")?.ok, true);
  assert.equal(
    scorecardDoctor.checks.find(({ id }) => id === "managed:.apex/runtime/quality-scorecard.v1.json")?.ok,
    false,
  );
});

test("existing runs use their immutable runtime generation", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const initial = await service.status();
  const generation = join(root, ".apex", "runtime-generations", initial.run.runtimeLockHash);
  assert.equal(
    JSON.parse(await readFile(join(generation, "apex.lock.json"), "utf8")).workflowHash,
    JSON.parse(await readFile(join(root, ".apex", "apex.lock.json"), "utf8")).workflowHash,
  );

  await writeFile(join(root, ".apex", "runtime", "workflow.v1.json"), "{}\n");
  assert.equal((await service.status()).run.runId, initial.run.runId);
  assert.equal((await service.nextTask()).status, "needs_input");
});

test("doctor and core routes work without shipped governance discovery packs", async () => {
  const root = await tempRoot();
  const service = new ApexService(root, {
    executableChecker: async () => true,
    azureAuthStatus: async () => ({ authenticated: true, detail: "injected" }),
  });
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  const initial = await service.doctor();
  assert.equal(
    initial.checks.some(({ id }) => id.startsWith("capability-pack:")),
    false,
  );
  assert.equal(runId.length > 0, true);
  await assert.rejects(service.capabilityStatus("azure-governance-discovery"));
  const listed = (await service.capabilityList()) as Array<{ id: string; state: string }>;
  assert.deepEqual(
    listed.map(({ id, state }) => ({ id, state })),
    [],
  );
});
