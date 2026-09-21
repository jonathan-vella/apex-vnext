import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { promisify } from "node:util";
import {
  SECRET_FIELD_PATTERN,
  SECRET_VALUE_PATTERN,
  assertPolicyValidationJson,
  calculatePolicyValidationDigest,
  hasValidArchetypeSourceProposal,
  type ArchetypeSourceProposalV1,
} from "@apexops/contracts";

const execute = promisify(execFile);
const LIMITS = Object.freeze({ files: 256, fileBytes: 1_048_576, totalBytes: 8_388_608, treeBytes: 2_097_152 });
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".apex",
  ".github",
  ".vscode",
  ".azure",
  ".terraform",
  "node_modules",
  "agent-output",
  "logs",
  "secrets",
]);
const EXTENSIONS = new Set([".md", ".bicep", ".bicepparam", ".tf", ".json"]);

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 512 &&
    !isAbsolute(path) &&
    !/[\\:\x00-\x1f\x7f]/u.test(path) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/u.test(part))
  );
}

function exclusion(path: string): "source-authority" | "unsupported-material" | undefined {
  const parts = path.toLowerCase().split("/");
  const name = parts.at(-1)!;
  if (
    parts.some((part) => EXCLUDED_DIRECTORIES.has(part) || part.startsWith(".")) ||
    /^(?:agents|claude|gemini)\.md$/u.test(name) ||
    /(?:\.tfstate(?:\.|$)|\.tfplan$|\.tfvars$|\.env(?:\.|$)|\.(?:pem|key|pfx|publishsettings|azureauth)$)/u.test(
      name,
    ) ||
    /^(?:approval|credentials?|secrets?|deployment|inventory|operation|governance|run|journal|writer)(?:[._-].*)?\.json$/u.test(
      name,
    )
  )
    return "source-authority";
  if (!EXTENSIONS.has(extname(name))) return "unsupported-material";
  return undefined;
}

function hasSecretObject(value: unknown): boolean {
  if (typeof value === "string") return SECRET_VALUE_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(hasSecretObject);
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(
      ([key, child]) =>
        (SECRET_FIELD_PATTERN.test(key) && typeof child === "string" && child.length > 0) || hasSecretObject(child),
    );
  return false;
}

function hasRuntimeAuthority(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRuntimeAuthority);
  return (
    value !== null &&
    typeof value === "object" &&
    Object.entries(value).some(
      ([key, child]) =>
        [
          "ownerEpoch",
          "writerEpoch",
          "approvalHash",
          "previewHash",
          "deploymentHash",
          "leaseId",
          "journalHead",
          "accessToken",
          "refreshToken",
        ].includes(key) ||
        (key === "kind" && child === "approval") ||
        hasRuntimeAuthority(child),
    )
  );
}

function assertReusableContent(path: string, content: string): void {
  if (
    SECRET_VALUE_PATTERN.test(content) ||
    /(?:password|passwd|client_?secret|api_?key|access_?token|account_?key|connection_?string)\s*[=:]\s*['"][^'"\r\n]+['"]/iu.test(
      content,
    )
  )
    throw new Error("Archetype source contains credential-like content");
  if (extname(path).toLowerCase() === ".json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
      assertPolicyValidationJson(parsed);
    } catch {
      throw new Error("Archetype JSON content is invalid or exceeds bounds");
    }
    if (hasSecretObject(parsed)) throw new Error("Archetype source contains credential-like content");
    if (hasRuntimeAuthority(parsed))
      throw new Error("Archetype source contains runtime authority or deployment evidence");
  }
}

async function openArchetypeRepository(request: { readonly repositoryPath: string; readonly revision: string }) {
  if (!isAbsolute(request.repositoryPath) || !OBJECT_ID.test(request.revision))
    throw new TypeError("Archetype source selection is invalid");
  const info = await lstat(request.repositoryPath);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Archetype repository must be a regular directory");
  const repositoryPath = await realpath(request.repositoryPath);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const git = async (args: string[], maxBuffer: number = LIMITS.treeBytes): Promise<Buffer> => {
    try {
      const result = await execute(
        "git",
        ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "--no-pager", ...args],
        {
          cwd: repositoryPath,
          env: {
            ...environment,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
            GIT_NO_REPLACE_OBJECTS: "1",
            GIT_NO_LAZY_FETCH: "1",
            GIT_ALLOW_PROTOCOL: "",
          },
          encoding: "buffer",
          maxBuffer,
          timeout: 15_000,
        },
      );
      return result.stdout;
    } catch {
      throw new Error("Archetype Git object read failed or exceeded limits");
    }
  };
  const root = (await git(["rev-parse", "--show-toplevel"])).toString("utf8").trim();
  if ((await realpath(root)) !== repositoryPath) throw new Error("Archetype source must be a repository root");
  if ((await git(["cat-file", "-t", request.revision])).toString("utf8").trim() !== "commit")
    throw new Error("Archetype revision must identify an exact commit");
  return { repositoryPath, git };
}

