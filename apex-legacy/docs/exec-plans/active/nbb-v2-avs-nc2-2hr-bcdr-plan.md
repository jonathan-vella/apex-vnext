# Execution Plan — NBB Cloud DR RFI v2 Architectural Revision (AVS, NC2, 1:1 DB/K8s, Zero-ASR & 2h BCDR)

**Status:** Completed (`WS1`–`WS6` Verified, Independent Peer Review [`code-review` + `rubber-duck`] Remediated)<br>
**Created:** 2026-11-17 | **Updated:** 2026-11-18<br> **Planned Branch:** `feat/nbb-v2-avs-nc2-2hr-bcdr` (branch from
`main` at `c4cffd8d0318cffa424dd0a36f1b36573bc8beb6`)<br> **Target Package:** `agent-output/nbb-cloud-dr-rfi/`<br>
**Research Artifact:**
`/home/vscode/.copilot/session-state/a859d043-9ff7-4e3c-8ac7-5342b2055681/research/in-short-here-are-the-key-revised-requirements-bcd.md`<br>
**Prior Baseline Plan (Completed):** `docs/exec-plans/active/nbb-peer-review-remediation.md`

---

## 0. Compaction-Proof Progress Snapshot (Read First When Resuming)

- **Research, Architecture Alignment & `/rubber-duck` Plan Review (`DEC-01`–`DEC-06`, `ADJ-01`–`ADJ-04`,
  `RD-V2-01`–`RD-V2-12`)**: **100% COMPLETE & HARDENED**.
- **`WS1` (Inventory Mapping & WS2 MCP Bundles — `binpack_inventory.py` + `ws2_bundle_manager.mjs`)**: **COMPLETE &
  VERIFIED** (`nbb-dr-sku-mapping-v2`, `11` MCP bundles [`8` baseline + `3` optional/R2], `0` unresolved items).
- **`WS2` (Supplemental Retail Pricing & Dual-Region/Single-Region Portfolio Engine —
  `fetch_supplemental_bcdr_prices.mjs` + `build_rom_portfolio.mjs`)**: **COMPLETE & VERIFIED** (`103` supplemental lines
  across `49` single-page queries; `R1` PAYG `$209,174.54/mo` / 3-Yr Opt `$129,689.70/mo` [`-38.00%`]; `R2` PAYG
  `$201,044.95/mo` / 3-Yr Opt `$123,470.74/mo`; `30d` Failover `$235,281.35/mo` PAYG base / `$163,990.02/mo` w/ S2 RIs /
  `$280,582.23/mo` 3B ceiling [`R2` `$226,319.18` / `$156,804.16` / `$271,485.74`]; `48h` Drill `+$2,514.60/drill`).
- **`WS3` (Narrative ROM Markdown + 6-Tab Live-Formula `.xlsx` BoQ — `render_rom_markdown.mjs` +
  `export_partner_boq_xlsx.py`)**: **COMPLETE & VERIFIED** (`NBB_Cloud_DR_RFI.azure-rom-estimate.md` +
  `NBB_Cloud_DR_RFI.azure-rom-boq.xlsx` with `771` live formulas + AST formula engine + `<v>` XML cache parity).
- **`WS4` (4K `dlib` SVG+PNG Architecture Diagrams & Cost Chart — `assets/03-des-*.py`)**: **COMPLETE & VERIFIED** (`0`
  `WARN overflow:` warnings, visually inspected).
- **`WS5` (Parallel Markdown Deliverables & 12-Slide `.pptx` Deck — `NBB_Cloud_DR_RFI.azure-response.md`, `00-*.md`,
  `README.md`, `export_partner_ppt.py`)**: **COMPLETE & VERIFIED** (`848` HTTP-200 verified Microsoft Learn `<title>`
  citations, `0` broken relative links, `0` Mermaid v11 hazards, `12`-slide `.pptx` verified).
- **`WS6` (Split `.zip` Rebuild, Concurrent Verification Suite, Peer Review [`code-review` + `rubber-duck`] &
  GitHub PR)**: **COMPLETE & VERIFIED** (all independent peer-review [`code-review` + `rubber-duck`] findings
  remediated across pricing, AST Excel formula evaluator, diagrams, `.pptx`, and markdown artifacts; Purview
  `--exclude-restricted-originals` smoke-tested in isolated temp dir; byte-exact SHA-256 split `.zip` archives
  rebuilt and verified).

---

## 1. Objective, Non-Negotiable Rules & Locked Decisions (`DEC-01`–`DEC-06` + `ADJ-01`–`ADJ-04`)

Re-architect and regenerate the NBB Group Consolidated Cloud DR RFI package (`agent-output/nbb-cloud-dr-rfi/`) to
satisfy NBB's revised executive requirements (**`<= 2 hours` failover window**, **separate `<= 2 hours` planned
failback window**, **predictability over cost optimization**, **minimal topology change**,
**`VMware -> AVS -> VMware`**, **`Nutanix -> NC2 on Azure -> Nutanix`**, **`1:1` Database and Kubernetes servers with
zero consolidation**, and **`100%` ASR elimination [`314` former ASR instances -> `0`; `327` total source-replicated
VMs covered natively, `RD-V2-07`]**).

### 1.1 Non-Negotiable Engineering & Repo Rules

1. **Generator-First Rule**: Never hand-edit derived outputs (`sku-mapping.json`, `rom-portfolio-summary.json`,
   `NBB_Cloud_DR_RFI.azure-rom-estimate.md`, `NBB_Cloud_DR_RFI.azure-rom-boq.xlsx`, `assets/03-des-*.{svg,png}`,
   `NBB_Cloud_DR_RFI.partner-walkthrough.pptx`, or the two `.zip` archives). Update the generator scripts first and
   regenerate deterministically.
2. **Live SHA-256 Retail Evidence Rule**: Every new or regionalized line (`germanywestcentral` compute/PaaS/storage,
   `AV48`/`AV64` AVS hosts, `AN36P`/`AN64` NC2 bare-metal hosts, `Azure NetApp Files`, `Azure Route Server`,
   `4x 4-vCore` SQL MI, `5` `1:1` PostgreSQL servers, warm AKS/Fabric readiness) must be backed by live
   `prices.azure.com` evidence in `pricing/` with verified SHA-256 digests.
3. **Microsoft Learn Evidence & Vendor Confirmation Rule**: Cite official **Microsoft Learn** pages using their exact
   `<title>` text (verified via HTTP 200). Where vendor hardware emulation, third-party hosting, or
   Broadcom/Nutanix/Oracle licensing sits outside Microsoft's unilateral authority, explicitly mark claims
   **`vendor confirmation required`** (especially Kyndryl Power10 AIX, Stromasys Charon-SSP/4V+ Solaris, Nutanix
   NDB/NearSync/failback, and Zerto/Veeam cross-cloud EC2 timings).
