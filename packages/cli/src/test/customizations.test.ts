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

test("init installs bundled customizations and runtime config by default", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const coordinatorAgent = await readFile(join(root, ".github", "agents", "apex.agent.md"), "utf8");
  assert.match(coordinatorAgent, /name: APEX/u);
  assert.match(coordinatorAgent, /target: github-copilot/u);
  assert.match(
    await readFile(join(root, ".github", "agents", "apex-validator.agent.md"), "utf8"),
    /target: github-copilot/u,
  );
  const requirementsAgent = await readFile(join(root, ".github", "agents", "apex-requirements.agent.md"), "utf8");
  assert.match(requirementsAgent, /Immediately call `apex\/nextTask` after submitting requirements/u);
  assert.match(requirementsAgent, /invoke `APEX Reviewer` through the active client's delegation tool/u);
  assert.match(requirementsAgent, /^tools:\n(?: {2}- .+\n)*? {2}- task\n/mu);
  assert.doesNotMatch(requirementsAgent, /^agents:/mu);
  await readFile(join(root, ".mcp.json"));
  assert.match(
    await readFile(join(root, ".github", "instructions", "apex-agent-authoring.instructions.md"), "utf8"),
    /APEX Agent Boundaries/u,
  );
  assert.match(
    await readFile(join(root, ".github", "instructions", "apex-terraform.instructions.md"), "utf8"),
    /APEX Terraform Rules/u,
  );
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
  const mcp = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { type: string; command?: string; args?: string[]; url?: string; tools: string[] }>;
  };
  assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ["apex", "azure-resource-manager-mcp"]);
  assert.deepEqual(
    { type: mcp.mcpServers.apex!.type, command: mcp.mcpServers.apex!.command, args: mcp.mcpServers.apex!.args },
    { type: "local", command: "npx", args: ["--no", "apex", "mcp", "serve"] },
  );
  assert.ok(mcp.mcpServers.apex!.tools.includes("recordInput"));
  assert.equal(mcp.mcpServers["azure-resource-manager-mcp"]!.url, "https://mcp.management.azure.com");
  for (const retired of [join(".vscode", "mcp.json"), join(".github", "mcp.json")])
    await assert.rejects(readFile(join(root, retired), "utf8"), /ENOENT/u);
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
    [],
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
  assert.ok(lock.files.some(({ path }) => path === ".mcp.json"));
  assert.ok(!lock.files.some(({ path }) => path === ".vscode/mcp.json" || path === ".github/mcp.json"));
  assert.equal(lock.clientId, "github-copilot-cli");
});

test("init installs only the selected Copilot CLI projection and records it in the lock", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner", clientId: "github-copilot-cli" });
  for (const retired of [join(".vscode", "mcp.json"), join(".github", "mcp.json")])
    await assert.rejects(readFile(join(root, retired), "utf8"), /ENOENT/u);
  assert.match(await readFile(join(root, ".mcp.json"), "utf8"), /"recordInput"/u);
  const requirementsAgent = await readFile(join(root, ".github", "agents", "apex-requirements.agent.md"), "utf8");
  assert.match(requirementsAgent, /target: github-copilot/u);
  assert.match(requirementsAgent, /model: gpt-6-sol/u);
  assert.match(requirementsAgent, /- ask_user/u);
  assert.match(requirementsAgent, /\n\s+- task\s*\n/u);
  assert.match(requirementsAgent, /foreground agent using `ask_user`/u);
  assert.doesNotMatch(requirementsAgent, /vscode\/askQuestions|handoffs:|agents:/u);
  const plannerAgent = await readFile(join(root, ".github", "agents", "apex-planner.agent.md"), "utf8");
  assert.match(plannerAgent, /- apex\/planComplete/u);
  assert.match(plannerAgent, /kernel derives the canonical intent hash/u);
  assert.match(
    await readFile(join(root, ".github", "instructions", "apex-agent-authoring.instructions.md"), "utf8"),
    /APEX Agent Boundaries/u,
  );
  const coordinatorAgent = await readFile(join(root, ".github", "agents", "apex.agent.md"), "utf8");
  assert.match(coordinatorAgent, /- apex\/projectCreate/u);
  assert.match(coordinatorAgent, /- apex\/gateDecide/u);
  assert.match(coordinatorAgent, /Use `ask_user` only for project lifecycle or routing choices, never intake/u);
  assert.match(coordinatorAgent, /Route through the `apex-next` skill/u);
  assert.match(coordinatorAgent, /\n\s+- task\s*\n/u);
  assert.match(coordinatorAgent, /request\.intake`, the destination is exactly `APEX Requirements`/u);
  assert.match(await readFile(join(root, ".github", "skills", "apex-next", "SKILL.md"), "utf8"), /^name: apex-next$/mu);
  assert.match(coordinatorAgent, /replace the active project.*apex\/projectCreate.*apex\/projectDelete/su);
  assert.match(coordinatorAgent, /If creation does not succeed, stop and report its result/u);
  assert.match(coordinatorAgent, /After a\s+successful creation, ask for explicit confirmation/u);
  assert.match(coordinatorAgent, /deleting the only project is rejected/u);
  assert.match(coordinatorAgent, /compact workflow dashboard/u);
  assert.match(coordinatorAgent, /agent-output\/<project>\/<run>\//u);
  assert.match(coordinatorAgent, /--decision <approved\|rejected>/u);
  assert.match(coordinatorAgent, /--recipient <RECIPIENT_ID>/u);
  assert.match(coordinatorAgent, /call `apex\/gateDecide` with that gate, decision, and `confirm: true`/u);
  assert.match(
    coordinatorAgent,
    /never auto-invoke an interactive specialist, author\s+artifacts, approve a gate, or deploy/u,
  );
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
    const profile = await readFile(join(root, ".github", "agents", worker), "utf8");
    assert.match(profile, /model: gpt-6-luna/u);
    assert.match(profile, /reasoning-effort: max/u);
    assert.match(profile, /user-invocable: false/u);
    assert.doesNotMatch(profile, /- ask_user/u);
  }
  const lock = JSON.parse(await readFile(join(root, ".apex", "customizations.lock.json"), "utf8")) as {
    clientId?: string;
    files: Array<{ path: string }>;
  };
  assert.equal(lock.clientId, "github-copilot-cli");
  assert.ok(lock.files.some(({ path }) => path === ".mcp.json"));
  assert.ok(!lock.files.some(({ path }) => path === ".vscode/mcp.json" || path === ".github/mcp.json"));
  assert.equal(
    lock.files.filter(({ path }) => /apex-(?:codegen|reviewer|validator)\.agent\.md$/u.test(path)).length,
    3,
  );
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
  await assert.rejects(readFile(join(root, ".mcp.json"), "utf8"), /ENOENT/u);
  const reinstalled = await service.reinstallCustomizations();
  assert.equal(reinstalled.clientId, "github-copilot-cli");
  assert.match(await readFile(join(root, ".mcp.json"), "utf8"), /"recordInput"/u);
  assert.match(
    await readFile(join(root, ".github", "agents", "apex-validator.agent.md"), "utf8"),
    /model: gpt-6-luna/u,
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
  assert.ok(await stat(join(root, ".mcp.json")));

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
