import assert from "node:assert/strict";
import test from "node:test";
import { runBootstrapWizard } from "../bootstrap-wizard.js";
import { ApexService } from "../service.js";
import { tempRoot } from "./helpers.js";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../cli.js";
import type { GovernanceSetupConfigV1 } from "@apexops/contracts";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("bootstrap wizard cancellation and declined plans never initialize a workspace", async () => {
  for (const answers of [["cancel"], ["both", "no", "demo", "", "", "bicep", "yes", "no"]]) {
    const root = await tempRoot();
    const queue = [...answers];
    const result = await runBootstrapWizard(root, {
      ask: async () => {
        assert.ok(queue.length);
        return queue.shift()!;
      },
      show: () => {},
    });
    assert.ok(["cancelled", "pending"].includes(result.status));
    assert.deepEqual(await readdir(root), []);
  }
});

test("profile bootstrap guidance keeps guided setup confirmations and cloud boundaries explicit", async () => {
  const root = await tempRoot();
  const profileRoot = await tempRoot();
  const service = new ApexService(root, { profileRoot });
  await service.profileInstall();
  const profile = await readFile(join(profileRoot, "apex-bootstrap.agent.md"), "utf8");
  for (const phrase of [
    "bootstrap wizard",
    "Do not pass `--yes`",
    "both",
    "remote COE URL",
    "bootstrap baseline-check",
    "bootstrap governance-plan",
    "Never request passwords",
    "do not authorize identity creation",
  ])
    assert.ok(profile.includes(phrase), phrase);
  assert.deepEqual(await readdir(root), []);
});

test(
  "bare bootstrap presents a real terminal question and cancels without files",
  { skip: process.platform !== "linux", timeout: 15_000 },
  async (context) => {
    const root = await tempRoot();
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const child = spawn(
      "script",
      [
        "-q",
        "-e",
        "-c",
        `${quote(process.execPath)} ${quote(join(import.meta.dirname, "../cli.js"))} bootstrap`,
        "/dev/null",
      ],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
    );
    context.after(() => {
      child.kill("SIGKILL");
    });
    let output = "";
    let answered = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
      if (!answered && output.includes("Client [both/")) {
        answered = true;
        child.stdin.write("cancel\n");
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    const [code] = await once(child, "exit");
    assert.equal(code, 0, output);
    assert.equal(answered, true);
    assert.match(output, /"status": "cancelled"/);
    assert.deepEqual(await readdir(root), []);
  },
);

test("bootstrap wizard uses the reviewed local plan and reports governance pending", async (context) => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const setup = context.mock.method(service, "bootstrap", async () => ({
    projectId: "demo",
    runId: "fixture",
    resumed: false,
    runtimeInstalled: true,
  }));
  const baseline = context.mock.method(service, "inspectGovernanceBaselineReadiness", async () => ({
    status: "ready",
    imported: false,
  }));
  const answers = [
    "invalid",
    "both",
    "no",
    "demo",
    "dev",
    "local",
    "terraform",
    "yes",
    "yes",
    "central",
    "baseline.json",
  ];
  const shown: unknown[] = [];
  const result = await runBootstrapWizard(
    root,
    {
      ask: async () => {
        assert.ok(answers.length);
        return answers.shift()!;
      },
      show: (value) => {
        shown.push(value);
      },
    },
    () => service,
  );
  assert.equal(result.status, "pending");
  assert.equal(setup.mock.callCount(), 1);
  assert.deepEqual(setup.mock.calls[0]!.arguments[0], {
    projectId: "demo",
    environment: "dev",
    targetScope: "local",
    iacTool: "terraform",
    createRepository: true,
    clientId: "both",
  });
  assert.ok(shown.some((value) => typeof value === "object" && value !== null && "configHash" in value));
  assert.deepEqual(
    result.progress.map(({ step }) => step),
    ["local-bootstrap", "central-baseline-check"],
  );
  assert.deepEqual(baseline.mock.calls[0]!.arguments, ["baseline.json"]);
  assert.deepEqual(await readdir(root), []);
});

test("baseline-check CLI requires a path and forwards only that path", async (context) => {
  const root = await tempRoot();
  const inspect = context.mock.method(ApexService.prototype, "inspectGovernanceBaselineReadiness", async () => ({
    status: "ready",
    imported: false,
  }));
  await assert.rejects(execute(["bootstrap", "baseline-check"], root), /Missing --path/);
  assert.equal(inspect.mock.callCount(), 0);
  await execute(["bootstrap", "baseline-check", "--path", "baseline.json"], root);
  assert.deepEqual(inspect.mock.calls[0]!.arguments, ["baseline.json"]);
});

test("bootstrap wizard stops on a blocked local plan without requesting mutation", async (context) => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const setup = context.mock.method(service, "bootstrap", async () => {
    throw new Error("Must not run");
  });
  const answers = ["both", "no", "demo", "dev", "local", "bicep", "no"];
  const result = await runBootstrapWizard(
    root,
    {
      ask: async () => {
        assert.ok(answers.length);
        return answers.shift()!;
      },
      show: () => {},
    },
    () => service,
  );
  assert.equal(result.status, "blocked");
  assert.equal(setup.mock.callCount(), 0);
  assert.deepEqual(await readdir(root), []);
});