4. **Preserve Deprecation Cleanliness (`DEP-01`–`DEP-08`)**: Retain all official modernizations from PR `#40` (`Dlsv5`
   for FortiGate, `Bsv2` instead of `Bv1`, `Azure Managed Redis M10`, `Microsoft Fabric F8` instead of Synapse,
   Marketplace CPaaS email instead of ACS, noretired SKUs).

### 1.2 Locked Decisions & Alignment Guardrails Matrix

| ID                      | Topic                                                                                                                                     | Locked Specification (Incorporating `ADJ-01` through `ADJ-04`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`DEC-01` + `ADJ-02`** | **AVS & NC2 Standby Sizing + Warm Readiness (`1.1`, `RD-V2-01`, `RD-V2-08`, `RD-V2-09`)**                                                 | • **Present all 3 AVS/NC2 cluster sizing options** with clear pros, cons, and trade-offs (`RD-V2-01`: qualify `S1`/`S2` as compute-sized targets pending `RVTools` / Nutanix `Collector` consumed-storage and timed DR drill verification, since `5x AV48` = `128 TB` decimal / `~116.4 TiB` raw -> `~58–66 TiB` usable before slack vs. `83.20 TiB` [`85,196.97 GiB` / `~91.5 TB` decimal] provisioned VMware disk, and `5x AN36P` = `103.5 TB` raw vs. `51.3 TiB` provisioned Nutanix disk):<br/> - **Option S1 (Recommended Compute-Sized Target Baseline)**: **Full Pre-Provisioned 24x7 Compute (`5x AV48` Gen 1 for `153` VMware VMs + `5x AN36P` for `110` Nutanix VMs)** — zero bare-metal host build on the 2-hour failover clock; add `+50 TiB` ANF Standard datastore / extra NC2 nodes if consumed storage exceeds `~55 TiB` / `~35 TiB`.<br/> - **Option S2 (Max Host-Failure Resilience)**: **Pre-Provisioned + Dedicated `N+1` Spare Host (`6x AV48` + `6x AN36P` 24x7)** — tolerates a physical host failure mid-disaster.<br/> - **Option S3 (Explicitly Badged _"Cost-Comparison Reference Only — Disqualified for `<= 2h` SLA"_)**: `3x AV48` + `50 TiB` ANF + `3x AN36P` Pilot-Light + parallel host scale-out on failover — shown strictly to illustrate why un-SLA'd bare-metal host allocation risks breaching a 2-hour bank BCP window.<br/>• **Eliminate Cold-Start Bottlenecks (`ADJ-02`, `RD-V2-08`, `RD-V2-09`)**: Keep **`Microsoft Fabric F8` (`8 CUs`) active 24x7 in Standby** (`$1,284.80/mo` Frankfurt PAYG, with verified 1-Yr/3-Yr Fabric RI overlay in Scenario 2), price **`Azure Functions Flex Consumption` (`App 44`, `2048 MB`, `1` scale group, `2` Always Ready instances)** across all 3 `Always Ready` Retail API meters (`Always Ready Baseline` + `Always Ready Execution Time` + `Always Ready Total Executions`, qualifying burst `On Demand` scale-out), and deterministically promote **`1` source-SKU-matched worker VM + disk per EC2-backed EKS cluster (`11` warm + `22` cold = `33` conserved per SKU)**! |
| **`DEC-02` + `ADJ-01`** | **CBB-Gated Regional Strategy (`uaenorth` + `germanywestcentral` vs. `germanywestcentral` Consolidated) (`1.7`, `RD-V2-06`, `RD-V2-11`)** | • **Qatar Central excluded; `swedencentral` retired and replaced by `germanywestcentral` (Frankfurt)** (`3` AZs, `AVS Gen 1 AV48` & `Gen 2 AV64` [`RD-V2-11`: label `AV48` accurately as Gen 1 and note `AV64` for Gen 2 VNet-native], `NC2 AN36P/AN64`, `ANF`, `ExpressRoute Global Reach`, `SQL MI`, `AKS`, full `Microsoft Fabric`, `~8 ms` RTT to Kyndryl `westeurope` Amsterdam, `~18 ms` RTT to AWS `eu-west-1` Dublin).<br/>• **Frame Region Selection as a CBB Gulf-Residency Gate (`ADJ-01`, `RD-V2-04`, `RD-V2-06`)** — **compute and present BOTH architectures with live Retail API pricing**:<br/> - **Architecture R1 (Gulf + EU Residency-Aligned — Primary Priced Baseline on Sheets 01–04)**: **`uaenorth` (Dubai)** for Bahrain On-Prem DR (`AVS Gen 1` + `NC2` via **Azure Route Server + FortiGate HA NVA BGP transit VNet** + `ErGw3AZ` [since ExpressRoute gateways do not transit between circuits and Global Reach is unavailable in UAE, `RD-V2-06`] + `16` DB VMs + `3` Charon-SSP VMs, **conditioned on `uaenorth` AVS/NC2 capacity**) + **`germanywestcentral` (Frankfurt)** for AWS Ireland DR + **Kyndryl `westeurope`** for `5` AIX LPARs.<br/> - **Architecture R2 (Single-Region EU Consolidated — Co-Equal Live-Priced Summary Block on Sheet 01)**: **100% of On-Prem + AWS DR consolidated in `germanywestcentral` (Frankfurt)** (+ `westeurope` `~8 ms` away for Kyndryl AIX) when CBB approves EU DR operation — eliminates duplicate UAE Hub/Fortinet/AD/ER Gateway/HSM, **retains Frankfurt `Azure Route Server` for NC2 Flow VPC BGP (`RD-V2-06`)**, and enables **ExpressRoute Global Reach** (noting carrier circuit eligibility & ExpressRoute Premium SKU across geopolitical boundaries), trading off `~100–110 ms` Bahrain-to-Frankfurt async RTT.<br/> - **Brief Note (`R3`)**: Include a 2-sentence note on Single-GCC Consolidation (`uaenorth`) in case CBB restricts _both_ On-Prem and AWS Ireland estates to the Gulf.                                                                                       |
| **`DEC-03`**            | **100% Zero ASR Portfolio-Wide (`314` Former ASR -> `0`; `327` Replicated VMs) & AWS EC2 Options (`1.2`, `1.3`, `1.6`, `RD-V2-07`)**      | • **Zero ASR across VMware (`153`), Nutanix (`110`), and AWS EC2 (`64`)** (`327` total source-replicated VMs vs. `314` former ASR + `13` former Veeam exceptions, `RD-V2-07`): Remove all `$25/instance` ASR lines, Month-1 `$7,850` ASR credits, `15 TiB` ASR staging cache, and physical-mode ASR failback caveats.<br/>• **Present both Zero-ASR AWS EC2 options** (`64` standalone EC2s; `4` Veeam EC2s rebuilt via IaC, `4` Fortinet NVAs warm HA; Azure 1P prices `64` `1:1` deallocated Azure VMs + Managed Disks while replication software sits on Sheet 05):<br/> - **Option EC2-A (Hybrid)**: Dual-target Packer + Terraform CI/CD Golden Images (`1:1` stopped Azure VMs for stateless/Elastic Beanstalk AL2023 tiers, target `<10m` boot/DNS cutover & failback) + **Zerto / Veeam bidirectional continuous replication** (stateful COTS tiers).<br/> - **Option EC2-B (Uniform)**: **Uniform Zerto / Veeam bidirectional cross-cloud replication** across all `64` EC2s (zero AWS build-pipeline refactoring, higher Sheet 05 license count).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **`DEC-04` + `ADJ-03`** | **`16` On-Prem `1:1` DB Standbys (`15` SQL VMs + `1` Oracle Host) (`1.3`, `1.4`)**                                                        | • **Baseline on `1:1` Dedicated 24x7 Azure `Edsv5` IaaS VMs** (`1x E64-32ds_v5` + `Oracle Data Guard` + `Flashback DB`; `15x Edsv5` + `SQL Distributed AG`, flagging `SQL VM 6` SQL 2016 upgrade/classic-AG requirement for zero-data-loss failback).<br/>• **Protective Framing (`ADJ-03`)**: Explicitly explain that `Edsv5` IaaS protects NBB from **Oracle VMware all-physical-core licensing** (`240+` AVS cores vs. `32` constrained vCPUs) and saves `~145 TiB` of bare-metal flash (`SQL VM 1` = `78 TiB`), while **confirming `AVS / NC2 + ANF / Flow VPC` co-location** for any DB VM requiring identical `vCenter` / `Prism Central` / `Nutanix NDB` operational tooling (and mandating exclusion of active AG/Data Guard volumes from crash-consistent VM snapshot policies).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **`DEC-05`**            | **`1:1` Un-Consolidation of AWS RDS & Kubernetes (`1.4`)**                                                                                | • **AWS RDS SQL Server (`4` instances: `Apps 9, 10, 44, 46`)**: Un-consolidate `2x 8-vCore` -> **`4x 4-vCore` `1:1` Azure SQL Managed Instances (GP)** (`16` total vCores = near-`$0` compute/license delta; bidirectional AWS DMS / transactional CDC for `<= 2h` failback to RDS) **+ document `4x E4ds_v5` SQL Server IaaS VMs as fallback** for custom RDS option groups.<br/>• **AWS RDS PostgreSQL (`5` instances)**: Split pooled `42-vCore` line into **`5` explicit `1:1` PostgreSQL Flexible Server lines** (`App 40` `32c`, `App 17` `4c`, `App 23` `2c`, `App 43` `2c`, `App 48` `2c` = `42` vCores; continuous reverse `pglogical` stream mandatory for `App 40` `19.97 TB` failback).<br/>• **Retain `1:1` Parity**: `4` MySQL Flexible Servers, `9` RDS Oracle Linux VMs, `1` Fabric `F8` DW (`App 40` Redshift), and **`12` `1:1` AKS Standard clusters** (`App 8` Fargate isolated as 12th cluster).<br/>• **Retire Consolidations**: Delete Sensitivity `S5` (`12 -> 2` AKS) and Sensitivity `S1` (`<= 4` SQL VM overlap deduction; keep factual `Q2` inventory question only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`DEC-06`**            | **AVS Native VMware Replication Engine (`1.2`)**                                                                                          | • **Exclusive Native VMware Stack**: **`VMware Live Site Recovery (VLSR 9.0.2.1) + vSphere Replication 9.0.2.1 + VMware HCX 4.11 Network Extension`** across all `153` VMware VMs (`142` mainstream + `11` legacy OS absorbed natively without Hyper-V conversion; `>= 5-min` RPO, bubble-network DR drills, L2 IP preservation, push-button Reprotect, and `<40–60m` planned failback `AVS -> On-Prem VMware`). Do **not** include Zerto on AVS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`ADJ-04`**            | **Full-Portfolio `<= 2h` Evaluation, Clock Boundary, Vendor Gates & Archival Vaults (`1.1`, `1.5`, `RD-V2-05`)**                          | • Include a dedicated **All-Workloads `<= 2h` Failover & `<= 2h` Failback Readiness Matrix** classifying each stream strictly as **`Target Architecture Ready (Drill Verification Required)`**, **`Conditional on Discovery Gate`** (`consumed storage`, `SQL VM 6` 2016, `RDS CDC`, `legacy VMware tools`, `NC2 VM 96–97`), or **`Provisional — Vendor Validation Required (`1.5`)`** (`Kyndryl Power10` & `Stromasys Charon-SSP/4V+` `256 GB` `LDOM 1`), rather than promising unproven sub-hour timings prior to drills (`RD-V2-05`).<br/>• **Explicit Failback Clock Boundary (`RD-V2-05`)**: Define that the planned 2-hour failback window starts at **application ingress quiesce** _only after_ primary site health is verified and online background reverse replication (`VLSR Reprotect`, `NC2 Reverse Recovery Points`, `Flashback DB`, `DAG Resync`, `Reverse CDC/Zerto`) has converged within normal RPO.<br/>• **Archival Backup Vaults (`256 TB` AWS DDVE, `493.33 TB` Veeam S3, On-Prem Data Domain/NetWorker)**: Explicitly classify as **long-term retention & cyber-recovery vaults** outside the 2-hour live application runtime cutover clock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

---

## 2. Verified Azure Retail API Reference (`prices.azure.com` — Live Anchor Table)

Workers executing `WS1` and `WS2` must query live `prices.azure.com` (`api-version=2023-01-01-preview`) and verify
these exact bare-metal and regional meters:

| Service / Resource             | Region                            | SKU / Meter                                       | PAYG Rate                                     | 1-Yr RI Total         | 3-Yr RI Total (`Monthly Equiv`) | Meter ID / Notes                                                                |
| ------------------------------ | --------------------------------- | ------------------------------------------------- | --------------------------------------------- | --------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| **AVS Gen 1 (`VCF BYOL`)**     | `uaenorth`                        | `AV48` (`48c / 1,024 GB / 25.6 TB ESA` — Gen 1)   | `$13.5149/hr` (`$9,865.88/mo`)                | `$80,921`             | `$159,946` (**`$4,442.94/mo`**) | `d8595796-9a39-5af7-b03e-71bc40e11cfa` (`RD-V2-11`: Gen 1)                      |
| **AVS Gen 1 (`VCF BYOL`)**     | `germanywestcentral`              | `AV48` (`48c / 1,024 GB / 25.6 TB ESA` — Gen 1)   | `$13.274786/hr` (`$9,690.59/mo`)              | `$79,424`             | `$156,793` (**`$4,355.36/mo`**) | `1584e67f-bb45-5825-973a-1c8fd454ed5c` (`RD-V2-11`: Gen 1)                      |
| **AVS Gen 2 (`VCF BYOL` Alt)** | `uaenorth` / `germanywestcentral` | `AV64` (`64c / 1,024 GB` — Gen 2 in GWC)          | `$14.22` / `$13.97/hr`                        | `$83,844` / `$82,319` | `$162,174` / `$159,120`         | `7e523ad2-...` / `03718aed-...` (Gen 2 VNet-native in GWC)                      |
| **NC2 on Azure (`CBL BYOL`)**  | `uaenorth`                        | `AN36P` (`skuName: ANRN36P`, `36c / 768 GB`)      | `$6.68177/hr` (`$4,877.69/mo`)                | `$37,287`             | `$74,291` (**`$2,063.64/mo`**)  | `3aa3a6bb-658d-51a9-b53f-b19e360b725a`                                          |
| **NC2 on Azure (`CBL BYOL`)**  | `germanywestcentral`              | `AN36P` (`skuName: ANRN36P`, `36c / 768 GB`)      | `$6.547/hr` (`$4,779.31/mo`)                  | `$36,535`             | `$72,795` (**`$2,022.08/mo`**)  | `a3418cbb-6d32-59ce-8310-341ac019cd81`                                          |
| **ANF Standard (Optional)**    | `uaenorth` / `germanywestcentral` | `Standard Capacity` (`50 TiB = 51,200 GiB`)       | `$0.000288/GiB-hr` (UAE; query GWC live)      | `100 TiB` RI          | `100 TiB` RI                    | Optional toggle if consumed VMware disk `> 55 TiB`                              |
| **Azure Route Server**         | `uaenorth` & `germanywestcentral` | `Virtual Network Route Server` (`730h`)           | Query `serviceName eq 'Virtual Network'`      | N/A                   | N/A                             | Required in **both** `R1` (AVS+NC2 BGP) and `R2` (NC2 Flow VPC BGP, `RD-V2-06`) |
| **SQL MI GP (`1:1` `4x 4c`)**  | `germanywestcentral`              | `sku: "4 vCore"` (`meterName: "vCore"`, `qty: 4`) | Query `germanywestcentral` live               | 1-Yr RI               | 3-Yr RI (`16 vCore` total)      | Native `armSkuName` is empty in GWC; match on `skuName: "4 vCore"` (`RD-V2-02`) |
| **Managed Redis (`M10`)**      | `germanywestcentral`              | `M10 Cache Instance` (`qty: 2` HA nodes, `730h`)  | Query `germanywestcentral` live               | `ri_available: false` | `ri_available: false` (PAYG)    | GWC returns Consumption only; handle missing RI gracefully (`RD-V2-03`)         |
| **Microsoft Fabric (`F8`)**    | `germanywestcentral`              | `F8` (`8 CUs` `Data Warehouse Capacity Usage CU`) | Query `germanywestcentral` live (`730h` 24x7) | Fabric 1-Yr RI        | Fabric 3-Yr RI (`verified`)     | Unpaused 24x7 in v2 per `ADJ-02`; verify live 3-Yr RI meter                     |

---

## 3. Workstream Execution Plan (`WS1` – `WS6`)

### `WS1` — Inventory Mapping & WS2 MCP Bundles (`binpack_inventory.py` + `ws2_bundle_manager.mjs`)

1. **Update `agent-output/nbb-cloud-dr-rfi/scripts/binpack_inventory.py`**:
   - **VMware (`153` VMs: `856` vCPU, `2,986 GB` RAM, `~83.20 TiB` [`85,196.97 GiB` / `~91.5 TB` decimal])**:
     - Stop emitting `153` cold Azure IaaS VMs (`uaenorth-compute-cold`) and `263` cold Managed Disks
       (`uaenorth-disks-cold`).
     - Emit a structured `bare_metal_clusters.avs` specification in `sku-mapping.json` covering all `153` VMs (`142`
       mainstream + `11` legacy OS absorbed natively via `VLSR 9.0 + vSphere Replication + HCX`):
       - `option_s1_baseline`: `5x AV48` (`240` pCores, `5,120 GB` RAM, `128 TB` raw vSAN ESA, `standby_hours: 730`),
       - `option_s2_n1_spare`: `6x AV48` (`288` pCores, `6,144 GB` RAM, `153.6 TB` raw vSAN ESA,
         `standby_hours: 730`),
       - `option_s3_pilot_light_disqualified_ref`: `3x AV48` + `50 TiB` ANF Standard (`standby_hours: 730`,
         `failover_scale_out_nodes: 2`, `sla_2h_compliant: false`),
       - `anf_optional_datastore_gib`: `51200` (`50 TiB` optional offload toggle if consumed VMware disk `> 55 TiB`).
   - **Nutanix (`110` VMs: `534` cores, `1,684 GiB` RAM, `~51.3 TiB`)**:
     - Stop emitting `110` cold Azure IaaS VMs and cold Managed Disks.
     - Emit `bare_metal_clusters.nc2` covering all `110` VMs (`108` guests + `2` Nutanix appliances `VM 96–97` via
       `Prism Central + Nutanix DR + Flow VPC`):
       - `option_s1_baseline`: `5x AN36P` (`180` pCores / `~140` usable after CVM, `3,840 GB` RAM, `103.5 TB` raw
         flash, `standby_hours: 730`),
       - `option_s2_n1_spare`: `6x AN36P` (`216` pCores, `4,608 GB` RAM, `124.2 TB` raw flash, `standby_hours: 730`),
       - `option_s3_pilot_light_disqualified_ref`: `3x AN36P` (`standby_hours: 730`, `failover_scale_out_nodes: 2`,
         `sla_2h_compliant: false`).
   - **Region Migration (`swedencentral` -> `germanywestcentral`) & Dual-Mode Support (`R1` vs. `R2`)**:
     - Replace `swedencentral` with **`germanywestcentral`** across all AWS DR domains
       (`germanywestcentral-compute-24x7`, `germanywestcentral-compute-cold`, `germanywestcentral-disks-24x7`,
       `germanywestcentral-disks-cold`).
     - Also emit `r2_consolidated_germanywestcentral_overrides` in `sku-mapping.json` so `WS2`/`WS3` can price
       **Architecture R2 (`100%` in `germanywestcentral`)** accurately: the `19` On-Prem 24x7 IaaS VMs (`1` Oracle
       `E64-32ds_v5` + `15` SQL `Edsv5` + `3` Solaris `Edsv5`) and `2` On-Prem DDVE/NVE `D8s_v5` hosts (`21` VMs
       total, excluding duplicate `2` UAE AD DCs, `2` UAE FortiGate, `2` UAE FortiWeb which merge into the single
       Frankfurt hub!) priced in `germanywestcentral`!
   - **AWS EC2 (`64` Zero-ASR App VMs + `4` IaC Veeam + `4` Warm Fortinet) & `12` `1:1` AKS Warm Workers (`ADJ-02`)**:
     - Re-tag the `64` standalone EC2s from `AWS-EC2-ASR` to `AWS-EC2-ZeroASR-Standby` (`standby_hours: 0`,
       `failover_hours: 730`, `drill_hours: 48` — `1:1` pre-staged deallocated Azure VMs + cold replica/golden Managed
       Disks in `germanywestcentral`).
     - **Deterministic Per-Cluster Warm AKS Worker Promotion (`ADJ-02`, `RD-V2-08`)**: For each of the `11` EC2-backed
       EKS clusters (`Apps 1, 2, 3, 4, 5a, 5b, 7, 23, 43, 44, 45`), promote exactly **`1` worker VM + its matched OS
       disk of that cluster's source-mapped Azure SKU** (`t3.2xlarge -> D8s_v5`, `c5.9xlarge -> D48s_v5`,
       `m5.4xlarge -> D16s_v5`, `r6i.xlarge -> E4s_v5`, `m6i.2xlarge -> D8s_v5`, etc.) into
       `germanywestcentral-compute-24x7` / `germanywestcentral-disks-24x7`, leaving the exact remaining **`22`
       workers + `22` disks** in `-cold` (asserting `11 + 22 = 33` per-SKU conservation!).
     - **Exact Fleet Conservation Assertions (`RD-V2-07`)**: Assert `uaenorth` Azure IaaS VMs = **`27` warm + `0`
       cold**; `germanywestcentral` Azure IaaS VMs = **`56` warm (`45 + 11`) + `86` cold (`64` Zero-ASR EC2s + `22`
       burst AKS workers) = `142` total**; portfolio Azure IaaS VMs = **`83` warm standby + `86` cold failover = `169`
       total Azure IaaS VMs** (alongside `263` On-Prem VMs hosted on `AVS` [`153`] + `NC2` [`110`], conserving
       `169 + 263 = 432` total workloads and `327` source-replicated VMs!). Set `asr_protected_instances = 0`
       everywhere; delete `s5_aks_consolidation_12_to_2_clusters`; keep `overlap_ledger` purely as audit metadata
       (`s1_enabled: false`).
2. **Update `agent-output/nbb-cloud-dr-rfi/scripts/ws2_bundle_manager.mjs` & Run MCP Pricing**:
   - Replace `swedencentral-*` bundles with `germanywestcentral-*` bundles (`germanywestcentral-compute-24x7-*`,
     `germanywestcentral-compute-cold-*`, `germanywestcentral-data-paas`, `germanywestcentral-optional-appservice`).
   - Add an `r2-germanywestcentral-onprem-24x7` reference bundle (`optional_slugs`) pricing the `21` On-Prem
     DB/Solaris/Backup VMs in `germanywestcentral` so Architecture R2 uses **exact MCP-verified Frankfurt VM rates**
     rather than approximations!
   - Remove obsolete `uaenorth-compute-cold-*` and `swedencentral-*` bundle directories automatically via
     `ws2_bundle_manager.mjs` cleanup.
   - In `germanywestcentral-data-paas` (`RD-V2-02`): because Frankfurt's `4 vCore` SQL MI meter has an empty
     `armSkuName`, request native **`sku: "4 vCore"`, `sku_name: "4 vCore"`,
     `product_name: "SQL Managed Instance General Purpose - Compute Gen5"`, `meter_name: "vCore"`, `quantity: 4`**
     (`730h` per instance = `16` total vCores, `1:1` un-consolidated per `DEC-05`) and ensure `ws2_bundle_manager.mjs`
     matches cleanly when `armSkuName` is empty.

---

### `WS2` — Supplemental Retail Pricing & Portfolio Aggregator (`fetch_supplemental_bcdr_prices.mjs` + `build_rom_portfolio.mjs`)

1. **Update `agent-output/nbb-cloud-dr-rfi/scripts/fetch_supplemental_bcdr_prices.mjs`**:
   - **Retire All ASR & UAE Cold Disk Lines**: Remove `asr_both` (`$7,850/mo`), `uaenorth-asr-cache-15tb-hot-blob`,
     and `uaenorth-disks-cold-*` (`263` disks).
   - **Add Live Bare-Metal AVS & NC2 Lines + 1-Yr / 3-Yr RI Overlays (`uaenorth` for R1 & `germanywestcentral` for
     R2)**:
     - Query `Specialized Compute` (`Azure VMware Solution` `AV48` & `AV64`, and `Nutanix` `ANRN36P` / `AN64`) in both
       `uaenorth` and `germanywestcentral` (PAYG + 1-Yr RI + 3-Yr RI).
     - Baseline lines (`R1`): `uaenorth-avs-5x-av48` (`qty: 5`, `730h`, `standby` + `failover`) and
       `uaenorth-nc2-5x-an36p` (`qty: 5`, `730h`, `standby` + `failover`), plus structured `cluster_sizing_options`
       (`S1: 5x5`, `S2: 6x6 +N+1`, `S3: 3x3 + 50 TiB ANF [Non-Compliant Cost Ref]`, and optional
       `+50 TiB ANF Standard` capacity pool).
     - Add **`uaenorth-route-server`** (`Virtual Network Route Server`, `730h`) to `uaenorth` Hub Networking for AVS
       Gen 1 + NC2 Flow VPC BGP transit (`R1`), **and** retain **`germanywestcentral-route-server`** in `R2`
       (`germanywestcentral`) because NC2 Flow VPC requires dynamic BGP peering even when AVS uses ExpressRoute Global
       Reach (`RD-V2-06`)!
   - **Regionalize AWS Supplemental Lines (`swedencentral` -> `germanywestcentral`), Handle Missing M10 RI & `1:1`
     Un-Consolidation**:
     - Re-point all AWS supplemental queries (`disks`, `256 TB DDVE Hot LRS + 2x 100 TiB RC`,
       `493.33 TB Veeam Cool ZRS + 4x 100 TiB RC`, `ADLS`, `Azure Files`, `ACR`, `AKS 12x Uptime SLA`,
       `SQL MI 16-vCore license + 1,600 GB storage`, `MySQL 2x4c + 2x2c`, `ADF`, `Defender P2`, `Sentinel`,
       `Log Analytics`, `Front Door`, `App Gateway`, `ACA`, `Managed HSM`, `ER Gateway`) from `swedencentral` to
       **`germanywestcentral`**.
     - **Graceful Missing-Reservation Handling (`RD-V2-03`)**: Because `germanywestcentral` Azure Managed Redis `M10`
       currently exposes Consumption only (`0` RI rows), set `managed_redis_m10_reservation_3y.ri_available = false`
       (`monthly_equiv_total = payg_monthly`, `$0` RI savings) instead of throwing an assertion error.
     - **Split PostgreSQL into `5` Explicit `1:1` Lines (`DEC-05`)**:
       1. `gwc-pg-flex-app40-32vcore` (`qty: 32`, `App 40` analytical PG),
       2. `gwc-pg-flex-app17-4vcore` (`qty: 4`, `App 17`),
       3. `gwc-pg-flex-app23-2vcore` (`qty: 2`, `App 23`),
       4. `gwc-pg-flex-app43-2vcore` (`qty: 2`, `App 43`),
       5. `gwc-pg-flex-app48-2vcore` (`qty: 2`, `App 48`) — totaling the exact `42` vCores across `5` named `1:1`
          servers!
     - **Warm Readiness (`ADJ-02`, `RD-V2-07`, `RD-V2-09`)**:
       - Set **`gwc-fabric-f8-24x7`** (`8 CUs x 730h`) to `appliesTo: ["standby", "failover"]` (with verified 3-Yr
         Fabric Reservation overlay in Scenario 2, and record paused `F8` as an optional sensitivity lever).
       - Price **`Azure Functions Flex Consumption` (`App 44`, `2048 MB` instance memory, `1` HTTP/event scale group,
         `2` Always Ready instances)** across its 3 actual `Always Ready` Retail API meters (`Always Ready Baseline` +
         `Always Ready Execution Time` + `Always Ready Total Executions`, qualifying burst `On Demand` scale-out,
         `RD-V2-09`).
       - Derive `Defender for Servers P2` node counts programmatically from `mapping.fleet_summary` (`RD-V2-07`):
         **`27` UAE + `56` GWC = `83` warm Azure IaaS VMs in R1 standby**, and **`27` UAE + `142` GWC (`56` warm +
         `86` cold) = `169` Azure IaaS VMs in R1 failover** (noting optional Arc-enabled Defender coverage for the
         `263` AVS/NC2 guest VMs separately).
   - **Capture `R2` (`All-in-Germany West Central`) Delta Catalogs**: Query `germanywestcentral` Managed Disks
     (`P80 LRS`, `P70/P60/P50/P30/P20/P15 ZRS`) and VM 3-Yr RIs for the `21` migrated On-Prem DB/Solaris/Backup VMs so
     `build_rom_portfolio.mjs` computes **exact, penny-accurate Scenario 1–4 totals for BOTH
     `Architecture R1 (UAE North + Germany West Central)` and `Architecture R2 (Consolidated Germany West Central)`**!
2. **Update `validate_supplemental_bcdr.mjs` (`RD-V2-10`) & `build_rom_portfolio.mjs`**:
   - **Enforce Strict Region Binding (`RD-V2-10`)**: Upgrade `validate_supplemental_bcdr.mjs` (`:83-92`) to assert
     every line's `arm_region_name` equals `line.region` (allowing `"Global"` only on explicitly global meters such as
     Private Link / SQL MI license) and assert zero `"swedencentral"` leaks across all lines and overlays!
   - Compute `rom-portfolio-summary.json` with:
     - **Primary Baseline (`R1: UAE North + Germany West Central`, `Option S1: 5x AV48 + 5x AN36P`)**:
       - `Scenario 1` (Standby PAYG — Month 1 = Month 2+ since `$0` ASR credit no longer exists),
       - `Scenario 2` (Standby 3-Yr Optimized: 3-Yr RI on `AV48` + `AN36P` + `83` warm VMs + `SQL MI` + `Fabric F8` +
         `Blob RC` + `Windows AHB` + `SQL SA`; `M10` remains PAYG per `RD-V2-03`),
       - `Scenario 3A / 3B` (30-Day Active Failover — hydrating the exact **`86` cold GWC VMs** [`64` Zero-ASR EC2s +
         `22` burst AKS workers], bringing total active Azure IaaS VMs to **`169`**, `RD-V2-07`),
       - `Scenario 4` (48-Hour Quarterly DR Drill — burst compute + clone disks on the `86` GWC cold VMs + egress; AVS
         VLSR bubble drills & NC2 recovery drills run at **`$0` incremental Azure compute** on pre-provisioned hosts).
     - **Co-Equal Regional Summary (`R2: Consolidated All-in-Germany West Central`,
       `Option S1: 5x AV48 + 5x AN36P`)**: Exact `Scenario 1`, `Scenario 2`, `Scenario 3A/3B`, and `Scenario 4` totals
       (reflecting single Frankfurt Hub savings while retaining Frankfurt `Azure Route Server` for NC2 BGP,
       `RD-V2-06`).
     - **Revised Sensitivities & Options Matrix (`rom-portfolio-summary.json`)**:
       - **`OPT-R2` (`All-in-Germany West Central` Single-Region Consolidation vs. `R1` Dual-Region)**,
       - **`OPT-S2` (`6x AV48 + 6x AN36P` Pre-Provisioned + `N+1` Host Resilience)**,
       - **`OPT-S3-REF` (`3x AV48 + 50 TiB ANF + 3x AN36P` Pilot-Light — Badged Non-Compliant Cost Reference Only)**,
       - **`OPT-ANF` (`+50 TiB` ANF Standard Datastore Offload if VMware Consumed Storage `> 55 TiB`)**,
       - **`S-DDVE-50` / `S-DDVE-0` (`50%` / `100%` GWC DDVE Overlap with Veeam S3)**,
       - **`S-SQLMI-AHB` (`16` Spare SQL SA Cores Applied to the `4x 4-vCore` SQL Managed Instances)**,
       - **`S-FABRIC-PAUSE` (Optional Wave-0 Automated Resume of Paused `Fabric F8` instead of 24x7 Unpaused)**.

