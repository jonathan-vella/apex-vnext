# Execution Plan — BCX / Bidvest Facilities Management (BFM) Integration-Only BAFO Package

**Status:** Complete (`WS1`–`WS6` + Independent `code-review` & `rubber-duck` Peer Review Remediations Verified;
`$3,405.10/mo` | `$40,861.20/yr` | `$204,306.00` 60-Month 1P USD)<br>
**Created:** 2026-11-23 | **Updated:** 2026-11-23<br>
**Target Package:** `agent-output/bcx/`<br>
**Read-Only Source Archive:** `agent-output/bcx/emails/` (must never be modified, moved, or renamed)<br>
**Customer Returnables:** `BFM_Supply_Integrated_Middleware_RFP15092026IT01_BAFO.pdf` (RFP 021509-2026) and
`BFM_BAFO_Sizing_and_Pricing_Schedules.xlsx`

---

## 0. Compaction-Proof Progress Snapshot (Read First When Resuming)

- **Deep Source Audit, Microsoft Learn SKU Re-Validation, POPIA Regulations Audit & `/rubber-duck` Hardening
  (`DEC-01`–`DEC-08`, `RD-01`–`RD-17`)**: **COMPLETE & HARDENED**.
  - Audited all 13 source files in `agent-output/bcx/emails/` and read the gazetted **POPIA Regulations (`GoN R.1383`,
    GG 42110, 14 Dec 2018)** + **17 Apr 2025 Amendment Regulations (`GN 6126`, GG 52523)** in full.
  - Enforced **100% Single-Region (`southafricanorth` only — zero `southafricawest` / `GZRS` / `RA-GZRS`
    multi-region footprint unless explicitly requested via `Incremental Scale` Row 21)**, **zero deprecated or
    superseded SKU versions** (replaced classic v1 `APIM Developer` with current `APIM Basic v2`; eliminated retired
    non-AZ `VpnGw1`, `Basic Public IP`, classic App Insights, legacy Log Alerts, Linux `Consumption` Functions, `GPv1`
    Storage, classic Defender for Storage, and Key Vault access policies), and **100% verified `southafricanorth` GA
    availability** across every scoped SKU.
  - Added an explicit **Keep vs. Discard Audit (`Section 1.4`)** of every discretionary component above minimum RFP +
    POPIA compliance.
- **`WS1` (Live `southafricanorth` USD Retail Evidence Snapshot — `scripts/fetch_retail_prices.py`)**: **COMPLETE** (`50`
  unambiguous verified meters + SHA-256 request ledger).
- **`WS2` (Deterministic Live-Formula BAFO `.xlsx` Builder & AST Engine — `scripts/build_bafo_workbook.py`)**:
  **COMPLETE** (`544` live formulas AST/`<v>`-verified w/ Excel `ROUND_HALF_UP`; `$3,405.10/mo` | `$40,861.20/yr` |
  `$204,306.00` 60-month).
- **`WS3` (4K `dlib.py` SVG+PNG Architecture Diagrams & Cost Chart — `assets/03-des-*.py`)**: **COMPLETE** (`0` overflow
  warnings; visually verified).
- **`WS4` (Architecture Decision Records `03-des-adr-0001` to `03-des-adr-0005`)**: **COMPLETE** (WAF + statutory POPIA
  `GoN R.1383` + `GN 6126` mapped).
- **`WS5` (Evidence & Provenance, Changelog, Technical Response, Partner Briefing, Email & `README.md`)**: **COMPLETE**.
- **`WS6` (Verification Suite: `emails/` Integrity, AST Formula/Cache/Mutation Parity & Link Checks)**: **COMPLETE**.

---

## 1. Objective, Non-Negotiable Guardrails & Locked Decisions (`DEC-01`–`DEC-08`)

Build a clean, self-contained **Microsoft 1P Azure Architecture & Commercial Advisory Package** in `agent-output/bcx/`
for **BCX** to submit Bidvest Facilities Management's (**BFM**) Best and Final Offer (**BAFO**, due 25 November 2026),
strictly scoped to the **Enterprise Integration and Orchestration Layer**.

### 1.1 Non-Negotiable Engineering & Commercial Guardrails

1. **Zero Modification of `agent-output/bcx/emails/`**: Treat `agent-output/bcx/emails/` as an immutable input archive.
   Verify SHA-256 hashes of all 13 input files before and after package generation.
2. **Rebuild From Scratch Against BAFO + Microsoft Learn**: Do not adapt Storm's 23-tab Nov 2 workbook
   (`02_BV-RFP-BCX-tier-costing.xlsx`). Derive every quantity, tier threshold, and SKU strictly from BFM's BAFO PDF
   (Sections 1–8) and Sheet 1 (`Sizing Inputs`) of `BFM_BAFO_Sizing_and_Pricing_Schedules.xlsx`, retaining Storm's and
   the Oct 7 calculator's figures solely in `BFM_BAFO.model-changelog.md` for partner traceability.
3. **Compliance Wins Over Cost — Zero Over-Delivery & Single-Region Default**: Compliance with BFM's BAFO requirements
   and South African law (**POPIA Act 4 of 2013**, **POPIA Regulations GoN R.1383 [GG 42110, 14 Dec 2018]**, **POPIA
   Amendment Regulations [GN 6126, GG 52523, 17 Apr 2025]**, and **ECTA Act 25 of 2002 ss 14–15**) takes precedence over
   cost minimization, while anything above strict RFP + POPIA compliance is explicitly evaluated and discarded if
   unneeded. **Do NOT use multi-region (`southafricawest`) in the baseline** because BFM requires `99.9%` PROD
   availability (targeted inside `southafricanorth`), not dual-region deployment.
4. **Zero Deprecated or Superseded Versions & 100% `southafricanorth` GA Availability**: Every SKU in scope must be
   current-generation, non-deprecated, and confirmed Generally Available in **`southafricanorth`** (e.g., `APIM Standard
   v2` / `Basic v2` instead of classic v1 `Developer`; `Functions Flex Consumption` instead of retiring Linux
   `Consumption`; `VpnGw1AZ` + `Standard Public IP` instead of retired non-AZ `VpnGw1` / `Basic IP`; `Workspace-based
   App Insights` + `Scheduled Query Rules v2`; `GPv2` Storage; `Key Vault RBAC`; `Defender for Storage v2`).
5. **1P USD Azure Retail Boundary (Partner Owns ZAR & Commercial Wrap)**: Price Azure infrastructure strictly in **USD**
   using live `prices.azure.com` retail rates for `southafricanorth`. Explicitly assign USD-to-ZAR conversion, FX
   hedging, 120-day bid validity, commercial margin, risk allowance, implementation/interface labour, managed support,
   third-party/SAP licensing, mandatory client references (Section 7), and page-initialing compliance (Section 1.2a) to
   **BCX**.
6. **Generator-First Reproducibility & Minimum File Sprawl**: Generate `pricing/retail-prices-southafricanorth.json`,
   `BFM_BAFO_Sizing_and_Pricing_Schedules.bafo-usd.xlsx`, and `assets/03-des-*.{svg,png}` via deterministic Python
   scripts in `agent-output/bcx/scripts/` and `agent-output/bcx/assets/`. Never include personal names in filenames.

### 1.2 Locked Architectural & Commercial Decisions Matrix (Single-Region `southafricanorth`, Modern SKUs Only)

> **Verified 1P USD Cost Note:** Live-API verified 1P USD planning amounts (`$3,405.10/mo` / `$40,861.20/yr` /
> `$204,306.00` over 60 months across all 4 environments using **APIM `v2` Workspaces**, **`2x Always-Ready` AZ
> `Functions Flex`**, separated **Flat ZRS Replay (PITR) + HNS SFTP Quarantine (`90 GB/mo` Malware Scan)**, and
> **Outbound-Only `Azure DNS Private Resolver` + `$2.50/mo` Forwarding Ruleset**) represent pure 1P Azure infrastructure
> (`0%` partner margin, `0%` FX buffer) pending interface discovery and BCX commercial wrap.

