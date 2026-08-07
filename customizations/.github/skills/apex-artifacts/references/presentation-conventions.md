## Presentation Conventions

Use a template only after the kernel accepts the matching typed artifact. Keep the artifact and its kernel-rendered
document receipt canonical; the Markdown presentation is a derived view.

### Slot Rules

- Replace every required `{slot-name}` from accepted values or explicit kernel decisions.
- Preserve unknown, deferred, and unavailable values as supplied by the renderer.
- Stop and report a blocker when a required renderer slot is unavailable.
- Do not infer, invent, normalize, or use a presentation to change artifact meaning.

### Receipt

When available, include the renderer-provided artifact and template identifiers in the presentation receipt.
