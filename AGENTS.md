# APEX

## Setup Commands

```bash
npm install                              # Install repository dependencies
npm run qualify:vnext                    # Build, test, validate, and pack vNext
```

Use the packaged `apex` CLI for consumer-project lifecycle and setup operations.

## Build & Validation

```bash
# Full validation suite
npm run validate:all

# Individual checks (most-used)
npm run lint:md                          # Markdown linting
npm run lint:json                        # JSON/JSONC validation
npm run validate:agents                  # Agent + prompt frontmatter, model alignment
npm run validate:model-consistency       # Managed agent frontmatter and manifest model alignment
npm run validate:iac-security-baseline   # TLS/HTTPS/Entra-only/no-public-blob baseline
npm run lint:safe-shell                  # No interactive shell prompts in committed snippets

# Full list (≈30 scripts) → npm run | grep -E "^  (lint|validate|test):" or
# https://apexops.pro/reference/validation-reference/

# Pre-commit/pre-push hooks (installed via lefthook on `npm run prepare`)
git push                                 # Triggers diff-based-push-check.sh automatically

# IaC validation
bicep build infra/bicep/{project}/main.bicep && bicep lint infra/bicep/{project}/main.bicep
terraform fmt -check -recursive infra/terraform/ && npm run validate:terraform
```

## Code Style

Code style (CAF naming, required tags, default region, AVM-first, unique
suffix pattern) is documented in
[.github/skills/azure-defaults/SKILL.md](.github/skills/azure-defaults/SKILL.md).
Agents read that file as part of their mandatory skill load; this file
no longer duplicates the tables.

## Security Baseline

The non-negotiable security baseline (TLS 1.2 minimum, HTTPS-only, no public
blob, no shared key, Managed Identity, Entra-only SQL, App Service HTTP/2,
Container Registry admin disabled, MySQL/PostgreSQL SSL, no public network
access for prod data services, no hardcoded secrets) is documented in
[.github/instructions/references/iac-policy-compliance.md](.github/instructions/references/iac-policy-compliance.md).
This is the source of truth for `validate:iac-security-baseline`. Typed governance
inputs may add subscription-level Azure Policy requirements.
## vNext Architecture

- `packages/kernel/` owns deterministic state, gates, authorization, evidence, and improvement decisions.
- `packages/contracts/` owns versioned JSON schemas and contract validation.
- `packages/capabilities/` owns bounded provider and workflow capabilities.
- `packages/renderers/` owns client-neutral rendering.
- `packages/cli/` owns install, update, setup, lifecycle, and terminal interaction.
- `customizations/` owns managed VS Code and Copilot CLI projections.
- `config/*.v1.json` owns shipped workflow, policy, toolchain, and runtime defaults.

State-changing behavior belongs behind kernel authorization and typed contracts. Custom agents and skills guide users;
they do not become an independent workflow authority. Preserve stable error codes, fail closed on stale evidence, and
keep client-specific behavior at adapter boundaries.

Use `npm run qualify:vnext` for deterministic product qualification. Live cloud qualification is a separate,
explicitly authorized operation and must not run as part of ordinary repository validation.

## Conventions Detail

For deeper guidance, agents read these on demand:

- Bicep conventions: `infra/bicep/AGENTS.md`
- Terraform conventions: `infra/terraform/AGENTS.md`
- azd multi-project rules: `.github/instructions/azure-yaml.instructions.md` (auto-loaded for `azure.yaml`)
- Terminal hygiene (no `mv -i`/`rm -i`/`read -p`, pipe long output to file):
  `.github/instructions/no-interactive-shell.instructions.md` (enforced by `lint:safe-shell`)
- Azure defaults: `.github/skills/azure-defaults/SKILL.md`
- vNext product contracts: `packages/contracts/schemas/`
- Managed customization manifest: `customizations/manifest.json`
- Full validation reference: <https://apexops.pro/reference/validation-reference/>