| ID | Decision Area | Locked Specification & BAFO / Microsoft Learn / POPIA Basis |
| --- | --- | --- |
| **`DEC-01`** | **Complete Removal of Analytics & Hidden Shared Analytics** | Remove Microsoft Fabric (`F2`/`F8`/`F32`/`F64`), OneLake (`Hot`/`BCDR`), Power BI Pro licences, analytical recovery Blob storage, **and** the 4 analytics-only items hidden inside Storm's `SHARED` module (`Fabric tenant private endpoint`, `Private analytics data processing`, `Recovery account protection`, and 2 of 3 `Private data endpoints` per environment), plus the 0.1–70 TB storage-ramp escalations (BAFO Section 5.2 Table 5 & Section 5.3d). |
| **`DEC-02`** | **Federated APIM `v2` Workspaces & CAF 3-Subscription Placement (`RD-04`)** | **APIM `v2` Workspaces (`https://learn.microsoft.com/en-us/azure/api-management/workspaces-overview`):** Use native `v2` **Workspaces on the Default Managed Gateway** (`$0` extra for first `5` workspaces; standalone *Workspace Gateways* are Premium-only and unavailable in `southafricanorth`):<br>1. **PROD (`1x APIM Standard v2`, `$700.00/mo`):** Federated domain & customer Workspaces (`ws-erp-cafm`, `ws-bms-alarms`, `ws-customer-1..3`) with scoped Entra RBAC, `<base/>` policy inheritance via Azure Policy, AZs, outbound VNet integration, and inbound Private Endpoint (`50M` calls/mo included).<br>2. **Non-Prod (`1x APIM Basic v2`, `$150.00/mo` — saves `-$300.00/mo` vs. `3x Basic v2`):** Hosts **`3` RBAC-isolated Workspaces (`ws-dev`, `ws-test`, `ws-uat`)** enforcing `dev-*`/`test-*`/`uat-*` unique resource naming, completely isolated from PROD compute capacity, `global.policy.xml`, Managed Identity, and PROD VNet (`3x Basic v2` retained only as an optional toggle if physical non-prod gateway separation is ever requested).<br>**CAF Subscription Topology (`3` Subscriptions, `$0` extra fee — NO separate API-only subscription):** Because `APIM Standard v2` **must reside in the same subscription as its VNet-integrated subnet** (`integrate-vnet-outbound`), placing APIM in a separate `sub-apim` subscription would force an extra spoke VNet and hair-pin every internal `APIM -> Logic Apps/Functions` call twice through `Azure Firewall Basic`. Instead use: (1) **`sub-bfm-connectivity-zan`** (Hub VNet: VPN, Firewall Basic, Outbound DNS Resolver, `7` Private DNS Zones), (2) **`sub-bfm-integration-prod-zan`** (PROD `APIM Standard v2` + `Logic Apps WS1` + `Functions Flex` + `Service Bus Premium` + `ZRS Storage` + `Key Vault`), and (3) **`sub-bfm-integration-nonprod-zan`** (Non-Prod `APIM Basic v2` + isolated `rg-int-dev`/`test`/`uat` RGs and spoke VNets). |
| **`DEC-03`** | **Single-Region `ZRS` Messaging, Claim-Check & POPIA Reg 3 7-Day Replay (`RD-02`, `RD-05`)** | **PROD:** `1x Service Bus Premium (1 MU)` (`$790.59/mo`, GA + Availability Zones in `southafricanorth`, Private Endpoint, `99.9%`–`99.95%` SLA, topics/sessions/duplicate detection, `MaxMessageSizeInKilobytes = 2048` over **AMQP**; HTTP caps at `1 MB`).<br>**DEV / TEST / UAT:** `3x Service Bus Standard` (`$14.31/mo` base each + ops; `256 KB` broker cap, no Private Link — optional UAT `Service Bus Premium` 72–168h test burst `$78–$182` on `Incremental Scale`).<br>**Single-Region `Hot ZRS` Capture-Before-Ack & POPIA Reg 3 (`Form 2`) Deletion-Safe Replay:** Discard multi-region `RA-GZRS`/`GZRS`. Ingress writes raw payload + SHA-256 hash (ECTA s 12 / POPIA Reg 1) + correlation/idempotency key to **single-region 3-AZ `Hot ZRS` Blob archive (`300 GB` in PROD = `~$32.22/mo` incl. ZRS ops & `60h/mo` SFTP window; synchronous `RPO = 0` across 3 `southafricanorth` AZs)** before returning `200`/`202`, plus **Azure Backup Operational/Vaulted Blob Backup (`ZRS`)** for point-in-time corruption recovery. **No locked WORM** (preserves statutory **POPIA s 24 / Reg 3 `Form 2`** destruction within 30 days): enforce **RBAC separation of duties** (write-only for ingress Managed Identity, zero runtime delete, audited Information-Officer break-glass purge for `Form 2` orders) + **automated 7-day Blob Lifecycle deletion** (POPIA s 14), duplicate detection, `Table` idempotency state, DLQ reprocessing, and daily reconciliation. **Drop `Event Hubs`**. |
| **`DEC-04`** | **Zone-Redundant Orchestration (`Logic Apps WS1` + `Functions Flex`), Storage PEs, SAP & SFTP (`RD-03`, `RD-06`, `RD-08`)** | **PROD:** **`2x Logic Apps Standard (WS1: 1 vCPU, 3.5 GiB)` instances** (`2 x $183.81 = $367.63/mo` — **minimum 2 instances enforced by Azure for Zone Redundancy in `southafricanorth`**) + dedicated `GPv2 Hot ZRS` runtime storage account (`Blob` + `Queue` + `Table` + `10 GB Hot ZRS Files` share on SMB `445` with `WEBSITE_CONTENTOVERVNET=1` and **`4` Private Endpoints**, `~$9.15/mo`, separated from the 7-day replay account) + **`Functions Flex Consumption`** (`~$18.00/mo` ceiling, confirmed GA + Zone-Redundant in `southafricanorth` — **replaces retiring Linux `Consumption`**). Qualify composite sync vs. async availability (`APIM 99.95% x SB Premium 99.95% = 99.90%` async ingress SLA).<br>**DEV / TEST / UAT:** `1x Shared Non-Prod Logic Apps WS1` plan (`1` instance, `$183.81/mo`) + `3x GPv2 Hot LRS` runtime storage accounts (`4` PEs each = `12` storage PEs; **strictly synthetic test data per POPIA s 14/s 19**) + `Functions Flex` (`~$4.50/mo`).<br>**SAP & SFTP (`RD-08`):** Primary SAP path uses **SAP PI 7 SOAP/REST/OData over HTTPS** (`24 SAP PI interfaces`, `$0` NCo dependency); direct RFC/BAPI/IDoc requires **BFM-supplied `SAP NCo 3.1` + SAP Indirect Access rights**. Pair Logic Apps SFTP-SSH client (`$0`) with a **scheduled `60 hr/mo` (`2h/day`) `Blob SFTP` server window (`$18.00/mo`)** (`24x7 Blob SFTP` `$219/mo` on `Incremental Scale`). |
| **`DEC-05`** | **POPIA-Compliant Hub Firewall, `Active-Active VpnGw1AZ` & Outbound-Only DNS Resolver (`RD-06`, `RD-07`)** | **VPN Gateway (`southafricanorth` GA, Non-Retired AZ SKU):** Deploy **`1x Shared VpnGw1AZ` in `Active-Active` mode** (`$153.30/mo` + **`2x Standard Static Public IPs` `$7.30/mo` = `$160.60/mo`**, `99.95%` AZ SLA, BGP, `650 Mbps`, `10` S2S tunnels free + `$10.95/mo` per tunnel `11–30` on `Incremental Scale` Row 6; non-AZ `VpnGw1-5` retired Sep 2026 & `Basic IP` retired Jun 2026) with **mandatory Custom IPsec/IKEv2 Policy (`IKEv2`, `GCMAES256`, `DHGroup24`, `PFS24`)**.<br>**Mandatory Hub Firewall ("Compliance Wins Over Cost"):** Retain **`1x Shared Azure Firewall Basic` (`$305.40/mo` incl. `AzureFirewallManagementSubnet`, 2 Standard PIPs, `150 GB` ceiling, GA + AZ in `southafricanorth`) as MANDATORY** for POPIA s 19(2) L7 HTTPS SNI/FQDN egress allowlisting and Hub-Spoke East-West segmentation (`Firewall Standard` `+$613.15/mo` net [-1 Mgmt PIP] only if SFTP TCP `22` peers lack static IPs or BFM mandates Threat-Intel auto-deny).<br>**Outbound-Only DNS Private Resolver (`-$180/mo` Saved):** Deploy **`1x Outbound Endpoint + Forwarding Ruleset ONLY` (`$182.50/mo` incl. `$2.50` Ruleset)** so Azure resolves internal `*.bfm` FQDNs over VPN for TLS hostname verification while keeping VNet DNS on `168.63.129.16` (resolving all `24` Private Endpoints + `7` Private DNS Zones `$3.50/mo` for free). **Discard the `$180/mo` `Inbound Endpoint`**: on-prem callers only target the **single static private IP** of PROD `APIM Standard v2`'s Private Endpoint, maintained via 1 static A-record in BFM on-prem DNS (`Customer responsibility` on Sheet 4; `Inbound Endpoint` on `Incremental Scale`). |
| **`DEC-06`** | **Modern Observability, PII-Redacted 90-Day Logs, POPIA s 22 Alerts & Defender v2 (`RD-12`, `RD-15`)** | **Observability (Zero Legacy Agents/Alerts, `RD-15`):** Use **Workspace-based Application Insights** (classic App Insights retired) + **Log Analytics** + **Scheduled Query Rules v2 & Metric Alerts** (`$20.00/mo` across PROD & Non-Prod). Enforce **PII payload redaction** so 90-day logs never store raw PII (POPIA s 14 & Regs 2–3). Split **App Insights tables** (`$3.36/GB`, 90d retention included free) vs. **Diagnostics/Firewall tables** (`$3.66/GB` incl. days 32–90 retention; total `$109.10/mo`) supporting **POPIA s 21(2)/s 22 Information Regulator eServices (`SCN1`) immediate compromise notification**.<br>**Security (`RD-12`):** Use **Foundational CSPM (`$0` Free)** + **Azure Policy** (`Allowed Locations = southafricanorth`, POPIA Reg 4(1)(a)), **`Key Vault Standard` with Azure RBAC** (`$2.25/mo`, no legacy access policies), and current **`Defender for Storage` per-account plan** (`6` accts `$58.70/mo` + `$0.45` tx + **`90 GB/mo` fail-closed SFTP `Malware Scanning` `$13.50/mo`**, GA in `southafricanorth`) + **`Defender for Key Vault`** (`$0.99/mo`). |
| **`DEC-07`** | **Single-Region Resilience (`Row 28`), POPIA Act + Regs (`GoN R.1383`) & Tenant AuthZ (`RD-01`, `RD-14`)** | **Single-Region Multi-AZ Resilience & Config Recovery (`Sizing Inputs` Rows 20 & 28, BAFO §5.2.2.2d):** Deliver `>=99.9%` PROD component HA inside **`southafricanorth` across 3 Availability Zones** (`RPO = 0` synchronous `ZRS` state/replay storage + automatic AZ failover) paired with **Git-versioned Bicep IaC + APIOps + Logic Apps workflow source control + ZRS Blob Point-in-Time Restore** for configuration/corruption recovery (`target config redeploy RTO 2–4h` in `southafricanorth`, pending drill). **Discard multi-region `southafricawest`** from baseline (quote multi-region DR solely on `Incremental Scale` Row 21 if BFM ever changes recovery scope, noting `southafricawest` access-restriction & classic-APIM constraints).<br>**POPIA Governance & Tenant AuthZ (`RD-14`):** Enforce Reg 4(1)(b) POV **PIIA**, s 20–21 **Written Operator Contract** + Microsoft DPA, Regs 2–3 (`Form 1`/`Form 2` 30-day response), qualified s 72 disclosure (`southafricanorth` data residency; global Entra/ARM/Defender/support metadata under DPA), and end-to-end `tenant_id` RBAC/ABAC across APIM -> Service Bus -> Logic Apps -> Blob ABAC -> Log Analytics RBAC. |
| **`DEC-08`** | **Reservations / Savings Plans Check, Metered Ceilings & 60-Month Schedule (`RD-09`–`RD-13`)** | **Reservations & Compute Savings Plans (`southafricanorth` Live API Verified):** (1) **Databases:** `0` in scope (`$0`; stateless middleware per BAFO §5.2.1); (2) **Storage Reserved Capacity:** Not applicable (`~400 GB` total `<< 100 TB` Blob RC / `10 TB` Files RC minimum threshold); (3) **`APIM v2`, `Service Bus`, `Logic Apps Standard WS1`, `VPN`, `Firewall`, `DNS Resolver`:** Verified `0` Reservations and `0` Savings Plans exist in Azure (`Logic Apps WS1–WS3` Workflow Service Plans are excluded from App Service RIs/Savings Plans); (4) **`Functions Flex Consumption`:** Eligible for **1-Yr / 3-Yr Azure Compute Savings Plan (`-17.0%`: `$3.8e-5 -> $3.154e-5/GB-s`)** — record both PAYG and `-17%` Savings Plan rates in `pricing/` and `Azure_BOM_USD` (applying PAYG by default on bursty `On Demand` so idle off-peak hours are not over-committed, and applying `-17%` whenever `Always Ready` baseline instances or a shared tenant Compute Savings Plan is active).<br>**Metered Ceilings & Workbook Safety (`RD-09`–`RD-13`):** Model elastic meters at tier ceilings (`1.2x` retries, `5%` `2 MB` mix, `50–100` concurrency, `20% p.a.` 5-yr growth; never silently throttle critical workflows). Keep `BFM_BAFO_Sizing_and_Pricing_Schedules.bafo-usd.xlsx` as an **Internal 1P USD Draft** with `FX_Rate` (`1.00` default), `"BCX QUOTE REQUIRED"` sentinels, **Submission Blocker Banner**, `Col C` = Steady-State Annual (`12 x Envelope B`), `Cols H–L` = 60-month ramp, and a **BAFO No-Submission Gate (`RD-13`)**. |

