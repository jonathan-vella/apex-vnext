# Repository Migration

APEX vNext moved from the rolling integration branch in the original APEX
repository into this dedicated repository on 2026-07-16.

## Source Boundary

| Field                      | Value                                      |
| -------------------------- | ------------------------------------------ |
| Source repository          | `https://github.com/jonathan-vella/apex`   |
| Source branch              | `feat/apex-vnext-rewrite`                  |
| Source commit              | `60d96d5a46ff534069c58275cfd32cb8d4490971` |
| History strategy           | Clean snapshot                             |
| Destination default branch | `main`                                     |

The original repository's `main` branch was not modified. The rolling vNext pull
request was not merged into it.

## Extraction Policy

The snapshot retains the runtime packages, customizations, configuration,
qualification infrastructure, validators, tests, project controls, and frozen
evidence that existed at the source commit.

The Astro documentation site was intentionally excluded. Its vNext user pages
were migrated into `docs/guides/` as ordinary Markdown, and documentation CI was
replaced with Markdown lint, link, and freshness validation.

Devcontainer CI is disabled in the destination repository and is not an
acceptance gate. Re-enabling or dispatching it requires a new explicit
maintainer decision.

## Ongoing Work

All new vNext implementation, qualification, documentation, issue tracking, and
release decisions belong in this repository. The original APEX repository is a
source-provenance and v1-maintenance reference only.

Live qualification must be repeated against the final commit in this repository.
Evidence bound to an earlier source commit remains historical and cannot satisfy
the final exact-head release gate.
