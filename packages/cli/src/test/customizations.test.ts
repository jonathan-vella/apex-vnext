import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { ApexError } from "../errors.js";
import { ApexService } from "../service.js";
import { tempRoot } from "./helpers.js";

async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const name = relative(root, path).split(sep).join("/");
      const metadata = await lstat(path);
      hash.update(metadata.isDirectory() ? `d:${name}\0` : `f:${name}\0`);
      if (metadata.isDirectory()) await visit(path);
      else hash.update(await readFile(path));
    }
  };
  await visit(root);
  return hash.digest("hex");
}

test("init installs and update refreshes managed customizations", async () => {
  const root = await tempRoot();
  const source = await tempRoot();
  await mkdir(join(source, ".github"), { recursive: true });
  await writeFile(join(source, ".github", "managed.md"), "v1\n");
  const service = new ApexService(root);
  await service.init({ projectId: "demo", customizationsSource: source });
  assert.equal(await readFile(join(root, ".github", "managed.md"), "utf8"), "v1\n");
  await writeFile(join(source, ".github", "managed.md"), "v2\n");
  await service.update(source);
  assert.equal(await readFile(join(root, ".github", "managed.md"), "utf8"), "v2\n");
});

test("init installs bundled customizations and runtime config by default", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  const coordinatorAgent = await readFile(join(root, ".github", "agents", "apex.agent.md"), "utf8");
  assert.match(coordinatorAgent, /name: APEX/u);
  assert.match(coordinatorAgent, /target: vscode/u);
  assert.match(await readFile(join(root, ".github", "agents", "apex-validator.agent.md"), "utf8"), /target: vscode/u);
  assert.match(
    await readFile(join(root, ".github", "skills", "apex-azure-defaults", "SKILL.md"), "utf8"),
    /APEX Azure Defaults/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-azure-defaults", "references", "security-baseline.md"),
      "utf8",
    ),
    /Core Controls/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-azure-defaults", "references", "decision-boundaries.md"),
      "utf8",
    ),
    /Decision Boundaries And Fallbacks/u,
  );
  assert.match(
    await readFile(join(root, ".github", "skills", "apex-microsoft-docs", "SKILL.md"), "utf8"),
    /APEX Microsoft Documentation/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-bicep-patterns", "references", "network-and-observability.md"),
      "utf8",
    ),
    /Private endpoint intent/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-bicep-patterns", "references", "compiler-and-provider-gotchas.md"),
      "utf8",
    ),
    /Exact Module Schema Wins/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-terraform-patterns", "references", "plan-and-change-assessment.md"),
      "utf8",
    ),
    /Stateful and Drift Signals/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-terraform-test", "references", "plan-mode-and-mock-design.md"),
      "utf8",
    ),
    /Plan-Mode and Mock Design/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-terraform-import", "references", "mapping-and-adoption-attestation.md"),
      "utf8",
    ),
    /Mapping and Adoption Attestation/u,
  );
  assert.match(
    await readFile(join(root, ".github", "skills", "apex-artifacts", "SKILL.md"), "utf8"),
    /APEX Artifact Presentations/u,
  );
  assert.match(
    await readFile(join(root, ".github", "skills", "apex-artifacts", "templates", "requirements.md"), "utf8"),
    /Derived from accepted APEX requirements artifact/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-artifacts", "references", "reference-only-outlines.md"),
      "utf8",
    ),
    /Reference-Only Document Outlines/u,
  );
  assert.deepEqual(JSON.parse(await readFile(join(root, ".vscode", "mcp.json"), "utf8")), {
    servers: {
      apex: {
        type: "stdio",
        command: "node",
        args: ["${workspaceFolder}/node_modules/@apexops/cli/dist/cli.js", "mcp", "serve"],
        cwd: "${workspaceFolder}",
      },
      "azure-resource-manager-mcp": {
        type: "http",
        url: "https://mcp.management.azure.com",
        headers: { "x-mcp-toolset": "CostManagement,Pricing" },
      },
      "azure-mcp-server": {
        type: "stdio",
        command: "npx",
        args: ["--yes", "@azure/mcp@3.0.0-beta.37", "server", "start"],
        cwd: "${workspaceFolder}",
      },
    },
  });
  await assert.rejects(readFile(join(root, ".github", "mcp.json"), "utf8"), /ENOENT/u);
  assert.equal(
    await readFile(join(root, ".apex", ".gitignore"), "utf8"),
    "/cache/\n/local/\n/work/\n/runtime/capability-packs/\n",
  );
  assert.match(await readFile(join(root, ".apex", "runtime", "workflow.v1.json"), "utf8"), /apex-workflow-v1/);
  const registry = JSON.parse(
    await readFile(join(root, ".apex", "runtime", "capability-packs.registry.json"), "utf8"),
  ) as {
    packs: Array<{
      id: string;
      artifact: { spec: string; digest: string };
      lock: { path?: string; digest: string; directDigest: string; transitiveDigest: string };
      script?: string;
      scriptDigest?: string;
    }>;
  };
  assert.deepEqual(
    registry.packs.map(({ id }) => id),
    ["azure-governance-discovery"],
  );
  for (const pack of registry.packs) {
    const source = join(root, ".apex", "runtime", pack.artifact.spec);
    assert.equal(await treeDigest(source), pack.artifact.digest);
    assert.ok(
      [pack.artifact.digest, pack.lock.digest, pack.lock.directDigest, pack.lock.transitiveDigest].every((digest) =>
        /^[a-f0-9]{64}$/.test(digest),
      ),
    );
    if (pack.lock.path !== undefined) {
      const lockBytes = await readFile(join(root, ".apex", "runtime", pack.lock.path));
      assert.equal(createHash("sha256").update(lockBytes).digest("hex"), pack.lock.digest);
    }
    if (pack.script !== undefined) {
      const scriptBytes = await readFile(join(source, pack.script));
      assert.equal(createHash("sha256").update(scriptBytes).digest("hex"), pack.scriptDigest);
    }
  }
  const lock = JSON.parse(await readFile(join(root, ".apex", "customizations.lock.json"), "utf8")) as {
    clientId?: string;
    files: Array<{ path: string; sourceHash: string }>;
    runtime: Array<{ sourceHash: string }>;
  };
  assert.ok([...lock.files, ...lock.runtime].every(({ sourceHash }) => /^[a-f0-9]{64}$/.test(sourceHash)));
  assert.ok(lock.files.some(({ path }) => path === ".vscode/mcp.json"));
  assert.ok(!lock.files.some(({ path }) => path === ".github/mcp.json"));
  assert.equal(lock.clientId, "github-copilot-vscode");
});

