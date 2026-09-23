import { Value } from "@sinclair/typebox/value";
import {
  RepositoryPublishConfigV1Schema,
  RepositoryPublishPlanV1Schema,
  calculatePolicyValidationDigest,
  type RepositoryPublishConfigV1,
  type RepositoryPublishPlanV1,
} from "@apexops/contracts";

export interface RepositoryPublishEvidence {
  /** `gh api user` for the authenticated account, or null when unavailable. */
  viewer: unknown;
  /** `gh api repos/{owner}/{name}` for the requested repository, or null when absent. */
  repository: unknown;
  /** `gh api users/{owner}` describing the requested owner, or null when unavailable. */
  owner: unknown;
  /** Local Git observations for the workspace. */
  local: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const strings = (value: unknown, limit: number): { values: string[]; truncated: boolean } => {
  if (!Array.isArray(value)) return { values: [], truncated: false };
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 1024) continue;
    if (values.length === limit) return { values, truncated: true };
    values.push(entry);
  }
  return { values, truncated: value.length > values.length };
};

/**
 * Builds a reviewable plan for creating a GitHub repository and pushing the current branch.
 * The plan never proposes a force push and never proposes pushing an unclean working tree.
 */
export function planRepositoryPublish(
  config: RepositoryPublishConfigV1,
  evidence: RepositoryPublishEvidence,
): RepositoryPublishPlanV1 {
  config = structuredClone(config);
  if (!Value.Check(RepositoryPublishConfigV1Schema, config))
    throw new TypeError("Invalid repository publish configuration");
  evidence = structuredClone(evidence);
  const evidenceHash = calculatePolicyValidationDigest(evidence);
  const fullName = `${config.owner}/${config.name}`;
  const blockers: string[] = [];
  const actions: RepositoryPublishPlanV1["actions"] = [];

  const viewer = record(evidence.viewer);
  const authenticated = typeof viewer.login === "string" && viewer.login.length > 0;
  if (!authenticated)
    blockers.push(
      "GitHub authentication was not observed; sign in interactively with the GitHub CLI before publishing.",
    );

  const ownerRecord = record(evidence.owner);
  const ownerType =
    ownerRecord.type === "Organization" ? "organization" : ownerRecord.type === "User" ? "user" : "unknown";
  if (
    authenticated &&
    ownerType === "user" &&
    typeof ownerRecord.login === "string" &&
    ownerRecord.login.toLowerCase() !== String(viewer.login).toLowerCase()
  )
    blockers.push(
      "The requested owner is a different user account; choose your own account or an organization you can administer.",
    );
  if (config.visibility === "internal" && ownerType !== "organization")
    blockers.push("Internal visibility requires an organization owner.");

  const local = record(evidence.local);
  const branch = typeof local.branch === "string" ? local.branch : "";
  const commit = typeof local.commit === "string" && /^[0-9a-f]{40}$/u.test(local.commit) ? local.commit : "";
  const commitCount = Number.isSafeInteger(local.commitCount) ? Math.max(0, Number(local.commitCount)) : 0;
  const { values: files, truncated: filesTruncated } = strings(local.files, 512);
  const { values: uncommittedChanges } = strings(local.uncommittedChanges, 512);
  if (local.isRepository !== true)
    blockers.push("No local Git repository was observed; initialize the repository before publishing.");
  else if (commit.length === 0 || branch.length === 0)
    blockers.push("The local branch has no commit to publish; commit the reviewed changes first.");
  else if (branch !== config.branch)
    blockers.push("The checked-out branch differs from the requested branch; check out the branch before publishing.");
  if (uncommittedChanges.length > 0)
    blockers.push(
      "Uncommitted or untracked changes are present; commit or exclude them so the push contains only reviewed changes.",
    );

  const existing = record(evidence.repository);
  const exists = typeof existing.full_name === "string";
  let visibility = config.visibility;
  if (exists) {
    if (String(existing.full_name).toLowerCase() !== fullName.toLowerCase())
      blockers.push("Observed repository identity does not match the requested repository.");
    if (existing.visibility === "private" || existing.visibility === "internal" || existing.visibility === "public")
      visibility = existing.visibility;
    if (visibility !== config.visibility)
      blockers.push(
        "The existing repository visibility differs from the requested visibility; APEX does not change visibility.",
      );
    if (existing.archived === true) blockers.push("The existing repository is archived and cannot receive a push.");
  } else {
    actions.push("create-repository");
  }

  const remotes = record(local.remotes);
  const configuredRemote = remotes[config.remote];
  if (typeof configuredRemote === "string" && configuredRemote.length > 0) {
    if (!configuredRemote.toLowerCase().includes(fullName.toLowerCase()))
      blockers.push(
        `Remote ${config.remote} already points at a different repository; resolve the remote before publishing.`,
      );
  } else {
    actions.push("add-remote");
  }

  const pushedCommit = typeof local.remoteBranchCommit === "string" ? local.remoteBranchCommit : "";
  if (commit.length > 0 && pushedCommit === commit) {
    // The reviewed branch is already published; resumption must not repeat the push.
  } else if (pushedCommit.length > 0 && local.remoteBranchIsAncestor !== true) {
    blockers.push(
      "The remote branch contains commits that are not in the local branch; reconcile it manually because APEX never force-pushes.",
    );
  } else {
    actions.push("push-branch");
  }

  const body = {
    schemaVersion: "1.0.0" as const,
    config,
    evidenceHash,
    status:
      blockers.length > 0 ? ("blocked" as const) : actions.length === 0 ? ("ready" as const) : ("pending" as const),
    repository: { fullName, owner: config.owner, ownerType, visibility, exists },
    actions,
    push: {
      branch: branch.length > 0 ? branch : config.branch,
      commit: commit.length > 0 ? commit : "0".repeat(40),
      commitCount,
      files,
      filesTruncated,
      uncommittedChanges,
      forcePush: false as const,
    },
    blockers,
    pendingActions: [
      "Confirm the exact owner, visibility and listed changes before any remote mutation.",
      "Create the repository only after confirmation; new repositories default to private.",
      "Push only the reviewed branch; unrelated branches, tags and force pushes are never included.",
      "Repository publication does not configure governance, collection or any deployment approval.",
    ],
    filesModified: false as const,
    executionAuthorized: false as const,
    deploymentAuthorized: false as const,
  };
  const plan = { ...body, planHash: calculatePolicyValidationDigest(body) };
  if (!Value.Check(RepositoryPublishPlanV1Schema, plan)) throw new TypeError("Invalid repository publish plan");
  return plan;
}
