<a id="top"></a>

# Plan: NBB Group Cloud DR Retail ROM and APEX Cost Management v2.2

> Autopilot-assignable execution plan for generating an evidence-backed Azure Retail Rough Order of Magnitude (ROM)
> estimate for the NBB Group Cloud DR RFI while instrumenting and specifying APEX Cost Management v2.2 improvements.

**Status**: Completed
**Owner**: `@jonathan-vella` / Autopilot (`general-purpose` + `cost-estimate-subagent`)
**Created**: 2026-11-13
**Target Branch**: `feat/nbb-dr-rom-and-cost-management` (in `jonathan-vella/apex-mine`)
**Upstream Design Target**: `jonathan-vella/apex` (via empirical spec, zero local framework drift)

---

## 1. Executive Objective

Deliver two tightly coupled outcomes from one deterministic, Autopilot-safe execution loop:

1. **Partner-Ready NBB Group Azure Retail ROM (`agent-output/nbb-cloud-dr-rfi/`)**: Convert the 8-sheet workload
   inventory (`DR on Cloud RFI.xlsx`) and approved architecture (`NBB_Cloud_DR_RFI.azure-response.md`) into a
   cryptographically evidenced Azure Retail ROM across three operational states (**Steady-State DR Standby**,
   **Full Active DR Failover**, and **48-Hour DR Drill**), with **PAYG vs. 3-Year RI / Blob Reserved Capacity / AHB**
   optimization overlays and an explicit **Partner, Marketplace & AWS Egress Commercial Schedule**.
2. **Empirical Audit & Specification for APEX Cost Management v2.2 (`docs/exec-plans/active/`)**: Instrument every SKU
   mapping, `azure-mcp-pricing` call, direct `prices.azure.com` fallback, recipe rejection, and scenario limitation
   encountered during the NBB Group run, combine those measurements with existing workspace artifacts
   (`partner-modernization-factory-v2`, `arcbox-insights`), and produce an implementation-ready v2.2 engineering spec
   for upstream `jonathan-vella/apex`.

---

## 2. Autopilot Operating Contract & Safety Guardrails

Because native Autopilot can auto-answer prompts (`copilot-instructions.md`, *Harness And Runtime Boundaries*), a
form response during autonomous execution is **not** human owner authorization. Autopilot must execute within the
following locked rules:

1. **Zero Fabricated Prices (Hard Gate)**: Every USD retail rate published in JSON, Markdown, or charts must trace to
   exact-byte response files and SHA-256 digests from `azure-mcp-pricing` (`command: "pricing_get"`, `learn: false`) or
   `https://prices.azure.com/api/retail/prices`. Never invent, interpolate, or copy training-data prices.
2. **Zero Live Azure or Remote Git Mutations**:
   - Read-only public retail pricing and Microsoft Learn queries only; never run `az deployment`, `azd`, `terraform`,
     or subscription-mutating CLI commands.
   - Commit locally on `feat/nbb-dr-rom-and-cost-management` at defined checkpoints, but **do not** run `git push`,
     `gh pr create`, or merge operations unless explicitly instructed by the human owner in a new prompt.
3. **Upstream-Sync Boundary (`apex-mine` vs. `apex`)**:
   - `.github/workflows/weekly-upstream-sync.yml` overwrites `tools/`, `.github/agents/`, `.github/skills/`, and
     `.github/instructions/` from `jonathan-vella/apex@main` every Sunday (`upstream always wins`), while preserving
     `docs/` and `agent-output/` via `EXCLUDE_PATHS`.
   - Therefore, this plan lives under `docs/exec-plans/active/` and **must not** edit `tools/scripts/cost-estimate.mjs`
     or `.github/**` inside `apex-mine`. All NBB ROM helpers live under `agent-output/nbb-cloud-dr-rfi/scripts/`, and
     all engine upgrades are emitted as a concrete upstream patch specification in Workstream 5.
4. **Artifact Validator Compatibility**:
   - `nbb-cloud-dr-rfi` is a standalone Partner RFI package, not a Step 1-7 delivery project.
   - Never create files matching reserved template names in `tools/scripts/validate-artifacts.mjs` (`ARTIFACT_NAMES`,
     such as `02-architecture-assessment.md`, `03-des-cost-estimate.md`, or `03-cost-management-report.md`), which
     would trigger Step 2/3 H2 template and `challenge-findings-*.json` pre-commit gates.
5. **No Interactive Prompts for Pre-Decided Defaults**: Do not call `ask_user` for modeling parameters already locked
   in Section 3. Stop and report `BLOCKED` only if:
   - Both `azure-mcp-pricing` and `https://prices.azure.com/api/retail/prices` are unreachable after bounded retries;
   - Source inventory files under `agent-output/nbb-cloud-dr-rfi/_meta/` fail SHA-256 or readability checks; or
   - Any validation gate or staged byte-budget check fails after two deterministic repair attempts.
6. **Subagent Write-Allowlist Boundary (RD-07)**: `cost-estimate-subagent` may write **only** its declared `output_path`
   and adjacent `pricing-evidence/` directory for standard `cost-estimate-v2` / `retail-rate-quote-v1` requests
   (`.github/agents/_subagents/cost-estimate-subagent.agent.md:24-36`). The **parent Autopilot agent** owns WS1, WS3
   (`pricing/supplemental-bcdr/`), WS4, and WS5 directly.

---

## 3. Locked Modeling Decisions & Architectural Baseline

All modeling inputs below are pre-approved from `NBB_Cloud_DR_RFI.azure-response.md` and verbatim workbook inspection
(`Request_for_Information_and_Inventory.extracted.md`):

