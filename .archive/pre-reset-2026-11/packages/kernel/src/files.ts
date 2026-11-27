import { AsyncLocalStorage } from "node:async_hooks";
import { constants, type Stats } from "node:fs";
import { link, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { canonicalJsonBytes } from "./canonical.js";

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export interface RenameRetryOptions {
  readonly platform?: NodeJS.Platform;
  readonly attempts?: number;
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Rename with bounded retries on Windows, where antivirus, indexers and editor watchers briefly hold files open and
 * make an atomic replace fail with EPERM, EACCES or EBUSY. Other platforms and other errors fail on the first attempt.
 */
export async function renameWithRetry(from: string, to: string, options: RenameRetryOptions = {}): Promise<void> {
  if (
    options.attempts !== undefined &&
    (!Number.isSafeInteger(options.attempts) || options.attempts < 1 || options.attempts > 10)
  )
    throw new RangeError("Rename attempts must be an integer from 1 to 10");
  const move = options.rename ?? rename;
  await retrySharingViolations(() => move(from, to), options);
}

export interface SharingRetryOptions {
  readonly platform?: NodeJS.Platform;
  readonly attempts?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Runs a file operation with the bounded backoff of `renameWithRetry`, retrying the Windows sharing violations (EPERM,
 * EACCES, EBUSY) that a concurrent writer, antivirus or indexer causes. Other platforms and other errors fail on the
 * first attempt.
 */
export async function retrySharingViolations<T>(
  operation: () => Promise<T>,
  options: SharingRetryOptions = {},
): Promise<T> {
  if (
    options.attempts !== undefined &&
    (!Number.isSafeInteger(options.attempts) || options.attempts < 1 || options.attempts > 10)
  )
    throw new RangeError("Retry attempts must be an integer from 1 to 10");
  const attempts = (options.platform ?? process.platform) === "win32" ? (options.attempts ?? 10) : 1;
  const sleep =
    options.sleep ?? (async (milliseconds: number) => await new Promise((done) => setTimeout(done, milliseconds)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !TRANSIENT_RENAME_CODES.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await sleep(Math.min(10 * 2 ** (attempt - 1), 500));
    }
  }
}

export interface PublishedFileReadOptions {
  readonly maxBytes: number;
  /** Prefix of the error thrown when the path is not a regular file within `maxBytes`. */
  readonly label: string;
  readonly platform?: NodeJS.Platform;
  readonly attempts?: number;
  readonly lstat?: (path: string) => Promise<Pick<Stats, "isFile" | "isSymbolicLink" | "size">>;
  readonly readFile?: (path: string) => Promise<Buffer>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Read a small regular file that writers publish with an atomic replace (see `atomicWriteBytes`). Returns undefined
 * only when lstat reports the path as absent. A file that vanishes between lstat and read was replaced or removed
 * mid-read and is re-examined; on Windows, sharing violations (EPERM, EACCES, EBUSY) raised while a writer replaces
 * the file are retried with the same bounded backoff as `renameWithRetry`. Exhausted retries rethrow, so a transient
 * failure is never reported as an absent file.
 */
export async function readPublishedFile(path: string, options: PublishedFileReadOptions): Promise<Buffer | undefined> {
  if (
    options.attempts !== undefined &&
    (!Number.isSafeInteger(options.attempts) || options.attempts < 1 || options.attempts > 10)
  )
    throw new RangeError("Read attempts must be an integer from 1 to 10");
  const windows = (options.platform ?? process.platform) === "win32";
  const attempts = options.attempts ?? 10;
  const inspect = options.lstat ?? lstat;
  const read = options.readFile ?? readFile;
  const sleep =
    options.sleep ?? (async (milliseconds: number) => await new Promise((done) => setTimeout(done, milliseconds)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      let stat;
      try {
        stat = await inspect(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > options.maxBytes) {
        throw new Error(`${options.label} is unsafe`);
      }
      const bytes = await read(path);
      if (bytes.byteLength > options.maxBytes) throw new Error(`${options.label} is unsafe`);
      return bytes;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      const transient = code === "ENOENT" || (windows && TRANSIENT_RENAME_CODES.has(code));
      if (attempt >= attempts || !transient) throw error;
      await sleep(Math.min(10 * 2 ** (attempt - 1), 500));
    }
  }
}

export interface AtomicWriteOptions {
  refuseOverwrite?: boolean;
}

/**
 * Coordinates the atomic writes of one operation, such as a workspace lock holder, with its quiet sections, during
 * which another process may read the state those writes change. A write in the fenced async context waits while a
 * quiet section runs, and a quiet section starts only once no such write is in flight, so readers inside a quiet
 * section never see the operation's writes land. Writes made inside a quiet section itself are not held back: the
 * section's own work, such as an external provider's private records, is outside the state readers depend on. Once
 * `error` is set, every later fenced write throws it instead of writing.
 */
export class WriteFence {
  error?: Error;
  private writes = 0;
  private quiets = 0;
  private pendingQuiets = 0;
  private waiters: Array<() => void> = [];

  /** Runs `operation` as a quiet section; a section started inside another one of this fence joins it. */
  async quiet<T>(operation: () => Promise<T>): Promise<T> {
    if (quietSections.getStore()?.has(this) === true) return operation();
    this.pendingQuiets += 1;
    try {
      while (this.writes > 0) await this.changed();
    } finally {
      this.pendingQuiets -= 1;
    }
    this.quiets += 1;
    try {
      return await quietSections.run(new Set(quietSections.getStore() ?? []).add(this), operation);
    } finally {
      this.quiets -= 1;
      this.notify();
    }
  }

  async write<T>(operation: () => Promise<T>): Promise<T> {
    if (this.error !== undefined) throw this.error;
    if (quietSections.getStore()?.has(this) === true) return operation();
    // Waiting quiet sections go first, so a stream of writes cannot hold a reader window off indefinitely.
    while (this.quiets > 0 || this.pendingQuiets > 0) {
      await this.changed();
      if (this.error !== undefined) throw this.error;
    }
    this.writes += 1;
    try {
      return await operation();
    } finally {
      this.writes -= 1;
      this.notify();
    }
  }

  private changed(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}

const writeFences = new AsyncLocalStorage<WriteFence>();
const quietSections = new AsyncLocalStorage<ReadonlySet<WriteFence>>();

/** Runs `operation` with its atomic writes, and those of everything it starts, subject to `fence`. */
export function withWriteFence<T>(fence: WriteFence, operation: () => Promise<T>): Promise<T> {
  return writeFences.run(fence, operation);
}

export async function atomicWriteBytes(
  path: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const fence = writeFences.getStore();
  if (fence !== undefined) return fence.write(() => writeBytes(path, bytes, options));
  return writeBytes(path, bytes, options);
}

async function writeBytes(path: string, bytes: Uint8Array, options: AtomicWriteOptions): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (options.refuseOverwrite) {
      await link(temporary, path);
      await rm(temporary);
      return;
    }
    await renameWithRetry(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function atomicWriteJson(path: string, value: unknown, options: AtomicWriteOptions = {}): Promise<void> {
  await atomicWriteBytes(path, canonicalJsonBytes(value), options);
}
