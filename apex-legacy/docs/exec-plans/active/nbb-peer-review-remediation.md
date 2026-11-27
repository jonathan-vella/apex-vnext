# Execution Plan — NBB Cloud DR RFI Peer-Review & Azure Deprecation Remediation

**Status:** Completed (`RD-01`–`RD-15` + `DEP-01`–`DEP-08` Executed & Verified)<br>
**Created:** 2026-11-14 | **Updated:** 2026-11-14<br>
**Branch:** `feat/nbb-peer-review-remediation`<br>
**Target Package:** `agent-output/nbb-cloud-dr-rfi/`<br>
**Peer Review Input (`71` Open Findings):** `NBB_Cloud_DR_RFI.peer-review.md` (`12 High`, `27 Medium`, `32 Low` = `71`
open findings; `T-01` and `G-05` closed; attached in session folder)<br>
**Azure Deprecation Audit (`8` Official Replacements):** `DEP-01` through `DEP-08` (Section 2B below — mandatory across
all code, ROM/BoQ, diagrams, Markdown, `.pptx`, and `.zip`)<br>
**Cached Verified Learn `<title>` Map (`140+` URLs):**
`/home/vscode/.copilot/session-state/a859d043-9ff7-4e3c-8ac7-5342b2055681/files/verified-learn-titles.json`

---

## 0. Compaction-Proof Progress Snapshot (Read First When Resuming)

- **`WS0` (Plan Hardening)**: **DONE** (`RD-01`–`RD-15` + `DEP-01`–`DEP-08` captured in this file).
- **`WS1` (`_meta/` -> `rfi-docs/` + Extraction Fixes `T-02`–`T-10`)**: **100% DONE & VERIFIED ON DISK** (`git mv`
  staged; `Request_for_Information_and_Inventory.extracted.md` verified with `29` cells across all Sub-Table 7A rows and
  zero `_meta/` links — **do not redo `WS1`**).
- **`WS2`, `WS3`, `WS4` (Pricing Pipeline, 6-Tab Formula `.xlsx` w/ `<v>` Cache, & 4K Diagrams)**: **Upgraded & verified
  on disk for the 71 peer-review items**, and now require **only the fast `DEP-01` / `DEP-02` / `DEP-08` delta pass**
  before committing Checkpoint 1:
  1. Swap retiring `Fsv2` (`Standard_F8s_v2`, `F4s_v2`, `F16s_v2`, `F32s_v2`) -> **`Dlsv5` (`Standard_D8ls_v5`,
     `D4ls_v5`, `D16ls_v5`, `D32ls_v5`)** and retiring `Bv1` (`Standard_B2s`) -> **`Bsv2` (`Standard_B2s_v2`)** in
     `scripts/binpack_inventory.py`, re-run `ws2_bundle_manager.mjs` on only the touched bundles
     (`uaenorth-compute-24x7*`, `swedencentral-compute-24x7*`, `swedencentral-compute-cold-part1`), and capture
     `D8ls_v5` 3-Yr RIs (`$4,218` UAE / `$3,635` SWE — unlocking 3-Yr RI savings on all `4x` FortiGate VMs).
  2. Swap `synapse_swe` (`Synapse DW100c`) -> **`fabric_swe` (`Microsoft Fabric` `F8 = 8 CUs`
     `Data Warehouse Capacity Usage CU` `@ $0.19/CU-hr` = `$1.52/hr` on failover, `$0` paused in standby)** in
     `scripts/fetch_supplemental_bcdr_prices.mjs`, then re-run `validate_supplemental_bcdr.mjs` +
     `build_rom_portfolio.mjs` + `export_partner_boq_xlsx.py` + the 3 diagram scripts (`Synapse DW100c` -> `Fabric F8`).
- **`WS5`, `WS6`, `WS7` (Markdown Deliverables, `.pptx`, `.zip`, Concurrent Audit & PR)**: **READY TO EXECUTE**
  immediately after Checkpoint 1 using the **3-way parallel subagent fan-out** in Section 4 (avoiding monolithic
  escaped-backtick `edit` calls).

---

## 1. Objective & Non-Negotiable Remediation Rules

Remediate all **71 open findings** from the 14 November 2026 two-pass peer review across the NBB Group Cloud DR RFI
package (`Request_for_Information_and_Inventory.extracted.md`, `NBB_Cloud_DR_RFI.azure-response.md`,
`NBB_Cloud_DR_RFI.azure-rom-estimate.md`, `NBB_Cloud_DR_RFI.azure-rom-boq.xlsx`, `00-partner-briefing.md`,
`00-partner-handoff-email.md`, `README.md`, `assets/03-des-*.{py,svg,png}`, `NBB_Cloud_DR_RFI.partner-walkthrough.pptx`,
and `NBB_Cloud_DR_RFI.partner-package.zip`) while preserving 100% arithmetic, inventory, and citation integrity:

1. **Generator-First Rule (Peer Review §2.2):** Never hand-edit a derived output (`rom-portfolio-summary.json`,
   `NBB_Cloud_DR_RFI.azure-rom-estimate.md`, `.xlsx`, `.png`/`.svg`, `.pptx`, `.zip`) without updating its generator
   script first and regenerating deterministically.
2. **Existing Unit-Rate Preservation (Peer Review §2.6):** Do **not** alter existing ROM unit rates on unchanged lines.
   New or modified lines (`X-04`, `X-07`, `X-10`, `X-11`, `C-01`, `C-02`, `C-03`, `C-05`) use live single-page
   `prices.azure.com` evidence in the exact SHA-256 format the ROM already uses (`pricing/`).
3. **Microsoft Learn Evidence Rule (Peer Review §1 & §2.3, §2.8):** Cite **Microsoft Learn** only (with the one explicit
   exception of `https://azure.microsoft.com/pricing/details/site-recovery/` for ASR pricing per `C-09`). Every
   reference must use the **actual `<title>` of the target page** and never claim something the page does not state.
   Where Microsoft Learn has no vendor sizing/support table (Dell DDVE, Stromasys Charon-SSP, Kyndryl Skytap regional
   capacity, RabbitMQ sizing, Oracle core-factor licensing), mark the claim **`vendor confirmation required`**.
