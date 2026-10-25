# HiLighter - Obsidian-Tool zur Verwaltung von Markierungsnotizen

[![Plugin Version](https://img.shields.io/github/v/release/PandoraReads/HiLighter?label=Version&color=blue)](https://github.com/pandorareads/hilighter/releases)
[![Obsidian Version](https://img.shields.io/badge/Obsidian-v1.7.2%2B-purple)](https://obsidian.md)

**English** | [简体中文](./README_ZH.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Français](./README_FR.md) | **Deutsch** | [Español](./README_ES.md) | [Português](./README_PT.md) | [Русский](./README_RU.md)

---

**HiLighter** ist ein Obsidian-Plugin, das sich auf die Verwaltung von Markierungsnotizen konzentriert. Es verwandelt markierte Inhalte in übersichtlich verwaltbare Notizkarten mit Unterstützung für mehrfarbige Anmerkungen, KI-gestützte Analyse und intelligente Suche – für eine effizientere Organisation deiner Notizen.

![screenshot1](screenshots/screenshot1.png)

## ✨ Kernfunktionen

### 🎨 Verwaltung von Markierungsnotizkarten
*   **Seitenleisten-Verwaltung**: Fasst `<mark>`-Markierungen aus dem aktuellen Dokument oder der gesamten Bibliothek zusammen und ermöglicht per Klick auf eine Karte das **sofortige Springen** zur Originalstelle.
*   **Mehrdimensionale Filterung**:
    *   **Farbfilter**: Schnelle Kategorisierung nach den vier Markierungsfarben Gelb, Pink, Blau und Grün.
    *   **Stichwortsuche**: Echtzeitfilterung des Notizinhalts über das Suchfeld oben.
*   **KI-Intelligenz**:
    *   **KI-Übersetzung (Languages)**: Präzise Übersetzung markierter Sätze mit einem Klick.
    *   **KI-Recherche (Microscope)**: Enthält mehrere integrierte Recherche-Prompt-Vorlagen (philosophische Analyse, knappe Zusammenfassung, kritische Analyse) und unterstützt **eigene Recherche-Prompts** – füge Prompts frei hinzu, bearbeite und wechsle zwischen ihnen für verschiedene Szenarien vertieften Lesens.
*   **Flexible Interaktion**:
    *   **Schnellbearbeitung**: Klicke auf das Stift-Symbol, um Notizen direkt auf der Karte zu bearbeiten – mit automatisch angepasster Höhe.
    *   **Tag-System**: Eigene Tags werden unterstützt, inklusive intelligentem Empfehlungsalgorithmus.
    *   **Kartensammlung**: Wechsle mit einem Klick in den Vollbildmodus „Card Studio", um Ideen zentral zu verwalten.
*   **Verwaltung der Notizkarten**:
    *   **Zur Originalstelle springen**: Ein Klick auf eine Karte springt sofort zur markierten Stelle in der Quellnotiz, um schnell den Kontext wiederzufinden.
    *   **Klassifizierungs-Tags**: Füge jeder Karte Tags zur strukturierten Ordnung hinzu, inklusive Batch-Tag-Operationen.
    *   **Stapel Löschung**: Aktiviere den Batch-Modus, wähle mehrere Karten aus und lösche sie mit einem Klick – für effizientes Aufräumen.

![screenshot2](screenshots/card-studio.png)

### 📄 PDF-Anmerkungen (neu in 2.5)
*   **Direkt in PDFs markieren**: Text in einem beliebigen PDF auswählen und eine Farbe wählen – auf der Seite erscheint eine durchscheinende Textmarker-Markierung und es wird sofort eine Notizkarte erstellt; Notizen, Tags, Flashcard-Wiederholung und Mindmaps funktionieren genau wie bei Markdown-Markierungen.
*   **Beständige Markierungen**: Jede Markierung ist an die Seitengeometrie verankert und übersteht darum das Umblättern, Schließen und erneute Öffnen der Datei, Zoomen und die Vault-Synchronisierung zwischen Geräten.
*   **Zwei-Wege-Synchronisierung mit Karten**: Löscht man eine Karte, verschwindet die PDF-Markierung sofort; ändert man die Kartenfarbe, aktualisiert sich die Markierung sofort.
*   **Zum exakten Satz springen**: Ein Klick auf eine Karte scrollt direkt zum markierten Satz im PDF, mit kurzem Aufblitzen zur Orientierung.

![pdf](screenshots/pdf-highlight.png)

### 🧠 Mindmaps (neu in 2.4)
*   **Erstellung mit einem Klick**: Alle Markierungen einer Datei als Mindmap importieren – gruppiert nach Dokumentüberschriften, Markierungsfarbe, Tag oder einfacher Reihenfolge.
*   **Xmind-artiges Bearbeiten**: Themen per Drag & Drop umhängen oder umsortieren, Tab/Enter/Löschen-Kürzel, Inline-Bearbeitung per Doppelklick, Zweige auf-/zuklappen, Rückgängig/Wiederherstellen sowie Verbindungslinien zwischen beliebigen zwei Themen.
*   **9 Strukturen**: Ausgewogene Mindmap, Logikdiagramm (rechts/links), Organigramm, horizontale/vertikale Zeitstrahlen, Ishikawa-Diagramm und Katalogorganisation – jederzeit umschaltbar.
*   **6 Stilthemen × 8 Farbpaletten**: Linienformen und -stärken (Kurven, Geraden, Regenbogen-Zweiglinien) kombiniert mit vollständigen Farbschemata (Hintergrund, Knotenfüllung/-rahmen mit pro Ebene verblassenden Rändern, plus einer farbenfrohen Option in Kartenfarben).
*   **Zusammenfassungen & Notizen**: Themen mit Zusammenfassungsknoten umrahmen, Notizen an jedes Thema anhängen und direkt zur Quellmarkierung zurückspringen.
*   **Import & Export**: `.xmind`-Dateien direkt öffnen; Export als PNG, `.xmind` (in Xmind wieder öffnbar), Markdown-Gliederung oder Obsidian-`.canvas`-Board.

![mindmap](screenshots/mindmap.png)

### ⚡ Flashcard-Wiederholung (FSRS)
*   **Spaced Repetition**: Die integrierte FSRS-Planung macht aus Markierungskarten Flashcards mit Fälligkeits-Warteschlange und Wiederholungsstatus pro Karte.
*   **Fokussierte Wiederholungssitzung**: Karten mit Leertaste umdrehen, Erinnerung mit 1–4 bewerten (Again/Hard/Good/Easy), überspringen oder archivieren – alles per Tastatur.
*   **Wiederholungs-Statistiken**: Fällige/neue Karten in der Studio-Symbolleiste sowie Wiederholungsstatistiken im Statistik-Dashboard.

---

## 🚀 Schnellstart

### Installation
1. **Manuelle Installation (empfohlen):**
    *   Lade die drei Hauptdateien der neuesten Version herunter: `main.js`, `manifest.json` und `styles.css`.
    *   Lege sie in deinen Vault-Ordner: `.obsidian/plugins/hilighter/`.
    *   Aktiviere das Plugin unter Einstellungen > Community-Plugins.
2. **Community-Plugins:** Suche in Obsidians Community-Plugin-Browser nach `HiLighter` und installiere es direkt.

### Grundeinstellungen
1.  **KI-LLM-API (wichtig)**: Um KI-Übersetzung und KI-Recherche zu nutzen, konfiguriere in den Plugin-Einstellungen eine KI-LLM-API. Unterstützt gängige Anbieter wie DeepSeek, Google Gemini und Volcano Engine (Ark).
2.  **Ribbon-Symbol**: In den Einstellungen lässt sich steuern, ob das Symbol für Markierungsnotizen in der Seitenleiste angezeigt wird.

---

## 🔄 Datensynchronisierung

HiLighter speichert Markierungen in einem gerätebezogenen IndexedDB, kann sie aber über eine Vault-Datei (Standard `.hilighter/sync-data.json`) geräteübergreifend synchronisieren. Aktiviere **Synchronisierung** in den Einstellungen und lasse **iCloud** oder **Obsidian Sync** diese Datei synchronisieren.

- **Auto-Import**: Das Plugin überwacht die Sync-Datei und führt Änderungen von anderen Geräten automatisch zusammen (~30 s Polling + bei Fensterfokus).
- **Auto-Export**: Lokale Änderungen werden zurückgeschrieben (entprellt ~20 s), zuvor wird die Remote-Datei zusammengeführt, damit du die Daten anderer Geräte nicht überschreibst.
- **Löschungen werden weitergegeben** über leichtgewichtige Tombstones (nach 30 Tagen bereinigt).
- **Nur Hinzufügen/Aktualisieren**: Die Synchronisierung führt Zeilen zusammen, löscht aber niemals Zeilen, die nicht ausdrücklich als Tombstone markiert wurden; Obsidian-Sync-Kopien mit `*-conflicted-*` werden nicht gelesen.

Die Synchronisierung lässt sich weiterhin manuell mit **In Vault exportieren** / **Aus Vault importieren** auslösen.

### Deep Links

`obsidian://hilighter?op=...` unterstützt:

| op | Aktion |
|---|---|
| `sync-import` | aus der Sync-Datei importieren |
| `sync-export` | in die Sync-Datei exportieren |
| `sync` | importieren, dann exportieren |
| `open-studio` | das Card Studio öffnen |
| `open-view` | die Markierungs-Seitenleiste öffnen (mit `&side=main` im Hauptbereich) |

Nützlich für iOS-Kurzbefehle und andere Apps. Ohne `vault=`-Parameter zielt die URL auf den zuletzt aktiven Vault.

---

## 🛠 Entwicklung & Build

Entwickler:innen sind herzlich willkommen, dieses Projekt mitzugestalten!

*   **Voraussetzungen**: NodeJS (v16+)
*   **Abhängigkeiten installieren**: `npm install`
*   **Entwicklungsmodus**: `npm run dev`
*   **Produktions-Build**: `npm run build`

---

## ❤️ Unterstützung & Feedback

Wenn dir dieses Plugin gefällt, kannst du es so unterstützen:

*   **Offiziellem Konto folgen**: 潘多拉的数字花园 (Pandora's Digital Garden)
*   **Bilibili**: Folge 潘多拉的数字花园 auf Bilibili für Video-Tutorials
*   **Multi-Plattform-Präsenz**: Auch auf Weibo, Xiaohongshu (Little Red Book) und Knowledge Planet unter demselben Namen
*   **Kontakt & Feedback**: Füge mich gerne auf VX hinzu: **PandoraReads**

### ☕ Lade mich auf einen Kaffee ein

Wenn dir HiLighter Zeit spart, kannst du den Entwickler auf einen Kaffee einladen (per Alipay / WeChat scannen):

<p align="center">
  <img src="screenshots/buy-me-a-coffee.png" alt="Kaffee ausgeben - Alipay / WeChat QR-Codes" width="640">
</p>

---

## Änderungsprotokoll

### v2.5.2 (2026-10-26)
- **EPUB-Lesen & Markierungen (behoben)**: EPUB-Dateien im Vault öffnen sich jetzt im HiLighter-Reader — zuvor blieb die Ansicht leer, weil sie nicht als Dateiansicht (FileView) registriert war und die Datei nie erhielt. Text auswählen, in vier Farben markieren; ein Kartenklick springt zum exakten Satz mit Aufblink-Flash, und Löschen/Umfärben einer Karte spiegelt sich sofort auf der Buchseite. Ein defektes Buch zeigt jetzt eine lesbare Fehlermeldung mit Wiederholen-Button.

### v2.5.1 (2026-10-25)
- **KI-Modelleinrichtung**: Voreinstellungen füllen nun das gesamte Formular vor (nur der API-Schlüssel bleibt einzugeben). Ein Button „Modellliste abrufen" zieht die Modell-IDs, die dein Schlüssel tatsächlich nutzen kann, und gängige Produktnamen (z. B. `deepseek-v3`) werden automatisch zu echten API-Modell-IDs korrigiert. Bei 400/404 listet die Fehlermeldung nun die für deinen Schlüssel verfügbaren Modelle auf.
- **Kimi-Fix**: Neue Kimi-Schlüssel dienen nur `kimi-*`-Modelle (Voreinstellung jetzt `kimi-latest`), und k2.6+ akzeptiert nur Temperatur 1 – jedes Modell kann nun in der Bearbeitung seine eigene Temperatur setzen.
- **KI-Erklärung**: Die Textauswahl-Symbolleiste erhält einen Button „KI-Erklärung", der eine kurze Anmerkung direkt ins Notizfeld schreibt. Das Volltext-Analyse-Panel wurde entfernt.
- **Fixes**: Die Voreinstellungs-Auswahl ist nun scrollbar, und die Einstellungsseite behält die Scroll-Position nach Bearbeitungen.

### v2.5.0 (2026-10-25)
- **PDF-Markierungen**: Text in einem beliebigen PDF auswählen, eine Farbe wählen, und eine durchscheinende Markierung erscheint auf der Seite, während eine Notizkarte erstellt wird. Markierungen sind an die seitenrelative Auswahl-Geometrie verankert und überstehen so Umblättern, erneutes Öffnen, Zoomen und Vault-Syncs.
- **Zum exakten Satz springen**: Ein Klick auf eine PDF-Karte scrollt zum markierten Satz und lässt ihn ~1,2 s aufblitzen (zuvor nur seitengenau).
- **Zwei-Wege-Sync**: Löschen einer Karte entfernt die PDF-Markierung sofort; Umfärben einer Karte aktualisiert die Markierung sofort.
- **Fixes**: Reparatur eines lange bestehenden Absturzes bei der PDF-Markierungserfassung (Seitenanker wurden nie gespeichert), einer Overlay-Repaint-Rückkopplungsschleife und benutzerdefinierter Markierungsfarben, die die Farbstreifen der Seitenleistenkarten nicht einfärbten.

### v2.4.1 (2026-10-24)
- **Plugin-Verzeichnis-Fix**: Der Manifest-Name wurde auf das reine ASCII „HiLighter" zurückgesetzt (das Community-Verzeichnis lehnt nicht-ASCII-Namen ab und versteckte den Eintrag). Die zweisprachige Beschreibung blieb unverändert.

### v2.4.0 (2026-10-24)
- **Mindmaps (neu)**: Ein „Mindmap"-Eintrag im Card Studio importiert alle Markierungen einer Datei als Mindmap – gruppiert nach Überschriften, Farbe, Tag oder Reihenfolge – mit Xmind-artigem Editieren: Ziehen zum Umhängen, Tab/Enter/Löschen-Kürzel, Auf-/Zuklappen, Rückgängig/Wiederherstellen und Verbindungslinien zwischen Themen.
- **Mindmap-Strukturen & Themen**: Ausgeglichene/rechte/linke Logiklayouts plus Organigramm, horizontale/vertikale Zeitstrahlen, Ishikawa und Katalog; sechs Stilthemen (Linienformen, -stärken, Regenbogen-Zweiglinien, Knotenformen) und acht Farbpaletten (Hintergrund-/Linien-/Rahmenschemata mit verblassenden Rändern pro Ebene, plus einer farbenfrohen Option in Kartenfarben).
- **Mindmap-Integration**: Markierungskarten bleiben mit ihren Knoten verknüpft (Bearbeitungen resynchronisieren sich, gelöschte Karten werden markiert), Knoten können zur Quelle zurückspringen, und Mindmaps speichern automatisch mit entprellter Persistenz.
- **Mindmap-Import/Export**: Import von `.xmind`-Dateien (moderne und alte Formate, erstes Blatt); Export als PNG, `.xmind`, Markdown-Gliederung oder Obsidian-`.canvas`-Board.
- **Markdown-Notizen**: Galeriekarten und der vergrößerte Kartendialog rendern nun Notiz-Markdown (mit Umschaltung Schreiben/Vorschau im Dialog).
- **UI-Sprachen**: Japanisch, Koreanisch, Französisch, Deutsch, Spanisch, Portugiesisch und Russisch hinzugefügt (teilweise Übersetzungen mit englischem Fallback), plus Option „Sprache von Obsidian folgen".
- **UI-Politur**: Vereinheitlichte Typografie und Höhen der Studio-Kopfleiste, Paletten-Symbol am Themenwähler, transparente Scrollbars in Seitenleiste und Studio sowie ein Nach-oben-Button in der Markierungsliste der Seitenleiste.
- **Daten**: Mindmap-Dokumente werden in IndexedDB persistiert (Schema v5, additiv – keine Migration nötig).

### v2.3.0 (2026-10-23)
- **Card Studio**: Sortierung nach Quellreihenfolge als Standard hinzugefügt, responsive Kartenlayouts, einheitliche Auszugshöhen, direktes Bearbeiten im vergrößerten Kartendialog sowie Markdown-Export einzelner Karten oder ganzer Gruppen in einen konfigurierbaren Vault-Ordner.
- **Themen und Karten**: Verfeinerte Themen und Hell-/Dunkel-Styling; Ocean, Forest, Galaxy, Sunset und Rose nutzen Farbpunkt-Akzente statt linker Farbleisten. Das „My Note"-Kartenlabel entfernt und Farbaliase, Pin-Platzierung sowie Wiederholungsstatus-Platzierung verfeinert.
- **Flashcard-Wiederholung**: Verbesserte Kartengrößen und Textskala, klarerer Wiederholungsablauf und Bewertungsanzeige.
- **Markierungsnotizen**: Notizeinstieg in der Textauswahl-Symbolleiste hinzugefügt, Auslösung per Cmd/Ctrl-Klick und Doppelklick sowie Notizvorschau beim Hover über Markierungen.
- **Bilder und Einstellungen**: Bildrendering beim Notizbearbeiten korrigiert; Einfügen/Ziehen von Bildern und konfigurierbarer Bildordner ergänzt.
- **Studio-Werkzeuge**: Gruppenexport und Nach-oben-Steuerung hinzugefügt, Gruppierungs-/Filterlayout verbessert.

---

*„Mögen markierte Notizen zum Katalysator der Inspiration werden." — HiLighter*
