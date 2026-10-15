// @ts-nocheck
import {
	Plugin,
	TFile,
	WorkspaceLeaf,
	Notice,
	Platform,
	ItemView,
	setIcon,
	getIcon,
	App,
	TextComponent,
	Modal,
	FuzzySuggestModal
} from 'obsidian';
import { HiLighterSettingTab, DEFAULT_SETTINGS } from './settings';
import type { HiLighterSettings } from './models';
import { DEFAULT_RESEARCH_PROMPTS, AI_MODEL_PRESETS } from './models';
import type { AIModelConfig, ThemeId } from './models';
import { HighlightView } from './highlight-view';
import { HighlightManagerView, HIGHLIGHT_MANAGER_VIEW_TYPE } from './studio/studio-view';
import { HIGHLIGHT_VIEW_TYPE } from './view-types';
import { showHighlightMenu, hideHighlightMenu } from './selection/selection-menu';
import { registerClickNoteTriggers, openImageNoteCommand } from './selection/click-note';
import { isValidColorId, getColorDef } from './colors';
import { injectCustomColorStyles } from './appearance';
import { capturePdfContext } from './pdf/pdf-anchors';
import { registerPdfOverlay } from './pdf/pdf-overlay';
import { EpubView, EPUB_VIEW_TYPE } from './epub/epub-view';
import { openEpubRegistry } from './epub/registry';
import { db, initDb } from './db';
import type { HighlightNote } from './models';
import { randomUUID } from './mocks/crypto';
import { setLang, t } from './i18n';

export default class HiLighterPlugin extends Plugin {
	settings: HiLighterSettings;
	highlightMenu: HTMLElement | null = null;
	lastSelection: string = '';
	lastContext: any = null;
	pendingSelectionInfo: { selection: string; context: any; x: number; y: number; doc: Document } | null = null;

	async onload() {
		// Initialize vault-specific database before anything else
		initDb(this.app.vault.adapter.basePath || this.app.vault.getRoot().path);

		await this.loadSettings();
		setLang(this.settings.language);

		// Normalize settings blocks that may predate newer fields
		this.settings.notePopup = { doubleClick: true, modifierClick: true, singleClick: true, ...this.settings.notePopup };
		this.settings.fsrs = { desiredRetention: 0.9, newPerDay: 20, enableFuzz: false, ...this.settings.fsrs };

		// Migrate: ensure researchPrompts exists
		if (!this.settings.researchPrompts || this.settings.researchPrompts.length === 0) {
			if (this.settings.researchPrompt) {
				this.settings.researchPrompts = [
					{ id: 'default', name: t('migration.defaultPrompt'), prompt: this.settings.researchPrompt },
					{ id: 'classic', name: t('migration.classicPrompt'), prompt: DEFAULT_RESEARCH_PROMPTS[0].prompt },
				];
			} else {
				this.settings.researchPrompts = [...DEFAULT_RESEARCH_PROMPTS];
			}
			this.settings.activeResearchPromptId = this.settings.researchPrompts[0].id;
			await this.saveSettings();
		}

		// Migrate: convert old AI provider settings to new aiModels list
		if (!this.settings.aiModels || this.settings.aiModels.length === 0) {
			const migratedModels: AIModelConfig[] = [];
			const providerMap: Record<string, { baseUrl: string; model: string; apiKey: string }> = {
				deepseek: { baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', apiKey: (this.settings as any).deepseekApiKey || '' },
				gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: (this.settings as any).geminiModel || 'gemini-3.5-flash', apiKey: (this.settings as any).geminiApiKey || '' },
				ark: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: 'doubao-1-5-lite-32k-250115', apiKey: (this.settings as any).arkApiKey || '' },
				custom: { baseUrl: (this.settings as any).customApiUrl || '', model: (this.settings as any).customModel || '', apiKey: (this.settings as any).customApiKey || '' },
			};

			const oldProvider = (this.settings as any).aiProvider as string | undefined;
			if (oldProvider && providerMap[oldProvider]?.apiKey) {
				// Migrate the active provider
				const p = providerMap[oldProvider];
				migratedModels.push({
					id: Date.now().toString(36) + Math.random().toString(36).slice(2),
					name: oldProvider.charAt(0).toUpperCase() + oldProvider.slice(1),
					baseUrl: p.baseUrl,
					model: p.model,
					apiKey: p.apiKey,
				});
			}

			// Also migrate any other providers that have API keys
			for (const [key, config] of Object.entries(providerMap)) {
				if (key === oldProvider) continue;
				if (config.apiKey) {
					migratedModels.push({
						id: Date.now().toString(36) + Math.random().toString(36).slice(2) + key,
						name: key.charAt(0).toUpperCase() + key.slice(1),
						baseUrl: config.baseUrl,
						model: config.model,
						apiKey: config.apiKey,
					});
				}
			}

			this.settings.aiModels = migratedModels;
			if (migratedModels.length > 0 && !this.settings.activeModelId) {
				this.settings.activeModelId = migratedModels[0].id;
			}
			await this.saveSettings();
		}