| Dimension | Locked Assumption for ROM Baseline | Sensitivity / Notes |
| --- | --- | --- |
| **Currency & Price Basis** | `USD`, Azure Public Retail (`priceType: "Consumption"` baseline; `Reservation` overlay) | Excludes EA/MCA customer discounts; partner applies NBB MCA discount % on top |
| **On-Prem DR Target Region** | `uaenorth` (UAE North) | Subject to CBB residency sign-off; `Skytap` Power9 placed in `westeurope` peered to `uaenorth` |
| **AWS Ireland DR Target Region** | `swedencentral` (Sweden Central) | EU GDPR-compliant primary target for AWS `eu-west-1` workloads |
| **VM Right-Sizing & Constrained vCPU** | Lowest-cost regional SKU meeting **both** `vCPU` and `GiB RAM` + `maxDataDiskCount` | Uses constrained-vCPU SKUs (e.g., `Standard_E64-16ds_v5` for `8 vCPU / 300 GiB` SQL VM 1) to protect DB core licensing |
| **Solaris SPARC M8 (`Solaris` tab)** | **3 LDOMs** (`256 GB`, `70 GB`, `36 GB` = `362 GB`, `16` cores, `23 TB`) -> `E48ds_v5` + `E16ds_v5` + `E8ds_v5` | `730h/mo` in `uaenorth` for Sybase replication (`F2:F4` merged); Charon-SSP software license in Partner Schedule |
| **AIX Power9 (`AIX` tab)** | **6 LPARs** (incl. `DB LPAR 4` `750 GB / 28.08 TB`, shared `H3:H4` `800 GB` & `I3:I5` `500 GB`) in Partner Schedule | `Skytap on Azure` (`westeurope`/`uksouth`) Marketplace / private-offer quote; `LPAR 5` (`no replication`) excluded |
| **Oracle Estate (`Oracle` + `AWS` RDS)** | `Oracle` tab = **12 DBs (`8,152.44 GB`) on 1 shared Oracle Linux 8 host** (`32` cores, `260 GB` RAM, `730h/mo`) | `uaenorth` (`Standard_E32ds_v5` + Premium SSD); `AWS` `9` Oracle RDS -> IaaS BYOL in `swedencentral`; `ODB@Azure` noted |
| **SQL Server (`SQL_Servers` tab)** | `15` Windows SQL VMs (`100 vCPUs`, `512 GiB + 524 GB` RAM, `95.15 TiB + 41.7 TB` striped Managed Disks, `730h/mo`) | **Standby**: passive DR replica (`$0` SQL license w/ SA; OS PAYG vs. AHB). **Failover**: active SQL license/AHB sensitivity |
| **Cross-Sheet Host Overlap** | Explicit identity ledger (`sku-mapping.json`) flags potential `VMware`/`Nutanix` vs. `SQL_Servers`/`Oracle` overlap | Publishes **Unadjusted Sum (Upper Bound)** as primary ROM + **Deduplicated Sensitivity Delta** if DB VMs are subset rows |
| **VMware (`153`) & Nutanix (`110`)** | `142` VMware + `108` Nutanix replicated via ASR (`0h/mo` compute in Standby; `730h/mo` in Failover) | Replica Managed Disks (`1/Month`) billed `100%` in Standby; `13` legacy/appliance exception VMs routed via Veeam |
| **AWS Estate (`51` apps + NVAs)** | `68` EC2 via ASR (`0h` Standby / `730h` Failover); `12` EKS (`33` nodes) -> AKS pilot-light; `282` ECR -> ACR Premium | `22` RDS (`13` PG/MySQL/SQL PaaS + `9` Oracle IaaS); Hub security uses **FortiGate + FortiWeb NVAs** (`RFI-OBJ-04`, not Azure FW) |
| **Storage, Veeam & DDVE (`256 TB`)** | `538.3 TB` S3 (incl. `493.33 TB` Veeam) -> Blob/ADLS (`swedencentral`) + `256 TB` DDVE Hot Blob (`Sheet 8`) | Models `256 TB` configured DDVE upper bound + post-dedup/Veeam-overlap sensitivity + **Blob Reserved Capacity** (`100 TB`/`1 PB`) |
| **ASR Intro vs. Steady-State** | **Month 1**: ASR protection fee `$0` (first 30 days free); **Month 2+**: recurring per-protected-instance fee | `318` ASR instances (`142` VMware + `108` Nutanix + `68` EC2); `3%` daily churn (`daily_churn_pct: 0.03`) |
| **Operational Profiles** | **Standby (Mo 2+)**: `730h` 24x7/pilot-light, `0h` cold ASR VMs; **Failover**: `730h` all; **Drill**: `+48h` incremental | `1-Yr`/`3-Yr` RIs applied **only** to `730h` 24x7 resources; Drill reports **incremental burst delta** above Standby |

---

## 4. Code-Verified APEX Cost Engine Constraints (Why Partitioning Is Required)

Inspection of `tools/scripts/cost-estimate.mjs`, `tools/scripts/fetch-retail-price-evidence.mjs`, and a live `uaenorth`
retail probe established eight hard invariants that Autopilot must design around in WS1-WS4 and fix upstream in WS5:

1. **G1 — Missing BCDR/Network/HSM Recipes (`cost-estimate.mjs:48-103`)**: `serviceRecipe()` returns `undefined` for
   `Site Recovery`, `Backup`, `Virtual Network Gateways`, `ExpressRoute`, `Cloud HSM`, `Payment HSM`, `Load Balancer`,
   `Data Factory`, `Synapse Analytics`, and `Microsoft Fabric`. Because `validateBillableDimensions()` (`line 101`)
   checks `serviceRecipe()` before `purpose === "rate-quote"`, **both** `monthly-estimate` and `rate-quote` reject
   these services.
2. **G2 — Per-SKU Query Group Cap & Shared 20-Call Directory Ledger (`cost-estimate.mjs:39, 540-591, 1317`;
   `pricing-evidence.mjs:125, 236-265`; `fetch-retail-price-evidence.mjs:413-429`)**: `normalizeCostRequest()` hashes
   `queryGroups` per `line.sku` (`<= 20`), and `evidenceDirectory(output)` counts **every** MCP call, retry, and
   paginated direct-API page (up to 4 pages per fallback) against one directory-wide `20`-request ceiling. Each domain
   bundle must therefore live in its **own subdirectory** with **`<= 8` query groups** and narrow OData filters.
3. **G3 — Consumption-Only Hardcoding (`cost-estimate.mjs:1352-1358, 1396`; `fetch-retail-price-evidence.mjs:55`)**:
   `validateLinkedPricing()` throws if `first.type !== "Consumption"` or if `license`, `pricing_context`, or non-PAYG
   `commitment` fields are present; `fetch-retail-price-evidence.mjs` also rejects `priceType !== "Consumption"`.
   Reserved Instance (`priceType: "Reservation"`) and Blob Reserved Capacity rates must be captured in WS3.
