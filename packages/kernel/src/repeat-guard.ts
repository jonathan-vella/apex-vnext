import {
  CONTRACT_VERSION,
  RepeatGuardRecordsV1Schema,
  contractMetadata,
  registerContractFormats,
  type EventV1,
  type ProjectId,
  type RepeatGuardRecordV1,
  type RepeatGuardRecordsV1,
  type RunId,
} from "@apexops/contracts";
import { Value } from "@sinclair/typebox/value";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { sha256Json, sha256Text } from "./canonical.js";
import { DirectoryLock } from "./directory-lock.js";
import { EventJournal } from "./event-journal.js";
import { atomicWriteJson } from "./files.js";
import { canonicalWorktreePath } from "./run-repository.js";

/** Run-scoped file holding the bounded set of calls that may still be answered from their original result. */
export const REPEAT_GUARD_FILE = ".repeat-guard.json";
/** Run-scoped, hash-chained audit journal of answered repeats. Separate from the run journal, whose head it keeps. */
export const REPEAT_JOURNAL_DIRECTORY = "repeats";
export const REPEAT_EVENT_TYPE = "call.repeated";
/**
 * Workspace-scoped directory lock serializing guarded calls across processes from record lookup through record
 * publication. It does not depend on the selected run, so calls that change the selection are serialized too.
 */
export const REPEAT_LOCK_FILE = ".repeat-guard.lock";
export const DEFAULT_REPEAT_LOCK_WAIT_MS = 30_000;
const REPEAT_LOCK_TTL_MS = 30_000;
export const DEFAULT_REPEAT_WINDOW_MS = 10 * 60 * 1000;
export const MAX_REPEAT_RECORDS = 16;
export const MAX_REPEAT_RESULT_BYTES = 64 * 1024;
const MAX_REPEAT_GUARD_FILE_BYTES = contractMetadata[RepeatGuardRecordsV1Schema.$id!]!.maxBytes;
const OPERATION = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const AUDIT_APPEND_ATTEMPTS = 3;

export interface RepeatCall {
  /** Stable operation name, for example the MCP tool name. */
  operation: string;
  /** Worktree that issued the call; compared in canonical form. */
  workspace: string;
  /** JSON arguments after input validation; undefined members are dropped and keys are sorted. */
  arguments: unknown;
}

export interface RepeatStateInput {
  selection: { projectId: string; runId: string };
  projects: readonly string[];
  runHash: string;
  journalHead: string | null;
  writer: string | null;
  /** Signature of mutable files the run's operations read, such as staged work and generated source trees. */
  files?: string | null;
}

/** The selected run a call applies to, with the state token that decides the repeat window. */
export interface RepeatScope {
  runDirectory: string;
  projectId: ProjectId;
  runId: RunId;
  ownerEpoch: number;
  state: string;
  /**
   * Latest change time, in milliseconds since the epoch, of the mutable files the state token covers. A change after
   * the operation returned was not made by the operation, so its result is not stored against that state.
   */
  changedAtMs?: number;
}

export interface RepeatSafeHooks<T> {
  /**
   * Machine-local workspace directory that holds the repeat lock, created when missing. While its parent does not exist
   * there is no workspace state yet, and calls run unserialized.
   */
  lockDirectory: string;
  /** Current selected run and state token, or undefined when no run is selected. */
  scope(): Promise<RepeatScope | undefined>;
  /** Ownership check for an answered repeat, such as the run writer lease. Must not write state. */
  assertReplayAllowed(scope: RepeatScope): Promise<void>;
  execute(): Promise<T>;
  /** Optional instant after which the original result must not be returned, such as a task expiry. */
  validUntil?(value: T): string | undefined;
  /**
   * Optional check that the call identity still holds, for example that a file bound by content was not modified since
   * the identity was taken. Before a replay, false makes the call execute instead; after execution, false returns the
   * result without storing it.
   */
  identityStable?(): Promise<boolean>;
}

