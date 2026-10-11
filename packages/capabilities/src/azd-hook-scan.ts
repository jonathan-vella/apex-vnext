/**
 * Text analysis of azd hook commands and scripts. It finds the project files a hook loads (so they can be hashed) and
 * the constructs that pull in content the binding cannot see. It is a line-oriented scan, not a shell parser: whatever
 * it cannot classify with confidence fails closed, and interpreter-internal dynamic loading stays undetectable.
 */

export const HOOK_INTERPRETERS = ["sh", "bash", "zsh", "pwsh", "powershell", "cmd"] as const;
export type HookInterpreter = (typeof HOOK_INTERPRETERS)[number];

export interface HookReference {
  readonly via: "source" | "import-module" | "interpreter" | "exec";
  /** Literal operand as written, without surrounding quotes. */
  readonly token: string;
}

export interface HookScan {
  /** Constructs that load unbound or dynamic content, each named for the error message. */
  readonly violations: readonly string[];
  readonly references: readonly HookReference[];
}

const DOWNLOAD = String.raw`(?:curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)`;
const SHELL = String.raw`(?:sh|bash|zsh|dash|ksh|pwsh|powershell|iex|Invoke-Expression)`;
const CONSTRUCTS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    new RegExp(String.raw`\b${DOWNLOAD}\b[^\n]*\|\s*(?:sudo\s+)?${SHELL}\b`, "iu"),
    "piping downloaded content into a shell",
  ],
  [
    new RegExp(String.raw`(?:\$\(|\x60|<\()\s*${DOWNLOAD}\b`, "iu"),
    "executing downloaded content through command substitution",
  ],
  [/\b(?:iex|Invoke-Expression)\b/iu, "Invoke-Expression"],
  [/\b(?:Invoke-WebRequest|iwr)\b/iu, "Invoke-WebRequest"],
  [/(?:^|[;&|(\s])eval\b/u, "eval"],
  [/\b(?:pwsh|powershell)(?:\.exe)?\b[^\n]*\s-(?:e|ec|enc|encodedcommand)\b/iu, "an encoded PowerShell command"],
  [/\b(?:sh|bash|zsh|dash|ksh)\s+-c\s+["']?\$/u, "a shell command assembled from a variable or substitution"],
];

const SOURCE = /(?:^|[;&|(]|\bthen\b|\bdo\b|\belse\b)\s*(?:source|\.)\s+(\S+)/u;
const IMPORT_MODULE = /\bImport-Module\s+(?:-(?:Name|Force|Global)\s+)*(\S+)/iu;
// Words that run the next command, so `exec bash x.sh`, `sudo ./x.sh` and `FOO=1 sh x.sh` are still command positions.
const WRAPPERS = String.raw`(?:(?:exec|sudo|env|nohup|time|command|call|start)\s+|[A-Za-z_]\w*=\S*\s+)*`;
const EXEC = new RegExp(String.raw`(?:^|[;&|(]\s*|&&\s*)${WRAPPERS}(\.{1,2}\/[^\s;&|]+)`, "u");
const CALL_OPERATOR = /(?:^|[;|(])\s*&\s+(\S+)|(?:^|[;&|(]\s*)call\s+(\S+)/iu;
const INTERPRETER_LINE = new RegExp(
  String.raw`(?:^|[;&|(]\s*|&&\s*)${WRAPPERS}(sh|bash|zsh|dash|ksh|pwsh|powershell|cmd)(?:\.exe)?\s+(.+)$`,
  "iu",
);
const VALUE_FLAGS = new Set(["-executionpolicy", "-workingdirectory", "-configurationname", "-o", "-windowstyle"]);
const DYNAMIC = /[$\x60~*?{}()<>|&;]/u;

function unquote(token: string): string {
  return token.replace(/^["']|["']$/gu, "");
}

function isPathLike(token: string): boolean {
  return /[\\/]/u.test(token) || /\.(?:ps1|psm1|psd1|sh|bat|cmd)$/iu.test(token);
}

/** The script a `<interpreter> [flags] <script> [args]` line runs, `inline` for `-c` commands, or undefined. */
export function parseInterpreterCommand(line: string): { interpreter: string; operand: string } | "inline" | undefined {
  const match = INTERPRETER_LINE.exec(line.trim());
  if (match === null) return undefined;
  const interpreter = match[1]!.toLowerCase();
  const tokens = match[2]!.trim().split(/\s+/u);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const flag = token.toLowerCase();
    if (interpreter === "cmd") {
      if (flag === "/c" || flag === "/k") {
        const operand = tokens[index + 1];
        return operand !== undefined && isPathLike(unquote(operand))
          ? { interpreter, operand: unquote(operand) }
          : "inline";
      }
      if (token.startsWith("/")) continue;
      return undefined;
    }
    if (flag === "-c" || flag === "-command" || flag === "-lc") return "inline";
    if (flag === "-file" || flag === "-f") {
      const operand = tokens[index + 1];
      return operand === undefined ? undefined : { interpreter, operand: unquote(operand) };
    }
    if (VALUE_FLAGS.has(flag)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    return { interpreter, operand: unquote(token) };
  }
  return undefined;
}

/** Whether a reference operand is a literal path rather than something resolved at run time. */
export function isLiteralOperand(token: string): boolean {
  return token.length > 0 && !DYNAMIC.test(token) && !/^[a-z][a-z0-9+.-]*:\/\//iu.test(token);
}

export function scanHookText(text: string): HookScan {
  const violations = new Set<string>();
  const references: HookReference[] = [];
  const reference = (via: HookReference["via"], raw: string): void => {
    const token = unquote(raw);
    if (via === "import-module" && !isPathLike(token) && !token.includes("$")) return;
    if (!isLiteralOperand(token))
      violations.add(
        `${via === "source" ? "sourcing" : via === "import-module" ? "importing" : "running"} a dynamic or remote path (${via})`,
      );
    else references.push({ via, token });
  };
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    for (const [pattern, name] of CONSTRUCTS) if (pattern.test(line)) violations.add(name);
    const source = SOURCE.exec(line);
    if (source !== null) reference("source", source[1]!);
    const imported = IMPORT_MODULE.exec(line);
    if (imported !== null) reference("import-module", imported[1]!);
    const called = CALL_OPERATOR.exec(line);
    const callee = called === null ? undefined : unquote(called[1] ?? called[2]!);
    if (callee !== undefined && (callee.includes("$") || isPathLike(callee))) reference("exec", callee);
    const direct = EXEC.exec(line);
    if (direct !== null) reference("exec", direct[1]!);
    const interpreted = parseInterpreterCommand(line);
    if (interpreted !== undefined && interpreted !== "inline") reference("interpreter", interpreted.operand);
  }
  return { violations: [...violations].sort(), references };
}
