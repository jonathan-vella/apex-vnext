import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { canonicalJsonBytes, sha256Bytes, sha256Json } from "./canonical.js";
import { renameWithRetry } from "./files.js";

const LOCK_METADATA_FILE = "metadata.json";
const MAX_LOCK_METADATA_BYTES = 64 * 1024;
const LOCK_RETRY_MS = 10;
const TRANSIENT_LOCK_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
// Released generations are parked under the retired-lock root with this prefix and deleted; every other entry there
// is a permanent takeover tombstone named by its recovery id.
const RELEASED_LOCK_PREFIX = "released-";
const RELEASED_LOCK_REMOVE_ATTEMPTS = 5;
const TRANSIENT_LOCK_REMOVE_CODES = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);
// Marker inside a held generation that opens it to snapshot readers; see `DirectoryLockHold.share`.
const SHARE_MARKER_FILE = "shared.json";
const MAX_SHARE_MARKER_BYTES = 4 * 1024;
// Holds whose share window the current async context runs inside, so a nested share joins it instead of waiting for it.
const enclosingShares = new AsyncLocalStorage<ReadonlySet<object>>();
const SHARE_MARKER_REMOVE_ATTEMPTS = 8;

interface LockMetadata {
  token: string;
  pid: number;
  host: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * A share window could not be closed, so snapshot readers may still trust it. The hold refuses to share again; its
 * holder must write nothing more before it releases the lock, which takes the window with it.
 */
export class DirectoryLockShareCloseError extends Error {
  constructor(label: string, cause: unknown) {
    super(`${label} share window could not be closed`, { cause });
    this.name = "DirectoryLockShareCloseError";
  }
}

interface ShareWindow {
  members: number;
  opened: Promise<void>;
  closed: Promise<void>;
  settle(error?: Error): void;
}

/** One acquisition of a {@link DirectoryLock}. */
export interface DirectoryLockHold {
  /** Gives the lock up. Idempotent. */
  release(): Promise<void>;
  /**
   * Runs `operation` with this generation open to {@link DirectoryLock.readShared} snapshot readers, for example while
   * the holder waits for an external process. The lock stays held, so other holders still wait. The holder must not
   * write the state the lock protects until `operation` settles: the window closes before `share` returns, and closing
   * it is what invalidates a snapshot read that overlapped it. Concurrent calls run their operations in one window,
   * which closes when the last of them settles, and none returns before it closed. A call made inside a shared
   * operation runs in the enclosing window and returns into that operation, which must still not write. When the
   * window cannot be closed `share` throws {@link DirectoryLockShareCloseError},
   * then and on every later call; the holder must then stop writing until it releases the lock.
   */
  share<T>(operation: () => Promise<T>): Promise<T>;
}

interface LockSnapshot {
  metadata: LockMetadata;
  expiresAt: number;
  recoveryId: string;
}

export interface DirectoryLockOptions {
  /** Prefix of metadata error messages, for example "Run mutation lock". */
  label: string;
  clock: () => Date;
  idSource: () => string;
  /** A generation is only taken over once it has expired and its local owner process is gone. */
  ttlMs: number;
  /** Selects Windows transient file-sharing handling. */
  platform: NodeJS.Platform;
  busyError: () => Error;
}

function lockExpiry(value: unknown): number | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const lock = value as Partial<LockMetadata>;
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

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((done) => setTimeout(done, milliseconds));
}

/**
 * Cross-process exclusive lock published as a directory `<name>.lock` holding owner metadata. A generation is staged
 * in `<name>.pending-*` and published by rename, so the lock path never holds partial metadata. A live owner is waited
 * for; an expired generation whose local owner process is gone is taken over into a permanent tombstone under
 * `<name>.retired/`, which makes takeover compare-and-swap; released generations are parked there and deleted.
 */
export class DirectoryLock {
  private readonly lockPath: string;
  private readonly retiredLockPath: string;
  private readonly stagingPrefix: string;
  private readonly label: string;
  private readonly clock: () => Date;
  private readonly idSource: () => string;
  private readonly ttlMs: number;
  private readonly platform: NodeJS.Platform;
  private readonly busyError: () => Error;

