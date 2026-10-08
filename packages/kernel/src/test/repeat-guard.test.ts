import assert from "node:assert/strict";
import * as fs from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  DEFAULT_REPEAT_WINDOW_MS,
  MAX_REPEAT_RECORDS,
  MAX_REPEAT_RESULT_BYTES,
  ProjectStore,
  REPEAT_EVENT_TYPE,
  REPEAT_GUARD_FILE,
  REPEAT_LOCK_FILE,
  RepeatFileSnapshotError,
  RepeatFileWrites,
  RepeatGuardBusyError,
  RepeatGuardCancelledError,
  RepeatGuardStaleError,
  RunRepository,
  RunWriterConflictError,
  executeRepeatSafe,
  withRepeatGuardLock,
  sha256Json,
  readRepeatEvents,
  readRepeatRecords,
  repeatCallHash,
  repeatFingerprint,
  repeatStateToken,
  repeatFilesDigest,
  repeatFilesHeld,
  sha256Bytes,
  sha256Text,
  snapshotRepeatFiles,
  type RepeatCall,
  type RepeatSafeOutcome,
  type RepeatScope,
} from "../index.js";
import { CONTRACT_VERSION, RepeatGuardRecordsV1Schema, registerContractFormats } from "@apexops/contracts";
import { Value } from "@sinclair/typebox/value";

async function fixture(start = "2026-01-01T00:00:00.000Z") {
  const root = await mkdtemp(join(tmpdir(), "apex-repeat-guard-"));
  let now = new Date(start);
  const clock = () => now;
  let id = 0;
  const idSource = () => `id-${++id}`;
  const store = new ProjectStore(root, clock, () => "run-1");
  await store.initializeProject({
    projectId: "demo",
    displayName: "Demo",
    defaultIacTool: "bicep",
    riskOwner: "partner",
  });
  await store.createRun("demo", { environment: "dev", targetScope: "local", runtimeLockHash: "a".repeat(64) });
  const runDirectory = store.runDirectory("demo", "run-1");
  const lockDirectory = join(root, ".apex", "local");
  const repository = new RunRepository(runDirectory, { clock, idSource });
  const worktree = await mkdtemp(join(root, "worktree-"));
  const other = await mkdtemp(join(root, "worktree-other-"));
  const scope = async (): Promise<RepeatScope> => {
    const state = await repository.repeatState();
    return {
      runDirectory,
      projectId: "demo",
      runId: "run-1",
      ownerEpoch: state.ownerEpoch,
      state: repeatStateToken({ selection: { projectId: "demo", runId: "run-1" }, projects: ["demo"], ...state }),
    };
  };
  const appendRunEvent = async (type = "test.changed") =>
    repository.journal.append({
      eventId: idSource(),
      projectId: "demo",
      runId: "run-1",
      type,
      timestamp: clock().toISOString(),
      ownerEpoch: 1,
      expectedHead: await repository.journal.head(),
      payload: { type },
    });
  let executions = 0;
  const call = (
    args: unknown = { taskId: "task-1", value: { b: 1, a: [1, 2] } },
    options: {
      workspace?: string;
      effect?: () => Promise<unknown>;
      result?: Record<string, unknown>;
      fail?: Error;
      validUntil?: string;
      windowMs?: number;
      maxRecords?: number;
      assertReplayAllowed?: (scope: RepeatScope) => Promise<void>;
    } = {},
  ) =>
    executeRepeatSafe(
      { operation: "stageArtifact", workspace: options.workspace ?? worktree, arguments: args },
      {
        lockDirectory,
        scope,
        assertReplayAllowed:
          options.assertReplayAllowed ??
          (async () => repository.assertWriterAvailable({ workspacePath: options.workspace ?? worktree })),
        execute: async () => {
          executions += 1;
          await repository.acquireWriterLease({ workspacePath: options.workspace ?? worktree });
          if (options.fail !== undefined) throw options.fail;
          await (options.effect ?? (() => appendRunEvent("artifact.staged")))();
          return options.result ?? { z: executions, a: { nested: [3, 1] }, staged: true };
        },
        ...(options.validUntil === undefined ? {} : { validUntil: () => options.validUntil }),
      },
      {
        clock,
        idSource,
        ...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
        ...(options.maxRecords === undefined ? {} : { maxRecords: options.maxRecords }),
      },
    );
  return {
    root,
    store,
    lockDirectory,
    runDirectory,
    repository,
    worktree,
    other,
    scope,
    appendRunEvent,
    call,
    executions: () => executions,
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

test("call hashes are canonical over key order, undefined members, and worktree spelling", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-repeat-hash-"));
  const real = join(root, "real");
  await mkdir(real);
  const link = join(root, "link");
  await symlink(real, link);
  const base: RepeatCall = { operation: "recordInput", workspace: real, arguments: { b: [1, { y: 2, x: 1 }], a: "v" } };
  const hash = repeatCallHash(base);
  assert.match(hash, /^[0-9a-f]{64}$/u);
  assert.equal(repeatCallHash({ ...base, arguments: { a: "v", b: [1, { x: 1, y: 2 }], c: undefined } }), hash);
  assert.equal(repeatCallHash({ ...base, workspace: link }), hash);
  assert.equal(repeatCallHash({ ...base, workspace: `${real}/` }), hash);
  assert.notEqual(repeatCallHash({ ...base, operation: "nextTask" }), hash);
  assert.notEqual(repeatCallHash({ ...base, workspace: root }), hash);
  assert.notEqual(repeatCallHash({ ...base, arguments: { a: "v", b: [{ x: 1, y: 2 }, 1] } }), hash);
  assert.equal(repeatCallHash({ ...base, arguments: undefined }), repeatCallHash({ ...base, arguments: null }));
  assert.throws(() => repeatCallHash({ ...base, operation: "../x" }), /operation is invalid/u);
  assert.throws(() => repeatCallHash({ ...base, arguments: { value: 1n } }), TypeError);
  assert.equal(repeatFingerprint(hash, null), repeatFingerprint(hash, null));
  assert.notEqual(repeatFingerprint(hash, "b".repeat(64)), repeatFingerprint(hash, null));
});

test("state tokens change with selection, projects, run, journal head, and writer but not lease renewal", async () => {
  const state = {
    selection: { projectId: "demo", runId: "run-1" },
    projects: ["b", "a"],
    runHash: "a".repeat(64),
    journalHead: null,
    writer: "/w1",
  };
  const token = repeatStateToken(state);
  assert.equal(repeatStateToken({ ...state, projects: ["a", "b"] }), token);
  for (const variant of [
    { selection: { projectId: "demo", runId: "run-2" } },
    { projects: ["a"] },
    { runHash: "b".repeat(64) },
    { journalHead: "c".repeat(64) },
    { writer: null },
  ]) {
    assert.notEqual(repeatStateToken({ ...state, ...variant }), token, JSON.stringify(variant));
  }
  const { repository, worktree, scope, advance } = await fixture();
  await repository.acquireWriterLease({ workspacePath: worktree });
  const before = (await scope()).state;
  advance(1_000);
  await repository.acquireWriterLease({ workspacePath: worktree });
  assert.equal((await scope()).state, before);
  assert.equal((await repository.repeatState()).writer !== null, true);
  await repository.releaseWriterLease({ workspacePath: worktree });
  assert.notEqual((await scope()).state, before);
});

test("an identical repeat returns the original result byte-for-byte and is audited without a state change", async () => {
  const { runDirectory, repository, call, executions, scope } = await fixture();
  const first = await call();
  assert.equal(first.repeated, false);
  const headAfter = await repository.journal.head();
  const stateAfter = (await scope()).state;
  const repeated = await call({ value: { a: [1, 2], b: 1 }, taskId: "task-1" });
  assert.equal(repeated.repeated, true);
  assert.equal(executions(), 1);
  assert.equal(JSON.stringify(repeated.value), JSON.stringify(first.value));
  assert.equal(await repository.journal.head(), headAfter);
  assert.equal((await scope()).state, stateAfter);
  const third = await call();
  assert.equal(third.repeated, true);
  assert.equal(executions(), 1);
  const events = await readRepeatEvents(runDirectory);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map(({ type, sequence }) => [type, sequence]),
    [
      [REPEAT_EVENT_TYPE, 1],
      [REPEAT_EVENT_TYPE, 2],
    ],
  );
  const payload = events[0]!.payload as Record<string, unknown>;
  assert.equal(payload.operation, "stageArtifact");
  assert.equal(payload.originalFingerprint, first.fingerprint);
  assert.equal(payload.fingerprint, repeated.fingerprint);
  assert.notEqual(payload.fingerprint, payload.originalFingerprint);
  assert.equal(payload.state, stateAfter);
});

