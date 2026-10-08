import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ApexError, EXIT_CODES, remediationForApexError, type RuntimeMismatchReason } from "./errors.js";
import { APEX_VERSION } from "./version.js";

/** Workspace file whose `cliVersion` names the runtime version that `apex init`, `apex update` and doctor repair wrote. */
export const WORKSPACE_RUNTIME_LOCK = ".apex/apex.lock.json";

const MAX_LOCK_BYTES = 64 * 1024;
const MAX_VERSION_LENGTH = 128;
const IDENTIFIER = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(
  String.raw`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(${IDENTIFIER}(?:\.${IDENTIFIER})*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`,
  "u",
);

export type WorkspaceRuntimeBinding =
  | { state: "uninitialized" }
  | { state: "match"; runtimeVersion: string }
  | {
      state: "mismatch";
      reason: RuntimeMismatchReason;
      runtimeVersion: string;
      workspaceRuntimeVersion: string | null;
    };

type ParsedVersion = { core: [string, string, string]; prerelease: string[] };

function parseVersion(version: string): ParsedVersion | undefined {
  if (version.length > MAX_VERSION_LENGTH) return undefined;
  const match = SEMVER.exec(version);
  if (match === null) return undefined;
  return {
    core: [match[1]!, match[2]!, match[3]!],
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

// SemVer numeric identifiers have no leading zeroes and no size limit, so compare them as digit strings: the longer is
// larger, and equal lengths compare lexicographically. Converting to number would lose precision past 2^53.
function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

/** SemVer 2.0.0 precedence; build metadata is ignored. */
export function compareRuntimeVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === undefined || b === undefined) throw new Error("Runtime versions must be SemVer");
  for (let index = 0; index < 3; index += 1) {
    const order = compareNumeric(a.core[index]!, b.core[index]!);
    if (order !== 0) return order;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0)
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/u.test(x);
    const yNumeric = /^\d+$/u.test(y);
    if (xNumeric && yNumeric) return compareNumeric(x, y);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

async function lockedRuntimeVersion(path: string): Promise<string | null | undefined> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    // Only an absent lock means APEX was never initialized here; any other failure fails closed.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return null;
  }
  if (!stats.isFile() || stats.size > MAX_LOCK_BYTES) return null;
  try {
    const lock = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (lock === null || typeof lock !== "object" || Array.isArray(lock)) return null;
    const version = (lock as { cliVersion?: unknown }).cliVersion;
    return typeof version === "string" && parseVersion(version) !== undefined ? version : null;
  } catch {
    return null;
  }
}

/**
 * Compares the runtime serving this process with the version recorded in the workspace runtime lock. The plugin bundles
 * the exact `@apexops/cli` version it was built from, so one rule covers the plugin and npm channels alike: the runtime
 * version must equal the workspace lock version exactly. The lock is read on every call so an `apex update` made while
 * the server runs takes effect without a restart.
 */
export async function workspaceRuntimeBinding(
  root: string,
  runtimeVersion: string = APEX_VERSION,
): Promise<WorkspaceRuntimeBinding> {
  const workspaceRuntimeVersion = await lockedRuntimeVersion(join(root, WORKSPACE_RUNTIME_LOCK));
  if (workspaceRuntimeVersion === undefined) return { state: "uninitialized" };
  if (workspaceRuntimeVersion === runtimeVersion) return { state: "match", runtimeVersion };
  if (workspaceRuntimeVersion === null)
    return { state: "mismatch", reason: "RUNTIME_LOCK_INVALID", runtimeVersion, workspaceRuntimeVersion };
  return {
    state: "mismatch",
    // Versions that differ only in build metadata have equal precedence; neither side is older, so the workspace
    // keeps its version and the runtime must match it.
    reason:
      compareRuntimeVersions(workspaceRuntimeVersion, runtimeVersion) < 0
        ? "RUNTIME_WORKSPACE_OLDER"
        : "RUNTIME_WORKSPACE_NEWER",
    runtimeVersion,
    workspaceRuntimeVersion,
  };
}

export function runtimeMismatchError(binding: Extract<WorkspaceRuntimeBinding, { state: "mismatch" }>): ApexError {
  const { reason, runtimeVersion, workspaceRuntimeVersion } = binding;
  const message =
    workspaceRuntimeVersion === null
      ? `The workspace runtime lock ${WORKSPACE_RUNTIME_LOCK} has no valid cliVersion; this APEX runtime is @apexops/cli@${runtimeVersion}`
      : `The workspace runtime lock names @apexops/cli@${workspaceRuntimeVersion}, ${
          reason === "RUNTIME_WORKSPACE_OLDER" ? "older" : "newer"
        } than this APEX runtime @apexops/cli@${runtimeVersion}`;
  return new ApexError("APEX_RUNTIME_MISMATCH", message, EXIT_CODES.conflict, {
    reason,
    runtimeVersion,
    workspaceRuntimeVersion,
  });
}

/** Read-only `status` result that reports a runtime mismatch without reading workspace state. */
export function runtimeMismatchStatus(binding: Extract<WorkspaceRuntimeBinding, { state: "mismatch" }>) {
  return {
    status: "runtime_mismatch" as const,
    reason: binding.reason,
    runtimeVersion: binding.runtimeVersion,
    workspaceRuntimeVersion: binding.workspaceRuntimeVersion,
    nextAction: remediationForApexError(runtimeMismatchError(binding)),
  };
}
