# SKU Availability

SKU availability asks whether a SKU is offered to the selected subscription in the target region and zones. It is a
check separate from quota headroom and from allocation capacity, which stays unknown until deployment.

## Status Contract

| Status | Meaning |
| --- | --- |
| `AVAILABLE` | Listed for the region and every required zone, with no applicable restriction. |
| `RESTRICTED` | Listed, but restricted for this subscription, region, or a required zone. |
| `NOT_OFFERED` | Not listed for the region. |
| `UNKNOWN` | No SKU-level source exists, or the evidence is failed, partial, or unreadable. |

- Never report `AVAILABLE` from missing, partial, or unreadable evidence.
- `UNKNOWN` from a failed check is a blocker until the capability produces readable evidence. `UNKNOWN` because no
  SKU-level source exists for the service is reported as unverified, with any region-level evidence attached.
- Record, per service, environment, and region: the SKU, required zones, evidence source, collection time in UTC,
  status, and reason.
- Check zones whenever the design requires zone redundancy.
- Propose a substitute SKU or region only when it is `AVAILABLE` and its quota headroom is sufficient.

## Evidence Sources By Service

The capability, not this skill, collects the evidence. A listing must include SKUs the subscription cannot use, so that
restrictions stay visible instead of disappearing from the result.

| Service | SKU-level evidence the capability must provide |
| --- | --- |
| VMs, scale sets, AKS node pools, managed disks | Compute SKU listing with locations, zones, and restrictions |
| Storage accounts | Storage SKU listing filtered by account kind |
| App Service plans | Regions offering the plan SKU for the required operating system |
| Azure SQL Database | Available editions and service objectives in the region |
| PostgreSQL or MySQL flexible server | SKU list for the tier, including zone-redundant high-availability support |
| Container Apps workload profiles | Supported workload profiles in the region |
| AKS versions | Supported Kubernetes versions in the region; node sizes use the compute check |
| Other services | Usually region-level resource-type locations only; the SKU status stays `UNKNOWN` |

## At Deployment

`SkuNotAvailable`, `AllocationFailed`, `ZonalAllocationFailed`, and `OverconstrainedAllocationRequest` mean the earlier
evidence was stale or capacity was short. Preserve the error with the earlier evidence and route it to the owning
deployment or reconciliation path. Never switch SKU or region without a new recorded decision.