test("init installs only the selected Copilot CLI projection and records it in the lock", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", clientId: "github-copilot-cli" });
  await assert.rejects(readFile(join(root, ".vscode", "mcp.json"), "utf8"), /ENOENT/u);
  assert.match(await readFile(join(root, ".github", "mcp.json"), "utf8"), /"recordInput"/u);
  const requirementsAgent = await readFile(join(root, ".github", "agents", "apex-requirements.agent.md"), "utf8");
  assert.match(requirementsAgent, /target: github-copilot/u);
  assert.match(requirementsAgent, /model: Claude Sonnet 5/u);
  assert.match(requirementsAgent, /- ask_user/u);
  assert.match(requirementsAgent, /- task/u);
  assert.doesNotMatch(requirementsAgent, /vscode\/askQuestions|handoffs:|agents:/u);
  assert.match(
    await readFile(join(root, ".github", "skills", "apex-azure-defaults", "SKILL.md"), "utf8"),
    /APEX Azure Defaults/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-azure-defaults", "references", "security-baseline.md"),
      "utf8",
    ),
    /Core Controls/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-azure-defaults", "references", "decision-boundaries.md"),
      "utf8",
    ),
    /Decision Boundaries And Fallbacks/u,
  );
  assert.match(
    await readFile(join(root, ".github", "skills", "apex-microsoft-docs", "SKILL.md"), "utf8"),
    /APEX Microsoft Documentation/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-bicep-patterns", "references", "network-and-observability.md"),
      "utf8",
    ),
    /Private endpoint intent/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-bicep-patterns", "references", "compiler-and-provider-gotchas.md"),
      "utf8",
    ),
    /Exact Module Schema Wins/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-terraform-patterns", "references", "plan-and-change-assessment.md"),
      "utf8",
    ),
    /Stateful and Drift Signals/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-terraform-test", "references", "plan-mode-and-mock-design.md"),
      "utf8",
    ),
    /Plan-Mode and Mock Design/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-terraform-import", "references", "mapping-and-adoption-attestation.md"),
      "utf8",
    ),
    /Mapping and Adoption Attestation/u,
  );
  assert.match(
    await readFile(join(root, ".github", "skills", "apex-artifacts", "SKILL.md"), "utf8"),
    /APEX Artifact Presentations/u,
  );
  assert.match(
    await readFile(join(root, ".github", "skills", "apex-artifacts", "templates", "requirements.md"), "utf8"),
    /Derived from accepted APEX requirements artifact/u,
  );
  assert.match(
    await readFile(
      join(root, ".github", "skills", "apex-artifacts", "references", "reference-only-outlines.md"),
      "utf8",
    ),
    /Reference-Only Document Outlines/u,
  );
  for (const worker of ["apex-codegen.agent.md", "apex-reviewer.agent.md", "apex-validator.agent.md"]) {
    await assert.rejects(readFile(join(root, ".github", "agents", worker), "utf8"), /ENOENT/u);
  }
  const lock = JSON.parse(await readFile(join(root, ".apex", "customizations.lock.json"), "utf8")) as {
    clientId?: string;
    files: Array<{ path: string }>;
  };
  assert.equal(lock.clientId, "github-copilot-cli");
  assert.ok(lock.files.some(({ path }) => path === ".github/mcp.json"));
  assert.ok(!lock.files.some(({ path }) => path === ".vscode/mcp.json"));
  assert.ok(!lock.files.some(({ path }) => /apex-(?:codegen|reviewer|validator)\.agent\.md$/u.test(path)));
  await writeFile(join(root, "unrelated.txt"), "preserve\n");
  await service.update();
  const updatedLock = JSON.parse(await readFile(join(root, ".apex", "customizations.lock.json"), "utf8")) as {
    clientId?: string;
  };
  assert.equal(updatedLock.clientId, "github-copilot-cli");
  assert.deepEqual((await service.rollbackCustomizations()).conflicts, []);
  const rolledBackLock = JSON.parse(await readFile(join(root, ".apex", "customizations.lock.json"), "utf8")) as {
    clientId?: string;
  };
  assert.equal(rolledBackLock.clientId, "github-copilot-cli");
  assert.deepEqual((await service.uninstallCustomizations()).conflicts, []);
  assert.equal(await readFile(join(root, "unrelated.txt"), "utf8"), "preserve\n");
  await assert.rejects(readFile(join(root, ".github", "mcp.json"), "utf8"), /ENOENT/u);
  const reinstalled = await service.reinstallCustomizations();
  assert.equal(reinstalled.clientId, "github-copilot-cli");
  assert.match(await readFile(join(root, ".github", "mcp.json"), "utf8"), /"recordInput"/u);
  await assert.rejects(readFile(join(root, ".github", "agents", "apex-validator.agent.md"), "utf8"), /ENOENT/u);
});

