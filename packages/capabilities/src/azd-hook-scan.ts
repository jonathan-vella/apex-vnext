/**
 * Shell-aware analysis of azd hook commands and scripts. Each text is split into command segments (POSIX shell,
 * PowerShell and cmd flavours), and every segment is classified: the project files it runs, sources or imports are
 * reported so they can be hashed, and constructs that load content the binding cannot see are named as violations.
 * Syntax the lexer cannot tokenize unambiguously is reported as unsupported, so the caller fails closed. The lexer is
 * a single linear pass; nesting, steps and tokens are bounded.
 *
 * It is still a static approximation: what an interpreter loads internally (Python imports, PowerShell module
 * autoloading, functions or aliases assembled at run time) is outside what it can see.
 */

export const HOOK_INTERPRETERS = ["sh", "bash", "zsh", "pwsh", "powershell", "cmd"] as const;
export type HookInterpreter = (typeof HOOK_INTERPRETERS)[number];
export type HookFlavour = "posix" | "powershell" | "cmd";

export interface HookLoad {
  readonly via: "source" | "import-module" | "interpreter" | "exec";
  /** Literal operand as written, quotes removed. */
  readonly token: string;
  /** True when the token is resolved against the current directory rather than an absolute path. */
  readonly relative: boolean;
  /** A bare cmd command name that only counts when a project file with one of `extensions` exists. */
  readonly optional: boolean;
  readonly extensions: readonly string[];
}

/** A file the text creates or changes; one that is also run or sourced would escape its hash. */
export interface HookWrite {
  readonly token: string;
  /** The target is resolved at run time or relative to a changed working directory. */
  readonly dynamic: boolean;
}

export interface HookAnalysis {
  /** Constructs that load unbound or dynamic content, each named for the error message. */
  readonly violations: readonly string[];
  /** Syntax the lexer cannot tokenize unambiguously. */
  readonly unsupported: readonly string[];
  /** Files the text runs, sources or imports, in order of appearance. */
  readonly loads: readonly HookLoad[];
  /** Files the text writes, and writes whose target cannot be named. */
  readonly writes: readonly HookWrite[];
  /** The text changes the working directory, which persists into a caller that sources it. */
  readonly changesDirectory: boolean;
  /** Set when the whole text is one `<interpreter> <script> [args]` command with a literal script path. */
  readonly sole?: { readonly interpreter: HookInterpreter; readonly operand: string };
}

const MAX_DEPTH = 12;
const MAX_STEPS = 4_000_000;
// Shell scripts are analyzed; the other languages are hashed but their imports are not followed.
const SCRIPT_EXTENSION =
  /\.(?:sh|bash|zsh|ksh|ps1|psm1|psd1|cmd|bat|py|js|mjs|cjs|rb|pl|php|ts|vbs|vbe|wsf|jse|hta)$/iu;
const TASK_RUNNERS = new Set(["make", "gmake", "npx", "bunx"]);
const PACKAGE_RUNNERS = new Set(["npm", "yarn", "pnpm", "bun"]);
const INLINE_LANGUAGES = new Set(["python", "python3", "node", "nodejs", "perl", "ruby", "php", "deno"]);
const INLINE_FLAGS = new Set(["-c", "-e", "-p", "-r", "-E", "--eval", "--print"]);
const AWK = new Set(["awk", "gawk", "mawk", "nawk"]);
const EXECUTES_PROJECT_CODE = new Set(["run", "run-script", "exec", "x", "start", "test", "dlx"]);
const FORBIDDEN_VARIABLES = new Set([
  "path",
  "bash_env",
  "env",
  "ifs",
  "cdpath",
  "ld_preload",
  "ld_library_path",
  "psmodulepath",
  "pathext",
  "comspec",
  "shellopts",
  "bashopts",
  "prompt_command",
]);
const WRAPPERS = new Set([
  "exec",
  "sudo",
  "doas",
  "env",
  "nohup",
  "command",
  "builtin",
  "timeout",
  "nice",
  "ionice",
  "setsid",
  "stdbuf",
  "xargs",
  "watch",
  "unbuffer",
  "chrt",
  "taskset",
  "find",
  "parallel",
  "su",
  "runuser",
  "script",
  "flock",
  "ssh",
]);
const SPECIAL_COMMANDS = new Set(["source", ".", "eval", "trap"]);
const DOT_WRAPPERS = new Set(["command", "builtin", "exec", "env", "sudo", "doas", "nohup"]);
const CMD_BUILTINS = new Set([
  "echo",
  "rem",
  "setlocal",
  "endlocal",
  "goto",
  "exit",
  "title",
  "color",
  "pause",
  "type",
  "copy",
  "del",
  "erase",
  "dir",
  "md",
  "mkdir",
  "rd",
  "rmdir",
  "move",
  "ren",
  "rename",
  "cls",
  "ver",
  "vol",
  "assoc",
  "ftype",
  "mklink",
  "shift",
  "verify",
  "date",
  "time",
]);
const COMMAND_LINE_WRAPPERS = new Set(["env", "watch", "parallel", "sudo", "doas", "script", "flock", "ssh"]);
const STRICT_DYNAMIC_WRAPPERS = new Set(["exec", "command", "builtin", "nohup"]);
const DIRECTORY_COMMANDS = new Set([
  "cd",
  "chdir",
  "pushd",
  "popd",
  "sl",
  "set-location",
  "push-location",
  "pop-location",
]);
const POSIX_SKIPPED = new Set(["if", "then", "else", "elif", "while", "until", "do", "!", "time", "coproc"]);
const POSIX_ENDERS = new Set(["fi", "done", "esac", "in"]);
const PS_WRAPPERS = new Set(["start-process", "saps", "invoke-command", "icm", "start-job", "invoke-item", "ii"]);
const DOTNET_PROCESS =
  /(?:\[scriptblock\]::create|::start\b|add-type|\[reflection\.assembly\]|::load(?:from|file)?\b)/iu;
const PS_VALUE_FLAGS = new Set([
  "-executionpolicy",
  "-configurationfile",
  "-configurationname",
  "-version",
  "-windowstyle",
  "-inputformat",
  "-outputformat",
  "-settingsfile",
  "-custompipename",
]);

class ScanFailure extends Error {}

interface Word {
  readonly text: string;
  readonly dynamic: boolean;
  readonly quoted: boolean;
}

interface Command {
  readonly words: Word[];
  readonly piped: boolean;
  redirectIn?: Word;
  hereString?: Word;
  heredoc?: { readonly body: string; readonly dynamic: boolean };
  callOperator?: boolean;
  dotSource?: boolean;
  stdinDup?: boolean;
}

class Scan {
  readonly violations = new Set<string>();
  readonly unsupported = new Set<string>();
  readonly loads: HookLoad[] = [];
  readonly writes: HookWrite[] = [];
  cwdChanged = false;
  changesDirectory = false;
  commandCount = 0;
  sole: { interpreter: HookInterpreter; operand: string } | undefined;
  steps = 0;

  step(): void {
    if (++this.steps > MAX_STEPS) throw new ScanFailure("the text is too large to analyze");
  }
}

// A process substitution is a pipe, not a file, so it is not a write target.
const PROCESS_SUBSTITUTION = "<(...)";
const WRITE_IGNORED = /^(?:\/dev\/(?:null|stdout|stderr|tty)|nul|\$null|&?\d+|&?-)$/iu;

