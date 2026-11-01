#!/usr/bin/env python3
"""
Prepare the private, offline source bundle the company-match repair reads.

Reads a partner stage dump (the normalized `partner_stage` SQL that
`scripts/partner-stage.sh load` takes: plain, .gz or .zst) WITHOUT connecting to
any application database, and writes a small, sorted, hashed bundle:

    OUT/manifest.json        provenance, row counts, per-file SHA-256
    OUT/company.ndjson       one source company per line, sorted by company_id
    OUT/deal.ndjson          one deal per line, sorted by deal_id
    OUT/deal_investor.ndjson (deal_id, firm_id), sorted
    OUT/firm.ndjson          firm identity/type only, sorted by firm_id

Only those four tables are read. Person/contact rows, funds, commitments and
metrics are skipped in the input stream and never written anywhere.

Fallback: `--raw-tar DUMP.tar --builder build.sql` restores the raw dump into a
disposable PostgreSQL 17 container (never the application database), runs the
original builder there, and feeds its output through the same reader. Contact
tables are restored schema-only, so their rows never leave the dump. Compare the
result against a preferred bundle with `--compare OTHER_BUNDLE`: a difference is a
source-preparation failure.

Deterministic: the same input produces byte-identical files and manifest.
Python standard library only (plus `zstd`/`docker` binaries where used).
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from typing import BinaryIO, Callable, Iterator

FORMAT = "capbase-company-repair-snapshot"
FORMAT_VERSION = 1
EXTRACTION_VERSION = "1"
# Bump when the row filters below change.
FILTER_VERSION = "1"

# table -> (expected stage columns in order, key columns, output columns, converters)
TEXT = "text"
NUM = "num"
DATE = "date"

STAGE_COLUMNS: dict[str, list[str]] = {
    "company": ["company_id", "name", "country", "city", "website", "industry", "verticals", "about", "status"],
    "deal": ["deal_id", "company_id", "deal_date", "stage", "status", "currency", "size_local", "size_usd"],
    "deal_investor": ["deal_id", "firm_id"],
    "firm": [
        "firm_id", "name", "role", "manager_firm_type", "lp_firm_type", "country", "city", "website",
        "year_established", "about", "aum_usd", "vc_fund_share", "deal_count",
    ],
}
KEYS: dict[str, list[str]] = {
    "company": ["company_id"],
    "deal": ["deal_id"],
    "deal_investor": ["deal_id", "firm_id"],
    "firm": ["firm_id"],
}
# What reaches the bundle: identity and facts only. No firm prose, no AUM.
OUTPUT: dict[str, list[tuple[str, str]]] = {
    "company": [(c, TEXT) for c in STAGE_COLUMNS["company"]],
    "deal": [
        ("deal_id", TEXT), ("company_id", TEXT), ("deal_date", DATE), ("stage", TEXT), ("status", TEXT),
        ("currency", TEXT), ("size_local", NUM), ("size_usd", NUM),
    ],
    "deal_investor": [("deal_id", TEXT), ("firm_id", TEXT)],
    "firm": [("firm_id", TEXT), ("name", TEXT), ("role", TEXT), ("manager_firm_type", TEXT), ("lp_firm_type", TEXT)],
}
WANTED = set(STAGE_COLUMNS)
SCHEMA = "partner_stage"

COPY_RE = re.compile(rb"^COPY ([A-Za-z0-9_.\"]+) \(([^)]*)\) FROM stdin;\s*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")


class SnapshotError(Exception):
    """Input that cannot be trusted: never produce a partial bundle from it."""


# --- COPY text-format decoding --------------------------------------------------

_SIMPLE = {ord("b"): 8, ord("f"): 12, ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("v"): 11}
_OCT = b"01234567"
_HEX = b"0123456789abcdefABCDEF"


def decode_field(raw: bytes) -> str | None:
    """One COPY text-format field → str (None for `\\N`). Handles \\b \\f \\n \\r
    \\t \\v, 1–3 digit octal, \\xHH and any other escaped byte, then decodes UTF-8."""
    if raw == b"\\N":
        return None
    if b"\\" not in raw:
        return raw.decode("utf-8")
    out = bytearray()
    i, n = 0, len(raw)
    while i < n:
        c = raw[i]
        if c != 0x5C:
            out.append(c)
            i += 1
            continue
        i += 1
        if i >= n:
            raise SnapshotError("dangling backslash in COPY field")
        c = raw[i]
        if c in _OCT:
            j, v = i, 0
            while j < n and j < i + 3 and raw[j] in _OCT:
                v = v * 8 + (raw[j] - 48)
                j += 1
            out.append(v & 0xFF)
            i = j
        elif c == ord("x") and i + 1 < n and raw[i + 1] in _HEX:
            j, v = i + 1, 0
            while j < n and j < i + 3 and raw[j] in _HEX:
                v = v * 16 + int(chr(raw[j]), 16)
                j += 1
            out.append(v)
            i = j
        else:
            out.append(_SIMPLE.get(c, c))
            i += 1
    return out.decode("utf-8")


def copy_blocks(lines: Iterator[bytes]) -> Iterator[tuple[str, list[str], Iterator[list[str | None]]]]:
    """Yield (table, columns, rows) for every COPY block. `rows` must be consumed
    (or drained) before the next block is requested."""
    for line in lines:
        m = COPY_RE.match(line)
        if not m:
            continue
        table = m.group(1).decode("utf-8").replace('"', "")
        columns = [c.strip().strip('"') for c in m.group(2).decode("utf-8").split(",")]
        done = {"ended": False}

        def rows(cols: list[str] = columns, state: dict = done) -> Iterator[list[str | None]]:
            for row in lines:
                if row == b"\\.\n" or row == b"\\.":
                    state["ended"] = True
                    return
                if row.endswith(b"\n"):
                    row = row[:-1]
                fields = row.split(b"\t")
                if len(fields) != len(cols):
                    raise SnapshotError(f"{table}: row has {len(fields)} fields, expected {len(cols)}")
                yield [decode_field(f) for f in fields]
            raise SnapshotError(f"{table}: COPY block not terminated (truncated input?)")

        it = rows()
        yield table, columns, it
        for _ in it:  # drain an unconsumed block
            pass
        if not done["ended"]:
            raise SnapshotError(f"{table}: COPY block not terminated")


# --- Value conversion -------------------------------------------------------------

def convert(table: str, column: str, kind: str, value: str | None):
    if value is None:
        return None
    if kind == DATE:
        if not DATE_RE.match(value):
            raise SnapshotError(f"{table}.{column}: unexpected date {value!r} (expected ISO YYYY-MM-DD)")
        return value
    if kind == NUM:
        if not NUM_RE.match(value):
            raise SnapshotError(f"{table}.{column}: unexpected number {value!r}")
        # Same IEEE-754 nearest value PostgreSQL's ::float8 gives the live reader.
        f = float(value)
        return int(f) if f.is_integer() else f
    return value


def dumps(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


# --- Input opening ----------------------------------------------------------------

def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def open_stage(path: str) -> tuple[BinaryIO, Callable[[], None]]:
    if path.endswith(".gz"):
        f = gzip.open(path, "rb")
        return f, f.close
    if path.endswith(".zst"):
        if not shutil.which("zstd"):
            raise SnapshotError("zstd is not installed (needed for a .zst stage file)")
        p = subprocess.Popen(["zstd", "-dc", "--", path], stdout=subprocess.PIPE)
        assert p.stdout is not None

        def close() -> None:
            p.stdout.close()  # type: ignore[union-attr]
            if p.wait() != 0:
                raise SnapshotError("zstd failed to decompress the stage file")

        return p.stdout, close
    f = open(path, "rb")
    return f, f.close


# --- Extraction -------------------------------------------------------------------

def extract(stream: BinaryIO, out_dir: str, work_dir: str) -> dict:
    """Read every wanted COPY block into a temporary SQLite index (sorting and
    duplicate detection without holding a table in memory), then write sorted
    NDJSON. Returns the per-table manifest entries."""
    db = sqlite3.connect(os.path.join(work_dir, "index.sqlite"))
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    seen: dict[str, dict] = {}
    for table, columns, rows in copy_blocks(iter(stream)):
        schema, _, name = table.rpartition(".")
        if schema != SCHEMA or name not in WANTED:
            continue  # person, fund, commitment, metric: never read past the header
        if name in seen:
            raise SnapshotError(f"{name}: appears twice in the input")
        if columns != STAGE_COLUMNS[name]:
            raise SnapshotError(f"{name}: unexpected column layout {columns} (expected {STAGE_COLUMNS[name]})")
        db.execute(f'CREATE TABLE "{name}" (k TEXT PRIMARY KEY, line TEXT NOT NULL) WITHOUT ROWID')
        pos = {c: i for i, c in enumerate(columns)}
        count = dup = 0
        batch: list[tuple[str, str]] = []

        def flush() -> int:
            nonlocal batch
            dups = 0
            for k, line in batch:
                try:
                    db.execute(f'INSERT INTO "{name}" (k, line) VALUES (?, ?)', (k, line))
                except sqlite3.IntegrityError:
                    held = db.execute(f'SELECT line FROM "{name}" WHERE k = ?', (k,)).fetchone()[0]
                    if held != line:
                        raise SnapshotError(f"{name}: conflicting duplicate key {k!r}")
                    dups += 1
            batch = []
            return dups

        for row in rows:
            key_parts = [row[pos[k]] for k in KEYS[name]]
            if any(p is None or p == "" for p in key_parts):
                raise SnapshotError(f"{name}: row without a key")
            obj = {col: convert(name, col, kind, row[pos[col]]) for col, kind in OUTPUT[name]}
            batch.append(("\x1f".join(key_parts), dumps(obj)))  # type: ignore[arg-type]
            count += 1
            if len(batch) >= 5000:
                dup += flush()
        dup += flush()
        db.commit()
        seen[name] = {"input_rows": count, "duplicates": dup}

    missing = WANTED - set(seen)
    if missing:
        raise SnapshotError(f"input has no COPY block for: {', '.join(sorted(missing))}")

    tables: dict[str, dict] = {}
    for name in sorted(WANTED):
        path = os.path.join(out_dir, f"{name}.ndjson")
        h = hashlib.sha256()
        rows = 0
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            os.chmod(path, 0o600)
            for (line,) in db.execute(f'SELECT line FROM "{name}" ORDER BY k'):
                data = line + "\n"
                f.write(data)
                h.update(data.encode("utf-8"))
                rows += 1
        tables[name] = {
            "file": f"{name}.ndjson",
            "rows": rows,
            "sha256": h.hexdigest(),
            "inputRows": seen[name]["input_rows"],
            "identicalDuplicates": seen[name]["duplicates"],
            "columns": [c for c, _ in OUTPUT[name]],
        }
    db.close()
    return tables


def write_manifest(out_dir: str, created_from: dict, tables: dict) -> dict:
    bundle_hash = hashlib.sha256(
        json.dumps({k: v["sha256"] for k, v in sorted(tables.items())}, sort_keys=True).encode()
    ).hexdigest()
    manifest = {
        "format": FORMAT,
        "formatVersion": FORMAT_VERSION,
        "extractionVersion": EXTRACTION_VERSION,
        "filterVersion": FILTER_VERSION,
        "createdFrom": created_from,
        "tables": tables,
        "bundleSha256": bundle_hash,
    }
    path = os.path.join(out_dir, "manifest.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    os.chmod(path, 0o600)
    return manifest


def staging_dir(out: str) -> str:
    """A private sibling directory the bundle is written into; only a complete
    bundle is moved into place (`publish`), so a failure leaves nothing behind."""
    if os.path.exists(out) and os.listdir(out) and not os.path.exists(os.path.join(out, "manifest.json")):
        raise SnapshotError(f"{out} exists, is not empty and is not a bundle — refusing to overwrite it")
    parent = os.path.dirname(os.path.abspath(out)) or "."
    os.makedirs(parent, exist_ok=True)
    return tempfile.mkdtemp(prefix=".bundle-partial-", dir=parent)


def publish(staged: str, out: str) -> None:
    if os.path.exists(out):
        shutil.rmtree(out)
    os.rename(staged, out)
    os.chmod(out, 0o700)


def from_stage(path: str, out: str, expect_sha: str | None) -> dict:
    digest = sha256_file(path)
    if expect_sha and digest != expect_sha.lower():
        raise SnapshotError(f"input SHA-256 {digest} does not match the expected {expect_sha}")
    staged = staging_dir(out)
    try:
        with tempfile.TemporaryDirectory(prefix="company-repair-") as work:
            stream, close = open_stage(path)
            try:
                tables = extract(stream, staged, work)
            finally:
                close()
        manifest = write_manifest(staged, _stage_origin(path, digest), tables)
        publish(staged, out)
        return manifest
    except BaseException:
        shutil.rmtree(staged, ignore_errors=True)
        raise


def _stage_origin(path: str, digest: str) -> dict:
    return (
        {
            "kind": "partner-stage-sql",
            "file": os.path.basename(path),
            "sha256": digest,
            "note": "normalized stage output of the original builder (transformed, not raw)",
        }
    )


# --- Raw-dump fallback -------------------------------------------------------------

def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kw)


def unpack_raw(raw: str, work: str) -> tuple[str, str | None, dict]:
    """The custom-format dump inside the delivered archive (or the dump itself),
    verified against the archive's own `.dump.sha256`, plus its prereqs SQL.
    Returns (dump path, prereqs path | None, provenance)."""
    import tarfile

    if raw.endswith(".dump"):
        return raw, None, {"dumpMember": os.path.basename(raw), "dumpSha256": sha256_file(raw)}
    with tarfile.open(raw, "r:*") as tf:
        names = [m for m in tf.getmembers() if m.isfile() and not os.path.basename(m.name).startswith("._")]
        dumps = [m for m in names if m.name.endswith(".dump")]
        if len(dumps) != 1:
            raise SnapshotError(f"expected exactly one .dump member in {raw}, found {len(dumps)}")
        dump = dumps[0]
        sums = {m.name: m for m in names}
        sum_member = sums.get(dump.name + ".sha256")
        pre = next((m for m in names if os.path.basename(m.name) == "00-prereqs.sql"), None)
        dump_path = os.path.join(work, "dump.dump")
        h = hashlib.sha256()
        src = tf.extractfile(dump)
        assert src is not None
        with open(dump_path, "wb") as f:
            for chunk in iter(lambda: src.read(1 << 20), b""):
                h.update(chunk)
                f.write(chunk)
        digest = h.hexdigest()
        if sum_member is not None:
            expected = tf.extractfile(sum_member).read().decode().split()[0]  # type: ignore[union-attr]
            if expected != digest:
                raise SnapshotError(f"dump member SHA-256 {digest} does not match the archive's {expected}")
        pre_path = None
        if pre is not None:
            pre_path = os.path.join(work, "prereqs.sql")
            with open(pre_path, "wb") as f:
                f.write(tf.extractfile(pre).read())  # type: ignore[union-attr]
    os.chmod(work, 0o755)
    for path in (dump_path, pre_path):
        if path:
            os.chmod(path, 0o644)
    return dump_path, pre_path, {
        "dumpMember": os.path.basename(dump.name),
        "dumpSha256": digest,
        "dumpChecksumVerified": sum_member is not None,
    }


def from_raw_tar(tar: str, builder: str, out: str, image: str) -> dict:
    """Unpack → restore → build → dump inside a throwaway PostgreSQL container."""
    if not shutil.which("docker"):
        raise SnapshotError("docker is required for the raw-dump fallback")
    tar_sha, builder_sha = sha256_file(tar), sha256_file(builder)
    referenced = sorted(set(re.findall(r"\bpublic\.([a-z0-9_]+)", open(builder, encoding="utf-8").read())))
    if not referenced:
        raise SnapshotError("builder references no public.* tables")
    contact_tables = [t for t in referenced if "contact" in t]
    data_tables = [t for t in referenced if t not in contact_tables]
    name = f"capbase-repair-raw-{os.getpid()}"
    staged = staging_dir(out)
    work = tempfile.mkdtemp(prefix="company-repair-raw-")
    try:
        dump_path, pre_path, dump_info = unpack_raw(tar, work)
        mounts = ["-v", f"{os.path.abspath(dump_path)}:/in/dump.dump:ro", "-v", f"{os.path.abspath(builder)}:/in/build.sql:ro"]
        if pre_path:
            mounts += ["-v", f"{pre_path}:/in/prereqs.sql:ro"]
        run(
            ["docker", "run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=scratch", *mounts, image],
            stdout=subprocess.DEVNULL,
        )
        for _ in range(60):
            if subprocess.run(["docker", "exec", name, "pg_isready", "-U", "postgres"], stdout=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(1)
        time.sleep(2)  # the entrypoint restarts the server once after init
        for _ in range(60):
            if subprocess.run(["docker", "exec", name, "pg_isready", "-U", "postgres"], stdout=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(1)
        psql = ["docker", "exec", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"]
        run(psql + ["-c", "CREATE DATABASE raw"], stdout=subprocess.DEVNULL)
        if pre_path:
            run(psql + ["-d", "raw", "-f", "/in/prereqs.sql"], stdout=subprocess.DEVNULL)
        restore = ["docker", "exec", name, "pg_restore", "-U", "postgres", "-d", "raw", "--no-owner", "--no-acl"]
        # Contact tables: their definitions only, so the builder runs and no row leaves the dump.
        run(restore + ["--schema-only"] + sum((["-t", t] for t in contact_tables), []) + ["/in/dump.dump"])
        run(restore + sum((["-t", t] for t in data_tables), []) + ["/in/dump.dump"])
        run(psql + ["-d", "raw", "-f", "/in/build.sql"], stdout=subprocess.DEVNULL)
        dump = subprocess.Popen(
            ["docker", "exec", name, "pg_dump", "-U", "postgres", "-d", "raw", "--data-only"]
            + sum((["-t", f"{SCHEMA}.{t}"] for t in sorted(WANTED)), []),
            stdout=subprocess.PIPE,
        )
        assert dump.stdout is not None
        with tempfile.TemporaryDirectory(prefix="company-repair-") as idx:
            tables = extract(dump.stdout, staged, idx)
        if dump.wait() != 0:
            raise SnapshotError("pg_dump of the rebuilt stage failed")
    except BaseException:
        shutil.rmtree(staged, ignore_errors=True)
        raise
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(work, ignore_errors=True)
    manifest = write_manifest(
        staged,
        {
            "kind": "raw-dump-via-builder",
            "file": os.path.basename(tar),
            "sha256": tar_sha,
            **dump_info,
            "builderSha256": builder_sha,
            "image": image,
            "dataTables": len(data_tables),
            "schemaOnlyTables": len(contact_tables),
        },
        tables,
    )
    publish(staged, out)
    return manifest


def compare(a_dir: str, b_dir: str) -> list[str]:
    a = json.load(open(os.path.join(a_dir, "manifest.json")))
    b = json.load(open(os.path.join(b_dir, "manifest.json")))
    diffs = []
    for t in sorted(WANTED):
        ta, tb = a["tables"].get(t, {}), b["tables"].get(t, {})
        if ta.get("sha256") != tb.get("sha256") or ta.get("rows") != tb.get("rows"):
            diffs.append(f"{t}: {ta.get('rows')} rows {str(ta.get('sha256'))[:12]} vs {tb.get('rows')} rows {str(tb.get('sha256'))[:12]}")
    return diffs


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", help="partner stage SQL (.sql, .sql.gz, .sql.zst)")
    ap.add_argument("--raw-tar", help="fallback: the raw pg_dump tar")
    ap.add_argument("--builder", help="fallback: the original stage builder SQL")
    ap.add_argument("--image", default="postgres:17", help="fallback: PostgreSQL image (default postgres:17)")
    ap.add_argument("--out", required=True, help="bundle directory (created 0700)")
    ap.add_argument("--expect-sha256", help="refuse unless the input's SHA-256 matches")
    ap.add_argument("--compare", help="after preparing, require identical tables to this bundle")
    args = ap.parse_args(argv)
    try:
        if args.raw_tar:
            if not args.builder:
                raise SnapshotError("--raw-tar needs --builder")
            manifest = from_raw_tar(args.raw_tar, args.builder, args.out, args.image)
        elif args.input:
            manifest = from_stage(args.input, args.out, args.expect_sha256)
        else:
            raise SnapshotError("give --input STAGE.sql[.gz|.zst] or --raw-tar DUMP.tar --builder SQL")
        for t, v in sorted(manifest["tables"].items()):
            print(f"  {t:<14} {v['rows']:>9} rows  sha256 {v['sha256'][:16]}…")
        print(f"bundle {manifest['bundleSha256']}")
        if args.compare:
            diffs = compare(args.out, args.compare)
            if diffs:
                print("SOURCE PREPARATION FAILED — bundles differ:\n  " + "\n  ".join(diffs), file=sys.stderr)
                return 2
            print(f"identical to {args.compare}")
        return 0
    except (SnapshotError, UnicodeDecodeError, OSError, EOFError, subprocess.CalledProcessError) as e:
        print(f"snapshot preparation failed: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