4. **G4 — Stripped `tierMinimumUnits` & Multi-Band Fallback Precondition (`cost-estimate.mjs:1403-1411`;
   `fetch-retail-price-evidence.mjs:179-190`)**: `@azure/mcp` strips `tierMinimumUnits` (`null`), which
   `cost-estimate.mjs` allows only for single fixed-hourly meters (`tier_metadata_status: "not-applicable-fixed-hourly"`).
   Meanwhile, `fetch-retail-price-evidence.mjs` accepts `kind: "missing_tier_metadata"` **only** when MCP returns
   multiple distinct-rate rows. Single-row non-hourly meters (`1/Month`, `1 GB/Month`) whose MCP output has
   `tierMinimumUnits: null` cannot use `missing_tier_metadata` and must be routed cleanly to WS3 if blocked.
5. **G5 — Multi-Dimension PaaS Coverage & `calculateScenarios()` Limits (`cost-estimate.mjs:56-125, 1485-1505,
   2250-2298`)**: PaaS recipes (`Storage`, `PostgreSQL`, `MySQL`, `Private Link`, `NAT Gateway`, `DNS`, `Bandwidth`)
   require explicit `usage[]` coverage for **every** recipe dimension (`zero_usage_confirmed: true` allowed for `0`).
   `calculateScenarios()` rejects `quantity: 0` and multi-component `usage_amount` overrides (`components.length !== 1`),
   but **does** scale validated single-meter hourly VM lines via `usage_amount` (`0`, `48`, `730`) because mandatory
   `unit_conversion` routes hourly math through `usageAmount` (`cost-estimate.mjs:690-704`).
6. **G6 — Missing Workbook/RVTools-to-SKU Multi-Constraint Bin-Packer**: Large spreadsheets (`340+` rows across 8 tabs)
   lack a deterministic right-sizer enforcing simultaneous CPU, RAM, disk-count, >32 TiB striping, and constrained-vCPU
   rules.
7. **G7 — Missing Multi-Estimate Portfolio Rollup Contract**: No native `cost-portfolio-v1` schema aggregates partitioned
   `cost-estimate-v2` bundles, BCDR supplemental evidence, RI/AHB overlays, and third-party BYOL schedules.
8. **G8 — Live-Probed `operating_system: "Linux"` & `1/Month` Disk Validator Traps (`cost-estimate.mjs:1342-1350,
   1465-1477`)**: `validateLinkedPricing()` requires `/\blinux\b/i` inside `productName` when `operating_system: "Linux"`
   is set, but Azure Retail names standard Linux VM products `"Virtual Machines Esv5 Series"` (without `"Linux"`),
   causing guaranteed validation failure. In addition, null-recipe lines without `usage` only pass when `unitOfMeasure`
   is hourly (`1 Hour`), rejecting `1/Month` `Managed Disks` unless explicit monthly `usage` is supplied.

---

## 5. Progress Checklist

- [x] **WS1 — Deterministic Inventory Parser & Azure SKU Bin-Packer** (`binpack_inventory.py` + `sku-mapping.json`)
- [x] **WS2 — Partitioned `cost-estimate-v2` Domain Bundles** (`uaenorth` & `swedencentral` core compute/storage/PaaS)
- [x] **WS3 — Supplemental BCDR, Connectivity, HSM & RI Retail Evidence** (`pricing/supplemental-bcdr/` + SHA-256)
- [x] **WS4 — Portfolio Rollup, 4K Cost Charts & Partner ROM Deliverable** (`NBB_Cloud_DR_RFI.azure-rom-estimate.md`)
- [x] **WS5 — Telemetry Synthesis & APEX Cost Management v2.2 Spec** (`docs/exec-plans/active/apex-cost-management-v2-2-spec.md`)
- [x] **WS6 — End-to-End Verification & Clean Local Checkpoints** (unit tests, URL/lint/hook validation, git status)

---

## 6. Workstream Design & Step-by-Step Instructions

### WS1 — Deterministic Inventory Parser & Azure SKU Bin-Packer

**Goal**: Eliminate manual arithmetic and SKU-name hallucinations by parsing the raw workbook with `openpyxl` and
mapping every row to an Azure SKU family and Managed Disk tier.

**Files to create**:

- `agent-output/nbb-cloud-dr-rfi/scripts/binpack_inventory.py`
- `agent-output/nbb-cloud-dr-rfi/pricing/sku-mapping.json`
- `agent-output/nbb-cloud-dr-rfi/pricing/telemetry-friction-log.json` (initialized here, appended in WS2-WS4)

**Implementation rules**:

1. Read `agent-output/nbb-cloud-dr-rfi/_meta/DR on Cloud RFI.xlsx` across all 8 sheets (`VMware`, `Nutanix`, `Oracle`,
   `SQL_Servers`, `AIX`, `Solaris`, `AWS`, `Cloud_Backup`), preserve merged-cell structure, build an explicit
   **Source-to-Target Identity & Overlap Ledger**, and assert exact control totals matching
   `Request_for_Information_and_Inventory.extracted.md`:
   - `VMware`: `153` rows (`142` ASR-eligible VMs + `11` legacy/appliance VMs; `856` vCPUs; `2,986` GB RAM; `49.83` TB +
     `41,649.55` GB storage)
   - `Nutanix`: `110` rows (`108` ASR-eligible VMs + `2` exception VMs; `534` cores; `1,684` GiB RAM; `28.52` TiB +
     `23,344.27` GiB)
   - `Oracle` (`C2:G13` merged): **12 Oracle 19c EE DBs (`8,152.44 GB` sum in `B14`) consolidated on 1 shared Oracle
     Linux 8 host** (`32` cores, `260 GB` RAM, `730h/mo` 24x7 Data Guard) -> `1x Standard_E32ds_v5` (`uaenorth`)
   - `SQL_Servers` (`G2:G16` merged): `15` Windows SQL Server VMs (`100` vCPUs; `512` GiB + `524` GB RAM; `95.15` TiB +
     `41.7` TB storage; `730h/mo` Always On AGs), including `SQL VM 1` (`8` vCPU, `300 GiB` RAM, `78 TiB` storage)
   - `AIX`: `6` Power9 LPARs (`H3:H4` `800 GB` shared across `LPAR 1-2`, `I3:I5` `500 GB` shared across `LPAR 1-3`,
     `DB LPAR 4` `750 GB / 28.08 TB`, `LPAR 5` `no replication` excluded) -> `partner_schedule.skytap_power9`
   - `Solaris` (`F2:F4` merged): **3 Solaris 11.4 SPARC M8 LDOMs** (`LDOM 1`: `8c / 256 GB / 13 TB`, `LDOM 2`:
     `4c / 70 GB / 6 TB`, `LDOM 3`: `4c / 36 GB / 4 TB` = `16` cores, `362 GB`, `23 TB`) -> `E48ds_v5` (`384 GiB`) +
     `E16ds_v5` (`128 GiB`) + `E8ds_v5` (`64 GiB`) in `uaenorth` (`730h/mo`)
   - `AWS`: `51` apps, `68` EC2, `12` EKS (`33` nodes), `22` RDS (`9` Oracle + `13` SQL/PG/MySQL), `50` S3 buckets
     (`~538.3 TB`, incl. `493.33 TB` Veeam), `282` ECR repos, `2x FortiGate` (`c5n.2xlarge` -> `F8s_v2`/`D8s_v5`),
     `2x FortiWeb` (`r5.xlarge` -> `E4ds_v5`), and `App 19` `4x CloudHSM` -> `Azure Cloud HSM`
   - `Cloud_Backup`: `256 TB` Dell PowerProtect DDVE (`Backup Storage Appliance in AWS`) + On-Prem DDVE/NVE compute VMs
   - **Cross-Sheet Overlap Flagging (RD-02)**: Because anonymized names (`VM 1`..`VM 153`, `SQL VM 1`..`15`) prevent
     silent deduplication, emit both `primary_unadjusted` and `deduplicated_db_overlap_delta` in `sku-mapping.json` so
     the partner can confirm with NBB whether `SQL_Servers` / `Oracle` rows also appear on `VMware`/`Nutanix`.
