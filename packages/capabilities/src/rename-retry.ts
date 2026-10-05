import { rename } from "node:fs/promises";

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export interface RenameRetryOptions {
  readonly platform?: NodeJS.Platform;
  readonly attempts?: number;
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

// Kept in step with renameWithRetry in @apexops/kernel; core packages may depend only on contracts.
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
