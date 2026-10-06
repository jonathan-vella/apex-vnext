import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ProjectStore, RunRepository, RunWriterConflictError } from "../index.js";

test("run repository CAS permits one mutation and rejects a racing stale hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-run-repository-"));
  const store = new ProjectStore(
    root,
    () => new Date("2026-01-01T00:00:00.000Z"),
    () => "run-1",
  );
  await store.initializeProject({
    projectId: "demo",
    displayName: "Demo",
    defaultIacTool: "bicep",
    riskOwner: "partner",
  });
  await store.createRun("demo", { environment: "dev", targetScope: "scope", runtimeLockHash: "a".repeat(64) });
  const repository = new RunRepository(store.runDirectory("demo", "run-1"));
  const expectedRunHash = await repository.hash();
  const mutation = (eventId: string) =>
    repository.mutate({
      expectedRunHash,
      event: {
        eventId,
        projectId: "demo",
        runId: "run-1",
        type: "owner-changed",
        timestamp: "2026-01-01T00:01:00.000Z",
        ownerEpoch: 2,
        payload: { eventId },
      },
      update: (run) => ({ ...run, ownerEpoch: 2 }),
    });
  const results = await Promise.allSettled([mutation("event-1"), mutation("event-2")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await repository.read()).ownerEpoch, 2);
  assert.equal((await repository.journal.replay()).length, 1);
});

test("run repository never exposes partial lock metadata under contention", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-run-lock-contention-"));
  const store = new ProjectStore(
    root,
    () => new Date("2026-01-01T00:00:00.000Z"),
    () => "run-1",
  );
  await store.initializeProject({
    projectId: "demo",
    displayName: "Demo",
    defaultIacTool: "bicep",
    riskOwner: "partner",
  });
  await store.createRun("demo", { environment: "dev", targetScope: "scope", runtimeLockHash: "a".repeat(64) });
  const repository = new RunRepository(store.runDirectory("demo", "run-1"));
  const results = await Promise.allSettled(Array.from({ length: 64 }, () => repository.read()));
  assert.ok(results.some(({ status }) => status === "fulfilled"));
  for (const result of results) {
    if (result.status === "rejected") assert.match(String(result.reason), /Run mutation is already in progress/u);
  }
});

test("run repository reclaims an expired dead-owner generation into a permanent tombstone", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-run-stale-lock-"));
  const now = new Date("2026-01-01T00:00:00.000Z");
  const store = new ProjectStore(
    root,
    () => now,
    () => "run-1",
  );
  await store.initializeProject({
    projectId: "demo",
    displayName: "Demo",
    defaultIacTool: "bicep",
    riskOwner: "partner",
  });
  await store.createRun("demo", { environment: "dev", targetScope: "scope", runtimeLockHash: "a".repeat(64) });
  const directory = store.runDirectory("demo", "run-1");
  const lockPath = join(directory, ".run-mutation.lock");
  await mkdir(lockPath);
  await writeFile(
    join(lockPath, "metadata.json"),
    JSON.stringify({
      token: "expired-lock",
      pid: 2_147_483_647,
      host: hostname(),
      createdAt: "2025-12-31T23:58:00.000Z",
      expiresAt: "2025-12-31T23:59:00.000Z",
    }),
  );
  const repository = new RunRepository(directory, { clock: () => now, lockTtlMs: 30_000 });
  const results = await Promise.allSettled(Array.from({ length: 64 }, () => repository.read()));
  assert.ok(results.some(({ status }) => status === "fulfilled"));
  for (const result of results) {
    if (result.status === "fulfilled") assert.equal(result.value.projectId, "demo");
    else assert.match(String(result.reason), /Run mutation is already in progress/u);
  }
  await assert.rejects(readFile(lockPath), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
  const tombstones = await readdir(join(directory, ".run-mutation.retired"));
  assert.equal(tombstones.length, results.filter(({ status }) => status === "fulfilled").length + 1);
  assert.equal(
    (
      await Promise.all(
        tombstones.map(async (name) =>
          JSON.parse(await readFile(join(directory, ".run-mutation.retired", name, "metadata.json"), "utf8")),
        ),
      )
    ).some(({ token }) => token === "expired-lock"),
    true,
  );
});

