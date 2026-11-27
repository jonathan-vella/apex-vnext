import assert from "node:assert/strict";
import test from "node:test";
import { renderSemanticDiff, semanticDiff } from "../index.js";

test("semantic diff returns sorted JSON Pointer leaf paths", () => {
  const result = semanticDiff(
    { retained: 1, removed: { "a/b": true }, changed: "old", array: [1] },
    { retained: 1, added: { "x~y": true }, changed: "new", array: [1, 2] },
  );

  assert.deepEqual(result.added, ["/added/x~0y", "/array/1"]);
  assert.deepEqual(result.removed, ["/removed/a~1b"]);
  assert.deepEqual(result.changed, [{ path: "/changed", before: "old", after: "new" }]);
});

test("semantic diff Markdown is stable and escapes table content", () => {
  const diff = semanticDiff({ value: "left|\u0001" }, { value: "right\nline" });
  const first = renderSemanticDiff(diff);
  const second = renderSemanticDiff(diff);

  assert.equal(first, second);
  assert.match(first, /left\\\|\\\\u0001/);
  assert.match(first, /right\\\\nline/);
  assert.doesNotMatch(first, /\u0001/);
});

test("semantic diff compares keyed arrays by id or metric:scenario and falls back on duplicate or unkeyed elements", () => {
  const reorderedById = semanticDiff(
    {
      requirements: [
        { id: "REQ-2", status: "confirmed", statement: "Second" },
        { id: "REQ-1", status: "draft", statement: "First" },
      ],
    },
    {
      requirements: [
        { id: "REQ-1", status: "confirmed", statement: "First" },
        { id: "REQ-2", status: "confirmed", statement: "Second" },
        { id: "REQ-3", status: "draft", statement: "Third" },
      ],
    },
  );
  assert.deepEqual(reorderedById.added, [
    "/requirements/REQ-3/id",
    "/requirements/REQ-3/statement",
    "/requirements/REQ-3/status",
  ]);
  assert.deepEqual(reorderedById.removed, []);
  assert.deepEqual(reorderedById.changed, [
    { path: "/requirements/REQ-1/status", before: "draft", after: "confirmed" },
  ]);

  const reorderedByMetricScenario = semanticDiff(
    {
      rules: [
        { metric: "latency", scenario: "prod/eu", target: 100 },
        { metric: "errors", scenario: "base", target: 0 },
      ],
    },
    {
      rules: [{ metric: "latency", scenario: "prod/eu", target: 120 }],
    },
  );
  assert.deepEqual(reorderedByMetricScenario.added, []);
  assert.deepEqual(reorderedByMetricScenario.removed, [
    "/rules/errors:base/metric",
    "/rules/errors:base/scenario",
    "/rules/errors:base/target",
  ]);
  assert.deepEqual(reorderedByMetricScenario.changed, [
    { path: "/rules/latency:prod~1eu/target", before: 100, after: 120 },
  ]);

  const duplicateKeysFallback = semanticDiff(
    {
      items: [
        { id: "dup", value: 1 },
        { id: "dup", value: 2 },
      ],
    },
    {
      items: [
        { id: "dup", value: 2 },
        { id: "dup", value: 1 },
      ],
    },
  );
  assert.deepEqual(duplicateKeysFallback.changed, [
    { path: "/items/0/value", before: 1, after: 2 },
    { path: "/items/1/value", before: 2, after: 1 },
  ]);

  const unkeyedObjectsFallback = semanticDiff({ items: [{ name: "a" }] }, { items: [{ name: "b" }] });
  assert.deepEqual(unkeyedObjectsFallback.changed, [{ path: "/items/0/name", before: "a", after: "b" }]);
});
