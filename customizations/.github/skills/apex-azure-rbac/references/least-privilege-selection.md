# Least-Privilege Role Selection

Start with the operation a workload identity needs to perform. Prefer a built-in Azure role that covers that operation
at the narrowest viable scope.

## Selection Order

1. Prefer managed identity over credentials or shared keys.
2. Prefer a built-in role over a custom role.
3. Prefer resource scope over resource-group scope, and resource-group scope over subscription scope.
4. Prefer data-plane roles for data access and management-plane roles for resource management.
5. Define a custom role only when accepted requirements show that no built-in role can satisfy the required actions.

## Evidence Requirements

A role decision must identify the principal purpose, required operation, proposed role requirement, scope rationale,
requirement IDs, and accepted governance or identity constraints. When role-definition evidence is absent, preserve an
explicit unresolved decision instead of guessing a broad role.

## Boundaries

Do not query live role definitions, enumerate assignments, assign roles, create custom roles, or expose principal IDs.
Those operations require dedicated read capability evidence or an approved IaC/deployment path.