### 1.3 `/rubber-duck` Plan Review Remediation Register (`RD-01`–`RD-17`)

| ID | Severity | Finding Summary | Implemented Plan Remediation |
| --- | --- | --- | --- |
| **`RD-01`** | Blocking | `South Africa West` is access-restricted and lacks `APIM v2` (`Standard v2`); `4–8h` RTO unvalidated. | **Discarded multi-region `southafricawest` (`RA-GZRS`/cold DR) from baseline** (not required by BAFO; `southafricanorth` 3-AZ `ZRS` meets `99.9%` PROD SLA + `RPO = 0` zone resilience). Multi-region DR moved strictly to `Incremental Scale` Row 21 (`DEC-03`, `DEC-07`). |
| **`RD-02`** | Blocking | Blob archive lacked capture-before-ack, in-flight recovery, idempotency, secondary read access, and `252 GB` worst-case sizing. | Sized PROD archive to **`300 GB Hot ZRS`** (`RPO = 0` across 3 `ZA North` AZs + Azure Backup Blob Backup `ZRS`) and specified capture-before-ack, POPIA Reg 3 `Form 2`-safe RBAC + 7d lifecycle purge, duplicate detection + `Table` idempotency, and daily reconciliation (`DEC-03`, `WS3`, `WS4`). |
| **`RD-03`** | Blocking | Zone-redundant `Logic Apps Standard` requires **>=2 instances** + ZRS state storage; `APIM` SLA alone != composite SLA. | Doubled PROD `Logic Apps Standard WS1` from `1` to **`2` instances** (`$367.63/mo`), added dedicated `GPv2 ZRS` runtime state storage, and separated component SLAs vs. sync/async composite availability (`DEC-04`, `WS1`, `WS2`, `WS4`). |
| **`RD-04`** | Blocking | Classic `APIM Developer` cannot combine VNet injection with inbound Private Endpoint; `Standard v2` AZ/public-access nuances. | **Discarded superseded classic v1 `APIM Developer`** and adopted **APIM `v2` Workspaces on Default Managed Gateway**: `1x Standard v2` in PROD (`sub-bfm-integration-prod-zan`) + `1x Basic v2` w/ `ws-dev`/`ws-test`/`ws-uat` Workspaces (`$150/mo`, `-$300/mo` saved) in `sub-bfm-integration-nonprod-zan` (`DEC-02`, `WS3`, `WS4`). |
| **`RD-05`** | Blocking | `Service Bus Premium` `>1 MB` requires AMQP + large-message config; Non-Prod `Standard` (`256 KB`, no PE) breaks UAT parity. | Standardized **unified `>200 KB` Blob claim-check** across all 4 envs + AMQP `2048 KB` config on PROD Premium, and priced an optional `72–168h` UAT `Service Bus Premium` test burst on `Incremental Scale` (`DEC-03`, `WS2`, `WS4`). |
| **`RD-06`** | Blocking | Missing `Logic Apps Standard` runtime subresources (`Blob`, `Queue`, `Table`, `File` on SMB `445` = `4` PEs/acct) & `7` DNS zones. | Separated PROD `Hot ZRS` runtime storage (`4` PEs + `10 GB Hot ZRS Files`) from `Hot ZRS` replay storage (`1` PE), priced **`23` Private Endpoints** (`8` PROD + `15` Non-Prod) and **`7` Private DNS Zones** (`DEC-04`, `DEC-05`, `WS1`, `WS2`). |
| **`RD-07`** | Blocking | `Firewall Basic` has no DNS proxy; missing subnet delegation, UDRs, symmetric VPN return routes & firewall necessity check. | Added **Outbound-Only `Azure DNS Private Resolver`** (`$180/mo`; `Inbound` discarded via static on-prem A-record for PROD APIM PE), upgraded `VpnGw1AZ` to **`Active-Active` (`2x PIPs`, custom `GCMAES256` IPsec/IKEv2)**, specified full subnet/UDR/`GatewaySubnet` routing, and locked `Firewall Basic` as **mandatory** (`DEC-05`, `WS3`, `WS4`). |
| **`RD-08`** | Blocking | Built-in SAP connector requires customer-supplied `SAP NCo 3.1` & SAP rights; SFTP client cannot host push-only servers. | Positioned **SAP PI 7 SOAP/REST** as primary (`$0` NCo dependency) with `SAP NCo 3.1`/licensing gated on BFM for direct RFC/IDoc; added **`60 hr/mo` scheduled `Blob SFTP` server (`$18/mo`)** in base + `24x7 Blob SFTP` (`$219/mo`) on `Incremental Scale` (`DEC-04`, `WS2`, `WS4`). |
| **`RD-09`** | Blocking | Mixing USD formulas with `0` partner rows risks USD+ZAR sums and legal `$0` ("included free") commitment; deleting BOM breaks links. | Added `FX_Rate` single-currency converter + **Submission Blocker Banner**, replaced partner `0`s with `"BCX QUOTE REQUIRED"` sentinels + explicit `Azure_1P_Subtotal` row, and forbade deleting `Azure_BOM_USD` (`DEC-08`, `WS2`). |
| **`RD-10`** | Blocking | Undefined relationship between `Col C` (`Annual recurring`) and `Cols H–L` (`Years 1–5`) and once-off placement. | Defined `Col C` as **Steady-State Annual Recurring (`12 x Envelope B`)**, drove `Cols H–L` from a **60-month ramp** (`Year 1` = `Once-off + 6m POV + 6m Steady-State`, editable `6–12m` POV), and separated `Years 1–3` term vs. `Years 4–5` option (`DEC-08`, `WS2`). |
| **`RD-11`** | Blocking | Fixed tier claims lacked metered ceiling math (retries, concurrency, payload mix, growth) and non-throttling rules. | Modeled all elastic meters at tier ceilings (`1.2x` retries, `5%` `2 MB` mix, `50–100` concurrency), prohibited silent throttling of critical workflows, and assigned within-band variance to BCX's risk buffer (`DEC-08`, `WS2`, `WS5`). |
| **`RD-12`** | Blocking | Unverified `$5.11` CSPM & `$10` Defender guesses copied from Storm's model. | Switched to **Foundational CSPM (`$0` Free)** and exact live `southafricanorth` meters for `Defender for Storage` (`$0.0134/hr` + tx + `$0.15/GB` SFTP Malware Scanning) and `Defender for Key Vault` (`$0.00034/hr`) (`DEC-06`, `WS1`, `WS2`). |
| **`RD-13`** | Blocking | Missing submission gate for BAFO administrative, delivery, consortium, signature, and 3-reference pass/fail returnables. | Added a mandatory **BAFO Returnables & Disqualification Gate Checklist** (covering §§1.1–1.4, 3, 4, 5.2.2.3, 6, 7) to `00-partner-briefing.md` (`DEC-08`, `WS5`). |
| **`RD-14`** | Blocking | Overclaimed *"zero cross-border transfer"* under POPIA §72 and incomplete end-to-end tenant isolation. | Qualified global control-plane/support telemetry under POPIA §19/§72 + Microsoft DPA, and specified end-to-end `tenant_id` AuthZ across APIM, Service Bus, Logic Apps, Blob ABAC, and Log Analytics RBAC (`DEC-07`, `WS4`, `WS5`). |
| **`RD-15`** | Non-blocking | Blanket `$3.66/GB` log charge ignored App Insights 90-day free retention and omitted paid Alert rules. | Split App Insights tables (`$3.36/GB`, 90d free retention) from Diagnostics/Firewall tables (`$3.66/GB` incl. 60d retention) and added explicit Metric + Log Alert rule meters (`$17/mo`) (`DEC-06`, `WS1`, `WS2`). |
| **`RD-16`** | Non-blocking | `openpyxl` does not evaluate formulas; LibreOffice absent; Sheet 4 has only 20 pre-labelled category rows. | Added a **Python AST Excel formula evaluator + `<v>` XML cache writer** in `build_bafo_workbook.py`, and programmed clean styled row insertion on `Assumptions & Exclusions` preserving category labels (`WS2`, `WS6`). |
| **`RD-17`** | Non-blocking | `check-h2-order.mjs` on `README.md` alone misses repo-wide and custom artifact checks; Slide 5 deviations need BCX sign-off. | Added `scripts/verify_bcx_package.py` + read-only `validate-artifacts.mjs` in `WS6`, and added an explicit **Presentation Deviation Sign-Off Table (`AL05`–`AL20`)** in `00-partner-briefing.md` (`WS5`, `WS6`). |