2. **Multi-Constraint Compute & Disk Bin-Packing (RD-03)**:
   - Normalize decimal (`GB`/`TB`) vs. binary (`GiB`/`TiB`) units explicitly before sizing.
   - Select the lowest-cost catalog-verified SKU in the target region satisfying **all** constraints simultaneously:
     `sku.vcpu >= req_vcpu`, `sku.ram_gib >= req_ram_gib`, and `sku.max_data_disks >= striped_disk_count`.
   - Use **constrained-vCPU SKUs** (e.g., `Standard_E64-16ds_v5` [`16` active vCPU, `512 GiB` RAM, `32` max disks])
     when high-RAM DB hosts have low vCPU (`SQL VM 1`: `8 vCPU / 300 GiB`), avoiding core-license inflation.
   - Stripe any workload exceeding single-disk limits (`> 32 TiB`, e.g., `SQL VM 1` `78 TiB` -> `3x P80 [32 TiB]` or
     Premium SSD v2 equivalents) across multiple disks and assert `striped_disk_count <= sku.max_data_disks`.
   - Never cap or downsize SKUs to fit a bundle count; instead, partition aggregated `(region, armSkuName, os_type,
     profile_role)` buckets across as many WS2 subdirectories (`<= 8` query groups each) as required.
3. Map storage capacities into Managed Disk SKUs (`E10`..`E80` Standard SSD for cold ASR replicas, `P15`..`P80` Premium
   SSD for prod/DB replicas, all with explicit `usage: { amount: 1, unit: "months", scope: "per-instance" }`) and Blob
   lines with complete multi-dimension `serviceRecipe()` inputs.
4. Run a live catalog pre-probe (`prices.azure.com` / `pricing_get`) confirming every selected `(armSkuName,
   productName, skuName, meterName)` exists in `uaenorth` / `swedencentral` before writing `sku-mapping.json`.

**Verification**:

- `python3 agent-output/nbb-cloud-dr-rfi/scripts/binpack_inventory.py --verify` exits `0` and asserts zero undersized
  CPU/RAM/disk assignments, reconciled merged cells, and exact sheet totals.

---

### WS2 — Partitioned `cost-estimate-v2` Domain Bundles (Engine-Native Execution)

**Goal**: Run APEX's native `tools/scripts/cost-estimate.mjs` pipeline (`preflight` -> `reserve-query` -> `issue-query`
-> `pricing_get` -> `capture-response` / `fetch-retail-price-evidence.mjs` -> `publish` -> `validate` -> `scenarios`)
across bounded subdirectories (`<= 8` query groups each) so every supported 1P service passes `validateEstimate()`.

**Directory layout** (dynamically split into `-part1`/`-part2` whenever `query_groups > 8` or estimated calls + pages
exceed `14`, keeping a comfortable margin below `MAX_SHARED_REQUESTS = 20`):

```text
agent-output/nbb-cloud-dr-rfi/pricing/
├── uaenorth-compute-cold/     # Cold ASR target VMs (142 VMware + 108 Nutanix buckets; 730h base -> 0h/48h scenarios)
├── uaenorth-compute-24x7/     # Always-on Solaris (3 VMs), Oracle Linux (1 VM), SQL (15 VMs), FortiGate/FortiWeb/DDVE
├── uaenorth-disks/            # Single-meter Managed Disks (explicit 1/Month usage; 100% standby + failover)
├── uaenorth-paas/             # Complete multi-dimension Storage, Key Vault, ACR, DNS, Monitor, Private Link, NAT
├── swedencentral-compute-cold/# Cold ASR target VMs for 68 AWS EC2 instances (730h base -> 0h/48h scenarios)
├── swedencentral-compute-24x7/# AKS pilot-light pool, 9 Oracle-RDS IaaS VMs, FortiGate/FortiWeb/Veeam VMs (730h)
├── swedencentral-disks/       # AWS EC2/Oracle/AKS Managed Disks (explicit 1/Month usage)
├── swedencentral-data-paas/   # 13 non-Oracle RDS -> PG/MySQL/SQL + 538.3 TB Blob/ADLS + ACR + DNS/PE/NAT/Monitor
└── supplemental-bcdr/         # WS3 (parent-owned): ASR, Backup, VPN/ER, Cloud HSM, LB, RIs, Blob RC, any G4-blocked
```

**Execution protocol per domain bundle (incorporating RD-01, RD-04, RD-05, RD-06, RD-09, RD-12)**:

1. **Preflight-to-Publish Smoke Fixture First**: Before executing all bundles, validate 1 VM + 1 Disk + 1 multi-meter
   Storage smoke fixture end-to-end through `preflight`, `publish`, `validate`, and `scenarios`.
