import { CapabilityError, type Capability } from "./capability.js";

export const operationsCapabilityCategories = [
  "governance-discovery",
  "inventory-query",
  "quota-availability",
  "diagnostics-kusto",
  "compliance",
  "cost-normalization",
] as const;

export type OperationsCapabilityCategory = (typeof operationsCapabilityCategories)[number];

export function createUnavailableOperationsCapabilities(requiredRole: string): readonly Capability<unknown, never>[] {
  return operationsCapabilityCategories.map((category) => ({
    id: `operations.${category}`,
    sideEffect: "none",
    requiredRole,
    timeoutMs: 100,
    retries: 0,
    idempotency: "none",
    async execute() {
      throw new CapabilityError(
        "CAPABILITY_UNAVAILABLE",
        `Capability 'operations.${category}' is unavailable in this runtime`,
      );
    },
  }));
}