  constructor(lockPath: string, options: DirectoryLockOptions) {
    if (!lockPath.endsWith(".lock")) throw new TypeError("Directory lock path must end with .lock");
    const stem = basename(lockPath).slice(0, -".lock".length);
    this.lockPath = lockPath;
    this.retiredLockPath = join(dirname(lockPath), `${stem}.retired`);
    this.stagingPrefix = `${stem}.pending-`;
    this.label = options.label;
    this.clock = options.clock;
    this.idSource = options.idSource;
    this.ttlMs = options.ttlMs;
    this.platform = options.platform;
    this.busyError = options.busyError;
  }

  /** Runs `operation` while holding the lock; throws the configured busy error when it cannot be acquired in time. */
  async run<T>(
    operation: () => Promise<T>,
    options: { onContention?: () => Promise<Error | undefined>; waitMs?: number } = {},
  ): Promise<T> {
    const held = await this.acquire(options);
    try {
      return await operation();
    } finally {
      await held.release();
    }
  }

  /**
   * Acquires the lock and returns its release, for holders that give the lock up and take it again while they run.
   * Throws the configured busy error when it cannot be acquired in time. Release is idempotent.
   */
  async acquire(
    options: { onContention?: () => Promise<Error | undefined>; waitMs?: number } = {},
  ): Promise<DirectoryLockHold> {
    await mkdir(dirname(this.lockPath), { recursive: true });
    const token = this.idSource();
    const createdAt = this.clock();
    const metadata: LockMetadata = {
      token,
      pid: process.pid,
      host: hostname(),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
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
          await sleep(LOCK_RETRY_MS);
          if (await this.acquireLock(metadata)) break;
          const current = await this.readLock();
          if (current === undefined) continue;
          if (current.expiresAt <= this.clock().getTime() && !this.ownerMayBeAlive(current.metadata)) {
            if (await this.retireStaleLock(current)) continue;
          }
        }
        if (await this.readLock().then((current) => current?.metadata.token === token)) break;
        throw this.busyError();
      }
      if (!(await this.retireStaleLock(existing))) throw this.busyError();
    }
    let released = false;
    let unclosed: DirectoryLockShareCloseError | undefined;
    const key = {};
    // The open (or opening) window that concurrent calls join, and the close of the previous one, which a new window
    // waits for so it never publishes its marker before the old one is removed.
    let window: ShareWindow | undefined;
    let closing: Promise<void> = Promise.resolve();
    return {
      share: async <T>(operation: () => Promise<T>): Promise<T> => {
        if (unclosed !== undefined) throw unclosed;
        if (released) throw new Error(`${this.label} is no longer held`);
        const enclosing = enclosingShares.getStore();
        if (enclosing?.has(key) === true) return operation();
        if (window === undefined) {
          let resolveClosed!: () => void;
          let rejectClosed!: (error: Error) => void;
          const closed = new Promise<void>((resolve, reject) => {
            resolveClosed = resolve;
            rejectClosed = reject;
          });
          const previous = closing;
          closing = closed.catch(() => undefined);
          window = {
            members: 0,
            opened: previous.then(() => {
              if (unclosed !== undefined) throw unclosed;
              return this.openShare(token);
            }),
            closed,
            settle: (error) => (error === undefined ? resolveClosed() : rejectClosed(error)),
          };
        }
        const current = window;
        current.members += 1;
        let outcome: { value: T } | { error: unknown };
        try {
          await current.opened;
          const members = new Set(enclosing ?? []).add(key);
          outcome = { value: await enclosingShares.run(members, operation) };
        } catch (error) {
          outcome = { error };
        }
        current.members -= 1;
        if (current.members === 0) {
          if (window === current) window = undefined;
          try {
            // A released generation took its marker with it; the lock path may now hold another generation.
            if (!released) await this.closeShare();
            current.settle();
          } catch (error) {
            unclosed = new DirectoryLockShareCloseError(this.label, error);
            current.settle(unclosed);
          }
        }
        // No member returns while the window may still be open; a close failure replaces every member's outcome, so
        // the holder never continues as if the window had closed.
        await current.closed;
        if ("error" in outcome) throw outcome.error;
        return outcome.value;
      },
      release: async () => {
        if (released) return;
        released = true;
        try {
          const current = await this.readLock();
          if (current?.metadata.token === token) await this.releaseLock();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await this.sweepReleasedLocks();
      },
    };
  }

  /**
   * Runs `read` without the lock while a holder shares its generation (see {@link DirectoryLockHold.share}) and returns
   * its outcome only when the same window was still open after `read` settled, so the holder wrote nothing meanwhile.
   * Returns undefined, discarding the outcome, when no window was open or it closed during the read; the caller then
   * retries or waits for the lock. `read` must not write the state the lock protects.
   */
  async readShared<T>(read: () => Promise<T>): Promise<{ value: T } | undefined> {
    const before = await this.shareWindow();
    if (before === undefined) return undefined;
    let outcome: { value: T } | { error: unknown };
    try {
      outcome = { value: await read() };
    } catch (error) {
      outcome = { error };
    }
    if ((await this.shareWindow()) !== before) return undefined;
    if ("error" in outcome) throw outcome.error;
    return outcome;
  }

  private async openShare(token: string): Promise<void> {
    const current = await this.readLock();
    if (current?.metadata.token !== token) throw new Error(`${this.label} is no longer held`);
    const staging = join(this.lockPath, `${SHARE_MARKER_FILE}.${crypto.randomUUID()}.pending`);
    try {
      const handle = await open(staging, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try {
        await handle.writeFile(canonicalJsonBytes({ token, window: crypto.randomUUID() }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Published by rename, so a reader never parses a partial marker.
      await renameWithRetry(staging, join(this.lockPath, SHARE_MARKER_FILE));
    } finally {
      await rm(staging, { force: true });
    }
  }

  private async closeShare(): Promise<void> {
    const attempts = this.platform === "win32" ? SHARE_MARKER_REMOVE_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rm(join(this.lockPath, SHARE_MARKER_FILE), { force: true });
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (attempt >= attempts || !TRANSIENT_LOCK_REMOVE_CODES.has(code)) throw error;
        await sleep(10 * 2 ** (attempt - 1));
      }
    }
  }

  /**
   * Identity of the open share window: the holding generation's token and the window id, or undefined when there is no
   * readable window. Any failure to read it counts as no window, so a reader falls back to the lock.
   */
  private async shareWindow(): Promise<string | undefined> {
    try {
      const lock = await this.readLock();
      if (lock === undefined) return undefined;
      const markerPath = join(this.lockPath, SHARE_MARKER_FILE);
      const marker = await lstat(markerPath);
      if (!marker.isFile() || marker.size > MAX_SHARE_MARKER_BYTES) return undefined;
      // Read through one handle that is still the file checked above, so a replacement cannot redirect or enlarge it.
      const handle = await open(markerPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes: Buffer;
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.dev !== marker.dev ||
          opened.ino !== marker.ino ||
          opened.size > MAX_SHARE_MARKER_BYTES
        )
          return undefined;
        const buffer = Buffer.alloc(MAX_SHARE_MARKER_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_SHARE_MARKER_BYTES) return undefined;
        bytes = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      const value = JSON.parse(bytes.toString("utf8")) as { token?: unknown; window?: unknown } | null;
      // The token binds the marker to the generation read above; a later generation carries a different token.
      if (value?.token !== lock.metadata.token || typeof value.window !== "string" || value.window.length === 0)
        return undefined;
      return `${lock.metadata.token}\n${value.window}`;
    } catch {
      return undefined;
    }
  }

  private async acquireLock(metadata: LockMetadata): Promise<boolean> {
    const parent = dirname(this.lockPath);
    await mkdir(parent, { recursive: true });
    if (await this.lockPublished()) return false;
    const staging = await mkdtemp(join(parent, this.stagingPrefix));
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

  private async readLock(): Promise<LockSnapshot | undefined> {
    let directoryStat;
    try {
      directoryStat = await lstat(this.lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error(`${this.label} metadata is unsafe`);
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
        throw new Error(`${this.label} metadata is unreadable`, { cause: error });
      }
      throw error;
    }
    if (!metadataStat.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > MAX_LOCK_METADATA_BYTES) {
      throw new Error(`${this.label} metadata is unsafe`);
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
      throw new Error(`${this.label} metadata is unreadable`, { cause: error });
    }
    const expiresAt = lockExpiry(metadata);
    if (expiresAt === undefined) throw new Error(`${this.label} metadata is unreadable`);
    return {
      metadata: metadata as LockMetadata,
      expiresAt,
      recoveryId: sha256Json({
        metadataHash: sha256Bytes(bytes),
        device: String(directoryStat.dev),
        inode: String(directoryStat.ino),
        changedAt: directoryStat.ctimeMs,
      }),
    };
  }

  private ownerMayBeAlive(metadata: LockMetadata): boolean {
    if (metadata.host !== hostname()) return true;
    try {
      process.kill(metadata.pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }

  /**
   * Take over an expired generation whose local owner was confirmed dead after `snapshot` was read. Re-reading the lock
   * after that liveness check is what lets released generations skip tombstones: a generation still present after its
   * owner died can no longer be released by that owner, so it can only leave the lock path through another takeover,
   * which leaves the permanent tombstone that makes this rename fail instead of retiring a replacement generation.
   */
  private async retireStaleLock(snapshot: LockSnapshot): Promise<boolean> {
    const confirmed = await this.readLock();
    if (confirmed?.recoveryId !== snapshot.recoveryId) return false;
    return this.retireLock(snapshot.recoveryId);
  }

  /**
   * Retire a taken-over generation into a permanent tombstone named by its recovery id. Rename is not compare-and-swap,
   * so the tombstone is the guard: a delayed contender that confirmed the same generation renames onto the existing
   * non-empty tombstone and fails rather than moving a replacement lock. Tombstones are therefore never swept; they
   * accumulate only once per crashed lock owner, not per mutation.
   */
  private async retireLock(recoveryId: string): Promise<boolean> {
    await this.ensureRetiredRoot();
    try {
      await renameWithRetry(this.lockPath, join(this.retiredLockPath, recoveryId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      if (["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
      throw error;
    }
  }

  /**
   * Release a generation this process owns. While the owner is alive no contender can take its generation over (see
   * `retireStaleLock`), so the rename moves exactly this generation and needs no tombstone: it is parked under a fresh
   * unique name and deleted by `sweepReleasedLocks`.
   */
  private async releaseLock(): Promise<void> {
    await this.ensureRetiredRoot();
    await renameWithRetry(this.lockPath, join(this.retiredLockPath, `${RELEASED_LOCK_PREFIX}${crypto.randomUUID()}`));
  }

  private async ensureRetiredRoot(): Promise<void> {
    await mkdir(this.retiredLockPath, { recursive: true, mode: 0o700 });
    const retiredRoot = await lstat(this.retiredLockPath);
    if (!retiredRoot.isDirectory() || retiredRoot.isSymbolicLink()) {
      throw new Error(`${this.label} retired directory is unsafe`);
    }
  }

  /**
   * Best-effort deletion of every released generation, including ones left by earlier cleanup failures or crashes
   * between release and deletion. Any process may delete any released entry at any time: each has a unique name that
   * only its releasing owner ever renames to, and nothing reads, renames, or locks through it afterwards. Takeover
   * tombstones, the live lock, and other processes' `.pending-` staging directories are never touched. Failures never
   * fail the caller; Windows sharing violations (for example a contender's metadata handle still open) are retried
   * briefly and otherwise left for the next sweep.
   */
  private async sweepReleasedLocks(): Promise<void> {
    let entries;
    try {
      const retiredRoot = await lstat(this.retiredLockPath);
      if (!retiredRoot.isDirectory() || retiredRoot.isSymbolicLink()) return;
      entries = await readdir(this.retiredLockPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(RELEASED_LOCK_PREFIX)) {
        await this.removeReleasedLock(join(this.retiredLockPath, entry.name));
      }
    }
  }

  private async removeReleasedLock(path: string): Promise<void> {
    const attempts = this.platform === "win32" ? RELEASED_LOCK_REMOVE_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rm(path, { recursive: true, force: true });
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (attempt >= attempts || !TRANSIENT_LOCK_REMOVE_CODES.has(code)) return;
        await sleep(10 * 2 ** (attempt - 1));
      }
    }
  }
}
