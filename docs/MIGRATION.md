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

The source boundary above is historical extraction provenance, not the current predecessor maintenance reference.

The snapshot retains the runtime packages, customizations, configuration,
qualification infrastructure, validators, tests, project controls, and frozen
evidence that existed at the source commit.

The Astro documentation site was intentionally excluded. Its useful vNext content was first extracted as ordinary
Markdown, then rebuilt under `docs/tutorials/`, `docs/how-to/`, `docs/explanation/`, and `docs/reference/`.

Devcontainer CI is disabled in the destination repository and is not an
acceptance gate. Re-enabling or dispatching it requires a new explicit
maintainer decision.

## Current Predecessor Reference

The maintainer-designated most up-to-date legacy APEX source is
[jonathan-vella/apex at perf/apex-workflow-optimization](https://github.com/jonathan-vella/apex/tree/perf/apex-workflow-optimization),
not that repository's `main` branch. Refresh and record its exact revision when a comparison is needed; do not substitute
the extraction branch or frozen source commit above. The current output-quality reference and review criteria are owned
by the [vNext PRD](vnext/PRD.md#output-quality-reference), not by this historical record.

## Ongoing Work

All new vNext implementation, qualification, documentation, issue tracking, and
release decisions belong in this repository. The original APEX repository is a
source-provenance and v1-maintenance reference only.

Live qualification must be repeated against the final commit in this repository.
Evidence bound to an earlier source commit remains historical and cannot satisfy
the final exact-head release gate.