2. **Author `request.json` strictly obeying `cost-estimate.mjs` invariants**:
   - **Cold & 24x7 VM bundles (`Virtual Machines`)**: Single-meter hourly lines (`usage: { amount: 730, unit: "hours",
     scope: "per-instance" }`). For Windows VMs, set `operating_system: "Windows"` and pin `product_name` (`"...
     Windows"`). For Linux VMs, **omit** `operating_system` (avoiding G8 `/\blinux\b/i` rejection on `"Virtual Machines
     Esv5 Series"`) and pin exact `product_name`, `sku_name`, and `meter_name` (`Spot`/`Low Priority` excluded).
   - **Managed Disk bundles (`Managed Disks`)**: Single-meter monthly lines with mandatory explicit `usage: { amount: 1,
     unit: "months", scope: "per-instance" }` (avoiding G8 `line 1465` hourly-only null-usage rejection).
   - **Multi-dimension PaaS bundles**: Include **every** dimension required by `serviceRecipe(line)` (`Storage`:
     `capacity_gb`, `write_operations`, `read_operations`, `egress_gb`; `PostgreSQL`/`MySQL`: `compute_hours`,
     `storage_gb`; `Private Link`: `endpoints`, `data_processed_gb`; `NAT Gateway`: `hours`, `data_processed_gb`;
     `DNS`: `zones`, `queries`), setting `zero_usage_confirmed: true` on zero-valued standby dimensions. Per
     `RFI-OBJ-04`, NBB uses **FortiGate + FortiWeb NVAs**, so do **not** add native `Azure Firewall`.
3. Run `node tools/scripts/cost-estimate.mjs preflight --request <domain>/request.json` and assert `ok: true` and
   `estimated_query_groups <= 8`.
4. **Exact Native Capture Sequence (RD-04)**: For each query group, execute strictly in order:
   `reserve-query` -> `issue-query` -> `azure-mcp-pricing` (`command: "pricing_get"`, `learn: false`) ->
   `capture-response` (recording the actual `native_call_id` and unchanged UTF-8 response bytes so `captured_at >=
   issued_at`). Always narrow queries by `serviceName`, `armRegionName`, and `armSkuName` / `productName` (RD-12).
5. **Tiered Fallback Precondition (RD-06)**: Invoke `node tools/scripts/fetch-retail-price-evidence.mjs` with
   `kind: "missing_tier_metadata"` **only** when MCP returns multiple distinct-rate rows with `tierMinimumUnits: null`
   (such as tiered `Storage` capacity/ops, `Bandwidth`, `DNS`). If a single-row non-hourly meter is blocked by G4
   (`tierMinimumUnits: null` with 1 row, where `fetch-retail-price-evidence.mjs` refuses `missing_tier_metadata` and
   `cost-estimate.mjs` refuses non-hourly `tier_metadata_status`), do **not** fabricate fallback authority — move that
   line cleanly into WS3 (`supplemental-bcdr/`) and record a G4 blocker event in `telemetry-friction-log.json`.
6. Run `publish` and `validate` (`node tools/scripts/cost-estimate.mjs validate --input <domain>/cost-estimate.json`
   `--request <domain>/request.json`) and assert `ok: true`, `status: "COMPLETE"`, `unresolved_items: []`.
7. **Deterministic Scenario Verification (RD-09)**: On `uaenorth-compute-cold` and `swedencentral-compute-cold`, run
   `node tools/scripts/cost-estimate.mjs scenarios` with overrides `{ usage_amount: 0 }` (Standby) and
   `{ usage_amount: 48 }` (48h Drill), asserting exact equality against `0` and `(48 / 730) * failover_monthly_cost`.

---

### WS3 — Supplemental BCDR, Connectivity, HSM & Commitment Retail Evidence (Parent-Owned)

**Goal**: Owned directly by the **parent Autopilot agent** (respecting `cost-estimate-subagent` write-path limits,
RD-07), capture and row-validate every Azure 1P meter blocked by G1, G3, or G4.

**Target meters to query from `https://prices.azure.com/api/retail/prices` (narrowly filtered by `serviceName`,
`armRegionName`, and `armSkuName`/`productName` so each query fits in `1` page and keeps repo size minimal, RD-12)**:

1. **Azure Site Recovery (`serviceName eq 'Site Recovery'`)** in `uaenorth` and `swedencentral`:
   - Model **Month 1 (`$0` introductory first-30-days free)** separately from **Month 2+ Steady-State** recurring
     per-protected-instance rate across `318` ASR instances (`142` VMware + `108` Nutanix + `68` AWS EC2) (RD-08).
2. **Azure Backup (`serviceName eq 'Backup'`)** in `uaenorth` and `swedencentral`:
   - Protected instance fee + Vault-Standard/Archive LRS/GRS/RA-GRS GB/month rates for immutable CBB cyber-recovery.
3. **Connectivity (`serviceName eq 'Virtual Network Gateways'` and `'ExpressRoute'`)**:
   - `VpnGw2AZ` / `ErGw2AZ` gateway hourly meters + ExpressRoute Standard/Premium metered/unlimited port & data rates.
4. **HSM (`serviceName eq 'Cloud HSM'` / `'Key Vault'` Managed HSM pool)**:
   - Hourly HSM cluster/pool meters in `swedencentral` and `uaenorth`. If `uaenorth` has no published retail meter for
     `Cloud HSM` or `Managed HSM`, emit an explicit `unresolved_items[]` entry + nearest-EMEA (`westeurope`) reference
     quote labelled `REGIONAL_METER_ABSENT` (never silently substitute!).
5. **Standard Load Balancer (`serviceName eq 'Load Balancer'`)** (HA ports for FortiGate/FortiWeb NVAs) & any G4-routed
   single-row non-hourly meters.
6. **Commitment & Licensing Overlays (`priceType eq 'Reservation'` & AHB deltas, RD-08)**:
   - `1-Year` and `3-Year` Reserved Instance rates **exclusively** for `730h/mo` 24x7 compute (`Solaris` 3 VMs, `Oracle`
     Linux host, `SQL` 15 base VMs, AKS system pool, FortiGate/FortiWeb/Veeam/DDVE VMs).
   - **Azure Blob Storage Reserved Capacity** (`100 TB` and `1 PB`, `1-Year` and `3-Year`) in `uaenorth` and
     `swedencentral`.
   - **OS vs. SQL AHB Separation (RD-08)**:
     - *Windows Server AHB*: evidenced Consumption price delta between Windows VM meter and base Linux/compute VM meter
       for the exact same `armSkuName` + `armRegionName` (subject to NBB Windows Server SA / Datacenter core rights).
     - *SQL Server DR Licensing*: under active Microsoft Software Assurance, passive DR standby (`Scenario 1` & `2`)
       uses the **free passive failover replica** benefit (`$0` SQL license; base Windows/AHB VM compute only). Under
       **Active Failover (`Scenario 3`)**, report both **SQL License Mobility / AHB reassigned** (`$0` incremental SQL
       meter) and **SQL Server Enterprise PAYG per-vCore** sensitivity in case primary + DR run concurrently!