test("an identical call after an intervening state change is a new request", async () => {
  const { call, executions, appendRunEvent, runDirectory } = await fixture();
  await call();
  await appendRunEvent("other.change");
  const next = await call();
  assert.equal(next.repeated, false);
  assert.equal(executions(), 2);
  assert.equal((await readRepeatEvents(runDirectory)).length, 0);
  assert.equal((await call()).repeated, true);
  assert.equal(executions(), 2);
});

test("different arguments or worktrees are new requests", async () => {
  const { call, executions, other } = await fixture();
  await call();
  assert.equal((await call({ taskId: "task-2" }, { effect: async () => undefined })).repeated, false);
  assert.equal(executions(), 2);
  await assert.rejects(call(undefined, { workspace: other }), RunWriterConflictError);
  assert.equal(executions(), 3);
});

test("the repeat window and result validity bound replay", async () => {
  const { call, executions, advance } = await fixture();
  await call(undefined, { effect: async () => undefined });
  advance(DEFAULT_REPEAT_WINDOW_MS - 1);
  assert.equal((await call()).repeated, true);
  advance(1);
  assert.equal((await call(undefined, { effect: async () => undefined })).repeated, false);
  assert.equal(executions(), 2);
  await call({ task: 1 }, { effect: async () => undefined, validUntil: "2026-01-01T00:10:00.100Z" });
  assert.equal((await call({ task: 1 })).repeated, true);
  advance(200);
  assert.equal((await call({ task: 1 }, { effect: async () => undefined })).repeated, false);
  await call({ short: 1 }, { effect: async () => undefined, windowMs: 10 });
  advance(10);
  assert.equal((await call({ short: 1 }, { effect: async () => undefined })).repeated, false);
});

test("failed calls are not recorded and a repeat re-runs normal checks", async () => {
  const { call, executions, runDirectory } = await fixture();
  await assert.rejects(call(undefined, { fail: new Error("validation failed") }), /validation failed/u);
  assert.deepEqual(await readRepeatRecords(runDirectory), []);
  assert.equal((await call()).repeated, false);
  assert.equal(executions(), 2);
});

