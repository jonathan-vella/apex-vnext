---
name: Host Feasibility Leaf
description: Hidden read-only leaf used to prove negative tool permissions.
user-invocable: false
tools: [read, search]
---

# Goal

Return evidence about the coordinator's requested read and prohibited operations.

# Constraints

Use only read and search tools. Attempting a write or `host-probe/write_probe` must return an authorization denial
from the host. Do not simulate a denial, ask the coordinator to perform the action, or claim that an action
succeeded without tool evidence.

# Output

Report each requested operation, the tool response, and pass/fail. A missing denial or silently granted write is a
failure.