### 1.4 Keep vs. Discard Audit (`South Africa North` GA, Non-Deprecation & Zero Over-Engineering Check)

| Component / Option | `southafricanorth` GA & Lifecycle Status | Monthly USD Impact | Decision | Rationale (Strict RFP + POPIA Filter) |
| --- | --- | ---: | --- | --- |
| **Multi-region `South Africa West` (`RA-GZRS` / standby DR)** | `ZA West` access-restricted; lacks `APIM v2` & AZs | `-$24.35/mo` (saved on storage; `-$2,700+/mo` standby avoided) | **DISCARD** | Not required by BAFO (`Row 20` = `99.9%` PROD SLA; `Row 28` = respondent proposes approach). `southafricanorth` 3-AZ `ZRS` + Blob Backup (`ZRS`) + Git IaC/APIOps meets HA & config recovery in one region. |
| **Classic v1 `APIM Developer` (`stv2`), `APIM Consumption`, Linux `Consumption` Functions, non-AZ `VpnGw1`, `Basic Public IP`, Classic App Insights, `GPv1` Storage, Classic Defender, KV Access Policies** | Superseded or retired (`2024`–`2028`) | Replaced | **DISCARD** | Violates non-deprecation guardrail. Replaced by `APIM Standard v2` / `Basic v2`, `Functions Flex Consumption` (AZ), `VpnGw1AZ` + `Standard Static IP`, `Workspace App Insights` + `Query Rules v2`, `GPv2`, `Defender for Storage v2`, and `Key Vault RBAC` (all verified GA in `southafricanorth`). |
| **`Event Hubs`, `Managed HSM`, `Fabric/OneLake`, `Power BI`, `App Gateway WAF`, `Front Door`, `ExpressRoute`, `ACI/ACR`** | GA in `southafricanorth` | `$0` (excluded) | **DISCARD** | Analytics is excluded by BAFO §5.3d; `18k` msg/day needs only Service Bus; RFP never requires FIPS L3 HSM, global CDN/WAF, or dedicated circuits. |
| **Non-Prod APIM: `1x Basic v2` w/ `3` Workspaces (`$150/mo`) vs. `3x Basic v2` (`$450/mo`)** | `Basic v2` + `Workspaces` GA in `southafricanorth` | **`$150.00/mo`** *(`-$300/mo` saved vs. `3x`)* | **KEEP `1x Basic v2` w/ Workspaces** | `ws-dev`, `ws-test`, `ws-uat` provide RBAC-isolated API management on the default managed gateway at `$0` extra workspace fee while staying 100% isolated from PROD (`sub-bfm-integration-prod-zan`). |
| **`Azure DNS Private Resolver`: `Outbound-Only` (`$180/mo`) vs. `Inbound + Outbound` (`$360/mo`)** | GA in `southafricanorth` (100% in-region residency) | **`$180.00/mo`** *(`-$180/mo` saved)* | **KEEP `Outbound` ONLY; DISCARD `Inbound`** | `Outbound` (`$180/mo`) is required for TLS hostname verification to internal `*.bfm` FQDNs over VPN; `Inbound` (`$180/mo`) is discarded because on-prem systems only call 1 static PROD APIM Private Endpoint IP (1 static on-prem DNS A-record). |
| **Reservations & Compute Savings Plans (`1-Yr / 3-Yr`)** | Verified live via `prices.azure.com` (`2023-01-01-preview`) | `0` RIs on PaaS; `-17%` SP on `Functions Flex` | **APPLY WHERE ELIGIBLE** | `0` databases in scope; Storage `~400 GB << 100 TB` RC minimum; `APIM v2`, `Service Bus`, `Logic Apps WS1`, `VPN`, `Firewall` have `0` RIs/SPs; `Functions Flex` `-17%` Compute Savings Plan (`$3.154e-5/GB-s`) captured and applied when `Always Ready` / tenant SP is active. |
| **`VpnGw1AZ` (`Gen1 AZ`, `$160.60/mo` w/ 2 PIPs) vs. `VpnGw2AZ` (`Gen2 AZ`, `$401.50/mo`)** | Both active GA AZ SKUs in `southafricanorth` (`VpnGw1AZ` is Gen1-only) | `$160.60/mo` *(Gen2 `+$240.90/mo`)* | **KEEP `VpnGw1AZ`** *(Document `VpnGw2AZ` Gen2)* | `VpnGw1AZ` is active/non-deprecated (only non-AZ `VpnGw1-5` retired Sep 2026), delivers `99.95%` AZ SLA, `650 Mbps` (`>100x` load), and custom `GCMAES256` IPsec/IKEv2; upgrades in-place to `VpnGw2AZ` if needed. |
| **`60 hr/mo` Scheduled `Blob SFTP` Server Window (`$18/mo`) + `Defender for Storage v2` w/ `Malware Scanning` (`~$57/mo`)** | GA in `southafricanorth` | `$75.41/mo` combined | **KEEP** | Covers push-only SFTP batch partners (`<=15` file interfaces, BAFO §5.2.2.1c) without `$219/mo` 24x7 idle fees, and scans inbound customer/vendor files for malware + anomalous storage/secret access (POPIA s 19 & s 22). |