---

### `WS3` — Deterministic ROM Markdown & 6-Tab Live-Formula `.xlsx` (`render_rom_markdown.mjs` + `export_partner_boq_xlsx.py`)

1. **Update `agent-output/nbb-cloud-dr-rfi/scripts/render_rom_markdown.mjs` ->
   `NBB_Cloud_DR_RFI.azure-rom-estimate.md`**:
   - Render side-by-side Executive Summary tables for **Architecture R1 (`uaenorth` + `germanywestcentral`)** and
     **Architecture R2 (`Consolidated germanywestcentral`)**, plus all **3 AVS/NC2 Cluster Sizing Options (`S1`, `S2`,
     `S3-Ref`)**, **both AWS EC2 Zero-ASR Options (`EC2-A`, `EC2-B`)**, and `1:1` DB/K8s tables.
   - Update Section 6 Partner / BYOL Schedule to cover:
     1. **Broadcom VMware Cloud Foundation (VCF) + VMware Live Site Recovery (VLSR) BYOL Subscriptions** (`240` cores
        for `5x AV48` / `288` cores for `6x AV48`),
     2. **Nutanix Cloud Clusters (NC2) Capacity-Based Licenses (NCI/NCM Pro/Ultimate BYOL)** (`180` cores for
        `5x AN36P` / `216` cores for `6x AN36P`),
     3. **AWS EC2 Cross-Cloud Replication (`Zerto` or `Veeam`)** (comparing Option `EC2-A` Stateful Subset vs. Option
        `EC2-B` All `64` EC2s),
     4. **Kyndryl Cloud Uplift (`IBM Power10` EMEA — Provisional Pending Validation `1.5`)**,
     5. **Stromasys Charon-SSP/4V+ (`SPARC M8` Solaris 11.4 — Provisional Pending `256 GB` Validation `1.5`)**,
     6. **Oracle (`Data Guard` / `Active Data Guard` / `GoldenGate`), Fortinet, Dell DDVE/NVE, RabbitMQ, Marketplace
        CPaaS Email, AWS Egress & Partner MSP/Telecom**.