test("run repository never reclaims an expired lock owned by a live local process", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-run-live-lock-"));
  const now = new Date("2026-01-01T00:00:00.000Z");
  const store = new ProjectStore(
    root,
    () => now,
    () => "run-1",
  );
  await store.initializeProject({
    projectId: "demo",
    displayName: "Demo",
    defaultIacTool: "bicep",
    riskOwner: "partner",
  });
  await store.createRun("demo", { environment: "dev", targetScope: "scope", runtimeLockHash: "a".repeat(64) });
  const directory = store.runDirectory("demo", "run-1");
  const lockPath = join(directory, ".run-mutation.lock");
  await mkdir(lockPath);
  await writeFile(
    join(lockPath, "metadata.json"),
    JSON.stringify({
      token: "live-lock",
      pid: process.pid,
      host: hostname(),
      createdAt: "2025-12-31T23:58:00.000Z",
      expiresAt: "2025-12-31T23:59:00.000Z",
    }),
  );
  await assert.rejects(
    new RunRepository(directory, { clock: () => now }).read(),
    /Run mutation is already in progress/u,
  );
  assert.equal(JSON.parse(await readFile(join(lockPath, "metadata.json"), "utf8")).token, "live-lock");
});

test("run repository rejects missing metadata in a stable lock generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-run-invalid-lock-"));
  const store = new ProjectStore(
    root,
    () => new Date("2026-01-01T00:00:00.000Z"),
    () => "run-1",
  );
  await store.initializeProject({
    projectId: "demo",
    displayName: "Demo",
    defaultIacTool: "bicep",
    riskOwner: "partner",
  });
  await store.createRun("demo", { environment: "dev", targetScope: "scope", runtimeLockHash: "a".repeat(64) });
  const directory = store.runDirectory("demo", "run-1");
  await mkdir(join(directory, ".run-mutation.lock"));
  await assert.rejects(new RunRepository(directory).read(), /Run mutation lock metadata is unreadable/u);
});

test("run repository rejects a mutation when the validated journal head changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-run-journal-cas-"));
  const store = new ProjectStore(
    root,
    () => new Date("2026-01-01T00:00:00.000Z"),
    () => "run-1",
  );
  await store.initializeProject({
    projectId: "demo",
    displayName: "Demo",
    defaultIacTool: "bicep",
    riskOwner: "partner",
  });
  await store.createRun("demo", { environment: "dev", targetScope: "scope", runtimeLockHash: "a".repeat(64) });
  const repository = new RunRepository(store.runDirectory("demo", "run-1"));
  const validatedHead = await repository.journal.head();
  await repository.journal.append({
    eventId: "transfer-requested",
    projectId: "demo",
    runId: "run-1",
    type: "transfer-requested",
    timestamp: "2026-01-01T00:00:30.000Z",
    ownerEpoch: 1,
    expectedHead: validatedHead,
    payload: { claimHash: "b".repeat(64), recipient: "ci" },
  });
  await assert.rejects(
    repository.mutate({
      expectedRunHash: await repository.hash(),
      expectedJournalHead: validatedHead,
      event: {
        eventId: "gate-decided",
        projectId: "demo",
        runId: "run-1",
        type: "gate.decided",
        timestamp: "2026-01-01T00:01:00.000Z",
        ownerEpoch: 1,
        payload: { gate: 4 },
      },
      update: (run) => run,
    }),
    /Stale journal head/,
  );
  assert.equal((await repository.journal.replay()).length, 1);
});

