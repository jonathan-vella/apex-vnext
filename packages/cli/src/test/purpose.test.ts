import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { CONTRACT_VERSION } from "@apexops/contracts";
import { execute } from "../cli.js";
import { ApexError, EXIT_CODES, normalizeError } from "../errors.js";
import { ApexService } from "../service.js";
import { APEX_VERSION } from "../version.js";
import { tempRoot, writeJson } from "./helpers.js";

const PRODUCTION_UNAVAILABLE = /purpose 'production' is unavailable until CP-28\/CP-29.*use purpose 'lab'/u;

function isProductionRejection(error: unknown): boolean {
  return (
    error instanceof ApexError &&
    error.code === "APEX_VALIDATION" &&
    error.exitCode === EXIT_CODES.validation &&
    PRODUCTION_UNAVAILABLE.test(error.message)
  );
}

async function runFile(root: string, projectId: string, runId: string): Promise<string> {
  return join(root, ".apex", "projects", projectId, "runs", runId, "run.json");
}

async function editRun(root: string, projectId: string, runId: string, change: Record<string, unknown>) {
  const path = await runFile(root, projectId, runId);
  const run = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const edited = { ...run, ...change };
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete edited[key];
  await writeJson(path, edited);
}

test("run creation records the purpose and defaults to lab", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  assert.equal((await service.status()).run.purpose, "lab");
  assert.equal(JSON.parse(await readFile(await runFile(root, "demo", runId), "utf8")).purpose, "lab");

  const explicit = await service.createProject({ projectId: "second", riskOwner: "partner", purpose: "lab" });
  assert.equal((await service.status()).run.runId, explicit.runId);
  assert.equal((await service.status()).run.purpose, "lab");
});

test("CLI init and project create accept --purpose lab and reject unknown values", async () => {
  const root = await tempRoot();
  await execute(
    ["init", "--project", "demo", "--risk-owner", "partner", "--target", "local", "--purpose", "lab"],
    root,
  );
  const service = new ApexService(root);
  assert.equal((await service.status()).run.purpose, "lab");
  await execute(
    ["project", "create", "--project", "other", "--risk-owner", "partner", "--target", "local", "--purpose", "lab"],
    root,
  );
  assert.equal((await service.status()).run.purpose, "lab");
  await assert.rejects(
    execute(
      ["project", "create", "--project", "bad", "--risk-owner", "partner", "--target", "local", "--purpose", "dev"],
      root,
    ),
    (error: unknown) =>
      error instanceof ApexError &&
      error.code === "APEX_USAGE" &&
      /--purpose must be lab or production/u.test(error.message),
  );
});

test("production purpose is rejected before any state is created", async () => {
  const root = await tempRoot();
  await assert.rejects(
    execute(
      ["init", "--project", "demo", "--risk-owner", "partner", "--target", "local", "--purpose", "production"],
      root,
    ),
    isProductionRejection,
  );
  assert.deepEqual(await readdir(root), []);

  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const before = await readdir(join(root, ".apex", "projects"));
  await assert.rejects(
    service.createProject({ projectId: "prod", riskOwner: "partner", purpose: "production" }),
    isProductionRejection,
  );
  await assert.rejects(
    execute(
      [
        "project",
        "create",
        "--project",
        "prod",
        "--risk-owner",
        "partner",
        "--target",
        "local",
        "--purpose",
        "production",
      ],
      root,
    ),
    isProductionRejection,
  );
  assert.deepEqual(await readdir(join(root, ".apex", "projects")), before);
  await assert.rejects(
    execute(
      [
        "bootstrap",
        "plan",
        "--project",
        "prod",
        "--risk-owner",
        "partner",
        "--target",
        "local",
        "--purpose",
        "production",
      ],
      root,
    ),
    isProductionRejection,
  );
});