test("repeat events keep the caller's worktree spelling while Windows identity is case-insensitive", async (context) => {
  const { runDirectory, root, lockDirectory, scope } = await fixture();
  const worktree = join(root, "WorkTree-Upper");
  await mkdir(worktree);
  // Simulate Windows: canonical worktree keys are case-folded, but audit records must not be.
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  context.after(() => Object.defineProperty(process, "platform", platform));
  let executions = 0;
  const run = (workspace: string) =>
    executeRepeatSafe(
      { operation: "projectUse", workspace, arguments: { projectId: "demo" } },
      {
        lockDirectory,
        scope,
        assertReplayAllowed: async () => undefined,
        execute: async () => ({ executions: ++executions }),
      },
    );
  assert.equal((await run(worktree)).repeated, false);
  assert.equal((await run(worktree)).repeated, true);
  assert.equal((await run(worktree.toLowerCase())).repeated, true);
  assert.equal(executions, 1);
  assert.deepEqual(
    (await readRepeatEvents(runDirectory)).map(({ payload }) => (payload as { workspace: string }).workspace),
    [worktree, worktree.toLowerCase()],
  );
});

test("concurrent identical calls in one workspace execute once", async () => {
  const { lockDirectory, repository, worktree, scope, appendRunEvent } = await fixture();
  let executions = 0;
  const run = () =>
    executeRepeatSafe(
      { operation: "projectUse", workspace: worktree, arguments: { projectId: "demo" } },
      {
        lockDirectory,
        scope,
        assertReplayAllowed: async () => repository.assertWriterAvailable({ workspacePath: worktree }),
        execute: async () => {
          executions += 1;
          await new Promise((done) => setTimeout(done, 50));
          await appendRunEvent("selection.changed");
          return { selected: true };
        },
      },
    );
  const outcomes = await Promise.all([run(), run(), run()]);
  assert.equal(executions, 1);
  assert.deepEqual(outcomes.map(({ repeated }) => repeated).sort(), [false, true, true]);
  assert.equal((await repository.journal.replay()).filter(({ type }) => type === "selection.changed").length, 1);
  await assert.rejects(lstat(join(lockDirectory, REPEAT_LOCK_FILE)), { code: "ENOENT" });
  assert.deepEqual(await readdir(join(lockDirectory, ".repeat-guard.retired")), []);
});

test("a call that changes the selected run still serializes identical calls", async () => {
  const { store, lockDirectory, worktree, scope } = await fixture();
  await store.initializeProject({
    projectId: "next",
    displayName: "Next",
    defaultIacTool: "bicep",
    riskOwner: "partner",
  });
  await store.createRun("next", { environment: "dev", targetScope: "local", runtimeLockHash: "a".repeat(64) });
  const nextRepository = new RunRepository(store.runDirectory("next", "run-1"));
  let selected: "demo" | "next" = "demo";
  const currentScope = async (): Promise<RepeatScope> => {
    if (selected === "demo") return scope();
    const state = await nextRepository.repeatState();
    return {
      runDirectory: store.runDirectory("next", "run-1"),
      projectId: "next",
      runId: "run-1",
      ownerEpoch: state.ownerEpoch,
      state: repeatStateToken({
        selection: { projectId: "next", runId: "run-1" },
        projects: ["demo", "next"],
        ...state,
      }),
    };
  };
  let executions = 0;
  let second: Promise<RepeatSafeOutcome<{ projectId: string }>> | undefined;
  const run = (): Promise<RepeatSafeOutcome<{ projectId: string }>> =>
    executeRepeatSafe(
      { operation: "projectUse", workspace: worktree, arguments: { projectId: "next" } },
      {
        lockDirectory,
        scope: currentScope,
        assertReplayAllowed: async () => undefined,
        execute: async () => {
          executions += 1;
          selected = "next";
          // An identical call that starts once the new selection is visible, before this call publishes its record.
          second ??= run();
          await new Promise((done) => setTimeout(done, 50));
          return { projectId: "next" };
        },
      },
    );
  const first = await run();
  const repeated = await second!;
  assert.equal(executions, 1);
  assert.equal(first.repeated, false);
  assert.equal(repeated.repeated, true);
});

test("the call that creates the first selection is answered as a repeat", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-repeat-first-"));
  const lockDirectory = join(root, ".apex", "local");
  await mkdir(join(root, ".apex"));
  const store = new ProjectStore(
    root,
    () => new Date(),
    () => "run-1",
  );
  let repository: RunRepository | undefined;
  const scope = async (): Promise<RepeatScope | undefined> => {
    if (repository === undefined) return undefined;
    const state = await repository.repeatState();
    return {
      runDirectory: store.runDirectory("demo", "run-1"),
      projectId: "demo",
      runId: "run-1",
      ownerEpoch: state.ownerEpoch,
      state: repeatStateToken({ selection: { projectId: "demo", runId: "run-1" }, projects: ["demo"], ...state }),
    };
  };
  let executions = 0;
  const run = () =>
    executeRepeatSafe(
      { operation: "projectCreate", workspace: root, arguments: { projectId: "demo" } },
      {
        lockDirectory,
        scope,
        assertReplayAllowed: async () => undefined,
        execute: async () => {
          executions += 1;
          if (repository !== undefined) throw new Error("project exists");
          await store.initializeProject({
            projectId: "demo",
            displayName: "Demo",
            defaultIacTool: "bicep",
            riskOwner: "partner",
          });
          await store.createRun("demo", { environment: "dev", targetScope: "local", runtimeLockHash: "a".repeat(64) });
          repository = new RunRepository(store.runDirectory("demo", "run-1"));
          return { created: "demo" };
        },
      },
    );
  const first = await run();
  const again = await run();
  assert.equal(first.repeated, false);
  assert.equal(again.repeated, true);
  assert.deepEqual(again.value, first.value);
  assert.equal(executions, 1);
});

