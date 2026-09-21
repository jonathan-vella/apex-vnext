# Azure Functions on Azure Container Apps (Aspire)

Use this reference only to assess Azure Functions hosted on Azure Container Apps. Materialization remains unavailable;
record the required settings and resources as a blocked future backlog item.

> ⚠️ **Critical:** When Azure Functions use identity-based storage (e.g., `AzureWebJobsStorage__blobServiceUri`), you **must** set `AzureWebJobsSecretStorageType=Files`.

## Assessment Checks

- Require `AzureWebJobsSecretStorageType=Files` with identity-based host storage.
- Record the container image, runtime, ingress, scaling, storage, RBAC, and telemetry requirements.
- Record the missing reviewed materializer as the implementation blocker.
- Do not modify AppHost, emit Bicep, or run deployment commands from this reference.

## Why This Is Required

- Identity-based storage URIs (e.g., `AzureWebJobsStorage__blobServiceUri`) work for runtime operations
- However, Functions' internal secret/key management does not support these identity-based URIs
- File-based secret storage is mandatory for Container Apps deployments with identity-based storage

## Common Error Without This Setting

```
System.InvalidOperationException: Secret initialization from Blob storage failed due to missing both
an Azure Storage connection string and a SAS connection uri.
```

## When to Use This Configuration

- Deploying Azure Functions to Container Apps via .NET Aspire
- Using `AddAzureFunctionsProject` with `WithHostStorage` in your AppHost
- Using identity-based storage access (no connection strings)
- Setting environment variables like `AzureWebJobsStorage__blobServiceUri`