2. **Update `agent-output/nbb-cloud-dr-rfi/scripts/export_partner_boq_xlsx.py` ->
   `NBB_Cloud_DR_RFI.azure-rom-boq.xlsx` (`RD-V2-04`)**:
   - **Cross-Sheet Formula Coherence (`RD-V2-04`)**: Keep Sheets `02_WS2_Compute_PaaS`, `03_WS3_Disks_Storage_BCDR`,
     and `04_3Yr_RI_and_Blob_RC` strictly bound to **`R1` (`uaenorth` + `germanywestcentral`)**, with Sheet 01's
     **AVS/NC2 Cluster Sizing Selector** (`S1_5X5_BASELINE` / `S2_6X6_N1_SPARE` / `S3_3X3_PILOT_REF`) and **ANF 50 TiB
     Toggle** (`FALSE` / `TRUE`, using `OR(ANF_Toggle, Cluster_Mode="S3_3X3_PILOT_REF")` so `S3 + ANF=TRUE` **never
     double-counts ANF!**) dynamically driving the exact `AV48`, `AN36P`, and `ANF` quantity cells on **Sheet 03 and
     Sheet 04** so Sheet 01 ALWAYS equals `SUM(Sheet02) + SUM(Sheet03) - SUM(Sheet04)`!
   - Present **Architecture `R2` (`Consolidated All-in-Germany West Central`)** in a dedicated, formula-driven
     **Co-Equal Regional Comparison Table on Sheet `01_Executive_ROM_Model`** (adjusting neatly with the `S1/S2/S3`
     and `ANF` selectors without desynchronizing `R1` line items on Sheets 02–04).
   - Test every `S1/S2/S3 x ANF x DDVE x SQLMI_AHB` permutation inside `verify_workbook()` against
     `rom-portfolio-summary.json`, verify `<v>` XML caches, and update the formula-count assertion cleanly.
   - Expand Sheet `05_Partner_BYOL_Schedule` from 8 to 10 structured rows (`Broadcom VCF + VLSR BYOL`,
     `Nutanix NC2 CBL BYOL`, `Zerto/Veeam AWS EC2 DR`, plus existing 7 rows).