test("bootstrap wizard selects multiple independent workloads and confirms each local setup", async (context) => {
  const root = await tempRoot();
  const parent = new ApexService(root);
  context.mock.method(parent, "listArchetypes", async () => ({
    candidates: [{ selectedPath: "archetypes/api" }, { selectedPath: "archetypes/storage" }],
  }));
  const planned = context.mock.method(parent, "planArchetypeBatch", async () => ({
    planHash: "a".repeat(64),
    entries: [],
  }));
  const copied = context.mock.method(parent, "importArchetypeBatch", async () => ({ status: "copied" }));
  const children = new Map(
    ["api-copy", "storage-copy"].map((name) => [join(root, name), new ApexService(join(root, name))]),
  );
  const initialized = [...children.values()].map((service) =>
    context.mock.method(service, "bootstrap", async () => ({ runtimeInstalled: true })),
  );
  const answers = [
    "both",
    "yes",
    "https://github.com/example/coe",
    "a".repeat(40),
    "",
    "1,2",
    "api-copy",
    "storage-copy",
    "yes",
    "api",
    "dev",
    "local",
    "bicep",
    "yes",
    "yes",
    "later",
    "storage",
    "test",
    "local",
    "terraform",
    "yes",
    "yes",
    "later",
  ];
  const result = await runBootstrapWizard(
    root,
    {
      ask: async () => {
        assert.ok(answers.length);
        return answers.shift()!;
      },
      show: () => {},
    },
    (directory) => (directory === root ? parent : children.get(directory)!),
  );
  assert.equal(result.status, "pending");
  assert.equal(planned.mock.callCount(), 1);
  assert.deepEqual(copied.mock.calls[0]!.arguments.slice(1), ["a".repeat(64), true]);
  assert.ok(initialized.every((mock) => mock.mock.callCount() === 1));
  assert.deepEqual(
    result.progress.filter(({ step }) => step === "local-bootstrap").map(({ directory }) => directory),
    [...children.keys()],
  );
  assert.equal(answers.length, 0);
});

test("bootstrap wizard leaves consumer identity provisioning pending or blocked without execution", async (context) => {
  const root = await tempRoot();
  const service = new ApexService(root);
  context.mock.method(service, "bootstrap", async () => ({ runtimeInstalled: false }));
  const planner = context.mock.method(service, "planGovernanceSetup", async () => ({
    status: "blocked",
    executionAuthorized: false,
  }));
  const answers = [
    "both",
    "no",
    "demo",
    "",
    "",
    "bicep",
    "yes",
    "yes",
    "consumer",
    "example/repo",
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "",
    "create",
    "reader-app",
  ];
  const result = await runBootstrapWizard(
    root,
    {
      ask: async () => {
        assert.ok(answers.length);
        return answers.shift()!;
      },
      show: () => {},
    },
    () => service,
  );
  assert.equal(result.status, "blocked");
  assert.equal(planner.mock.callCount(), 1);
  const submitted = planner.mock.calls[0]!.arguments[0] as GovernanceSetupConfigV1 | undefined;
  assert.ok(submitted);
  assert.deepEqual(submitted.identity, { mode: "create", displayName: "reader-app" });
  assert.equal(result.progress.at(-1)!.step, "governance-plan");
  await assert.rejects(execute(["bootstrap", "wizard", "--yes"], root), /per-plan interactive confirmation/);
  await assert.rejects(execute(["bootstrap", "wizard", "--json"], root), /per-plan interactive confirmation/);
  await assert.rejects(execute(["bootstrap", "wizard"], root), /interactive terminal/);
  await assert.rejects(execute(["bootstrap"], root), /interactive terminal/);
});

test("wizard requires separate exact-plan confirmation for existing-identity provisioning", async (context) => {
  for (const approval of ["yes", "no"]) {
    const root = await tempRoot();
    const service = new ApexService(root);
    context.mock.method(service, "bootstrap", async () => ({ runtimeInstalled: false }));
    context.mock.method(service, "planGovernanceSetup", async () => ({ status: "pending" }));
    context.mock.method(service, "planGovernanceProvision", async () => ({
      status: "ready",
      planHash: "a".repeat(64),
    }));
    const provision = context.mock.method(service, "provisionGovernance", async () => ({
      status: "configured",
      collectionEnabled: false,
    }));
    const answers = [
      "both",
      "no",
      "demo",
      "",
      "",
      "bicep",
      "yes",
      "yes",
      "consumer",
      "example/repo",
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "",
      "reuse",
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
      approval,
    ];
    const result = await runBootstrapWizard(
      root,
      {
        ask: async () => {
          assert.ok(answers.length);
          return answers.shift()!;
        },
        show: () => {},
      },
      () => service,
    );
    assert.equal(result.status, "pending");
    assert.equal(provision.mock.callCount(), approval === "yes" ? 1 : 0);
    if (approval === "yes") assert.deepEqual(provision.mock.calls[0]!.arguments.slice(1), ["a".repeat(64), true]);
    assert.deepEqual(await readdir(root), []);
  }
});
