import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { calculatePolicyValidationDigest } from "@apexops/contracts";

export type AzdBindingErrorCode =
  | "AZD_BINDING_CHANGED"
  | "AZD_BINDING_INPUT_INVALID"
  | "AZD_ENV_INVALID"
  | "AZD_ENV_MISSING"
  | "AZD_ENV_SECRET"
  | "AZD_ENV_TARGET_MISMATCH"
  | "AZD_ENV_UNAPPROVED_KEY"
  | "AZD_FILE_LIMIT_EXCEEDED"
  | "AZD_HOOK_SCRIPT_INVALID"
  | "AZD_INFRA_MISSING"
  | "AZD_LAYER_UNSUPPORTED"
  | "AZD_NOT_FOUND"
  | "AZD_PIN_UNAVAILABLE"
  | "AZD_VERSION_MISMATCH"
  | "AZD_VERSION_UNAVAILABLE"
  | "AZD_MODULE_UNPINNED"
  | "AZD_PARAMETERS_SECRET"
  | "AZD_PARAMETERS_UNRESOLVED"
  | "AZD_PARAMETERS_UNSUPPORTED"
  | "AZD_PATH_UNSAFE"
  | "AZD_PROJECT_MISSING"
  | "AZD_PROJECT_UNSUPPORTED"
  | "AZD_PROVIDER_UNSUPPORTED"
  | "AZD_VERSION_CONSTRAINT"
  | "AZD_IDENTITY_MISMATCH"
  | "AZD_YAML_INVALID";

export class AzdBindingError extends Error {
  constructor(
    public readonly code: AzdBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AzdBindingError";
  }
}

export const AZD_FILE_LIMITS = Object.freeze({
  /** `azure.yaml`, hook scripts, parameter files and environment files. */
  fileBytes: 256 * 1024,
  treeBytes: 16 * 1024 * 1024,
  treeEntries: 2048,
  treeDepth: 16,
});

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathEscapes(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation);
}

/**
 * Read-only view of an azd project directory. Every access is relative to the root, refuses symbolic links, hard
 * links and special files, and is size-limited, so a project cannot make the binding read outside itself.
 */
export class AzdProjectFiles {
  private constructor(
    readonly rootPath: string,
    private readonly rootRealPath: string,
  ) {}

  static async open(projectRoot: string): Promise<AzdProjectFiles> {
    if (typeof projectRoot !== "string" || !isAbsolute(projectRoot))
      throw new AzdBindingError("AZD_BINDING_INPUT_INVALID", "The azd project root must be an absolute path");
    const rootPath = resolve(projectRoot);
    try {
      const metadata = await lstat(rootPath);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("not a real directory");
      return new AzdProjectFiles(rootPath, await realpath(rootPath));
    } catch {
      throw new AzdBindingError("AZD_PROJECT_MISSING", "The azd project root is not a readable directory");
    }
  }

  /** Metadata for `path`, or undefined when absent. Any symbolic link on the way fails closed. */
  async stat(path: string): Promise<Stats | undefined> {
    const segments = path.split("/");
    let current = this.rootPath;
    let metadata: Stats | undefined;
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      if (pathEscapes(this.rootPath, current)) throw this.unsafe();
      try {
        metadata = await lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR")
          return undefined;
        throw this.unsafe();
      }
      if (metadata.isSymbolicLink()) throw this.unsafe();
      if (index < segments.length - 1 && !metadata.isDirectory()) throw this.unsafe();
    }
    return metadata;
  }

  async read(path: string, maxBytes: number, missing: AzdBindingErrorCode): Promise<Buffer> {
    const metadata = await this.stat(path);
    if (metadata === undefined) throw new AzdBindingError(missing, `Required azd project file is missing: ${path}`);
    return await this.readFile(path, metadata, maxBytes);
  }

  async readFile(path: string, metadata: Stats, maxBytes: number): Promise<Buffer> {
    if (!metadata.isFile() || metadata.nlink !== 1) throw this.unsafe();
    if (metadata.size > maxBytes)
      throw new AzdBindingError("AZD_FILE_LIMIT_EXCEEDED", `An azd project file exceeds ${maxBytes} bytes: ${path}`);
    const absolute = join(this.rootPath, ...path.split("/"));
    try {
      if (pathEscapes(this.rootRealPath, await realpath(absolute))) throw this.unsafe();
      const input = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = await input.stat();
        if (!opened.isFile() || opened.nlink !== 1) throw this.unsafe();
        const chunks: Buffer[] = [];
        let bytes = 0;
        for (;;) {
          const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - bytes + 1));
          const { bytesRead } = await input.read(chunk);
          if (bytesRead === 0) break;
          bytes += bytesRead;
          if (bytes > maxBytes)
            throw new AzdBindingError(
              "AZD_FILE_LIMIT_EXCEEDED",
              `An azd project file exceeds ${maxBytes} bytes: ${path}`,
            );
          chunks.push(chunk.subarray(0, bytesRead));
        }
        return Buffer.concat(chunks);
      } finally {
        await input.close();
      }
    } catch (error) {
      if (error instanceof AzdBindingError) throw error;
      throw this.unsafe();
    }
  }

  /** Digest of every file under a directory, so any added, removed, renamed or edited file changes it. */
  async hashTree(path: string, visitFile?: (relativePath: string, content: Buffer) => void): Promise<string> {
    const files: Array<{ path: string; hash: string }> = [];
    let entries = 0;
    let bytes = 0;
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > AZD_FILE_LIMITS.treeDepth)
        throw new AzdBindingError("AZD_FILE_LIMIT_EXCEEDED", `The azd infrastructure tree is too deep: ${path}`);
      const names: string[] = [];
      for await (const entry of await opendir(join(this.rootPath, ...directory.split("/")))) {
        names.push(entry.name);
        if (names.length > AZD_FILE_LIMITS.treeEntries)
          throw new AzdBindingError(
            "AZD_FILE_LIMIT_EXCEEDED",
            `The azd infrastructure tree has too many entries: ${path}`,
          );
      }
      for (const name of names.sort()) {
        if (++entries > AZD_FILE_LIMITS.treeEntries)
          throw new AzdBindingError(
            "AZD_FILE_LIMIT_EXCEEDED",
            `The azd infrastructure tree has too many entries: ${path}`,
          );
        const child = `${directory}/${name}`;
        const metadata = await this.stat(child);
        if (metadata === undefined) throw this.unsafe();
        if (metadata.isDirectory()) {
          await visit(child, depth + 1);
          continue;
        }
        const content = await this.readFile(child, metadata, AZD_FILE_LIMITS.treeBytes - bytes);
        bytes += content.length;
        files.push({ path: child.slice(path.length + 1), hash: sha256Hex(content) });
        visitFile?.(child.slice(path.length + 1), content);
      }
    };
    const root = await this.stat(path);
    if (root === undefined || !root.isDirectory()) throw this.unsafe();
    try {
      await visit(path, 0);
    } catch (error) {
      if (error instanceof AzdBindingError) throw error;
      throw this.unsafe();
    }
    files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return calculatePolicyValidationDigest(files);
  }

  private unsafe(): AzdBindingError {
    return new AzdBindingError("AZD_PATH_UNSAFE", "An azd project path is unsafe: links and escapes are refused");
  }
}
