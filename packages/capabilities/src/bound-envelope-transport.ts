import { createHash } from "node:crypto";
import type { EnvelopeBindingValue, EnvelopeBindings } from "./encrypted-envelope-transport.js";

export interface BoundEnvelopeMetadata {
  readonly implementation: "apex-bound-envelope";
  readonly version: 1;
  readonly kind: string;
  readonly digest: string;
  readonly recipient: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly bindings: EnvelopeBindings;
}

export interface BoundEnvelope {
  readonly metadata: BoundEnvelopeMetadata;
  readonly payload: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBindings(bindings: EnvelopeBindings): EnvelopeBindings {
  const canonical: Record<string, EnvelopeBindingValue> = {};
  for (const key of Object.keys(bindings).sort()) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key))
      throw new TypeError("Bound envelope binding names must be identifier-shaped");
    const value = bindings[key]!;
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new TypeError(`Bound envelope binding ${key} must be a finite string or number`);
    }
    canonical[key] = value;
  }
  return canonical;
}

function requireMetadata(metadata: BoundEnvelopeMetadata): void {
  const expectedKeys = [
    "bindings",
    "createdAt",
    "digest",
    "expiresAt",
    "implementation",
    "kind",
    "recipient",
    "version",
  ];
  if (Object.keys(metadata).sort().join("\0") !== expectedKeys.join("\0")) {
    throw new Error("Bound envelope metadata shape is invalid");
  }
  if (metadata.implementation !== "apex-bound-envelope" || metadata.version !== 1) {
    throw new Error("Unsupported bound envelope");
  }
  if (metadata.kind.trim().length === 0 || metadata.recipient.trim().length === 0) {
    throw new Error("Bound envelope kind and recipient are required");
  }
  if (!/^[0-9a-f]{64}$/.test(metadata.digest)) throw new Error("Bound envelope digest is invalid");
  const createdAt = Date.parse(metadata.createdAt);
  const expiresAt = Date.parse(metadata.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
    throw new Error("Bound envelope timestamps are invalid");
  }
  canonicalBindings(metadata.bindings);
}

function decodePayload(value: string): Buffer {
  if (value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Bound envelope payload is invalid base64");
  }
  const payload = Buffer.from(value, "base64");
  if (payload.toString("base64") !== value) throw new Error("Bound envelope payload is not canonical base64");
  return payload;
}

export class BoundEnvelopeTransport {
  constructor(private readonly now: () => Date = () => new Date()) {}

  create(
    payload: Uint8Array,
    options: {
      readonly kind: string;
      readonly recipient: string;
      readonly ttlMs: number;
      readonly bindings: EnvelopeBindings;
    },
  ): BoundEnvelope {
    if (options.kind.trim().length === 0 || options.recipient.trim().length === 0 || options.ttlMs <= 0) {
      throw new TypeError("Bound envelope kind, recipient, and positive TTL are required");
    }
    if (!Number.isFinite(options.ttlMs)) throw new TypeError("Bound envelope TTL must be finite");
    const createdAt = this.now();
    return {
      metadata: {
        implementation: "apex-bound-envelope",
        version: 1,
        kind: options.kind,
        digest: sha256(payload),
        recipient: options.recipient,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + options.ttlMs).toISOString(),
        bindings: canonicalBindings(options.bindings),
      },
      payload: Buffer.from(payload).toString("base64"),
    };
  }

  open(envelope: BoundEnvelope, recipient: string): Buffer {
    requireMetadata(envelope.metadata);
    if (recipient.trim().length === 0 || envelope.metadata.recipient !== recipient) {
      throw new Error("Bound envelope recipient does not match");
    }
    if (Date.parse(envelope.metadata.expiresAt) <= this.now().getTime()) throw new Error("Bound envelope has expired");
    const payload = decodePayload(envelope.payload);
    if (sha256(payload) !== envelope.metadata.digest) throw new Error("Bound envelope digest mismatch");
    return payload;
  }
}
