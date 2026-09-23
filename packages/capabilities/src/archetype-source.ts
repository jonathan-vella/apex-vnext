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

interface SourceEntry {
  mode: string;
  kind: string;
  objectId: string;
  path: string;
  size?: number;
}
type RemoteJsonReader = (endpoint: string) => Promise<unknown>;

export function isRemoteArchetypeRepository(repository: string): boolean {
  return (
    /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(repository) &&
    !repository.endsWith("/.") &&
    !repository.endsWith("/..")
  );
}

async function readRemoteJson(endpoint: string): Promise<unknown> {
  try {
    const result = await execute("gh", ["api", "--hostname", "github.com", "--method", "GET", endpoint], {
      encoding: "utf8",
      maxBuffer: LIMITS.treeBytes,
      timeout: 15_000,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
    });
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Remote archetype read failed or exceeded limits; verify GitHub access outside APEX");
  }
}

async function remoteTree(
  request: { repositoryPath: string; revision: string; selectedPath: string },
  read: RemoteJsonReader,
) {
  if (
    !isRemoteArchetypeRepository(request.repositoryPath) ||
    !/^[a-f0-9]{40}$/.test(request.revision) ||
    !safePath(request.selectedPath) ||
    exclusion(`${request.selectedPath}/main.bicep`) === "source-authority"
  )
    throw new TypeError("Remote archetype selection is invalid");
  const repository = request.repositoryPath.slice("https://github.com/".length).replace(/\.git$/, "");
  const prefix = `repos/${repository}/git`;
  let calls = 0;
  const deadline = Date.now() + 120_000;
  const json = async (endpoint: string): Promise<Record<string, unknown>> => {
    if (++calls > 280 || Date.now() > deadline) throw new Error("Remote archetype request budget exceeded");
    const value = await read(endpoint);
    if (Date.now() > deadline) throw new Error("Remote archetype request budget exceeded");
    assertPolicyValidationJson(value);
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Buffer.byteLength(JSON.stringify(value)) > LIMITS.treeBytes
    )
      throw new Error("Remote archetype response is invalid");
    return value as Record<string, unknown>;
  };
  const commit = await json(`${prefix}/commits/${request.revision}`);
  const tree = commit.tree as { sha?: unknown } | undefined;
  if (commit.sha !== request.revision || typeof tree?.sha !== "string" || !/^[a-f0-9]{40}$/.test(tree.sha))
    throw new Error("Remote archetype commit does not match");
  const loadTree = async (objectId: string): Promise<SourceEntry[]> => {
    const result = await json(`${prefix}/trees/${objectId}`);
    if (
      result.sha !== objectId ||
      result.truncated !== false ||
      !Array.isArray(result.tree) ||
      result.tree.length > LIMITS.files
    )
      throw new Error("Remote archetype tree is incomplete or exceeds limits");
    const entries = result.tree.map((entry: Record<string, unknown>): SourceEntry => {
      if (
        entry === null ||
        typeof entry !== "object" ||
        typeof entry.path !== "string" ||
        entry.path.includes("/") ||
        !safePath(entry.path) ||
        typeof entry.sha !== "string" ||
        !/^[a-f0-9]{40}$/.test(entry.sha) ||
        typeof entry.mode !== "string" ||
        typeof entry.type !== "string"
      )
        throw new Error("Remote archetype tree entry is invalid");
      return {
        path: entry.path,
        objectId: entry.sha,
        kind: entry.type,
        mode: entry.mode,
        ...(typeof entry.size === "number" ? { size: entry.size } : {}),
      };
    });
    if (new Set(entries.map(({ path }) => path.toLowerCase())).size !== entries.length)
      throw new Error("Remote archetype paths collide");
    return entries;
  };
  let current = tree.sha;
  const parts = request.selectedPath.split("/");
  if (parts.length > 16) throw new Error("Remote archetype path exceeds depth limit");
  for (const part of parts) {
    const selected = (await loadTree(current)).find(({ path }) => path === part);
    if (selected?.kind !== "tree" || selected.mode !== "040000")
      throw new Error("Remote archetype directory is missing");
    current = selected.objectId;
  }
  return { repositoryPath: `https://github.com/${repository}`, prefix, json, loadTree, objectId: current };
}

