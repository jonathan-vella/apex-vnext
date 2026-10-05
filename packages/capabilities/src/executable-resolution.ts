import { accessSync, constants, statSync } from "node:fs";
import { posix, win32 } from "node:path";

export interface ExecutableResolutionOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly isExecutableFile?: (path: string, platform: NodeJS.Platform) => boolean;
}

export interface LaunchPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments: boolean;
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function environmentValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") return env[name];
  // Windows environment names are case-insensitive. Like Node, when PATH and Path both exist use the key that sorts first,
  // so resolution sees the same value the child process receives.
  const key = Object.keys(env)
    .filter((candidate) => candidate.toUpperCase() === name)
    .sort()[0];
  return key === undefined ? undefined : env[key];
}

function defaultIsExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a bare executable name the way the platform shell would. Node does not apply PATHEXT when spawning on
 * Windows, so `az` and `npm` (installed as `az.cmd` and `npm.cmd`) are otherwise not found.
 */
export function resolveExecutable(executable: string, options: ExecutableResolutionOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const isExecutableFile = options.isExecutableFile ?? defaultIsExecutableFile;
  const path = platform === "win32" ? win32 : posix;
  const extensions =
    platform === "win32"
      ? (environmentValue(env, "PATHEXT", platform) ?? DEFAULT_PATHEXT)
          .split(";")
          .map((extension) => extension.trim().toLowerCase())
          .filter((extension) => extension.startsWith("."))
      : [""];
  const candidatesFor = (base: string): string[] => {
    if (platform !== "win32") return [base];
    const extension = path.extname(base).toLowerCase();
    return extensions.includes(extension) ? [base] : extensions.map((suffix) => `${base}${suffix}`);
  };
  const hasDirectory = executable.includes("/") || (platform === "win32" && executable.includes("\\"));
  if (hasDirectory || path.isAbsolute(executable))
    return candidatesFor(executable).find((candidate) => isExecutableFile(candidate, platform));
  const directories = (environmentValue(env, "PATH", platform) ?? "")
    .split(path.delimiter)
    .map((directory) => directory.trim().replace(/^"(.*)"$/u, "$1"))
    .filter((directory) => directory.length > 0);
  for (const directory of directories) {
    const found = candidatesFor(path.join(directory, executable)).find((candidate) =>
      isExecutableFile(candidate, platform),
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

function quoteForCmd(value: string): string {
  // cmd.exe expands %VAR% and !VAR! even inside quotes and cannot carry quotes or line breaks in an argument.
  if (/["%!\r\n\0]/u.test(value)) throw new TypeError("Argument cannot be passed safely to a Windows command script");
  return value.length === 0 || /[\s&|<>()^,;=]/u.test(value) ? `"${value}"` : value;
}

/**
 * Plan a no-shell launch. Windows `.cmd` and `.bat` files cannot be spawned directly, and `shell: true` with an
 * argument array is deprecated (DEP0190), so they run through `cmd.exe /d /s /c` with one validated command line.
 */
export function planLaunch(
  executable: string,
  args: readonly string[],
  options: ExecutableResolutionOptions = {},
): LaunchPlan {
  const platform = options.platform ?? process.platform;
  const resolved = resolveExecutable(executable, options);
  if (resolved === undefined) return { command: executable, args: [...args], windowsVerbatimArguments: false };
  if (platform === "win32" && /\.(?:cmd|bat)$/iu.test(resolved)) {
    const env = options.env ?? process.env;
    const commandLine = [resolved, ...args].map(quoteForCmd).join(" ");
    return {
      command: environmentValue(env, "COMSPEC", platform) ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"${commandLine}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command: resolved, args: [...args], windowsVerbatimArguments: false };
}