test("a same-workspace writer holding the lock cannot land between a guarded call's reads and replay", async () => {
  const { lockDirectory, worktree, scope } = await fixture();
  let selected: "demo" | "next" = "demo";
  const currentScope = async (): Promise<RepeatScope> => {
    const current = await scope();
    return { ...current, state: selected === "demo" ? current.state : sha256Json({ selected }) };
  };
  let executions = 0;
  const run = () =>
    executeRepeatSafe(
      { operation: "projectUse", workspace: worktree, arguments: { projectId: "demo" } },
      {
        lockDirectory,
        scope: currentScope,
        assertReplayAllowed: async () => undefined,
        execute: async () => ({ executions: ++executions }),
      },
    );
  assert.equal((await run()).repeated, false);
  let repeat: Promise<RepeatSafeOutcome<{ executions: number }>> | undefined;
  // An unguarded writer, such as a CLI command, changes the selection while it holds the workspace lock.
  await withRepeatGuardLock(lockDirectory, async () => {
    repeat = run();
    await new Promise((done) => setTimeout(done, 50));
    selected = "next";
  });
  const outcome = await repeat!;
  assert.equal(outcome.repeated, false);
  assert.equal(executions, 2);
});

test("a call cancelled before or while it waits for the lock never executes", async () => {
  const { lockDirectory, worktree, scope } = await fixture();
  let executed = false;
  const call = (signal: AbortSignal) =>
    executeRepeatSafe(
      { operation: "projectUse", workspace: worktree, arguments: {} },
      {
        lockDirectory,
        scope,
        assertReplayAllowed: async () => undefined,
        execute: async () => ({ ok: (executed = true) }),
      },
      { lockWaitMs: 10_000, signal },
    );
  await assert.rejects(call(AbortSignal.abort()), RepeatGuardCancelledError);
  const controller = new AbortController();
  let waiting: Promise<unknown> | undefined;
  const started = Date.now();
  await withRepeatGuardLock(lockDirectory, async () => {
    waiting = call(controller.signal);
    await new Promise((done) => setTimeout(done, 50));
    controller.abort();
    await assert.rejects(waiting, RepeatGuardCancelledError);
  });
  assert.ok(Date.now() - started < 5_000);
  assert.equal(executed, false);
  assert.deepEqual(await readRepeatRecords((await scope()).runDirectory), []);
});

test("a holder suspended at a wait frees the lock and resumes only on unchanged state", async () => {
  const { lockDirectory } = await fixture();
  const lockFree = () => withRepeatGuardLock(lockDirectory, async () => "acquired", { lockWaitMs: 0 });
  let state = "s1";
  const token = async () => state;

  // While the holder waits, another caller takes and releases the lock; the unchanged state lets the holder continue
  // with the lock held again.
  const resumed = await withRepeatGuardLock(lockDirectory, async (hold) => {
    await assert.rejects(lockFree(), RepeatGuardBusyError);
    const answer = await hold.suspend(async () => {
      assert.equal(await lockFree(), "acquired");
      return "yes";
    }, token);
    await assert.rejects(lockFree(), RepeatGuardBusyError);
    return answer;
  });
  assert.equal(resumed, "yes");
  assert.equal(await lockFree(), "acquired");

  // A write during the wait makes the continuation stale; nothing after the wait runs and the lock is released.
  let continued = false;
  await assert.rejects(
    withRepeatGuardLock(lockDirectory, async (hold) => {
      await hold.suspend(async () => {
        await withRepeatGuardLock(lockDirectory, async () => {
          state = "s2";
        });
      }, token);
      continued = true;
    }),
    RepeatGuardStaleError,
  );
  assert.equal(continued, false);
  assert.equal(await lockFree(), "acquired");

  // A state that cannot be read after the wait cannot be proven unchanged.
  await assert.rejects(
    withRepeatGuardLock(lockDirectory, async (hold) => {
      let reads = 0;
      await hold.suspend(
        async () => undefined,
        async () => {
          if (++reads > 1) throw new Error("unreadable");
          return state;
        },
      );
    }),
    RepeatGuardStaleError,
  );

  // A failed wait ends the operation without taking the lock again.
  await assert.rejects(
    withRepeatGuardLock(lockDirectory, async (hold) => {
      await hold.suspend(async () => {
        throw new Error("terminal closed");
      }, token);
    }),
    /terminal closed/,
  );
  assert.equal(await lockFree(), "acquired");
});