export interface RepeatSafeOptions {
  clock?: () => Date;
  idSource?: () => string;
  windowMs?: number;
  maxRecords?: number;
  /** Longest wait for another guarded call in the workspace before failing with {@link RepeatGuardBusyError}. */
  lockWaitMs?: number;
  /** Cancels the call while it waits for the lock, and before lookup or execution once the lock is held. */
  signal?: AbortSignal;
}

/** Another guarded call in the workspace is still running; the caller should refresh state and retry later. */
/** The caller cancelled the call before it started; nothing was looked up, executed or recorded. */
export class RepeatGuardCancelledError extends Error {
  constructor() {
    super("The state-changing call was cancelled before it started");
    this.name = "RepeatGuardCancelledError";
  }
}

export class RepeatGuardBusyError extends Error {
  constructor() {
    super("Another state-changing call in this workspace is still in progress");
    this.name = "RepeatGuardBusyError";
  }
}

export interface RepeatSafeOutcome<T> {
  value: T;
  repeated: boolean;
  fingerprint: string;
}

/** A stored result; the persisted file is the versioned `repeat-guard-records-v1` contract. */
export type RepeatRecord = RepeatGuardRecordV1;

function normalizedArguments(value: unknown): unknown {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Repeat call arguments must be JSON");
  return JSON.parse(serialized) as unknown;
}

/** Identifies a call independent of state: operation, canonical worktree and canonical arguments. */
export function repeatCallHash(call: RepeatCall): string {
  if (!OPERATION.test(call.operation)) throw new TypeError("Repeat call operation is invalid");
  return sha256Json({
    version: 1,
    operation: call.operation,
    workspace: canonicalWorktreePath(call.workspace),
    arguments: normalizedArguments(call.arguments),
  });
}

/** Fingerprint of a call against the run state it applies to. */
export function repeatFingerprint(callHash: string, state: string | null): string {
  return sha256Json({ version: 1, callHash, state });
}

/**
 * State token for the repeat window. It changes whenever the selection, the project set, the selected run document,
 * its journal head, its writer lease holder or the signature of its mutable files changes; lease expiry renewals do
 * not change it.
 */
export function repeatStateToken(input: RepeatStateInput): string {
  return sha256Json({
    version: 1,
    selection: { projectId: input.selection.projectId, runId: input.selection.runId },
    projects: [...input.projects].sort(),
    runHash: input.runHash,
    journalHead: input.journalHead,
    writer: input.writer,
    files: input.files ?? null,
  });
}

function validRecords(value: unknown): value is RepeatGuardRecordsV1 {
  registerContractFormats();
  return (
    Value.Check(RepeatGuardRecordsV1Schema, value) &&
    value.records.length <= MAX_REPEAT_RECORDS &&
    value.records.every(
      (record) =>
        Number.isFinite(Date.parse(record.recordedAt)) &&
        Number.isFinite(Date.parse(record.expiresAt)) &&
        Buffer.byteLength(record.result) <= MAX_REPEAT_RESULT_BYTES,
    )
  );
}

/**
 * Reads the run's repeat records. An absent, unsafe or malformed file yields no records: losing a record only makes a
 * repeat a new request that normal kernel checks decide, so corruption cannot replay a forged result.
 */
export async function readRepeatRecords(runDirectory: string): Promise<RepeatRecord[]> {
  const path = join(runDirectory, REPEAT_GUARD_FILE);
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_REPEAT_GUARD_FILE_BYTES) return [];
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (bytes.byteLength > MAX_REPEAT_GUARD_FILE_BYTES) return [];
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    return validRecords(parsed) ? parsed.records : [];
  } catch {
    return [];
  }
}

export async function readRepeatEvents(runDirectory: string): Promise<EventV1[]> {
  return new EventJournal(join(runDirectory, REPEAT_JOURNAL_DIRECTORY)).replay();
}