---

### `WS4` — 4K `dlib` Architecture Diagrams & Cost Breakdown Chart (`assets/03-des-*.py`)

1. **`assets/03-des-normal-and-replication.py` -> `.svg` + `.png` (`3840x2160`)**:
   - Retitle to reflect **CBB-Gated Architecture (`UAE North + Germany West Central` Baseline |
     `Consolidated Germany West Central` Option, + `West Europe` Kyndryl Power10)**.
   - Replace all `ASR` boxes/arrows/chips with:
     - **AVS Private Cloud (`5x AV48` 24x7)** + **`VLSR 9.0 + vSphere Replication + HCX L2`** (`153` VMware VMs incl.
       `11` legacy OS) connected via **`Azure Route Server + FortiGate HA`** (`R1` `uaenorth`) or
       **`ExpressRoute Global Reach`** (`R2` `germanywestcentral`),
     - **NC2 on Azure (`5x AN36P` 24x7)** + **`Prism Central + Nutanix DR + Flow VPC`** (`110` Nutanix VMs),
     - **`1:1` Dedicated DB VMs (`1x E64-32ds_v5` Oracle Data Guard + `15x Edsv5` SQL Distributed AG)** + conditional
       NDB/NC2 note,
     - **Germany West Central AWS DR Spoke**: `64` Zero-ASR VMs (`Dual CI/CD Golden Images + Zerto/Veeam`),
       `12x 1:1 AKS` (`11` warm + `22` burst workers, `Flux GitOps`, `ACR Sync`), `22x 1:1 DBs` (`4x 4c SQL MI`,
       `5x PG Flex`, `4x MySQL Flex`, `9x Oracle VMs`), `Functions Flex (2 Always Ready)`, `Unpaused Fabric F8`,
     - **Provisional Non-x86 (`1.5`)**: `Kyndryl Power10` (`westeurope` Amsterdam, `~8 ms` to Frankfurt) &
       `Stromasys Charon-SSP/4V+` (`256 GB` gate).
