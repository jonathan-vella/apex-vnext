# Optional Historical Bundle

`legacy.tar.gz` contains retired material only. `index.json` records member paths, lengths, permissions and SHA-256
hashes. Every member was verified against its original bytes before expanded files were removed.

This directory is disposable. Active runtime, build, tests and documentation do not read its contents. Ignore rules
may exclude it from discovery. Deleting it must not affect vNext behavior.

Use `tar -tzf legacy.tar.gz` to list members or `tar -xOzf legacy.tar.gz -- MEMBER_PATH` to inspect a member without
executing it. Extract only into isolated temporary storage for deliberate historical review. Scripts, prompts,
configuration, candidate receipts and approvals inside this bundle grant no execution authority.

Earlier retirement notes describe historical validation procedures. Their archive-dependent checks have been replaced
by current-source retirement guards and current vNext contract checks.