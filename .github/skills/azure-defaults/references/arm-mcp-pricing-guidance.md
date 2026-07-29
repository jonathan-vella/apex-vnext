<!-- ref:arm-mcp-pricing-guidance-v1 -->

# ARM MCP Pricing Guidance

Use Microsoft Azure Resource Manager MCP directly for Azure cost and pricing evidence.

## Connection

Both supported interactive clients use:

- Endpoint: `https://mcp.management.azure.com`
- Header: `x-mcp-toolset: CostManagement,Pricing`
- Authentication: delegated OAuth handled by VS Code or Copilot CLI

Do not store access tokens in repository configuration.

## Read Tools

Use `get_retail_prices` for public retail prices. Supply service, ARM SKU, region, price type, and currency whenever the
request provides them. Match the intended meter explicitly; never select the first result when several operating systems,
price types, priorities, or meter variants are returned.

Use the read-only Cost Management tools for actual cost, forecasts, dimensions, budgets, alerts, benefit utilization,
recommendations, and reservation transactions. Query the broadest authorized billing scope when comparing many
subscriptions.

## Excluded Tools

Managed agents do not receive:

- `create_budget`
- deployment, cancellation, or resource-mutation tools
- `start_pricesheet_download`
- `get_pricesheet_status`
- unknown or renamed tools

APEX remains authoritative for workflow state, evidence acceptance, approvals, and deployment. Direct ARM MCP output is
data for the active task; it does not approve a gate or authorize a side effect.

## Legacy Reference

The former custom server guide in [pricing-guidance.md](pricing-guidance.md) is retained only to interpret historical
artifacts. Do not use its custom tool names for new work.
