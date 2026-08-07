---
name: apex-microsoft-docs
description: "Research official Microsoft documentation for APEX architecture and planning decisions. Use for Azure documentation, limits, WAF guidance, and version-specific configuration."
---

# APEX Microsoft Documentation

Use this skill only for an active APEX architecture or planning task that needs current official Microsoft guidance.

## Prerequisites

- `apex/taskContext` identifies the current task and the decision that needs evidence.
- A client-qualified, read-only documentation capability is available for the selected projection.

If the documentation capability is unavailable, return a missing-evidence blocker. Do not substitute model memory,
a web scrape, a CLI fallback, or an unverified third-party source.

## Workflow

1. Frame a specific question with the Azure service, version, task intent, and decision it supports.
2. Search official Microsoft documentation before retrieving a page.
3. Fetch only the result page or section needed to resolve the decision.
4. Prefer versioned reference material for limits, APIs, and configuration; use architecture guidance for trade-offs.
5. Record the source URL, retrieval time, applicability, and any uncertainty in the staged typed artifact.
6. Return missing, ambiguous, or stale documentation as a blocker; do not alter task state outside APEX MCP.

## Boundaries

- This skill is advisory. It does not configure MCP servers, execute commands, or modify files.
- Azure pricing remains the read-only ARM MCP pricing evidence path, not a documentation lookup.
- Documentation does not replace governance, quota, availability, approval, or deployment evidence.

## References

- [Research method](references/research-method.md) - query framing, evidence capture, and source selection.