2. **`assets/03-des-failover-and-failback.py` -> `.svg` + `.png` (`3840x2160`)**:
   - Redesign swimlanes to show **Window 1: Unplanned/Planned Failover (`<= 120 Minutes`)**, **Online Background
     Reverse Catch-Up (Outside 2h Clock: VLSR Reprotect, NC2 Reverse Snapshots, Flashback DB / DAG Resync, Reverse
     CDC/Zerto)**, and **Window 2: Planned Failback Cutover (`<= 120 Minutes`)**.
3. **`assets/03-des-rom-cost-breakdown.py` -> `.svg` + `.png`**:
   - Update chart labels (`Germany West Central` + `UAE North`, plus `R2 Consolidated Germany` callout bar/annotation)
     driven directly from `rom-portfolio-summary.json`.
4. **Verify**: Zero `WARN overflow:` output on run, plus visual inspection of rendered PNGs (via temporary preview
   copy if needed, cleaned up immediately).

---

### `WS5` — Parallel Narrative Deliverables & 12-Slide `.pptx` Walkthrough

Fan out 3 parallel `general-purpose` workers once `rom-portfolio-summary.json` and diagrams are locked:

1. **Worker A — `NBB_Cloud_DR_RFI.azure-response.md`**:
   - Rewrite Executive Summary, Regional Gate Banner (`R1: UAE North + Germany West Central` vs.
     `R2: All in Germany West Central`, CBB `OM-2`/`OM-4`/`OM-6` & PDPL checkpoints), and **All-Workloads `<= 2h`
     Failover & `<= 2h` Failback Evaluation Matrix (`ADJ-04`)**.
   - Replace ASR VMware/Nutanix/EC2 design across §§2–8 with:
     - **AVS (`1.2`)**: All 3 sizing options (`S1` `5x AV48`, `S2` `6x AV48 +N+1`, `S3` `3x AV48` non-compliant cost
       ref), `VLSR 9.0 + vSphere Replication + HCX` exclusively (`DEC-06`), Broadcom VCF BYOL (`1 Nov 2025`), ANF
       offload option, and `Route Server + FortiGate` (`uaenorth`) vs. `Global Reach` (`germanywestcentral`).
     - **NC2 on Azure (`1.3`)**: `5–6x AN36P`, Prism Central + Nutanix DR symmetrical failover/failback, Nutanix NDB &
       snapshot-exclusion validation checklist.
     - **`1:1` Databases & Kubernetes (`1.4`)**: Zero consolidation (`4x 4-vCore` SQL MI + `4x SQL VM` fallback, `5`
       discrete PG Flex, `4` MySQL, `9` RDS Oracle, `1` Oracle host, `15` SQL VMs w/ `SQL VM 6` 2016 DAG note,
       protective `Edsv5` vs. `AVS/NC2` framing `ADJ-03`, `12` `1:1` AKS clusters with `11` warm workers).
     - **AIX & Solaris (`1.5`, `ADJ-04`)**: Provisional status pending joint Kyndryl (`Power10` `DB LPAR 4` fit, warm
       `Data Guard` + `PowerHA/MIMIX`) & Stromasys (`Charon-SSP/4V+` `256 GB` `LDOM 1` & `SPARC M8` certification)
       engagement.
     - **AWS Zero-ASR & Dual-Cloud Change Management (`1.6`, `DEC-03`)**: Both Zero-ASR EC2 options (`EC2-A` Hybrid
       CI/CD + Zerto/Veeam vs. `EC2-B` Uniform Zerto/Veeam), `Lambda -> Functions Flex (Always Ready)`,
       `12x EKS -> 12x AKS`, parallel CI/CD & GitOps governance + RACI matrix
       (`Microsoft / Partner / NBB / Specialist Vendors`).
   - Update Mermaid `flowchart` & `sequenceDiagram` (strictly Mermaid v11-safe: no `;`, `->`, or secondary `:` inside
     sequence message labels) and Customer Clarification Questions (`Q1`–`Q12`).
