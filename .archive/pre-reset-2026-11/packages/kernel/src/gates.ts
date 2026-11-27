import type { DeploymentPurpose, GateRecordV1, RunId } from "@apexops/contracts";

export function openGate(gate: GateRecordV1, dependencyHash: string): GateRecordV1 {
  if (gate.state !== "closed" && gate.state !== "invalidated") {
    throw new Error(`Gate ${gate.gate} cannot open from ${gate.state}`);
  }
  return { gate: gate.gate, state: "open", dependencyHash };
}

/** Gates whose lab-purpose outcome is a kernel-recorded readiness checkpoint instead of a human decision. */
export function isReadinessGate(purpose: DeploymentPurpose, gateNumber: number): boolean {
  return purpose === "lab" && (gateNumber === 2 || gateNumber === 3);
}

/** Records a kernel readiness checkpoint. It is never a decision: no actor, no approval evidence, no decidedAt. */
export function markGateReady(gate: GateRecordV1, purpose: DeploymentPurpose, readyAt: string): GateRecordV1 {
  if (!isReadinessGate(purpose, gate.gate)) {
    throw new Error(`Gate ${gate.gate} cannot be recorded as ready for a ${purpose} run`);
  }
  if (gate.state !== "open") {
    throw new Error(`Gate ${gate.gate} is not open`);
  }
  return { gate: gate.gate, state: "ready", dependencyHash: gate.dependencyHash, readyAt };
}

export function decideGate(
  gate: GateRecordV1,
  decision: "approved" | "rejected",
  decidedAt: string,
  reason?: string,
): GateRecordV1 {
  if (gate.state !== "open") {
    throw new Error(`Gate ${gate.gate} is not open`);
  }
  return { ...gate, state: decision, decidedAt, ...(reason === undefined ? {} : { reason }) };
}

export function invalidateGate(gate: GateRecordV1, dependencyHash: string, reason: string): GateRecordV1 {
  return { gate: gate.gate, state: "invalidated", dependencyHash, reason };
}

export function inheritGate(
  gate: GateRecordV1,
  fromRunId: RunId,
  dependencyHash: string,
  decidedAt: string,
): GateRecordV1 {
  if (gate.gate === 4) {
    throw new Error("Gate 4 cannot be inherited");
  }
  if (gate.state === "ready") {
    throw new Error(`Gate ${gate.gate} readiness is recomputed in the new run and cannot be inherited`);
  }
  if (gate.dependencyHash !== dependencyHash || (gate.state !== "approved" && gate.state !== "inherited")) {
    throw new Error(`Gate ${gate.gate} dependencies are not approved for inheritance`);
  }
  return { gate: gate.gate, state: "inherited", dependencyHash, inheritedFromRunId: fromRunId, decidedAt };
}
