import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sha256Json } from "./canonical.js";
import { retrySharingViolations, type SharingRetryOptions } from "./files.js";

/** Most entries a repeat file snapshot covers; a larger tree fails the snapshot, which disables replay and storage. */
export const MAX_REPEAT_FILE_ENTRIES = 20_000;
/** Most file bytes a repeat file snapshot hashes; a larger tree fails the snapshot, which disables replay and storage. */
export const MAX_REPEAT_FILE_BYTES = 64 * 1024 * 1024;
const HASH_CHUNK_BYTES = 64 * 1024;
const HASH_ATTEMPTS = 3;

/**
 * One bound path. A regular file is bound by the SHA-256 of its content and by its stat identity (device, inode, mode,
 * size, modification and change times); a directory by its existence; anything else, such as a symbolic link, by its
 * stat identity without being followed.
 */
export type RepeatFileEntry =
  { type: "directory" } | { type: "file"; sha256: string; stat: string } | { type: "other"; stat: string };

/** Content of the mutable trees a repeat-guarded call binds, as read at one point in time. */
export interface RepeatFileSnapshot {
  /** Absolute, sorted, unique roots. A missing root binds its absence. */
  roots: string[];
  /** Every path under the roots, roots included, keyed by absolute path. */
  entries: Record<string, RepeatFileEntry>;
}

export interface RepeatFileSnapshotOptions extends SharingRetryOptions {
  maxEntries?: number;
  maxBytes?: number;
}

/** A bound tree is too large or kept changing while it was read, so it cannot be bound by content. */
export class RepeatFileSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepeatFileSnapshotError";
  }
}