export async function listArchetypeSources(request: {
  readonly repositoryPath: string;
  readonly revision: string;
  readonly catalogPath: string;
}) {
  if (!safePath(request.catalogPath) || exclusion(`${request.catalogPath}/main.bicep`) === "source-authority")
    throw new TypeError("Archetype catalog path is invalid");
  const { repositoryPath, git } = await openArchetypeRepository(request);
  const listing = await git(["ls-tree", "-z", `${request.revision}:${request.catalogPath}`]);
  const entries = new TextDecoder("utf-8", { fatal: true }).decode(listing).split("\0").filter(Boolean);
  if (entries.length > LIMITS.files) throw new Error("Archetype catalog exceeds entry limits");
  const paths = new Set<string>();
  const candidates: Array<{ selectedPath: string; treeObjectId: string; requiresInspection: true }> = [];
  for (const entry of entries) {
    const match = /^(\d{6}) (tree|blob|commit) ([a-f0-9]+)\t([\s\S]+)$/u.exec(entry);
    if (!match || !OBJECT_ID.test(match[3]!) || !safePath(match[4]!) || paths.has(match[4]!.toLowerCase()))
      throw new Error("Archetype catalog entry is invalid or collides");
    paths.add(match[4]!.toLowerCase());
    const selectedPath = `${request.catalogPath}/${match[4]!}`;
    if (match[1] !== "040000" || match[2] !== "tree" || exclusion(`${selectedPath}/main.bicep`) === "source-authority")
      continue;
    if (!safePath(selectedPath)) throw new Error("Archetype candidate path exceeds limits");
    candidates.push({ selectedPath, treeObjectId: match[3]!, requiresInspection: true });
  }
  candidates.sort((left, right) =>
    left.selectedPath < right.selectedPath ? -1 : left.selectedPath > right.selectedPath ? 1 : 0,
  );
  return { repositoryPath, revision: request.revision, catalogPath: request.catalogPath, candidates };
}

export async function inspectArchetypeSource(request: {
  readonly repositoryPath: string;
  readonly revision: string;
  readonly selectedPath: string;
}): Promise<{ readonly proposal: ArchetypeSourceProposalV1; readonly contents: ReadonlyMap<string, string> }> {
  if (!safePath(request.selectedPath)) throw new TypeError("Archetype source selection is invalid");
  if (exclusion(`${request.selectedPath}/main.bicep`) === "source-authority")
    throw new Error("Archetype source authority directory is not reusable");
  const { repositoryPath, git } = await openArchetypeRepository(request);
  if ((await git(["cat-file", "-t", `${request.revision}:${request.selectedPath}`])).toString("utf8").trim() !== "tree")
    throw new Error("Archetype selection must identify an exact commit and directory");
  const listing = await git([
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    request.revision,
    "--",
    `:(literal)${request.selectedPath}/`,
  ]);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const entries = decoder.decode(listing).split("\0").filter(Boolean);
  if (entries.length === 0 || entries.length > LIMITS.files) throw new Error("Archetype source file count is invalid");
  const files: Array<{ path: string; hash: string; bytes: number }> = [];
  const excluded: Array<{ path: string; reason: "source-authority" | "unsupported-material" }> = [];
  const contents = new Map<string, string>();
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/u.exec(entry);
    if (!match || !OBJECT_ID.test(match[3]!) || !match[4]!.startsWith(`${request.selectedPath}/`))
      throw new Error("Archetype tree entry is invalid");
    const path = match[4]!.slice(request.selectedPath.length + 1);
    if (!safePath(path) || paths.has(path.toLowerCase())) throw new Error("Archetype path is invalid or collides");
    paths.add(path.toLowerCase());
    const reason = exclusion(path);
    if (reason !== undefined) {
      excluded.push({ path, reason });
      continue;
    }
    if (match[1] !== "100644" || match[2] !== "blob") throw new Error("Archetype source uses an unsupported file mode");
    const size = Number((await git(["cat-file", "-s", match[3]!])).toString("utf8").trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.fileBytes || totalBytes + size > LIMITS.totalBytes)
      throw new Error("Archetype content exceeds byte limits");
    const bytes = await git(["cat-file", "blob", match[3]!], LIMITS.fileBytes + 1);
    if (bytes.length !== size) throw new Error("Archetype blob size is inconsistent");
    let content: string;
    try {
      content = decoder.decode(bytes);
    } catch {
      throw new Error("Archetype content is not valid UTF-8");
    }
    if (content.includes("\0")) throw new Error("Archetype content contains binary data");
    assertReusableContent(path, content);
    totalBytes += size;
    files.push({ path, hash: createHash("sha256").update(bytes).digest("hex"), bytes: size });
    contents.set(path, content);
  }
  if (files.length === 0) throw new Error("Archetype has no reusable material");
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  excluded.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const body = {
    schemaVersion: "1.0.0" as const,
    repositoryPath,
    revision: request.revision,
    selectedPath: request.selectedPath,
    authorityImported: false as const,
    requiresConsumerReview: true as const,
    files,
    excluded,
  };
  const proposal = { ...body, contentHash: calculatePolicyValidationDigest(body) };
  if (!hasValidArchetypeSourceProposal(proposal)) throw new Error("Archetype proposal is invalid");
  return { proposal, contents };
}
