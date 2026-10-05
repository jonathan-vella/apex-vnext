import assert from "node:assert/strict";
import test from "node:test";
import { renameWithRetry } from "../index.js";

function flakyRename(failures: string[]) {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    rename: async (from: string, to: string) => {
      calls.push([from, to]);
      const code = failures.shift();
      if (code !== undefined) throw Object.assign(new Error(code), { code });
    },
  };
}

test("renameWithRetry retries transient Windows sharing violations with bounded backoff", async () => {
  const flaky = flakyRename(["EPERM", "EBUSY", "EACCES"]);
  const sleeps: number[] = [];
  await renameWithRetry("a.tmp", "a", {
    platform: "win32",
    rename: flaky.rename,
    sleep: async (milliseconds) => void sleeps.push(milliseconds),
  });
  assert.equal(flaky.calls.length, 4);
  assert.deepEqual(sleeps, [10, 20, 40]);
});

test("renameWithRetry gives up after the attempt budget and never retries other errors or platforms", async () => {
  const exhausted = flakyRename(Array(5).fill("EPERM"));
  await assert.rejects(
    renameWithRetry("a.tmp", "a", { platform: "win32", attempts: 3, rename: exhausted.rename, sleep: async () => {} }),
    { code: "EPERM" },
  );
  assert.equal(exhausted.calls.length, 3);
  const missing = flakyRename(["ENOENT"]);
  await assert.rejects(
    renameWithRetry("a.tmp", "a", { platform: "win32", rename: missing.rename, sleep: async () => {} }),
    { code: "ENOENT" },
  );
  assert.equal(missing.calls.length, 1);
  const linux = flakyRename(["EPERM"]);
  await assert.rejects(renameWithRetry("a.tmp", "a", { platform: "linux", rename: linux.rename }), { code: "EPERM" });
  assert.equal(linux.calls.length, 1);
});
