## Description

<!-- Provide a brief description of your changes. What does this PR do? Why is it needed? -->

## Related Issue

<!-- Link to the related issue, e.g., "Fixes #123" or "Closes #456" -->

Fixes #

## Type of Change

<!-- Mark the appropriate option with an "x" -->

- [ ] 🏗️ Infrastructure / capability update (`packages/capabilities/`, `infra/`)
- [ ] 🤖 Managed agent or skill update (`customizations/.github/`)
- [ ] 📝 Documentation update (`docs/`, `README.md`)
- [ ] 🐛 Bug fix
- [ ] 🔧 Refactoring (no functional changes)
- [ ] ⚙️ Kernel, contract, CLI, or workflow change (`packages/`, `config/`, `.github/workflows/`)

## Context Budget Impact

<!--
Does this PR change the always-loaded context budget enforced by `npm run validate:context-budget`
(`config/context-budget.v1.json`)? Default answer is NO.
-->

This change affects the static context budget (`mcpToolsList`, `apexAgent`, `skillFrontmatter`, `managedInstructions`):

- [ ] YES (provide `npm run validate:context-budget` numbers below)
- [ ] NO

## Workflow Used

- [ ] Direct implementation
- [ ] Copilot Coding Agent (autonomous)
- [ ] Manual implementation

## Changes Made

<!-- Describe the specific changes you made. Include file paths. -->

**Files added:**

-

**Files modified:**

-

## Testing Performed

<!-- Describe how you tested your changes -->

### Infrastructure (if applicable)

- [ ] `bicep build` succeeds for all `.bicep` files
- [ ] `bicep lint` passes with no errors
- [ ] Deployed to Azure subscription (region: \***\*\_\_\_\_\*\***)
- [ ] All resources pass Azure Policy compliance
- [ ] Resources cleaned up after testing

### Code Quality

- [ ] Pre-commit hook passed (`npm run lint:md`)
- [ ] Agent YAML frontmatter validates
- [ ] Owning-package and focused regression checks pass (validation scope follows `AGENTS.md`)

## Well-Architected Framework Alignment

<!-- For infrastructure changes, which WAF pillars were considered? -->

- [ ] 🛡️ Security (private endpoints, managed identity, TLS 1.2+)
- [ ] 🔄 Reliability (zone redundancy, backups, monitoring)
- [ ] 💰 Cost Optimization (right-sizing, auto-scaling)
- [ ] ⚡ Performance Efficiency (caching, CDN, scaling)
- [ ] 🔧 Operational Excellence (IaC, monitoring, alerts)

## Pre-Submission Checklist

<!-- Verify all items before requesting review -->

### PR Hygiene

- [ ] PR touches < 50 files (split larger changes into stacked PRs)
- [ ] All CI checks pass locally (`npm run validate:all`)
- [ ] Commit messages follow conventional commits format
- [ ] Review conversations resolved before requesting re-review

### Code Standards

- [ ] Region defaults to `swedencentral` (or `germanywestcentral`)
- [ ] Unique suffixes used for globally-unique resource names
- [ ] Resource names within length limits (Key Vault ≤24, Storage ≤24)
- [ ] Required tags included (APEX 9-tag standard, lowercase; discovered policy wins)
- [ ] No hardcoded secrets, subscription IDs, or sensitive data
- [ ] Uses Azure Verified Modules (AVM) where available

### Documentation

- [ ] README updated with any new features
- [ ] Architecture diagram or reference docs updated (when applicable)
- [ ] Cost estimate provided (for significant infrastructure)

### Validation

- [ ] Markdown linting passes: `npm run lint:md`
- [ ] All internal links verified
- [ ] CI workflow passes
- [ ] CHANGELOG.md updated (for releases)

## Screenshots / Architecture Diagram

<!-- Add architecture diagrams or screenshots if applicable -->

## Additional Notes

<!-- Add any other context for reviewers -->

### Deployment Instructions (if applicable)

```bash
# Example deployment command
az deployment group create \
  --resource-group rg-project-dev \
  --template-file infra/bicep/project/main.bicep \
  --parameters environment=dev
```
