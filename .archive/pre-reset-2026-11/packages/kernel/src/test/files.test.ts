import assert from "node:assert/strict";
import test from "node:test";
import { readPublishedFile, renameWithRetry, retrySharingViolations } from "../index.js";

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

test("retrySharingViolations returns the operation's value after transient Windows sharing violations", async () => {
  const failures = ["EBUSY", "EACCES"];
  const value = await retrySharingViolations(
    async () => {
      const code = failures.shift();
      if (code !== undefined) throw Object.assign(new Error(code), { code });
      return "read";
    },
    { platform: "win32", sleep: async () => {} },
  );
  assert.equal(value, "read");
  assert.deepEqual(failures, []);
  await assert.rejects(
    retrySharingViolations(async () => undefined, { platform: "win32", attempts: 0 }),
    RangeError,
  );
});

test("renameWithRetry rejects attempt budgets outside 1 to 10", async () => {
  for (const attempts of [0, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      renameWithRetry("a.tmp", "a", { platform: "win32", attempts, rename: async () => {}, sleep: async () => {} }),
      RangeError,
    );
  }
});

function flakyPublishedFile(failures: Array<{ at: "lstat" | "readFile"; code: string }>, contents = "{}") {
  const calls: string[] = [];
  const fail = (at: "lstat" | "readFile") => {
    calls.push(at);
    if (failures[0]?.at !== at) return;
    const { code } = failures.shift()!;
    throw Object.assign(new Error(code), { code });
  };
  return {
    calls,
    lstat: async () => {
      fail("lstat");
      return { isFile: () => true, isSymbolicLink: () => false, size: Buffer.byteLength(contents) };
    },
    readFile: async () => {
      fail("readFile");
      return Buffer.from(contents);
    },
  };
}

test("readPublishedFile retries Windows sharing violations and a file replaced mid-read", async () => {
  const flaky = flakyPublishedFile([
    { at: "lstat", code: "EBUSY" },
    { at: "readFile", code: "EPERM" },
    { at: "readFile", code: "ENOENT" },
    { at: "readFile", code: "EACCES" },
  ]);
  const sleeps: number[] = [];
  const bytes = await readPublishedFile("lease.json", {
    maxBytes: 64,
    label: "Lease",
    platform: "win32",
    lstat: flaky.lstat,
    readFile: flaky.readFile,
    sleep: async (milliseconds) => void sleeps.push(milliseconds),
  });
  assert.equal(bytes?.toString("utf8"), "{}");
  assert.deepEqual(sleeps, [10, 20, 40, 80]);
  assert.deepEqual(flaky.calls, [
    "lstat",
    "lstat",
    "readFile",
    "lstat",
    "readFile",
    "lstat",
    "readFile",
    "lstat",
    "readFile",
  ]);
});

test("readPublishedFile reports absence only from lstat and never turns a transient failure into absence", async () => {
  const absent = flakyPublishedFile([{ at: "lstat", code: "ENOENT" }]);
  assert.equal(
    await readPublishedFile("lease.json", { maxBytes: 64, label: "Lease", platform: "win32", ...absent }),
    undefined,
  );
  assert.deepEqual(absent.calls, ["lstat"]);
  const exhausted = flakyPublishedFile(Array.from({ length: 5 }, () => ({ at: "readFile" as const, code: "EPERM" })));
  await assert.rejects(
    readPublishedFile("lease.json", {
      maxBytes: 64,
      label: "Lease",
      platform: "win32",
      attempts: 3,
      ...exhausted,
      sleep: async () => {},
    }),
    { code: "EPERM" },
  );
  assert.equal(exhausted.calls.filter((call) => call === "readFile").length, 3);
  const linux = flakyPublishedFile([{ at: "readFile", code: "EPERM" }]);
  await assert.rejects(readPublishedFile("lease.json", { maxBytes: 64, label: "Lease", platform: "linux", ...linux }), {
    code: "EPERM",
  });
  assert.deepEqual(linux.calls, ["lstat", "readFile"]);
  const replaced = flakyPublishedFile([{ at: "readFile", code: "ENOENT" }]);
  assert.equal(
    (
      await readPublishedFile("lease.json", {
        maxBytes: 64,
        label: "Lease",
        platform: "linux",
        ...replaced,
        sleep: async () => {},
      })
    )?.toString("utf8"),
    "{}",
  );
  const oversized = flakyPublishedFile([], "x".repeat(65));
  await assert.rejects(
    readPublishedFile("lease.json", { maxBytes: 64, label: "Lease", platform: "win32", ...oversized }),
    /Lease is unsafe/u,
  );
  assert.deepEqual(oversized.calls, ["lstat"]);
  for (const attempts of [0, 11, 1.5]) {
    await assert.rejects(readPublishedFile("lease.json", { maxBytes: 64, label: "Lease", attempts }), RangeError);
  }
});
