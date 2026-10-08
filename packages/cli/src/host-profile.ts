import { readFile, stat } from "node:fs/promises";
import { homedir, release } from "node:os";
import { join } from "node:path";
import { meetsMinimumVersion } from "./version.js";

/** The machine `apex doctor` inspects. Injected in tests; defaults to the running process. */
export interface HostEnvironment {
  readonly platform: NodeJS.Platform;
  /** Kernel release, as `os.release()` reports it; distinguishes WSL1 from WSL2. */
  readonly release: string;
  readonly env: NodeJS.ProcessEnv;
  readonly homedir: string;
}

/**
 * DECISION-033 hosts. The host decides the client: native Windows (and best-effort macOS) runs VS Code with the Copilot
 * harness or the GitHub Copilot app; Linux and WSL2 run Copilot CLI. Every workspace selects the `github-copilot-cli`
 * projection, so the projection cannot tell the clients apart; the host can.
 */
export type HostKind = "windows" | "macos" | "wsl2" | "linux" | "wsl1" | "unsupported";

export interface HostCheck {
  id: string;
  ok: boolean;
  value: string;
  remedy?: string;
  /** Present only on advisory checks that pass but report something the user should know. */
  severity?: "warning";
}

export interface HostCheckInputs {
  host: HostEnvironment;
  minimums: { vscode?: string | undefined; copilotCli?: string | undefined };
  plugin: { name: string; marketplace: string };
  apexVersion: string;
  executableExists: (executable: string) => Promise<boolean>;
  /** First stable `major.minor.patch` the executable reports for `args`, or undefined when it cannot be read. */
  toolVersion: (executable: string, args: readonly string[]) => Promise<string | undefined>;
}

const MAX_COPILOT_CONFIG_BYTES = 1024 * 1024;
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function currentHostEnvironment(): HostEnvironment {
  return { platform: process.platform, release: release(), env: process.env, homedir: homedir() };
}

export function detectHostKind(host: HostEnvironment): HostKind {
  if (host.platform === "win32") return "windows";
  if (host.platform === "darwin") return "macos";
  if (host.platform !== "linux") return "unsupported";
  // WSL2 kernels report `-microsoft-standard[-WSL2]`; WSL1 reports `-Microsoft` without `standard`.
  if (/microsoft-standard|wsl2/iu.test(host.release)) return "wsl2";
  if (/microsoft/iu.test(host.release)) return "wsl1";
  return "linux";
}

/** Hosts whose supported client is Copilot CLI; VS Code there is not an APEX client. */
export function isCopilotCliHost(kind: HostKind): boolean {
  return kind === "wsl2" || kind === "linux" || kind === "wsl1";
}

/** Extracts the first stable release version from tool output such as `GitHub Copilot CLI 1.0.93.`. */
export function firstReleaseVersion(output: string): string | undefined {
  for (const match of output.matchAll(/(?<![\d.])(\d+\.\d+\.\d+)(?![\d-])/gu))
    if (RELEASE_VERSION.test(match[1]!)) return match[1];
  return undefined;
}

export function copilotHome(host: HostEnvironment): string {
  const configured = host.env.COPILOT_HOME?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  return join(host.homedir, ".copilot");
}

function hostCheck(kind: HostKind): HostCheck {
  const sandbox = "client local sandboxing is assumed on and not checked";
  switch (kind) {
    case "windows":
      return {
        id: "host",
        ok: true,
        value: `windows: VS Code Copilot harness or GitHub Copilot app; Copilot CLI manages the plugin store only; ${sandbox}`,
      };
    case "wsl2":
      return { id: "host", ok: true, value: `wsl2: GitHub Copilot CLI; ${sandbox}` };
    case "linux":
      return { id: "host", ok: true, value: `linux: GitHub Copilot CLI; ${sandbox}` };
    case "macos":
      return {
        id: "host",
        ok: true,
        severity: "warning",
        value: "macos: VS Code or the GitHub Copilot app, best effort and not qualified",
        remedy: "Use Windows 11 for VS Code or the GitHub Copilot app, or Linux or WSL2 for Copilot CLI",
      };
    case "wsl1":
      return {
        id: "host",
        ok: false,
        value: "wsl1: unsupported; the Copilot CLI sandbox needs WSL2",
        remedy: "Use a WSL2 distribution: run wsl --set-version DISTRIBUTION 2 in PowerShell after a backup",
      };
    case "unsupported":
      return {
        id: "host",
        ok: false,
        value: "unsupported platform",
        remedy: "Use Windows 11 for VS Code or the GitHub Copilot app, or Linux or WSL2 for Copilot CLI",
      };
  }
}

