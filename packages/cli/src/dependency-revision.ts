import type { EventV1, RunConfigV1 } from "@apexops/contracts";
import { sha256Json } from "@apexops/kernel";

type DependencyRevisionRun = Pick<RunConfigV1, "projectId" | "runId" | "targetScope" | "iacTool" | "runtimeLockHash">;

export function dependencyRevision(run: DependencyRevisionRun, events: readonly EventV1[]): string {
  const artifacts = events.reduce<Record<string, string>>((current, event) => {
    if (event.type === "workflow.invalidated") {
      const payload = event.payload as {
        artifactKinds?: string[];
        governanceRevision?: { retainedReviewHash?: string };
      };
      for (const kind of payload.artifactKinds ?? []) delete current[kind];
      if (payload.governanceRevision?.retainedReviewHash !== undefined)
        current["review-findings"] = payload.governanceRevision.retainedReviewHash;
      return current;
    }
    if (event.type !== "task.completed") return current;
    const hashes = (event.payload as { artifactHashes?: Record<string, unknown> }).artifactHashes ?? {};
    for (const [kind, hash] of Object.entries(hashes)) if (typeof hash === "string") current[kind] = hash;
    return current;
  }, {});
  return sha256Json({
    projectId: run.projectId,
    runId: run.runId,
    targetScope: run.targetScope,
    iacTool: run.iacTool,
    runtimeLockHash: run.runtimeLockHash,
    artifacts,
  });
}
