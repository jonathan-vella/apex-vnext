# Run Local Debug Capture

Use the WSL host collector for opt-in APEX development telemetry. This workflow is for repository development only; it
is not part of consumer packages, managed customizations, kernel authorization, or deployment authority.

## Register A Workspace

```bash
npm run debug:enable -- --workspace /path/to/apex-test --auth azure-cli
npm run debug:collector -- --workspace /path/to/apex-test --install
```

The collector runs in the foreground. It binds only to `127.0.0.1`, uses the signed-in Azure CLI identity, and removes
service-principal and inherited OpenTelemetry credentials from its environment. The first `--install` extracts the
pinned collector binary into private local state. It does not change Azure roles, subscriptions, User settings, project
settings, or consumer files.

`debug:enable` prints the User settings for a dedicated VS Code instance. Configure those settings manually, open the
registered WSL workspace, and reload. Registration does not enable capture by itself.

## Capture And Assess

```bash
npm run debug:copilot -- --workspace /path/to/apex-test
npm run debug:assess -- --workspace /path/to/apex-test --latest
```

Use `--local-only` when Azure queries are unavailable. Add `--log-root` during registration and
`--include-local-content` during assessment only when the diagnostic content has been reviewed for sharing. Local files
remain private and bounded; missing local or Azure records are not proof of successful behavior.

To stop capture for a workspace:

```bash
npm run debug:disable -- --workspace /path/to/apex-test
```

Disable removes the local registration only. It does not change User settings, organization policy, existing Azure
telemetry resources, Azure credentials, Docker volumes, or live logging infrastructure.

## Verification

```bash
npm run debug:test
```

The regression suite covers registration isolation, loopback binding, Azure CLI credential restriction, privacy filtering,
redaction, and bounded evidence reads. Live Azure ingestion and desktop-client behavior require their separate human and
cloud qualification gates.
