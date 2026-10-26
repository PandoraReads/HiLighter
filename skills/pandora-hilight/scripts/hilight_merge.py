#!/usr/bin/env python3
"""pandora-hilight: write highlight records into HiLighter (cards) and wrap
the note body text in <mark> tags (coloring).

HiLighter's markdown highlighting is a dual write:
  1. IndexedDB cards (imported via sync-data.json + obsidian://hilighter?op=sync-import)
  2. Literal <mark class="hl-highlight hl-h-<color>" data-id="<id>"
     data-hl-color="#<hex>">text</mark> in the note body — the colored,
     click-to-locate anchor

Input JSON (agent-generated):
  [{"text": "exact substring of one line", "color": "yellow|blue|green|pink|c_xxx",
    "note": "tutor note", "sourcePath": "vault-relative path", "lineIndex": 0-based,
    "tags": ["optional"], "colorHex": "#xxxxxx (custom colors only)"}]

Usage:
  python3 hilight_merge.py <records.json> --vault <absolute vault root> [--no-open] [--no-marks]
"""

import argparse
import json
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

SYNC_REL = ".hilighter/sync-data.json"
BUILTIN_COLORS = {"yellow", "pink", "blue", "green"}
BUILTIN_HEX = {"yellow": "#ffd700", "pink": "#ff8fb7", "blue": "#87ceeb", "green": "#98fb98"}
INBOX_PREFIX = "00_inbox/"


def die(msg: str) -> None:
    print(json.dumps({"success": False, "error": msg}, ensure_ascii=False))
    sys.exit(1)


def load_notes_records(new_raw):
    items = new_raw.get("highlights", new_raw) if isinstance(new_raw, dict) else new_raw
    if not isinstance(items, list) or not items:
        die("records empty or malformed")
    return items


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("records")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--no-marks", action="store_true")
    args = ap.parse_args()

    vault = Path(args.vault).expanduser()
    if not vault.is_absolute() or not vault.is_dir():
        die("--vault must be an absolute path to the confirmed, existing Obsidian vault")
    vault = vault.resolve()
    sync_path = vault / SYNC_REL
    if not sync_path.exists():
        die(f"sync file not found: {sync_path} (make sure the HiLighter plugin has been enabled)")

    new_items = load_notes_records(json.loads(Path(args.records).read_text(encoding="utf-8")))
    data = json.loads(sync_path.read_text(encoding="utf-8"))
    if data.get("version") != 2:
        data = {"version": 2, "exportedAt": 0, "count": 0, "highlights": data.get("highlights", [])}
    existing = {h["id"]: h for h in data.get("highlights", []) if isinstance(h.get("id"), str)}

    settings_path = vault / ".obsidian/plugins/hiLighter/data.json"
    custom = {}
    if settings_path.exists():
        try:
            st = json.loads(settings_path.read_text(encoding="utf-8"))
            custom = {c["id"]: c.get("hex", "") for c in st.get("customColors", [])}
        except Exception:
            pass

    def color_hex(color: str, fallback: str = "") -> str:
        if color in BUILTIN_HEX:
            return BUILTIN_HEX[color]
        return fallback or custom.get(color, "")

    line_cache: dict[str, list[str]] = {}
    changed_files: set[str] = set()
    now_ms = int(time.time() * 1000)
    merged, skipped, marked = 0, 0, 0

    for item in new_items:
        text = item.get("text", "")
        color = item.get("color", "yellow")
        sp = item.get("sourcePath", "")
        li = item.get("lineIndex")
        if not isinstance(text, str) or not text or not isinstance(sp, str) or not sp or type(li) is not int:
            skipped += 1
            continue
        if color not in BUILTIN_COLORS and color not in custom:
            color = "yellow"
        if sp not in line_cache:
            f = (vault / sp).resolve()
            if not f.is_relative_to(vault) or f.suffix.lower() != ".md":
                die(f"sourcePath must be a markdown file inside the vault: {sp}")
            if not f.is_file():
                die(f"source file not found: {sp}")
            line_cache[sp] = f.read_text(encoding="utf-8").splitlines(keepends=True)
        lines = line_cache[sp]
        if li < 0 or li >= len(lines) or text not in lines[li]:
            die(f"location mismatch: {sp} line {li} (0-based) does not contain the text: {text[:40]!r}")

        dup = next(
            (h for h in existing.values()
             if h.get("sourcePath") == sp and h.get("lineIndex") == li and h.get("text") == text),
            None,
        )
        if dup:
            rec = dup
            skipped += 1
        else:
            supplied_id = item.get("id")
            if supplied_id:
                try:
                    supplied_id = str(uuid.UUID(supplied_id))
                except (TypeError, ValueError, AttributeError):
                    die("highlight record id must be a UUID")
            rec = {
                "id": supplied_id or str(uuid.uuid4()),
                "text": text,
                "color": color,
                "note": item.get("note", ""),
                "sourcePath": sp,
                "lineIndex": li,
                "createdAt": item.get("createdAt") or now_ms,
            }
            if item.get("tags"):
                rec["tags"] = item["tags"]
            if color in custom:
                rec["colorHex"] = item.get("colorHex") or color_hex(color)
            existing[rec["id"]] = rec
            merged += 1

        # Text mark: wrap the first occurrence of text in the line with
        # <mark> (skip lines that are already wrapped)
        if not args.no_marks:
            line = lines[li]
            already = re.search(r"<mark[^>]*>" + re.escape(text) + r"</mark>", line)
            if not already:
                if sp.startswith(INBOX_PREFIX):
                    die(f"00_inbox/ is a read-only layer; writing <mark> into {sp} is forbidden (use --no-marks to produce cards only)")
                hexv = color_hex(rec.get("color"), rec.get("colorHex", ""))
                mark = (
                    f'<mark class="hl-highlight hl-h-{rec["color"]}" '
                    f'data-id="{rec["id"]}" data-hl-color="{hexv}">{text}</mark>'
                )
                lines[li] = line.replace(text, mark, 1)
                marked += 1
                changed_files.add(sp)

    # Persist: note bodies + sync file
    for sp in changed_files:
        (vault / sp).write_text("".join(line_cache[sp]), encoding="utf-8")

    out = {
        "version": 2,
        "exportedAt": now_ms,
        "count": len(existing),
        "highlights": list(existing.values()),
    }
    sync_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    opened = False
    if not args.no_open and merged > 0:
        uri = "obsidian://hilighter?op=sync-import"
        try:
            subprocess.run(["open", uri], check=True, timeout=10)
            opened = True
        except Exception:
            opened = False

    result = {
        "success": True,
        "merged": merged,
        "skipped": skipped,
        "markedInFile": marked,
        "total": len(existing),
        "autoImport": opened,
    }
    if not opened and merged > 0:
        result["manualStep"] = "Run 'HiLighter: Import sync data' from the Obsidian command palette"
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
