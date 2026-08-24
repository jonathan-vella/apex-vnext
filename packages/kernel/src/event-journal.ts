import type { EventV1, ProjectId, RunId } from "@apexops/contracts";
import { CONTRACT_VERSION } from "@apexops/contracts";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJsonBytes, sha256Json, type JsonValue } from "./canonical.js";
import { atomicWriteBytes } from "./files.js";

export interface AppendEventInput {
  eventId: string;
  projectId: ProjectId;
  runId: RunId;
  type: string;
  timestamp: string;
  ownerEpoch: number;
  expectedHead: string | null;
  payload: JsonValue;
}

type EventWithoutHash = Omit<EventV1, "hash">;
const MAX_EVENT_BYTES = 1024 * 1024;

async function readEventFile(path: string): Promise<string> {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_EVENT_BYTES)) {
    throw new Error("Journal event must be a bounded regular file");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > BigInt(MAX_EVENT_BYTES)
    ) {
      throw new Error("Journal event changed before read");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_EVENT_BYTES) throw new Error("Journal event exceeds its byte budget");
    const after = await lstat(path, { bigint: true });
    if (after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error("Journal event changed during read");
    }
    return bytes.toString("utf8");
  } finally {
    await handle.close();
  }
}

export class EventJournal {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  async head(): Promise<string | null> {
    const events = await this.replay();
    return events.at(-1)?.hash ?? null;
  }

  async append(input: AppendEventInput): Promise<EventV1> {
    const events = await this.replay();
    const previous = events.at(-1);
    const actualHead = previous?.hash ?? null;
    if (input.expectedHead !== actualHead) {
      throw new Error(`Stale journal head: expected ${String(input.expectedHead)}, found ${String(actualHead)}`);
    }
    if (previous !== undefined && input.ownerEpoch < previous.ownerEpoch) {
      throw new Error(`Stale owner epoch: minimum ${previous.ownerEpoch}, received ${input.ownerEpoch}`);
    }
    if (!Number.isInteger(input.ownerEpoch) || input.ownerEpoch < 1) {
      throw new Error("Owner epoch must be a positive integer");
    }

    const eventWithoutHash: EventWithoutHash = {
      schemaVersion: CONTRACT_VERSION,
      eventId: input.eventId,
      projectId: input.projectId,
      runId: input.runId,
      sequence: events.length + 1,
      type: input.type,
      timestamp: input.timestamp,
      ownerEpoch: input.ownerEpoch,
      previousHash: actualHead,
      payloadHash: sha256Json(input.payload),
      payload: input.payload,
    };
    const event: EventV1 = { ...eventWithoutHash, hash: sha256Json(eventWithoutHash as JsonValue) };
    const path = join(this.directory, `${String(event.sequence).padStart(16, "0")}.json`);
    try {
      await atomicWriteBytes(path, canonicalJsonBytes(event as JsonValue), { refuseOverwrite: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Stale journal head: another writer appended first", { cause: error });
      }
      throw error;
    }
    return event;
  }

  async replay(): Promise<EventV1[]> {
    let names: string[];
    try {
      names = (await readdir(this.directory)).filter((name) => /^\d{16}\.json$/.test(name)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const events: EventV1[] = [];
    let previousHash: string | null = null;
    let identity: Pick<EventV1, "projectId" | "runId"> | undefined;
    for (const [index, name] of names.entries()) {
      let contents: string;
      try {
        contents = await readEventFile(join(this.directory, name));
      } catch (error) {
        throw new Error(`Corrupt journal event ${name}: unsafe file`, { cause: error });
      }
      let event: EventV1;
      try {
        event = JSON.parse(contents) as EventV1;
      } catch (error) {
        throw new Error(`Corrupt journal event ${name}: invalid JSON`, { cause: error });
      }
      const { hash, ...withoutHash } = event;
      const expectedSequence = index + 1;
      if (event.sequence !== expectedSequence || name !== `${String(expectedSequence).padStart(16, "0")}.json`) {
        throw new Error(`Corrupt journal sequence at ${name}`);
      }
      if (event.previousHash !== previousHash) {
        throw new Error(`Corrupt journal chain at sequence ${event.sequence}`);
      }
      if (sha256Json(event.payload as JsonValue) !== event.payloadHash) {
        throw new Error(`Corrupt journal payload at sequence ${event.sequence}`);
      }
      if (sha256Json(withoutHash as JsonValue) !== hash) {
        throw new Error(`Corrupt journal hash at sequence ${event.sequence}`);
      }
      identity ??= event;
      if (event.projectId !== identity.projectId || event.runId !== identity.runId) {
        throw new Error(`Corrupt journal identity at sequence ${event.sequence}`);
      }
      events.push(event);
      previousHash = hash;
    }
    return events;
  }
}