test("a suspended holder keeps the lock when its state is unreadable and fails closed when it cannot resume", async () => {
  const { lockDirectory } = await fixture();
  const lockFree = () => withRepeatGuardLock(lockDirectory, async () => "acquired", { lockWaitMs: 0 });

  // Without a state token there is nothing to compare after the wait, so the lock stays held through it.
  await withRepeatGuardLock(lockDirectory, async (hold) => {
    await hold.suspend(
      async () => {
        await assert.rejects(lockFree(), RepeatGuardBusyError);
      },
      async () => {
        throw new Error("unreadable");
      },
    );
  });

  // A caller cancelled during the wait does not continue, even when the lock is free to take again.
  const controller = new AbortController();
  let resumed = false;
  await assert.rejects(
    withRepeatGuardLock(
      lockDirectory,
      async (hold) => {
        await hold.suspend(
          async () => controller.abort(),
          async () => "s",
        );
        resumed = true;
      },
      { signal: controller.signal },
    ),
    RepeatGuardCancelledError,
  );
  assert.equal(resumed, false);
  assert.equal(await lockFree(), "acquired");

  // Suspensions do not nest.
  await withRepeatGuardLock(lockDirectory, async (hold) => {
    await hold.suspend(
      async () => {
        await assert.rejects(
          hold.suspend(
            async () => undefined,
            async () => "s",
          ),
          /already suspended/,
        );
      },
      async () => "s",
    );
  });

  // Another holder that keeps the lock past the wait budget makes the resume fail as busy, not continue unlocked.
  let release!: () => void;
  const blocker = new Promise<void>((done) => (release = done));
  let blocking: Promise<unknown> | undefined;
  await assert.rejects(
    withRepeatGuardLock(
      lockDirectory,
      async (hold) => {
        await hold.suspend(
          async () => {
            let acquired!: () => void;
            const held = new Promise<void>((done) => (acquired = done));
            blocking = withRepeatGuardLock(lockDirectory, async () => {
              acquired();
              await blocker;
            });
            await held;
          },
          async () => "s",
        );
      },
      { lockWaitMs: 50 },
    ),
    RepeatGuardBusyError,
  );
  release();
  await blocking;
  assert.equal(await lockFree(), "acquired");
});

test("a workspace created while an unserialized holder waits is locked when the holder resumes", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-repeat-guard-"));
  const lockDirectory = join(root, ".apex", "local");
  await withRepeatGuardLock(lockDirectory, async (hold) => {
    await hold.suspend(
      async () => {
        await mkdir(join(root, ".apex"));
      },
      async () => "s",
    );
    await assert.rejects(
      withRepeatGuardLock(lockDirectory, async () => undefined, { lockWaitMs: 0 }),
      RepeatGuardBusyError,
    );
  });
  assert.equal(await withRepeatGuardLock(lockDirectory, async () => "acquired", { lockWaitMs: 0 }), "acquired");
});

test("a live repeat lock makes callers fail closed; an expired dead holder's lock is taken over", async () => {
  const { lockDirectory, worktree, scope } = await fixture();
  const call = (lockWaitMs: number) =>
    executeRepeatSafe(
      { operation: "projectUse", workspace: worktree, arguments: {} },
      { lockDirectory, scope, assertReplayAllowed: async () => undefined, execute: async () => ({ ok: true }) },
      { lockWaitMs },
    );
  const lock = join(lockDirectory, REPEAT_LOCK_FILE);
  const publish = async (token: string, pid: number, expiresAt: Date) => {
    await mkdir(lock, { recursive: true });
    await writeFile(
      join(lock, "metadata.json"),
      JSON.stringify({
        token,
        pid,
        host: hostname(),
        createdAt: new Date(expiresAt.getTime() - 30_000).toISOString(),
        expiresAt: expiresAt.toISOString(),
      }),
    );
  };
  // A live holder is never taken over, even after its generation expired.
  await publish("live", process.pid, new Date(Date.now() - 1_000));
  await assert.rejects(call(60), RepeatGuardBusyError);
  await rm(lock, { recursive: true });
  await publish("dead", 2_147_483_647, new Date(Date.now() - 1_000));
  assert.equal((await call(0)).repeated, false);
  await assert.rejects(lstat(lock), { code: "ENOENT" });
  const tombstones = await readdir(join(lockDirectory, ".repeat-guard.retired"));
  assert.equal(tombstones.length, 1);
  assert.equal(
    JSON.parse(await readFile(join(lockDirectory, ".repeat-guard.retired", tombstones[0]!, "metadata.json"), "utf8"))
      .token,
    "dead",
  );
});

test("a delayed stale repeat-lock contender cannot remove a replacement lock", async () => {
  const { lockDirectory, worktree, scope } = await fixture();
  const lock = join(lockDirectory, REPEAT_LOCK_FILE);
  const deadPid = 2_147_483_647;
  await mkdir(lock, { recursive: true });
  await writeFile(
    join(lock, "metadata.json"),
    JSON.stringify({
      token: "dead",
      pid: deadPid,
      host: hostname(),
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() - 30_000).toISOString(),
    }),
  );
  const originalKill = process.kill;
  let swapped = false;
  // Between the contender's snapshot and its liveness check, another contender takes the stale lock over and a new
  // owner publishes a replacement.
  process.kill = ((pid: number, signal?: string | number) => {
    if (pid !== deadPid) return originalKill.call(process, pid, signal);
    if (!swapped) {
      swapped = true;
      fs.rmSync(lock, { recursive: true });
      fs.mkdirSync(lock);
      fs.writeFileSync(
        join(lock, "metadata.json"),
        JSON.stringify({
          token: "replacement",
          pid: process.pid,
          host: hostname(),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
        }),
      );
    }
    throw Object.assign(new Error("ESRCH: injected"), { code: "ESRCH" });
  }) as typeof process.kill;
  let executed = false;
  try {
    await assert.rejects(
      executeRepeatSafe(
        { operation: "projectUse", workspace: worktree, arguments: {} },
        {
          lockDirectory,
          scope,
          assertReplayAllowed: async () => undefined,
          execute: async () => ({ ok: (executed = true) }),
        },
        { lockWaitMs: 60 },
      ),
      RepeatGuardBusyError,
    );
  } finally {
    process.kill = originalKill;
  }
  assert.equal(swapped, true);
  assert.equal(executed, false);
  assert.equal(JSON.parse(await readFile(join(lock, "metadata.json"), "utf8")).token, "replacement");
});