---

## 2. Re-Validation Summary: Why Storm's Nov 2 Model Cannot Be Reused

| Dimension | Oct 7 Calculator (`Source PROD` + `NonProd`) | Storm Nov 2 AI Pack (`02_BV-RFP-BCX-tier-costing.xlsx`) | Hardened BAFO USD Model (`agent-output/bcx/`) |
| --- | --- | --- | --- |
| **Scope & Region** | Integration + Fabric across `ZA North` + `ZA West` (`$40,937.65/mo`) | Integration + Fabric (`$625`–`$27,342/mo`) | **Integration Only, 100% Single-Region `southafricanorth` (`3` CAF Subs)** (**`$3,405.10/mo` / `$40,861.20/yr`**) |
| **API & Event Volumes** | Unaligned (`500k` connector calls/day x 1 day bug) | `100k–2M` API/day + `810k–15.9M` IoT events/day | Aligned to Sheet 1: `<=5k` API/day & `18k` msg/day + `20% p.a.` (`15k` API / `50k` msg metered ceiling) |
| **API Gateway (`v2` Workspaces)** | `Standard v2` (`ZA West`, unsupported!) + `Basic v2` (`ZA North`) | `Consumption` in POV & Non-Prod (no Log Analytics logs, no VNet, no v2 migration) | **`1x Standard v2` in PROD** (domain/customer Workspaces, AZ, VNet + PE) + **`1x Basic v2` in Non-Prod** (`ws-dev`/`ws-test`/`ws-uat` Workspaces) |
| **Messaging & Replay** | `Service Bus Standard` (`$22.50/mo`, no Private Link, `256 KB` cap) | `Storage Queues` in POV (`64 KB` cap) + `Event Hubs` in all 4 envs; no 7d replay store | `Service Bus Premium` (PROD, `2 MB` AMQP + PE) + `Standard` (Non-Prod) + unified `>200 KB` claim-check + **`300 GB Hot ZRS` 7d replay (`RPO = 0`)**; **no `Event Hubs`** |
| **Orchestration, Storage PEs & Connectors** | `4x Logic Apps WS2` + `6x Integration Accounts` (`$7,215.51/mo`) | Functions-only (misses SOAP, SFTP, and pre-built ERP/SAP connectors); undercounted storage PEs | **`2x Logic Apps WS1` AZ** (`$367.63/mo` PROD) + `1x WS1` Non-Prod (`$183.81/mo`) + `Functions Flex` (AZ, `-17%` SP eligible) + `4` PEs/runtime storage + `60h/mo` SFTP window |
| **Hub Firewall & Hybrid DNS** | `4x Firewall Standard` double-counted (`$3,977.68/mo`); no DNS Resolver | Dropped to `$0` (`AL05` Slide 5 contradiction; no hybrid Private-Link DNS design) | Mandatory `1x Firewall Basic` (`$305.40/mo`) + `Active-Active VpnGw1AZ` (`GCMAES256`) + **Outbound-Only `DNS Private Resolver` (`$180.00/mo`)** + `7` DNS zones + `23` PEs |
| **Audit Logs, Alerts & Security** | `160 GB/day` Basic Logs (`$3,504/mo`, 30d) + `2x Managed HSM` (`$4,672/mo`) | `31-day` Log Analytics; unverified `$5.11` CSPM / `$10` Defender guesses; `$0` alerts | PII-redacted **90-day** Workspace App Insights (`$3.36/GB`) + Log Analytics (`$3.66/GB`) + v2 Alert rules (`$17/mo`) + Free Foundational CSPM + live `Defender v2` meters |

---

## 3. Target Package Layout (`agent-output/bcx/`)

```text
agent-output/bcx/
├── README.md                                                    # Master index (PROJECT-README.template.md H2-compliant)
├── 00-partner-briefing.md                                       # Playbook, 4-party split, Keep/Discard levers & pass/fail gate
├── 00-partner-handoff-email.md                                  # Ready-to-send handoff email for BCX
├── BFM_BAFO_Sizing_and_Pricing_Schedules.bafo-usd.xlsx          # Internal 1P USD BAFO workbook + AST/<v>-verified Azure_BOM_USD
├── BFM_BAFO.azure-response.md                                   # Bidder-adaptable technical narrative (BAFO 5.2.2.3 & Section 8)
├── BFM_BAFO.evidence-and-provenance.md                          # Clause, POPIA Regs, MS Learn URL & Retail API meterId evidence
├── BFM_BAFO.model-changelog.md                                  # Line-by-line delta from Oct 7 & Storm Nov 2 models
├── 03-des-adr-0001-integration-runtime-logic-apps-ws1-and-functions.md
├── 03-des-adr-0002-api-gateway-tiering-standard-v2-and-basic-v2.md
├── 03-des-adr-0003-messaging-and-7-day-replay-architecture.md
├── 03-des-adr-0004-zero-trust-hub-firewall-basic-and-private-link.md
├── 03-des-adr-0005-popia-compliance-customer-isolation-and-az-resilience.md
├── assets/
│   ├── 03-des-integration-architecture.{py,svg,png}             # 4K dlib Single-Region ZA North 3-AZ Hub-Spoke & Private Link
│   ├── 03-des-network-and-popia-flows.{py,svg,png}              # 4K dlib Capture-Before-Ack, Claim-Check, SFTP & Tenant AuthZ
│   └── 03-des-cost-breakdown.{py,svg,png}                       # matplotlib 1P USD breakdown & baseline comparison chart
├── pricing/
│   └── retail-prices-southafricanorth.json                      # Live prices.azure.com USD responses + SHA-256 metadata
├── scripts/
│   ├── fetch_retail_prices.py                                   # Queries/records live Azure Retail API meters in USD
│   ├── build_bafo_workbook.py                                   # Clones BFM XLSX, builds BOM, runs AST evaluator & writes <v>
│   └── verify_bcx_package.py                                    # End-to-end validator (SHA-256, AST parity, ADR H2s, links)
└── emails/                                                      # READ-ONLY ORIGINAL INPUT ARCHIVE (13 files, untouched)
```

---

## 4. Step-by-Step Workstreams (`WS1`–`WS6`)

### `WS1` — Live USD Retail API Evidence Capture (`scripts/fetch_retail_prices.py`)

