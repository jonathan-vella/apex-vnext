import assert from "node:assert/strict";
import test from "node:test";
import { renameWithRetry } from "../rename-retry.js";

test("capabilities renameWithRetry matches the kernel retry policy", async () => {
  const failures = ["EBUSY", "EPERM"];
  let calls = 0;
  const rename = async () => {
    calls += 1;
    const code = failures.shift();
    if (code !== undefined) throw Object.assign(new Error(code), { code });
  };
  await renameWithRetry("a.tmp", "a", { platform: "win32", rename, sleep: async () => {} });
  assert.equal(calls, 3);
  calls = 0;
  failures.push("EPERM");
  await assert.rejects(renameWithRetry("a.tmp", "a", { platform: "darwin", rename }), { code: "EPERM" });
  assert.equal(calls, 1);
});
