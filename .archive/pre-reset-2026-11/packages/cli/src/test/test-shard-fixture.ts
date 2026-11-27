import { before, describe, test } from "./test-shard.js";

// Run by test-shard.test.ts under different APEX_TEST_SHARD values; the markers show which work this shard executed.
test("first", () => {
  console.log("RAN first");
});

describe("suite", () => {
  before(() => {
    console.log("RAN suite setup");
  });

  test("second", () => {
    console.log("RAN second");
  });
});

test("third", () => {
  console.log("RAN third");
});
