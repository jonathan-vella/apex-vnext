> Ported from `jonathan-vella/apex@c209d8bb765681aa21dce5d3cd2a3b080dad8d5e`.
> Read the [vNext authority and command boundary](../../../references/kernel-boundary.md) before using this reference.
> Examples are design material for accepted task inputs, not permission to write, execute or advance state.
> Runtime defaults, effective policy tags, security invariants and exact AVM locks override sample values.
> Raw resources illustrate provider syntax; use AVM first and record any accepted coverage exception.

# Static Web Apps - Deployment

## azd Deploy (Default)

Standard deployment via Azure Developer CLI:

```bash
# Changes Azure/state: provider syntax only; use apex preview, local Gate 4 and apex deploy. Never run directly.
azd deploy
```

## GitHub-Linked Deployments

For CI/CD builds on Azure (instead of azd deploy):

```bicep
properties: {
  repositoryUrl: 'https://github.com/owner/repo'
  branch: 'main'
  buildProperties: {
    appLocation: 'src'
    apiLocation: 'api'
    outputLocation: 'dist'
  }
}
```

## Deployment Token

> ⚠️ **Security Warning:** Do NOT expose deployment tokens in ARM/Bicep outputs. Deployment outputs are visible in Azure
> portal deployment history and logs.

**Recommended approach** - retrieve token via Azure CLI and store directly in secret store:

```bash
# Capture token to variable (never echo or log)
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list --name <app-name> --query "properties.apiKey" -o tsv)

# Store directly in Key Vault
# Changes Azure/state: provider syntax only; use apex preview, local Gate 4 and apex deploy. Never run directly.
az keyvault secret set --vault-name <vault-name> --name swa-deployment-token --value "$DEPLOYMENT_TOKEN" --output none
```

**Do NOT do this** (exposes token in deployment history):

```bicep
// ❌ INSECURE - token visible in deployment history
// output deploymentToken string = staticWebApp.listSecrets().properties.apiKey
```