**Artifacts & Independent Validator (RD-07)**:

- `agent-output/nbb-cloud-dr-rfi/scripts/fetch_supplemental_bcdr_prices.mjs`
- `agent-output/nbb-cloud-dr-rfi/scripts/validate_supplemental_bcdr.mjs` — independent validator asserting for every
  line in `supplemental-estimate.json`:
  1. Raw UTF-8 JSON page exists under `pricing/supplemental-bcdr/evidence/` with matching `response_sha256` and
     `NextPageLink === null`;
  2. Selected `meterId` exists uniquely in `Items[]` and matches declared `serviceName`, `armRegionName` (or `Global`),
     `armSkuName`/`skuName`, `unitOfMeasure`, `currencyCode: "USD"`, `type` (`Consumption` or `Reservation`), and
     current `effectiveStartDate`;
  3. Deterministic tier-band or `retailPrice * quantity * usage` math equals `monthly_cost` within `1e-6`, and missing
     regional meters set `status: "PARTIAL_UNRESOLVED"` with non-empty `unresolved_items[]` (never masking gaps as
     `COMPLETE`).

---

### WS4 — Portfolio Rollup, 4K Cost Charts & Partner ROM Deliverable

**Goal**: Combine validated WS2 `cost-estimate-v2` bundles and WS3 `supplemental-estimate.json` into a single,
auditable portfolio model, render 4K executive charts, and publish the partner-facing ROM document.

**Files to create / update**:

- `agent-output/nbb-cloud-dr-rfi/scripts/build_rom_portfolio.mjs` — deterministic aggregator & verifier that:
  1. Runs `validateEstimate()` on every WS2 bundle and `validate_supplemental_bcdr.mjs` on WS3;
  2. Computes exact totals across five commercial views plus sensitivity bands (RD-02, RD-08, RD-09):
     - **Scenario 1 — Steady-State DR Standby (PAYG: Month 1 Intro vs. Month 2+ Ongoing Monthly & Year-1 Total)**
     - **Scenario 2 — Steady-State DR Standby (Optimized Month 2+: 3-Yr RI on 24x7 + Blob RC + OS AHB + SQL SA Passive)**
     - **Scenario 3 — Full Active DR Failover (30-Day Declaration: All Compute 730h, SQL AHB vs. SQL PAYG Sensitivity)**
     - **Scenario 4 — Scheduled 48-Hour DR Drill (Incremental Burst Delta Only: `+48h` Cold Compute + Temp Test Disks)**
     - **Scenario 5 — One-Time Seeding & AWS `eu-west-1` Egress Exposure** (`~538.3 TB` S3 + EBS/RDS outbound transfer)
     - **Sensitivity Table**: (a) Cross-sheet `VMware`/`Nutanix` vs. `SQL`/`Oracle` deduplication delta; (b) `256 TB`
       DDVE `100%` configured capacity vs. `50%` effective fill / `Veeam 493.33 TB` backup-scope deduplication.
  3. Emits `agent-output/nbb-cloud-dr-rfi/pricing/rom-portfolio-summary.json` (`schema_version: "cost-portfolio-rom-v1"`).
- `agent-output/nbb-cloud-dr-rfi/assets/03-des-rom-cost-breakdown.py` (generating `.svg` + 4K `.png`):
  - Reactivate `apex-python-diagrams` skill before authoring; follow `python.instructions.md` (`ruff` clean, headless
    `Agg` backend, explicit text wrapping, zero text clipping, verified visually via `view` on the rendered `.png`).
  - Two-panel executive visual: Panel A comparing Monthly Run-Rate across `Standby Mo 2+ (PAYG)`,
    `Standby Mo 2+ (Optimized 3-Yr + AHB)`, and `Active Failover (30-Day)` split by `uaenorth` vs. `swedencentral`;
    Panel B showing Steady-State Standby cost drivers by category (`Storage & Blob RC`, `ASR & Backup`,
    `24x7 Hub/Fortinet/HSM`, `24x7 DB & Solaris Compute`) plus incremental `48h Drill` callout.
- `agent-output/nbb-cloud-dr-rfi/NBB_Cloud_DR_RFI.azure-rom-estimate.md`:
  - Executive Summary Table (Month 1, Month 2+ Ongoing, Year-1 Total, Active Failover, and 48h Drill Incremental).
  - Regional & Sheet-Reconciled Breakdown (`VMware`, `Nutanix`, `Oracle 12-DB Shared Host`, `SQL 15 VMs`,
    `Solaris 3 LDOMs`, `AWS 51 Apps + Fortinet + Veeam`, `DDVE 256 TB`, `Shared Hub/Connectivity/Cyber-Recovery`) with
    explicit cross-sheet overlap and DDVE/Veeam sensitivity bands.
  - Per-SKU Bill of Materials (BoM) in collapsible `<details>` blocks citing exact `armSkuName`, `productName`,
    `meterId`, `unitOfMeasure`, `retailPrice`, quantity, hours/GB, and evidence file path.
  - Licensing & Optimization Playbook (ASR 30-day free window, Blob Reserved Capacity, `3-Yr RI` on 24x7 footprint
    only, Windows/RHEL AHB vs. SQL Server SA passive replica rights, and constrained-vCPU DB sizing).
  - Partner, Marketplace & Third-Party Commercial Schedule (`Skytap on Azure` Power9 `5` replicated LPARs, `Stromasys
    Charon-SSP` 3-LDOM license, `Oracle` BYOL / `ODB@Azure`, `Fortinet`/`Veeam`/`Dell DDVE & NVE` BYOL, Partner Managed
    DR services, AWS `eu-west-1` egress).
  - Passage-verified `https://learn.microsoft.com/en-us/...` links on every pricing/licensing rule.
- Cross-link updates in:
  - `agent-output/nbb-cloud-dr-rfi/README.md`
  - `agent-output/nbb-cloud-dr-rfi/00-partner-briefing.md`
  - `agent-output/nbb-cloud-dr-rfi/NBB_Cloud_DR_RFI.azure-response.md` (Section 8 Commercial Framework pointer)

---

### WS5 — Empirical Telemetry & Implementation-Ready APEX Cost Management v2.2 Spec

**Goal**: Synthesize measured telemetry from `nbb-cloud-dr-rfi` (plus read-only inspection of
`agent-output/partner-modernization-factory-v2/03-des-cost-estimate.md` and `agent-output/arcbox-insights/`) into a
complete, backward-compatible upstream engineering specification for `jonathan-vella/apex` (RD-10).

