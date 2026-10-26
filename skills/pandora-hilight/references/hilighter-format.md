# HiLighter plugin format reference (reverse-engineered from v2.0.2 main.js)

## Storage & write channels (dual write)

- **Cards**: stored in IndexedDB (Dexie, db name `HiLighterDB_<hash>`).
- **Text marks**: markdown highlights exist as **literal `<mark>` tags** in the note
  body (not DB-side rendering, and not a `.textLayer` overlay like PDF):
  ```html
  <mark class="hl-highlight hl-h-<color>" data-id="<uuid>" data-hl-color="#<hex>">text</mark>
  ```
  `data-id` matches the card record — it powers click-to-locate and delete-sync
  (removing a card unwraps the mark).
- **Bulk card channel**: `import-sync-data` (command / protocol
  `obsidian://hilighter?op=sync-import`) reads `.hilighter/sync-data.json`
  (`version` 1 or 2, `highlights` array) and upserts by id:
  new id → added; same id with changed text/note/color/sourcePath → updated
  (empty incoming note keeps the old one, tags are merged as a union, fsrs merged);
  identical → skipped.
- With `syncOnUnload: true`, plugin unload exports the DB over the sync file —
  **trigger an import right after merging into the sync file** (the script does this
  automatically).

## Highlight record fields

```json
{
  "id": "uuid (script generates it)",
  "text": "exact substring of one source line (character-for-character, punctuation included; never cross lines)",
  "color": "yellow | pink | blue | green | c_xxxxxxxx (custom color id)",
  "note": "tutor note, Markdown, rendered on the sidebar card",
  "sourcePath": "vault-relative path, e.g. 30 Resources/Example.md",
  "lineIndex": 46,
  "createdAt": 1792003794868,
  "colorHex": "#b39ddb (only needed for custom colors)",
  "tags": ["optional tags"],
  "pdfPage": 3
}
```

- `lineIndex`: **0-based** line number. At render time the plugin matches `text` as a
  substring within that line to color it; clicking the card jumps to
  `editor.setCursor(lineIndex, 0)`. An imprecise lineIndex or text = the highlight will
  not render.
- An invalid `color` (not one of the four presets and not in the plugin's
  `customColors` setting) is **downgraded to yellow** at import. The merge script
  validates against the plugin settings.
- `pdfPage` is for PDF highlights (with pdfOverlay); markdown notes don't need it.
- `fsrs` powers spaced review (Anki-like scheduling); merged automatically at import —
  generators can ignore it.

## Color semantics (this skill's convention)

| color | meaning | note must contain |
|---|---|---|
| yellow | core idea / key point | explanation + (when fitting) a recall question |
| blue | concept / term | definitional explanation; foreign terms get a gloss + usage context in the user's language |
| green | method / actionable step | explanation + application hint |
| pink | quote / spark | an inspiring question |

Custom colors must be added in the plugin's color settings first; ids look like
`c_xxxxxxxx`.

## Import trigger (fully automatic chain)

```bash
open "obsidian://hilighter?op=sync-import"
```

HiLighter ≥ 2.0.2 ships its own protocol handler (no Advanced URI needed): `op` accepts
`sync-import` / `sync-export` / `sync` / `open-studio` / `open-view`. `sync-import` =
`importNow()`, reading the sync file and upserting by id. `hilight_merge.py` calls this
built in and falls back to telling the user to run the "HiLighter: Import sync data"
command on failure.

## Note card template

```markdown
- One or two sentences on why this matters / the background.
- A question that promotes active recall?
- term = gloss in the user's language (usage context)
```

- Unordered list `- ` items, no labels like "Explanation:"; fixed order:
  explanation → question → term gloss.
- Omit the third line when there is no term; keep it tight — ≤ ~80 characters for CJK,
  ≤ ~25 words for Latin scripts (glosses exempt).
- The card title IS the highlighted `text` — do not repeat it inside the note.
