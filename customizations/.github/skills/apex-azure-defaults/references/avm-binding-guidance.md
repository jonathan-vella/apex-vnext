# AVM And Module Binding Guidance

Prefer Azure Verified Modules or the selected track's approved provider modules. Record module choices in typed bindings,
not direct source files.

## Selection Rules

1. Use a module family that matches the selected IaC track.
2. Bind the module to accepted architecture resource intent, governance constraints, and required tags.
3. Pin an approved module/provider version through the selected resolver or lock evidence.
4. Record required parameters, identity, networking, diagnostics, and security settings as typed binding constraints.
5. When an AVM module cannot satisfy an accepted requirement, record the exception, alternative implementation, reason,
   and traceability before CodeGen.

## Do Not

- Fetch registries or modules directly from the skill.
- Invent a module version or claim it is current.
- Paste raw Bicep or Terraform module code into a decision artifact.
- Treat an AVM choice as proof that runtime policy or deployment validation passed.
