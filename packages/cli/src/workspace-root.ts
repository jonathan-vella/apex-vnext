import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { ApexError, EXIT_CODES } from "./errors.js";

export interface ResolvedMcpWorkspace {
  workspace: string;
  root: string;
}

function resolveGitPath(base: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}

async function findGitDirectory(start: string): Promise<{ gitDirectory: string } | undefined> {
  for (let directory = resolve(start); ; directory = dirname(directory)) {
    const gitPath = join(directory, ".git");
    const stat = await lstat(gitPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (stat?.isDirectory() === true) return { gitDirectory: gitPath };
    if (stat?.isFile() === true) {
      const content = await readFile(gitPath, "utf8");
      const match = /^gitdir:\s*(.+?)\s*$/iu.exec(content.trim());
      if (match === null) {
        throw new ApexError(
          "APEX_WORKSPACE_UNSUPPORTED",
          `Unsupported git metadata at ${gitPath}; expected a gitdir pointer`,
          EXIT_CODES.validation,
        );
      }
      return { gitDirectory: resolveGitPath(directory, match[1]!) };
    }
    if (stat !== undefined) {
      throw new ApexError(
        "APEX_WORKSPACE_UNSUPPORTED",
        `Unsupported git metadata at ${gitPath}; expected a .git directory or gitdir file`,
        EXIT_CODES.validation,
      );
    }
    if (dirname(directory) === directory) return undefined;
  }
}

async function gitCommonDirectory(gitDirectory: string): Promise<string> {
  const commonPath = join(gitDirectory, "commondir");
  const content = await readFile(commonPath, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  return realpath(resolveGitPath(gitDirectory, content?.trim() || gitDirectory));
}

// A session may start below the workspace root; stop at the repository boundary so an unrelated parent is never used.
export async function mcpWorkspaceRoot(start: string): Promise<string> {
  for (let directory = resolve(start); ; directory = dirname(directory)) {
    const apex = await lstat(join(directory, ".apex")).catch(() => undefined);
    if (apex?.isDirectory() === true) return directory;
    const repository = await lstat(join(directory, ".git")).catch(() => undefined);
    if (repository !== undefined || dirname(directory) === directory) return start;
  }
}

export async function resolveMcpWorkspace(start: string): Promise<ResolvedMcpWorkspace> {
  const workspace = await realpath(start);
  const stat = await lstat(workspace);
  if (!stat.isDirectory()) {
    throw new ApexError("APEX_VALIDATION", "workspace must be an existing directory", EXIT_CODES.validation);
  }
  const git = await findGitDirectory(workspace);
  if (git === undefined) return { workspace, root: await realpath(await mcpWorkspaceRoot(workspace)) };
  const commonDirectory = await gitCommonDirectory(git.gitDirectory);
  if (basename(commonDirectory).toLocaleLowerCase() !== ".git") {
    throw new ApexError(
      "APEX_WORKSPACE_UNSUPPORTED",
      `Unsupported git common directory ${commonDirectory}; pass a non-bare checkout or worktree with a standard .git common directory`,
      EXIT_CODES.validation,
    );
  }
  return { workspace, root: dirname(commonDirectory) };
}
