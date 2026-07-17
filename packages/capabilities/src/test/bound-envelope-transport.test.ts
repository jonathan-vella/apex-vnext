import assert from "node:assert/strict";
import test from "node:test";
import { BoundEnvelopeTransport } from "../index.js";

const instant = new Date("2026-07-17T08:00:00.000Z");
const payload = Buffer.from("authority", "utf8");

function transport(now = instant): BoundEnvelopeTransport {
  return new BoundEnvelopeTransport(() => now);
}

test("bound envelopes preserve payload integrity and canonical bindings", () => {
  const envelope = transport().create(payload, {
    kind: "authority",
    recipient: "ci",
    ttlMs: 60_000,
    bindings: { zeta: 2, alpha: "one" },
  });

  assert.deepEqual(envelope.metadata.bindings, { alpha: "one", zeta: 2 });
  assert.deepEqual(transport().open(envelope, "ci"), payload);
});

test("bound envelopes reject wrong recipients, expiry, and tampering", () => {
  const envelope = transport().create(payload, {
    kind: "authority",
    recipient: "ci",
    ttlMs: 60_000,
    bindings: { previewHash: "a".repeat(64) },
  });

  assert.throws(() => transport().open(envelope, "other"), /recipient/);
  assert.throws(() => transport(new Date("2026-07-17T08:01:00.000Z")).open(envelope, "ci"), /expired/);
  assert.throws(
    () => transport().open({ ...envelope, payload: Buffer.from("changed").toString("base64") }, "ci"),
    /digest/,
  );
});
