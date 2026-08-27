# @apexops/kernel

Deterministic APEX vNext workflow kernel. It owns state transitions, task and
gate validation, event journals, evidence handling, and authorization checks.

## Install

```bash
npm install @apexops/kernel
```

## Use

This package is designed for APEX runtime integrations. It exposes the typed
workflow primitives used by the CLI and capability adapters.

```ts
import { EventJournal, WorkflowEngine } from "@apexops/kernel";
```

## Documentation

- [APEX vNext repository](https://github.com/jonathan-vella/apex-vnext)
- [Runtime architecture](https://apexops.pro/explanation/runtime-architecture/)

## License

MIT.