test("a run purpose cannot change through promotion and a production run is refused", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await assert.rejects(service.promote("test", "local", "production"), isProductionRejection);
  await assert.rejects(
    execute(["project", "promote", "--environment", "test", "--target", "local", "--purpose", "production"], root),
    isProductionRejection,
  );
  const runs = join(root, ".apex", "projects", "demo", "runs");
  assert.deepEqual(await readdir(runs), [runId]);

  await editRun(root, "demo", runId, { purpose: "production" });
  await assert.rejects(service.promote("test", "local", "lab"), isProductionRejection);
  await assert.rejects(service.promote("test", "local"), isProductionRejection);
  assert.deepEqual(await readdir(runs), [runId]);
});

test("hand-edited production runs fail closed for preview, Gate 4, deploy and destroy", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await editRun(root, "demo", runId, { purpose: "production" });
  await assert.rejects(service.preview({ operation: "apply", provider: "fake" }), isProductionRejection);
  await assert.rejects(service.preview({ operation: "destroy", provider: "fake" }), isProductionRejection);
  await assert.rejects(service.decideGateNumber(4, "approved", "tester"), isProductionRejection);
  await assert.rejects(service.deploy(), isProductionRejection);
  await assert.rejects(service.currentPreview(), isProductionRejection);
});

test("run configurations without a purpose or with an unknown purpose are rejected", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  const original = await readFile(await runFile(root, "demo", runId), "utf8");
  for (const purpose of [undefined, "dev", "non-production"]) {
    await editRun(root, "demo", runId, { purpose });
    await assert.rejects(
      service.status(),
      (error: unknown) => {
        const normalized = normalizeError(error);
        return (
          normalized.code === "APEX_VALIDATION" &&
          /\/purpose/u.test(normalized.message) &&
          /start a new run with apex project create/u.test(normalized.message)
        );
      },
      String(purpose),
    );
  }
  await writeFile(await runFile(root, "demo", runId), "{ not json");
  await assert.rejects(service.status(), (error: unknown) => {
    const normalized = normalizeError(error);
    return normalized.code === "APEX_VALIDATION" && /not valid JSON/u.test(normalized.message);
  });
  await writeFile(await runFile(root, "demo", runId), original);
  assert.equal((await service.status()).run.purpose, "lab");
});

test("bootstrap resume conflicts when the requested purpose differs from the selected run", async () => {
  const root = await tempRoot();
  await mkdir(join(root, ".git"));
  const packageDirectory = join(root, "node_modules", "@apexops", "cli");
  await mkdir(packageDirectory, { recursive: true });
  await writeJson(join(packageDirectory, "package.json"), { version: APEX_VERSION });
  const service = new ApexService(root, {
    processRunner: {
      run: async () => {
        throw new Error("Rerun must not install");
      },
    },
  });
  const input = { projectId: "demo", riskOwner: "partner" as const, clientId: "github-copilot-cli" as const };
  const initial = await service.bootstrap({ ...input, purpose: "lab" });
  assert.equal((await service.status()).run.purpose, "lab");
  assert.equal((await service.bootstrap({ ...input, purpose: "lab" })).resumed, true);
  assert.equal((await service.bootstrap(input)).resumed, true);
  await assert.rejects(service.bootstrap({ ...input, purpose: "production" }), isProductionRejection);

  await editRun(root, "demo", initial.runId!, { purpose: "production" });
  for (const requested of [{ purpose: "lab" as const }, {}]) {
    assert.equal(
      (
        await service.planBootstrap({
          schemaVersion: CONTRACT_VERSION,
          projectId: input.projectId,
          riskOwner: input.riskOwner,
          client: input.clientId,
          ...requested,
        })
      ).status,
      "blocked",
    );
    await assert.rejects(service.bootstrap({ ...input, ...requested }), /resume is blocked/u);
  }
  await editRun(root, "demo", initial.runId!, { purpose: "lab" });
  assert.equal((await service.bootstrap(input)).resumed, true);
});
