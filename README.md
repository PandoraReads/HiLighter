# HiLighter - Obsidian Highlight Note Management Tool

[![Plugin Version](https://img.shields.io/github/v/release/PandoraReads/HiLighter?label=Version&color=blue)](https://github.com/pandorareads/hilighter/releases)
[![Obsidian Version](https://img.shields.io/badge/Obsidian-v1.7.2%2B-purple)](https://obsidian.md)

**HiLighter** is an Obsidian plugin focused on highlight note management. It transforms highlighted content into manageable note cards with support for multiple color annotations, AI-powered analysis, and intelligent search features, making your note organization more efficient. [中文](./README_ZH.md)

---

![screenshot1](screenshots/screenshot1.png)

## ✨ Core Features

### 🎨 Highlight Note Cards Management
*   **Sidebar Management**: Aggregates `<mark>` highlighted content from current document or entire library, supporting **instant navigation** to original text via card click.
*   **Multi-Dimensional Filtering**:
    *   **Color Filter**: Quick categorization by four highlight colors: yellow, pink, blue, and green.
    *   **Keyword Search**: Real-time filtering of note content via top search bar.
*   **AI-Powered Intelligence**:
    *   **AI Translation (Languages)**: One-click precise translation of highlighted sentences.
    *   **AI Research (Microscope)**: Comes with multiple built-in research prompt templates (philosophical analysis, concise summary, critical analysis) and supports **custom research prompts** — freely add, edit, and switch between prompts to suit different deep reading scenarios.
*   **Flexible Interaction**:
    *   **Quick Edit**: Click pencil icon to directly edit notes on cards with auto-adjusting height.
    *   **Tag System**: Support for custom tags with built-in intelligent recommendation algorithm.
    *   **Card Collection Navigation**: One-click switch to full-screen "Card Studio" mode for centralized inspiration management.
*   **Note Card Management**:
    *   **Locate Original Text**: Click a card to instantly jump to the highlighted position in the source note for quick context recovery.
    *   **Classification Tags**: Add tags to each card for organized categorization, with support for batch tag operations.
    *   **Batch Deletion**: Enter batch mode to multi-select cards and delete them in one click for efficient cleanup.

![screenshot2](screenshots/card-studio.png)

### 📄 PDF Annotation (New in 2.5)
*   **Highlight inside PDFs**: Select text in any PDF and pick a color — a translucent highlighter mark appears on the page and a note card is created instantly, with your notes, tags, flashcard review and mind maps working exactly like markdown highlights.
*   **Persistent marks**: Every highlight is anchored to page geometry, so marks survive page turns, closing and reopening the file, zooming, and vault syncs across devices.
*   **Two-way sync with cards**: Delete a card and its PDF mark disappears immediately; recolor a card and the mark updates instantly.
*   **Jump to the exact sentence**: Click a card to scroll straight to the highlighted sentence in the PDF, with a brief locate flash.

![pdf](screenshots/pdf-highlight.png)

### 🧠 Mind Maps (New in 2.4)
*   **One-Click Generation**: Import all highlights from any file as a mind map — grouped by document headings, highlight color, tag, or flat order.
*   **Xmind-Style Editing**: Drag topics to re-parent or reorder, Tab/Enter/Delete shortcuts, double-click inline editing, collapse/expand branches, undo/redo, and associative lines between any two topics.
*   **9 Structures**: Balanced mind map, logic diagram (right/left), organization chart, horizontal/vertical timelines, fishbone, and catalog organization — switchable at any time.
*   **6 Style Themes × 8 Color Palettes**: Line shapes and widths (curves, straight, rainbow branch lines) combined with full color schemes (background, node fill/border with per-level fading borders, plus a colorful card-colored option).
*   **Summaries & Notes**: Box topics with summary nodes, attach your notes to any topic, and jump straight back to the source highlight.
*   **Import & Export**: Open `.xmind` files directly; export to PNG, `.xmind` (re-openable in Xmind), a Markdown outline, or an Obsidian `.canvas` board.

![mindmap](screenshots/mindmap.png)

### ⚡ Flashcard Review (FSRS)
*   **Spaced Repetition**: Built-in FSRS scheduling turns highlight cards into flashcards with a due queue and per-card review status.
*   **Focused Review Session**: Flip cards with Space, rate recall 1–4 (Again/Hard/Good/Easy), skip or archive — all keyboard-driven.
*   **Review Insights**: Due/new counts on the studio toolbar, plus review statistics in the stats dashboard.

---

## 🚀 Quick Start

### Installation
1. **Manual Installation (Recommended):**
    *   Obtain the latest version's three main files: `main.js`, `manifest.json`, and `styles.css`.
    *   Place them in your vault folder: `.obsidian/plugins/hilighter/`.
    *   Enable the plugin in Settings > Third-party plugins.
2. **Community Plugins:** Search for `HiLighter` in Obsidian's Community Plugins browser and install it directly.

### Basic Configuration
1.  **AI LLM API (Important)**: To use AI Translation and AI Research features, configure an AI LLM API in plugin settings. Supports mainstream providers including DeepSeek, Google Gemini, and Volcano Engine (Ark).
2.  **Ribbon Icon**: You can control whether to display the sidebar highlight notes icon in settings.

---

## 🔄 Data Sync

HiLighter stores highlights in a per-device IndexedDB, but it can sync them across devices through a vault file (default `.hilighter/sync-data.json`). Enable **Sync** in settings and let **iCloud** or **Obsidian Sync** sync that file.

- **Auto-import**: the plugin watches the sync file and merges changes from other devices automatically (~30s poll + on window focus).
- **Auto-export**: local changes are exported back (debounced ~20s), merging the remote file first so you don't clobber other devices.
- **Deletes propagate** via lightweight tombstones (pruned after 30 days).
- **Add/update only**: sync merges rows but never deletes rows that were not explicitly tombstoned; it does not read Obsidian Sync's `*-conflicted-*` copies.

You can still trigger sync manually with the **Export to Vault** / **Import from Vault** commands.

### Deep links

`obsidian://hilighter?op=...` supports:

| op | action |
|---|---|
| `sync-import` | import from the sync file |
| `sync-export` | export to the sync file |
| `sync` | import then export |
| `open-studio` | open the Card Studio |
| `open-view` | open the highlight sidebar (add `&side=main` for the main area) |

Useful from iOS Shortcuts and other apps. Without a `vault=` parameter the URL targets the last-active vault.

---

## 🛠 Development & Build

Developers are welcome to contribute to improving this project!

*   **Requirements**: NodeJS (v16+)
*   **Install Dependencies**: `npm install`
*   **Development Mode**: `npm run dev`
*   **Production Build**: `npm run build`

---

## ❤️ Support & Feedback

If you enjoy this plugin, you can show your support through:

*   **Follow Official Account**: 潘多拉的数字花园 (Pandora's Digital Garden)
*   **Bilibili**: Follow 潘多拉的数字花园 on Bilibili for video walkthroughs
*   **Multi-Platform Support**: Also available on Weibo, Xiaohongshu (Little Red Book), and Knowledge Planet under the same name
*   **Contact & Feedback**: Feel free to add VX: **PandoraReads**

---

## Changelog

### v2.5.0 (2026-10-25)
- **PDF highlighting**: Select text in any PDF, pick a color, and a translucent mark appears on the page while a note card is created. Marks are anchored to page-relative selection geometry, so they survive page turns, reopens, zooming, and vault syncs — independent of the PDF renderer's internals.
- **Jump to the exact sentence**: Clicking a PDF card scrolls to the highlighted sentence and flashes it for ~1.2s (previously page-level only).
- **Two-way sync**: Deleting a card removes its PDF mark immediately; recoloring a card updates the mark instantly.
- **Fixes**: Repaired a long-standing crash in PDF highlight capture (page anchors were never saved), an overlay repaint feedback loop, and custom highlight colors not tinting sidebar card stripes.

### v2.4.1 (2026-10-24)
- **Plugin directory fix**: Reverted the manifest name to ASCII-only "HiLighter" (the community directory rejects non-ASCII names and hid the entry). The bilingual description is unchanged.

### v2.4.0 (2026-10-24)
- **Mind maps (new)**: A "Mind Map" entry in the card studio imports all highlights from a file as a mind map — grouped by document headings, color, tag, or flat — with Xmind-style editing: drag to re-parent, Tab/Enter/Delete shortcuts, collapse/expand, undo/redo, and associative lines between topics.
- **Mind map structures & themes**: Balanced/right/left logic layouts plus org chart, horizontal/vertical timelines, fishbone, and catalog structures; six style themes (line shapes, widths, rainbow branch lines, node shapes) and eight color palettes (background/line/border schemes with per-level fading borders, plus a colorful card-colored option).
- **Mind map integration**: Highlight cards stay linked to their nodes (edits re-sync, deleted cards are flagged), nodes can jump back to the source text, and maps auto-save with debounced persistence.
- **Mind map import/export**: Import `.xmind` files (modern and legacy formats, first sheet); export to PNG, `.xmind`, a Markdown outline, or an Obsidian `.canvas` board.
- **Markdown notes**: Gallery cards and the enlarged card dialog now render note Markdown (with a write/preview toggle in the dialog).
- **UI languages**: Added Japanese, Korean, French, German, Spanish, Portuguese, and Russian (partial translations with English fallback), plus a "Follow Obsidian language" option.
- **UI polish**: Unified studio topbar typography and heights, palette icon on the theme selector, transparent scrollbars in the sidebar and studio, and a back-to-top button in the sidebar highlight list.
- **Data**: Mind map documents persist in IndexedDB (schema v5, additive — no migration needed).

### v2.3.0 (2026-10-23)
- **Card Studio**: Added source-order sorting as the default, responsive card layout, consistent excerpt height, direct editing in the enlarged card dialog, and Markdown export for individual cards or full groups to a configurable vault folder.
- **Themes and cards**: Refined theme and light/dark styling; Ocean, Forest, Galaxy, Sunset, and Rose use color-dot accents instead of left color rails. Removed the “My Note” card label and refined color aliases, pin placement, and review status placement.
- **Flashcard review**: Improved card dimensions and text scale, with clearer review flow and rating states.
- **Highlight notes**: Added a note entry point to the selection toolbar, Cmd/Ctrl-click and double-click triggers, and note previews on highlight hover.
- **Images and settings**: Fixed image rendering while editing notes; added paste/drop image support and a configurable image folder.
- **Studio tools**: Added group export and a back-to-top control, and improved grouping/filter layout behavior.

---

*"Let highlighted notes become the catalyst for inspiration." — HiLighter*
