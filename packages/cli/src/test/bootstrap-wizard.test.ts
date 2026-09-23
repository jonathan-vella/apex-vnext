import assert from "node:assert/strict";
import test from "node:test";
import { runBootstrapWizard } from "../bootstrap-wizard.js";
import { ApexService } from "../service.js";
import { tempRoot } from "./helpers.js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../cli.js";
import type { GovernanceSetupConfigV1 } from "@apexops/contracts";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { APEX_VERSION } from "../version.js";

test("bootstrap wizard cancellation and declined plans never initialize a workspace", async () => {
  for (const answers of [["cancel"], ["no", "yes", "no"]]) {
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
    "remote COE URL",
    "Defer target-bound central baseline checks",
    "creates a project with an agreed target",
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
      if (!answered && output.includes("Copy one or more independent workloads")) {
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
  const answers = ["invalid", "no", "yes", "yes", "no", "central"];
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
    createRepository: true,
    clientId: "github-copilot-cli",
  });
  assert.ok(shown.some((value) => typeof value === "object" && value !== null && "configHash" in value));
  assert.deepEqual(
    result.progress.map(({ step }) => step),
    ["local-bootstrap", "central-baseline-check"],
  );
  assert.equal(baseline.mock.callCount(), 0);
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
  const answers = ["no", "no"];
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
    "yes",
    "https://github.com/example/coe",
    "a".repeat(40),
    "",
    "1,2",
    "api-copy",
    "storage-copy",
    "yes",
    "yes",
    "yes",
    "no",
    "later",
    "yes",
    "yes",
    "no",
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
    "no",
    "yes",
    "yes",
    "no",
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
      "no",
      "yes",
      "yes",
      "no",
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

test("wizard configures a real empty workspace without asking or inventing project details", async () => {
  const root = await tempRoot();
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "node_modules/@apexops/cli"), { recursive: true });
  await writeFile(join(root, "node_modules/@apexops/cli/package.json"), JSON.stringify({ version: APEX_VERSION }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const answers = ["no", "no", "yes", "no", "later"];
    const questions: string[] = [];
    const result = await runBootstrapWizard(root, {
      ask: async (question) => {
        questions.push(question);
        assert.ok(answers.length, question);
        return answers.shift()!;
      },
      show: () => {},
    });
    assert.equal(result.status, "pending");
    assert.equal(answers.length, 0);
    assert.doesNotMatch(questions.join("\n"), /Project ID|Environment \[|target scope|IaC track/i);
    assert.deepEqual(await new ApexService(root).listProjects(), []);
    await assert.rejects(readFile(join(root, ".apex/config.json")), { code: "ENOENT" });
    assert.equal((await new ApexService(root).doctor()).healthy, true);
  }
});

test("wizard publishes a GitHub repository only after showing owner, visibility and exact changes", async (context) => {
  for (const approval of ["yes", "no"]) {
    const root = await tempRoot();
    const service = new ApexService(root);
    context.mock.method(service, "bootstrap", async () => ({ runtimeInstalled: false }));
    const plan = {
      status: "pending" as const,
      planHash: "b".repeat(64),
      repository: { fullName: "Example/workload", visibility: "private", exists: false },
      push: { branch: "main", commit: "a".repeat(40), files: ["README.md"], forcePush: false },
    };
    context.mock.method(service, "planRepositoryPublish", async () => plan);
    const publish = context.mock.method(service, "publishRepository", async () => ({ status: "published" }));
    const answers = ["no", "yes", "yes", "yes", "Example", "workload", "", "", approval, "later"];
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
    assert.equal(answers.length, 0);
    assert.ok(shown.includes(plan));
    assert.equal(publish.mock.callCount(), approval === "yes" ? 1 : 0);
    if (approval === "yes") {
      const [submitted, hash, confirmed] = publish.mock.calls[0]!.arguments;
      assert.deepEqual(submitted, {
        schemaVersion: "1.0.0",
        owner: "Example",
        name: "workload",
        visibility: "private",
        branch: "main",
        remote: "origin",
      });
      assert.equal(hash, "b".repeat(64));
      assert.equal(confirmed, true);
    }
    assert.deepEqual(
      result.progress.map(({ step }) => step),
      approval === "yes"
        ? ["local-bootstrap", "github-repository-plan", "github-repository", "governance"]
        : ["local-bootstrap", "github-repository-plan", "governance"],
    );
  }
});