function replayable(record: RepeatRecord): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(record.result) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function appendRepeatEvent(
  scope: RepeatScope,
  record: RepeatRecord,
  call: RepeatCall,
  fingerprint: string,
  now: Date,
  idSource: () => string,
): Promise<void> {
  const journal = new EventJournal(join(scope.runDirectory, REPEAT_JOURNAL_DIRECTORY));
  for (let attempt = 1; ; attempt += 1) {
    try {
      await journal.append({
        eventId: idSource(),
        projectId: scope.projectId,
        runId: scope.runId,
        type: REPEAT_EVENT_TYPE,
        timestamp: now.toISOString(),
        ownerEpoch: scope.ownerEpoch,
        expectedHead: await journal.head(),
        payload: {
          operation: record.operation,
          // Record the worktree as the caller sees it; the case-folded comparison key belongs only in callHash.
          workspace: resolve(call.workspace),
          callHash: record.callHash,
          fingerprint,
          originalFingerprint: record.fingerprint,
          state: scope.state,
          originalRecordedAt: record.recordedAt,
          resultHash: sha256Text(record.result),
        },
      });
      return;
    } catch (error) {
      if (attempt >= AUDIT_APPEND_ATTEMPTS || !(error as Error).message.startsWith("Stale journal head")) throw error;
    }
  }
}

async function storeRepeatRecord(
  scope: RepeatScope,
  candidate: RepeatRecord | undefined,
  callHash: string,
  now: Date,
  maxRecords: number,
): Promise<void> {
  // A record is answerable only while the run state equals its post-call state, so any record whose state differs
  // from the current state, or that expired, is dropped. The newest bounded set of same-state calls remains.
  const live = (await readRepeatRecords(scope.runDirectory)).filter(
    (record) =>
      record.stateAfter === scope.state && Date.parse(record.expiresAt) > now.getTime() && record.callHash !== callHash,
  );
  const records = [...live, ...(candidate === undefined ? [] : [candidate])].slice(-maxRecords);
  const file: RepeatGuardRecordsV1 = { schemaVersion: CONTRACT_VERSION, records };
  if (!validRecords(file)) throw new Error("Repeat records do not satisfy repeat-guard-records-v1");
  await atomicWriteJson(join(scope.runDirectory, REPEAT_GUARD_FILE), file);
}

/**
 * Executes a state-changing call at most once per run state. An identical call (same operation, worktree and
 * arguments) made while the selected run is unchanged since the original succeeded, and within the window, returns the
 * original serialized result and appends a `call.repeated` audit event instead of executing again. Any intervening
 * state change, an expired window, a failed original call or a missing record makes the call a new request. Guarded
 * calls in one workspace are serialized across processes from record lookup through record publication, including
 * calls that create or change the selected run.
 */
export async function executeRepeatSafe<T extends object>(
  call: RepeatCall,
  hooks: RepeatSafeHooks<T>,
  options: RepeatSafeOptions = {},
): Promise<RepeatSafeOutcome<T>> {
  const clock = options.clock ?? (() => new Date());
  const idSource = options.idSource ?? (() => crypto.randomUUID());
  const windowMs = options.windowMs ?? DEFAULT_REPEAT_WINDOW_MS;
  const maxRecords = options.maxRecords ?? MAX_REPEAT_RECORDS;
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new RangeError("Repeat window must be positive");
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > MAX_REPEAT_RECORDS)
    throw new RangeError(`Repeat records must be an integer from 1 to ${MAX_REPEAT_RECORDS}`);
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_REPEAT_LOCK_WAIT_MS;
  const callHash = repeatCallHash(call);
  return withRepeatGuardLock(
    hooks.lockDirectory,
    () => guardedCall(call, callHash, hooks, clock, idSource, windowMs, maxRecords),
    { lockWaitMs, ...(options.signal === undefined ? {} : { signal: options.signal }) },
  );
}

/**
 * Runs `operation` while holding the workspace repeat lock in `lockDirectory`. Guarded calls take it, and so must every
 * other writer of the same workspace (such as state-changing CLI commands), so that no write lands between a guarded
 * call's state reads, execution and record publication. While the parent of `lockDirectory` does not exist there is no
 * workspace state yet, and `operation` runs unserialized. The lock is not reentrant.
 */