function addWrite(scan: Scan, word: Word | undefined): void {
  if (word === undefined || word.text === PROCESS_SUBSTITUTION) return;
  if (!word.dynamic && (WRITE_IGNORED.test(word.text) || word.text.startsWith("-"))) return;
  scan.writes.push({ token: word?.text ?? "", dynamic: word.dynamic || scan.cwdChanged });
}

const dynamicWrite = (scan: Scan): void => {
  scan.writes.push({ token: "", dynamic: true });
};

// Commands that create or change files. Destination commands name them as their last operand; the rest write
// wherever their arguments say, so every operand counts.
const WRITE_DESTINATION = new Set([
  "cp",
  "ln",
  "install",
  "rsync",
  "scp",
  "copy",
  "xcopy",
  "robocopy",
  "copy-item",
  "cpi",
]);
const WRITE_OPERANDS = new Set([
  "tee",
  "touch",
  "truncate",
  "mv",
  "move",
  "ren",
  "rename",
  "del",
  "erase",
  "rm",
  "rmdir",
  "sed",
  "perl",
  "ed",
  "set-content",
  "sc",
  "add-content",
  "ac",
  "out-file",
  "tee-object",
  "new-item",
  "ni",
  "move-item",
  "mi",
  "remove-item",
  "ri",
  "rename-item",
  "rni",
  "clear-content",
  "clc",
  "mklink",
  "export-clixml",
  "export-csv",
  "start-transcript",
]);
// Commands that unpack, download or check out files whose names the scanner cannot know.
const WRITE_UNKNOWN = new Set([
  "tar",
  "unzip",
  "7z",
  "7za",
  "gunzip",
  "gzip",
  "bunzip2",
  "xz",
  "unxz",
  "patch",
  "expand",
  "expand-archive",
  "start-bitstransfer",
  "invoke-restmethod",
  "irm",
  "wget",
]);
const GIT_WRITES = new Set([
  "checkout",
  "clone",
  "pull",
  "reset",
  "apply",
  "am",
  "restore",
  "merge",
  "rebase",
  "stash",
  "switch",
  "cherry-pick",
  "revert",
  "submodule",
  "clean",
  "sparse-checkout",
  "worktree",
  "init",
]);

function recordWrites(scan: Scan, name: string, rest: readonly Word[]): void {
  const operands = rest.filter((word) => word.dynamic || !word.text.startsWith("-") || word.text === "-");
  if (WRITE_DESTINATION.has(name)) {
    const target = rest.findIndex((word) => /^(?:-t|--target-directory(?:=.*)?|-destination|-dest)$/iu.test(word.text));
    if (target >= 0 && rest[target + 1] !== undefined && !rest[target]!.text.includes("="))
      addWrite(scan, rest[target + 1]);
    else if (target >= 0)
      addWrite(scan, { text: rest[target]!.text.split("=")[1] ?? "", dynamic: false, quoted: false });
    addWrite(scan, operands[operands.length - 1]);
  } else if (WRITE_OPERANDS.has(name)) for (const word of operands) addWrite(scan, word);
  else if (WRITE_UNKNOWN.has(name)) dynamicWrite(scan);
  else if (name === "git" && rest.some((word) => GIT_WRITES.has(word.text))) dynamicWrite(scan);
  else if (name === "dd") {
    for (const word of rest) if (word.text.startsWith("of=")) addWrite(scan, { ...word, text: word.text.slice(3) });
  } else if (name === "curl") {
    for (const [index, word] of rest.entries()) {
      if (word.dynamic) continue;
      if (word.text === "-o" || word.text === "--output") addWrite(scan, rest[index + 1]);
      else if (word.text.startsWith("--output=")) addWrite(scan, { ...word, text: word.text.slice(9) });
      else if (/^-[A-Za-z]*[OJ]/u.test(word.text) || /^--(?:remote-name|remote-header-name)/u.test(word.text))
        dynamicWrite(scan);
    }
  }
  // Tools that write a named output file, wherever they appear on the command line.
  for (const [index, word] of rest.entries())
    if (
      /^--?(?:outfile|out-file|outdir|output-file|output-dir|out-dir|outputdirectory|outputpath|destination)$/iu.test(
        word.text,
      )
    )
      addWrite(scan, rest[index + 1]);
}

const fail = (message: string): never => {
  throw new ScanFailure(message);
};

function newCommand(piped: boolean): Command {
  return { words: [], piped };
}

function baseName(token: string): string {
  const segments = token.split(/[\\/]/u);
  return (segments[segments.length - 1] ?? token).toLowerCase().replace(/\.exe$/u, "");
}

// Other shells are analyzed like POSIX shells but cannot be the sole command of a typed script hook.
const EXTRA_SHELLS = new Set(["dash", "ash", "ksh", "mksh", "csh", "tcsh", "fish", "nu", "xonsh", "elvish", "yash"]);
const DATA_COMMANDS = new Set([
  "echo",
  "printf",
  "print",
  "logger",
  "true",
  "false",
  "write-host",
  "write-output",
  "write-verbose",
  "write-warning",
  "write-error",
  "write-information",
]);
// Loaders and installers that run code from places the scanner cannot see.
const UNFOLLOWABLE = new Set([
  "mshta",
  "regsvr32",
  "rundll32",
  "msiexec",
  "bitsadmin",
  "certutil",
  "installutil",
  "msbuild",
]);

const isShell = (token: string): boolean => interpreterOf(token) !== undefined || EXTRA_SHELLS.has(baseName(token));

function interpreterOf(token: string): HookInterpreter | undefined {
  const name = baseName(token);
  return (HOOK_INTERPRETERS as readonly string[]).includes(name) ? (name as HookInterpreter) : undefined;
}

const hasScriptExtension = (token: string): boolean => SCRIPT_EXTENSION.test(token);
const hasWildcard = (token: string): boolean => /[*?[\]]/u.test(token);
const isPathLike = (token: string): boolean =>
  !hasWildcard(token) && (/[\\/]/u.test(token) || hasScriptExtension(token));
const isAbsoluteLike = (token: string): boolean => /^(?:[\\/~$]|[A-Za-z]:)/u.test(token);
const isUrl = (token: string): boolean => /^[a-z][a-z0-9+.-]+:\/\//iu.test(token);

function flavourOf(interpreter: HookInterpreter): HookFlavour {
  return interpreter === "cmd"
    ? "cmd"
    : interpreter === "pwsh" || interpreter === "powershell"
      ? "powershell"
      : "posix";
}

/* ----------------------------------------------------------------------------------------------- POSIX lexer */

interface PendingHeredoc {
  readonly command: Command;
  readonly delimiter: string;
  readonly quoted: boolean;
  readonly strip: boolean;
}

interface WordState {
  has: boolean;
  text: string;
  dynamic: boolean;
  quoted: boolean;
  brace: boolean;
}

const freshWord = (): WordState => ({ has: false, text: "", dynamic: false, quoted: false, brace: false });

function findClose(src: string, start: number, open: string, close: string): number {
  let depth = 1;
  for (let index = start; index < src.length; index++) {
    const char = src[index]!;
    if (char === "\\") index += 1;
    else if (char === "'") {
      const end = src.indexOf("'", index + 1);
      if (end < 0) return -1;
      index = end;
    } else if (char === '"') {
      for (index += 1; index < src.length && src[index] !== '"'; index++) if (src[index] === "\\") index += 1;
      if (index >= src.length) return -1;
    } else if (char === open) depth += 1;
    else if (char === close && --depth === 0) return index;
  }
  return -1;
}