1. Query `https://prices.azure.com/api/retail/prices` (`currencyCode=USD`) for every modern, non-deprecated SKU in the
   single-region `southafricanorth` BOM (plus Global/Zone-1 networking meters where Azure bills globally):
   - `VPN Gateway` (`VpnGw1AZ`, `S2S Connection`, plus `VpnGw2AZ` Gen2 reference), `Virtual Network` (`Standard IPv4
     Static Public IP`, `Standard Private Endpoint`, `Standard Data Processed - Ingress/Egress`), `Azure Firewall`
     (`Basic Deployment`, `Basic Data Processed`, plus `Standard` comparison reference), `Azure DNS` (`Private Zone`,
     `Private Resolver Outbound Endpoint`, plus `Inbound Endpoint` optional reference), `Bandwidth` (`Standard Data
     Transfer Out`),
   - `API Management` (`Standard v2 Unit` and `Basic v2 Unit` in `southafricanorth` — zero classic v1 `Developer` or
     `Consumption` meters),
   - `Service Bus` (`Premium Messaging Unit`, `Standard Base Unit`, `Standard Operations`),
   - `Logic Apps` (`Standard vCPU Duration`, `Standard Memory Duration`), `Functions` (`Flex Consumption On Demand
     Execution Time` & `Executions` via `api-version=2023-01-01-preview` to capture both PAYG and **1-Yr / 3-Yr Compute
     Savings Plan `-17%`** rates),
   - `Storage` (`General Block Blob v2 Hot ZRS Data Stored` & `Write Operations`, `Hot LRS Data Stored` & `Write
     Operations`, `Files v2 Hot ZRS` & `Hot LRS Data Stored`, plus `Blob SFTP` hourly endpoint meter and `Azure Backup`
     Blob vaulted/operational ZRS reference — **zero `GZRS`/`RA-GZRS` multi-region meters in baseline**),
   - `Key Vault` (`Operations`), `Log Analytics` (`Analytics Logs Data Ingestion`, `Analytics Logs Data Retention`),
     `Azure Monitor` (`Alerts System Log Monitored at 5 Minute Frequency`, `Alerts Metric Monitored`), `Microsoft
     Defender for Cloud` (`Defender for Storage Standard Node`, `Standard Transactions`, `Malware Scanning Data
     Ingested`, `Defender for Key Vault Per node Std Node`).
2. Persist exact API responses, `meterId`, `productName`, `skuName`, `unitOfMeasure`, `retailPrice`,
   `effectiveStartDate`, query URL, UTC timestamp, and SHA-256 digest to
   `agent-output/bcx/pricing/retail-prices-southafricanorth.json`.
3. Validate JSON structure via `python -m json.tool`.

---

### `WS2` — Deterministic 5-Tab BAFO Workbook Builder & AST Engine (`scripts/build_bafo_workbook.py`)

1. Copy `agent-output/bcx/emails/BFM_BAFO_Sizing_and_Pricing_Schedules.xlsx` to
   `agent-output/bcx/BFM_BAFO_Sizing_and_Pricing_Schedules.bafo-usd.xlsx` without touching the source file.
2. Add supporting tab **`Azure_BOM_USD`** (explicitly labelled **`INTERNAL FORMULA SOURCE — DO NOT DELETE SHEET`** per
   `RD-09`, with instructions either to keep as supporting transparency or paste-values only onto a final frozen copy):
   - **Partner Commercial & Single-Currency Controls Block (`RD-09`, `RD-10`)**:
     - `Reporting_Currency` (`"USD"` default; updates to `"ZAR"` only when BCX enters an approved `FX_Rate > 1`),
     - `FX_Rate` (`1.00` default), `BCX_Margin_Pct` (`0.0%` default), `Annual_Escalation_Pct` (`0.0%` default in USD),
       and `POV_Months` (`6` default, editable `6..12` per BAFO Section 6.3),
     - `Partner_Inputs` table for all 11 BCX-owned service/labour/connector rows (`Rows 4, 9, 15–23`), initialized to
       the explicit text sentinel **`"BCX QUOTE REQUIRED"`** (never misleading `0`s!) so `BAFO Pricing` displays a
       prominent **`SUBMISSION BLOCKED — POPULATE FX & PARTNER QUOTES`** status until every required BCX input is
       entered in the single selected currency.
   - **Metered Tier-Ceiling Envelopes (`RD-11`)** driven by live `pricing/retail-prices-southafricanorth.json` rates:
     1. **Envelope A — POV Foundation (Months 1–6)** (models both *Day-1 Full Production Parity* and *Lean POV Option*),
     2. **Envelope B — Baseline & 5-Year 20% p.a. Growth Ceiling** (`<=15,000 API/day`, `<=50,000 msg/day`, `<=3 GB/day`
        batch, `1.2x` retry overhead, `5%` `2 MB` payload mix, `2x Logic Apps WS1` AZ, `300 GB Hot ZRS` (`southafricanorth`
        3-AZ, zero multi-region), `1x APIM Basic v2` Non-Prod w/ `3` Workspaces (`ws-dev`/`ws-test`/`ws-uat`), `23` PEs,
        **Outbound-Only `DNS Private Resolver` (`$180/mo`)**, `Firewall Basic`, `60h/mo` SFTP window, `90d` logs + v2
        alerts, live Defender v2 meters),
     3. **Envelope C — Enterprise Scale Step-Up Pack** (`<=50,000 API/day`, `<=150,000 msg/day`, `<=10 GB/day` batch)
        plus modular add-ons (`Firewall Standard` upgrade `+$613.15/mo` for dynamic-FQDN SFTP TCP `22` / Threat-Intel
        auto-deny, `VpnGw2AZ` Gen2 upgrade `+$240.90/mo`, `S2S Connection` tunnels `11–30` @ `$10.95/mo`, UAT `Service
        Bus Premium` 72–168h test burst, `24x7 Blob SFTP` endpoint, dedicated customer VNet spoke, and customer-requested
        multi-region DR on `Incremental Scale` Row 21).
   - **60-Month Schedule (`Months 1–60`, `RD-10`)**: Reconciles `POV_Months` (`M1–M6`) + initial 36-month contract
     (`M7–M36`) + optional 24-month extension (`M37–M60`) into annual `Year 1`–`Year 5` totals.
3. Populate **Sheet 1 (`Sizing Inputs`, `Cols C & D`, Rows 4–29)**:
   - Provide explicit **bands, payload/concurrency distributions, and step-up thresholds** (satisfying BAFO Section
     6.1i), single-region `southafricanorth` 3-AZ `ZRS` resilience + Git IaC/APIOps configuration recovery (`Row 28`),
     unified claim-check + `300 GB Hot ZRS` capture-before-ack replay (`RD-02`, `RD-05`), and composite availability
     qualifiers (`RD-03`).
4. Populate **Sheet 2 (`BAFO Pricing`, Rows 4–26, `Cols B–M`)** with **zero double-counting** and **explicit `Col C` vs.
   `Cols H–L` semantics (`RD-09`, `RD-10`)**:
   - Define `Col C` (`Annual recurring cost`) explicitly in `Col D`/`Col M` as **Steady-State Annual Recurring Run-Rate
     (`12 x Envelope B`)**; build `Year 1` (`Col H`) as `Once-off (Col B) + POV_Months + (12 - POV_Months) Steady-State`,
     `Years 2–3` (`Cols I–J`) as initial 36-month term recurring, and `Years 4–5` (`Cols K–L`) as optional extension:
     - `Row 5` (`Platform/software licensing & subscriptions`): `$0.00` separate Azure software licence (all Azure PaaS
       meters itemized in Rows 6–14; Entra ID Free assumed, P1/P2 noted if PIM required).
     - `Row 6` (`DEV, TEST, UAT and PROD environments`): Non-Prod (`DEV`, `TEST`, `UAT`) subtotal in
       `sub-bfm-integration-nonprod-zan` (`1x APIM Basic v2` w/ `ws-dev`/`ws-test`/`ws-uat` Workspaces, `3x SB Std`, `1x
       LA WS1`, `Functions Flex`, `3x LRS Storage`, `15x PEs`, `KV RBAC`, `Defender v2`, `90d Logs`).
     - `Row 7` (`Hosting/infrastructure`): PROD `2x Logic Apps Standard WS1` (AZ-enabled), `Functions Flex` (AZ, noting
       `-17%` Compute Savings Plan rate) ceiling, `GPv2 Hot ZRS` runtime state storage (`incl. Hot ZRS Files`), and `300
       GB Hot ZRS` 7-day replay + `60h/mo` SFTP.
     - `Row 8` (`Connectivity and network services`): Shared Hub (`sub-bfm-connectivity-zan`) `Active-Active VpnGw1AZ`
       (`GCMAES256` IPsec/IKEv2, `2x Standard PIPs`), mandatory `Azure Firewall Basic`, **Outbound-Only `Azure DNS
       Private Resolver` (`1x Outbound Endpoint + Ruleset`)**, `7x Private DNS Zones`, and `8x PROD Private Endpoints`.
     - `Row 10` (`API management`): PROD `APIM Standard v2` (`1 unit` in `sub-bfm-integration-prod-zan`, federated
       domain/customer Workspaces, AZ-enabled, 50M calls/mo included).
     - `Row 11` (`Messaging/events`): PROD `Service Bus Premium` (`1 MU`, AZ-enabled, AMQP `2 MB` + unified claim-check).
     - `Row 12` (`Data transfer and egress charges`): Outbound internet egress ceiling (`150 GB/mo`).
     - `Row 13` (`Monitoring/observability and log retention`): PROD Workspace `Application Insights` (90d included) +
       `Log Analytics` (incl. days 32–90 retention) + `Azure Monitor` v2 Log & Metric Alert rules.
     - `Row 14` (`Security and identity components`): Foundational CSPM (`$0`), PROD `Key Vault Standard` (RBAC), and
       live `Defender for Storage v2` (incl. `30 GB/mo` SFTP Malware Scanning) + `Defender for Key Vault` meters.
     - `Row 24` (`Contingency / optional services`): Disclose optional `24x7 Blob SFTP` (`+$201/mo` net), UAT `SB
       Premium` burst, and multi-region DR exclusion/option note in `Col M` (`$0` in base).
     - `Row 25` (`Other - specify`): Repurpose/label cleanly as **Partner Readiness & 1P Azure Subtotal Check Note** in
       `Col M` (`$0` numeric impact on `Row 26`) while **Partner-Owned Rows (`Rows 4, 9, 15–23`)** link to
       `Azure_BOM_USD` `"BCX QUOTE REQUIRED"` cells so `Row 26` (`=SUM(...)`) sums 1P Azure cleanly while blocking
       premature customer release until BCX enters single-currency commercial quotes.