		// 1. Register Views
		this.registerView(HIGHLIGHT_VIEW_TYPE, (leaf) => new HighlightView(leaf, this));
		this.registerView(HIGHLIGHT_MANAGER_VIEW_TYPE, (leaf) => new HighlightManagerView(leaf, this));

		// Runtime CSS for user-defined custom highlight colors
		injectCustomColorStyles(document, this.settings);

		// EPUB: claim the extension unless another plugin already did
		try {
			const registry = (this.app as any).viewRegistry;
			const claimed = registry?.getTypeByExtension?.('epub');
			if (claimed && claimed !== EPUB_VIEW_TYPE) {
				new Notice(t('epub.conflict'));
			} else {
				this.registerView(EPUB_VIEW_TYPE, (leaf) => new EpubView(leaf, this));
				this.registerExtensions(['epub'], EPUB_VIEW_TYPE);
			}
		} catch {
			// viewRegistry shape varies; registering is still safe
			this.registerView(EPUB_VIEW_TYPE, (leaf) => new EpubView(leaf, this));
			this.registerExtensions(['epub'], EPUB_VIEW_TYPE);
		}

		// 2. Initialize
		this.initializeFeatures();

		// 3. Settings Tab
		this.addSettingTab(new HiLighterSettingTab(this.app, this));
	}

	/**
	 * Initialize actual workspace features
	 */
	private initializeFeatures() {
		// 1. Ribbon Icon
		this.addRibbonIcon('highlighter', t('ribbon.highlight'), () => this.activateView(HIGHLIGHT_VIEW_TYPE, 'right'));

		// 2. Commands
		this.addCommand({
			id: 'open-highlight-view',
			name: t('cmd.openHighlight'),
			callback: () => this.activateView(HIGHLIGHT_VIEW_TYPE, 'right'),
		});
		this.addCommand({
			id: 'open-highlight-manager',
			name: t('cmd.manageHighlights'),
			callback: () => this.activateView(HIGHLIGHT_MANAGER_VIEW_TYPE, 'main'),
		});
		this.addCommand({
			id: 'cycle-theme',
			name: t('cmd.cycleTheme'),
			callback: () => this.cycleTheme(),
		});
		this.addCommand({
			id: 'toggle-shortcut-highlight',
			name: t('cmd.toggleShortcut'),
			callback: () => this.toggleHighlightShortcut(),
		});
		this.addCommand({
			id: 'new-image-note',
			name: t('cmd.newImageNote'),
			callback: () => openImageNoteCommand(this),
		});
		this.addCommand({
			id: 'open-epub',
			name: t('cmd.openEpub'),
			callback: () => this.openEpubPicker(),
		});

		// Click-to-note triggers (double-click / Cmd+click on markdown words)
		registerClickNoteTriggers(this);

		// PDF textLayer highlight overlay (best-effort, toggleable)
		registerPdfOverlay(this);
	// 3. Platform Specific Selection Logic
		if (Platform.isMobile) {
			this.initMobileSupport();
		} else {
			this.initDesktopSupport();
		}

		// Auto-open highlight view on startup for tablets if possible
		if (Platform.isTablet) {
			this.app.workspace.onLayoutReady(() => {
				this.activateView(HIGHLIGHT_VIEW_TYPE, 'right');
			});
		}

		// 5. Sync Commands
		this.addCommand({
			id: 'export-sync-data',
			name: t('cmd.exportSync'),
			callback: () => this.exportSyncFile(),
		});
		this.addCommand({
			id: 'import-sync-data',
			name: t('cmd.importSync'),
			callback: () => this.importSyncFile(),
		});

		// 4. Sync Highlight Paths on Rename/Move
		this.registerEvent(
			this.app.vault.on('rename', async (file, oldPath) => {
				await db.updateHighlightPaths(oldPath, file.path);

				// Refresh HighlightView if open
				this.app.workspace.iterateAllLeaves((leaf) => {
					if (leaf.view.getViewType() === HIGHLIGHT_VIEW_TYPE) {
						(leaf.view as any).render();
					}
				});
			})
		);
	}

	async onunload() {
		if (this.settings.syncEnabled && this.settings.syncOnUnload && !Platform.isMobile) {
			try {
				await this.exportSyncFile();
			} catch (e) {
				console.error('[HiLighter] Auto-export on unload failed:', e);
			}
		}
		this.hideHighlightMenu();
	}

	/**
	 * Refresh all registered views (called when language changes)
	 */
	refreshAllViews() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.getViewType() === HIGHLIGHT_VIEW_TYPE ||
				leaf.view.getViewType() === HIGHLIGHT_MANAGER_VIEW_TYPE) {
				(leaf.view as any).render();
			}
		});
	}

	/**
	 * Cycle through the available themes.
	 * Legacy 'minimal' (removed) is treated as 'editorial'.
	 */
	async cycleTheme() {
		const themes: ThemeId[] = [
			'editorial', 'native', 'paper',
			'ocean', 'forest', 'galaxy', 'cyber', 'sunset', 'rose',
		];
		const current = themes.includes(this.settings.theme as ThemeId)
			? this.settings.theme as ThemeId
			: 'editorial';
		const next = themes[(themes.indexOf(current) + 1) % themes.length]!;
		this.settings.theme = next;
		await this.saveSettings();
		this.refreshAllViews();
		new Notice(t('notice.themeSwitched', { theme: t('settings.theme.' + next) }));
	}

	/**
	 * Toggle whether the highlight menu requires the shortcut (on) or shows on
	 * text selection directly (off). Takes effect immediately on desktop.
	 */
	async toggleHighlightShortcut() {
		this.settings.useShortcut = !this.settings.useShortcut;
		await this.saveSettings();
		new Notice(this.settings.useShortcut ? t('notice.shortcutEnabled') : t('notice.shortcutDisabled'));
	}

	private initDesktopSupport() {
		const handleSelection = async (evt: MouseEvent) => {
			if (this.highlightMenu && this.highlightMenu.contains(evt.target as Node)) return;
			const target = evt.target as HTMLElement;
			const doc = target.ownerDocument || document;
			const sel = doc.getSelection();
			const selection = sel?.toString().trim();

			if (!selection || selection.length === 0 || selection.length > 2000) {
				this.pendingSelectionInfo = null;
				if (this.highlightMenu && !this.highlightMenu.contains(target)) {
					this.hideHighlightMenu();
				}
				return;
			}

			// Find the leaf containing this target
			let leaf: WorkspaceLeaf | null = null;
			this.app.workspace.iterateAllLeaves(l => {
				if (l.view.containerEl.contains(target)) leaf = l;
			});

			const context = await this.captureContext(selection, target, leaf);

			if (sel && sel.rangeCount > 0) {
				const range = sel.getRangeAt(0);
				const rect = range.getBoundingClientRect();
				if (rect.width > 0) {
					context.leaf = leaf;
					const x = rect.left + rect.width / 2;
					const y = rect.top - 50;

					if (this.settings.useShortcut) {
						// Shortcut mode: store selection info, show menu only when the shortcut is pressed
						this.pendingSelectionInfo = { selection, context, x, y, doc };
					} else {
						// Direct mode: show the highlight menu immediately on selection (no shortcut needed)
						this.pendingSelectionInfo = null;
						this.showHighlightMenu(selection, context, x, y, doc);
					}
				}
			}
		};

		const handleKeydown = (evt: KeyboardEvent) => {
			if (!this.pendingSelectionInfo) return;
			if (!this.matchesShortcut(evt)) return;

			evt.preventDefault();
			const info = this.pendingSelectionInfo;
			this.showHighlightMenu(info.selection, info.context, info.x, info.y, info.doc);
		};

		const setupWindow = (win: Window) => {
			this.registerDomEvent(win.document as any, 'mouseup', (evt: MouseEvent) => handleSelection(evt));
			this.registerDomEvent(win.document as any, 'keydown', (evt: KeyboardEvent) => handleKeydown(evt));
			this.registerDomEvent(win.document as any, 'mousedown', (evt: MouseEvent) => {
				this.pendingSelectionInfo = null;
				if (this.highlightMenu && !this.highlightMenu.contains(evt.target as Node)) {
					this.hideHighlightMenu();
				}
			});
			// Custom color styles must exist in popout windows too
			injectCustomColorStyles(win.document as any, this.settings);
		};

		setupWindow(window);
		this.app.workspace.on('window-open', (win) => setupWindow(win as any));
	}

	private matchesShortcut(evt: KeyboardEvent): boolean {
		const shortcut = this.settings.highlightShortcut || (Platform.isMacOS ? 'Meta+2' : 'Control+2');
		const parts = shortcut.split('+');
		const key = parts[parts.length - 1];

		if (evt.key !== key) return false;

		const modifiers = parts.slice(0, -1).map(p => p.toLowerCase());
		const requireMeta = modifiers.includes('meta') || modifiers.includes('cmd');
		const requireCtrl = modifiers.includes('ctrl') || modifiers.includes('control');
		const requireAlt = modifiers.includes('alt') || modifiers.includes('option');
		const requireShift = modifiers.includes('shift');

		if (requireMeta !== evt.metaKey) return false;
		if (requireCtrl !== evt.ctrlKey) return false;
		if (requireAlt !== evt.altKey) return false;
		if (requireShift !== evt.shiftKey) return false;

		return true;
	}

	private initMobileSupport() {
		this.registerDomEvent(document, 'touchend', (evt: TouchEvent) => {
			if (this.highlightMenu && this.highlightMenu.contains(evt.target as Node)) return;

			const target = evt.target as HTMLElement;
			const doc = target.ownerDocument || document;
			setTimeout(async () => {
				const sel = doc.getSelection();
				const selection = sel?.toString().trim();

				if (selection && selection.length > 0 && selection.length < 2000 && sel && sel.rangeCount > 0) {
					// Find which leaf contains this target
					let leaf: WorkspaceLeaf | null = null;
					this.app.workspace.iterateAllLeaves(l => {
						if (l.view.containerEl.contains(target)) leaf = l;
					});

					const range = sel.getRangeAt(0);
					const rect = range.getBoundingClientRect();
					const context = await this.captureContext(selection, target, leaf);
					context.leaf = leaf;
					this.showHighlightMenu(selection, context, rect.left + rect.width / 2, rect.bottom + 20, doc);
				} else {
					if (this.highlightMenu && !this.highlightMenu.contains(target)) {
						this.hideHighlightMenu();
					}
				}
			}, 500);
		});
	}

	private showHighlightMenu(selection: string, context: any, x: number, y: number, doc: Document) {
		showHighlightMenu(this, selection, context, x, y, doc);
	}

	private hideHighlightMenu() {
		hideHighlightMenu(this);
	}

	/** Applies a highlight from the selection menu (markdown / pdf / epub branches). */
	async applyHighlight(text: string, context: any, color: string) {
		// EPUB selections: DB-only anchor (CFI) + live annotation
		if (context?.anchorType === 'epub' && context?.cfi) {
			await this.applyEpubHighlight(text, context, color);
			return;
		}

		// PDF leaves: DB-only anchor (marks cannot be written into the PDF binary)
		const pdfView = context?.leaf?.view && context.leaf.view.getViewType() === 'pdf'
			? context.leaf.view
			: null;
		if (context?.pdfPage != null || pdfView) {
			await this.applyPdfHighlight(text, context, color, pdfView || context?.leaf?.view);
			return;
		}

		// Priority 1: Use the leaf stored in context from the original selection event
		// Priority 2: Use the current active leaf (if it's a MarkdownView)
		// Priority 3: Try to find any active MarkdownView
		let view = (context?.leaf?.view as MarkdownView) ||
			(this.app.workspace.getActiveViewOfType(MarkdownView)) ||
			(this.app.workspace.getMostRecentLeaf()?.view as any);

		if (!view || (view.getViewType && view.getViewType() !== 'markdown') || !view.editor) {
			console.warn('[HiLighter] Could not find markdown editor view', view);
			new Notice(t('notice.noEditor'));
			return;
		}

		if (view.getMode && view.getMode() !== 'source') {
			new Notice(t('notice.previewMode'));
			return;
		}

		const editor = view.editor;
		const id = randomUUID();
		// data-hl-color carries the hex snapshot for every color so marks stay
		// renderable even if a custom color definition is later deleted.
		const colorDef = getColorDef(this.settings, color);
		const colorHex = colorDef ? colorDef.hex : '#ffd700';
		const highlightTag = `<mark class="hl-highlight hl-h-${color}" data-id="${id}" data-hl-color="${colorHex}">${text}</mark>`;

		try {
			editor.focus();
			editor.replaceSelection(highlightTag);

			// Force Live Preview Refresh: Move cursor slightly or clear selection
			const cursor = editor.getCursor();
			editor.setSelection(cursor, cursor);

			const activeFile = (context.sourcePath ? this.app.vault.getAbstractFileByPath(context.sourcePath) : null) || this.app.workspace.getActiveFile();
			const finalPath = activeFile ? activeFile.path : context.sourcePath || '';

			const highlightEntry: HighlightNote = {
				id,
				text,
				color,
				note: '',
				sourcePath: finalPath,
				lineIndex: context.lineIndex,
				createdAt: Date.now(),
				colorHex
			};

			await db.addHighlightNote(highlightEntry);

			this.app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.view.getViewType() === HIGHLIGHT_VIEW_TYPE) {
					// Add a small buffer on mobile to ensure DB write is totally finished
					if (Platform.isMobile) {
						setTimeout(() => (leaf.view as any).render(), 150);
					} else {
						(leaf.view as any).render();
					}
				}
			});
		} catch (err) {
			console.error('[HiLighter] Highlight save error', err);
		}
	}

	/** EPUB highlight: DB-only CFI anchor + immediate annotation on the open book. */
	private async applyEpubHighlight(text: string, context: any, color: string) {
		try {
			const colorDef = getColorDef(this.settings, color);
			const entry: HighlightNote = {
				id: randomUUID(),
				text,
				color,
				note: '',
				sourcePath: context.sourcePath || '',
				lineIndex: 0,
				createdAt: Date.now(),
				anchorType: 'epub',
				cfi: context.cfi,
				contextQuote: context.contextQuote || '',
				...(colorDef?.isCustom ? { colorHex: colorDef.hex } : {}),
			};
			if (!entry.sourcePath) {
				new Notice(t('notice.noEditor'));
				return;
			}
			await db.addHighlightNote(entry);
			const view = openEpubRegistry().get(entry.sourcePath);
			if (view) await view.applyAnnotation(entry);
			this.refreshAllViews();
		} catch (err) {
			new Notice(t('pdf.saveFailed'));
		}
	}

	/** PDF highlight: no file write; anchor = path + page + context quote. */
	private async applyPdfHighlight(text: string, context: any, color: string, view: any) {
		try {
			const file = view?.file || this.app.workspace.getActiveFile();
			if (!file) {
				new Notice(t('notice.noEditor'));
				return;
			}
			const colorDef = getColorDef(this.settings, color);
			const entry: HighlightNote = {
				id: randomUUID(),
				text,
				color,
				note: '',
				sourcePath: file.path,
				lineIndex: context?.pdfPage ?? 0,
				createdAt: Date.now(),
				anchorType: 'pdf',
				pdfPage: context?.pdfPage ?? undefined,
				contextQuote: context?.contextQuote || '',
				...(colorDef?.isCustom ? { colorHex: colorDef.hex } : {}),
			};
			await db.addHighlightNote(entry);
			this.refreshAllViews();
			new Notice(t('pdf.saved'));
		} catch (err) {
			new Notice(t('pdf.saveFailed'));
		}
	}

	/** EPUB picker: fuzzy-search indexed .epub files and open one in the reader. */
	private openEpubPicker() {
		const epubs = this.app.vault.getFiles().filter(f => f.extension === 'epub');
		if (epubs.length === 0) {
			new Notice(t('epub.noneFound'));
			return;
		}
		new EpubPickModal(this.app, epubs, (file) => {
			void this.app.workspace.openLinkText(file.path, '', false);
		}).open();
	}

	async activateView(type: string, side: 'main' | 'right' = 'right') {		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(type)[0];
		if (!leaf) {
			leaf = (side === 'main') ? workspace.getLeaf('tab') : workspace.getRightLeaf(false);
			await leaf.setViewState({ type, active: true });
		}

		// Force reveal sidebars on mobile/tablet
		if (side === 'right' && this.app.workspace.rightSplit) {
			this.app.workspace.rightSplit.expand();
		} else if (side === 'left' && this.app.workspace.leftSplit) {
			this.app.workspace.leftSplit.expand();
		}

		workspace.revealLeaf(leaf);
	}

	private async captureContext(selection: string, target?: HTMLElement, leaf?: WorkspaceLeaf): Promise<{ lineText: string, sourcePath: string, lineIndex: number }> {
		let lineText = '';
		let sourcePath = '';
		let lineIndex = 0;
		try {
			// 1. Identify valid leaf and view
			let activeLeaf = leaf;
			if (!activeLeaf && target) {
				this.app.workspace.iterateAllLeaves(l => {
					if (l.view.containerEl.contains(target)) activeLeaf = l;
				});
			}
			if (!activeLeaf) activeLeaf = this.app.workspace.getMostRecentLeaf();

			const view = activeLeaf?.view!;
			const isMarkdown = view?.getViewType() === 'markdown';
			const isPdf = view?.getViewType() === 'pdf';
			const mode = (view as any)?.getMode?.();

			// 2. Resolve target file path
			const activeFile = this.app.workspace.getActiveFile();
			const file = (view as any)?.file || activeFile;
			sourcePath = file ? file.path : '';

			// 3. Mode-specific extraction
			if (isPdf) {
				// PDF text layer: anchor by page + surrounding quote
				const pdfCtx = capturePdfContext(target ?? null, view, selection);
				lineIndex = pdfCtx.pdfPage ?? 0;
				lineText = pdfCtx.contextQuote;
				(context as any).pdfPage = pdfCtx.pdfPage;
				(context as any).contextQuote = pdfCtx.contextQuote;
			} else if (isMarkdown && mode === 'source') {
				// SOURCE MODE (Source / Live Preview)
				const editor = (view as any).editor;
				const cursor = editor.getCursor?.('from') || { line: 0, ch: 0 };
				const currentLine = cursor.line;

				const startLine = Math.max(0, currentLine - 1);
				const endLine = Math.min(editor.lineCount() - 1, currentLine + 1);

				const lines: string[] = [];
				for (let i = startLine; i <= endLine; i++) {
					lines.push(editor.getLine(i));
				}

				lineText = lines.join('\n');
				lineIndex = currentLine;
			} else {
				// READING MODE / DOM Fallback
				const doc = target?.ownerDocument || document;
				const sel = doc.getSelection();
				if (sel && sel.rangeCount > 0) {
					const range = sel.getRangeAt(0);
					let container = range.commonAncestorContainer as HTMLElement;
					if (container.nodeType === Node.TEXT_NODE) container = container.parentElement!;

					let current: HTMLElement | null = container;
					for (let i = 0; i < 15 && current; i++) {
						const text = (current.textContent || '').trim();
						if (text.toLowerCase().indexOf(selection.toLowerCase()) !== -1) {
							lineText = text;
							if (current.matches('p, li, h1, h2, h3, h4, h5, h6, .textLayer, .hl-shadowing-item, .markdown-rendered')) {
								break;
							}
						}
						current = current.parentElement;
					}
				}
			}

			// 4. ULTIMATE GLOBAL FALLBACK: Async scan file content if still empty
			if (!lineText && sourcePath) {
				try {
					const content = await this.app.vault.adapter.read(sourcePath);
					const lines = content.split('\n');
					const selectionLower = selection.toLowerCase();

					for (let i = 0; i < lines.length; i++) {
						if (lines[i].toLowerCase().indexOf(selectionLower) !== -1) {
							const start = Math.max(0, i - 1);
							const end = Math.min(lines.length - 1, i + 1);
							lineText = lines.slice(start, end + 1).join('\n');
							lineIndex = i;
							break;
						}
					}
				} catch (fileErr) {
					console.error('[HiLighter] Global scan error', fileErr);
				}
			}
		} catch (e) {
			console.error('[HiLighter] Capture error', e);
		}

		lineText = (lineText || '').trim();
		if (lineText.length > 8000) lineText = lineText.slice(0, 8000);
		return { lineText, sourcePath, lineIndex };
	}

	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() {
		await this.saveData(this.settings);
		// Custom color definitions may have changed; refresh the runtime CSS.
		injectCustomColorStyles(document, this.settings);
	}

	async exportSyncFile(): Promise<void> {
		try {
			const data = await db.getAllHighlights();
			const syncPayload = {
				version: 2,
				exportedAt: Date.now(),
				count: data.length,
				highlights: data,
			};
			const jsonStr = JSON.stringify(syncPayload, null, 2);
			const path = this.settings.syncFilePath;
			const dir = path.substring(0, path.lastIndexOf('/'));
			if (dir && !await this.app.vault.adapter.exists(dir)) {
				await this.app.vault.adapter.mkdir(dir);
			}
			await this.app.vault.adapter.write(path, jsonStr);
			new Notice(t('sync.export.success', { count: data.length }));
		} catch (err) {
			new Notice(t('sync.export.fail', { message: String(err) }));
		}
	}

	async importSyncFile(): Promise<void> {
		const path = this.settings.syncFilePath;
		try {
			if (!await this.app.vault.adapter.exists(path)) {
				new Notice(t('sync.import.fileNotFound'));
				return;
			}
			const content = await this.app.vault.adapter.read(path);
			const data = JSON.parse(content);
			if ((data.version !== 1 && data.version !== 2) || !data.highlights || !Array.isArray(data.highlights)) {
				new Notice(t('sync.import.invalidFile'));
				return;
			}
			// v1 files only carry the 4 preset ids; v2 adds custom ids + hex snapshots.
			const validHighlights = data.highlights
				.filter((h: any) =>
					h && typeof h.id === 'string' && typeof h.text === 'string' && typeof h.color === 'string'
				)
				.map((h: any) => ({
					...h,
					color: isValidColorId(this.settings, h.color) ? h.color : 'yellow',
				}));
			if (validHighlights.length === 0) {
				new Notice(t('sync.import.invalidFile'));
				return;
			}
			const result = await db.upsertHighlights(validHighlights);
			new Notice(t('sync.import.success', { added: result.added, updated: result.updated }));
			this.refreshAllViews();
		} catch (err) {
			new Notice(t('sync.import.fail', { message: String(err) }));
		}
	}
}

/** Fuzzy picker for opening an indexed .epub file in the HiLighter reader. */
class EpubPickModal extends FuzzySuggestModal<any> {
	private files: any[];
	private onPick: (file: any) => void;

	constructor(app: any, files: any[], onPick: (file: any) => void) {
		super(app);
		this.files = files;
		this.onPick = onPick;
		this.setPlaceholder(t('cmd.openEpub'));
	}

	getItems(): any[] {
		return this.files;
	}

	getItemText(file: any): string {
		return file.basename || file.path;
	}

	onChooseItem(file: any): void {
		this.onPick(file);
	}
}