test("a call whose identity changed is never replayed, and is returned but not stored", async () => {
  const { runDirectory, repository, worktree, lockDirectory, scope } = await fixture();
  let executions = 0;
  const run = (stable: boolean) =>
    executeRepeatSafe(
      { operation: "governanceImport", workspace: worktree, arguments: { path: "baseline.json" } },
      {
        lockDirectory,
        scope,
        assertReplayAllowed: async () => repository.assertWriterAvailable({ workspacePath: worktree }),
        execute: async () => ({ executions: ++executions }),
        identityStable: async () => stable,
      },
    );
  assert.deepEqual((await run(false)).value, { executions: 1 });
  assert.deepEqual(await readRepeatRecords(runDirectory), []);
  assert.equal((await run(true)).repeated, false);
  assert.equal((await run(true)).repeated, true);
  assert.equal(executions, 2);
  // A bound file that changed after the identity was taken, for example while waiting for the lock, is never answered
  // from the stored result; the call executes against the current file instead.
  const changed = await run(false);
  assert.equal(changed.repeated, false);
  assert.deepEqual(changed.value, { executions: 3 });
  assert.equal(executions, 3);
});

const PINNED_SECONDS = 1_700_000_000;

/** Writes `content` with whole-second access and modification times, so a later edit can restore them exactly. */
async function writePinned(path: string, content: string): Promise<void> {
  await writeFile(path, content);
  await utimes(path, PINNED_SECONDS, PINNED_SECONDS);
}

/** Rewrites a pinned file with same-length content and restores its size and modification time exactly. */
async function sameStatEdit(path: string, content: string): Promise<void> {
  const before = await stat(path, { bigint: true });
  assert.equal(BigInt(Buffer.byteLength(content)), before.size);
  await writePinned(path, content);
  const after = await stat(path, { bigint: true });
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeNs, before.mtimeNs);
}

test("bound files hold only through the operation's own writes, and a size- and mtime-preserving edit is detected", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-repeat-files-"));
  const work = join(root, "work");
  const staged = join(work, "task-1", "code", "main.bicep");
  await mkdir(dirname(staged), { recursive: true });
  await writePinned(staged, "param a string\n");
  const start = await snapshotRepeatFiles([work, join(work, "task-1", "code")]);
  assert.deepEqual(start.roots, [work, join(work, "task-1", "code")].sort());
  assert.equal(start.entries[staged]?.type, "file");
  assert.equal(repeatFilesHeld(start, await snapshotRepeatFiles(start.roots)), true);

  // A write the operation reports, including the directories it creates, holds; an unreported one does not.
  const written = join(work, "task-2", "requirements.json");
  await mkdir(dirname(written), { recursive: true });
  await writeFile(written, "{}");
  const writes = new RepeatFileWrites();
  writes.file(written, sha256Text("{}"));
  const end = await snapshotRepeatFiles(start.roots);
  assert.equal(repeatFilesHeld(start, end, writes), true);
  assert.equal(repeatFilesHeld(start, end), false);
  const wrong = new RepeatFileWrites();
  wrong.file(written, sha256Text("[]"));
  assert.equal(repeatFilesHeld(start, end, wrong), false);

  // A content change that keeps every stat field is still a change, because files are bound by content.
  const forged = structuredClone(start);
  forged.entries[staged] = { ...(forged.entries[staged] as { type: "file"; sha256: string; stat: string }) };
  (forged.entries[staged] as { sha256: string }).sha256 = sha256Text("param b string\n");
  assert.equal(repeatFilesHeld(start, forged), false);
  assert.notEqual(repeatFilesDigest(forged), repeatFilesDigest(start));
  await sameStatEdit(staged, "param b string\n");
  const edited = await snapshotRepeatFiles(start.roots);
  assert.notEqual(
    (edited.entries[staged] as { sha256: string }).sha256,
    (start.entries[staged] as { sha256: string }).sha256,
  );
  assert.equal(repeatFilesHeld(start, edited, writes), false);

  // A removal the operation reports holds for the whole removed tree.
  const removing = await snapshotRepeatFiles([work]);
  await rm(join(work, "task-2"), { recursive: true });
  const removal = new RepeatFileWrites();
  removal.removed(join(work, "task-2"));
  assert.equal(repeatFilesHeld(removing, await snapshotRepeatFiles([work]), removal), true);
  assert.equal(repeatFilesHeld(removing, await snapshotRepeatFiles([work])), false);
  // An end snapshot that does not cover every start root cannot show the start roots unchanged.
  assert.equal(repeatFilesHeld(removing, await snapshotRepeatFiles([join(root, "other")])), false);
});

test("a repeat file snapshot streams large files, fails closed over budget, and refuses a linked root", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-repeat-budget-"));
  const large = join(root, "large.bin");
  const bytes = Buffer.alloc(300 * 1024, 7);
  await writeFile(large, bytes);
  const snapshot = await snapshotRepeatFiles([root]);
  assert.equal((snapshot.entries[large] as { sha256: string }).sha256, sha256Bytes(bytes));
  await assert.rejects(snapshotRepeatFiles([root], { maxBytes: bytes.byteLength - 1 }), RepeatFileSnapshotError);
  await assert.rejects(snapshotRepeatFiles([root], { maxEntries: 1 }), RepeatFileSnapshotError);
  assert.deepEqual((await snapshotRepeatFiles([join(root, "missing")])).entries, {});
  if (process.platform !== "win32") {
    const linked = join(root, "linked");
    await symlink(root, linked);
    await assert.rejects(snapshotRepeatFiles([linked]), RepeatFileSnapshotError);
    await assert.rejects(snapshotRepeatFiles([root, linked]), RepeatFileSnapshotError);
  }
  await assert.rejects(snapshotRepeatFiles([root], { attempts: 0 }), RangeError);
});

