import type { RunConfigV1 } from "@apexops/contracts";
import { constants, realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonicalJsonBytes, sha256Bytes, sha256Json, type JsonValue } from "./canonical.js";
import { EventJournal, type AppendEventInput } from "./event-journal.js";
import { atomicWriteJson, readPublishedFile, renameWithRetry } from "./files.js";

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
  faultInjector?: (stage: RunTransactionStage) => void | Promise<void>;
}

interface TransactionIntent {
  version: 1;
  eventId: string;
  beforeHash: string;
  afterHash: string;
  after: RunConfigV1;
}

interface MutationLock {
  token: string;
  pid: number;
  host: string;
  createdAt: string;
  expiresAt: string;
}

interface MutationLockSnapshot {
  metadata: MutationLock;
  expiresAt: number;
  recoveryId: string;
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
  ) {
    super(`Run writer lease is held by ${ownerWorktree} until ${expiresAt}`);
    this.name = "RunWriterConflictError";
  }
}

const LOCK_METADATA_FILE = "metadata.json";
const MAX_LOCK_METADATA_BYTES = 64 * 1024;
const WRITER_LEASE_FILE = ".run-writer-lease.json";
const MAX_WRITER_LEASE_BYTES = 64 * 1024;
// Same-workspace renewals cannot fail fast with a conflict, so they queue on the run mutation lock. The budget must
// cover a serialized queue of lock cycles on slow file systems (Windows cycles are an order of magnitude slower).
const WRITER_LEASE_LOCK_WAIT_MS = 10_000;
const WRITER_LEASE_LOCK_RETRY_MS = 10;
const TRANSIENT_LOCK_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function lockExpiry(value: unknown): number | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const lock = value as Partial<MutationLock>;
  const createdAt = Date.parse(lock.createdAt ?? "");
  const expiresAt = Date.parse(lock.expiresAt ?? "");
  return typeof lock.token === "string" &&
    lock.token.length > 0 &&
    Number.isInteger(lock.pid) &&
    Number(lock.pid) > 0 &&
    typeof lock.host === "string" &&
    lock.host.length > 0 &&
    Number.isFinite(createdAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt >= createdAt
    ? expiresAt
    : undefined;
}

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

