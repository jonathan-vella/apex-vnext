import assert from "node:assert/strict";
import type { Client } from "@modelcontextprotocol/client";
import { test } from "./test-shard.js";
import { MCP_MAX_SERIALIZED_RESULT_BYTES } from "../mcp.js";
import { ApexService, TASK_CONTEXT_INLINE_INPUT_MAX_BYTES } from "../service.js";
import { nextTaskAfterInput, requirements, tempRoot } from "./helpers.js";
import { connectMcp } from "./mcp-client.js";

const envelopeBytes = (structuredContent: unknown) =>
  Buffer.byteLength(
    JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
    }),
  );

async function reviewTaskWithHandoff(handoff: string) {
  const service = new ApexService(await tempRoot(), { clock: () => new Date("2026-01-01T00:00:00.000Z") });
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const issued = await nextTaskAfterInput(service);
  if (issued.status !== "task") throw new Error("Expected requirements task");
  const value = requirements();
  value.architectureHandoff = handoff;
  const accepted = await service.completeRequirements(issued.task.taskId, value);
  const review = await service.nextTask();
  if (review.status !== "task") throw new Error("Expected review task");
  return { service, value, taskId: review.task.taskId, hash: accepted.outputHashes.requirements! };
}

function structured(response: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  assert.notEqual(response.isError, true, JSON.stringify(response.structuredContent).slice(0, 300));
  return response.structuredContent as Record<string, unknown>;
}

test("a single input above the inline limit stays a reference and taskContext fits one MCP page", async (context) => {
  const { service, value, taskId, hash } = await reviewTaskWithHandoff("detail \u00e9".repeat(20_000));
  const { client, close } = await connectMcp(service, { name: "task-context-inline" });
  context.after(close);
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: { workspace: service.root, ...args } });

  const full = await service.taskContext(taskId);
  const reference = full.inputReferences.find((entry) => entry.hash === hash)!;
  assert.ok(reference.bytes > TASK_CONTEXT_INLINE_INPUT_MAX_BYTES, "the fixture input is above the limit");
  assert.ok(reference.bytes < 262_144, "it would have been inlined under the total budget alone");
  assert.equal(reference.inlined, false);
  assert.deepEqual(full.inputs, []);

  const page = structured(await call("taskContext", { taskId }));
  assert.equal(page.nextCursor, undefined, "no paging is needed once the input is a reference");
  // The metadata around the inputs (task, references, review request) leaves most of the MCP budget free.
  assert.ok(envelopeBytes({ ...full, inputs: [] }) < 16 * 1024, `${envelopeBytes({ ...full, inputs: [] })} bytes`);
  assert.ok(envelopeBytes(page) <= MCP_MAX_SERIALIZED_RESULT_BYTES, `${envelopeBytes(page)} bytes`);
  assert.deepEqual(
    (page.inputReferences as Array<{ hash: string }>).map((entry) => entry.hash),
    full.task.inputRefs,
  );

  const chunks: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const chunk = structured(await call("readTaskInput", { taskId, offset, limit: 6_000, inputHash: hash })) as {
      content: string;
      nextOffset?: number;
    };
    assert.ok(Buffer.byteLength(chunk.content) <= 6_000);
    assert.ok(envelopeBytes(chunk) <= MCP_MAX_SERIALIZED_RESULT_BYTES);
    chunks.push(chunk.content);
    offset = chunk.nextOffset;
  }
  assert.ok(chunks.length > 1);
  assert.ok(Buffer.byteLength(chunks.join("")) > MCP_MAX_SERIALIZED_RESULT_BYTES, "the input exceeds one MCP result");
  assert.deepEqual(JSON.parse(chunks.join("")), value);
});

async function taskContextPages(service: ApexService, taskId: string) {
  const { client, close } = await connectMcp(service, { name: "task-context-inline-pages" });
  try {
    const inputs: unknown[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = structured(
        await client.callTool({
          name: "taskContext",
          arguments: { workspace: service.root, taskId, ...(cursor === undefined ? {} : { cursor }) },
        }),
      );
      assert.ok(envelopeBytes(page) <= MCP_MAX_SERIALIZED_RESULT_BYTES, `${envelopeBytes(page)} bytes`);
      inputs.push(...(page.inputs as unknown[]));
      cursor = page.nextCursor as string | undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    assert.equal(cursor, undefined);
    return inputs;
  } finally {
    await close();
  }
}

test("a small input is inlined, and a quote-dense input that cannot fit a page alone is not", async () => {
  const small = await reviewTaskWithHandoff("detail ".repeat(1_500));
  const smallContext = await small.service.taskContext(small.taskId);
  assert.equal(smallContext.inputReferences.find((entry) => entry.hash === small.hash)!.inlined, true);
  assert.deepEqual(await taskContextPages(small.service, small.taskId), smallContext.inputs);
  assert.equal(smallContext.inputs.length, 1);

  // Below the byte limit, but its JSON is doubled by escaping in the MCP result (structured content plus text copy).
  const dense = await reviewTaskWithHandoff('say "x" \\ '.repeat(2_150));
  const denseContext = await dense.service.taskContext(dense.taskId);
  const reference = denseContext.inputReferences.find((entry) => entry.hash === dense.hash)!;
  assert.ok(
    reference.bytes > 24 * 1024 && reference.bytes <= TASK_CONTEXT_INLINE_INPUT_MAX_BYTES,
    `${reference.bytes}`,
  );
  assert.equal(reference.inlined, false);
  assert.deepEqual(await taskContextPages(dense.service, dense.taskId), []);
});