async function gitCheck(kind: HostKind, inputs: HostCheckInputs): Promise<HostCheck> {
  const found = await inputs.executableExists("git");
  return {
    id: "git",
    ok: found,
    value: found ? "found on PATH" : "not found on PATH",
    remedy:
      kind === "windows"
        ? "Install Git with winget install Git.Git, then open a new terminal"
        : kind === "macos"
          ? "Install Git and add it to PATH"
          : "Install Git with sudo apt install git",
  };
}

async function vscodeCheck(kind: HostKind, inputs: HostCheckInputs): Promise<HostCheck> {
  // On WSL2 `code` is usually the Windows VS Code shim, and running it can start a VS Code Server install. Copilot CLI
  // hosts never use VS Code, so doctor does not run it there.
  if (isCopilotCliHost(kind))
    return {
      id: "vscode",
      ok: true,
      value: (await inputs.executableExists("code"))
        ? "skipped: the Copilot CLI host does not use VS Code"
        : "not needed: the Copilot CLI host does not use VS Code",
    };
  const minimum = inputs.minimums.vscode;
  if (minimum === undefined)
    return {
      id: "vscode",
      ok: false,
      value: "bundled VS Code minimum unavailable",
      remedy: "Reinstall the apex CLI package",
    };
  if (!(await inputs.executableExists("code")))
    return { id: "vscode", ok: true, value: `not found; ${minimum} or newer needed only for the VS Code harness` };
  const version = await inputs.toolVersion("code", ["--version"]);
  return {
    id: "vscode",
    ok: version !== undefined && meetsMinimumVersion(version, minimum),
    value: version ?? "version unavailable from code --version",
    remedy: `Update VS Code to ${minimum} or newer to use the Copilot harness`,
  };
}

async function copilotCliCheck(kind: HostKind, inputs: HostCheckInputs): Promise<HostCheck> {
  const minimum = inputs.minimums.copilotCli;
  if (minimum === undefined)
    return {
      id: "copilot-cli",
      ok: false,
      value: "bundled Copilot CLI minimum unavailable",
      remedy: "Reinstall the apex CLI package",
    };
  const sessionClient = isCopilotCliHost(kind);
  const install =
    kind === "windows"
      ? `Install Copilot CLI ${minimum} or newer with winget install GitHub.Copilot`
      : `Install Copilot CLI ${minimum} or newer with npm install -g @github/copilot, then run copilot login`;
  const advisory = (value: string, remedy: string): HostCheck =>
    sessionClient
      ? { id: "copilot-cli", ok: false, value, remedy }
      : { id: "copilot-cli", ok: true, severity: "warning", value: `${value}; needed to install the plugin`, remedy };
  if (!(await inputs.executableExists("copilot"))) return advisory("not found on PATH", install);
  const version = await inputs.toolVersion("copilot", ["--no-auto-update", "--version"]);
  if (version === undefined) return advisory("version unavailable from copilot --version", install);
  if (!meetsMinimumVersion(version, minimum))
    return advisory(version, `Update Copilot CLI to ${minimum} or newer with copilot update`);
  return {
    id: "copilot-cli",
    ok: true,
    value: sessionClient ? version : `${version}; manages the plugin store only, run APEX in VS Code or the app`,
  };
}

interface InstalledPluginRecord {
  name?: unknown;
  marketplace?: unknown;
  version?: unknown;
  enabled?: unknown;
}

async function readInstalledPlugins(path: string): Promise<InstalledPluginRecord[] | "missing" | "invalid"> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_COPILOT_CONFIG_BYTES) return "invalid";
    // Copilot CLI writes config.json with leading `//` comment lines.
    const config = JSON.parse((await readFile(path, "utf8")).replace(/^\s*\/\/.*$/gmu, "")) as {
      installedPlugins?: unknown;
    } | null;
    if (config === null || typeof config !== "object" || Array.isArray(config)) return "invalid";
    if (config.installedPlugins === undefined) return [];
    if (!Array.isArray(config.installedPlugins)) return "invalid";
    return config.installedPlugins.filter(
      (entry): entry is InstalledPluginRecord => entry !== null && typeof entry === "object",
    );
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid";
  }
}

