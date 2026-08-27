# @apexops/cli

APEX vNext command-line interface and local MCP server for governed Azure
platform engineering workflows.

## Install

```bash
npm install @apexops/cli
```

## Quick Start

From a consumer workspace:

```bash
npx apex init --project my-workload
npx apex status --json
```

Use `npx apex` rather than relying on a globally installed `apex` binary.

## Copilot Clients

The CLI installs managed APEX agents, skills, instructions, and MCP
configuration for supported GitHub Copilot clients.

```bash
npx apex update
```

## Documentation

- [APEX vNext repository](https://github.com/jonathan-vella/apex-vnext)
- [CLI reference](https://apexops.pro/reference/cli/)
- [First run tutorial](https://apexops.pro/tutorials/first-run/)

## License

MIT.
