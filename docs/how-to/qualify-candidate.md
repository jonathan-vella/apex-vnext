# Qualify A Candidate

> [Current Version](../../VERSION.md) | Run deterministic checks and prepare separately authorized client or cloud proof.

## Run Focused Checks

During development, run the narrowest test that can falsify the current change. Package-level tests and typed contract
validation should precede broad repository checks.

## Run Deterministic Qualification

From a clean repository checkout:

```bash
npm ci
npm run validate:all
npm run qualify:vnext
```

`qualify:vnext` builds packages, validates source and configuration, runs workspace and validator tests, packs the
runtime, and clean-installs it into a temporary consumer project.

## Run Exact-Head Release Qualification

Maintainers can run the non-cloud release lane with a stable collection time:

```bash
npm run qualify:vnext-release -- \
  --collected-at TIMESTAMP \
  --output dist/release-candidate
```

The command requires clean tracked source and writes compact candidate-bound evidence. It does not approve, deploy,
publish, tag, or authorize cutover.

## Prepare Client Qualification

For each selected client, use a clean consumer workspace and the exact candidate packages. Record observed host and
client versions, executable hashes, managed projection hashes, MCP inventory, discovery, routing, input handling,
restart/resume, lifecycle behavior, and normalized outcomes.

Follow the [human-run live client kit](qualify-live-clients.md) for source/release pins, install/doctor, sandbox
observations, protocol metadata, review/tamper/repeat/worktree checks and a blank evidence worksheet. Native Windows
VS Code Copilot harness and the Copilot app are separate cases; Copilot CLI runs separately on Linux and WSL2.
Do not run Windows GUI qualification through WSL, a devcontainer or the VS Code Local harness. The typed outcome
tools accept `github-copilot-cli` and `github-copilot-vscode`; the app's typed identity is still a gap, not a CLI alias.

Cover both ALZ-backed and standalone lab/demo profiles. COE import,
relevant change questions, conflict handling and selective regeneration are required target outcomes; missing
implementation must be recorded as a gap. Worker asymmetry cannot excuse missing generation, review or validation.
Review output using the [PRD checklist](../vnext/PRD.md#output-quality-reference), not a new token benchmark.

Run basic interaction checks alongside features when executable controls permit. No automated preparation grants live
client or Azure authority. CLIENT-039 to CLIENT-042 stay PLANNED and blocked until CP-26 to CP-30 deliver the
purpose-bound lab, azd/Bicep, CI-owned production and production-setup paths; #378's
closed implementation does not supply CLIENT-012 clean-host evidence. Repeat affected checks on each exact candidate.

## Prepare Live Azure Qualification

Live qualification requires explicit human authorization, isolated targets, reviewed target-subscription policy,
pricing evidence, authenticated tools, cleanup ownership and exact preview approval. Quota and regional availability
remain assumptions, not separate evidence gates. Run Bicep and Terraform separately, preserve supplied platform
resources, and bind evidence to the candidate. Follow [the live procedure](../vnext/LIVE-QUALIFICATION.md).

## Interpret Results

Qualification launchers require `--governance-file <absolute-file>` for `preview`, `dispatch` and `retrieve`.
Supply fresh, reviewed context for the exact candidate and target; do not use historical installed evidence or archives.
The protected hosted environment separately requires nonsecret `APEX_QUALIFICATION_GOVERNANCE_JSON`.
A maintainer must explicitly authorize setting that variable; this cleanup does not configure it or run live work.
The hosted job creates a restrictive temporary context file and validates it again before opening the endpoint.
Context is not approval: human local Gate 4 and exact recipient/preview binding remain required.

- Deterministic pass means source behavior is internally qualified.
- Package pass means the runtime packs and installs reproducibly.
- Client pass means one exact client candidate satisfies its matrix.
- Live pass means bounded cloud scenarios passed for one exact candidate.
- Release acceptance requires every mandatory level plus explicit authorization.

## Related

- [Qualification reference](../reference/qualification.md)
- [Client support](../reference/client-support.md)
- [Project qualification controls](../vnext/README.md)
