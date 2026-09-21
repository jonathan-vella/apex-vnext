<!-- ref:model-changes-v1 -->

# Model Changes

Model changes require an explicitly approved scope. Read the current model catalog, toolchain and managed agent manifest;
do not copy a historical model name, context limit or latency assumption into current configuration.

1. Confirm the target model is supported by the selected client and available to the intended user.
2. Identify the affected role, prompt, tools, delegated workers and typed output contract.
3. Preserve authorization, review criteria and model-tier constraints. Do not use a terminal wrapper to bypass delegation.
4. Apply only the approved model and prompt edits. Generate projections through their existing owner.
5. Run affected model, agent and projection tests. Require observed client evidence before claiming quality or parity.

Use [prompting guidance](gpt-5-prompting.md) for the selected model's supported prompt conventions and
[audit procedure](audit-procedure.md) for review. Record rationale and evidence in the normal issue or decision record,
not a separate session-state file. No model downgrade, benchmark campaign or tool-authority expansion is implied.
