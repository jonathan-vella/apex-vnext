# Retired Root Configuration

## Status

This archive preserves root configuration files removed during the vNext root audit. They are provenance only and must
not be restored without an active consumer.

- `.git-blame-ignore-revs` referenced a commit absent from this repository and was not configured locally.
- `.markdown-link-check-site.json` configured the retired Astro documentation site and had no tracked consumer.

## Replacement Owners

- Git history and ordinary blame own source attribution.
- `.markdown-link-check.json` and the `lint:links` npm command own active Markdown link validation.

## Rollback

Restore a file to the repository root only after adding a tested consumer and validating the relevant Git or link-check
workflow.
