import { CapabilityError, type Capability, type CapabilityRegistry } from "./capability.js";

export const designCapabilityIds = {
  documentationResearch: "design.documentation.research",
  rbacCatalog: "design.rbac.catalog",
  computeRegionEvidence: "design.compute.region-evidence",
  entraApplicationIntent: "design.entra.application-intent",
} as const;

export type DesignCapabilityId = (typeof designCapabilityIds)[keyof typeof designCapabilityIds];

export interface DocumentationResearchInput {
  readonly question: string;
}

export interface RbacCatalogInput {
  readonly operation: string;
}

export interface ComputeRegionEvidenceInput {
  readonly region: string;
}

export interface EntraApplicationIntentInput {
  readonly applicationName: string;
}

function unavailableCapability<TInput>(id: DesignCapabilityId): Capability<TInput, never> {
  return {
    id,
    sideEffect: "none",
    requiredRole: "architect",
    timeoutMs: 1_000,
    retries: 0,
    idempotency: "supported",
    async execute() {
      throw new CapabilityError("CAPABILITY_UNAVAILABLE", `Capability '${id}' is implemented but not qualified`);
    },
  };
}

export const unavailableDesignCapabilities = [
  unavailableCapability<DocumentationResearchInput>(designCapabilityIds.documentationResearch),
  unavailableCapability<RbacCatalogInput>(designCapabilityIds.rbacCatalog),
  unavailableCapability<ComputeRegionEvidenceInput>(designCapabilityIds.computeRegionEvidence),
  unavailableCapability<EntraApplicationIntentInput>(designCapabilityIds.entraApplicationIntent),
] as const;

export function registerUnavailableDesignCapabilities(registry: CapabilityRegistry): void {
  for (const capability of unavailableDesignCapabilities) {
    registry.register(capability as Capability<unknown, never>);
  }
}
