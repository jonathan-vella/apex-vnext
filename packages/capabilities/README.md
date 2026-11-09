# @apexops/capabilities

Bounded capability adapters for APEX vNext, including IaC generation and
provider execution primitives. The kernel retains authorization and workflow
authority; capabilities execute only within an authorized task boundary.

## Install

```bash
npm install @apexops/capabilities
```

## Use

```ts
import { generateBicepTree, generateTerraformTree } from "@apexops/capabilities";
```

## Documentation

- [APEX vNext repository](https://github.com/jonathan-vella/apex-vnext)
- [IaC tracks](../../docs/reference/iac-tracks.md)

## License

MIT.