test("legacy locks default to VS Code and custom sources require explicit updates", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  await rm(join(root, ".apex", "customizations.selection.json"));
  const lockPath = join(root, ".apex", "customizations.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
  delete lock.clientId;
  await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
  await service.update();
  assert.ok(await stat(join(root, ".vscode", "mcp.json")));

  const customRoot = await tempRoot();
  const customSource = await tempRoot();
  await writeFile(join(customSource, "custom.txt"), "custom\n");
  const custom = new ApexService(customRoot);
  await custom.init({ projectId: "custom", customizationsSource: customSource });
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
  await service.init({ projectId: "demo" });
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
  await service.init({ projectId: "demo" });
  const lockPath = join(root, ".apex", "customizations.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    files: Array<{ path: string; baseRef?: string }>;
  };
  const agent = lock.files.find(({ path }) => path === ".github/agents/apex.agent.md")!;
  agent.baseRef = "../outside-review.txt";
  await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
  await writeFile(join(root, ".github", "agents", "apex.agent.md"), "local edit\n");
  await assert.rejects(
    service.update(),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
});

test("doctor does not read lock-controlled paths outside the workspace", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
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
  await service.init({ projectId: "demo", customizationsSource: source });
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
  await new ApexService(root).init({ projectId: "demo", customizationsSource: source });
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
  await service.init({ projectId: "demo", customizationsSource: source });
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
    new ApexService(root).init({ projectId: "demo", customizationsSource: source }),
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
  await service.init({ projectId: "demo", customizationsSource: source });
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
    new ApexService(root).init({ projectId: "demo", customizationsSource: source }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_CONFLICT",
  );
  assert.equal(await readFile(join(root, "managed.txt"), "utf8"), "unrelated\n");
});