for (const stage of ["intent", "journal", "run", "cleanup"] as const) {
  test(`run repository recovers a crash after ${stage}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "apex-run-recovery-"));
    const store = new ProjectStore(
      root,
      () => new Date("2026-01-01T00:00:00.000Z"),
      () => "run-1",
    );
    await store.initializeProject({
      projectId: "demo",
      displayName: "Demo",
      defaultIacTool: "bicep",
      riskOwner: "partner",
    });
    await store.createRun("demo", { environment: "dev", targetScope: "scope", runtimeLockHash: "a".repeat(64) });
    const directory = store.runDirectory("demo", "run-1");
    const repository = new RunRepository(directory, {
      faultInjector: (current) => {
        if (current === stage) throw new Error(`crash:${stage}`);
      },
    });
    await assert.rejects(
      repository.mutate({
        expectedRunHash: await repository.hash(),
        event: {
          eventId: `event-${stage}`,
          projectId: "demo",
          runId: "run-1",
          type: "owner-changed",
          timestamp: "2026-01-01T00:01:00.000Z",
          ownerEpoch: 2,
          payload: { stage },
        },
        update: (run) => ({ ...run, ownerEpoch: 2 }),
      }),
      new RegExp(`crash:${stage}`),
    );
    const recovered = new RunRepository(directory);
    const run = await recovered.read();
    const events = await recovered.journal.replay();
    const committed = stage !== "intent";
    assert.equal(run.ownerEpoch, committed ? 2 : 1);
    assert.equal(events.length, committed ? 1 : 0);
  });
}

async function writerLeaseFixture(now: { value: Date }) {
  const root = await mkdtemp(join(tmpdir(), "apex-run-writer-lease-"));
  const store = new ProjectStore(
    root,
    () => now.value,
    () => "run-1",
  );
  await store.initializeProject({
    projectId: "demo",
    displayName: "Demo",
    defaultIacTool: "bicep",
    riskOwner: "partner",
  });
  await store.createRun("demo", { environment: "dev", targetScope: "scope", runtimeLockHash: "a".repeat(64) });
  const directory = store.runDirectory("demo", "run-1");
  return { directory, repository: new RunRepository(directory, { clock: () => now.value, writerLeaseTtlMs: 1_000 }) };
}

test("run writer lease acquires, renews, rejects a second writer, and releases", async () => {
  const now = { value: new Date("2026-01-01T00:00:00.000Z") };
  const { repository } = await writerLeaseFixture(now);
  const owner = { workspacePath: "/workspace/main", sessionId: "session-a" };
  const other = { workspacePath: "/workspace/worktree", sessionId: "session-b" };
  const initial = await repository.acquireWriterLease(owner);
  assert.equal(initial.workspacePath, resolve(owner.workspacePath));
  assert.equal(initial.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(initial.expiresAt, "2026-01-01T00:00:01.000Z");

  now.value = new Date("2026-01-01T00:00:00.500Z");
  const renewed = await repository.acquireWriterLease(owner);
  assert.equal(renewed.createdAt, initial.createdAt);
  assert.equal(renewed.expiresAt, "2026-01-01T00:00:01.500Z");
  await assert.rejects(
    repository.acquireWriterLease(other),
    (error: unknown) =>
      error instanceof RunWriterConflictError &&
      error.code === "APEX_WRITER_CONFLICT" &&
      error.ownerWorktree === resolve(owner.workspacePath),
  );
  await assert.rejects(repository.releaseWriterLease(other), RunWriterConflictError);
  assert.equal(await repository.releaseWriterLease(owner), true);
  assert.equal(await repository.releaseWriterLease(owner), false);
});

test("run writer lease expires and can be taken over by another worktree", async () => {
  const now = { value: new Date("2026-01-01T00:00:00.000Z") };
  const { repository } = await writerLeaseFixture(now);
  await repository.acquireWriterLease({ workspacePath: "/workspace/main", sessionId: "session-a" });
  now.value = new Date("2026-01-01T00:00:01.001Z");
  const takeover = await repository.acquireWriterLease({
    workspacePath: "/workspace/worktree",
    sessionId: "session-b",
  });
  assert.equal(takeover.workspacePath, resolve("/workspace/worktree"));
  assert.equal(takeover.createdAt, "2026-01-01T00:00:01.001Z");
});

test("run writer lease publication remains readable under contention", async () => {
  const now = { value: new Date("2026-01-01T00:00:00.000Z") };
  const { directory, repository } = await writerLeaseFixture(now);
  const attempts = await Promise.allSettled(
    Array.from({ length: 32 }, (_, index) =>
      repository.acquireWriterLease({
        workspacePath: index % 2 === 0 ? "/workspace/main" : "/workspace/worktree",
        sessionId: `session-${index}`,
      }),
    ),
  );
  assert.ok(attempts.some((attempt) => attempt.status === "fulfilled"));
  for (const attempt of attempts) {
    if (attempt.status === "rejected") {
      assert.ok(
        attempt.reason instanceof RunWriterConflictError ||
          (attempt.reason instanceof Error && /Run mutation is already in progress/u.test(attempt.reason.message)),
      );
    }
  }
  const lease = JSON.parse(await readFile(join(directory, ".run-writer-lease.json"), "utf8")) as {
    workspacePath?: unknown;
    expiresAt?: unknown;
  };
  assert.equal(typeof lease.workspacePath, "string");
  assert.equal(typeof lease.expiresAt, "string");
});