async function boundFixture() {
  const base = await fixture();
  const work = join(base.root, ".apex", "work", "run-1");
  const staged = join(work, "task-1", "code", "main.bicep");
  await mkdir(dirname(staged), { recursive: true });
  await writePinned(staged, "param a string\n");
  let roots = [work];
  let failNextScope = false;
  const scope = async (): Promise<RepeatScope> => {
    if (failNextScope) {
      failNextScope = false;
      throw new Error("scope unavailable");
    }
    const state = await base.repository.repeatState();
    const files = await snapshotRepeatFiles(roots);
    return {
      runDirectory: base.runDirectory,
      projectId: "demo",
      runId: "run-1",
      ownerEpoch: state.ownerEpoch,
      state: repeatStateToken({
        selection: { projectId: "demo", runId: "run-1" },
        projects: ["demo"],
        ...state,
        files: repeatFilesDigest(files),
      }),
      files,
    };
  };
  let executions = 0;
  const run = (effect: (writes: RepeatFileWrites) => Promise<void> = async () => undefined) => {
    const writes = new RepeatFileWrites();
    return executeRepeatSafe(
      { operation: "validateTask", workspace: base.worktree, arguments: { taskId: "task-1" } },
      {
        lockDirectory: base.lockDirectory,
        scope,
        assertReplayAllowed: async () => undefined,
        execute: async () => {
          executions += 1;
          await effect(writes);
          return { executions };
        },
        writes,
      },
    );
  };
  return {
    ...base,
    work,
    staged,
    run,
    executions: () => executions,
    setRoots(next: string[]) {
      roots = next;
    },
    failNextScope() {
      failNextScope = true;
    },
  };
}

test("a bound file edited while the operation runs never binds the result, and the repeat is a new request", async () => {
  const { runDirectory, staged, run, executions } = await boundFixture();
  // The operation read the staged file at its start; an editor changes it before the operation returns.
  const raced = await run(async () => writePinned(staged, "param b string\n"));
  assert.equal(raced.repeated, false);
  assert.deepEqual(await readRepeatRecords(runDirectory), []);
  assert.equal((await run()).repeated, false);
  assert.equal(executions(), 2);
  assert.equal((await readRepeatRecords(runDirectory)).length, 1);
  assert.equal((await run()).repeated, true);
  assert.equal(executions(), 2);

  // The same holds for an edit that keeps the file's size and modification time.
  const sameStat = await run(async () => undefined);
  assert.equal(sameStat.repeated, true);
  const stored = await readRepeatRecords(runDirectory);
  await sameStatEdit(staged, "param c string\n");
  // The stored record no longer matches the edited content, so the identical call executes.
  const executed = await run(async () => sameStatEdit(staged, "param d string\n"));
  assert.equal(executed.repeated, false);
  assert.equal(executions(), 3);
  assert.deepEqual(await readRepeatRecords(runDirectory), stored);
});

test("an operation's own writes to bound files are stored, an edit after them is not", async () => {
  const { runDirectory, work, run, executions } = await boundFixture();
  const output = join(work, "task-2", "requirements.json");
  const write = async (writes: RepeatFileWrites) => {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, "{}");
    writes.file(output, sha256Text("{}"));
  };
  assert.equal((await run(write)).repeated, false);
  assert.equal((await readRepeatRecords(runDirectory)).length, 1);
  assert.equal((await run(write)).repeated, true);
  assert.equal(executions(), 1);

  // An editor that rewrites the operation's output before the call returns keeps the result from being stored.
  await rm(join(work, "task-2"), { recursive: true });
  const stored = await readRepeatRecords(runDirectory);
  const edited = await run(async (writes) => {
    await write(writes);
    await writeFile(output, "[]");
  });
  assert.equal(edited.repeated, false);
  assert.deepEqual(await readRepeatRecords(runDirectory), stored);
  assert.equal((await run()).repeated, false);
  assert.equal(executions(), 3);
});

test("bound roots a call leaves are rechecked, and an unreadable start state never stores a result", async () => {
  const { runDirectory, root, work, staged, run, executions, setRoots, failNextScope } = await boundFixture();
  const next = join(root, ".apex", "work", "run-2");
  // A call that changes the bound roots, such as one that selects another run, is still checked against the roots it
  // started with.
  const switching = (edit: boolean) =>
    run(async () => {
      setRoots([next]);
      if (edit) await writeFile(staged, "param b string\n");
    });
  assert.equal((await switching(true)).repeated, false);
  assert.deepEqual(await readRepeatRecords(runDirectory), []);
  setRoots([work]);
  assert.equal((await switching(false)).repeated, false);
  const stored = await readRepeatRecords(runDirectory);
  assert.equal(stored.length, 1);

  setRoots([work]);
  failNextScope();
  assert.equal((await run()).repeated, false);
  assert.deepEqual(await readRepeatRecords(runDirectory), stored);
  assert.equal(executions(), 3);
});