test("promotion invalidates environment-specific gates when target scope changes", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
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
  await service.init({ projectId: "demo" });
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
  const initialized = await service.init({ projectId: "demo" });
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
  assert.ok(lock.requiredCapabilityPacks.includes("azure-governance-discovery"));
  assert.equal((await service.status()).run.runId, initialized.runId);
  await writeFile(join(root, ".apex", "runtime", "defaults.v1.json"), "{}\n");
  const doctor = await service.doctor();
  assert.equal(doctor.healthy, false);
  assert.equal(doctor.checks.find(({ id }) => id === "runtime-lock:defaults")?.ok, false);
  assert.equal(doctor.nextAction, "Run doctor --fix --yes to reinstall bundled managed files");
  const fixed = await service.doctor(true, true);
  assert.equal(fixed.checks.find(({ id }) => id === "runtime-lock:defaults")?.ok, true);
  await writeFile(join(root, ".apex", "runtime", "quality-scorecard.v1.json"), "{}\n");
  const scorecardDoctor = await service.doctor();
  assert.equal(scorecardDoctor.checks.find(({ id }) => id === "runtime-lock:quality-scorecard")?.ok, false);
});

test("doctor leaves unrelated core routes unaffected and service reports required workflow packs", async () => {
  const root = await tempRoot();
  const service = new ApexService(root, {
    executableChecker: async () => true,
    azureAuthStatus: async () => ({ authenticated: true, detail: "injected" }),
  });
  const { runId } = await service.init({ projectId: "demo" });
  const initial = await service.doctor();
  assert.equal(
    initial.checks.some(({ id }) => id.startsWith("capability-pack:")),
    false,
  );
  assert.equal(runId.length > 0, true);
  const governance = (await service.capabilityStatus("azure-governance-discovery")) as {
    state: string;
    reason?: string;
    requiredWorkflows: string[];
    action: string;
  };
  assert.equal(governance.state, "not-installed");
  assert.equal(governance.reason, undefined);
  assert.deepEqual(governance.requiredWorkflows, [
    "governance-discovery",
    "governance-reconciliation",
    "preview-bicep",
    "preview-terraform",
  ]);
  assert.match(governance.action, /capability install/);
  const listed = (await service.capabilityList()) as Array<{ id: string; state: string }>;
  assert.deepEqual(
    listed.map(({ id, state }) => ({ id, state })),
    [{ id: "azure-governance-discovery", state: "not-installed" }],
  );
});
