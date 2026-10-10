import { RunConfigV1Schema, registerContractFormats, type RunConfigV1 } from "@apexops/contracts";
import { Value } from "@sinclair/typebox/value";

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
  if (Value.Check(RunConfigV1Schema, value)) return value;
  const issues = [...Value.Errors(RunConfigV1Schema, value)]
    .slice(0, 3)
    .map((error) => `${error.path === "" ? "/" : error.path}: ${error.message}`);
  throw new RunConfigInvalidError(issues);
}