export async function listRemoteArchetypes(
  request: {
    repositoryPath: string;
    revision: string;
    catalogPath: string;
  },
  read: RemoteJsonReader = readRemoteJson,
) {
  request = structuredClone(request);
  const source = await remoteTree({ ...request, selectedPath: request.catalogPath }, read);
  const candidates = (await source.loadTree(source.objectId))
    .filter(
      ({ kind, mode, path }) =>
        kind === "tree" && mode === "040000" && exclusion(`${path}/main.bicep`) !== "source-authority",
    )
    .map(({ path, objectId }) => ({
      selectedPath: `${request.catalogPath}/${path}`,
      treeObjectId: objectId,
      requiresInspection: true as const,
    }))
    .sort((left, right) => left.selectedPath.localeCompare(right.selectedPath));
  if (candidates.some(({ selectedPath }) => !safePath(selectedPath)))
    throw new Error("Remote archetype candidate path exceeds limits");
  return {
    repositoryPath: source.repositoryPath,
    revision: request.revision,
    catalogPath: request.catalogPath,
    candidates,
  };
}

export async function inspectRemoteArchetype(
  request: {
    repositoryPath: string;
    revision: string;
    selectedPath: string;
  },
  read: RemoteJsonReader = readRemoteJson,
): Promise<{ proposal: ArchetypeSourceProposalV1; contents: ReadonlyMap<string, string> }> {
  request = structuredClone(request);
  const source = await remoteTree(request, read);
  const entries: SourceEntry[] = [];
  let visited = 0;
  const visit = async (objectId: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 16) throw new Error("Remote archetype tree exceeds depth limit");
    for (const entry of await source.loadTree(objectId)) {
      if (++visited > LIMITS.files) throw new Error("Remote archetype tree exceeds entry limits");
      const path = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (!safePath(path)) throw new Error("Remote archetype path is invalid");
      if (entry.kind === "tree" && entry.mode === "040000") await visit(entry.objectId, path, depth + 1);
      else entries.push({ ...entry, path });
    }
  };
  await visit(source.objectId, "", 0);
  const files: ArchetypeSourceProposalV1["files"] = [];
  const excluded: ArchetypeSourceProposalV1["excluded"] = [];
  const contents = new Map<string, string>();
  let total = 0;
  for (const entry of entries) {
    const reason = exclusion(entry.path);
    if (reason !== undefined) {
      excluded.push({ path: entry.path, reason });
      continue;
    }
    if (entry.kind !== "blob" || entry.mode !== "100644")
      throw new Error("Archetype source uses an unsupported file mode");
    const size = entry.size;
    if (
      !Number.isSafeInteger(size) ||
      size === undefined ||
      size < 0 ||
      size > LIMITS.fileBytes ||
      total + size > LIMITS.totalBytes
    )
      throw new Error("Archetype content exceeds byte limits");
    const blob = await source.json(`${source.prefix}/blobs/${entry.objectId}`);
    if (
      blob.sha !== entry.objectId ||
      blob.size !== size ||
      blob.encoding !== "base64" ||
      typeof blob.content !== "string"
    )
      throw new Error("Remote archetype blob is invalid");
    const encoded = blob.content.replace(/\n/g, "");
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.length !== size ||
      bytes.toString("base64") !== encoded ||
      createHash("sha1").update(`blob ${size}\0`).update(bytes).digest("hex") !== entry.objectId
    )
      throw new Error("Remote archetype blob hash or size does not match");
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (content.includes("\0")) throw new Error("Archetype content contains binary data");
    assertReusableContent(entry.path, content);
    total += size;
    files.push({ path: entry.path, bytes: size, hash: createHash("sha256").update(bytes).digest("hex") });
    contents.set(entry.path, content);
  }
  if (files.length === 0) throw new Error("Archetype has no reusable material");
  const sort = (left: { path: string }, right: { path: string }) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  files.sort(sort);
  excluded.sort(sort);
  const body = {
    schemaVersion: "1.0.0" as const,
    repositoryPath: source.repositoryPath,
    revision: request.revision,
    selectedPath: request.selectedPath,
    authorityImported: false as const,
    requiresConsumerReview: true as const,
    files,
    excluded,
  };
  const proposal = { ...body, contentHash: calculatePolicyValidationDigest(body) };
  if (!hasValidArchetypeSourceProposal(proposal)) throw new Error("Remote archetype proposal is invalid");
  return { proposal, contents };
}

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