class PosixParser {
  index = 0;
  private word = freshWord();
  private command: Command = newCommand(false);
  private redirect: string | undefined;
  private groups = 0;
  private braces = 0;
  private readonly heredocs: PendingHeredoc[] = [];

  constructor(
    private readonly scan: Scan,
    private readonly src: string,
    private readonly commands: Command[],
    private readonly depth: number,
  ) {
    if (depth > MAX_DEPTH) fail("command substitutions or inline scripts are nested too deeply");
  }

  private literal(char: string, quoted: boolean): void {
    const word = this.word;
    word.has = true;
    word.text += char;
    if (quoted) {
      word.quoted = true;
      return;
    }
    if (char === "*" || char === "?" || char === "[") word.dynamic = true;
    if (char === "{") word.brace = true;
    if (char === "~" && word.text.length === 1) word.dynamic = true;
  }

  private finishWord(): void {
    const state = this.word;
    if (!state.has) return;
    this.word = freshWord();
    const testBracket = !state.quoted && (state.text === "[" || state.text === "[[");
    const word: Word = {
      text: state.text,
      dynamic: !testBracket && (state.dynamic || (state.brace && /,|\.\./u.test(state.text))),
      quoted: state.quoted,
    };
    if (this.redirect !== undefined) {
      this.applyRedirect(this.redirect, word);
      this.redirect = undefined;
      return;
    }
    if (this.command.words.length === 0 && !word.quoted && !word.dynamic) {
      if (word.text === "{") {
        this.braces += 1;
        return;
      }
      if (word.text === "}") {
        if (--this.braces < 0) fail("an unbalanced }");
        return;
      }
    }
    this.command.words.push(word);
  }

  private applyRedirect(kind: string, word: Word): void {
    if (kind === ">" || kind === ">>" || kind === ">|" || kind === ">&") addWrite(this.scan, word);
    if (kind === "<") this.command.redirectIn = word;
    else if (kind === "<<<") this.command.hereString = word;
    else if (kind === "<<" || kind === "<<-") {
      if (word.dynamic) fail("a here-document delimiter resolved at run time");
      this.heredocs.push({ command: this.command, delimiter: word.text, quoted: word.quoted, strip: kind === "<<-" });
    }
  }

  private endCommand(pipeNext: boolean): void {
    this.finishWord();
    if (this.redirect !== undefined) fail("a redirection without a target");
    if (this.command.words.length > 0) this.commands.push(this.command);
    this.command = newCommand(pipeNext);
  }