async function copilotPluginCheck(kind: HostKind, inputs: HostCheckInputs): Promise<HostCheck> {
  const { name, marketplace } = inputs.plugin;
  const qualified = `${name}@${marketplace}`;
  const home = copilotHome(inputs.host);
  const configPath = join(home, "config.json");
  const reinstall =
    kind === "windows"
      ? `Close every VS Code window, then run copilot plugin uninstall ${qualified} and copilot plugin install ${qualified}`
      : `Run copilot plugin uninstall ${qualified}, then copilot plugin install ${qualified}`;
  const installed = await readInstalledPlugins(configPath);
  if (installed === "invalid")
    return {
      id: "copilot-plugin",
      ok: false,
      value: `unreadable Copilot CLI configuration ${configPath}`,
      remedy: "Run copilot plugin list to check the Copilot CLI configuration, then run doctor again",
    };
  const entries = installed === "missing" ? [] : installed.filter((entry) => entry.name === name);
  if (entries.length === 0) {
    // Copilot CLI installs the plugin that the workspace settings enable on the first trusted session; VS Code and
    // the app only read the store, so on those hosts the plugin must already be there.
    const missing = `not installed in the Copilot CLI plugin store ${home}`;
    return isCopilotCliHost(kind)
      ? {
          id: "copilot-plugin",
          ok: true,
          severity: "warning",
          value: missing,
          remedy: `Run copilot plugin install ${qualified}, or start copilot in the initialized workspace and trust it`,
        }
      : {
          id: "copilot-plugin",
          ok: false,
          value: missing,
          remedy: `${kind === "windows" ? "Close every VS Code window, then run" : "Run"} copilot plugin marketplace add jonathan-vella/apex-plugins and copilot plugin install ${qualified}`,
        };
  }
  if (entries.length > 1)
    return {
      id: "copilot-plugin",
      ok: false,
      value: `${entries.length} ${name} plugins installed in ${home}`,
      remedy: `Uninstall the extra copies so that only ${qualified} remains (copilot plugin list shows them)`,
    };
  const entry = entries[0]!;
  const version = typeof entry.version === "string" ? entry.version : "unknown";
  const source = typeof entry.marketplace === "string" && entry.marketplace.length > 0 ? entry.marketplace : "direct";
  const label = `${name}@${source} ${version}`;
  // Workspace settings enable only the declared marketplace; a direct install (no marketplace) is a local candidate.
  if (source !== "direct" && source !== marketplace)
    return {
      id: "copilot-plugin",
      ok: false,
      value: `${label} from another marketplace`,
      remedy: `Uninstall ${name}@${source}, then run copilot plugin install ${qualified}`,
    };
  if (entry.enabled !== true) return { id: "copilot-plugin", ok: false, value: `${label} disabled`, remedy: reinstall };
  if (version !== inputs.apexVersion)
    return {
      id: "copilot-plugin",
      ok: false,
      value: `${label}; this apex CLI is ${inputs.apexVersion}`,
      remedy: `Keep the plugin and CLI at one version: run copilot plugin update ${qualified}, or install @apexops/cli@${version}`,
    };
  return {
    id: "copilot-plugin",
    ok: true,
    value:
      kind === "windows"
        ? `${label} enabled in ${home}; VS Code must list one apex entry under @agentPlugins`
        : `${label} enabled in ${home}`,
  };
}

async function sandboxToolsCheck(inputs: HostCheckInputs): Promise<HostCheck> {
  const missing: string[] = [];
  for (const executable of ["bwrap", "slirp4netns"])
    if (!(await inputs.executableExists(executable))) missing.push(executable);
  return missing.length === 0
    ? { id: "linux-sandbox-tools", ok: true, value: "bwrap and slirp4netns found; sandbox setting not checked" }
    : {
        id: "linux-sandbox-tools",
        ok: true,
        severity: "warning",
        value: `missing ${missing.join(", ")}; the Copilot CLI sandbox needs them`,
        remedy: "Install them with sudo apt install bubblewrap slirp4netns; copilot help sandbox lists the rest",
      };
}

/** Read-only host checks for the supported client on this host. Each failing or advisory check carries a remedy. */
export async function hostDoctorChecks(inputs: HostCheckInputs): Promise<HostCheck[]> {
  const kind = detectHostKind(inputs.host);
  const checks = [
    hostCheck(kind),
    await gitCheck(kind, inputs),
    await vscodeCheck(kind, inputs),
    await copilotCliCheck(kind, inputs),
    await copilotPluginCheck(kind, inputs),
  ];
  if (kind === "linux" || kind === "wsl2") checks.push(await sandboxToolsCheck(inputs));
  return checks;
}
