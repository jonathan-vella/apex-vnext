> **APEX reference.** Read [execution boundaries](../../execution-boundaries.md) first. Read-only commands stay within
> the accepted task scope.
> Mutation examples are provider context, never direct agent instructions; they need a fresh preview, current Gate 4 and
> trusted execution.
> CP-26 azd/pipeline operations are planned, not available. Examples do not create kernel artifacts, approvals or
> native-provider lifecycle authority.

# Terraform Errors

| Error            | Resolution                                 |
| ---------------- | ------------------------------------------ |
| State lock error | Wait or `terraform force-unlock <lock-id>` |
| Resource exists  | `terraform import <resource>`              |
| Backend denied   | Check storage permissions                  |
| Provider error   | `terraform init -upgrade`                  |

## Cleanup (DESTRUCTIVE)

```bash
# Changes remote state — context only; fresh preview + current Gate 4 + trusted execution required.
terraform destroy -auto-approve
```

Selective:

```bash
# Changes remote state — context only; fresh preview + current Gate 4 + trusted execution required.
terraform destroy -target=azurerm_container_app.api
```

⚠️ Permanently deletes resources.

## Port Source

Adapted from [the pinned upstream
file](https://github.com/jonathan-vella/apex/blob/c209d8bb765681aa21dce5d3cd2a3b080dad8d5e/.github/skills/apex-azure-deploy/references/recipes/terraform/errors.md).
Load only the reference needed for the active task.
