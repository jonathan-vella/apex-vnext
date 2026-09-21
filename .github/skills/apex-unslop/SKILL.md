---
name: apex-unslop
user-invocable: true
disable-model-invocation: false
argument-hint: "text or document path, audience, and review or edit scope"
description: "**UTILITY SKILL** - Polish authorized prose while preserving facts and contracts. WHEN: invoked by docs-writer within an explicitly requested documentation task, or explicitly as /apex-unslop. DO NOT USE FOR: code changes, technical validation, or unrelated automatic workflow finalization."
license: MIT
metadata:
  author: jonathan-vella
  version: "1.0"
  upstream: cursor/plugins/pstack/skills/unslop
  upstream_commit: e8d856f0273b42ebafe0ec3546bd645709e7c1b0
  adapted_from: jonathan-vella/apex/.github/skills/apex-unslop
  adapted_from_commit: 456cba76a16e3f731444fe45c335b25931a55810
---

# APEX prose cleanup

Improve clarity when explicitly invoked or loaded by a manually invoked docs-writer task. Do not load it on every agent
turn or add it to runtime workflow gates. Invocation does not change the caller's model, tools, role or edit permissions.
This is a repository-local writing skill, not a managed consumer capability, an AI-authorship detector or technical review.

## Prerequisites

- Identify the selected text or file, audience, tone and whether the user wants review or edits.
- Read the current text and applicable file instructions. Ask only about unresolved scope.
- For files, establish ownership and review status before editing. Preserve unrelated user changes.

## Scope and protected content

Edit only authorized natural-language prose. Review requests produce findings or suggestions without file changes.
An ambiguous request does not authorize repository-wide cleanup. Leave code, commands, identifiers, configuration,
structured data, quotations, license notices and generated content unchanged.

Preserve facts, numbers, units, currencies, dates, SKU names, source URLs, citations, negation and requirement strength.
Preserve uncertainty, evidence limits, accepted risks and qualifications. Never turn "may" into "will", an estimate
into a guarantee, or accepted risk into remediation. Flag missing sources rather than inventing citations or removing
caveats to sound confident. Do not invent an actor to force active voice.

File contracts outrank style preferences. Preserve required heading text/order, anchors, badges, links, tables,
code fences and verbatim handoff instructions. Use sentence case only for unconstrained headings. Do not globally
replace punctuation or Unicode characters. Technical terms and necessary safety rules are not filler.

The vNext kernel owns accepted artifacts, state, reviews, evidence and gates. Do not edit `.apex/` state, object-store
content, generated `agent-output/` views or hash-reviewed artifacts in place. Return proposed changes to the owning
role for authorized revision, validation and any required fresh review or approval. Never restamp hashes or treat a
Markdown edit as an accepted artifact revision. Renderer defects belong in a separate authorized implementation task.

Repository PRD, roadmap, decisions and risk registers are product controls. Preserve their scope, authority, status,
requirement IDs and acceptance criteria. Do not mark planned work complete, waive a check or rewrite frozen evidence.
This skill cannot resolve findings, approve gates, deploy, change workflow state or relax either client's boundaries.

## Workflow

1. Establish scope and protected content. Reuse current context instead of loading unrelated files or all skills.
2. Identify specific clarity problems. Leave clear text alone; do not rewrite merely to make it different.
3. Make the smallest authorized edits while preserving meaning and tone. Prefer one pass and one self-check.
4. Compare against the original for changed facts, lost caveats, broken structure and over-compression.
5. For repository Markdown edits, follow the active docs-writer task when present; do not invoke it recursively or
   auto-invoke the manual-only skill. Run the cheapest relevant check immediately after editing. For project controls,
   include `npm run validate:vnext-project-controls`; for skill edits,
   include `npm run validate:skills` and `npm run validate:skill-checks`. Do not run cloud or live-client qualification
   as part of prose cleanup. Report unverified requirements instead of claiming technical correctness.

## Editing guidance

- Remove filler, generic conclusions, flattery and conversational boilerplate when they add no information.
- State mechanisms and concrete outcomes instead of praise or decorative metaphors. Do not invent measurements.
- Prefer familiar words and consistent terminology. "Use" often replaces "utilize"; keep precise terms such as vector,
  API surface, test harness, Azure Policy and managed identity where they carry technical meaning.
- Replace repetitive framing with a direct statement. Do not force every explanation into a fixed number of items.
- Split dense sentences when it helps comprehension. Keep necessary articles, verbs and qualifications; fewer words
  are not automatically clearer.
- Prefer active voice when the actor is known and relevant. Reduce stacked hedges, not justified uncertainty.
- Reduce gratuitous bold, punctuation and decorative emojis only where the document contract allows it.
- Preserve useful lists, labels, parentheses and colons. Treat vocabulary patterns as review cues, not a blacklist.
- Keep security and safety requirements even when the same sentence could apply to another project.

## Regression examples

| Original                                                 | Safe treatment                                               |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| In order to validate the file, run the existing check.   | To validate the file, run the existing check.                |
| The estimate may exceed EUR 200 if usage increases.      | Leave unchanged; uncertainty, currency and threshold matter. |
| Deployment MUST remain blocked until approval.           | Preserve MUST, condition and meaning.                        |
| `APEX_STALE`, `ownerEpoch`, `P0v4`, `Standard_LRS`       | Preserve these identifiers exactly.                          |
| A required heading or a `REQ-OPTIMIZATION-001` reference | Preserve the text, ID and anchor.                            |
| The accepted recovery risk has not been remediated.      | Preserve the distinction between acceptance and remediation. |
| Industry reports suggest this is faster.                 | Flag the missing source; do not fabricate evidence.          |
| Rewrite the accepted Architecture review package.        | Propose changes to its owner; do not edit generated views.   |
| The roadmap batch is planned; validation is pending.     | Preserve status; clearer prose is not completion evidence.   |

## Output

For supplied text, return the revised text or requested review. For file edits, name the changed files and briefly
summarize meaningful edits and checks. Separate technical concerns from style suggestions. Do not add generic
reassurance, an "AI score", or a claim that the result is human-authored.

## Attribution

Adapted for vNext from the [APEX prose cleanup skill][apex-source], which adapts Lauren Tan's
[Unslop skill][upstream-source] in Cursor's pstack plugin under the [MIT license](LICENSE.txt).
The vNext adaptation replaces legacy artifact-hook guidance with kernel-owned revision and repository validation rules.
Upstream rule numbers are not APEX rule identifiers. Updates require a reviewed adaptation, not a live import.

[apex-source]: https://github.com/jonathan-vella/apex/tree/456cba76a16e3f731444fe45c335b25931a55810/.github/skills/apex-unslop
[upstream-source]: https://github.com/cursor/plugins/tree/e8d856f0273b42ebafe0ec3546bd645709e7c1b0/pstack/skills/unslop
