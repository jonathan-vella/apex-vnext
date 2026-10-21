import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const config = load(readFileSync(`${root}lefthook.yml`, "utf8"));

/**
 * lefthook 2.1.x on Windows builds the `sh -c` command line itself without escaping inner double quotes. The launcher
 * strips every `"` (so `[ -n "$X" ]` becomes `[ -n $X ]`, which is true for an empty value) and splits the script at
 * whitespace between a pair. Returns why a `run:` string is unsafe there, or undefined when it is safe.
 */
export function windowsUnsafeRun(run) {
  if (run.trim().includes("\n")) return "multi-line script; move it to tools/scripts/hooks/ and run it with bash";
  if (run.includes('"')) return "contains a double quote; the Windows launcher strips it";
  return undefined;
}

function commands() {
  return Object.entries(config).flatMap(([hook, definition]) =>
    Object.entries(definition?.commands ?? {}).map(([name, command]) => ({ id: `${hook}/${name}`, run: command.run })),
  );
}

test("the unsafe-run finder flags the shapes that break lefthook on Windows", () => {
  assert.ok(windowsUnsafeRun('if [ -n "$X" ]; then\n  echo hi\nfi'));
  assert.ok(windowsUnsafeRun('echo "two words"'));
  assert.ok(windowsUnsafeRun("echo one\necho two"));
});

test("the unsafe-run finder accepts a one-line bash call", () => {
  assert.equal(windowsUnsafeRun("bash tools/scripts/hooks/js-lint.sh"), undefined);
  assert.equal(windowsUnsafeRun("npx --no -- commitlint --edit {1}"), undefined);
});

test("every lefthook command is a single line without double quotes, so it runs on native Windows", () => {
  const offenders = commands().flatMap(({ id, run }) => {
    const reason = typeof run === "string" ? windowsUnsafeRun(run) : "run is not a string";
    return reason === undefined ? [] : [`${id}: ${reason}`];
  });
  assert.deepEqual(offenders, []);
});

test("every bash script a hook runs exists", () => {
  const missing = commands().flatMap(({ id, run }) => {
    const target = /^bash (\S+)$/u.exec(run)?.[1];
    return target === undefined || existsSync(`${root}${target}`) ? [] : [`${id}: ${target}`];
  });
  assert.deepEqual(missing, []);
});
