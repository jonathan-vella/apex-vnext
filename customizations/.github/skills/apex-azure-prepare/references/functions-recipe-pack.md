# Azure Functions Recipe Pack

The Azure Functions recipe corpus is source-bound in
[`config/recipe-packs.v1.json`](../../../../../../config/recipe-packs.v1.json). It contains service guidance, base
specifications, recipe templates, and evaluation fixtures, but it is not an active capability.

## Availability

The `azure-functions-recipes` pack is `deferred` until an authorized `recipe-materializer` capability exists. Return an
unavailable blocker for requests to inspect, select, compose, stage, materialize, validate, or publish a recipe. Do not
load template content from the corpus as a workaround.

## Design Checklist

- Establish the trigger, event source, concurrency, retry, identity, network, data, and observability requirements.
- Select a hosting model only from accepted workload evidence. Treat runtime-version support as an external fact that
  needs fresh evidence.
- For Event Grid blob processing, record the required storage endpoints, identity roles, subscription ownership, and
  startup behavior as accepted implementation obligations.
- For Durable Functions, preserve orchestration determinism, state ownership, replay implications, and dependency
  boundaries in architecture and test intent.
- Keep source, target, and secret values out of task artifacts. Materialization and publishing remain unavailable.

## Handoff

Record the recipe family and unmet materialization dependency in the IaC binding. Continue only with an authorized
alternative generation path or return the blocker to the kernel.
