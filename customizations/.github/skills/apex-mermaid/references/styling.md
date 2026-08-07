# Styling Guidance

Use a neutral, renderer-compatible theme directive and only limited classes.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#ffffff', 'primaryTextColor': '#333333', 'lineColor': '#475569'}}}%%
graph LR
    classDef gate fill:#ffffff,stroke:#3b82f6,stroke-width:2px,color:#1f2937;
    INPUT["Accepted data"] --> GATE{"Supported slot"}:::gate
    GATE --> OUTPUT["Rendered inline view"]
```

- Prefer a single layout direction and no more than one optional `classDef`.
- Keep colors readable in Markdown renderers and avoid service icons or custom SVG.
- Let the renderer capability decide whether the target slot accepts Mermaid and whether the fence validates.