2. **Worker B — `00-rfi-response-guide.md` + `00-partner-briefing.md`**:
   - Synchronize the plain-English guide and Partner executive briefing with `0` ASR, `<= 2h` failover + `<= 2h`
     failback, `R1` vs. `R2` regional options, all 3 AVS/NC2 sizing options, both EC2 Zero-ASR options, `1:1` DB/K8s,
     Kyndryl/Stromasys discovery workshops, and exact v2 ROM totals.
3. **Worker C — `00-partner-handoff-email.md` + `README.md` + `scripts/export_partner_ppt.py` -> `.pptx`**:
   - Update Partner email, package index `README.md`, and all 12 slides of `NBB_Cloud_DR_RFI.partner-walkthrough.pptx`
     so every number, region (`UAE North + Germany West Central` / `Consolidated Germany West Central`), diagram
     embed, and talking point matches `rom-portfolio-summary.json`.

---

### `WS6` — Split `.zip` Packaging, Automated Verification, `rubber-duck` Review & GitHub PR

1. **Rebuild & Verify Split `.zip` Archives (`RD-V2-12`)**:
   - First smoke-test `--exclude-restricted-originals` into an isolated temporary `--output-dir` (or clean up
     immediately) so it never overwrites the standard deliverables (`RD-V2-12`), then run
     `python3 agent-output/nbb-cloud-dr-rfi/scripts/export_partner_zip.py` and `--verify` as the final step to emit
     and verify `NBB_Cloud_DR_RFI.docs-and-assets.zip` and `NBB_Cloud_DR_RFI.commercials-and-tooling.zip` with `0`
     overlap and `100%` file coverage.
