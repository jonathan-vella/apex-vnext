import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseTestShard, shardSelects, test } from "./test-shard.js";

test("a shard specification is <index>/<total> with 1 <= index <= total, and absent means every test", () => {
  assert.equal(parseTestShard(undefined), undefined);
  assert.equal(parseTestShard(""), undefined);
  assert.deepEqual(parseTestShard("1/1"), { index: 1, total: 1 });
  assert.deepEqual(parseTestShard("3/6"), { index: 3, total: 6 });
  for (const invalid of ["0/6", "7/6", "1/0", "-1/6", "1", "a/b", "1/6/2", " 1/6", "01/6", "1000/1000"]) {
    assert.throws(() => parseTestShard(invalid), /APEX_TEST_SHARD/u, invalid);
  }
});

test("the shards of any total select every declared test exactly once", () => {
  for (const total of [1, 2, 3, 6, 7, 12]) {
    for (const declared of [0, 1, total - 1, total, total + 1, 66, 101]) {
      const owners = Array.from({ length: declared }, (_, position) =>
        Array.from({ length: total }, (_, offset) => offset + 1).filter((index) =>
          shardSelects(position, { index, total }),
        ),
      );
      for (const [position, shards] of owners.entries()) {
        assert.equal(shards.length, 1, `test ${position} of ${declared} across ${total} shards: ${shards.join(",")}`);
      }
    }
  }
  assert.equal(shardSelects(41, undefined), true);
});

test("every CLI test file declares its tests through the shard helper so no file runs unsharded", async () => {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const files = (await readdir(directory)).filter((name) => name.endsWith(".test.js")).sort();
  assert.ok(files.length > 20, "the compiled CLI test files are missing");
  const offenders: string[] = [];
  for (const name of files) {
    const source = await readFile(`${directory}${name}`, "utf8");
    if (!source.includes('from "./test-shard.js"')) offenders.push(`${name}: no shard`);
    // Tests, suites and hooks all come from the helper; anything imported from node:test could register unsharded work.
    if (/from\s+["']node:test["']|import\s*\(\s*["']node:test["']/u.test(source)) {
      offenders.push(`${name}: registers tests or hooks outside the shard helper`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("a suite's setup runs only in the shard that selects one of its tests", () => {
  const fixture = fileURLToPath(new URL("./test-shard-fixture.js", import.meta.url));
  const ran = (shardSpecification: string | undefined) => {
    const environment = { ...process.env };
    delete environment.APEX_TEST_SHARD;
    delete environment.NODE_TEST_CONTEXT;
    if (shardSpecification !== undefined) environment.APEX_TEST_SHARD = shardSpecification;
    const result = spawnSync(process.execPath, [fixture], { encoding: "utf8", env: environment });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return [...result.stdout.matchAll(/RAN ([a-z ]+)/gu)].map(([, marker]) => marker);
  };
  assert.deepEqual(ran(undefined), ["first", "suite setup", "second", "third"]);
  assert.deepEqual(ran("1/2"), ["first", "third"]);
  assert.deepEqual(ran("2/2"), ["suite setup", "second"]);
});