  private readHeredocs(): void {
    for (const pending of this.heredocs.splice(0)) {
      const lines: string[] = [];
      for (;;) {
        if (this.index >= this.src.length) fail("an unterminated here-document");
        const end = this.src.indexOf("\n", this.index);
        const stop = end < 0 ? this.src.length : end;
        const line = this.src.slice(this.index, stop);
        this.index = Math.min(stop + 1, this.src.length);
        if ((pending.strip ? line.replace(/^\t+/u, "") : line) === pending.delimiter) break;
        lines.push(line);
        this.scan.step();
      }
      const body = lines.join("\n");
      if (!pending.quoted) new PosixParser(this.scan, body, this.commands, this.depth + 1).scanExpansions();
      pending.command.heredoc = { body, dynamic: !pending.quoted && /[$`]/u.test(body) };
    }
  }

  /** Walks text that the shell would expand (here-document bodies, arithmetic) only to find substitutions. */
  scanExpansions(): void {
    while (this.index < this.src.length) {
      this.scan.step();
      const char = this.src[this.index]!;
      if (char === "\\") this.index += 2;
      else if (char === "$") this.dollar(true);
      else if (char === "`") this.backtick();
      else this.index += 1;
    }
  }

  private nestedParser(): PosixParser {
    const nested = new PosixParser(this.scan, this.src, this.commands, this.depth + 1);
    nested.index = this.index;
    return nested;
  }

  private dollar(inDouble: boolean): void {
    const next = this.src[this.index + 1];
    this.word.has = true;
    if (next === "(") {
      if (this.src[this.index + 2] === "(") {
        const close = findClose(this.src, this.index + 3, "(", ")");
        if (close < 0 || this.src[close + 1] !== ")") fail("an unterminated or ambiguous $(( expression");
        new PosixParser(
          this.scan,
          this.src.slice(this.index + 3, close),
          this.commands,
          this.depth + 1,
        ).scanExpansions();
        this.index = close + 2;
      } else {
        this.index += 2;
        const nested = this.nestedParser();
        nested.parse(true);
        this.index = nested.index;
      }
      this.word.dynamic = true;
    } else if (next === "{") {
      const close = findClose(this.src, this.index + 2, "{", "}");
      if (close < 0) fail("an unterminated ${ expansion");
      new PosixParser(this.scan, this.src.slice(this.index + 2, close), this.commands, this.depth + 1).scanExpansions();
      this.index = close + 1;
      this.word.dynamic = true;
    } else if (next === "'" && !inDouble) {
      let end = this.index + 2;
      while (end < this.src.length && this.src[end] !== "'") end += this.src[end] === "\\" ? 2 : 1;
      if (end >= this.src.length) fail("an unterminated $'...' string");
      this.index = end + 1;
      this.word.dynamic = true;
    } else if (next === '"' && !inDouble) {
      this.index += 1;
    } else if (next !== undefined && /[A-Za-z_0-9@*#?$!-]/u.test(next)) {
      this.index += 2;
      if (/[A-Za-z_]/u.test(next)) while (/[A-Za-z_0-9]/u.test(this.src[this.index] ?? "")) this.index += 1;
      this.word.dynamic = true;
    } else {
      this.literal("$", inDouble);
      this.index += 1;
    }
  }

  private backtick(): void {
    let end = this.index + 1;
    while (end < this.src.length && this.src[end] !== "`") end += this.src[end] === "\\" ? 2 : 1;
    if (end >= this.src.length) fail("an unterminated backtick substitution");
    const inner = this.src.slice(this.index + 1, end).replace(/\\([`\\$])/gu, "$1");
    new PosixParser(this.scan, inner, this.commands, this.depth + 1).parse(false);
    this.index = end + 1;
    this.word.has = true;
    this.word.dynamic = true;
  }

  private doubleQuoted(): void {
    this.word.has = true;
    this.word.quoted = true;
    this.index += 1;
    for (;;) {
      this.scan.step();
      const char = this.src[this.index];
      if (char === undefined) fail("an unterminated double quote");
      if (char === '"') {
        this.index += 1;
        return;
      }
      if (char === "\\") {
        const next = this.src[this.index + 1];
        if (next === undefined) fail("an unterminated double quote");
        if (next === "\n") this.index += 2;
        else if (next === "$" || next === "`" || next === '"' || next === "\\") {
          this.literal(next, true);
          this.index += 2;
        } else {
          this.literal("\\", true);
          this.index += 1;
        }
      } else if (char === "$") this.dollar(true);
      else if (char === "`") this.backtick();
      else {
        this.literal(char!, true);
        this.index += 1;
      }
    }
  }

  parse(nested: boolean): void {
    const { src } = this;
    while (this.index < src.length) {
      this.scan.step();
      const char = src[this.index]!;
      const next = src[this.index + 1];
      switch (char) {
        case " ":
        case "\t":
          this.finishWord();
          this.index += 1;
          break;
        case "\n":
          this.endCommand(false);
          this.index += 1;
          if (this.heredocs.length > 0) this.readHeredocs();
          break;
        case "\\":
          if (next === undefined) fail("a trailing backslash");
          if (next !== "\n") this.literal(next!, true);
          this.index += 2;
          break;
        case "'": {
          const end = src.indexOf("'", this.index + 1);
          if (end < 0) fail("an unterminated single quote");
          this.word.has = true;
          this.word.quoted = true;
          this.word.text += src.slice(this.index + 1, end);
          this.index = end + 1;
          break;
        }
        case '"':
          this.doubleQuoted();
          break;
        case "`":
          this.backtick();
          break;
        case "$":
          this.dollar(false);
          break;
        case "#":
          if (this.word.has) {
            this.literal(char, false);
            this.index += 1;
          } else {
            const end = src.indexOf("\n", this.index);
            this.index = end < 0 ? src.length : end;
          }
          break;
        case ";":
          if (next === ";" || next === "&") fail("case statements");
          this.endCommand(false);
          this.index += 1;
          break;
        case "&":
          if (next === ">") {
            this.finishWord();
            this.redirect = ">";
            this.index += src[this.index + 2] === ">" ? 3 : 2;
          } else {
            this.endCommand(false);
            this.index += next === "&" ? 2 : 1;
          }
          break;
        case "|":
          this.endCommand(next !== "|");
          this.index += next === "|" || next === "&" ? 2 : 1;
          break;
        case "(":
          this.openParenthesis(next);
          break;
        case ")":
          if (nested && this.groups === 0) {
            this.endCommand(false);
            this.index += 1;
            return;
          }
          if (this.groups === 0) fail("an unbalanced )");
          this.groups -= 1;
          this.endCommand(false);
          this.index += 1;
          break;
        case "<":
        case ">":
          this.redirection(char, next);
          break;
        default:
          this.literal(char, false);
          this.index += 1;
      }
    }
    if (nested) fail("an unterminated command substitution");
    this.endCommand(false);
    if (this.heredocs.length > 0) fail("a here-document without a body");
    if (this.groups > 0 || this.braces > 0) fail("an unbalanced ( or {");
  }

  private openParenthesis(next: string | undefined): void {
    if (!this.word.has && this.command.words.length === 0) {
      if (next === "(") {
        const close = findClose(this.src, this.index + 2, "(", ")");
        if (close < 0 || this.src[close + 1] !== ")") fail("an unterminated or ambiguous (( expression");
        new PosixParser(
          this.scan,
          this.src.slice(this.index + 2, close),
          this.commands,
          this.depth + 1,
        ).scanExpansions();
        this.index = close + 2;
        return;
      }
      this.groups += 1;
      this.index += 1;
      return;
    }
    const after = /^\s*\)/u.exec(this.src.slice(this.index + 1, this.index + 64));
    if (this.word.has && after !== null && this.command.words.length === 0) {
      this.word = freshWord();
      this.index += 1 + after[0].length;
      return;
    }
    fail("an unsupported parenthesis");
  }

  private redirection(char: string, next: string | undefined): void {
    if (next === "(") {
      this.index += 2;
      const nested = this.nestedParser();
      nested.parse(true);
      this.index = nested.index;
      this.word.has = true;
      this.word.dynamic = true;
      this.word.text += PROCESS_SUBSTITUTION;
      return;
    }
    if (this.word.has && /^\d+$/u.test(this.word.text) && !this.word.quoted && !this.word.dynamic)
      this.word = freshWord();
    else this.finishWord();
    const rest = this.src.slice(this.index, this.index + 3);
    let operator: string;
    if (char === "<") {
      operator = rest.startsWith("<<<")
        ? "<<<"
        : rest.startsWith("<<-")
          ? "<<-"
          : rest.startsWith("<<")
            ? "<<"
            : rest.startsWith("<&")
              ? "<&"
              : rest.startsWith("<>")
                ? "<>"
                : "<";
    } else {
      operator = rest.startsWith(">>") ? ">>" : rest.startsWith(">&") ? ">&" : rest.startsWith(">|") ? ">|" : ">";
    }
    if (this.redirect !== undefined) fail("a redirection without a target");
    this.redirect = operator;
    if (operator === "<&" || operator === "<>") this.command.stdinDup = true;
    this.index += operator.length;
  }
}

/* -------------------------------------------------------------------------------------------- PowerShell lexer */

class PowerShellParser {
  index = 0;
  private word = freshWord();
  private command: Command = newCommand(false);
  private redirect = false;

  constructor(
    private readonly scan: Scan,
    private readonly src: string,
    private readonly commands: Command[],
    private readonly depth: number,
  ) {
    if (depth > MAX_DEPTH) fail("subexpressions or inline scripts are nested too deeply");
  }

  private finishWord(): void {
    const state = this.word;
    if (!state.has) return;
    this.word = freshWord();
    const word: Word = { text: state.text, dynamic: state.dynamic, quoted: state.quoted };
    if (this.redirect) {
      this.redirect = false;
      addWrite(this.scan, word);
      return;
    }
    if (this.command.words.length === 0 && !word.quoted && !word.dynamic) {
      if (word.text === "&") {
        this.command.callOperator = true;
        return;
      }
      if (word.text === ".") {
        this.command.dotSource = true;
        return;
      }
    }
    this.command.words.push(word);
  }

  private endCommand(pipeNext: boolean): void {
    this.finishWord();
    if (this.redirect) fail("a redirection without a target");
    const { command } = this;
    if (command.words.length > 0 || command.callOperator === true || command.dotSource === true)
      this.commands.push(command);
    this.command = newCommand(pipeNext);
  }

  private nested(terminator: ")" | "}"): void {
    const parser = new PowerShellParser(this.scan, this.src, this.commands, this.depth + 1);
    parser.index = this.index;
    parser.parse(terminator);
    this.index = parser.index;
    this.word.has = true;
    // A script block runs the commands scanned inside it; a parenthesized expression yields a value known only at run time.
    if (terminator === ")") this.word.dynamic = true;
  }

  private doubleQuoted(): void {
    this.word.has = true;
    this.word.quoted = true;
    this.index += 1;
    for (;;) {
      this.scan.step();
      const char = this.src[this.index];
      if (char === undefined) fail("an unterminated double quote");
      if (char === '"') {
        if (this.src[this.index + 1] === '"') {
          this.word.text += '"';
          this.index += 2;
          continue;
        }
        this.index += 1;
        return;
      }
      if (char === "`") {
        if (this.src[this.index + 1] === undefined) fail("an unterminated double quote");
        this.word.text += this.src[this.index + 1]!;
        this.index += 2;
      } else if (char === "$" && this.src[this.index + 1] === "(") {
        this.index += 2;
        this.nested(")");
      } else if (char === "$") this.variable();
      else {
        this.word.text += char;
        this.index += 1;
      }
    }
  }

  private variable(): void {
    this.word.has = true;
    this.word.dynamic = true;
    const start = this.index;
    if (this.src[this.index + 1] === "{") {
      const close = this.src.indexOf("}", this.index + 2);
      if (close < 0) fail("an unterminated ${ variable");
      this.index = close + 1;
    } else {
      this.index += 1;
      while (/[A-Za-z0-9_:?]/u.test(this.src[this.index] ?? "")) this.index += 1;
    }
    // Keep the variable name so assignments to $env:PATH and similar can be recognized.
    this.word.text += this.src.slice(start, this.index);
  }

  private hereString(quote: string): void {
    const start = this.src.indexOf("\n", this.index);
    if (start < 0 || this.src.slice(this.index + 2, start).trim().length > 0) fail("a malformed here-string");
    const terminator = `\n${quote}@`;
    const end = this.src.indexOf(terminator, start);
    if (end < 0) fail("an unterminated here-string");
    const body = this.src.slice(start + 1, end);
    if (quote === '"') new PosixParser(this.scan, body, this.commands, this.depth + 1).scanExpansions();
    this.word.has = true;
    this.word.quoted = true;
    this.word.text += body;
    this.word.dynamic ||= quote === '"' && body.includes("$");
    this.index = end + terminator.length;
  }

  parse(terminator: ")" | "}" | undefined): void {
    const { src } = this;
    while (this.index < src.length) {
      this.scan.step();
      const char = src[this.index]!;
      const next = src[this.index + 1];
      switch (char) {
        case " ":
        case "\t":
          this.finishWord();
          this.index += 1;
          break;
        case "\n":
        case ";":
          this.endCommand(false);
          this.index += 1;
          break;
        case "|":
          this.endCommand(next !== "|");
          this.index += next === "|" ? 2 : 1;
          break;
        case "&":
          if (next === "&") {
            this.endCommand(false);
            this.index += 2;
          } else {
            this.finishWord();
            this.word = { ...freshWord(), has: true, text: "&" };
            this.index += 1;
            this.finishWord();
          }
          break;
        case "#":
          if (this.word.has) {
            this.word.text += char;
            this.index += 1;
          } else {
            const end = src.indexOf("\n", this.index);
            this.index = end < 0 ? src.length : end;
          }
          break;
        case "<":
          if (next === "#" && !this.word.has) {
            const end = src.indexOf("#>", this.index + 2);
            if (end < 0) fail("an unterminated block comment");
            this.index = end + 2;
          } else {
            this.word.has = true;
            this.word.text += char;
            this.index += 1;
          }
          break;
        case "`":
          if (next === undefined) fail("a trailing backtick");
          if (next !== "\n") {
            this.word.has = true;
            this.word.quoted = true;
            this.word.text += next;
          }
          this.index += 2;
          break;
        case "'": {
          this.word.has = true;
          this.word.quoted = true;
          this.index += 1;
          for (;;) {
            const quote = src.indexOf("'", this.index);
            if (quote < 0) fail("an unterminated single quote");
            this.word.text += src.slice(this.index, quote);
            this.index = quote + 1;
            if (src[this.index] !== "'") break;
            this.word.text += "'";
            this.index += 1;
          }
          break;
        }
        case '"':
          this.doubleQuoted();
          break;
        case "$":
          if (next === "(") {
            this.index += 2;
            this.nested(")");
          } else this.variable();
          break;
        case "@":
          if (next === "(") {
            this.index += 2;
            this.nested(")");
          } else if (next === "{") {
            this.index += 2;
            this.nested("}");
          } else if (!this.word.has && (next === "'" || next === '"')) this.hereString(next);
          else {
            this.word.has = true;
            this.word.text += char;
            this.index += 1;
          }
          break;
        case "(":
          this.index += 1;
          this.nested(")");
          break;
        case "{":
          this.index += 1;
          this.nested("}");
          break;
        case ")":
        case "}":
          if (terminator === char) {
            this.endCommand(false);
            this.index += 1;
            return;
          }
          fail(`an unbalanced ${char}`);
          break;
        case ">":
          this.finishWord();
          this.redirect = true;
          this.index += next === ">" ? 2 : 1;
          if (src[this.index] === "&") this.index += 1;
          break;
        default:
          this.word.has = true;
          this.word.text += char;
          this.index += 1;
      }
    }
    if (terminator !== undefined) fail("an unterminated subexpression or script block");
    this.endCommand(false);
  }
}

/* ------------------------------------------------------------------------------------------------ cmd lexer */

function lexCmd(scan: Scan, src: string, commands: Command[]): void {
  let word = freshWord();
  let command = newCommand(false);
  let redirect: string | undefined;
  const finish = (): void => {
    if (!word.has) return;
    const done: Word = { text: word.text, dynamic: word.dynamic, quoted: word.quoted };
    word = freshWord();
    if (redirect !== undefined) {
      if (redirect === ">") addWrite(scan, done);
      redirect = undefined;
    } else command.words.push(done);
  };
  const end = (pipeNext: boolean): void => {
    finish();
    if (redirect !== undefined) fail("a redirection without a target");
    if (command.words.length > 0) commands.push(command);
    command = newCommand(pipeNext);
  };
  for (let index = 0; index < src.length; index++) {
    scan.step();
    const char = src[index]!;
    const next = src[index + 1];
    if (char === " " || char === "\t") finish();
    else if (char === "\n") end(false);
    else if (char === "&") {
      end(false);
      if (next === "&") index += 1;
    } else if (char === "|") {
      end(next !== "|");
      if (next === "|") index += 1;
    } else if (char === "(" || char === ")") end(false);
    else if (char === ">" || char === "<") {
      finish();
      redirect = char;
      if (next === char) index += 1;
      if (src[index + 1] === "&") index += 1;
    } else if (char === "^") {
      if (next === undefined) fail("a trailing ^");
      if (next !== "\n") {
        word.has = true;
        word.quoted = true;
        word.text += next;
      }
      index += 1;
    } else if (char === '"') {
      word.has = true;
      word.quoted = true;
      const close = src.indexOf('"', index + 1);
      if (close < 0) fail("an unterminated double quote");
      const body = src.slice(index + 1, close);
      word.text += body;
      if (body.includes("%")) word.dynamic = true;
      index = close;
    } else {
      word.has = true;
      word.text += char;
      if (char === "%") word.dynamic = true;
    }
  }
  end(false);
}

/* ------------------------------------------------------------------------------------------ classification */

function addLoad(
  scan: Scan,
  via: HookLoad["via"],
  word: Word,
  options: { requireDirectory?: boolean; optional?: boolean; extensions?: readonly string[] } = {},
): void {
  if (word.dynamic) {
    scan.violations.add(
      `a ${via === "interpreter" || via === "exec" ? "run" : via === "source" ? "source" : "import"} target resolved at run time`,
    );
    return;
  }
  const token = word.text;
  if (token.length === 0) return;
  if (options.requireDirectory === true && !/[\\/]/u.test(token)) {
    scan.violations.add(
      `${token.slice(0, 48)} loaded by bare name, which is searched in PATH (use ./${token.slice(0, 48)} or a project-relative path)`,
    );
    return;
  }
  if (isUrl(token)) {
    scan.violations.add(`a remote URL (${token.slice(0, 48)}) loaded as a script`);
    return;
  }
  const relative = !isAbsoluteLike(token);
  const bareCommand = options.optional === true && (options.extensions?.length ?? 0) > 0;
  if (scan.cwdChanged && relative && (options.optional !== true || bareCommand)) {
    scan.violations.add(`a relative path (${token.slice(0, 48)}) used after the working directory changed`);
    return;
  }
  scan.loads.push({ via, token, relative, optional: options.optional ?? false, extensions: options.extensions ?? [] });
}

function checkAssignment(scan: Scan, text: string): void {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/u.exec(text);
  if (match !== null && FORBIDDEN_VARIABLES.has(match[1]!.toLowerCase()))
    scan.violations.add(`assigning ${match[1]}, which changes how commands or scripts are resolved`);
}

function inline(scan: Scan, word: Word | undefined, flavour: HookFlavour, depth: number, context: string): void {
  if (word === undefined) return;
  if (word.dynamic) scan.violations.add(`${context} whose code is resolved at run time`);
  else analyzeUnit(scan, word.text, flavour, depth + 1);
}

function interpreterRun(
  scan: Scan,
  word: Word,
  following: readonly Word[],
  command: Command | undefined,
  depth: number,
  mode: "command" | "nested" | "lenient",
): void {
  const interpreter = interpreterOf(word.text);
  const family = interpreter === undefined ? "posix" : flavourOf(interpreter);
  let operand: Word | undefined;
  let inlineCode: Word | undefined;
  let inlineWords: Word[] | undefined;
  let readsStdin = false;
  let viaFile = false;
  for (let k = 0; k < following.length; k++) {
    const arg = following[k]!;
    const text = arg.text;
    const lower = text.toLowerCase();
    if (arg.dynamic) {
      operand = arg;
      break;
    }
    if (family === "posix") {
      if (text === "--") {
        operand = following[k + 1];
        break;
      }
      if (text === "--rcfile" || text === "--init-file") {
        const file = following[k + 1];
        if (file !== undefined) addLoad(scan, "source", file, { requireDirectory: true });
        k += 1;
        continue;
      }
      if (text.startsWith("--")) continue;
      if ((text.startsWith("-") || text.startsWith("+")) && text.length > 1) {
        const cluster = text.slice(1);
        if (cluster.includes("c")) {
          inlineCode = following[k + 1];
          break;
        }
        if (cluster.includes("s")) {
          readsStdin = true;
          break;
        }
        if (cluster.includes("o") || cluster.includes("O")) k += 1;
        continue;
      }
      operand = arg;
      break;
    }
    if (family === "powershell") {
      if (lower === "-encodedcommand" || lower === "-e" || lower === "-ec" || lower.startsWith("-enc")) {
        scan.violations.add("an encoded PowerShell command");
        return;
      }
      if (lower === "-file" || lower === "-f") {
        operand = following[k + 1];
        viaFile = true;
        break;
      }
      if (lower === "-command" || lower === "-c" || lower === "-commandwithargs" || lower === "-cwa") {
        inlineWords = following.slice(k + 1);
        break;
      }
      if (lower === "-workingdirectory" || lower === "-wd" || lower === "-workingdir") {
        scan.violations.add("a PowerShell working directory option");
        return;
      }
      if (lower === "-") {
        readsStdin = true;
        break;
      }
      if (PS_VALUE_FLAGS.has(lower)) {
        k += 1;
        continue;
      }
      if (lower.startsWith("-")) continue;
      operand = arg;
      break;
    }
    if (lower === "/c" || lower === "/k" || lower === "/r") {
      inlineWords = following.slice(k + 1);
      break;
    }
    if (lower.startsWith("/c") || lower.startsWith("/k")) {
      inlineWords = [{ text: text.slice(2), dynamic: false, quoted: false }, ...following.slice(k + 1)];
      break;
    }
  }
  if (mode === "lenient") {
    // Not at a command position: only act when the interpreter plainly runs code or a script file.
    const scriptLike = operand !== undefined && !operand.dynamic && hasScriptExtension(operand.text);
    if (inlineCode === undefined && inlineWords === undefined && !scriptLike) return;
  }
  if (inlineCode !== undefined) inline(scan, inlineCode, "posix", depth, "an inline shell command");
  else if (inlineWords !== undefined) {
    if (inlineWords.some((item) => item.dynamic))
      scan.violations.add("an inline command whose code is resolved at run time");
    else if (inlineWords.length > 0)
      analyzeUnit(scan, inlineWords.map((item) => item.text).join(" "), family, depth + 1);
  } else if (operand !== undefined) {
    const needsDirectory = (mode !== "lenient" && family === "posix") || (family === "powershell" && !viaFile);
    addLoad(scan, "interpreter", operand, needsDirectory ? { requireDirectory: true } : {});
    if (mode === "command" && interpreter !== undefined && !operand.dynamic && scan.sole === undefined)
      scan.sole = { interpreter, operand: operand.text };
  } else if (family !== "cmd" || readsStdin) {
    if (command?.heredoc !== undefined) {
      if (command.heredoc.dynamic)
        scan.violations.add("an interpreter running a here-document with run-time expansion");
      else analyzeUnit(scan, command.heredoc.body, family, depth + 1);
    } else if (command?.stdinDup === true)
      scan.violations.add("an interpreter reading a script from a file descriptor");
    else if (command?.hereString !== undefined)
      inline(scan, command.hereString, family, depth, "an interpreter reading a here-string");
    else if (command?.redirectIn !== undefined) addLoad(scan, "interpreter", command.redirectIn, {});
    else if (command?.piped === true && mode !== "lenient")
      scan.violations.add("an interpreter reading a script from a pipe");
    else if (mode !== "lenient" && !readsStdin && !following.some((arg) => /^-+(?:h|help|version)$/iu.test(arg.text)))
      scan.violations.add("an interpreter with no script operand, whose input comes from outside the hook");
  }
}

/** Whether a string argument reads as a command line that runs an interpreter or a project script. */
function looksLikeCommandLine(text: string): boolean {
  const first = text.trim().split(/\s+/u)[0] ?? "";
  return isShell(first) || /^\.{1,2}[\\/]/u.test(first) || (hasScriptExtension(first) && !first.includes("="));
}

function operandWords(
  scan: Scan,
  words: readonly Word[],
  command: Command,
  depth: number,
  flavour: HookFlavour = "posix",
  data = false,
): void {
  for (const [index, word] of words.entries()) {
    if (word.dynamic) continue;
    if (/\s/u.test(word.text) && !data && looksLikeCommandLine(word.text)) {
      analyzeUnit(scan, word.text, flavour, depth + 1);
      continue;
    }
    if (isShell(word.text)) {
      interpreterRun(scan, word, words.slice(index + 1), command, depth, "lenient");
      continue;
    }
    const tail = word.text.includes("=") ? word.text.slice(word.text.lastIndexOf("=") + 1) : word.text;
    const candidate = hasScriptExtension(word.text) ? word.text : hasScriptExtension(tail) ? tail : undefined;
    if (candidate !== undefined && !isUrl(candidate) && !hasWildcard(candidate) && !/\s/u.test(candidate))
      addLoad(
        scan,
        "exec",
        { text: candidate, dynamic: false, quoted: word.quoted },
        { optional: true, extensions: [] },
      );
  }
}

function wrapperRun(
  scan: Scan,
  name: string,
  rawWords: readonly Word[],
  command: Command,
  depth: number,
  flavour: HookFlavour,
): void {
  // PowerShell passes argument lists as comma-separated values, e.g. -ArgumentList '-File','x.ps1'.
  const allWords =
    flavour === "powershell"
      ? rawWords.flatMap((word) =>
          word.dynamic || !/[,\s]/u.test(word.text)
            ? [word]
            : word.text
                .split(/[,\s]+/u)
                .filter((part) => part.length > 0)
                .map((part) => ({ text: part, dynamic: false, quoted: word.quoted })),
        )
      : rawWords;
  // Option values (for example xargs -a FILE) are data, not the command to run.
  const words =
    name === "xargs"
      ? allWords.filter((_, index) => !/^-(?:a|I|n|L|P|d|E|s)$|^--arg-file$/u.test(allWords[index - 1]?.text ?? ""))
      : allWords;
  if (name === "env" || name === "sudo" || name === "doas") for (const word of words) checkAssignment(scan, word.text);
  for (const [index, word] of words.entries()) {
    if ((word.text === "-c" || word.text === "--command") && name !== "xargs" && words[index + 1] !== undefined) {
      inline(scan, words[index + 1], "posix", depth, "an inline shell command");
      return;
    }
  }
  const first = words.find(
    (word) =>
      !word.text.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word.text) && !/^[\d.]+[smhd]?$/u.test(word.text),
  );
  if (first?.dynamic === true && STRICT_DYNAMIC_WRAPPERS.has(name)) {
    scan.violations.add("a command resolved at run time");
    return;
  }
  const at = words.findIndex(
    (word) =>
      !word.dynamic &&
      !word.text.startsWith("-") &&
      !/\s/u.test(word.text) &&
      (isShell(word.text) ||
        isPathLike(word.text) ||
        WRAPPERS.has(baseName(word.text)) ||
        DIRECTORY_COMMANDS.has(word.text.toLowerCase()) ||
        (SPECIAL_COMMANDS.has(word.text) && (word.text !== "." || DOT_WRAPPERS.has(name))) ||
        TASK_RUNNERS.has(word.text) ||
        PACKAGE_RUNNERS.has(word.text) ||
        INLINE_LANGUAGES.has(word.text) ||
        AWK.has(word.text)),
  );
  if (at < 0) {
    // Wrappers such as env -S, watch and sudo -s take a whole command line as one string.
    if (COMMAND_LINE_WRAPPERS.has(name))
      for (const word of words)
        if (!word.dynamic && /\s/u.test(word.text)) analyzeUnit(scan, word.text, flavour, depth + 1);
    operandWords(scan, words, command, depth, flavour);
    return;
  }
  runCommand(scan, words[at]!, words.slice(at + 1), command, depth, flavour, "nested");
}

function runCommand(
  scan: Scan,
  word: Word,
  rest: readonly Word[],
  command: Command,
  depth: number,
  flavour: HookFlavour,
  mode: "command" | "nested",
): void {
  if (word.dynamic) {
    scan.violations.add("a command resolved at run time");
    return;
  }
  const name = word.text;
  const lower = baseName(name);
  const bare = !/[\\/]/u.test(name);
  if (isShell(name)) {
    interpreterRun(scan, word, rest, command, depth, mode);
    return;
  }
  if (DIRECTORY_COMMANDS.has(lower) && bare) {
    scan.cwdChanged = true;
    scan.changesDirectory = true;
    return;
  }
  if (flavour === "posix" && bare) {
    if (name === "source" || name === ".") {
      const operand = rest.find((item) => !item.text.startsWith("-") || item.dynamic);
      if (operand !== undefined) addLoad(scan, "source", operand, { requireDirectory: true });
      return;
    }
    if (name === "eval") {
      scan.violations.add("eval");
      return;
    }
    if (name === "alias") {
      scan.violations.add("alias definitions, which can hide the command that runs");
      return;
    }
    if (name === "trap") {
      const code = rest.find((item) => !item.text.startsWith("-"));
      if (code !== undefined && (code.dynamic || (code.text !== "" && code.text !== "-")))
        inline(scan, code, "posix", depth, "a trap");
      return;
    }
    if (["export", "declare", "typeset", "local", "readonly"].includes(name)) {
      for (const item of rest) checkAssignment(scan, item.text);
      return;
    }
  }
  if (WRAPPERS.has(lower) && (bare || /^(?:\/usr)?\/bin\/env$/u.test(name))) {
    wrapperRun(scan, lower, rest, command, depth, flavour);
    return;
  }
  if (bare && runsUnfollowableCode(scan, lower, rest)) return;
  recordWrites(scan, lower, rest);
  if (isPathLike(name)) addLoad(scan, "exec", word);
  operandWords(scan, rest, command, depth, flavour, DATA_COMMANDS.has(lower));
}

/** Commands that run project code or inline programs the scanner cannot follow; true when one was refused. */
function runsUnfollowableCode(scan: Scan, name: string, rest: readonly Word[]): boolean {
  if (UNFOLLOWABLE.has(name)) {
    scan.violations.add(`${name}, which runs code the scanner cannot follow`);
    return true;
  }
  if (TASK_RUNNERS.has(name)) {
    scan.violations.add(`a task runner (${name}) that executes project files the scanner cannot follow`);
    return true;
  }
  if (PACKAGE_RUNNERS.has(name) && rest.some((word) => EXECUTES_PROJECT_CODE.has(word.text))) {
    scan.violations.add(`a package runner (${name} run/exec) that executes project files the scanner cannot follow`);
    return true;
  }
  if (INLINE_LANGUAGES.has(name) && rest.some((word) => !word.dynamic && INLINE_FLAGS.has(word.text))) {
    scan.violations.add(`inline ${name} code, which the scanner cannot inspect`);
    return true;
  }
  if (AWK.has(name) && rest.some((word) => /system\s*\(/u.test(word.text))) {
    scan.violations.add("an awk program that runs commands");
    return true;
  }
  return false;
}

function classifyPosix(scan: Scan, command: Command, depth: number): void {
  const { words } = command;
  let index = 0;
  while (index < words.length && !words[index]!.quoted && /^[A-Za-z_][A-Za-z0-9_]*\+?=/u.test(words[index]!.text)) {
    checkAssignment(scan, words[index]!.text);
    index += 1;
  }
  const assigned = index > 0;
  while (
    index < words.length &&
    !words[index]!.dynamic &&
    !words[index]!.quoted &&
    POSIX_SKIPPED.has(words[index]!.text)
  )
    index += 1;
  const head = words[index];
  if (head === undefined) return;
  scan.commandCount += 1;
  if (!head.dynamic && !head.quoted) {
    if (POSIX_ENDERS.has(head.text) || head.text === "[[" || head.text === "[" || head.text === "test") return;
    if (head.text === "for" || head.text === "select") return;
    if (head.text === "case") {
      scan.unsupported.add("case statements");
      return;
    }
    if (head.text === "function") {
      index += 2;
      if (words[index] === undefined) return;
    }
  }
  const before = scan.sole;
  runCommand(scan, words[index]!, words.slice(index + 1), command, depth, "posix", "command");
  if ((assigned || index > 0) && before === undefined) scan.sole = undefined;
}

function classifyPowerShell(scan: Scan, command: Command, depth: number): void {
  const { words } = command;
  scan.commandCount += 1;
  for (const word of words)
    if (/currentdirectory/iu.test(word.text)) {
      scan.cwdChanged = true;
      scan.changesDirectory = true;
    }
  if (command.dotSource === true) {
    const operand = words[0];
    if (operand !== undefined) addLoad(scan, "source", operand, { requireDirectory: true });
    operandWords(scan, words.slice(1), command, depth);
    return;
  }
  const head = words[0];
  if (head === undefined) return;
  const rest = words.slice(1);
  if (words.some((word) => DOTNET_PROCESS.test(word.text))) {
    scan.violations.add(".NET process or dynamic-code APIs");
    return;
  }
  if (head.dynamic) {
    const assignment = rest[0] !== undefined && /^[+\-*/]?=$/u.test(rest[0].text);
    if (assignment) {
      if (/^\$env:(?:path|psmodulepath|comspec|pathext)$/iu.test(head.text))
        scan.violations.add("assigning a variable that changes how commands are resolved");
      // The right-hand side can itself run a command, for example $x = .\hooks\a.ps1.
      const value = rest.slice(1);
      const [first, ...others] = value;
      if (first !== undefined && (!first.dynamic || first.text === "&"))
        classifyPowerShell(scan, { ...command, words: [first, ...others], callOperator: first.text === "&" }, depth);
    } else if (
      command.callOperator === true ||
      (!head.quoted && (isPathLike(head.text) || hasScriptExtension(head.text)))
    )
      scan.violations.add("a command resolved at run time");
    return;
  }
  const lower = head.text.toLowerCase();
  if (lower === "iex" || lower === "invoke-expression") {
    scan.violations.add("Invoke-Expression");
    return;
  }
  if (lower === "invoke-webrequest" || lower === "iwr") {
    scan.violations.add("Invoke-WebRequest");
    return;
  }
  if (DIRECTORY_COMMANDS.has(lower)) {
    scan.cwdChanged = true;
    scan.changesDirectory = true;
    return;
  }
  if (lower === "import-module" || lower === "ipmo") {
    for (const word of rest) {
      if (word.text.startsWith("-") && !word.dynamic) continue;
      if (word.dynamic) scan.violations.add("an import target resolved at run time");
      else if (/[\\/]/u.test(word.text) || /\.(?:psm1|psd1|ps1|dll)$/iu.test(word.text))
        addLoad(scan, "import-module", word);
    }
    return;
  }
  if (
    lower === "using" &&
    rest[0] !== undefined &&
    /^(?:module|assembly)$/iu.test(rest[0].text) &&
    rest[1] !== undefined
  ) {
    if (rest[1].dynamic || /[\\/]/u.test(rest[1].text) || /\.(?:psm1|psd1|dll)$/iu.test(rest[1].text))
      addLoad(scan, "import-module", rest[1]);
    return;
  }
  if (isShell(head.text)) {
    interpreterRun(scan, head, rest, command, depth, "command");
    return;
  }
  if (PS_WRAPPERS.has(lower)) {
    wrapperRun(scan, lower, rest, command, depth, "powershell");
    return;
  }
  if (runsUnfollowableCode(scan, baseName(head.text), rest)) return;
  recordWrites(scan, baseName(head.text), rest);
  if (isPathLike(head.text)) addLoad(scan, "exec", head);
  operandWords(scan, rest, command, depth, "powershell", DATA_COMMANDS.has(lower));
}

function runCmdTarget(scan: Scan, word: Word, rest: readonly Word[], command: Command, depth: number): void {
  recordWrites(scan, baseName(word.text), rest);
  if (isShell(word.text)) interpreterRun(scan, word, rest, command, depth, "nested");
  else if (runsUnfollowableCode(scan, baseName(word.text), rest)) return;
  else if (isPathLike(word.text)) addLoad(scan, "exec", word);
  else addLoad(scan, "exec", word, { optional: true, extensions: [".cmd", ".bat"] });
  operandWords(scan, rest, command, depth, "cmd", DATA_COMMANDS.has(baseName(word.text)));
}

function classifyCmd(scan: Scan, command: Command, depth: number): void {
  const words = command.words
    .map((word) => (word.text.startsWith("@") && !word.quoted ? { ...word, text: word.text.slice(1) } : word))
    .filter((word) => word.text !== "" || word.dynamic);
  let index = 0;
  for (;;) {
    const word = words[index];
    if (word === undefined) return;
    const lower = word.text.toLowerCase();
    if (word.dynamic || word.quoted) break;
    if (lower === "else" || lower === "do") index += 1;
    else if (lower === "if") {
      index += 1;
      if (words[index]?.text.toLowerCase() === "/i") index += 1;
      if (words[index]?.text.toLowerCase() === "not") index += 1;
      const condition = words[index]?.text.toLowerCase();
      if (
        condition === "exist" ||
        condition === "defined" ||
        condition === "errorlevel" ||
        condition === "cmdextversion"
      )
        index += 2;
      else if (words[index + 1]?.text === "==") index += 3;
      else if (["equ", "neq", "lss", "leq", "gtr", "geq"].includes(words[index + 1]?.text.toLowerCase() ?? ""))
        index += 3;
      else index += 1;
    } else if (lower === "for") {
      const done = words.findIndex((item, at) => at > index && !item.dynamic && item.text.toLowerCase() === "do");
      if (done < 0) return;
      index = done + 1;
    } else break;
  }
  const head = words[index];
  if (head === undefined) return;
  scan.commandCount += 1;
  const rest = words.slice(index + 1);
  const lower = head.text.toLowerCase();
  if (head.dynamic) {
    scan.violations.add("a command resolved at run time");
    return;
  }
  if (DIRECTORY_COMMANDS.has(lower)) {
    scan.cwdChanged = true;
    scan.changesDirectory = true;
    return;
  }
  if (lower === "path") {
    scan.violations.add("assigning a variable that changes how commands are resolved");
    return;
  }
  if (CMD_BUILTINS.has(lower) || WRITE_DESTINATION.has(lower) || WRITE_OPERANDS.has(lower)) {
    recordWrites(
      scan,
      lower,
      rest.filter((word) => !word.text.startsWith("/") || word.quoted),
    );
    operandWords(scan, rest, command, depth);
    return;
  }
  if (lower === "set") {
    const assignment = rest[0]?.text ?? "";
    if (FORBIDDEN_VARIABLES.has(assignment.split("=")[0]!.toLowerCase()))
      scan.violations.add("assigning a variable that changes how commands are resolved");
    return;
  }
  if (lower === "call" || lower === "start") {
    const candidates = lower === "start" ? rest.filter((item) => !item.text.startsWith("/")) : rest;
    const skip = lower === "start" && rest[0]?.quoted === true ? 1 : 0;
    const target = candidates[skip];
    if (target === undefined || target.text.startsWith(":")) return;
    if (target.dynamic) {
      scan.violations.add("a command resolved at run time");
      return;
    }
    runCmdTarget(scan, target, candidates.slice(skip + 1), command, depth);
    return;
  }
  if (isShell(head.text)) {
    interpreterRun(scan, head, rest, command, depth, "command");
    return;
  }
  runCmdTarget(scan, head, rest, command, depth);
}

function analyzeUnit(scan: Scan, src: string, flavour: HookFlavour, depth: number): void {
  const commands: Command[] = [];
  try {
    if (flavour === "posix") new PosixParser(scan, src, commands, depth).parse(false);
    else if (flavour === "powershell") new PowerShellParser(scan, src, commands, depth).parse(undefined);
    else lexCmd(scan, src, commands);
    for (const command of commands) {
      scan.step();
      if (flavour === "posix") classifyPosix(scan, command, depth);
      else if (flavour === "powershell") classifyPowerShell(scan, command, depth);
      else classifyCmd(scan, command, depth);
    }
  } catch (error) {
    if (!(error instanceof ScanFailure)) throw error;
    scan.unsupported.add(error.message);
  }
}

/** Analyzes one hook command or script. Never throws for hostile input: unsupported syntax is reported. */
export function analyzeHookText(text: string, flavour: HookFlavour): HookAnalysis {
  const scan = new Scan();
  analyzeUnit(scan, text.replace(/\r\n/gu, "\n"), flavour, 0);
  return {
    violations: [...scan.violations].sort(),
    unsupported: [...scan.unsupported].sort(),
    loads: scan.loads,
    writes: scan.writes,
    changesDirectory: scan.changesDirectory,
    ...(scan.sole === undefined || scan.commandCount !== 1 ? {} : { sole: scan.sole }),
  };
}