5. Populate **Sheet 3 (`Incremental Scale`, Rows 4–23, `Cols B–F`)**:
   - Distinguish additions **absorbed at `$0` marginal Azure cost** within Envelope B ceiling vs. exact step-up packs
     (`+$` recurring USD from `Azure_BOM_USD`, incl. `24x7 Blob SFTP`, UAT `SB Premium` burst, extra `WS1`/`MU`/`APIM`
     unit, dedicated customer spoke, and optional multi-region DR on Row 21), with once-off labour linked to `"BCX QUOTE
     REQUIRED"`.
6. Populate **Sheet 4 (`Assumptions & Exclusions`, `Cols A–F`, `RD-16`)**:
   - Populate BFM's 20 pre-labelled category rows (`Rows 4–23`: 4x each of `Assumption`, `Exclusion`, `Dependency`,
     `Customer responsibility`, `Third-party requirement`) **and programmatically insert properly styled, category-tagged
     rows** where needed without overwriting template labels — covering Analytics exclusion, single-region
     `southafricanorth` 3-AZ scope (multi-region DR excluded unless requested via `Incremental Scale` Row 21), named
     source rollouts, fixed-envelope risk allocation & non-throttling rules (`RD-11`), `SAP NCo 3.1` & SAP Indirect
     Access rights (`RD-08`), POPIA Act ss 14/19–22/24/72 + POPIA Regulations `GoN R.1383` (Reg 4(1)(b) PIIA, Regs 2–3
     `Form 1`/`Form 2` 30-day destruction, s 21 Operator contract & Microsoft DPA, `RD-14`), and on-prem VPN/DNS
     conditional forwarding (`RD-07`).
7. **Deterministic Python AST Formula Evaluator & `<v>` Cache Writer (`RD-16`)**:
   - Implement a Python AST formula evaluator inside `build_bafo_workbook.py` that computes every formula across all 5
     sheets (`SUM`, `IF`, `COUNT`, `ROUND`, arithmetic, and cross-sheet references), verifies `0.00` discrepancy against
     an independent Python expected-totals ledger, **injects pre-calculated `<v>` cached values into the `.xlsx` XML**
     (so Excel viewers and read-only `data_only=True` readers see exact numbers without LibreOffice), and fails closed on
     any `#REF!`, `#NAME?`, `#VALUE!`, or stale cache.

---

### `WS3` — 4K `dlib.py` Architecture Diagrams & `matplotlib` Cost Chart (`assets/`)

1. **`assets/03-des-integration-architecture.py` -> `.svg` + `.png` (`3840x2160` via `dlib.py`)**:
   - **100% Single-Region (`southafricanorth`, 3 Availability Zones) across `3` CAF Subscriptions**
     (`sub-bfm-connectivity-zan`, `sub-bfm-integration-prod-zan`, `sub-bfm-integration-nonprod-zan`) — zero multi-region
     `southafricawest` box and zero extra `sub-apim` Firewall hairpin!
   - Outer `tenant()` frame (`Microsoft Entra ID — Scoped RBAC / ABAC / Managed Identities`),
   - Left on-premises / customer estate (`SAP ECC 6 & PI 7 SOAP/REST`, `Archibus 2025.02`, `BMS / Actionable Alarms`,
     `Up to 3 POV Customer Environments`, `On-Prem DNS w/ Static APIM PE A-Record`),
   - `sub-bfm-connectivity-zan` Shared Hub VNet (`Active-Active VpnGw1AZ` w/ `GCMAES256`, `Azure Firewall Basic` +
     `AzureFirewallManagementSubnet` + UDRs, **Outbound-Only `Azure DNS Private Resolver`**, `7x Private DNS Zones`),
   - `sub-bfm-integration-prod-zan` PROD 3-AZ Spoke (`APIM Standard v2` AZ w/ Federated Workspaces + VNet + inbound PE,
     **`2x Logic Apps Standard WS1` AZ**, `Functions Flex` AZ, `Service Bus Premium 1 MU` AZ, `GPv2 Hot ZRS` Runtime
     Storage [`4 PEs`] + `300 GB Hot ZRS` 7d Replay & Scheduled SFTP Storage [`1 PE`], `Key Vault Std RBAC` [`1 PE`],
     `Workspace App Insights, Log Analytics 90d & v2 Alerts`),
   - `sub-bfm-integration-nonprod-zan` Non-Prod Spokes (`1x APIM Basic v2` w/ `ws-dev`/`ws-test`/`ws-uat` Workspaces,
     `3x Service Bus Standard` w/ unified claim-check, `Shared Logic Apps WS1`, `3x GPv2 LRS` Storage [`12 PEs`], `3x Key
     Vault RBAC` [`3 PEs`]).
2. **`assets/03-des-network-and-popia-flows.py` -> `.svg` + `.png` (`3840x2160` via `dlib.py`)**:
   - Swimlane/lifecycle diagram illustrating (`RD-02`, `RD-05`, `RD-08`, `RD-14`): (1) Capture-Before-Ack & Unified
     `>200 KB` Claim-Check (`APIM` -> `300 GB Hot ZRS` + `Service Bus` -> `202/200`), (2) Sync REST/SOAP via SAP PI 7 vs.
     Async Pub/Sub & Actionable Alarms (`10% / 70%`), (3) Batch SFTP Client + Scheduled `2h/day` Blob SFTP Window (`20%`
     with Defender Malware Scan), and (4) POPIA Reg 3 `Form 2`-Safe 7-Day Replay, DLQ Reprocessing, Daily Reconciliation
     & End-to-End `tenant_id` Authorization (`APIM Workspaces -> SB -> Logic Apps -> Blob ABAC -> PII-Redacted Logs`).
3. **`assets/03-des-cost-breakdown.py` -> `.svg` + `.png` (`save_figure` via `diagram_io.py`)**:
   - Two-panel visual: (Left) Verified 1P USD monthly breakdown (`Connectivity Hub $670.00`, `PROD $2,179.34`, `Non-Prod
     $555.76` = **`$3,405.10/mo`**), (Right) Comparison vs. `Oct 7 Baseline ($40,938/mo)` and `Storm Nov 2 Med/Large
     ($10,096–$27,342/mo)`.
4. Execute all three `.py` scripts, resolve any `WARN overflow:` messages from `dlib.py`, and visually inspect rendered
   `.png` outputs via `view`.

---

### `WS4` — Architecture Decision Records (`03-des-adr-0001` to `03-des-adr-0005` — Mandatory POPIA Mapping)

