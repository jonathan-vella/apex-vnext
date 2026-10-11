import nodeTest, { before as nodeBefore, describe as nodeDescribe } from "node:test";

/**
 * Deterministic test-level sharding for hosted CI. Every CLI test file declares tests through this module, so setting
 * `APEX_TEST_SHARD=<index>/<total>` (1-based, e.g. `2/6`) registers only the tests whose per-file declaration position
 * is congruent to the shard. The shards of one total therefore cover every test of every file exactly once. A few
 * workflow files hold most of the suite's runtime, which `node --test --test-shard` (whole files) cannot split.
 * Unset, every test runs.
 */
export interface TestShard {
  readonly index: number;
  readonly total: number;
}

const SHARD_PATTERN = /^([1-9]\d{0,2})\/([1-9]\d{0,2})$/u;

export function parseTestShard(value: string | undefined): TestShard | undefined {
  if (value === undefined || value === "") return undefined;
  const match = SHARD_PATTERN.exec(value);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (match === null || index > total) throw new Error(`APEX_TEST_SHARD must be <index>/<total> with index <= total`);
  return { index, total };
}

/** Whether the test declared at zero-based `position` belongs to `shard`; every test belongs when there is none. */
export function shardSelects(position: number, shard: TestShard | undefined): boolean {
  return shard === undefined || position % shard.total === shard.index - 1;
}

const shard = parseTestShard(process.env.APEX_TEST_SHARD);
let declared = 0;
let enclosingSuite: { selected: boolean } | undefined;

/** `node:test`'s `test`, registering only this shard's tests. */
export const test = ((...args: Parameters<typeof nodeTest>) => {
  if (!shardSelects(declared++, shard)) return Promise.resolve();
  if (enclosingSuite !== undefined) enclosingSuite.selected = true;
  return nodeTest(...args);
}) as typeof nodeTest;

/** `node:test`'s `describe`; its `before` hooks (below) skip the suite's setup when this shard selects none of its tests. */
export const describe = ((...args: Parameters<typeof nodeDescribe>) => {
  const callback = args.find((argument) => typeof argument === "function");
  const suite = { selected: false };
  const wrapped = (...callbackArguments: unknown[]) => {
    const outer = enclosingSuite;
    enclosingSuite = suite;
    try {
      return (callback as (...values: unknown[]) => unknown)(...callbackArguments);
    } finally {
      enclosingSuite = outer;
    }
  };
  return nodeDescribe(...(args.map((argument) => (argument === callback ? wrapped : argument)) as typeof args));
}) as typeof nodeDescribe;

/** `node:test`'s `before`, which does nothing in a suite whose tests this shard did not select. */
export const before = ((fn: Parameters<typeof nodeBefore>[0], options?: Parameters<typeof nodeBefore>[1]) => {
  const suite = enclosingSuite;
  return nodeBefore((...hookArguments: unknown[]) => {
    if (suite === undefined || suite.selected) return (fn as (...values: unknown[]) => unknown)(...hookArguments);
    return undefined;
  }, options);
}) as typeof nodeBefore;
