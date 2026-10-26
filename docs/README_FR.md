# HiLighter - Outil de gestion de notes surlignées pour Obsidian

[![Plugin Version](https://img.shields.io/github/v/release/PandoraReads/HiLighter?label=Version&color=blue)](https://github.com/pandorareads/hilighter/releases)
[![Obsidian Version](https://img.shields.io/badge/Obsidian-v1.7.2%2B-purple)](https://obsidian.md)

**English** | [简体中文](./README_ZH.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | **Français** | [Deutsch](./README_DE.md) | [Español](./README_ES.md) | [Português](./README_PT.md) | [Русский](./README_RU.md)

---

**HiLighter** est un plugin Obsidian dédié à la gestion des notes surlignées. Il transforme le contenu surligné en cartes de notes facilement gérables, avec prise en charge des annotations multicolores, de l'analyse par IA et de la recherche intelligente, pour une organisation de vos notes plus efficace. Fonctionne avec Markdown, PDF et EPUB.

![screenshot1](../screenshots/screenshot1.png)

## ✨ Fonctionnalités principales

### 🎨 Gestion des cartes de notes surlignées
*   **Gestion latérale** : Regroupe le contenu `<mark>` surligné du document courant ou de toute la bibliothèque, avec **navigation instantanée** vers le texte source en cliquant sur une carte.
*   **Filtrage multidimensionnel** :
    *   **Filtre par couleur** : Catégorisation rapide selon les quatre couleurs de surlignage : jaune, rose, bleu et vert.
    *   **Recherche par mot-clé** : Filtrage en temps réel du contenu des notes via la barre de recherche en haut.
*   **Intelligence par IA** :
    *   **Traduction IA (Languages)** : Traduction précise des phrases surlignées en un clic.
    *   **Recherche IA (Microscope)** : Plusieurs modèles de prompts de recherche intégrés (analyse philosophique, résumé concis, analyse critique) et prise en charge des **prompts de recherche personnalisés** — ajoutez, modifiez et basculez librement entre les prompts pour différents scénarios de lecture approfondie.
*   **Interaction flexible** :
    *   **Édition rapide** : Cliquez sur l'icône crayon pour modifier directement les notes sur les cartes, avec hauteur auto-ajustable.
    *   **Système de tags** : Tags personnalisés pris en charge, avec algorithme de recommandation intelligent intégré.
    *   **Navigation dans la collection** : Basculez en un clic vers le mode plein écran « Card Studio » pour gérer vos inspirations de manière centralisée.
*   **Gestion des cartes de notes** :
    *   **Localisation du texte source** : Cliquez sur une carte pour accéder instantanément à la position surlignée dans la note d'origine et retrouver rapidement le contexte.
    *   **Tags de classification** : Ajoutez des tags à chaque carte pour une organisation structurée, avec opérations de tags par lots.
    *   **Suppression par lots** : Activez le mode lot pour sélectionner plusieurs cartes et les supprimer en un clic, pour un nettoyage efficace.

![screenshot2](../screenshots/card-studio.png)

### 📄 Annotation PDF (nouveau en 2.5)
*   **Surligner dans les PDF** : Sélectionnez du texte dans n'importe quel PDF et choisissez une couleur — un marqueur translucide apparaît sur la page et une carte de note est créée instantanément ; vos notes, tags, révisions en flashcards et cartes mentales fonctionnent exactement comme avec les surlignages Markdown.
*   **Marques persistantes** : Chaque surlignage est ancré à la géométrie de la page, de sorte que les marques survivent aux changements de page, à la fermeture/réouverture du fichier, au zoom et à la synchronisation du coffre entre appareils.
*   **Synchronisation bidirectionnelle avec les cartes** : Supprimer une carte fait disparaître immédiatement sa marque dans le PDF ; changer la couleur d'une carte met la marque à jour instantanément.
*   **Aller à la phrase exacte** : Cliquez sur une carte pour faire défiler directement jusqu'à la phrase surlignée dans le PDF, avec un bref flash de localisation.

![pdf](../screenshots/pdf-highlight.png)

### 📖 Lecture et surlignage EPUB (nouveau en 2.6)
*   **Lisez vos epub** : cliquez sur n'importe quel fichier `.epub` pour l'ouvrir dans le lecteur HiLighter (activez « Détecter toutes les extensions de fichiers » dans Paramètres → Fichiers et liens, ou utilisez la commande *Ouvrir un livre EPUB*). La position de lecture est mémorisée pour chaque livre.
*   **Surlignez et prenez des notes** : sélectionnez du texte et surlignez en quatre couleurs via le même menu — traduction et recherche IA incluses. Les marques sont ancrées par CFI : elles survivent aux réouvertures, changements de page et synchronisations ; supprimer ou recolorer une carte met la page à jour instantanément.
*   **Les cartes localisent la source** : chaque surlignage devient une carte ; cliquez pour revenir à la phrase exacte avec un flash de localisation.
*   **Barre du lecteur** : plan déroulant pour sauter aux chapitres, saut de page avec numéros générés automatiquement, et signets (ajouter la page courante, revenir depuis la liste, supprimer à tout moment).
*   **Deux modes de lecture** : pages horizontales (boutons ou balayage) ou défilement vertical continu — basculez à tout moment, votre position est conservée.

### 🧠 Cartes mentales (nouveau en 2.4)
*   **Génération en un clic** : Importez tous les surlignages de n'importe quel fichier sous forme de carte mentale — groupés par titres du document, couleur de surlignage, tag ou ordre simple.
*   **Édition à la Xmind** : Glissez les sujets pour les réorganiser ou les déplacer, raccourcis Tab/Entrée/Suppr, édition en ligne par double-clic, replier/déplier les branches, annuler/rétablir, et lignes d'association entre deux sujets.
*   **9 structures** : Carte mentale équilibrée, diagramme logique (droite/gauche), organigramme, frises horizontale/verticale, diagramme Ishikawa et organisation par catalogue — changez à tout moment.
*   **6 thèmes de style × 8 palettes de couleurs** : Formes et épaisseurs de lignes (courbes, droites, branches arc-en-ciel) combinées à des schémas de couleurs complets (arrière-plan, remplissage/bordure des nœuds avec bordures s'estompant par niveau, plus une option colorée reprenant les couleurs des cartes).
*   **Résumés et notes** : Encadrez des sujets avec des nœuds de résumé, joignez vos notes à n'importe quel sujet, et retournez directement au surlignage source.
*   **Import & export** : Ouvrez directement les fichiers `.xmind` ; exportez en PNG, `.xmind` (réouvrable dans Xmind), plan Markdown ou tableau Obsidian `.canvas`.

![mindmap](../screenshots/mindmap.png)

### ⚡ Révision en flashcards (FSRS)
*   **Répétition espacée** : La planification FSRS intégrée transforme les cartes de surlignage en flashcards, avec une file d'attente des révisions à venir et un statut de révision par carte.
*   **Session de révision concentrée** : Retournez les cartes avec Espace, évaluez le rappel de 1 à 4 (Encore/Difficile/Bien/Facile), passez ou archivez — tout au clavier.
*   **Analyses de révision** : Compteurs de cartes à réviser/nouvelles dans la barre du studio, plus des statistiques de révision dans le tableau de bord.

---

## 🚀 Démarrage rapide

### Installation
1. **Installation manuelle (recommandée) :**
    *   Récupérez les trois fichiers principaux de la dernière version : `main.js`, `manifest.json` et `styles.css`.
    *   Placez-les dans le dossier de votre coffre : `.obsidian/plugins/hilighter/`.
    *   Activez le plugin dans Paramètres > Plugins tiers.
2. **Plugins communautaires :** Recherchez `HiLighter` dans le navigateur de plugins communautaires d'Obsidian et installez-le directement.

### Configuration de base
1.  **API LLM IA (important)** : Pour utiliser la traduction IA et la recherche IA, configurez une API LLM dans les paramètres du plugin. Compatible avec les principaux fournisseurs, dont DeepSeek, Google Gemini et Volcano Engine (Ark).
2.  **Icône du ruban** : Vous pouvez contrôler l'affichage de l'icône des notes surlignées dans la barre latérale via les paramètres.

---

## 🤖 Skill d'agent : surligner tout un document en un seul prompt

Le skill optionnel [`pandora-hilight`](../skills/pandora-hilight/SKILL.md) permet à un agent IA (ZCode, Claude Code, …) de traiter une note pour vous : il sélectionne les phrases à surligner, attribue les couleurs par sens (jaune = idée clé, bleu = concept, vert = méthode, rose = citation), rédige une note d'étude pour chaque surlignage et enregistre le tout directement dans HiLighter. Le skill interagit dans votre langue — posez vos questions en français, il vous guide et annote en français.

**Installation** — copiez le bloc ci-dessous et envoyez-le à votre agent :

```text
Please install the pandora-hilight skill from https://github.com/PandoraReads/HiLighter:
1. Sparse-clone the repo: git clone --depth 1 --filter=blob:none --sparse https://github.com/PandoraReads/HiLighter /tmp/hilighter-repo && cd /tmp/hilighter-repo && git sparse-checkout set skills/pandora-hilight
2. Copy the whole skills/pandora-hilight folder into my agent skills directory:
   - ZCode: ~/.zcode/skills/pandora-hilight
   - Claude Code: ~/.claude/skills/pandora-hilight
   (detect which one I use and install there; if both exist, install to both)
3. Verify that SKILL.md exists with a valid frontmatter, clean up /tmp/hilighter-repo, and tell me how to trigger the skill.
```

Après l'installation, dites simplement à votre agent « highlight this note » ou lancez `/pandora-hilight`. Nécessite le plugin HiLighter installé dans votre coffre ; le skill écrit les surlignages dans le fichier de synchronisation du plugin (`.hilighter/sync-data.json`) et déclenche l'import automatiquement.

Vous préférez le manuel ? Une seule ligne :

```bash
git clone --depth 1 https://github.com/PandoraReads/HiLighter /tmp/hl && mkdir -p ~/.zcode/skills && cp -r /tmp/hl/skills/pandora-hilight ~/.zcode/skills/ && rm -rf /tmp/hl
```

---

## 🔄 Synchronisation des données


HiLighter stocke les surlignages dans un IndexedDB propre à chaque appareil, mais peut les synchroniser entre appareils via un fichier du coffre (par défaut `.hilighter/sync-data.json`). Activez la **Synchronisation** dans les paramètres et laissez **iCloud** ou **Obsidian Sync** synchroniser ce fichier.

- **Import automatique** : le plugin surveille le fichier de synchronisation et fusionne automatiquement les modifications des autres appareils (polling ~30 s + au retour au premier plan de la fenêtre).
- **Export automatique** : les modifications locales sont réexportées (débounced ~20 s), en fusionnant d'abord le fichier distant afin de ne pas écraser les données des autres appareils.
- **Les suppressions se propagent** via des marqueurs tombstone légers (purgés après 30 jours).
- **Ajout/mise à jour uniquement** : la synchronisation fusionne les lignes mais ne supprime jamais les lignes qui n'ont pas été explicitement marquées comme supprimées ; elle ne lit pas les copies `*-conflicted-*` d'Obsidian Sync.

Vous pouvez toujours déclencher la synchronisation manuellement avec les commandes **Exporter vers le coffre** / **Importer depuis le coffre**.

### Liens profonds

`obsidian://hilighter?op=...` prend en charge :

| op | action |
|---|---|
| `sync-import` | importer depuis le fichier de synchronisation |
| `sync-export` | exporter vers le fichier de synchronisation |
| `sync` | importer puis exporter |
| `open-studio` | ouvrir le Card Studio |
| `open-view` | ouvrir le panneau latéral des surlignages (ajoutez `&side=main` pour la zone principale) |

Pratique depuis les Raccourcis iOS et d'autres applications. Sans paramètre `vault=`, l'URL cible le dernier coffre actif.

---

## 🛠 Développement & build

Les développeurs sont les bienvenus pour contribuer à l'amélioration de ce projet !

*   **Prérequis** : NodeJS (v16+)
*   **Installation des dépendances** : `npm install`
*   **Mode développement** : `npm run dev`
*   **Build de production** : `npm run build`

---

## ❤️ Soutien & retours

Si vous appréciez ce plugin, vous pouvez montrer votre soutien via :

*   **Suivre le compte officiel** : 潘多拉的数字花园 (Pandora's Digital Garden)
*   **Bilibili** : suivez 潘多拉的数字花园 sur Bilibili pour des vidéos de présentation
*   **Multi-plateformes** : également disponible sur Weibo, Xiaohongshu (Little Red Book) et Knowledge Planet sous le même nom
*   **Contact & retours** : ajoutez-moi sur VX : **PandoraReads**

### ☕ Offrez-moi un café

Si HiLighter vous fait gagner du temps, vous pouvez offrir un café au développeur (scan avec Alipay / WeChat) :

<p align="center">
  <img src="screenshots/buy-me-a-coffee.png" alt="Offrez-moi un café - QR codes Alipay / WeChat" width="640">
</p>

---

## Journal des modifications

### v2.6.0 (2026-10-26)
- **Signets et modes de lecture** : la barre du lecteur gagne les signets (marquer la page courante, y revenir depuis la liste, suppression en un clic) en remplacement de l'ancien bouton de reprise, ainsi qu'une bascule page ⇄ défilement — tournages de page horizontaux (boutons ou balayage gauche/droite) ou défilement vertical continu, avec position conservée au basculement et progression sauvegardée en temps réel pendant le défilement.
- **Barre d'outils du lecteur EPUB** : menu déroulant du plan (sauter à n'importe quel chapitre), saut de page (numéros de page générés automatiquement avec curseur et saisie exacte, mis en cache par livre) et bouton « Reprendre la dernière position de lecture ». Les sauts via plan/page/carte n'écrasent jamais votre position enregistrée : la reprise pointe toujours là où vous vous êtes réellement arrêté.
- **Ordre des cartes** : les cartes de surlignage de l'epub courant suivent désormais l'ordre de lecture du livre (position CFI) au lieu de l'ordre de création ; le tri par ordre source du studio utilise le même comparateur.
- **Lecture et surlignage EPUB (corrigé)** : les fichiers EPUB du coffre s'ouvrent désormais dans le lecteur HiLighter — la vue restait vide car elle n'était pas enregistrée comme vue de fichier (FileView) et ne recevait jamais le fichier. Sélectionnez du texte pour surligner en quatre couleurs, cliquez sur une carte pour revenir à la phrase exacte avec un flash de localisation, et supprimer ou recolorer une carte se répercute instantanément sur la page. Un livre corrompu affiche désormais un message lisible avec un bouton de relance.

### v2.5.1 (2026-10-25)
- **Configuration des modèles IA** : Les préréglages préremplissent désormais tout le formulaire (seule la clé API reste à saisir). Un bouton « Récupérer la liste des modèles » interroge les IDs de modèles réellement disponibles pour votre clé, et les noms de produits courants (ex. `deepseek-v3`) sont auto-corrigés en IDs de modèles API réels. En cas d'erreur 400/404, le message liste désormais les modèles disponibles pour votre clé.
- **Correction Kimi** : Les nouvelles clés Kimi ne servent que les modèles `kimi-*` (préréglage par défaut désormais `kimi-latest`), et k2.6+ n'accepte que la température 1 — chaque modèle peut maintenant définir sa propre température dans l'éditeur.
- **Explication IA** : La barre d'outils de sélection de texte gagne un bouton « Explication IA » qui rédige une courte annotation directement dans le champ de note. Le panneau d'analyse IA du texte intégral a été supprimé.
- **Corrections** : Le sélecteur de préréglages est désormais défilable, et la page des paramètres conserve votre position de défilement après modification.

### v2.5.0 (2026-10-25)
- **Surlignage PDF** : Sélectionnez du texte dans n'importe quel PDF, choisissez une couleur, et une marque translucide apparaît sur la page pendant qu'une carte de note est créée. Les marques sont ancrées à la géométrie de sélection relative à la page : elles survivent aux changements de page, aux réouvertures, au zoom et aux synchronisations du coffre.
- **Aller à la phrase exacte** : Cliquer sur une carte PDF fait défiler jusqu'à la phrase surlignée et la fait clignoter ~1,2 s (auparavant seulement au niveau de la page).
- **Synchronisation bidirectionnelle** : Supprimer une carte retire immédiatement sa marque dans le PDF ; recolorer une carte met la marque à jour instantanément.
- **Corrections** : Réparation d'un crash de longue date dans la capture des surlignages PDF (les ancres de page n'étaient jamais enregistrées), d'une boucle de repaint de la couche superposée et de couleurs de surlignage personnalisées ne teintant pas les bandes des cartes latérales.

### v2.4.1 (2026-10-24)
- **Correction du répertoire de plugins** : Le nom du manifest est revenu à « HiLighter » en ASCII uniquement (le répertoire communautaire refuse les noms non ASCII et masquait l'entrée). La description bilingue est inchangée.

### v2.4.0 (2026-10-24)
- **Cartes mentales (nouveau)** : Une entrée « Carte mentale » dans le studio de cartes importe tous les surlignages d'un fichier sous forme de carte mentale — groupée par titres, couleur, tag ou ordre simple — avec édition à la Xmind : glisser pour réorganiser, raccourcis Tab/Entrée/Suppr, replier/déplier, annuler/rétablir, lignes d'association.
- **Structures & thèmes de cartes mentales** : Dispositions logiques équilibrée/droite/gauche plus organigramme, frises horizontale/verticale, Ishikawa et catalogue ; six thèmes de style (formes de lignes, épaisseurs, branches arc-en-ciel, formes de nœuds) et huit palettes de couleurs (schémas arrière-plan/lignes/bordures avec bordures s'estompant par niveau, plus une option colorée reprenant les couleurs des cartes).
- **Intégration des cartes mentales** : Les cartes de surlignage restent liées à leurs nœuds (les modifications se resynchronisent, les cartes supprimées sont signalées), les nœuds peuvent revenir au texte source, et les cartes sont sauvegardées automatiquement avec persistance débounce.
- **Import/export des cartes mentales** : Import des fichiers `.xmind` (formats moderne et ancien, première feuille) ; export en PNG, `.xmind`, plan Markdown ou tableau Obsidian `.canvas`.
- **Notes Markdown** : Les cartes de la galerie et la fenêtre de carte agrandie affichent désormais les notes en Markdown (avec bascule écriture/aperçu dans la fenêtre).
- **Langues de l'interface** : Ajout du japonais, coréen, français, allemand, espagnol, portugais et russe (traductions partielles avec repli anglais), plus une option « Suivre la langue d'Obsidian ».
- **Soins de l'UI** : Typographie et hauteurs unifiées de la barre supérieure du studio, icône de palette sur le sélecteur de thème, barres de défilement transparentes dans le panneau latéral et le studio, bouton retour en haut dans la liste des surlignages.
- **Données** : Les documents de cartes mentales persistent dans IndexedDB (schéma v5, additif — aucune migration nécessaire).

### v2.3.0 (2026-10-23)
- **Studio de cartes** : Ajout du tri par ordre du texte source comme option par défaut, mise en page responsive des cartes, hauteur d'extrait unifiée, édition directe dans la fenêtre de carte agrandie, et export Markdown des cartes individuelles ou de groupes entiers vers un dossier configurable du coffre.
- **Thèmes et cartes** : Affinage des thèmes et des styles clair/sombre ; Ocean, Forest, Galaxy, Sunset et Rose utilisent des points colorés au lieu de rails colorés sur le côté gauche. Suppression du label « My Note » des cartes et amélioration des alias de couleurs, du placement des épingles et du statut de révision.
- **Révision en flashcards** : Dimensions des cartes et échelle de texte améliorées, flux de révision et états d'évaluation plus clairs.
- **Notes surlignées** : Ajout d'un point d'entrée de note dans la barre d'outils de sélection, déclencheurs Cmd/Ctrl-clic et double-clic, et aperçu des notes au survol des surlignages.
- **Images et paramètres** : Correction du rendu des images pendant l'édition des notes ; prise en charge du collage/dépôt d'images et dossier d'images configurable.
- **Outils du studio** : Ajout de l'export de groupe et d'un bouton retour en haut, et amélioration du comportement de mise en page des groupes/filtres.

---

*« Que les notes surlignées deviennent le catalyseur de l'inspiration. » — HiLighter*
