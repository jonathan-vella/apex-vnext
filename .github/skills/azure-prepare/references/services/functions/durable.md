# Durable Functions

Long-running orchestrations with checkpointing and state management.

## Storage Backend

Durable Functions requires a storage backend to persist orchestration state, queues, and history.

| Backend                    | Recommendation  | Notes                                                                                                                                        |
| -------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Durable Task Scheduler** | **✅ Required** | Fully managed Azure service. Best performance, lowest latency, built-in monitoring. Supports all languages (.NET, Python, Java, JavaScript). |
| Azure Storage (default)    | ⛔ Do not use   | Legacy backend. Higher latency, harder to monitor, no built-in RBAC. Not permitted for new projects.                                         |
| MSSQL                      | Specialized     | SQL Server backend. Only when SQL infrastructure already exists and user explicitly requests it.                                             |

For new Durable Functions assessments, select Durable Task Scheduler and record the scheduler, task hub, RBAC, and app
setting requirements. Do not generate those resources here; Functions materialization is unavailable and must be
recorded as blocked future work. See the [Durable Task Scheduler reference](../durable-task-scheduler/README.md) for
assessment details.

## When to Use

- Multi-step workflows
- Fan-out/fan-in patterns
- Human interaction workflows
- Long-running processes

## Orchestrator Pattern

```javascript
const df = require("durable-functions");

module.exports = df.orchestrator(function* (context) {
  const result1 = yield context.df.callActivity("Step1");
  const result2 = yield context.df.callActivity("Step2", result1);
  return result2;
});
```

## Activity Function

```javascript
module.exports = async function (context, input) {
  return `Processed: ${input}`;
};
```

## Client Starter

```javascript
const df = require("durable-functions");

module.exports = async function (context, req) {
  const client = df.getClient(context);
  const instanceId = await client.startNew("OrchestratorFunction", undefined, req.body);
  return client.createCheckStatusResponse(context.bindingData.req, instanceId);
};
```
