# vNext Authority and Command Boundary

This boundary applies to every imported reference and example in this skill. Upstream phase labels, recipes,
sample paths, templates and CLI sequences are technical context, not a second workflow or an executable runbook.

## Accepted Inputs and Outputs

Use `apex/taskContext` with the current absolute `workspace` to obtain the active task, allowed outputs, accepted
requirements, architecture, governance, selected-track binding, receipts and freshness policy. Reuse unchanged accepted
decisions; chat history, environment defaults and source files cannot replace acceptance or approval evidence.

The kernel owns task state, artifact acceptance, gates, evidence and writer authority. There is no standalone
`.azure/plan.md` lifecycle, numbered-agent handoff, skill-owned approval, or skill-owned `Validated` status.
Generation, staging, builds, provider initialization, state inspection and tests use only the capabilities authorized
by the task envelope. An example or imported template does not register a capability. Return unavailable materialization
as a blocker or future backlog item; never run a substitute script.

## Canonical Infrastructure Contracts

Read [Azure defaults](../../apex-azure-defaults/SKILL.md) and use runtime `azureDefaults`, `securityInvariants`, the
accepted governance/tag contract and `workload-decision-manifest-v1`. Policy tag casing and values win; for greenfield
fallback follow [tag precedence](../../apex-azure-defaults/references/tag-precedence.md), not old PascalCase examples.
Sample locations, service versions, SKUs, names, address ranges, quotas and prices are not accepted decisions.

Use AVM first with exact accepted module locks. Raw resources and application templates explain syntax; they require
an accepted AVM-coverage exception where applicable. Do not weaken HTTPS/TLS, managed identity, Entra-only data access,
no public blob/no shared key or production private-networking requirements to make an example work.
Key-based SDK examples describe existing-app migration only; generate credential-free clients for new work.
Quota and regional availability remain explicit Architecture assumptions unless the task requires accepted evidence;
unknown headroom is never zero or unlimited, and published limits never prove allocation.

## Commands and Evidence

Direct read/diagnostic `az` and `azd` commands are allowed for the approved tenant, subscription and disclosure scope.
They produce observations, not accepted evidence. Redact secrets, tokens and connection strings; `azd env get-values`
can contain credentials. Accepted results must match scope, exact source/dependency revision, timestamps and freshness.
Do not retrieve secret values or switch identities as a troubleshooting shortcut.

Commands that change Azure, Entra, GitHub settings or managed Terraform state never run directly by the agent.
They require `apex preview`, a separate human decision at local Gate 4 via `apex gate decide`, and
`apex deploy --preview <hash>`, or an already-approved pipeline. Approval binds the exact preview, actor, target,
operation, recipient, commit, dependency revision, writer epoch and expiry. A changed preview requires new approval.
Readiness, source generation and a successful partial check never authorize apply.

Current native deployment tracks are Bicep and Terraform: Bicep previews use
`az deployment group|sub what-if`; Terraform applies only the exact saved plan approved at Gate 4.
Provider mutation commands retained in examples are syntax for those bounded operations, never instructions to execute.
An environment flag, shell confirmation, local plan status or CI environment approval is not an APEX gate decision.
Never suppress provider errors, refresh approval in CI, or execute an unbound fallback.

## Planned azd and Pipeline Support

Revised DECISION-035 and #443 select the following design;
**CP-26 is planned, not current runtime functionality**:

- Labs: `azd provision --preview`, then separately approved `azd provision` through `apex deploy`.
- Service deployment: a separate preview and Gate 4 decision binds the service list and package digests;
  only then may the runtime run `azd deploy` for those packages.
- APEX **never runs `azd up`**. Its upstream appearances are historical context; no single preview covers both steps.
- Static `azure.yaml` and GitHub Actions generation is reviewable preparation, not pipeline setup.
  `azd pipeline config` changes identities, federated credentials, role assignments and GitHub settings.
  It needs its own preview and Gate 4 authorization through `apex deploy`; static workflow generation does not grant it.
- CI accepts a recipient-bound one-hop handoff and executes only the imported locally approved preview.
  It cannot create, replace or refresh Gate 4 approval. Production CI apply remains blocked until encrypted
  recipient-bound transport qualification. A sample `azd` workflow is not such a qualified transport.

Keep unsupported azd service, pipeline-setup, state-adoption and live-test execution explicit as blockers.
An older reference that says “run”, “deploy”, “update plan” or “approve” must be interpreted through these boundaries,
never as current runtime availability or independent mutation authority.

### Known azd Constraints

- azd's Terraform provisioning `Deploy()` calls `plan()` again before `Apply()` in 1.34.0 and current upstream.
  `azd provision` therefore does **not** execute an existing exact-approved Terraform saved plan.
  Native Terraform plan/apply remains lifecycle authority. The azd provider path is planned/unqualified and fails
  closed; do not accept a hash-only workaround, silent replan, or weaker decision contract.
- Current `azd deploy --preview` rejects combination with `--from-package`. Do not describe a preview/package
  sequence as qualified exact-package execution. Service-list/package digest authority needs a separately resolved
  bounded operation before it can run.
- `azd pipeline config` has no native preview and makes remote Azure/Entra/GitHub-setting changes.
  Its own APEX preview authority must be designed explicitly; a dry-run label or static YAML is not that authority.
- The first CP-26 delivery scope needs a human decision resolving these constraints. Until then, preserve accurate
  technical examples as design material and report unsupported execution as blocked.
