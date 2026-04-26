"""
Replay the 10-day incremental archive against the deployed buena-ingest worker.

Walks partner-files/incremental/incremental/day-01 through day-10 in order.
For each day:
  - POSTs every incoming .eml to /replay/email (with original receivedAt and
    a property=LIE-001 subaddress hint so routing wins immediately).
  - POSTs each invoice PDF to /upload (existing bulk path).
  - Optionally POSTs the bank delta CSV to /upload (opt-in, off by default).

Outgoing emails (from *@huber-partner-verwaltung.de) are skipped by default
because they are PM-authored replies, not new inbound facts.

Run:
  uv run python pipeline/replay_incremental.py
  uv run python pipeline/replay_incremental.py --day 1
  uv run python pipeline/replay_incremental.py --base http://localhost:8787
  uv run python pipeline/replay_incremental.py --include-bank --include-outgoing

Verify after:
  curl https://buena-ingest.isiklimahir.workers.dev/vaults/LIE-001/property.md
  curl https://buena-ingest.isiklimahir.workers.dev/vaults/LIE-001/pending
  curl https://buena-ingest.isiklimahir.workers.dev/vaults/LIE-001/history
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
INCREMENTAL_ROOT = ROOT / "partner-files" / "incremental" / "incremental"
DEFAULT_BASE = "https://buena-ingest.isiklimahir.workers.dev"
PROPERTY_ID = "LIE-001"
PROPERTY_LABEL = "WEG Immanuelkirchstrasse 26"
PROPERTY_ADDRESS = "Immanuelkirchstrasse 26, 10405 Berlin"

PM_DOMAIN = "huber-partner-verwaltung.de"


def http_post(
    url: str,
    body: bytes,
    content_type: str,
    token: str | None,
    timeout: float = 60.0,
) -> dict:
    headers = {
        "content-type": content_type,
        # Cloudflare's default ruleset returns error 1010 for python-urllib UAs.
        "user-agent": "buena-replay/1.0 (+https://github.com/buena)",
    }
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {err.code} for {url}: {detail}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"network error for {url}: {err.reason}") from err
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {"raw": raw.decode("utf-8", errors="replace")}


def to_iso_utc(naive: str) -> str:
    """The simulator stores e.g. '2026-01-09T12:06:00' (Berlin local). The
    worker only uses receivedAt for ordering / display, so appending Z is
    accurate enough for replay."""
    if not naive:
        return ""
    if naive.endswith("Z"):
        return naive
    if "T" not in naive:
        # date-only; pin to noon UTC for visibility in Obsidian
        return f"{naive}T12:00:00Z"
    return f"{naive}Z"


def read_emails_index(day_dir: Path) -> dict[str, dict]:
    idx = day_dir / "emails_index.csv"
    if not idx.exists():
        return {}
    with idx.open(encoding="utf-8") as f:
        return {row["filename"]: row for row in csv.DictReader(f)}


def collect_eml_files(day_dir: Path) -> list[Path]:
    return sorted((day_dir / "emails").rglob("*.eml"))


def collect_invoice_files(day_dir: Path) -> list[Path]:
    rdir = day_dir / "rechnungen"
    if not rdir.exists():
        return []
    return sorted(rdir.rglob("*.pdf"))


def post_email(
    base: str, eml_path: Path, received_at: str, token: str | None
) -> dict:
    qs = urlencode({"property": PROPERTY_ID, "receivedAt": received_at})
    url = f"{base}/replay/email?{qs}"
    return http_post(url, eml_path.read_bytes(), "message/rfc822", token)


def post_bulk(
    base: str,
    file_path: Path,
    content_type: str,
    note: str,
    token: str | None,
) -> dict:
    qs = urlencode(
        {
            "name": file_path.name,
            "propertyId": PROPERTY_ID,
            "propertyLabel": PROPERTY_LABEL,
            "propertyAddress": PROPERTY_ADDRESS,
            "note": note,
        }
    )
    url = f"{base}/upload?{qs}"
    return http_post(url, file_path.read_bytes(), content_type, token)


def replay_day(
    base: str,
    day_dir: Path,
    *,
    include_outgoing: bool,
    include_bank: bool,
    throttle: float,
    token: str | None,
    dry_run: bool,
) -> None:
    manifest = json.loads((day_dir / "incremental_manifest.json").read_text())
    day_idx = manifest.get("day_index")
    content_date = manifest.get("content_date")
    print(f"\n=== Day {day_idx:02d} ({content_date}) ===")

    emails_meta = read_emails_index(day_dir)
    eml_files = collect_eml_files(day_dir)

    posted = skipped = 0
    for eml in eml_files:
        meta = emails_meta.get(eml.name, {})
        direction = meta.get("direction", "incoming")
        sender = meta.get("from_email", "")
        if direction == "outgoing" and not include_outgoing:
            print(f"  skip outgoing {eml.name} (from {sender})")
            skipped += 1
            continue
        received_at = to_iso_utc(meta.get("datetime", ""))
        subject = meta.get("subject", "")
        category = meta.get("category", "")
        if dry_run:
            print(f"  [dry] email {eml.name}  subj='{subject}'  cat={category}")
            continue
        try:
            result = post_email(base, eml, received_at, token)
            posted += 1
            print(
                f"  email {eml.name}  msgId={result.get('msgId', '?')}  "
                f"subj='{subject}'  cat={category}"
            )
        except RuntimeError as err:
            print(f"  ! email {eml.name} failed: {err}", file=sys.stderr)
        time.sleep(throttle)

    pdf_files = collect_invoice_files(day_dir)
    for pdf in pdf_files:
        if dry_run:
            print(f"  [dry] invoice {pdf.name}")
            continue
        try:
            note = f"incremental day-{day_idx:02d} invoice"
            result = post_bulk(base, pdf, "application/pdf", note, token)
            print(f"  invoice {pdf.name}  key={result.get('key', '?')}")
        except RuntimeError as err:
            print(f"  ! invoice {pdf.name} failed: {err}", file=sys.stderr)
        time.sleep(throttle)

    if include_bank:
        bank_csv = day_dir / "bank" / "kontoauszug_delta.csv"
        if bank_csv.exists():
            if dry_run:
                print(f"  [dry] bank {bank_csv.name}")
            else:
                try:
                    note = f"incremental day-{day_idx:02d} bank delta"
                    result = post_bulk(base, bank_csv, "text/csv", note, token)
                    print(f"  bank {bank_csv.name}  key={result.get('key', '?')}")
                except RuntimeError as err:
                    print(f"  ! bank {bank_csv.name} failed: {err}", file=sys.stderr)
                time.sleep(throttle)

    print(f"  -> posted {posted} email(s), skipped {skipped} outgoing")


def discover_days(only_day: int | None) -> list[Path]:
    if not INCREMENTAL_ROOT.exists():
        raise SystemExit(f"incremental root not found: {INCREMENTAL_ROOT}")
    days = sorted(p for p in INCREMENTAL_ROOT.glob("day-*") if p.is_dir())
    if only_day is not None:
        wanted = f"day-{only_day:02d}"
        days = [d for d in days if d.name == wanted]
        if not days:
            raise SystemExit(f"no day directory matching {wanted}")
    return days


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replay the 10-day incremental archive.")
    parser.add_argument("--base", default=DEFAULT_BASE, help="Worker base URL")
    parser.add_argument("--day", type=int, default=None, help="Replay only day N (1-10)")
    parser.add_argument("--token", default=None, help="Bearer token if INGEST_TOKEN is set")
    parser.add_argument(
        "--include-outgoing",
        action="store_true",
        help="Also replay outgoing PM replies (default: skip)",
    )
    parser.add_argument(
        "--include-bank",
        action="store_true",
        help="Also POST bank delta CSV to /upload (default: skip)",
    )
    parser.add_argument(
        "--throttle",
        type=float,
        default=1.5,
        help="Seconds to sleep between POSTs (default: 1.5)",
    )
    parser.add_argument(
        "--day-pause",
        type=float,
        default=15.0,
        help="Seconds to pause between days so the queue can drain (default: 15)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be sent, do not POST",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    days = discover_days(args.day)
    base = args.base.rstrip("/")
    print(f"Replaying {len(days)} day(s) against {base}")
    if args.dry_run:
        print("(dry-run, no POSTs)")

    started = time.monotonic()
    for i, day_dir in enumerate(days):
        replay_day(
            base,
            day_dir,
            include_outgoing=args.include_outgoing,
            include_bank=args.include_bank,
            throttle=args.throttle,
            token=args.token,
            dry_run=args.dry_run,
        )
        if i < len(days) - 1 and not args.dry_run:
            print(f"  ... pausing {args.day_pause:.0f}s for queue to drain ...")
            time.sleep(args.day_pause)

    elapsed = time.monotonic() - started
    print(f"\n=== Replay finished in {elapsed:.1f}s ===")
    print(f"  property:  {base}/vaults/{PROPERTY_ID}/property.md")
    print(f"  pending:   {base}/vaults/{PROPERTY_ID}/pending")
    print(f"  history:   {base}/vaults/{PROPERTY_ID}/history")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
