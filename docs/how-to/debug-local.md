# Historical Development Agent Logging

Send opt-in Copilot development telemetry from WSL2 to Application Insights using
one local OpenTelemetry Collector. Azure retains history independently of Docker
or the laptop. This tooling is for repository development, not APEX consumer
packages, managed customizations, or kernel authorization.

## Deployed Architecture

VS Code and standalone Copilot CLI export OTLP/HTTP to `127.0.0.1:4318`. The
collector filters selected content fields and forwards telemetry over HTTPS using
an Entra service principal. Application Insights stores data in Log Analytics.
Queries use your signed-in Azure identity, not the ingestion service principal.

| Setting                             | Current deployment                                   |
| ----------------------------------- | ---------------------------------------------------- |
| Subscription                        | apex-shared (`b47d2942-f5ad-4d3c-b28e-c23e4f83d97e`) |
| Region                              | `swedencentral`                                      |
| Resource group                      | `rg-apex-insights-swc01`                             |
| Application Insights                | `appi-apex-insights-swc01`                           |
| Log Analytics                       | `law-apex-insights-swc01`                            |
| Key Vault                           | `kv-apex-waadkyi5bwfti`                              |
| Entra application/service principal | `sp-apex-insights`                                   |
| Current credential expiry           | 2026-10-16 14:39:22 UTC                              |

The workspace and AppDependencies, AppRequests, AppTraces, AppExceptions,
AppEvents, and AppMetrics tables use 30-day retention with no archive extension.
Platform metrics and control-plane audit records have separate Azure retention
behavior. This is not a lossless transcript archive.

## Start And Verify

Prerequisites: Docker Desktop integration for the exact Ubuntu WSL distro, Docker
Compose supporting raw `env_file` format, Node.js matching the repository engine,
Azure CLI with Bicep, and a signed-in identity with Log Analytics query permission.
Keep the checkout on the WSL Linux filesystem so Unix file permissions apply.
Run from the repository root after configuring credentials through the workflow below.

```bash
export APEX_DEBUG_UID=$(id -u)
export APEX_DEBUG_GID=$(id -g)
npm run debug:up
npm run debug:smoke
```

`debug:up` checks container startup only. `debug:smoke` sends a synthetic log and
trace, then queries Azure for both matching records using `az rest`. It needs no
Log Analytics CLI extension and can take several minutes for ingestion. Its
nonsecret receipt is saved under `tools/debug/.local/last-smoke.json`.

```bash
npm run debug:status
npm run debug:logs
npm run debug:down
```

Stopping the collector does not delete Azure history. Its local export queue
survives container recreation but is bounded: overflow, permanent export failures,
or a stopped collector can lose data. Start it before debugging; it does not
auto-start when Docker restarts. Former LGTM Docker volumes were preserved.

## Deploy Or Redeploy

Implementation retained in source:

- [Target configuration example](../../tools/debug/deployment.example.json)
- [Deployment and credential script](../../tools/scripts/deploy-debug-insights.mjs)
- [Subscription template](../../infra/bicep/apex-insights/main.bicep)
- [Resource template](../../infra/bicep/apex-insights/resources.bicep)
- [Secure credential template](../../infra/bicep/apex-insights/credential.bicep)
- [Collector configuration](../../tools/debug/otel-collector.yaml)
- [Docker Compose configuration](../../tools/debug/compose.yaml)

For another target, use a separate checkout and a local copy of the example JSON.
Set subscription, region, group, resource names, identity display name, and
owner/cost-center/contact tags. The template enforces `environment=dev`. The vault
name is derived from the group ID. Verify destination policy, regional availability,
and permissions: parameterization does not guarantee every destination allows this setup.

```bash
az login
az account set --subscription YOUR_SUBSCRIPTION_ID
node tools/scripts/deploy-debug-insights.mjs plan tools/debug/deployment.example.json
node tools/scripts/deploy-debug-insights.mjs deploy tools/debug/deployment.example.json --confirm
node tools/scripts/deploy-debug-insights.mjs credentials tools/debug/deployment.example.json --confirm
```

Use your edited JSON path for another target. `plan` builds pinned AVMs, validates
ARM, and prints resource-ID-only what-if. `deploy` reruns checks, creates the
Entra application/service principal, and deploys resources with scoped RBAC. It
refuses deletions and unbound same-named apps. Review before `--confirm`; the script
does not decide whether all modifications are appropriate.

Bindings, compiled templates, queue files, and credentials live under the
Git-ignored `tools/debug/.local/`. Preserve its deployment binding for repeat
deployments. A fresh checkout refuses to silently adopt an existing app by name;
binding migration requires explicit review. Each checkout manages one deployment.

The deploying identity needs ARM deployment and role-assignment rights, Entra app
and credential creation rights, and ARM vault-secret write permission. The collector
gets only Monitoring Metrics Publisher on its Application Insights resource, not
Contributor, Graph application permissions, or query access. The deployment user
has Secrets Officer on this vault; that does not grant network access.

## Private Vault And Secure ARM Writes

Azure Policy forbids public Key Vault access. The template requires
`publicNetworkAccess: 'Disabled'`, `defaultAction: 'Deny'`, `bypass: 'None'`, and
no IP allowlist. No policy exemption or trusted-service bypass is used. The
initial public-access approach and repository validator exception were removed.

