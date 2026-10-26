---
name: pandora-hilight
description: |
  Process a note and turn its best content into HiLighter plugin highlights (multi-color
  marks + tutor-note cards): select key sentences by text type and agreed density,
  yellow = key idea / blue = concept / green = method / pink = quote, each with a tutor
  note (explanation, recall question, foreign-term gloss). Writes to the plugin sync file
  and triggers import automatically. Use when the user asks to "highlight this note",
  "make highlight notes", "annotate the essentials", or /pandora-hilight.
  Markdown notes only (PDF highlights are not supported). Interacts in the user's language.
---

# pandora-hilight — note highlights + tutor cards

## Language handling (read this first)

- **Detect the user's language from their messages.** Every user-facing interaction
  happens in that language: the parameter questions in Step 2, confirmations, progress
  updates, and the completion report. A German user is asked in German; a Japanese user
  in Japanese — regardless of the document's language.
- Card `note` content is written in the **user's language** as well. "Foreign-term
  gloss" means translate INTO the user's language (a German user gets German glosses).
- The highlighted `text` is ALWAYS copied verbatim from the document — never translated,
  never edited, punctuation included.
- `scripts/hilight_merge.py` prints status as English JSON; relay outcomes to the user
  in their own language.

## How it works (reverse-engineered, HiLighter v2.0.2+)

HiLighter's markdown highlighting is a **dual write**:

1. **Cards**: IndexedDB; bulk write channel is the sync file
   `.hilighter/sync-data.json` (version 2) + command/protocol
   `obsidian://hilighter?op=sync-import` (upsert by id).
2. **Text marks**: the note body wraps `text` in a literal
   `<mark class="hl-highlight hl-h-<color>" data-id="<id>" data-hl-color="#<hex>">text</mark>`
   — this is what makes the highlight colored and click-to-locate; `data-id` matches the
   card record.

This skill: **select highlights → build record JSON → script writes `<mark>`s + merges
the sync file + auto-triggers import**. Field spec and rules: `references/hilighter-format.md`
(read before generating records).

## Flow

### Step 1 — read the text, classify it

Read the target note and classify it (drives density and selection strategy):

| Type | Signals | Default density | Selection bias |
|---|---|---|---|
| Video/podcast transcript | `[MM:SS]` timestamp lines | 3-6 per 1k chars | complete idea sentences; skip filler and repetition |
| Foreign-language original (books/essays) | long prose in a non-user language | 5-8 per 1k chars | argument sentences + idiomatic phrases; always gloss terms |
| Regular articles/posts | ordinary paragraphs | 5-8 per 1k chars | core claims, counter-intuitive points |
| Wiki/concept pages | frontmatter type: Wiki* | 2-4 per 1k chars | definition sentences, key evidence |
| Long-form (>5000 chars) | any | 2-3 per 1k chars | skeleton-level essentials only |

### Step 2 — agree parameters (always ask; one round)

Ask **in the user's language**. Canonical English template (translate on the fly):

1. **Density**: recommend the table's default, plus high/low alternatives.
2. **Scope**: whole document / specific sections or line range.
3. **Tutor-note composition**: default is "explanation + recall question + foreign-term
   gloss", all on; each can be switched off.
4. If the material is foreign-language study material, also ask: should term glosses
   include a **usage context**? (default: yes).

If the user already stated parameters up front ("sparser", "only chapter 2"), skip the
matching questions.

### Step 3 — select highlights + write tutor notes

**Color semantics**:

| color | meaning | note must contain |
|---|---|---|
| `yellow` | core idea / key point | explanation + (when fitting) a recall question |
| `blue` | concept / term | definitional explanation; foreign terms also get a gloss + usage context in the user's language |
| `green` | method / actionable step | explanation + application hint |
| `pink` | quote / spark | an inspiring question ("How could this apply to your own project?" style) |

**Note writing** (→ the sidebar card body, Markdown):
- Unordered list `- ` items, no labels like "Explanation:" — fixed order:
  explanation → question → term gloss (omit the third line when there is no term):
  ```markdown
  - One or two sentences on why this matters / the background.
  - A question that promotes active recall?
  - term = gloss in the user's language (usage context)
  ```
- Keep notes tight: ≤ ~80 characters for CJK notes, ≤ ~25 words for Latin-script
  languages (term glosses exempt).

**Selection rules**:
- `text` must be an **exact substring of one line** in the source file
  (character-for-character, punctuation included; never cross lines, never paraphrase).
- One highlight = one complete semantic unit (a phrase up to a sentence); never half a
  clause.
- **Skip frontmatter** (select nothing inside the `---` block).
- When in doubt, leave it out.
- Line numbers of older highlights in the sync file may have drifted after file edits —
  always use the **current file's actual line numbers**, never stale sync-file values.

### Step 4 — generate records & merge

1. Locate each `text`'s line with Read; `lineIndex` is **0-based** (Read's displayed line
   number minus 1).
2. Write the records array to a temp file `/tmp/hilight-<slug>.json` (format in
   references).
3. Run:

```bash
python3 "<this skill dir>/scripts/hilight_merge.py" /tmp/hilight-<slug>.json \
  --vault "/absolute/path/of/the/confirmed/Obsidian/vault"
```

The script verifies each text is a substring of its line, dedupes by
(sourcePath, lineIndex, text), writes the `<mark>`s (skips already-marked lines;
`00_inbox/` is treated as a read-only layer — use `--no-marks` for cards only), merges
into the sync file, and automatically runs `open obsidian://hilighter?op=sync-import`
(HiLighter ≥ 2.0.2 native protocol, no third-party plugin needed).

4. Outcomes:
   - `autoImport: true` → done; report the count and color distribution.
   - `manualStep` present (protocol unavailable / plugin < 2.0.2) → tell the user (in
     their language) to run "HiLighter: Import sync data" from the command palette.
   - Script error `location mismatch` → that text/lineIndex pair did not match; fix the
     record in Step 3 and rerun (the sync file stays untouched — the script validates
     before writing anything).

### Completion report

Report **in the user's language**: text type, agreed density, actual counts (by color),
duplicates skipped, import mode (auto/manual) — and remind the user to open the note to
see the highlights and sidebar cards.

## Related

- Format details: `references/hilighter-format.md`
- Sibling skills: `pandora-dankoe-reading` (reading workflow),
  `pandora-socrates-learning` (question-driven review)