Author 5 concise, 5-minute ADRs following `.github/skills/apex-azure-adr/references/adr-template.md`. Every ADR's
`## 🔒 Compliance Considerations` section **must explicitly map to the applicable provisions of POPIA (Act 4 of 2013:
ss 11, 14, 18–22, 24, 54–55, 69–72), the 2018 POPIA Regulations (`GoN R.1383`, GG 42110: Regs 1–5 & Forms 1, 2, 4, 5,
11), the 17 April 2025 POPIA Amendment Regulations (`GN 6126`, GG 52523), Regulator eServices (`SCN1`), and ECTA (Act 25
of 2002 ss 1, 14–15)**:

1. `03-des-adr-0001-integration-runtime-logic-apps-ws1-and-functions.md` (`2x WS1` AZ + `2x Always-Ready` `Functions
   Flex` AZ in `southafricanorth` replacing retiring Linux `Consumption`, `4`-subresource ZRS runtime storage, SAP PI
   SOAP/REST vs. customer-supplied `SAP NCo 3.1`, fail-closed `90 GB/mo` SFTP quarantine; **POPIA**: s 19 Managed
   Identity, s 14 synthetic non-prod).
2. `03-des-adr-0002-api-gateway-tiering-standard-v2-and-basic-v2.md` (Modern `v2` Workspaces on Default Managed Gateway:
   `1x Standard v2` [`99.95%` SLA] in `sub-bfm-integration-prod-zan` + `1x Basic v2` [`ws-dev`/`ws-test`/`ws-uat` w/
   Entra EasyAuth] in `sub-bfm-integration-nonprod-zan`, why a separate `sub-apim` subscription is avoided due to
   `Standard v2` same-subscription VNet binding & Firewall hairpinning; **POPIA**: s 19 TLS 1.2+/OAuth2, s 22 eServices
   `SCN1` auditability).
3. `03-des-adr-0003-messaging-and-7-day-replay-architecture.md` (`Service Bus Premium` AMQP `2 MB` + unified `>200 KB`
   claim-check, capture-before-ack, separated Flat **`300 GB Hot ZRS`** [`PITR`] vs HNS SFTP, dropping `Event Hubs` &
   `RA-GZRS`; **POPIA**: why locked WORM is rejected for **s 24(2) / Reg 3(6) `Form 2` destruction**, s 14 7d
   auto-purge, ECTA ss 14–15 digests).
4. `03-des-adr-0004-zero-trust-hub-firewall-basic-and-private-link.md` (Mandatory `Firewall Basic`,
   `Active-Active VpnGw1AZ` w/ `Standard Static PIPs` & `GCMAES256`/`DHGroup24`/`PFS24` IPsec/IKEv2, **Outbound-Only
   `Azure DNS Private Resolver`** [`Inbound` discarded via static on-prem A-record], `24` PEs + `7` DNS zones; **POPIA**:
   s 19(2) foreseeable L7 HTTPS exfiltration control).
5. `03-des-adr-0005-popia-compliance-customer-isolation-and-az-resilience.md` (Single-region `southafricanorth` HA with
   Flat ZRS PITR + Git IaC/APIOps config recovery [why multi-region `ZA West` is discarded], Reg 4(1)(a) Azure Policy,
   Reg 4(1)(b) POV **PIIA**, Regs 2–3 `Form 1`/`Form 2` + PII redaction in 90d logs, s 21 Operator contract + s 22
   eServices `SCN1` breach alerts, s 72 transfer review, and 5-layer `tenant_id` RBAC/ABAC).
   alerts, qualified s 72 + DPA, and end-to-end `tenant_id` RBAC/ABAC).

---

### `WS5` — Narrative, Evidence, Changelog, Partner Playbook & Index (`agent-output/bcx/*.md`)

1. **`BFM_BAFO.evidence-and-provenance.md`**:
   - Complete provenance matrix linking every BAFO section (`1.1–1.4`, `2.1.6–2.1.9`, `3`, `4`, `5.2.1–5.2.2.3`, `5.3`,
     `6.1–6.3`, `7`, `8`) and every `Sizing Inputs` row (`Rows 4–29`) to: (a) architectural/workbook answer, (b) verified
     Microsoft Learn URL + title, and (c) exact `meterId` & USD unit rate in
     `pricing/retail-prices-southafricanorth.json`.
2. **`BFM_BAFO.model-changelog.md`**:
   - Component-by-component changelog across **Oct 7 Calculator** -> **Storm Nov 2 AI Pack** -> **Initial Rebuild** ->
     **`/rubber-duck` Hardened BAFO USD Model (`RD-01`–`RD-17`)**, detailing every removed, upgraded, added, and resized
     component.
3. **`BFM_BAFO.azure-response.md`**:
   - Bidder-adaptable technical proposal narrative mapped directly to BAFO Section 5.2.2.3(`a`–`d`) and Section 8
     evaluation criteria (`70%` technical/resilience/delivery weight): Canonical Data Model & ERP/CAFM decoupling,
     capture-before-ack & idempotent 7-day replay, qualified POPIA §19/§72 & Zero Trust controls, end-to-end customer
     authorization, 90-day observability/alerts, and exit/portability.
4. **`00-partner-briefing.md` & `00-partner-handoff-email.md`**:
   - **4-Party Responsibility Matrix** (`Microsoft`, `BCX`, `BFM`, `Third-Party Vendors`),
   - **Single-Currency Conversion & Partner Quote Procedure** (`FX_Rate`, margin, risk buffer, replacing `"BCX QUOTE
     REQUIRED"` cells without mixing USD and ZAR),
   - **Mandatory BAFO Returnables & No-Submission Gate (`RD-13`)**: Table 1–3 supplier/tax/B-BBEE forms, SARS TCS PIN,
     Section 1.1c consortium/subcontracting split agreement (if DotCom Software or subcontractors participate), Section
     1.2a signatory initials on **every page**, Section 1.4 Company Resolution, Section 3 Bidder's Disclosure, Section 4
     GCC signature, Section 5.2.2.3d delivery plan/resources, Section 6 120-day ZAR validity, and Section 7 **three
     contactable client references**,
   - **Presentation Deviation Sign-Off Register (`AL05`–`AL20`, `RD-17`)** requiring explicit BCX architect approval of
     Slide 5 & Slide 9 updates before submission, plus ready-to-send handoff email in `00-partner-handoff-email.md`.
5. **`README.md`**:
   - Exact H2 structure per `PROJECT-README.template.md` (`## 📋 Project Summary`, `## ✅ Workflow Progress`,
     `## 🏛️ Architecture`, `## 📄 Generated Artifacts`, `## 🔗 Related Resources`), clearly badging figures as
     provisional 1P USD planning inputs pending BCX commercial wrap.

---

### `WS6` — End-to-End Verification Gate (`scripts/verify_bcx_package.py` + Repo Validators)

1. **Source Archive Integrity**: Verify `agent-output/bcx/emails/` contains the exact 13 original files with unchanged
   byte sizes and SHA-256 digests.
2. **JSON & AST Workbook Validation (`RD-16`)**:
   - `python -m json.tool agent-output/bcx/pricing/retail-prices-southafricanorth.json >/dev/null`
   - Run `scripts/verify_bcx_package.py` to re-evaluate all `.xlsx` formulas via the Python AST engine, verify `<v>` XML
     caches match `data_only=True` reads to `$0.0001`, confirm all 26 `Sizing Inputs` rows and inserted `Assumptions &
     Exclusions` rows are populated, confirm zero `#REF!`/`#NAME?`/`#VALUE!` errors, and confirm the `"BCX QUOTE
     REQUIRED"` submission-blocker banner triggers properly.
3. **Diagram & Asset Check**: Confirm `.py`, `.svg`, and `3840x2160` `.png` triplets exist and are non-empty for all 3
   visuals in `agent-output/bcx/assets/` with zero `dlib` overflow warnings.
4. **Repository & Custom Deliverable Checks (`RD-17`)**:
   - Run `node tools/scripts/check-h2-order.mjs agent-output/bcx/README.md` and read-only `node
     tools/scripts/validate-artifacts.mjs` (both must exit `0`),
   - Verify all 5 ADRs (`03-des-adr-0001`–`0005`) match the required H2 sequence in `adr-template.md`, verify `0` broken
     relative links and `0` `TBD`/`TODO` placeholders across `agent-output/bcx/*.md`, verify USD totals match across
     JSON -> XLSX -> Markdown -> Charts, and run `npx markdownlint-cli2
     docs/exec-plans/active/bcx-bfm-bafo-integration-plan.md`.
