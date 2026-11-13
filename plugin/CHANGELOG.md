# APEX plugin changelog

Each `apex` plugin release published to the [apex-plugins marketplace](https://github.com/jonathan-vella/apex-plugins)
needs a section here headed `## [<version>]`. `npm run publish:plugin -- --apply` refuses to publish a version without
one, and clients only update when the version changes.

The plugin version is the `@apexops/cli` version in `packages/cli/package.json`; the build copies it into `plugin.json`.
Plugin and CLI therefore move in lockstep, and the plugin bundles the CLI release published to npm at that version.
When you prepare a release, rename `## [Unreleased]` to the new version.

## [Unreleased]

## [0.11.0-next.15] - 2026-11-13

This release fixes pilot workflow, pricing, review-artifact, and diagram issues uncovered during the EU partner webhook
gateway pilot audit.

### Fixed

- Support pre-sales `lab` continuation on the ALZ Corp reference baseline at `governance-refresh` through Planning,
  CodeGen, and IaC validation (blocking before live `preview`/`deploy` until `apex governance revise` imports a
  reviewed subscription baseline).
- Preserve `RTO`/`RPO` intake answers in `RequirementsV1` templates, re-render `challenger-findings.md` and stage
  `README.md` status on review resolution, sync existing `agent-output` packages into linked git worktrees, and improve
  `01-requirements`, `03-des-diagram.mmd`, WAF, and cost diagrams.
- Update `retail-pricing.md` and `apex-architecture` to use OData `filter` queries for tier/meter-billed services in
  `@azure/mcp` `pricing_get`, enforce one `ask_user` call per response, and restrict silent Gate 2 auto-dismissal to
  `info`/`low` stage-excluded noise.

## [0.11.0-next.14] - 2026-11-11

This release replaces bundled multi-finding review prompts with a scannable Markdown overview table followed by
sequential one-by-one `ask_user` prompts per actionable finding (`1/N`) across Requirements, Architecture, and Planning
reviews.

### Changed

- Update `APEX`, `apex-next`, `apex-requirements`, `apex-architecture`, `apex-planning`, and `ApexService.decideReview`
  so Architecture review noise is auto-dismissed silently, actionable findings render in a Markdown overview table
  first, users answer one finding at a time via sequential `ask_user` prompts filtered by each finding's returned
  `finding.actions`, and mixed `revise` + disposition batches audit non-`revise` answers on the current review before
  invalidating for revision.

## [0.11.0-next.13] - 2026-11-11

This release ensures governance and Architecture only stop or mark controls `blocked` on active `deny` policies, never
pausing on `modify`, `deployIfNotExists`, `audit`, or unconfirmed reference-baseline assignments.

### Changed

- Restrict `disposition: "blocked"` and `policy-refresh` Architecture reopening to `effect: "deny"` in `ApexService`,
  and update `rubber-duck` Architecture review instructions so `modify`, `deployIfNotExists`, `audit`, and accepted
  reference-baseline assumptions are non-blocking.
- Update `apex-architecture`, `apex-azure-governance`, `apex-operations`, `apex-azure-defaults` references, and `APEX`
  boundaries so `apex-azure/policy` (`policy_assignment_list`) is not called when `governance-constraints` uses
  `source: "reference"` and non-`deny` effects never pause the workflow.

## [0.11.0-next.12] - 2026-11-11

This release resolves end-to-end worktree, provider handoff, Bicep AVM/generator, and native Terraform validation gaps
across the bundled runtime and managed `APEX` guidance.

### Changed

- Unify linked Git worktree `.apex/` resolution across CLI and MCP, add `apex release-writer` / `apex/releaseWriter`,
  mirror `agent-output/` into linked worktrees, dynamically reload `.apex/provider-config.json` with active-run
  `iac-handoff` defaults, provide zero-config offline source validation for `validateTask` and `completeTask`, block
  runtime downgrades in `update` and `doctor --fix`, and include generated `.apex/work/<runId>/...` IaC files in state
  transfer bundles.
- Support AVM Bicep module evaluation, `targetScope`-bound Log Analytics resolution, Bicep output/interpolation/RBAC
  `scopeLogicalId` generation, and root-module Terraform HCL parity/baseline validation; route missing governance
  baselines through `ask_user`; and trim duplicated `APEX` coordinator prose.

## [0.11.0-next.11] - 2026-11-10

This release codifies the canonical 9-tag resource-group contract from `jonathan-vella/azure-landing-zones`
(`enforce-resource-group-tags-exclude-resource-groups-based-on-name.json`) with automatic runtime default values so
resource-group creation in Bicep and Terraform always includes all required tags without blocking on missing baseline
tag inputs.

### Changed

- Add `resourceGroupTagContract` (`environment`, `owner`, `costcenter`, `application`, `workload`, `sla`,
  `backup-policy`, `maint-window`, `technical-contact` plus allowed `environment` and `sla` values) to
  `config/defaults.v1.json` and update `apex-azure-defaults` references (`baseline-fallbacks.md`, `tag-precedence.md`)
  with automatic default resolution.
- Enforce the 9-tag contract and value normalization in `resolveResourceGroupTags`, `generateBicepTree`,
  `generateTerraformTree`, and `AzdBicepProvider` greenfield resource-group provisioning.

## [0.11.0-next.10] - 2026-11-10

This release improves Requirements intake UX across the GitHub Copilot App, VS Code Copilot harness, and Copilot CLI by
adding baseline and workload-derived recommendations (`availability-recovery`, `operations`, `compliance`, and
stateless container `service-preferences`), enabling one-click round summary confirmations, and ensuring multi-value
`ask_user` prompts always include selectable single-choice options instead of rendering a bare `Skip` button.

### Changed

- Add baseline recommendations for `availability-recovery` (`["single-region-availability"]`) and `operations`
  (`["azure-monitor", "application-insights", "log-analytics"]`), derive `compliance` recommendations from the
  confirmed workload description, and recommend `container-apps` for container/scale-to-zero workloads in
  `recommendedServiceCandidates`.
- Update `APEX` and `apex-requirements` intake mechanics to support one-click round answer table confirmation and
  always pass selectable single-choice options on multi-value `ask_user` prompts.

## [0.11.0-next.9] - 2026-11-10

This release fixes Windows CRLF asset hash drift in `assets/manifest.json` and allows `scripts/onboard.ps1` to accept
`-Yes` alongside `--yes`.

### Fixed

- Normalize text source files to LF in `packages/cli/scripts/prepare-assets.mjs` so `assets/manifest.json` digests match
  the LF-normalized files written by `tools/scripts/build-plugin.mjs` on Windows.
- Map `-Yes` (case-insensitive) to `--yes` in `scripts/onboard.ps1`.

## [0.11.0-next.8] - 2026-11-10

This release ships `azd` layered provisioning support (`infra.layers[]` in `azure.yaml`, #480) and top-level
user-requested input amendment routing in the `APEX` agent (#517).

### Added

- Support `azd` layered provisioning (`infra.layers[]` in `azure.yaml`) in `AzdBicepProvider`: validate and compile
  declared layer roots without requiring `infra/main.bicep`, preview and apply layers in topological dependency order,
  re-verify bound inputs at every layer boundary, stop on partial failure while naming completed vs failed layers, and
  tear down layers in reverse dependency order (#480).
- Add top-level user-requested decision-amendment routing (`apex/inputHistory` -> `apex/previewInputAmendment` ->
  confirmation -> `apex/amendInput`) in `agents/apex.agent.md` before normal gate stops (#517).

## [0.11.0-next.7] - 2026-11-09

This release ships the vNext-only plugin cleanup (#539), syncs upstream Azure Bicep, retail-pricing, and diagram
pattern guidance, and completes the remaining UX polish items in #500.

### Changed

- Remove 73 legacy v1 skill templates and `upstream-coverage.md` files from the shipped plugin (`1,245` → `1,172`
  files) and rewrite all shipped skill links to local relative paths (#539).
- Add `app-service-entra-private-registry-pattern.md` and Storage point-in-time restore gotchas to
  `apex-bicep-patterns`, expand `apex-azure-defaults/references/retail-pricing.md` with `Foundry Models`,
  `Azure Front Door Service` (`Zone 1`), Standard SSD, Bastion, and Monitor alert meter selection rules, and add
  end-to-end overview pattern guidance to `apex-python-diagrams`.
- Complete UX polish (#500): support optional `actors`, component `subnet` boundaries, labelled `flows`/`edgeLabels`,
  and a `Legend` subgraph in `ArchitectureV1` and `renderArchitectureMermaid`; generate human-readable
  `<environment>-<YYYYMMDD>-<shortId>` run folder names; and add explicit exclusive `none` options to
  `service-preferences`, `availability-recovery`, and `operations` multi-select intake questions.

## [0.11.0-next.6] - 2026-11-09

This release resets the preview launch scope (`DECISION-040`, #535, #536), ships a single self-contained marketplace
plugin artifact bundling both `mcp/apex.mjs` and `cli/apex.mjs` with `.apex/bin/apex.mjs` workspace launchers and
`scripts/onboard.{ps1,sh}`, cuts the MCP `tools/list` wire payload under a static context budget (`27,505 / 28,000`
bytes), and qualifies general Bicep and MCR AVM module live execution through `azd` (`#533`, `#386`, `#455`).

### Changed

- Bundle `cli/apex.mjs` and `scripts/onboard.{ps1,sh}` directly in the plugin (`CP-35`, #531) and generate
  `.apex/bin/apex.mjs` during workspace initialization without running `npm install @apexops/cli`. Treat duplicate
  marketplace entries disabled in `.github/copilot/settings.local.json` as healthy in `doctor` (#507).
- Stop serializing `outputSchema` onto the MCP `tools/list` wire payload while keeping server-side output validation,
  unregister 10 CLI-only MCP tools (`31` role-scoped tools retained), and enforce static context budgets (`CP-34`,
  `CP-36`, #530, #532).
- Unlock general Bicep and MCR AVM module validation (`CP-33`, #529, #536): remove the 9-resource storage-only lock,
  support `Microsoft.Resources/deployments` modules and nested array sub-deployments, omit unused top-level `param`
  declarations in `generateBicepTree`, and pass `--api-version 2021-05-01-preview` when reading
  `Microsoft.Insights/diagnosticSettings` during destroy preview on Azure CLI 2.91+.
- Add exact Azure MCP Server `3.0.0` as the general read-only `apex-azure` provider with verified foreground grants
  and guarded namespace commands. Retire the separate ARM CostManagement server; actual billing, forecasts, budgets,
  alerts and commitment records are unsupported. Pricing uses `pricing_get` with explicit cap/provenance guidance.
  External install/cache and client/live qualification remain separate from APEX's bundled offline startup and kernel
  approval guarantees.
- Static Web Apps Bicep guidance no longer shows a Key Vault reference in the managed integrated API's application
  settings, which Managed Functions do not resolve; secrets belong on a linked bring-your-own Functions app.

## [0.11.0-next.5] - 2026-10-19

This release bundles the azd Bicep executor (CP-26, PR B) and skill guidance corrections from the 0.11.0-next.4
marketplace review. Bicep live runs stay unavailable until CP-30 qualifies the azd executor.

- Skill guidance corrections from the 0.11.0-next.4 marketplace review (Refs #384): Terraform verification no longer
  builds `https://https://` URLs from the shipped `api_url` output; supporting-resource tables show optional
  integrations (AKS, Logic Apps, Container Apps and others) as conditional instead of required; permission-denied
  recipes diagnose the denied action and scope and recommend the narrowest role instead of Contributor; the Learn CLI
  fallback requires Node.js 22 or later. There is no runtime change.

## [0.11.0-next.4] - 2026-10-11

This fix release corrects agent and skill guidance findings from the 0.11.0-next.3 marketplace review: wrong CLI command
orderings, health-check exit codes, least-privilege role guidance and redirect URI guidance. It includes the Gate 1
`apex/gateDecide` correction: the call must carry `decision`. There is no runtime change.

- Skill guidance corrections from the 0.11.0-next.3 marketplace review (Refs #384): `apex/gateDecide` guidance now
  names the required `decision` (`approved` or `rejected`) with `gate: 1` and `confirm: true`; deployment recipes use
  `az deployment operation sub list`, `terraform import <address> <id>`, fail-fast bounded `curl` health checks and
  secret-store guidance for CI/CD secrets; role-assignment delegation prefers Role Based Access Control Administrator
  over User Access Administrator; native and mobile Entra redirect URIs are no longer forced to HTTPS; Cosmos DB
  hierarchical keys carry `version: 2`; AKS, Application Insights and Event Grid references no longer overstate
  minimums, mislabel the workspace SKU or require Key Vault.

## [0.11.0-next.3] - 2026-10-11

Adds the purpose-bound lab approval flow guidance (Gate 1 intent confirmation and Gate 4 final preview approval;
production is not available) and re-ported Azure design, IaC and operations skills. azd does not execute anything in
this release.

- Operations skills re-ported at the pinned upstream commit (CP-18/CP-21): full recipe/CLI/azd/SDK and service
  references, migration scenarios/runtime examples and inline Mermaid syntax. Script/workflow sources are
  non-executable references. Native-provider authority, task/evidence boundaries, the current runtime's Gate 4 and the
  unavailable status of the planned DECISION-036 flow (CP-26 to CP-30) are preserved; no deployment or Mermaid renderer
  capability is added.

- Azure design skills re-ported from `jonathan-vella/apex` (CP-18): trigger-rich descriptions, retail pricing, SKU
  availability and cost tool references, guidance aligned to the read-only `apex-azure-pricing` tools, and the upstream
  Azure CLI and azd commands. Read commands run directly; commands that change Azure route through `apex deploy` and
  Gate 4 or the approved GitHub Actions pipeline. APEX never runs `azd up`.

## [0.11.0-next.2] - 2026-10-09

Fixes a Copilot review finding on the second marketplace release pull request (closed without merging): the
apex-automation instruction now requires pinning third-party actions to a full commit SHA instead of a mutable major
version tag.

## [0.11.0-next.1] - 2026-10-09

Fixes 3 findings from the Copilot review on the first marketplace release pull request (closed without merging): the
preToolUse hook now fails closed on a missing script, the APEX CodeGen agent no longer carries an unused
`apex/completeTask` grant, and `apex-azure-quotas` no longer blocks an exact-fit quota request.

## [0.11.0-next.0] - 2026-10-08

First marketplace release of APEX as one Agent Plugins 1.0 plugin.

- The APEX agent, hidden workers (CodeGen and Validator) and skills from the managed customizations. Agents are rendered
  with the Copilot CLI client mechanics the workspace copies carried before `apex init` stopped copying them (CP-11).
  The built-in `rubber-duck` agent runs the Requirements, Architecture and Plan reviews; the APEX Reviewer worker is
  retired.
- The `apex` MCP server: the bundled `@apexops/cli` runtime as one esbuild bundle on the MCP TypeScript SDK v2, started
  with `node` from the plugin folder and needing no registry download.
- The `apex-azure-pricing` MCP server: Azure Resource Manager MCP over streamable HTTP with the `CostManagement` and
  `Pricing` toolsets. It replaces `azure-resource-manager-mcp` from the retired workspace `.mcp.json`; agent tool
  references use `apex-azure-pricing/<tool>`.
- PNG diagrams on `linux-x64` (glibc) and `win32-x64` hosts: the plugin ships the prebuilt `@resvg/resvg-js` 2.6.2
  binaries under `native/resvg-js/` with their MPL-2.0 license and loads one only when its SHA-256 matches the hash
  pinned in the bundle. Other platforms, musl Linux and altered binaries fall back to Python and SVG diagrams and report
  PNG as unavailable. The binaries add about 8.5 MB to the package.
- Managed hooks that deny the APEX agent as a task target, and every `apex-azure-pricing` tool except the read-only
  pricing and cost tools from `tools/registry/arm-mcp-cost-pricing.v1.json`. They also capture kernel-requested
  rubber-duck reviews as signed records for the kernel, and deny state-changing APEX tools to rubber-duck while it runs.
- The `apex` MCP server refuses a workspace whose `.apex/apex.lock.json` names another `@apexops/cli` version with
  `APEX_RUNTIME_MISMATCH`; `status` reports the mismatch read-only. Run `apex update` for an older workspace, or
  install the plugin version that matches a newer one (CP-25).
- The manual-only `apex-unslop` skill (`/apex-unslop`): polishes prose you ask it to without changing facts,
  identifiers or APEX file contracts, and never edits kernel-managed artifacts.
