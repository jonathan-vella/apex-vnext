import assert from "node:assert/strict";
import test from "node:test";
import { planRepositoryPublish } from "../repository-publish.js";
import type { RepositoryPublishConfigV1 } from "@apexops/contracts";

const config: RepositoryPublishConfigV1 = {
  schemaVersion: "1.0.0",
  owner: "Example",
  name: "workload",
  visibility: "private",
  branch: "main",
  remote: "origin",
};
const commit = "a".repeat(40);
const local = {
  isRepository: true,
  commit,
  branch: "main",
  commitCount: 3,
  files: ["README.md", "infra/main.bicep"],
  uncommittedChanges: [],
  remotes: {},
  remoteBranchCommit: "",
  remoteBranchIsAncestor: false,
};
const evidence = {
  viewer: { login: "Example" },
  repository: null,
  owner: { login: "Example", type: "Organization" },
  local,
};

test("publish plan proposes creation, remote and a non-forced push", () => {
  const plan = planRepositoryPublish(config, evidence);
  assert.equal(plan.status, "pending");
  assert.deepEqual(plan.actions, ["create-repository", "add-remote", "push-branch"]);
  assert.equal(plan.repository.fullName, "Example/workload");
  assert.equal(plan.repository.visibility, "private");
  assert.equal(plan.repository.exists, false);
  assert.equal(plan.push.commit, commit);
  assert.deepEqual(plan.push.files, ["README.md", "infra/main.bicep"]);
  assert.equal(plan.push.forcePush, false);
  assert.equal(plan.filesModified, false);
  assert.equal(plan.executionAuthorized, false);
  assert.equal(plan.deploymentAuthorized, false);
  assert.deepEqual(planRepositoryPublish(config, evidence), plan);
});

test("publish plan is ready and action-free once the exact commit is already published", () => {
  const plan = planRepositoryPublish(config, {
    ...evidence,
    repository: { full_name: "Example/workload", visibility: "private" },
    local: {
      ...local,
      remotes: { origin: "https://github.com/Example/workload.git" },
      remoteBranchCommit: commit,
      remoteBranchIsAncestor: true,
    },
  });
  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.repository.exists, true);
});

test("publish plan refuses to overwrite divergent remote history", () => {
  const plan = planRepositoryPublish(config, {
    ...evidence,
    repository: { full_name: "Example/workload", visibility: "private" },
    local: {
      ...local,
      remotes: { origin: "https://github.com/Example/workload.git" },
      remoteBranchCommit: "b".repeat(40),
      remoteBranchIsAncestor: false,
    },
  });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockers.some((blocker) => blocker.includes("never force-pushes")));
  assert.equal(plan.actions.includes("push-branch"), false);
});

test("publish plan blocks unreviewed working-tree changes and unauthenticated accounts", () => {
  const dirty = planRepositoryPublish(config, {
    ...evidence,
    local: { ...local, uncommittedChanges: ["?? secrets.env"] },
  });
  assert.equal(dirty.status, "blocked");
  assert.ok(dirty.blockers.some((blocker) => blocker.includes("Uncommitted or untracked changes")));

  const anonymous = planRepositoryPublish(config, { ...evidence, viewer: null });
  assert.equal(anonymous.status, "blocked");
  assert.ok(anonymous.blockers.some((blocker) => blocker.includes("GitHub authentication")));
});

test("publish plan blocks conflicting remotes, foreign owners and visibility drift", () => {
  const foreignRemote = planRepositoryPublish(config, {
    ...evidence,
    local: { ...local, remotes: { origin: "https://github.com/Other/repo.git" } },
  });
  assert.equal(foreignRemote.status, "blocked");
  assert.ok(foreignRemote.blockers.some((blocker) => blocker.includes("different repository")));

  const foreignOwner = planRepositoryPublish(config, {
    ...evidence,
    viewer: { login: "someone-else" },
    owner: { login: "Example", type: "User" },
  });
  assert.equal(foreignOwner.status, "blocked");
  assert.ok(foreignOwner.blockers.some((blocker) => blocker.includes("different user account")));

  const drift = planRepositoryPublish(config, {
    ...evidence,
    repository: { full_name: "Example/workload", visibility: "public" },
  });
  assert.equal(drift.status, "blocked");
  assert.ok(drift.blockers.some((blocker) => blocker.includes("visibility differs")));
});

test("internal visibility requires an organization owner", () => {
  const plan = planRepositoryPublish(
    { ...config, visibility: "internal" },
    { ...evidence, owner: { login: "Example", type: "User" }, viewer: { login: "Example" } },
  );
  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockers.some((blocker) => blocker.includes("organization owner")));
});

test("publish plan blocks a branch mismatch and an empty local repository", () => {
  const mismatch = planRepositoryPublish(config, { ...evidence, local: { ...local, branch: "feature" } });
  assert.equal(mismatch.status, "blocked");
  assert.ok(mismatch.blockers.some((blocker) => blocker.includes("checked-out branch differs")));

  const empty = planRepositoryPublish(config, {
    ...evidence,
    local: { ...local, isRepository: false, commit: "", branch: "" },
  });
  assert.equal(empty.status, "blocked");
  assert.ok(empty.blockers.some((blocker) => blocker.includes("No local Git repository")));
});
