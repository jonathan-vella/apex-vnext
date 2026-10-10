# APEX vNext cleanup restoration

## Verified archive

Status: **verified**. See [CATALOG.json](CATALOG.json) for entries, source identities and omissions.

- Bundle: `apex-vnext-cleanup-7fbb02e1593a26ee710e6735df1ac21641efcee4.tar.gz`.
- SHA-256: `036bfd6595096a03b0796b1021a16782cf1e08afc8cb8f606fd1160f1dd91f20`.
- Baseline: `7fbb02e1593a26ee710e6735df1ac21641efcee4`.
- Originals: 624 tracked files and 73 read-only stage-time local snapshots, totaling 7,995,858 bytes.
- Members: 697 originals plus the internal `ARCHIVE-MANIFEST.json`.
- Round trip: every member path, hash and mode was verified before the exact 551 tracked retirements. After approved
  additions the bundle was rebuilt and round-trip verified again, with the retired paths still absent.
- Determinism: two independent builds were byte-identical; numeric owner/group are zero, timestamps use the
  baseline commit's committer time, regular-file modes are preserved, and gzip uses `-n`.

The explicit user-approved optimization-test amendments add four tracked originals to the earlier 620-file selection
(one validator test, then the audit, context-receipt and client-preflight tests), because the checked-in optimization
campaign is now draft/pending and those tests use synthetic authorized fixtures.
The original encrypted-artifact omission remains in force. No synthetic scanner canaries are included.
The internal manifest records the staged source capture; the external catalog records final verification without
requiring a self-referential manifest or bundle hash.

## Protection and limitations

The local encryption key `.apex/local/provider-runtime/plan-transport.key` is excluded and remains untouched in the
shared checkout. Its value and fingerprint are not recorded. The catalog identifies the single omitted encrypted
provider artifact whose plaintext could not be inspected without that key; its original remains untouched.
Related historical attestations/bindings may reference the omission. The archive cannot restore that saved plan
or the complete operational run. Current encryption functionality remains unchanged.

Gitleaks 8.30.1 scanned the explicit amended payload, including hidden, ignored and encoded content. Three findings
were verified noncredential AES-GCM authentication tags, with no suppressions; no unresolved coverage gaps remain
in the included set. A credential scan is not proof that historical evidence is nonconfidential.
Noncredential Azure identifiers in selected evidence remain unchanged.

Git metadata, dependencies, caches and other worktrees are excluded. Shared ignored originals were not retired,
recaptured or modified. Historical Terraform state and plan evidence is for inspection only. Current consumer state,
credential and saved-plan restrictions remain unchanged.

Restoration does not revive previews, approvals, cloud authorization, qualification or spending permissions.
It does not authorize operational resume. No runtime or normal validator reads archived payloads.

## Restore into a separate directory

Never extract into the active repository or overwrite current files. From the repository root, use the following
offline verification and extraction into a new, empty directory. It checks the bundle checksum, exact membership,
regular-file safety, catalog hashes and modes before publishing restored files.

```bash
mkdir restored-cleanup
python3 - restored-cleanup <<'PY'
import hashlib
import json
import os
import pathlib
import sys
import tarfile

catalog = json.loads(pathlib.Path(".archive/CATALOG.json").read_text())
archive = pathlib.Path(catalog["archivePath"])
target = pathlib.Path(sys.argv[1]).resolve()
assert target.is_dir() and not any(target.iterdir()), "Use a new empty directory"
assert hashlib.sha256(archive.read_bytes()).hexdigest() == catalog["archiveSha256"]
entries = {entry["path"]: entry for entry in catalog["entries"]}
assert len(entries) == len(catalog["entries"])
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    names = [member.name for member in members]
    assert len(names) == len(set(names)), "Duplicate archive member"
    assert set(names) == set(entries) | {"ARCHIVE-MANIFEST.json"}
    for omission in catalog["protectedOmissions"]:
        assert omission["path"] not in names
    payloads = []
    for member in members:
        relative = pathlib.PurePosixPath(member.name)
        assert member.isfile() and not relative.is_absolute()
        assert ".." not in relative.parts and "\\" not in member.name
        destination = target.joinpath(*relative.parts)
        assert destination.is_relative_to(target)
        payload = bundle.extractfile(member).read()
        if member.name in entries:
            entry = entries[member.name]
            assert len(payload) == entry["bytes"]
            assert hashlib.sha256(payload).hexdigest() == entry["sha256"]
            assert member.mode == int(entry["mode"], 8)
        else:
            internal = json.loads(payload)
            assert internal["entries"] == catalog["entries"]
        payloads.append((destination, payload, member.mode))
    for destination, payload, mode in payloads:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as output:
            output.write(payload)
        os.chmod(destination, mode)
print("Verified and restored", len(payloads), "historical members")
PY
```

Catalog entry IDs equal original root-relative paths. Restoring retired source into an active checkout requires a
separate explicit decision and fresh validation; this guide grants no compatibility or execution authority.