test("repeat records survive a restart because they are stored with the run", async () => {
  const { call, runDirectory, worktree, lockDirectory } = await fixture();
  const first = await call();
  const stored = JSON.parse(await readFile(join(runDirectory, REPEAT_GUARD_FILE), "utf8")) as {
    schemaVersion: string;
    records: Array<{ result: string; fingerprint: string }>;
  };
  assert.equal(stored.schemaVersion, CONTRACT_VERSION);
  registerContractFormats();
  assert.equal(Value.Check(RepeatGuardRecordsV1Schema, stored), true);
  assert.equal(stored.records.length, 1);
  assert.equal(stored.records[0]!.result, JSON.stringify(first.value));
  assert.equal(stored.records[0]!.fingerprint, first.fingerprint);
  // A new process: fresh repository, hooks and clock; only the run directory is shared.
  const restarted = new RunRepository(runDirectory);
  let executed = false;
  const again = await executeRepeatSafe(
    { operation: "stageArtifact", workspace: worktree, arguments: { taskId: "task-1", value: { b: 1, a: [1, 2] } } },
    {
      lockDirectory,
      scope: async () => {
        const state = await restarted.repeatState();
        return {
          runDirectory,
          projectId: "demo",
          runId: "run-1",
          ownerEpoch: state.ownerEpoch,
          state: repeatStateToken({ selection: { projectId: "demo", runId: "run-1" }, projects: ["demo"], ...state }),
        };
      },
      assertReplayAllowed: async () => restarted.assertWriterAvailable({ workspacePath: worktree }),
      execute: async () => {
        executed = true;
        return {};
      },
    },
    { clock: () => new Date("2026-01-01T00:00:01.000Z") },
  );
  assert.equal(again.repeated, true);
  assert.equal(executed, false);
  assert.equal(JSON.stringify(again.value), JSON.stringify(first.value));
});

test("replay never bypasses the writer lease of another worktree", async () => {
  const { call, executions, repository, worktree, other, runDirectory, advance } = await fixture();
  await call();
  await assert.rejects(
    call(undefined, {
      assertReplayAllowed: async () => repository.assertWriterAvailable({ workspacePath: other }),
    }),
    RunWriterConflictError,
  );
  assert.equal(executions(), 1);
  assert.equal((await readRepeatEvents(runDirectory)).length, 0);
  await repository.assertWriterAvailable({ workspacePath: worktree });
  advance(120_001);
  await repository.assertWriterAvailable({ workspacePath: other });
});

test("records are bounded, pruned on state change, and oversize results are not stored", async () => {
  const { call, runDirectory, appendRunEvent } = await fixture();
  for (let index = 0; index < MAX_REPEAT_RECORDS + 4; index += 1)
    await call({ index }, { effect: async () => undefined });
  const records = await readRepeatRecords(runDirectory);
  assert.equal(records.length, MAX_REPEAT_RECORDS);
  assert.equal(JSON.parse(records.at(-1)!.result).z, MAX_REPEAT_RECORDS + 4);
  assert.equal((await call({ index: 0 }, { effect: async () => undefined })).repeated, false);
  assert.equal((await call({ index: MAX_REPEAT_RECORDS + 3 })).repeated, true);
  await appendRunEvent();
  await call({ fresh: true }, { effect: async () => undefined });
  assert.deepEqual(
    (await readRepeatRecords(runDirectory)).map(({ operation }) => operation),
    ["stageArtifact"],
  );
  await call({ big: true }, { effect: async () => undefined, result: { blob: "x".repeat(MAX_REPEAT_RESULT_BYTES) } });
  assert.equal((await call({ big: true }, { effect: async () => undefined })).repeated, false);
  await call({ few: true }, { effect: async () => undefined, maxRecords: 1 });
  assert.equal((await readRepeatRecords(runDirectory)).length, 1);
  await assert.rejects(call({}, { maxRecords: MAX_REPEAT_RECORDS + 1 }), RangeError);
});

test("a corrupt or unsafe record file disables replay instead of forging a result", async () => {
  const { call, executions, runDirectory } = await fixture();
  await call();
  await writeFile(join(runDirectory, REPEAT_GUARD_FILE), "{not json");
  assert.deepEqual(await readRepeatRecords(runDirectory), []);
  assert.equal((await call(undefined, { effect: async () => undefined })).repeated, false);
  const stored = JSON.parse(await readFile(join(runDirectory, REPEAT_GUARD_FILE), "utf8")) as {
    records: Array<Record<string, unknown>>;
  };
  const valid = structuredClone(stored);
  stored.records[0]!.callHash = "not-a-hash";
  await writeFile(join(runDirectory, REPEAT_GUARD_FILE), JSON.stringify(stored));
  assert.deepEqual(await readRepeatRecords(runDirectory), []);
  assert.equal((await call(undefined, { effect: async () => undefined })).repeated, false);
  assert.equal(executions(), 3);
  // The file must satisfy the strict repeat-guard-records-v1 contract: unknown members disable replay too.
  for (const tampered of [
    { ...valid, unexpected: true },
    { ...valid, records: [{ ...valid.records[0], unexpected: true }] },
    { ...valid, schemaVersion: "2.0.0" },
  ]) {
    await writeFile(join(runDirectory, REPEAT_GUARD_FILE), JSON.stringify(tampered));
    assert.deepEqual(await readRepeatRecords(runDirectory), []);
  }
  await writeFile(join(runDirectory, REPEAT_GUARD_FILE), JSON.stringify(valid));
  assert.equal((await readRepeatRecords(runDirectory)).length, 1);
});
