import type { RunConfigV1 } from "@apexops/contracts";
import { realpathSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { sha256Json, type JsonValue } from "./canonical.js";
import { EventJournal, type AppendEventInput } from "./event-journal.js";
import { DirectoryLock } from "./directory-lock.js";
import { atomicWriteJson, readPublishedFile } from "./files.js";
import { parseRunConfig } from "./run-config.js";

export interface RunMutation {
  expectedRunHash: string;
  expectedJournalHead?: string | null;
  event: Omit<AppendEventInput, "expectedHead">;
  update: (current: RunConfigV1) => RunConfigV1;
}

export interface RunMutationResult {
  run: RunConfigV1;
  runHash: string;
  eventHash: string;
}

export type RunTransactionStage = "intent" | "journal" | "run" | "cleanup";

export interface RunRepositoryOptions {
  clock?: () => Date;
  idSource?: () => string;
  lockTtlMs?: number;
  writerLeaseTtlMs?: number;
  /** How long a writer lease acquisition waits for the run mutation lock; defaults to 10 seconds. */
  writerLeaseLockWaitMs?: number;
  /** Selects Windows transient file-sharing handling; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  faultInjector?: (stage: RunTransactionStage) => void | Promise<void>;
}

interface TransactionIntent {
  version: 1;
  eventId: string;
  beforeHash: string;
  afterHash: string;
  after: RunConfigV1;
}

interface RunWriterLeaseSnapshot {
  metadata: RunWriterLease;
  expiresAt: number;
}

export interface RunWriterLeaseOwner {
  workspacePath: string;
  sessionId?: string;
}

export interface RunWriterLease {
  version: 1;
  workspacePath: string;
  host: string;
  pid: number;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
}

export class RunWriterConflictError extends Error {
  readonly code = "APEX_WRITER_CONFLICT";

  constructor(
    readonly ownerWorktree: string,
    readonly expiresAt: string,
    options?: ErrorOptions,
  ) {
    super(`Run writer lease is held by ${ownerWorktree} until ${expiresAt}`, options);
    this.name = "RunWriterConflictError";
  }
}

export class RunMutationBusyError extends Error {
  constructor() {
    super("Run mutation is already in progress");
    this.name = "RunMutationBusyError";
  }
}

const WRITER_LEASE_FILE = ".run-writer-lease.json";
const MAX_WRITER_LEASE_BYTES = 64 * 1024;
// Same-workspace renewals cannot fail fast with a conflict, so they queue on the run mutation lock. The budget must
// cover a serialized queue of lock cycles on slow file systems (Windows cycles are an order of magnitude slower).
const WRITER_LEASE_LOCK_WAIT_MS = 10_000;
const TRANSIENT_LOCK_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function writerLeaseExpiry(value: unknown): number | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const lease = value as Partial<RunWriterLease>;
  const createdAt = Date.parse(lease.createdAt ?? "");
  const expiresAt = Date.parse(lease.expiresAt ?? "");
  return lease.version === 1 &&
    typeof lease.workspacePath === "string" &&
    lease.workspacePath.length > 0 &&
    Number.isInteger(lease.pid) &&
    Number(lease.pid) > 0 &&
    typeof lease.host === "string" &&
    lease.host.length > 0 &&
    typeof lease.sessionId === "string" &&
    lease.sessionId.length > 0 &&
    Number.isFinite(createdAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt >= createdAt
    ? expiresAt
    : undefined;
}

export interface RunRepeatState {
  runHash: string;
  journalHead: string | null;
  ownerEpoch: number;
  writer: string | null;
}

/** Resolves a worktree path to the form used for ownership and repeat comparisons (case-folded on Windows). */
export function canonicalWorktreePath(path: string): string {
  let canonical = resolve(path);
  try {
    canonical = realpathSync(canonical);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return process.platform === "win32" ? canonical.toLocaleLowerCase() : canonical;
}

function sameWorkspace(left: string, right: string): boolean {
  return canonicalWorktreePath(left) === canonicalWorktreePath(right);
}

export class RunRepository {
  private readonly runPath: string;
  private readonly mutationLock: DirectoryLock;
  private readonly intentPath: string;
  private readonly writerLeasePath: string;
  private readonly clock: () => Date;
  private readonly idSource: () => string;
  private readonly writerLeaseTtlMs: number;
  private readonly writerLeaseLockWaitMs: number;
  private readonly platform: NodeJS.Platform;
  private readonly faultInjector?: RunRepositoryOptions["faultInjector"];
  readonly journal: EventJournal;

  constructor(runDirectory: string, options: RunRepositoryOptions = {}) {
    const directory = resolve(runDirectory);
    this.runPath = join(directory, "run.json");
    this.intentPath = join(directory, ".run-transaction.json");
    this.writerLeasePath = join(directory, WRITER_LEASE_FILE);
    this.clock = options.clock ?? (() => new Date());
    this.idSource = options.idSource ?? (() => crypto.randomUUID());
    this.writerLeaseTtlMs = options.writerLeaseTtlMs ?? 120_000;
    this.writerLeaseLockWaitMs = options.writerLeaseLockWaitMs ?? WRITER_LEASE_LOCK_WAIT_MS;
    this.platform = options.platform ?? process.platform;
    this.faultInjector = options.faultInjector;
    this.mutationLock = new DirectoryLock(join(directory, ".run-mutation.lock"), {
      label: "Run mutation lock",
      clock: this.clock,
      idSource: this.idSource,
      ttlMs: options.lockTtlMs ?? 30_000,
      platform: this.platform,
      busyError: () => new RunMutationBusyError(),
    });
    this.journal = new EventJournal(join(directory, "journal"));
  }

  async hash(): Promise<string> {
    return sha256Json((await this.read()) as unknown as JsonValue);
  }
  async read(): Promise<RunConfigV1> {
    await this.withLock(() => this.recover());
    return this.readRaw();
  }

  async mutate(input: RunMutation): Promise<RunMutationResult> {
    return this.withLock(async () => {
      await this.recover();
      const current = await this.readRaw();
      const actualHash = sha256Json(current as unknown as JsonValue);
      if (actualHash !== input.expectedRunHash)
        throw new Error(`Stale run hash: expected ${input.expectedRunHash}, found ${actualHash}`);
      const journal = this.journal.bound({ projectId: current.projectId, runId: current.runId });
      const journalHead = await journal.head();
      if (input.expectedJournalHead !== undefined && input.expectedJournalHead !== journalHead) {
        throw new Error(
          `Stale journal head: expected ${String(input.expectedJournalHead)}, found ${String(journalHead)}`,
        );
      }

      const next = input.update(structuredClone(current));
      if (next.projectId !== current.projectId || next.runId !== current.runId)
        throw new Error("Run identity cannot change");
      const afterHash = sha256Json(next as unknown as JsonValue);
      const intent: TransactionIntent = {
        version: 1,
        eventId: input.event.eventId,
        beforeHash: actualHash,
        afterHash,
        after: next,
      };
      await atomicWriteJson(this.intentPath, intent, { refuseOverwrite: true });
      await this.faultInjector?.("intent");
      const event = await journal.append({
        ...input.event,
        expectedHead: journalHead,
        payload: {
          ...(input.event.payload as Record<string, JsonValue>),
          transaction: { afterHash, after: next as unknown as JsonValue },
        },
      });
      await this.faultInjector?.("journal");
      await atomicWriteJson(this.runPath, next);
      await this.faultInjector?.("run");
      await rm(this.intentPath, { force: true });
      await this.faultInjector?.("cleanup");
      return { run: next, runHash: afterHash, eventHash: event.hash };
    });
  }

  async acquireWriterLease(owner: RunWriterLeaseOwner): Promise<RunWriterLease> {
    const workspacePath = resolve(owner.workspacePath);
    const conflictFromPublishedLease = async () => {
      const existing = await this.readWriterLease();
      if (
        existing !== undefined &&
        existing.expiresAt > this.clock().getTime() &&
        !sameWorkspace(existing.metadata.workspacePath, workspacePath)
      ) {
        return new RunWriterConflictError(existing.metadata.workspacePath, existing.metadata.expiresAt);
      }
      return undefined;
    };
    try {
      return await this.withLock(
        async () => {
          const now = this.clock();
          const existing = await this.readWriterLease();
          if (
            existing !== undefined &&
            existing.expiresAt > now.getTime() &&
            !sameWorkspace(existing.metadata.workspacePath, workspacePath)
          ) {
            throw new RunWriterConflictError(existing.metadata.workspacePath, existing.metadata.expiresAt);
          }
          const lease: RunWriterLease = {
            version: 1,
            workspacePath,
            host: hostname(),
            pid: process.pid,
            sessionId: owner.sessionId ?? this.idSource(),
            createdAt:
              existing !== undefined && sameWorkspace(existing.metadata.workspacePath, workspacePath)
                ? existing.metadata.createdAt
                : now.toISOString(),
            expiresAt: new Date(now.getTime() + this.writerLeaseTtlMs).toISOString(),
          };
          await atomicWriteJson(this.writerLeasePath, lease);
          return lease;
        },
        { onContention: conflictFromPublishedLease, waitMs: this.writerLeaseLockWaitMs },
      );
    } catch (error) {
      if (error instanceof RunWriterConflictError || !this.contended(error)) throw error;
      // A busy lock or a Windows sharing violation is a contended outcome, not a verdict. Report it as a writer
      // conflict only when another worktree verifiably holds an unexpired lease; otherwise surface the original error.
      let conflict: RunWriterConflictError | undefined;
      try {
        conflict = await conflictFromPublishedLease();
      } catch {
        throw error;
      }
      if (conflict === undefined) throw error;
      throw new RunWriterConflictError(conflict.ownerWorktree, conflict.expiresAt, { cause: error });
    }
  }

  private contended(error: unknown): boolean {
    return (
      error instanceof RunMutationBusyError ||
      (this.platform === "win32" && TRANSIENT_LOCK_RENAME_CODES.has((error as NodeJS.ErrnoException).code ?? ""))
    );
  }

  /**
   * Reads the run state that decides whether a repeated call may be answered from its original result: the run hash,
   * the journal head and the writer lease holder's canonical worktree (expiry excluded). Pending transactions are
   * recovered first, so the snapshot reflects committed state.
   */
  async repeatState(): Promise<RunRepeatState> {
    return this.withLock(
      async () => {
        await this.recover();
        const run = await this.readRaw();
        const lease = await this.readWriterLease();
        return {
          runHash: sha256Json(run as unknown as JsonValue),
          journalHead: await this.journal.head(),
          ownerEpoch: run.ownerEpoch,
          writer: lease === undefined ? null : canonicalWorktreePath(lease.metadata.workspacePath),
        };
      },
      // Concurrent guarded calls read this state at once; wait out a short mutation instead of failing on contention.
      { waitMs: this.writerLeaseLockWaitMs },
    );
  }

  /** Rejects with the writer conflict when another worktree holds a live lease; never writes the lease. */
  async assertWriterAvailable(owner: RunWriterLeaseOwner): Promise<void> {
    const existing = await this.readWriterLease();
    if (
      existing !== undefined &&
      existing.expiresAt > this.clock().getTime() &&
      !sameWorkspace(existing.metadata.workspacePath, resolve(owner.workspacePath))
    ) {
      throw new RunWriterConflictError(existing.metadata.workspacePath, existing.metadata.expiresAt);
    }
  }

  async releaseWriterLease(owner: RunWriterLeaseOwner): Promise<boolean> {
    const workspacePath = resolve(owner.workspacePath);
    return this.withLock(async () => {
      const existing = await this.readWriterLease();
      if (existing === undefined) return false;
      if (
        existing.expiresAt > this.clock().getTime() &&
        !sameWorkspace(existing.metadata.workspacePath, workspacePath)
      ) {
        throw new RunWriterConflictError(existing.metadata.workspacePath, existing.metadata.expiresAt);
      }
      await rm(this.writerLeasePath, { force: true });
      return true;
    });
  }

  private async recover(): Promise<void> {
    let intent: TransactionIntent;
    try {
      intent = JSON.parse(await readFile(this.intentPath, "utf8")) as TransactionIntent;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const committed = (await this.journal.replay()).find((event) => event.eventId === intent.eventId);
    if (committed === undefined) {
      await rm(this.intentPath, { force: true });
      return;
    }
    const transaction = (committed.payload as { transaction?: { afterHash?: unknown; after?: unknown } }).transaction;
    if (
      transaction?.afterHash !== intent.afterHash ||
      sha256Json(transaction.after as JsonValue) !== intent.afterHash
    ) {
      throw new Error("Committed run transaction does not match its intent");
    }
    await atomicWriteJson(this.runPath, transaction.after);
    await rm(this.intentPath, { force: true });
  }

  private async readRaw(): Promise<RunConfigV1> {
    return parseRunConfig(await readFile(this.runPath, "utf8"));
  }

  private async readWriterLease(): Promise<RunWriterLeaseSnapshot | undefined> {
    const bytes = await readPublishedFile(this.writerLeasePath, {
      maxBytes: MAX_WRITER_LEASE_BYTES,
      label: "Run writer lease metadata",
      platform: this.platform,
    });
    if (bytes === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch (error) {
      throw new Error("Run writer lease metadata is unreadable", { cause: error });
    }
    const expiresAt = writerLeaseExpiry(parsed);
    if (expiresAt === undefined) throw new Error("Run writer lease metadata is unreadable");
    return { metadata: parsed as RunWriterLease, expiresAt };
  }

  private async withLock<T>(
    operation: () => Promise<T>,
    options: { onContention?: () => Promise<Error | undefined>; waitMs?: number } = {},
  ): Promise<T> {
    return this.mutationLock.run(operation, options);
  }
}