**File to create**:

- `docs/exec-plans/active/apex-cost-management-v2-2-spec.md` (kept `<= 120` chars per line for `markdownlint-cli2`)

**Required sections in `apex-cost-management-v2-2-spec.md`**:

1. **Measured Telemetry Baseline**: Exact counts from `pricing/telemetry-friction-log.json` (total SKUs/disks priced,
   partitions required, MCP calls vs. direct fallback pages, G1/G3/G4/G8 blocker occurrences, evidence KB on disk, and
   wall-clock runtime).
2. **Engine Upgrades (`tools/scripts/cost-estimate.mjs` & `fetch-retail-price-evidence.mjs`)**:
   - **C1 — `serviceRecipe()` & Universal `rate-quote` Escape Hatch**: Add recipes for `Site Recovery`, `Backup`,
     `Virtual Network Gateways`, `ExpressRoute`, `Cloud HSM`, `Payment HSM`, `Load Balancer`, `Data Factory`,
     `Synapse Analytics`, and `Microsoft Fabric`; decouple `purpose === "rate-quote"` from `serviceRecipe()` so any
     valid Azure Retail `serviceName` with `meter_applicability` + `native_unit` can be rate-quoted without code edits.
   - **C2 — Fix G8 Linux OS & Non-Hourly Null-Recipe Validation Bugs**: Fix `operating_system: "Linux"` check (`line
     1342`) to accept non-Windows Azure VM products (`!/\bwindows\b/i.test(productName)` when `serviceName === "Virtual
     Machines"`), fix `1/Month` `Managed Disks` default usage (`1` month), and allow verified single-row direct fallback
     when MCP strips `tierMinimumUnits` on non-hourly meters (`G4`).
   - **C3 — Family/Region Query Coalescing & Request-Scoped Ledgers**: Coalesce `queryGroups` by `(serviceName,
     armRegionName, priceType, currencyCode)` for batched queries, scope `request-ledger.json` per `request_sha256`, and
     introduce explicit budget profiles (`20` single-service / Step 2 default, `60` enterprise portfolio).
   - **C4 — Native `Reservation`, `SavingsPlan`, Blob RC & AHB/Passive-DR Verification**: Support `priceType:
     "Reservation"` (`1 Year` / `3 Years`), `savingsPlan[]`, OS AHB base-compute pairing, passive-DR `$0` license
     annotations, and an invariant rejecting RIs on `< 730h` lines without an explicit break-even proof.
   - **C5 — Multi-State `scenarios` (`Standby`, `Failover`, `Drill`, `IntroMonth1`)**: Support `quantity: 0`,
     `hours_per_month` overrides, multi-component dimension targeting, and incremental delta reporting (`base_scenario`).
3. **Cross-Surface Contract, Migration & Compatibility Matrix (RD-10)**:
   - **`sku-manifest-v1` Schema & `tools/scripts/render-sku-manifest-md.mjs`**: Backward-compatible optional fields for
     `disks[]` (multi-disk striping), `operational_profiles` (`standby_hours`, `failover_hours`), `licensing_posture`
     (`payg | ahb | byol | sa-passive-dr`), and `constrained_vcpu_active_cores`.
   - **`03-Architect` (`.github/agents/03-architect.agent.md:219-297`) ↔ `cost-estimate-subagent`**: Updated request
     contract, write-allowlist expansion for multi-domain `cost-portfolio-v1` outputs, and failure/partial-scope handoff
     rules (`COMPLETE` vs. `FAILED` vs. explicit `Partner Schedule` exclusions).
   - **`challenger-review-subagent` (`cost-feasibility` lens)**: Automated checks catching RI-on-cold-DR anti-patterns,
     unreconciled cross-sheet host overlaps, missing multi-disk striping (`> 32 TiB`), and SQL passive-vs-active license
     omissions.
   - **IaC Budget/Anomaly Alerting vs. Post-Deploy FinOps Boundary**: Clean separation between pre-deployment retail
     estimation (`cost-estimate.mjs` -> `05-IaC Planner` / `06b` / `06t` `Microsoft.Consumption/budgets` thresholds) and
     post-deployment actual-spend/utilization FinOps (`apex-azure-cost-optimization`).
   - **Test Matrix**: Concrete `node:test` suite (`tools/tests/scripts/test_cost_estimate_v2_2.mjs`) covering C1-C5 +
     legacy `cost-estimate-v2` backward compatibility.

---

### WS6 — End-to-End Verification & Local Git Checkpoints

Autopilot must execute every verification block with `set -euo pipefail` (preventing loop exit-code masking, RD-11) and
verify staged hooks before each commit:

