import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { RepositoryPublishConfigV1 } from "@apexops/contracts";
import type { ProcessRequest } from "@apexops/capabilities";
import { ApexService } from "../service.js";
import { tempRoot } from "./helpers.js";

const config: RepositoryPublishConfigV1 = {
  schemaVersion: "1.0.0",
  owner: "Example",
  name: "workload",
  visibility: "private",
  branch: "main",
  remote: "origin",
};
const commit = "a".repeat(40);

async function fixture() {
  const root = await tempRoot();
  const state = {
    repositoryExists: false,
    remoteConfigured: false,
    pushedCommit: "",
    uncommitted: [] as string[],
    failPush: false,
  };
  const calls: ProcessRequest[] = [];
  const processRunner = {
    run: async (request: ProcessRequest) => {
      calls.push(request);
      const ok = (stdout: string) => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
        outputTruncated: false,
        stdout,
        stderr: "",
      });
      const fail = () => ({
        exitCode: 1,
        signal: null,
        timedOut: false,
        outputTruncated: false,
        stdout: "",
        stderr: "error",
      });
      if (request.executable === "gh") {
        const args = request.args;
        if (args[0] === "api") {
          const endpoint = args[5];
          if (endpoint === "user") return ok(JSON.stringify({ login: "Example" }));
          if (endpoint === "users/Example") return ok(JSON.stringify({ login: "Example", type: "Organization" }));
          if (endpoint === "repos/Example/workload")
            return state.repositoryExists
              ? ok(JSON.stringify({ full_name: "Example/workload", visibility: "private" }))
              : fail();
          if (endpoint === "repos/Example/workload/branches/main")
            return state.pushedCommit.length > 0
              ? ok(JSON.stringify({ name: "main", commit: { sha: state.pushedCommit } }))
              : fail();
          throw new Error(`Unexpected GitHub read: ${String(endpoint)}`);
        }
        assert.deepEqual(args, ["repo", "create", "Example/workload", "--private"]);
        state.repositoryExists = true;
        return ok("");
      }
      assert.equal(request.executable, "git");
      const args = request.args;
      const command = args.slice(0, 2).join(" ");
      if (command === "rev-parse --git-dir") return ok(".git\n");
      if (command === "rev-parse HEAD") return ok(`${commit}\n`);
      if (args[0] === "symbolic-ref") return ok("main\n");
      if (command === "rev-list --count") return ok("3\n");
      if (args[0] === "ls-tree") return ok("README.md\ninfra/main.bicep\n");
      if (args[0] === "status") return ok(state.uncommitted.map((entry) => `${entry}\n`).join(""));
      if (command === "remote -v")
        return ok(state.remoteConfigured ? "origin\thttps://github.com/Example/workload.git (fetch)\n" : "");
      if (args[0] === "merge-base") return state.pushedCommit === commit ? ok("") : fail();
      if (command === "remote add") {
        assert.deepEqual(args, ["remote", "add", "origin", "https://github.com/Example/workload.git"]);
        state.remoteConfigured = true;
        return ok("");
      }
      assert.deepEqual(args, ["push", "--set-upstream", "origin", "main:main"]);
      if (state.failPush) return fail();
      state.pushedCommit = commit;
      return ok("");
    },
  };
  const service = new ApexService(root, { processRunner, idSource: () => "publish-receipt" });
  return { root, service, state, calls };
}

test("repository publication creates, wires and pushes exactly the reviewed branch", async () => {
  const { root, service, state, calls } = await fixture();
  const plan = await service.planRepositoryPublish(config);
  assert.equal(plan.status, "pending");
  assert.deepEqual(plan.actions, ["create-repository", "add-remote", "push-branch"]);
  assert.equal(plan.push.commit, commit);

  const outcome = (await service.publishRepository(config, plan.planHash, true)) as {
    status: string;
    actions: Array<{ action: string; status: string }>;
    forcePush: boolean;
    receiptPath: string;
  };
  assert.equal(outcome.status, "published");
  assert.equal(outcome.forcePush, false);
  assert.deepEqual(
    outcome.actions.map(({ action, status }) => `${action}:${status}`),
    ["create-repository:verified", "add-remote:verified", "push-branch:verified"],
  );
  assert.equal(state.pushedCommit, commit);
  assert.equal(
    calls.some(({ args }) => args.includes("--force") || args.includes("-f")),
    false,
  );
  const receipt = JSON.parse(await readFile(join(root, outcome.receiptPath), "utf8")) as {
    deploymentAuthorized: boolean;
  };
  assert.equal(receipt.deploymentAuthorized, false);

  const after = await service.planRepositoryPublish(config);
  assert.equal(after.status, "ready");
  assert.deepEqual(after.actions, []);
});

test("repository publication resumes without duplicating completed actions", async () => {
  const { service, state, calls } = await fixture();
  state.repositoryExists = true;
  state.remoteConfigured = true;
  const plan = await service.planRepositoryPublish(config);
  assert.deepEqual(plan.actions, ["push-branch"]);
  const outcome = (await service.publishRepository(config, plan.planHash, true)) as { status: string };
  assert.equal(outcome.status, "published");
  assert.equal(
    calls.some(({ args }) => args[0] === "repo" && args[1] === "create"),
    false,
  );
  assert.equal(
    calls.some(({ args }) => args[0] === "remote" && args[1] === "add"),
    false,
  );
});

test("repository publication requires confirmation and a fresh plan", async () => {
  const { service } = await fixture();
  const plan = await service.planRepositoryPublish(config);
  await assert.rejects(service.publishRepository(config, plan.planHash, false), /explicit confirmation/u);
  await assert.rejects(service.publishRepository(config, "0".repeat(64), true), /fresh plan/u);
});

test("an unclean working tree blocks publication before any mutation", async () => {
  const { service, state, calls } = await fixture();
  state.uncommitted = ["?? secrets.env"];
  const plan = await service.planRepositoryPublish(config);
  assert.equal(plan.status, "blocked");
  await assert.rejects(service.publishRepository(config, plan.planHash, true), /prerequisites are blocked/u);
  assert.equal(
    calls.some(({ args }) => args[0] === "push" || (args[0] === "repo" && args[1] === "create")),
    false,
  );
});

test("an indeterminate push is reported without rollback or retry", async () => {
  const { root, service, state } = await fixture();
  state.failPush = true;
  const plan = await service.planRepositoryPublish(config);
  const outcome = (await service.publishRepository(config, plan.planHash, true)) as {
    status: string;
    actions: Array<{ action: string; status: string }>;
    receiptPath: string;
  };
  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.actions.at(-1)?.action, "push-branch");
  assert.equal(outcome.actions.at(-1)?.status, "indeterminate");
  assert.equal(state.pushedCommit, "");
  const receipt = JSON.parse(await readFile(join(root, outcome.receiptPath), "utf8")) as {
    actions: Array<{ status: string }>;
  };
  assert.equal(receipt.actions.at(-1)?.status, "indeterminate");
});