function sameWorkspace(left: string, right: string): boolean {
  const canonical = (path: string) => {
    const resolved = resolve(path);
    try {
      return realpathSync(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolved;
      throw error;
    }
  };
  const resolvedLeft = canonical(left);
  const resolvedRight = canonical(right);
  return process.platform === "win32"
    ? resolvedLeft.toLocaleLowerCase() === resolvedRight.toLocaleLowerCase()
    : resolvedLeft === resolvedRight;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((done) => setTimeout(done, milliseconds));
}

export class RunRepository {
  private readonly runPath: string;
  private readonly lockPath: string;
  private readonly retiredLockPath: string;
  private readonly intentPath: string;
  private readonly writerLeasePath: string;
  private readonly clock: () => Date;
  private readonly idSource: () => string;
  private readonly lockTtlMs: number;
  private readonly writerLeaseTtlMs: number;
  private readonly faultInjector?: RunRepositoryOptions["faultInjector"];
  readonly journal: EventJournal;

  constructor(runDirectory: string, options: RunRepositoryOptions = {}) {
    const directory = resolve(runDirectory);
    this.runPath = join(directory, "run.json");
    this.lockPath = join(directory, ".run-mutation.lock");
    this.retiredLockPath = join(directory, ".run-mutation.retired");
    this.intentPath = join(directory, ".run-transaction.json");
    this.writerLeasePath = join(directory, WRITER_LEASE_FILE);
    this.clock = options.clock ?? (() => new Date());
    this.idSource = options.idSource ?? (() => crypto.randomUUID());
    this.lockTtlMs = options.lockTtlMs ?? 30_000;
    this.writerLeaseTtlMs = options.writerLeaseTtlMs ?? 120_000;
    this.faultInjector = options.faultInjector;
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
      const journalHead = await this.journal.head();
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
      const event = await this.journal.append({
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
    return this.withLock(
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
      { onContention: conflictFromPublishedLease, waitMs: WRITER_LEASE_LOCK_WAIT_MS },
    );
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
    return JSON.parse(await readFile(this.runPath, "utf8")) as RunConfigV1;
  }

  private async readWriterLease(): Promise<RunWriterLeaseSnapshot | undefined> {
    const bytes = await readPublishedFile(this.writerLeasePath, {
      maxBytes: MAX_WRITER_LEASE_BYTES,
      label: "Run writer lease metadata",
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
    await mkdir(dirname(this.lockPath), { recursive: true });
    const token = this.idSource();
    const createdAt = this.clock();
    const metadata: MutationLock = {
      token,
      pid: process.pid,
      host: hostname(),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.lockTtlMs).toISOString(),
    };
    for (;;) {
      if (await this.acquireLock(metadata)) break;
      const existing = await this.readLock();
      if (existing === undefined) continue;
      if (existing.expiresAt > this.clock().getTime() || this.ownerMayBeAlive(existing.metadata)) {
        const deadline = Date.now() + (options.waitMs ?? 0);
        for (;;) {
          const contention = await options.onContention?.();
          if (contention !== undefined) throw contention;
          if (Date.now() >= deadline) break;
          await sleep(WRITER_LEASE_LOCK_RETRY_MS);
          if (await this.acquireLock(metadata)) break;
          const current = await this.readLock();
          if (current === undefined) continue;
          if (current.expiresAt <= this.clock().getTime() && !this.ownerMayBeAlive(current.metadata)) {
            if (await this.retireLock(current.recoveryId)) continue;
          }
        }
        if (await this.readLock().then((current) => current?.metadata.token === token)) break;
        throw new Error("Run mutation is already in progress");
      }
      if (!(await this.retireLock(existing.recoveryId))) throw new Error("Run mutation is already in progress");
    }
    try {
      return await operation();
    } finally {
      try {
        const current = await this.readLock();
        if (current?.metadata.token === token) await this.retireLock(current.recoveryId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async acquireLock(metadata: MutationLock): Promise<boolean> {
    const parent = dirname(this.lockPath);
    await mkdir(parent, { recursive: true });
    if (await this.lockPublished()) return false;
    const staging = await mkdtemp(join(parent, ".run-mutation.pending-"));
    let published = false;
    try {
      const handle = await open(
        join(staging, LOCK_METADATA_FILE),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      try {
        await handle.writeFile(canonicalJsonBytes(metadata));
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (await this.lockPublished()) return false;
      try {
        await renameWithRetry(staging, this.lockPath);
        published = true;
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (["EEXIST", "ENOTEMPTY"].includes(code) || TRANSIENT_LOCK_RENAME_CODES.has(code)) return false;
        try {
          await lstat(this.lockPath);
          return false;
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === "ENOENT") throw error;
          throw lockError;
        }
      }
    } finally {
      if (!published) await rm(staging, { recursive: true, force: true });
    }
  }

  /** Cheap pre-check so contended waiters do not stage and fsync lock metadata on every poll. */
  private async lockPublished(): Promise<boolean> {
    try {
      await lstat(this.lockPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async readLock(): Promise<MutationLockSnapshot | undefined> {
    let directoryStat;
    try {
      directoryStat = await lstat(this.lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error("Run mutation lock metadata is unsafe");
    }
    const metadataPath = join(this.lockPath, LOCK_METADATA_FILE);
    let metadataStat;
    try {
      metadataStat = await lstat(metadataPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        let currentDirectory;
        try {
          currentDirectory = await lstat(this.lockPath);
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw lockError;
        }
        if (currentDirectory.dev !== directoryStat.dev || currentDirectory.ino !== directoryStat.ino) return undefined;
        throw new Error("Run mutation lock metadata is unreadable", { cause: error });
      }
      throw error;
    }
    if (!metadataStat.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > MAX_LOCK_METADATA_BYTES) {
      throw new Error("Run mutation lock metadata is unsafe");
    }
    let handle;
    try {
      handle = await open(metadataPath, constants.O_RDONLY);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let bytes: Buffer;
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== metadataStat.dev ||
        opened.ino !== metadataStat.ino ||
        opened.size > MAX_LOCK_METADATA_BYTES
      ) {
        return undefined;
      }
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    const [after, metadataAfter] = await Promise.all([
      lstat(this.lockPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }),
      lstat(metadataPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }),
    ]);
    if (
      after === undefined ||
      metadataAfter === undefined ||
      after.dev !== directoryStat.dev ||
      after.ino !== directoryStat.ino ||
      metadataAfter.isSymbolicLink() ||
      metadataAfter.dev !== metadataStat.dev ||
      metadataAfter.ino !== metadataStat.ino ||
      bytes.byteLength > MAX_LOCK_METADATA_BYTES
    ) {
      return undefined;
    }
    let metadata: unknown;
    try {
      metadata = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch (error) {
      throw new Error("Run mutation lock metadata is unreadable", { cause: error });
    }
    const expiresAt = lockExpiry(metadata);
    if (expiresAt === undefined) throw new Error("Run mutation lock metadata is unreadable");
    return {
      metadata: metadata as MutationLock,
      expiresAt,
      recoveryId: sha256Json({
        metadataHash: sha256Bytes(bytes),
        device: String(directoryStat.dev),
        inode: String(directoryStat.ino),
        changedAt: directoryStat.ctimeMs,
      }),
    };
  }

  private ownerMayBeAlive(metadata: MutationLock): boolean {
    if (metadata.host !== hostname()) return true;
    try {
      process.kill(metadata.pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }

  private async retireLock(recoveryId: string): Promise<boolean> {
    await mkdir(this.retiredLockPath, { recursive: true, mode: 0o700 });
    const retiredRoot = await lstat(this.retiredLockPath);
    if (!retiredRoot.isDirectory() || retiredRoot.isSymbolicLink()) {
      throw new Error("Run mutation retired-lock directory is unsafe");
    }
    try {
      await renameWithRetry(this.lockPath, join(this.retiredLockPath, recoveryId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      if (["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
      throw error;
    }
  }
}