2. **Automated Verification Suite**:
   - `python3 agent-output/nbb-cloud-dr-rfi/scripts/binpack_inventory.py --verify`
   - `node agent-output/nbb-cloud-dr-rfi/scripts/validate_supplemental_bcdr.mjs`
   - `node agent-output/nbb-cloud-dr-rfi/scripts/build_rom_portfolio.mjs`
   - `python3 agent-output/nbb-cloud-dr-rfi/scripts/export_partner_boq_xlsx.py` (verifies all live Excel formulas &
     `<v>` caches)
   - Concurrent link, `<title>`, Mermaid syntax, and prohibited-term verifier across all `7` `.md` files (`0` broken
     relative links, `100%` HTTP-200 Microsoft Learn `<title>` parity, `0` residual `"314 ASR"` / `"swedencentral"`
     baseline / `"S5"` consolidation / deprecated SKU references).
   - `npm run lint:md` on repo docs.
3. **Independent `rubber-duck` Final Review**:
   - Run `rubber-duck` across updated scripts, ROM JSON/Markdown, `.xlsx`, `.pptx`, and
     `NBB_Cloud_DR_RFI.azure-response.md`; fix any surfaced arithmetic or cross-document drift before committing.
4. **Git Branch, Commit & PR (When Authorized)**:
   - Create branch `feat/nbb-v2-avs-nc2-2hr-bcdr` off latest `main`, commit cleanly with Conventional Commits, push,
     and open PR on `jonathan-vella/apex-mine`.