function within(root: string, path: string): boolean {
  const offset = relative(root, path);
  return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

function statKey(metadata: BigIntStats): string {
  return [metadata.dev, metadata.ino, metadata.mode, metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(":");
}

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Reads the trees under `roots` and hashes every regular file with streaming SHA-256. Roots nested in another root are
 * read once. Symbolic links below a root are bound by their own stat and never followed; a root that is a symbolic
 * link fails the snapshot. A file that keeps changing while it is hashed, or a tree over the entry or byte budget,
 * fails the snapshot with {@link RepeatFileSnapshotError}. Windows sharing violations are retried.
 */
export async function snapshotRepeatFiles(
  roots: readonly string[],
  options: RepeatFileSnapshotOptions = {},
): Promise<RepeatFileSnapshot> {
  const maxEntries = options.maxEntries ?? MAX_REPEAT_FILE_ENTRIES;
  const maxBytes = options.maxBytes ?? MAX_REPEAT_FILE_BYTES;
  const retry: SharingRetryOptions = {
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  };
  const unique = [...new Set(roots.map((root) => resolve(root)))].sort();
  const entries: Record<string, RepeatFileEntry> = {};
  let count = 0;
  let bytes = 0;
  const add = (path: string, entry: RepeatFileEntry) => {
    if (++count > maxEntries) throw new RepeatFileSnapshotError("Repeat-bound files exceed their entry budget");
    entries[path] = entry;
  };
  const hash = async (path: string): Promise<RepeatFileEntry | undefined> => {
    for (let attempt = 1; ; attempt += 1) {
      let handle;
      try {
        handle = await retrySharingViolations(
          () => open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)),
          retry,
        );
      } catch (error) {
        if (missing(error)) return undefined;
        throw error;
      }
      try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile()) throw new RepeatFileSnapshotError("A repeat-bound file changed type while it was read");
        const digest = createHash("sha256");
        const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
        let read = 0;
        for (;;) {
          const { bytesRead } = await retrySharingViolations(
            () => handle.read(buffer, 0, buffer.byteLength, null),
            retry,
          );
          if (bytesRead === 0) break;
          read += bytesRead;
          if (bytes + read > maxBytes) throw new RepeatFileSnapshotError("Repeat-bound files exceed their byte budget");
          digest.update(buffer.subarray(0, bytesRead));
        }
        const after = await handle.stat({ bigint: true });
        if (statKey(before) === statKey(after) && BigInt(read) === after.size) {
          bytes += read;
          return { type: "file", sha256: digest.digest("hex"), stat: statKey(after) };
        }
      } finally {
        await handle.close();
      }
      if (attempt >= HASH_ATTEMPTS)
        throw new RepeatFileSnapshotError("A repeat-bound file kept changing while it was read");
    }
  };
  const visit = async (path: string, root: boolean): Promise<void> => {
    let metadata: BigIntStats;
    try {
      metadata = await retrySharingViolations(() => lstat(path, { bigint: true }), retry);
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    if (metadata.isDirectory()) {
      add(path, { type: "directory" });
      let names: string[];
      try {
        names = await retrySharingViolations(() => readdir(path), retry);
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
      for (const name of names.sort()) await visit(join(path, name), false);
      return;
    }
    if (root && metadata.isSymbolicLink()) throw new RepeatFileSnapshotError("A repeat-bound root is a symbolic link");
    if (!metadata.isFile()) {
      add(path, { type: "other", stat: statKey(metadata) });
      return;
    }
    const entry = await hash(path);
    if (entry !== undefined) add(path, entry);
  };
  for (const root of unique) {
    if (unique.some((other) => other !== root && within(other, root))) continue;
    await visit(root, true);
  }
  return { roots: unique, entries };
}

/** Digest of a snapshot for the repeat state token; equal only for equal roots, paths, contents and stat identities. */
export function repeatFilesDigest(snapshot: RepeatFileSnapshot): string {
  return sha256Json({ version: 1, roots: snapshot.roots, entries: snapshot.entries });
}

/**
 * Writes a repeat-guarded operation made itself to bound files, in order. The guard compares the bound trees after the
 * operation with their content at its start changed only by these writes.
 */
export class RepeatFileWrites {
  readonly #writes: Array<{ path: string; sha256: string | null }> = [];

  /** The operation wrote `path` with content of SHA-256 `sha256`, creating missing parent directories. */
  file(path: string, sha256: string): void {
    if (!/^[0-9a-f]{64}$/u.test(sha256)) throw new TypeError("Repeat file write needs a SHA-256 content hash");
    this.#writes.push({ path: resolve(path), sha256 });
  }

  /** The operation removed `path` and everything below it. */
  removed(path: string): void {
    this.#writes.push({ path: resolve(path), sha256: null });
  }

  get writes(): ReadonlyArray<{ readonly path: string; readonly sha256: string | null }> {
    return this.#writes;
  }
}

type ExpectedEntry = RepeatFileEntry | { type: "written"; sha256: string };

/**
 * True when every tree bound at `start` holds, in `end`, exactly its start content changed only by the operation's own
 * `writes`: a file the operation wrote holds what it wrote, and every other path is unchanged in content and stat
 * identity. A bound root missing from `end` fails the check, so `end` must be read over at least the start roots.
 */
export function repeatFilesHeld(
  start: RepeatFileSnapshot,
  end: RepeatFileSnapshot,
  writes?: RepeatFileWrites,
): boolean {
  if (!start.roots.every((root) => end.roots.includes(root))) return false;
  const rootOf = (path: string) =>
    start.roots.filter((root) => within(root, path)).sort((left, right) => right.length - left.length)[0];
  const expected = new Map<string, ExpectedEntry>(
    Object.entries(start.entries).filter(([path]) => rootOf(path) !== undefined),
  );
  for (const { path, sha256 } of writes?.writes ?? []) {
    if (sha256 === null) {
      for (const key of [...expected.keys()]) if (within(path, key)) expected.delete(key);
      continue;
    }
    const root = rootOf(path);
    if (root === undefined) continue;
    expected.set(path, { type: "written", sha256 });
    for (let parent = dirname(path); within(root, parent); parent = dirname(parent)) {
      if (!expected.has(parent)) expected.set(parent, { type: "directory" });
      if (parent === root) break;
    }
  }
  const actual = Object.entries(end.entries).filter(([path]) => rootOf(path) !== undefined);
  if (actual.length !== expected.size) return false;
  return actual.every(([path, entry]) => {
    const wanted = expected.get(path);
    if (wanted === undefined) return false;
    if (wanted.type === "written") return entry.type === "file" && entry.sha256 === wanted.sha256;
    return sha256Json(wanted) === sha256Json(entry);
  });
}
