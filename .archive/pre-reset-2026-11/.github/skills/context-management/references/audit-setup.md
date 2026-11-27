<!-- ref:audit-setup-v1 -->

# Diagnostic Setup

- Obtain the user's selected session or log file. Do not assume a fixed VS Code installation or remote-host path.
- Use the client's log-export or diagnostics surface; confirm the file exists before invoking a parser.
- Use Python for the existing parser and profiler. Do not install additional tools unless the requested analysis needs them.
- Inspect managed roles in `customizations/manifest.json` and their current agent files when investigating routing.
- Review privacy settings before enabling more detailed logging. Do not enable persistent verbose capture automatically.

For OpenTelemetry exports, follow [log profiling](log-profiling.md). For supported text logs, inspect the existing
parser's `--help` and select only the relevant directory. These tools do not change APEX state or grant approval authority.

Do not copy repository-maintenance scripts into consumer projects as an installation path. Consumer setup and updates
belong to the packaged APEX lifecycle.