4. **Formula-First Workbook Rule (Peer Review §2.7, `W-01`, `W-07`):** Convert Sheet 02 and Sheet 03 to live
   `Rate * Quantity * Usage` formulas **before** recomputing workbook totals, and inject pre-evaluated `<v>` cached
   numeric values into every formula cell so non-recalculating previews (`OneDrive`, `QuickLook`, `data_only=True`) show
   exact totals immediately while Excel still recalculates dynamically on edit.

---

## 2. Locked Decisions (`Section 13 DECIDED` + 14 Nov Owner Confirmations)

| Decision ID                               | Ruling                                        | Exact Modeling & Narrative Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`X-03` (DECIDED)**                      | **`64` AWS EC2 instances via ASR**            | Total ASR = **`314`** (`250` On-Prem + `64` AWS) in every file and chart. The `4` Veeam EC2 instances are **rebuilt on Azure via IaC, not replicated**. `"~331"` becomes **`327`** (`314` ASR + `13` Veeam/appliance exceptions).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`X-05` (DECIDED)**                      | **Follow ROM for 24x7 DB & Solaris**          | `SQL VM 1..15`, `Oracle` shared host, `3` `Solaris` hosts, and `9` `swedencentral` Oracle VMs use **Premium SSD (`P15`–`P70` ZRS; `3 x P80` LRS striped on `SQL VM 1` `Standard_E64-16ds_v5`, noting `16` vCPUs vs `8` source)**. Remove `M32-8ms`, `Premium SSD v2`, and `Ultra Disk` for these hosts across prose and diagrams.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`X-11` (DECIDED + Owner)**              | **RabbitMQ `1 x Standard_D2s_v5`**            | Price `1 x Standard_D2s_v5` Linux (`2 vCPU / 8 GiB`, `730h/mo`, 3-Yr RI in Scenario 2) + `1 x P15 ZRS` in `swedencentral` matching `App 44` `1 x mq.m7g.large` (`RabbitMQ 4.2`; 3-node cluster noted as optional HA upgrade; mark sizing/support **`vendor confirmation required`**, `RD-15`). Remove `Service Bus Premium (1 MU)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **`R-03` (DECIDED)**                      | **`VM148` stays an exception**                | Counts remain `142/11` (VMware) and `250/13` (On-Prem). Correct `VM148` reason to **Windows 10 end of support + ASR blocking new replication from 1 March 2027**; note `VM111` (`CentOS 4/5/6/7`) version check; remove unsourced VDA/multi-session remark.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`R-10` (DECIDED)**                      | **`Apps 17, 18, 48` as ASR VMs**              | Keep the `4` Elastic Beanstalk EC2s inside the `64` ASR instances. Isolate `3 x P1v3` App Service plans in a standalone optional reference quote **outside baseline totals** (`RD-04`) in ROM & Workbook; update Response §4.2 row 5 & §4.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **`C-01` (DECIDED + `RD-01` + `DEP-08`)** | **Price all missing components (modernized)** | Add evidenced lines + stated assumptions + customer questions for: (a) **AD DCs**: `2 x Standard_D2s_v5` Windows (`+ P15 ZRS`) per hub = `4` VMs 24x7; (b) **AKS (`RD-01`)**: `12 x AKS Standard Uptime SLA` (`$0.10/hr`) + **`24 x Standard_D4s_v5`** system nodes (`2/cluster`, `>= 4 vCPU` per Learn `use-system-pools`, `+ 24 x P15 ZRS`; add **Sensitivity `S5`** for consolidating into `2` shared clusters = `4 x D4s_v5`); (c) **Data Platform (`App 40`, `DEP-08`)**: `ADF v2` (`2K` runs + `30` DIU-h standby; `10K` runs + `200` DIU-h failover) + **paused `Microsoft Fabric Capacity (F8 = 8 CUs)`** (`$0` paused standby; `8 CUs x 730h @ $0.19/CU-hr = $1,109.60/mo` in failover via `Data Warehouse Capacity Usage CU` + OneLake shortcuts to ADLS Gen2); (d) **Defender & Sentinel (`RD-14`)**: `Defender for Servers P2` (`$0.02/node/hr` on exact `72` 24x7 VMs in standby and exact `432` active VMs in failover) + `Sentinel Pay-as-you-go` (`150 GB/mo` per hub) + upgrade existing `Log Analytics` lines from `50 GB` to `150 GB/mo` per hub without double counting. |
| **`X-04` (Owner + `RD-09`)**              | **DDVE in `swedencentral` + UAE TBD**         | Move `256 TB` (`238,418.58 GiB`) Hot LRS Blob + `2 x 100 TiB` Hot LRS 3-Yr RC (`$44,767` upfront/block) + `1 x Standard_D32s_v5` (`+ P20 ZRS`, vendor confirmation required) to **`swedencentral`** (recomputing exact Sweden Hot LRS tiered `S2A` `50%` & `S2B` `0%` while preserving Sweden `493.33 TB` Veeam Cool ZRS + `4 x 100 TiB` Cool ZRS RC independently). Keep `2 x Standard_D8s_v5` (`1 x DDVE + 1 x NVE` host placeholder) in **`uaenorth`** with on-prem Data Domain Blob capacity marked **`TBD`** + Customer Question `Q8`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`T-10` (Owner + `RD-02`)**              | **Banner + Purview Release Gate**             | Add **`Microsoft Confidential — Partner Sharing Subject to NDA & Source Label Verification`** header AND an explicit **Purview Label-Owner Release Gate** (`--exclude-restricted-originals` mode on `export_partner_zip.py` withholding `rfi-docs/*.docx/*.xlsx` & verbatim extraction until label owner confirms external sharing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`T-05 / D-01` (Owner)**                 | **Folder Layout Parity**                      | Rename `_meta/` -> **`rfi-docs/`** inside `agent-output/nbb-cloud-dr-rfi/` (with `.docx`, `.xlsx`, `existing-setup.png`, `proposed-setup.png`) and ship `rfi-docs/`, `pricing/`, `scripts/`, `.pptx`, and `.xlsx` so Git, `.zip`, and OneDrive resolve 100% of links identically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`G-05` (DECIDED)**                      | **Keep `"APEX"` footer**                      | Retain `"APEX"` footer on architecture diagrams; no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 2B. Mandatory Azure Deprecation & Official Replacement Ledger (`DEP-01`–`DEP-08`)

Every deprecated, retiring, or legacy-default Azure service/SKU in the package **must** be replaced with its official
Microsoft successor across all scripts, JSON bundles, `.xlsx`, diagrams, Markdown files, and `.pptx`:

| ID           | Deprecated / Retiring Item                                                         | Official Lifecycle Status                                                                                                                            | Official Replacement & Exact Retail / Learn Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`DEP-01`** | **`Fsv2-series` VMs** (`Standard_F8s_v2`, `F4s_v2`, `F16s_v2`, `F32s_v2`)          | **Announced retirement `11/15/2028`**; **blocked in new subscriptions `07/2026`**; 1-Yr/3-Yr RIs discontinued                                        | Replace with **`Dlsv5-series`** (`Standard_D8ls_v5` `8 vCPU / 16 GiB`, `D4ls_v5`, `D16ls_v5`, `D32ls_v5` — `productName: "Virtual Machines Dlsv5 Series"`, `skuName: "D8ls v5"`, `meterName: "D8ls v5"`, SCSI controller compatible with Gen1/Gen2 ASR & Fortinet FortiGate images; Consumption `$0.422/hr` UAE / `$0.364/hr` SWE; **3-Yr RI `$4,218` UAE / `$3,635` SWE**). Remove obsolete notes claiming FortiGate lacks 3-Yr RIs; note `Falsv6` / `Dlsv6` for Gen2 NVMe/MANA workloads. Cite `https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/lifecycle/retirements-and-capacity-restrictions` (`VM size series retirements, capacity growth restrictions, and modernization guidance - Azure Virtual Machines`) and `https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/lifecycle/retirement/retired-sizes-modernization-guide` (`Retired VM sizes modernization guide - Azure Virtual Machines`).                                     |
| **`DEP-02`** | **`B-series v1` VMs** (`Standard_B2s`) & Postgres `Burstable B2s` prose            | **End of Life — Announced retirement `11/15/2028`**; **blocked in new subscriptions `07/2026`**; RIs discontinued                                    | Replace `Standard_B2s` in `binpack_inventory.py` (`8` Linux + `4` Windows cold EC2s in `swedencentral`) & Response prose (`App 41–42`, `App 49–51`) with **`Standard_B2s_v2`** (`productName: "Virtual Machines Bsv2 Series"` / `"Virtual Machines Bsv2 Series Windows"`, `skuName: "B2s v2"`, `meterName: "B2s v2"`, `2 vCPU / 8 GiB`, SCSI controller, `$0.0864/hr` Linux & `$0.0956/hr` Windows in `swedencentral`). Replace `App 43` PostgreSQL `Burstable B2s` prose with **General Purpose `Standard_D2ds_v5` (`2 vCore`)** (already priced inside the `42 vCore` General Purpose `Ddsv5` line).                                                                                                                                                                                                                                                                                                                                                                 |
| **`DEP-03`** | **`Azure Cache for Redis`** (`Basic / Standard / Premium / Enterprise`)            | **Retiring `09/30/2028`**                                                                                                                            | Use **`Azure Managed Redis` (`Memory Optimized M10`, `6 GB` HA, Redis 7.x)** exclusively in ROM (`swe-managed-redis-m10` + 3-Yr RI) and Response (`§4.2 Row 13`, `§4.3 Row 54`, `§10`), explicitly noting Azure Cache for Redis retirement. Cite `https://learn.microsoft.com/en-us/azure/redis/overview` (`What is Azure Managed Redis? - Azure Managed Redis`), `https://learn.microsoft.com/en-us/azure/redis/architecture` (`Azure Managed Redis Architecture - Azure Managed Redis`), and `https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq` (`Frequently asked questions (FAQ) on the retirement of Azure Cache for Redis - Azure Cache for Redis`).                                                                                                                                                                                                                                                                                 |
| **`DEP-04`** | **`Azure Functions Linux Consumption Plan`** (`Dynamic Y1`)                        | **Retiring `09/30/2028`** (`legacy` / `Retired` on `functions-scale`)                                                                                | Specify **`Azure Functions (Flex Consumption Plan)`** (or Premium Plan) exclusively in Response `§4.2 Row 6` & `§4.3 Row 54` (never `"Consumption/Flex Consumption"`). Cite `https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan` (`Azure Functions Flex Consumption plan hosting`). Include `Python 3.11` (EOS `10/31/2027` -> upgrade to `Python 3.12 / 3.13`) in the `X-09` version lifecycle table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **`DEP-05`** | **`Azure Data Box Gateway`** & **`Data Box 80 TB / Heavy`**                        | `Data Box Heavy` **retired**; `Data Box 80 TB` **retiring regionally** for next-gen `120 TB / 525 TB`; `Data Box Gateway` superseded for online sync | Replace all `Data Box Gateway` online sync references (`RFI-ARC-04`, `Sheet 5: AIX`, `§10`) with **`Azure Storage Mover` + `AzCopy`** (`https://learn.microsoft.com/en-us/azure/storage-mover/service-overview`, exact title `Introduction to Azure Storage Mover`), and qualify offline seeding (`§4.4`, Briefing, Email `Q12`, Deck) as **next-generation `Azure Data Box` (`120 TB / 525 TB`, subject to Bahrain/UAE regional order eligibility)** (`https://learn.microsoft.com/en-us/azure/databox/data-box-overview`).                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`DEP-06`** | **Archived `/previous-versions/` `mainframe-rehosting/overview`**                  | **Archived (`previous-versions`)**                                                                                                                   | Delete `[MS-UNIX-REHOST]`, `[PB-UNIX]`, and `[ROM-UNIX]`. Cite active `[General mainframe and midrange refactor]` (`https://learn.microsoft.com/en-us/azure/architecture/example-scenario/mainframe/general-mainframe-refactor`) + `[Constrained vCPU sizes]`, marking **Stromasys `Charon-SSP` SPARC M8 certification** as **`vendor confirmation required (Stromasys)`**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`DEP-07`** | **Key Vault `Access Policies (legacy)`**                                           | **Legacy** — `Azure RBAC` is default & recommended since API `2026-02-01`                                                                            | Replace _"secret access policies"_ in Response `§4.2 Row 16` with **`Azure RBAC data-plane role assignments (`Key Vault Secrets User`/`Key Vault Secrets Officer`)`**, citing `https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-access-policy` (`Azure role-based access control (Azure RBAC) vs. access policies`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **`DEP-08`** | **`Azure Synapse Dedicated SQL Pool` (`DW100c`)** for greenfield `App 40` Redshift | Microsoft Learn advises starting new warehouses on **`Microsoft Fabric Data Warehouse`**                                                             | Replace `Synapse DW100c` in `fetch_supplemental_bcdr_prices.mjs`, ROM, Excel BoQ, Diagrams, Response (`§4.2 Row 11`, `§4.3 Row 42`, `§5`, `§6`, `§8`), Briefing, Email, and Deck with **paused `Microsoft Fabric Capacity (F8 = 8 CUs)`** (`serviceName: "Microsoft Fabric"`, `productName: "Fabric Capacity"`, `armSkuName: "Data Warehouse"`, `skuName: "Data Warehouse Capacity Usage"`, `meterName: "Data Warehouse Capacity Usage CU"`, `$0.19/CU-hr` x `8 CUs` = `$1.52/hr`: **`$0.00/mo` when paused in standby**, **`$1,109.60/mo` across `730h` in active failover**) + **ADLS Gen2 OneLake shortcuts**, citing `https://learn.microsoft.com/en-us/fabric/data-warehouse/data-warehousing` (`What Is Fabric Data Warehouse? - Microsoft Fabric`) and `https://learn.microsoft.com/en-us/fabric/enterprise/pause-resume` (`Pause and resume your Fabric capacity - Microsoft Fabric`). _(Remove `MS-SYNAPSE-PAUSE` or retain only as a legacy fallback note)._ |

---

## 3. Workstream Breakdown & Complete 71-Finding Mapping

### Workstream 1 (`WS1`) — Folder Layout & Source Extraction Hygiene (`T-02`–`T-10`, `D-01`) — **COMPLETED ON DISK**

- [x] **1.1 Rename `_meta/` to `rfi-docs/` (`T-05`, `D-01`):** Moved `agent-output/nbb-cloud-dr-rfi/_meta/` to
      `agent-output/nbb-cloud-dr-rfi/rfi-docs/` via `git mv`; verified all 4 source files and updated `binpack_inventory.py`.
- [x] **1.2 Remediate `Request_for_Information_and_Inventory.extracted.md` (`T-02`–`T-10`):** Verified 30 pipes (`29`
      cells) on every Sub-Table 7A row and zero `_meta/` references.

### Workstream 2 (`WS2`) — Inventory & Retail Pricing Pipeline (`X`, `R-10`, `C`, `DEP-01`, `DEP-02`, `DEP-08`)

- [x] **2.1 Update `scripts/binpack_inventory.py` (`DEP-01`, `DEP-02` Delta on Top of Completed `WS2`):**
  - Replace retiring `Standard_B2s` (`Bv1`) in `VM_CATALOG` with **`Standard_B2s_v2`** (`Bsv2`, `2 vCPU / 8 GiB`,
    `productName: "Virtual Machines Bsv2 Series"` / `"Virtual Machines Bsv2 Series Windows"`, `skuName: "B2s v2"`,
    `meterName: "B2s v2"`).
  - Replace retiring `Fsv2` entries (`Standard_F4s_v2`, `Standard_F8s_v2`, `Standard_F16s_v2`, `Standard_F32s_v2`) in
    `VM_CATALOG` and FortiGate hub assignments (`Hub-FortiGate-UAE`, `Hub-FortiGate-SWE`) with **`Dlsv5`**
    (`Standard_D4ls_v5`, `Standard_D8ls_v5`, `Standard_D16ls_v5`, `Standard_D32ls_v5`,
    `productName: "Virtual Machines Dlsv5 Series"`).
  - Re-run `binpack_inventory.py` and `binpack_inventory.py --verify`.
- [x] **2.2 Selective WS2 Re-Bundle via `scripts/ws2_bundle_manager.mjs` (`DEP-01`, `DEP-02`):**
  - Update `ws2_bundle_manager.mjs` VM product-name / filter allowlist so `Bsv2` and `Dlsv5` match cleanly.
  - Run `node agent-output/nbb-cloud-dr-rfi/scripts/ws2_bundle_manager.mjs prepare` (unchanged bundles stay preserved;
    only `uaenorth-compute-24x7*`, `swedencentral-compute-24x7*`, and `swedencentral-compute-cold-part1` rebuild),
    execute `azure-mcp-pricing` `pricing_get` for the emitted queries in `ws2-dispatch-plan.json`, and run `finalize`.
- [x] **2.3 Update `scripts/fetch_supplemental_bcdr_prices.mjs` & `validate_supplemental_bcdr.mjs` (`DEP-01`, `DEP-08`):**
  - `DEP-01`: In `vm_ri_uae` and `vm_ri_swe`, replace `Standard_F8s_v2` with **`Standard_D8ls_v5`** (`3-Yr RI = $4,218`
    UAE, `$3,635` SWE — all 24x7 VMs now have 100% 3-Yr RI coverage!).
  - `DEP-08`: Replace `synapse_swe` (`Azure Synapse Analytics DW100c`) with **`fabric_swe`**:
    - Filter: `serviceName eq 'Microsoft Fabric'`, `armRegionName eq 'swedencentral'`, `armSkuName eq 'Data Warehouse'`,
      `skuName eq 'Data Warehouse Capacity Usage'`, `priceType eq 'Consumption'`.
    - Line ID: `swedencentral-fabric-f8-warehouse-failover` (`quantity: 8` CUs [`F8`], `usageAmount: 730` hours,
      `appliesTo: ["failover"]`, `$0.19/CU-hr` -> `$0.00` paused in standby, `$1,109.60/mo` in failover; delete obsolete
      `synapse_swe.{json,meta.json}`).
  - Re-run `fetch_supplemental_bcdr_prices.mjs`, `validate_supplemental_bcdr.mjs`, and `build_rom_portfolio.mjs --verify`.

### Workstream 3 (`WS3`) — Formula-Driven Excel BoQ & Cached Values (`W-01`–`W-07`, `DEP-01`, `DEP-08`)

- [x] **3.1 Re-run `scripts/export_partner_boq_xlsx.py` after `WS2` `DEP` Delta:**
  - Update any `Synapse DW100c` / `F8s_v2` label text in `export_partner_boq_xlsx.py` to **`Microsoft Fabric F8 (paused)`**
    and **`Standard_D8ls_v5`**, regenerate `NBB_Cloud_DR_RFI.azure-rom-boq.xlsx`, and pass `--verify` (`727` live
    formulas + cached `<v>` XML values matching `rom-portfolio-summary.json` to `$0.02`).

### Workstream 4 (`WS4`) — 4K Diagrams & Charts (`G-01`–`G-04`, `DEP-08`)

- [x] **4.1 Refresh Diagram Labels & Re-Render (`0` `WARN overflow` lines):**
  - Update `Synapse` -> **`Fabric F8`** in `assets/03-des-normal-and-replication.py` (`"Cool ZRS + Hot LRS + Fabric/ADF"`)
    and `assets/03-des-failover-and-failback.py` (`"Fabric F8 + ADF + Files"`), and re-run all 3 generators in `assets/`
    so `03-des-rom-cost-breakdown.{png,svg}` reflects the exact post-`DEP` `rom-portfolio-summary.json` numbers.
  - **Commit Checkpoint 1 (`WS1`–`WS4`) locally** before starting `WS5`!

### Workstream 5 (`WS5`) — Core Markdown Deliverables (`X-01`–`X-16`, `R-01`–`R-16`, `C-06`–`C-11`, `B`, `E`, `D`)

- [x] **5.1 Remediate `NBB_Cloud_DR_RFI.azure-response.md`:**
  - Apply `T-10` classification header and `R-16` 14 November 2026 date & scope alignment; update `_meta/` links to
    `./rfi-docs/`.
  - Apply `X-01` (`Oracle AI Database@Azure` available in both `uaenorth` & `swedencentral`), `X-02` (ASR Standard/Prem
    SSD v1 only), `X-03` (`314` ASR = `250 + 64`, `4` Veeam rebuilt, `327` total w/ `13` exceptions), `X-04` (`256 TB`
    DDVE in `swedencentral`, on-prem DDVE/NVE capacity `TBD` in `uaenorth`), `X-05` (P-series ZRS/LRS, `E64-16ds_v5` 16
    vCPU vs 8 source, remove `M32-8ms`/Prem SSD v2/Ultra), `X-06` (`Blip`/`Infobip`/`Telesign`, conditional MACC
    wording), `X-07` (Skytap regional assumption, `16 vCPU / 512 GB` Learn limit vs `DB LPAR 4` `20 VP / 750 GB`,
    ExpressRoute/Private Link), `X-08` (Learn RTTs `111/112/119/122 ms`), `X-09` (SQL 2016, Win 2016, MySQL 8.0, AKS
    1.34–1.36, Win 10 March 2027 lifecycle table), `X-10` (`Azure Managed Redis`), `X-11` (`RabbitMQ` `1 x D2s_v5`),
    `X-13` (unified seeding math `80d @ 1 Gbps / 8d @ 10 Gbps`), `X-16` (ExpressRoute ingress free vs Private Link /
    Peering metered).
  - Apply `R-01` (delete `"agentless"`), `R-02` (`23` standalone EC2s in `App 24–35`), `R-03` (`VM148` EOS + 1 Mar 2027
    block), `R-04` (paravirt storage driver check + real `MS-ASR-PHYS` title), `R-05` (`29` ALB/NLB), `R-06` (remove
    `"typo"` on PG 18.3), `R-07` (move `NIM LPAR 6` out of Tier 3), `R-08` (AIX duplicate `G`/`J` columns), `R-09` (`33`
    EKS node assumptions), `R-10` (Beanstalk ASR baseline; App Service optional), `R-11` (`Dedicated HSM` `"being
retired"` + link), `R-12` (all real Learn titles, split `MS-AWS-ID`/`MS-AWS-SEC`, Stromasys vendor confirmation,
    canonical PG/ASR URLs, exact unique URL count), `R-13` (`App 12/15/35/41` cell anomalies), `R-14` (`32 vCPUs` +
    Oracle licensing confirmation), `R-15` (`100 TiB / 1 PiB` units, Hot/Cool/Archive only), and `G-02` (Mermaid §5.1
    naming sync).
  - Expand §9 to the master **12 Customer Clarification Questions (`Q1`–`Q12`)** (`X-12`).
- [x] **5.2 Update `scripts/render_rom_markdown.mjs` & Regenerate `NBB_Cloud_DR_RFI.azure-rom-estimate.md`:**
  - Apply `T-10` banner, `X-01`, `X-04`, `X-06`, `X-07`, `X-09`, `X-14` (`~746 TiB / 763,868 GiB`), `X-15` (`first 31
days`), `X-16`, `R-10` (optional `3 x P1v3` note), `R-14`, `C-06` (`38.97 TB + 1.3 TB`), `C-07` (`VM138`), `C-08`
    (`S1` wording + storage caveat), `C-09` (real Learn titles + ASR pricing URL), `C-10` (descending §2.1 order, `100
TiB`, standalone SQL MI ID), `C-11` (explicit modeling & `C-01` placeholder assumptions section), and `D-02`.
- [x] **5.3 Remediate `00-partner-briefing.md`, `00-partner-handoff-email.md`, and `README.md`:**
  - `00-partner-briefing.md`: Apply `T-10`, `B-01` (separate Payment HSM payShield 10K vs Payment HSM v2 Atalla),
    `B-02` (frame competitive claims appropriately), `B-03` (`"being retired"`), `X-03`, `X-05`–`X-07`, `X-12` (`7`
    aligned Partner Actions `P1`–`P7`), `X-13`, `X-16`, `R-12`, `R-15`.
  - `00-partner-handoff-email.md`: Apply `T-10`, `E-01` (move VM/disk/`~746 TiB` counts to ROM item 3), `E-02` (per-offer
    MACC check), `E-03`, `X-03`, `X-06`–`X-08`, `X-12` (exact `12` Customer Questions `Q1`–`Q12` + `7` Partner Actions
    `P1`–`P7`), `X-13`–`X-16`, `R-03`, `R-12a`, `C-08`, and updated ROM totals.
  - `README.md`: Apply `T-10`, `D-01` (`./rfi-docs/...` links + accurate file inventory), `D-02` (measured tone), `G-04`
    (honest generator prerequisites), and `X-03`–`X-05`, `X-07`, `X-11`, `X-12`, `R-03`, `R-11`, `R-12a`.

### Workstream 6 (`WS6`) — Regenerate Deck (`.pptx`) & Complete Handoff Package (`.zip`)

- [x] **6.1 Update `scripts/export_partner_ppt.py` & Regenerate `NBB_Cloud_DR_RFI.partner-walkthrough.pptx`:**
  - Sync all 12 slides + speaker notes with `T-10` classification footer, updated ROM totals, `314` ASR / `327` VMs,
    `swedencentral` `256 TB` DDVE, `RabbitMQ`, `Azure Managed Redis`, `12` AKS clusters, `12` Customer Questions
    (`Q1`–`Q12`), `7` Partner Actions (`P1`–`P7`), and newly rendered 4K PNG diagrams (`0` out-of-bounds/tight shapes).
- [x] **6.2 Update `scripts/export_partner_zip.py` & Regenerate `NBB_Cloud_DR_RFI.partner-package.zip` (`RD-02`):**
  - Include `rfi-docs/` (with `.docx`, `.xlsx`, `existing-setup.png`, `proposed-setup.png`), `pricing/`, `scripts/`,
    `assets/`, `.xlsx`, `.pptx`, and all Markdown deliverables; support `--exclude-restricted-originals` for the
    `T-10`/`RD-02` Purview label-owner release gate; assert zero `_meta/` or broken internal links.

### Workstream 7 (`WS7`) — End-to-End Verification & Peer-Review Closure Audit

- [x] **7.1 Automated Link, Title, Math & Schema Audit:**
  - Verify `100%` of relative links across all Markdown files resolve inside `agent-output/nbb-cloud-dr-rfi/`.
  - Fetch `100%` of external Microsoft Learn / Azure URLs (`HTTP 200`, zero `/previous-versions/` or broken URLs, real
    page titles matched, exact unique URL count verified).
  - Run `validate_supplemental_bcdr.mjs`, `build_rom_portfolio.mjs`, `export_partner_boq_xlsx.py --verify` (checking
    both `data_only=False` formulas and `data_only=True` cached values), `export_partner_ppt.py --verify`,
    `export_partner_zip.py --verify`, `npm run lint:md`, `npm run lint:json`, and `npm run validate:artifacts`.
- [x] **7.2 Independent `rubber-duck` Final Verification & PR Creation:** Run `rubber-duck` against the remediated
      package, all `71` peer-review findings, and all `8` `DEP-01`–`DEP-08` Azure deprecation replacements, then commit,
      push `feat/nbb-peer-review-remediation`, and open the PR on `jonathan-vella/apex-mine` (reporting the exact PR `#`).

---

## 4. Compaction-Safe Shared Contracts & Fast Parallel Execution Protocol

### 4.1 Why Earlier Single-Threaded Edits Slowed Down & Mandatory Tooling Rules

1. **Never pass >40-line `old_str` blocks with escaped backticks or newline escapes on `.mjs` files:** In
   `scripts/render_rom_markdown.mjs`, construct Markdown via normal JS string arrays (`[...].join("\n")`) or read an
   external `.md` template file so zero nested backtick escaping is needed.
2. **Checkpoint before Fan-Out:** Immediately after finishing the fast `WS2`–`WS4` `DEP` delta (`D8ls_v5`, `B2s_v2`,
   `Fabric F8`), commit Checkpoint 1 (`WS1`–`WS4`) so `rom-portfolio-summary.json`, `.xlsx`, and 4K diagrams are frozen.
3. **3-Way Parallel `general-purpose` Subagent Fan-Out for `WS5` + `WS6.1` (`task` tool, disjoint file sets):**
   - **Worker A (`NBB_Cloud_DR_RFI.azure-response.md` only)**: Applies all `R-*`, `X-*`, `T-06` unnumbered Objective
     references, `DEP-01`–`DEP-08` replacements, unified seeding table (§4.4), master `Q1`–`Q12` (§9), and exact
     `<title>` reference catalog (§10).
   - **Worker B (`scripts/render_rom_markdown.mjs` -> `NBB_Cloud_DR_RFI.azure-rom-estimate.md` + `00-partner-briefing.md`)**:
     Renders the ROM markdown from frozen `rom-portfolio-summary.json` (with `DEP-01`/`02`/`03`/`06`/`08`, descending
     §2.1 table, `S1`–`S5` PAYG/RI/Year-1 table, optional `3x P1v3` reference, and exact Learn `<title>` list) and
     updates `00-partner-briefing.md` (`B-01`–`B-03`, `P1`–`P7`, `DEP-01`–`DEP-08`, exact Learn titles).
   - **Worker C (`00-partner-handoff-email.md` + `README.md` + `scripts/export_partner_ppt.py` -> `.pptx`)**: Applies
     `E-01`–`E-03`, `D-01`–`D-02`, `G-04`, `DEP-01`–`DEP-08`, master `Q1`–`Q12` + `P1`–`P7`, and regenerates + verifies
     `NBB_Cloud_DR_RFI.partner-walkthrough.pptx`.
4. **Concurrent Python Verifier (`WS6.2` + `WS7`):** Parent runs `export_partner_zip.py` (with
   `--exclude-restricted-originals` Purview gate support + `--verify`) and a single `ThreadPoolExecutor(max_workers=16)`
   Python script verifying all relative links, all external HTTP-200 URLs + exact `<title>` matches, cross-file numeric
   parity against `rom-portfolio-summary.json`, and zero residual deprecated terms (`Standard_F8s_v2`, `F4s_v2`,
   `F32s_v2`, `Standard_B2s` v1, `Burstable B2s`, `Data Box Gateway`, `Consumption/Flex`, `Synapse DW100c`,
   `mainframe-rehosting/overview`, `Twilio SendGrid`).

### 4.2 Unified Seeding Arithmetic Contract (`X-13` — Response §4.4/§8.2, Briefing §3, Email `Q12`, & Deck)

- **On-Premises Main DC (`Bahrain` -> `uaenorth` + EMEA Skytap)**:
  - Allocated workbook footprint: `91.5 TB` VMware + `~56.4 TB` (`51.32 TiB`) Nutanix + `8.2 TB` Oracle + `~146.3 TB`
    (`95.15 TiB + 41.7 TB`) SQL + `~48.2 TB` AIX (counting duplicate `G`/`J` once) + `23.0 TB` Solaris = **`~373.6 TB`
    decimal (`~340 TiB`) allocated** _(excluding unstated on-prem Data Domain backup capacity, `Q8`)_.
  - Effective initial transfer (~50–60% active/compressed blocks): **`~185–225 TB`** -> **`~25–30 days` at `1 Gbps`**
    (`~7.5 TB/day` @ 70% utilization) vs. **`~2.5–3 days` at `10 Gbps`** (or next-gen **Azure Data Box `120 TB / 525 TB`**
    where regionally eligible).
- **AWS Ireland (`eu-west-1` -> `swedencentral`)**:
  - Allocated workbook footprint: `~33.3 TB` EC2+EKS EBS + `~25.9 TB` RDS (`22` DBs) + `8.9 TB` Redshift + `538.3 TB` S3
    (`493.33 TB` Veeam + `45.0 TB` App S3) + `~0.48 TB` EFS/FSx = **`~606.9 TB` (`~607 TB`) decimal** _(+ `256 TB` Sheet
    8 DDVE if separate from Veeam S3)_.
  - Transfer duration (`~607 TB`, already compressed/object-backed): **`~81 days` at `1 Gbps`** vs. **`~8.1 days` at
    `10 Gbps`** via parallel `azcopy copy` / ADF + ExpressRoute/Direct Connect.

### 4.3 Master `12` Customer Questions (`Q1`–`Q12`) & `7` Partner Actions (`P1`–`P7`) (`X-12`)

**Master 12 Customer Clarification Questions (`Q1`–`Q12` — Response §9, Email Part A, Deck Slide 11):**

1. **`Q1` — Multi-Region Data Residency & EMEA AIX Placement:** Confirm CBB approval for `uaenorth` (On-Prem DR),
   `swedencentral` (AWS DR), and EMEA Skytap Power9 (`5` AIX LPARs, `~111–122 ms` RTT to UAE per Learn latency stats, vs.
   GoldenGate to `uaenorth` Linux x86), plus any synchronous cross-estate app calls.
2. **`Q2` — Cross-Sheet DB/Guest Host Overlap (`S1`) & `SQL VM 1` (`78 TiB`):** Confirm whether the `15` `SQL_Servers`
   VMs and `1` shared `Oracle` host are standalone or partially duplicated in `VMware`/`Nutanix` (`<= 4` upper-bound
   matches; `SQL VM 3, 7, 8, 13` match vCPU+RAM only), and confirm active DB size vs. backup staging & peak IOPS on
   `SQL VM 1` (`8 vCPU / 300 GiB / 78 TiB`).
3. **`Q3` — AIX `DB LPAR 4` (`20 VP / 750 GB`) & Solaris SPARC M8 Certification:** Confirm peak CPU/RAM on `DB LPAR 4`
   (exceeds standard `16 vCPU / 512 GB` Learn Skytap limits) and `Solaris LDOM 1` (`8c / 256 GB`), share exact SPARC M8
   `sun4v` & Sybase ASE versions, and confirm `AIX LPAR 5` (_"no replication"_) exclusion.
4. **`Q4` — `AWS App 19` Hardware HSM Workload Type (`4x hsm2m.medium`):** Confirm `PKCS#11`/`JCE` (**Azure Cloud HSM**)
   vs. PCI PIN/EMV (**Azure Payment HSM** payShield 10K / **Payment HSM v2** Atalla) vs. REST/CMK (**Managed HSM**), and
   key extractability vs. dual-HSM custodian ceremony.
5. **`Q5` — `13` On-Prem VM Exceptions, `VM148` Win 10 Block & Non-VMware Failback:** Identify Nutanix `VM 96–97`
   (`Appliance`), confirm OS upgrade vs. Veeam backup for `11` legacy VMs (incl. `VM148` Win 10 EOS + ASR new-replication
   block from 1 Mar 2027 & `VM111` CentOS version), verify paravirtualized drivers, and confirm Veeam/VHD failback
   windows for AHV & EC2.
6. **`Q6` — AWS Sheet Anomalies, Coupled RDS Groups & Per-App RTO/RPO:** Confirm `App 10` blank RDS size (`M11`),
   shifted `W/X` S3 cells (`App 10`, `App 11–16`), `App 12/15/35/41` cell anomalies, coupled failover groups (`App
11–16`, `App 17–18`), and per-app RTO/RPO targets.
7. **`Q7` — AWS Backup Overlap (`256 TB` Sheet 8 DDVE vs. `493.33 TB` Veeam S3, `S2A`/`S2B`):** Confirm whether Sheet
   8's `256 TB` AWS appliance is a licensed ceiling (`S2A`) or superseded by `493.33 TB` Veeam S3 (`S2B`), and confirm
   CBB WORM lock retention.
8. **`Q8` — Unstated On-Premises Data Domain & NetWorker Capacity (`X-04`):** Provide logical and post-dedup TB for the
   on-prem Dell EMC Data Domain & NetWorker appliances shown in the Word RFI diagrams so `uaenorth` Hot Blob + RC can be
   added to the `2x D8s_v5` host placeholders.
9. **`Q9` — AKS Consolidation (`12 -> 2` Clusters, `S5`) & EKS Node Sizing:** Confirm whether the `12` EKS clusters can
   consolidate into `2` shared multi-namespace AKS clusters (`S5`) and confirm worker node specs where Sheet 7 omits
   sizes.
10. **`Q10` — Active Directory, Log/SIEM Ingestion & Analytics (`App 40`) Sizing (`C-01`):** Validate `4x` hub AD DCs,
    `150 GB/mo/hub` Sentinel + Log Analytics ingestion, Defender for Servers Plan 2 scope, and paused **Microsoft Fabric
    `F8` Data Warehouse** + ADF assumptions for `App 40` (`8.9 TB` Redshift + `26` Glue jobs).
11. **`Q11` — Software Lifecycle & End-of-Support Remediation (`X-09`, `DEP-04`):** Confirm upgrade plans for `SQL
Server 2016` (EOS July 2026), `Windows Server 2016` (EOS Jan 2027), `MySQL 8.0` (Azure retirement April 2026 ->
    `8.4 LTS`), `Python 3.11` (`App 44` Functions EOS Oct 2027 -> `3.12/3.13`), and `AKS 1.34–1.36` cadence.
12. **`Q12` — Licensing Entitlements (`SA/AHB/BYOL`) & Seeding Bandwidth (`1 Gbps` vs. `10 Gbps`):** Confirm SQL SA
    (passive DR + `16` spare cores for Sweden SQL MI `S4`), Windows Datacenter/Standard SA, Red Hat Cloud Access,
    Oracle/Solaris/Sybase/Fortinet/Veeam/Dell BYOL portability, EA/MACC vs. MCA/CSP vehicle, and `10 Gbps`
    ExpressRoute/Direct Connect availability (`~8.1d` AWS & `~2.5–3d` On-Prem seed vs. `~81d` / `~25–30d` at `1 Gbps`).

**Master 7 Partner Pre-Submission Actions (`P1`–`P7` — Briefing §2, Email Part B, Deck Slide 12):**

1. **`P1` — Populate Commercial Controls in Excel BoQ (`NBB_Cloud_DR_RFI.azure-rom-boq.xlsx`):** Enter MCA/EA discount
   `%` (applied only to unreserved PAYG), Partner markup `%`, one-time setup milestones, and 24x7 Managed DR retainer.
2. **`P2` — Exclude Source AWS `eu-west-1` Outbound Egress:** Keep AWS initial-seed (`~607 TB`) & daily CDC egress on
   Customer's AWS bill (note ExpressRoute ingress is `$0`, while Private Link & VNet peering are metered in 1P tabs).
3. **`P3` — Obtain Written Kyndryl (`Skytap`) EMEA & `DB LPAR 4` Confirmation:** Confirm EMEA Power9 region availability,
   quote `5` AIX LPARs, and verify `DB LPAR 4` (`20 VP / 750 GB` > standard `16 vCPU / 512 GB` Learn limits) vs.
   GoldenGate Linux x86 Option B.
4. **`P4` — Obtain Written Stromasys `Charon-SSP` SPARC M8 Certification & Quote:** Certify `Solaris 11.4` / SPARC M8
   `sun4v` (`LDOM 1` `256 GB` on `E48ds_v5`) and quote 16 emulated cores (retaining Linux x86 Sybase ASE Option B).
5. **`P5` — Confirm `App 19` HSM Type & Marketplace CPaaS Email Relay (`Infobip` / `Telesign` / `Blip`):** Validate
   `Cloud HSM` vs. `Payment HSM` vs. `Managed HSM`, quote an ACS-retirement-guide CPaaS relay on SMTP `:587`, and verify
   MACC eligibility **per offer**.
6. **`P6` — Confirm Dell DDVE (`swedencentral` `256 TB` + `uaenorth` `TBD`), Fortinet, Veeam & RabbitMQ Sizing/BYOL:**
   Validate Dell Hot-Blob & VM sizing, confirm Fortinet BYOL on non-retiring `Standard_D8ls_v5` (with 3-Yr RI), confirm
   RabbitMQ support, and scope non-ASR Veeam/VHD failback hours for AHV & EC2.
7. **`P7` — Verify Microsoft EA/SA, Oracle Core-Factor & Purview Source-Label Clearance:** Audit SQL SA, Windows
   Datacenter SA, Red Hat Cloud Access, and Oracle vCPU licensing, and obtain Purview label-owner sign-off before
   sharing `rfi-docs/` originals externally (`--exclude-restricted-originals`).
