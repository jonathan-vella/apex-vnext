import { constants } from "node:fs";
import { link, mkdir, open, rename, rm } from "node:fs/promises";
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
  const attempts = (options.platform ?? process.platform) === "win32" ? (options.attempts ?? 10) : 1;
  const move = options.rename ?? rename;
  const sleep =
    options.sleep ?? (async (milliseconds: number) => await new Promise((done) => setTimeout(done, milliseconds)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      await move(from, to);
      return;
    } catch (error) {
      if (attempt >= attempts || !TRANSIENT_RENAME_CODES.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await sleep(Math.min(10 * 2 ** (attempt - 1), 500));
    }
  }
}

export interface AtomicWriteOptions {
  refuseOverwrite?: boolean;
}

export async function atomicWriteBytes(
  path: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
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
