import type { RunConfigV1 } from "@apexops/contracts";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonicalJsonBytes, sha256Bytes, sha256Json, type JsonValue } from "./canonical.js";
import { EventJournal, type AppendEventInput } from "./event-journal.js";
import { atomicWriteJson } from "./files.js";

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

const LOCK_METADATA_FILE = "metadata.json";
const MAX_LOCK_METADATA_BYTES = 64 * 1024;

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

export class RunRepository {
  private readonly runPath: string;
  private readonly lockPath: string;
  private readonly staleLockPath: string;
  private readonly intentPath: string;
  private readonly clock: () => Date;
  private readonly idSource: () => string;
  private readonly lockTtlMs: number;
  private readonly faultInjector?: RunRepositoryOptions["faultInjector"];
  readonly journal: EventJournal;

  constructor(runDirectory: string, options: RunRepositoryOptions = {}) {
    const directory = resolve(runDirectory);
    this.runPath = join(directory, "run.json");
    this.lockPath = join(directory, ".run-mutation.lock");
    this.staleLockPath = join(directory, ".run-mutation.stale");
    this.intentPath = join(directory, ".run-transaction.json");
    this.clock = options.clock ?? (() => new Date());
    this.idSource = options.idSource ?? (() => crypto.randomUUID());
    this.lockTtlMs = options.lockTtlMs ?? 30_000;
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

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
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
      if (existing.expiresAt > this.clock().getTime()) throw new Error("Run mutation is already in progress");
      if (!(await this.reclaimLock(existing.recoveryId))) throw new Error("Run mutation is already in progress");
    }
    try {
      return await operation();
    } finally {
      try {
        const current = await this.readLock();
        if (current?.metadata.token === token) await rm(this.lockPath, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async acquireLock(metadata: MutationLock): Promise<boolean> {
    const parent = dirname(this.lockPath);
    await mkdir(parent, { recursive: true });
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
      try {
        await lstat(this.lockPath);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await rename(staging, this.lockPath);
        published = true;
        return true;
      } catch (error) {
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

  private async reclaimLock(recoveryId: string): Promise<boolean> {
    await mkdir(this.staleLockPath, { recursive: true, mode: 0o700 });
    const staleRoot = await lstat(this.staleLockPath);
    if (!staleRoot.isDirectory() || staleRoot.isSymbolicLink()) {
      throw new Error("Run mutation stale-lock directory is unsafe");
    }
    try {
      await rename(this.lockPath, join(this.staleLockPath, recoveryId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      try {
        await lstat(join(this.staleLockPath, recoveryId));
        return false;
      } catch (staleError) {
        if ((staleError as NodeJS.ErrnoException).code === "ENOENT") throw error;
        throw staleError;
      }
    }
  }
}
