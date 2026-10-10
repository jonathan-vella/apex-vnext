import { RunConfigV1Schema, registerContractFormats, type RunConfigV1 } from "@apexops/contracts";
import { Value } from "@sinclair/typebox/value";
import { isReadinessGate } from "./gates.js";

export class RunConfigInvalidError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(
      `Run configuration does not match the current contract (${issues.join("; ")}); runs created by an earlier APEX version are not supported, so start a new run with apex project create`,
    );
    this.name = "RunConfigInvalidError";
  }
}

/** Parses persisted run.json content and rejects anything that does not match the current run contract. */
export function parseRunConfig(raw: string): RunConfigV1 {
  registerContractFormats();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RunConfigInvalidError(["/: not valid JSON"]);
  }
  if (Value.Check(RunConfigV1Schema, value)) {
    const gateIssues = readinessGateIssues(value);
    if (gateIssues.length > 0) throw new RunConfigInvalidError(gateIssues);
    return value;
  }
  const issues = [...Value.Errors(RunConfigV1Schema, value)]
    .slice(0, 3)
    .map((error) => `${error.path === "" ? "/" : error.path}: ${error.message}`);
  throw new RunConfigInvalidError(issues);
}

/** A `ready` gate is a lab-only kernel checkpoint for Gates 2 and 3; it carries no human decision fields. */
function readinessGateIssues(run: RunConfigV1): string[] {
  return run.gates.flatMap((gate, index) => {
    const path = `/gates/${index}`;
    if (gate.state !== "ready") {
      return gate.readyAt === undefined ? [] : [`${path}/readyAt: only allowed on a ready gate`];
    }
    if (!isReadinessGate(run.purpose, gate.gate)) {
      return [`${path}/state: ready is only valid for lab Gates 2 and 3`];
    }
    if (gate.readyAt === undefined) return [`${path}/readyAt: required for a ready gate`];
    if (gate.decidedAt !== undefined || gate.inheritedFromRunId !== undefined) {
      return [`${path}: a ready gate cannot carry decision or inheritance fields`];
    }
    return [];
  });
}