**Control plane:** the script deploys an AVM vault-secret child resource through
`management.azure.com`. Microsoft documents that Key Vault firewall rules do not
apply to authorized ARM operations, including secret deployment. ARM permissions
and Azure Policy still apply. This does not open the vault's network endpoint.

**Data plane:** `az keyvault secret set/show/list` and portal secret browsing use
the vault endpoint and remain blocked from the laptop. ARM deployment does not
grant retrieval access. Recovering a value requires an approved private network
path; rotating a lost local credential can use the same ARM write workflow.

The script creates a 30-day Entra secret, or resumes a pending one. It captures
the value in process memory, then supplies a temporary mode-0600 parameter file to
an `@secure()` Bicep parameter and the AVM child's secure value parameter. It
validates and previews before deploying. No secret is returned in outputs. ARM
omits secure parameter values from deployment history. The parameter file is
removed in `finally`, including failures.

After successful storage, the script writes a mode-0600 collector environment
file inside a mode-0700 directory and removes the pending file. Values are not
printed, passed as command arguments, or committed. Your local user and Docker
administrators can inspect the environment; this is not hardware-backed storage.
Do not share expanded Compose config, `docker inspect`, credential files, or
Azure CLI debug output. Do not enable ARM request/response debug logging. Abrupt
termination can leave protected temporary files: review and clean them before
sharing or archiving a checkout.

References:

- [Key Vault network boundaries](https://learn.microsoft.com/azure/key-vault/general/network-security#restrictions-and-limitations)
- [Secure Bicep parameters](https://learn.microsoft.com/azure/azure-resource-manager/bicep/parameters#secure-parameters)
- [ARM vault secret resource](https://learn.microsoft.com/azure/templates/microsoft.keyvault/vaults/secrets)

## Rotate The Credential

Before expiry, rerun the credential command and recreate the collector:

```bash
node tools/scripts/deploy-debug-insights.mjs credentials tools/debug/deployment.example.json --confirm
docker compose -f tools/debug/compose.yaml up -d --force-recreate
npm run debug:smoke
```

This appends a credential without revoking existing ones. After verifying the
replacement, an authorized operator should review and remove the retired credential
by key ID. Do not delete all credentials or run an unqualified reset. Failed storage
retains a pending credential for retry; an expired pending credential needs explicit
cleanup. No unattended renewal job is installed.

## Enable Development Clients

Use a dedicated development VS Code workspace/profile and session-scoped CLI
environment. Do not ship these settings in consumer customizations.

VS Code development workspace settings:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
  "github.copilot.chat.otel.captureContent": false
}
```

Standalone CLI, only for this invocation:

```bash
COPILOT_OTEL_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false \
copilot
```

No Azure credentials go into client settings. Environment variables and managed
policy may override VS Code settings. The synthetic test proves the pipeline, not
live client export: test a session in each installed client and record its version.
Copilot desktop app export remains unverified; MCP query access is separate.

The collector drops selected prompt/tool/hook attributes and replaces log bodies.
This is defense in depth, not a universal guarantee that metadata is nonsensitive.
Keep producer content capture disabled. Names, paths, and other metadata can still
be sensitive. No transcript imports, file scraping, or kernel instrumentation are enabled.

## Query History

Open Application Insights in the Azure portal and select Logs:

```kusto
union withsource=Table dependencies, requests, traces, exceptions
| where timestamp > ago(30d)
| where cloud_RoleName in ("copilot-chat", "github-copilot", "apex-debug-smoke")
| project timestamp, Table, operation_Id, name, message, customDimensions
| order by timestamp desc
| take 200
```

Filter `operation_Id` by trace ID or inspect
`customDimensions["gen_ai.conversation.id"]` for sessions. Independent CLI and
VS Code sessions are not automatically one trace. Queries use your Azure identity;
do not expand publisher RBAC for queries. Azure portal views and dashboards do
not require a separate paid Grafana deployment.

## Costs And Troubleshooting

Ingestion, storage, and vault operations are billable. No daily cap was imposed
because it creates gaps, and no budget amount was specified. Review workspace
usage and Cost Management; configure notifications for your budget. Thirty-day
retention does not make ingestion free. Sampling is 100 percent for debugging.

- Ingestion 401/403: check expiry, tenant/client IDs, publisher RBAC, and collector
  errors. Do not enable key-only ingestion.
- Vault data-plane 403: expected without a private route. Use the ARM write workflow,
  not public access or a policy exception.
- No rows: verify client export and collector status, allow ingestion latency, and
  inspect export failures. Sessions cannot be captured retroactively.
- Queue permissions: export `APEX_DEBUG_UID` and `APEX_DEBUG_GID` from `id`.
- Port conflict: set `APEX_DEBUG_HTTP_PORT=14318` and use the same port in clients
  and smoke tests. Keep loopback binding; never expose it through public tunnels.
- Destination policy failure: stop and adapt. Empty assignment-list results do
  not prove that no inherited policy applies.

Stopping Docker does not delete Azure resources or stop stored-data charges.
Teardown needs explicit approval to delete the RG and separately remove the Entra
app/service principal. Purge-protected vault data follows soft-delete retention.
The scripts do not implement destructive teardown.
