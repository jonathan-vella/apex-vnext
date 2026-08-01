# Original APEX Prompt Surface

## Status

This directory preserves original APEX workflow prompts and two compatibility utility prompts that are not part of the APEX vNext product surface. Their original relative paths are retained below this directory for audit and rollback.

## Replacement Owners

- `packages/kernel/` owns deterministic workflow transitions and authorization.
- `customizations/.github/agents/` owns discoverable interactive roles.
- `customizations/.github/skills/` owns managed workflow guidance.
- `.github/skills/python-diagrams/` and `.github/skills/mermaid/` retain active diagram routing.

## Boundaries

- Do not add archived prompts to VS Code prompt discovery paths.
- Do not restore prompt-led workflow orchestration without a vNext architecture decision and replacement proof.
- Historical references in frozen evidence, the changelog, and modernization receipts are intentionally retained.

## Rollback

Restore only the required file to its path relative to this directory, restore every active registry consumer and validation contract that depended on it, and run `npm run validate:all`. A bulk restore would reintroduce a second workflow authority and is not supported.