```bash
set -euo pipefail

# 1. Inventory reconciliation, supplemental validator & deterministic portfolio verification
python3 agent-output/nbb-cloud-dr-rfi/scripts/binpack_inventory.py --verify
node agent-output/nbb-cloud-dr-rfi/scripts/validate_supplemental_bcdr.mjs --verify
node agent-output/nbb-cloud-dr-rfi/scripts/build_rom_portfolio.mjs --verify

# 2. Native APEX cost-estimate-v2 validation on EVERY generated domain bundle (fail-fast)
BUNDLE_COUNT=0
for req in agent-output/nbb-cloud-dr-rfi/pricing/*/request.json; do
  dir="$(dirname "$req")"
  echo "Validating $dir..."
  node tools/scripts/cost-estimate.mjs validate --input "$dir/cost-estimate.json" --request "$req"
  BUNDLE_COUNT=$((BUNDLE_COUNT + 1))
done
test "$BUNDLE_COUNT" -ge 8

# 3. Evidence directory size cap (<= 5 MB to prevent UTF-8 + base64 repo bloat, RD-12)
PRICING_KB=$(du -sk agent-output/nbb-cloud-dr-rfi/pricing | cut -f1)
echo "Total pricing evidence size: ${PRICING_KB} KB"
test "$PRICING_KB" -le 5120

# 4. Python lint & JS formatting (Prettier runs on staged .mjs in lefthook, RD-11; raw evidence JSON stays untouched)
ruff check agent-output/nbb-cloud-dr-rfi/scripts/ agent-output/nbb-cloud-dr-rfi/assets/
npx prettier --ignore-path /dev/null --check "agent-output/nbb-cloud-dr-rfi/scripts/*.mjs"

# 5. Microsoft Learn URL + anchor verification across ALL touched RFI docs (HEAD -> GET fallback, RD-13)
python3 -c '
import pathlib, re, urllib.error, urllib.request
files = [
  "agent-output/nbb-cloud-dr-rfi/NBB_Cloud_DR_RFI.azure-rom-estimate.md",
  "agent-output/nbb-cloud-dr-rfi/NBB_Cloud_DR_RFI.azure-response.md",
  "agent-output/nbb-cloud-dr-rfi/README.md",
  "agent-output/nbb-cloud-dr-rfi/00-partner-briefing.md",
]
urls = sorted({u for f in files for u in re.findall(r"https://learn\.microsoft\.com/[^\s)>\"`\]]+", pathlib.Path(f).read_text())})
print(f"Checking {len(urls)} Microsoft Learn URLs...")
for u in urls:
    base, sep, frag = u.partition("#")
    status = None
    body = ""
    if not sep:
        try:
            req = urllib.request.Request(base, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                status = resp.status
        except urllib.error.HTTPError as e:
            if e.code not in (403, 405):
                raise
    if status is None or sep:
        req = urllib.request.Request(base, method="GET", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            status = resp.status
            body = resp.read(524288).decode("utf-8", errors="ignore")
    assert status < 400, f"{u} -> HTTP {status}"
    if frag:
        assert f"id=\"{frag}\"" in body or f"name=\"{frag}\"" in body, f"Missing anchor #{frag} in {base}"
print("All URLs and #fragments verified.")
'

# 6. Repository markdown, artifact, branch-scope & staged publication checks
npm run lint:md
node tools/scripts/validate-artifacts.mjs
node tools/scripts/validate-challenger-presence.mjs
bash tools/scripts/validate-branch-scope.sh
```

**Pre-checkpoint staged verification & commit cadence (`feat/nbb-dr-rom-and-cost-management` only — no `git push`)**:

Before each `git commit`, stage only the intended files and run `node tools/scripts/check-publication-scope.mjs markdown`
and `node tools/scripts/check-publication-scope.mjs artifacts` (plus `gitleaks protect --staged` if installed) to verify
all `lefthook` pre-commit gates pass cleanly:

1. `feat: Add inventory bin-packer and retail pricing bundles` (after WS1-WS3 pass validation)
2. `feat: Publish cloud dr retail rom and cost charts` (after WS4 passes validation)
3. `docs: Add cost management v2.2 empirical specification` (after WS5-WS6 pass all checks, updating this plan's
   checkboxes and marking status as `Completed`)

---

## 7. Rubber-Duck Review Dispositions (2026-11-13)

All 13 findings from the adversarial `rubber-duck` review of commit `ffb36ac` have been incorporated into this revision:

| ID | Severity | Finding Summary | Disposition in Plan |
| --- | --- | --- | --- |
| `RD-01` | Critical | Single-meter lines fail multi-dimension PaaS `serviceRecipe()` checks | Fixed in G5 & WS2: separated VM/Disk single-meter bundles from complete multi-dimension PaaS bundles (`zero_usage_confirmed: true`); removed unrequested Azure Firewall |
| `RD-02` | Critical | `Oracle` (12 DBs on 1 Linux host), `Solaris` (3 LDOMs), & cross-sheet overlap | Fixed in Section 3 & WS1: exact merged-cell fidelity + explicit Host Identity & Overlap Ledger with deduplication sensitivity delta |
| `RD-03` | Critical | vCPU-only ratio undersizes `SQL VM 1` (`8c/300 GiB/78 TiB`) & single disk | Fixed in Section 3 & WS1: simultaneous `vCPU + RAM + maxDataDiskCount` right-sizing, constrained-vCPU DB SKUs (`E64-16ds_v5`), and `>32 TiB` multi-disk striping |
| `RD-04` | High | Reversed `pricing_get` vs. `issue-query` dispatch order | Fixed in WS2 Step 4: locked `reserve-query -> issue-query -> pricing_get -> capture-response` sequence |
| `RD-05` | High | `15` query groups + fallback pages can exceed `20`-call ledger | Fixed in G2 & WS2: capped each subdirectory bundle at `<= 8` query groups with dynamic `-partN` splitting |
| `RD-06` | High | Live-probed `operating_system: "Linux"` & `1/Month` Disk bugs + G4 fallback rule | Added G8 & WS2 Steps 2/5: omit `operating_system` on Linux VMs (pin `product_name`), add `1/Month` usage on Disks, route single-row G4 blockers to WS3 |
| `RD-07` | High | Supplemental `COMPLETE` lacked row validator & hit subagent write allowlist | Fixed in Guardrail 6 & WS3: parent agent owns WS3 + independent `validate_supplemental_bcdr.mjs` with `PARTIAL_UNRESOLVED` handling |
| `RD-08` | High | ASR 30-day free intro, OS vs. SQL SA passive DR rights, & `256 TB` DDVE | Fixed in Section 3, WS3 & WS4: separated Month 1 vs. Month 2+ ASR, OS AHB vs. SQL SA passive/failover rights, and DDVE/Veeam sensitivities |
| `RD-09` | High | `calculateScenarios()` `0`/`48`/`730` verification & incremental drill math | Fixed in G5, WS2 Step 7 & WS4: closed-form `0`/`48`/`730` check on cold VM bundles + strictly incremental `48h` drill burst delta |
| `RD-10` | High | WS5 lacked cross-surface migration & compatibility contracts | Fixed in WS5 Section 3: added `sku-manifest-v1`, `03-Architect` ↔ `cost-estimate-subagent`, `cost-feasibility` challenger, and IaC/FinOps matrix |
| `RD-11` | Medium | WS6 loop could mask failures; staged `.mjs` triggers Prettier | Fixed in WS6: added `set -euo pipefail`, `BUNDLE_COUNT` check, `npx prettier --check`, and pre-commit `check-publication-scope.mjs` runs |
| `RD-12` | Medium | Direct fallback UTF-8 + base64 pages could bloat repository | Fixed in WS2, WS3 & WS6: narrow OData `$filter` predicates + hard `<= 5120 KB` (`5 MB`) check on `pricing/` |
| `RD-13` | Medium | URL check omitted `azure-response.md` & `HEAD`-rejected/`#fragment` URLs | Fixed in WS6 Step 5: added `NBB_Cloud_DR_RFI.azure-response.md`, `HEAD -> GET` fallback on `403`/`405`, and `#fragment` HTML anchor check |

<div align="right"><a href="#top"><b>⬆️ Back to Top</b></a></div>
