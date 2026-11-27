import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventJournal, JournalIdentityError } from "../index.js";

test("a journal bound to a run identity rejects events written for another run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apex-journal-identity-"));
  try {
    const journal = new EventJournal(directory);
    await journal.append({
      eventId: "event-1",
      projectId: "demo" as never,
      runId: "run-a" as never,
      type: "run.created",
      timestamp: "2026-01-01T00:00:00.000Z",
      ownerEpoch: 1,
      expectedHead: null,
      payload: {},
    });
    assert.equal((await journal.replay()).length, 1);
    assert.equal((await journal.bound({ projectId: "demo" as never, runId: "run-a" as never }).replay()).length, 1);
    await assert.rejects(
      journal.bound({ projectId: "demo" as never, runId: "run-b" as never }).replay(),
      JournalIdentityError,
    );
    await assert.rejects(
      journal.bound({ projectId: "other" as never, runId: "run-a" as never }).replay(),
      JournalIdentityError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
