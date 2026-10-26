#!/usr/bin/env python3
"""pandora-hilight：把高亮记录写入 HiLighter（卡片）并在笔记正文包裹 <mark>（上色）。

HiLighter 的 Markdown 高亮双写：
  1. IndexedDB 卡片（经 sync-data.json + obsidian://hilighter?op=sync-import 导入）
  2. 笔记正文内 <mark class="hl-highlight hl-h-<color>" data-id="<id>"
     data-hl-color="#<hex>">text</mark> —— 有颜色、点击卡片能定位的关键

输入 JSON（agent 生成）：
  [{"text": "单行内精确子串", "color": "yellow|blue|green|pink|c_xxx",
    "note": "辅导笔记", "sourcePath": "vault相对路径", "lineIndex": 0基行号,
    "tags": ["可选"], "colorHex": "#xxxxxx（自定义色可选）"}]

用法：
  python3 hilight_merge.py <新记录.json> --vault <vault根绝对路径> [--no-open] [--no-marks]
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
        die("新记录为空或格式错误")
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
        die("--vault 必须是用户确认且存在的仓库绝对路径")
    vault = vault.resolve()
    sync_path = vault / SYNC_REL
    if not sync_path.exists():
        die(f"同步文件不存在: {sync_path}（确认 HiLighter 插件已启用过）")

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
                die(f"sourcePath 必须是仓库内的 Markdown 文件: {sp}")
            if not f.is_file():
                die(f"源文件不存在: {sp}")
            line_cache[sp] = f.read_text(encoding="utf-8").splitlines(keepends=True)
        lines = line_cache[sp]
        if li < 0 or li >= len(lines) or text not in lines[li]:
            die(f"定位失败: {sp} 第{li}行(0基) 不包含该 text: {text[:40]!r}")

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
                    die("高亮记录 id 必须是 UUID")
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

        # 正文上色：在该行内把 text 的首个出现包成 <mark>（已包过则跳过）
        if not args.no_marks:
            line = lines[li]
            already = re.search(r"<mark[^>]*>" + re.escape(text) + r"</mark>", line)
            if not already:
                if sp.startswith(INBOX_PREFIX):
                    die(f"00_inbox 为只读层，禁止写 <mark> 入 {sp}（改用 --no-marks 只出卡片）")
                hexv = color_hex(rec.get("color"), rec.get("colorHex", ""))
                mark = (
                    f'<mark class="hl-highlight hl-h-{rec["color"]}" '
                    f'data-id="{rec["id"]}" data-hl-color="{hexv}">{text}</mark>'
                )
                lines[li] = line.replace(text, mark, 1)
                marked += 1
                changed_files.add(sp)

    # 落盘：正文 + sync
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
        result["manualStep"] = "Obsidian 命令面板运行「导入同步数据」（HiLighter: Import sync data）"
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