export async function withRepeatGuardLock<T>(
  lockDirectory: string,
  operation: () => Promise<T>,
  options: { lockWaitMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_REPEAT_LOCK_WAIT_MS;
  if (!Number.isSafeInteger(lockWaitMs) || lockWaitMs < 0)
    throw new RangeError("Repeat lock wait must not be negative");
  const { signal } = options;
  const cancelled = () => (signal?.aborted === true ? new RepeatGuardCancelledError() : undefined);
  const started = async () => {
    const error = cancelled();
    if (error !== undefined) throw error;
    return operation();
  };
  if (signal?.aborted === true) throw new RepeatGuardCancelledError();
  try {
    await lstat(dirname(lockDirectory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return started();
    throw error;
  }
  await mkdir(lockDirectory, { recursive: true });
  const directory = await lstat(lockDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error("Repeat guard lock directory is not a regular directory");
  const lock = new DirectoryLock(join(lockDirectory, REPEAT_LOCK_FILE), {
    label: "Repeat guard lock",
    clock: () => new Date(),
    idSource: () => crypto.randomUUID(),
    ttlMs: REPEAT_LOCK_TTL_MS,
    platform: process.platform,
    busyError: () => new RepeatGuardBusyError(),
  });
  return lock.run(started, { waitMs: lockWaitMs, onContention: async () => cancelled() });
}

async function guardedCall<T extends object>(
  call: RepeatCall,
  callHash: string,
  hooks: RepeatSafeHooks<T>,
  clock: () => Date,
  idSource: () => string,
  windowMs: number,
  maxRecords: number,
): Promise<RepeatSafeOutcome<T>> {
  const before = await hooks.scope().catch(() => undefined);
  const fingerprint = repeatFingerprint(callHash, before?.state ?? null);
  if (before !== undefined) {
    const now = clock();
    const records = await readRepeatRecords(before.runDirectory);
    const record = records.findLast(
      (candidate) =>
        candidate.callHash === callHash &&
        candidate.stateAfter === before.state &&
        Date.parse(candidate.expiresAt) > now.getTime(),
    );
    const original = record === undefined ? undefined : replayable(record);
    // A bound file that changed since the call identity was taken makes the stored result stale; execute instead.
    // The state is read again so that an edit that bypasses the workspace lock while the record was checked cannot be
    // answered from the stored result; the replay is then current as of that second read.
    if (
      record !== undefined &&
      original !== undefined &&
      (hooks.identityStable === undefined || (await hooks.identityStable())) &&
      (await hooks.scope().catch(() => undefined))?.state === before.state
    ) {
      await hooks.assertReplayAllowed(before);
      await appendRepeatEvent(before, record, call, fingerprint, now, idSource);
      return { value: original as T, repeated: true, fingerprint };
    }
  }
  const value = await hooks.execute();
  const finishedAt = Date.now();
  try {
    if (hooks.identityStable !== undefined && !(await hooks.identityStable()))
      return { value, repeated: false, fingerprint };
    const after = await hooks.scope();
    if (after === undefined) return { value, repeated: false, fingerprint };
    // A file changed after the operation returned, for example by an editor that bypasses the workspace lock, would
    // bind this result to content the operation never saw.
    if (after.changedAtMs !== undefined && after.changedAtMs > finishedAt)
      return { value, repeated: false, fingerprint };
    const now = clock();
    const result = JSON.stringify(value);
    const limit = hooks.validUntil?.(value);
    const expiresAt = Math.min(
      now.getTime() + windowMs,
      limit === undefined || !Number.isFinite(Date.parse(limit)) ? Number.POSITIVE_INFINITY : Date.parse(limit),
    );
    const storable =
      typeof result === "string" &&
      Buffer.byteLength(result) <= MAX_REPEAT_RESULT_BYTES &&
      replayable({ result } as RepeatRecord) !== undefined &&
      expiresAt > now.getTime();
    await storeRepeatRecord(
      after,
      storable
        ? {
            fingerprint,
            callHash,
            operation: call.operation,
            stateBefore: before?.state ?? null,
            stateAfter: after.state,
            recordedAt: now.toISOString(),
            expiresAt: new Date(expiresAt).toISOString(),
            result,
          }
        : undefined,
      callHash,
      now,
      maxRecords,
    );
  } catch {
    // The call has committed. Without a stored record a repeat is a new request decided by normal kernel checks.
  }
  return { value, repeated: false, fingerprint };
}
