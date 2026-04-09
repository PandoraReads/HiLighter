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
	Modal
} from 'obsidian';
import { EMESettingTab, DEFAULT_SETTINGS } from './settings';
import type { EMESettings } from './models';
import { HighlightView, HIGHLIGHT_VIEW_TYPE } from './highlight-view';
import { HighlightManagerView, HIGHLIGHT_MANAGER_VIEW_TYPE, HighlightDetailModal } from './highlight-manager';
import { db } from './db';
import type { HighlightNote } from './models';
import { randomUUID } from './mocks/crypto';

export default class HiLighterPlugin extends Plugin {
	settings: EMESettings;
	private highlightMenu: HTMLElement | null = null;
	private lastSelection: string = '';
	private lastContext: any = null;

	async onload() {
		await this.loadSettings();

		// 0. Device ID Initialize
		if (!this.settings.deviceId) {
			this.settings.deviceId = randomUUID();
			await this.saveSettings();
		}

		// 1. Register Views
		this.registerView(HIGHLIGHT_VIEW_TYPE, (leaf) => new HighlightView(leaf, this));
		this.registerView(HIGHLIGHT_MANAGER_VIEW_TYPE, (leaf) => new HighlightManagerView(leaf));

		// 2. Initialize
		this.initializeFeatures();

		// 3. Settings Tab (Always available)
		this.addSettingTab(new EMESettingTab(this.app, this));
	}

	/**
	 * Initialize actual workspace features
	 */
	private initializeFeatures() {
		// 1. Ribbon Icons
		if (this.settings.ribbonHighlightIcon) {
			this.addRibbonIcon('highlighter', '高亮笔记', () => this.activateView(HIGHLIGHT_VIEW_TYPE, 'right'));
		}

		// 2. Commands
		this.addCommand({
			id: 'open-highlight-view',
			name: '打开高亮笔记',
			callback: () => this.activateView(HIGHLIGHT_VIEW_TYPE, 'right'),
		});
		this.addCommand({
			id: 'open-highlight-manager',
			name: '管理所有高亮笔记',
			callback: () => this.activateView(HIGHLIGHT_MANAGER_VIEW_TYPE, 'main'),
		});

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
		this.hideHighlightMenu();
	}

	private initDesktopSupport() {
		const handleSelection = async (evt: MouseEvent) => {
			if (this.highlightMenu && this.highlightMenu.contains(evt.target as Node)) return;
			const target = evt.target as HTMLElement;
			const doc = target.ownerDocument || document;
			const sel = doc.getSelection();
			const selection = sel?.toString().trim();

			if (!selection || selection.length === 0 || selection.length > 2000) {
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
					this.showHighlightMenu(selection, context, rect.left + rect.width / 2, rect.top - 50, doc);
				}
			}
		};

		const setupWindow = (win: Window) => {
			this.registerDomEvent(win.document as any, 'mouseup', (evt: MouseEvent) => handleSelection(evt));
			this.registerDomEvent(win.document as any, 'mousedown', (evt: MouseEvent) => {
				if (this.highlightMenu && !this.highlightMenu.contains(evt.target as Node)) {
					this.hideHighlightMenu();
				}
			});
		};

		setupWindow(window);
		this.app.workspace.on('window-open', (win) => setupWindow(win as any));
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
		this.lastSelection = selection;
		this.lastContext = context;

		if (this.highlightMenu && this.highlightMenu.ownerDocument !== doc) {
			this.highlightMenu.remove();
			this.highlightMenu = null;
		}

		if (!this.highlightMenu) {
			this.highlightMenu = doc.body.createDiv('eme-highlight-menu');
		}

		this.highlightMenu.toggleClass('eme-mobile-menu', Platform.isMobile);
		this.highlightMenu.empty();

		const colors = this.highlightMenu.createDiv('eme-h-menu-colors');
		['yellow', 'pink', 'blue', 'green'].forEach(color => {
			const dot = colors.createDiv(`eme-h-color-dot ${color}`);
			const applyAction = (e: Event) => {
				e.preventDefault();
				e.stopPropagation();
				if (this.lastSelection) {
					this.applyHighlight(this.lastSelection, this.lastContext, color as any);
				}
				this.hideHighlightMenu();
			};
			dot.addEventListener('mousedown', applyAction);
			dot.addEventListener('touchstart', applyAction);
		});

		this.highlightMenu.style.display = 'flex';
		this.highlightMenu.style.left = `${x}px`;
		this.highlightMenu.style.top = `${y}px`;
		this.highlightMenu.style.transform = 'translateX(-50%)';
	}

	private hideHighlightMenu() {
		if (this.highlightMenu) this.highlightMenu.style.display = 'none';
	}

	private async applyHighlight(text: string, context: any, color: 'yellow' | 'pink' | 'blue' | 'green') {
		// Priority 1: Use the leaf stored in context from the original selection event
		// Priority 2: Use the current active leaf (if it's a MarkdownView)
		// Priority 3: Try to find any active MarkdownView
		let view = (context?.leaf?.view as MarkdownView) ||
			(this.app.workspace.getActiveViewOfType(MarkdownView)) ||
			(this.app.workspace.activeLeaf?.view as any);

		if (!view || (view.getViewType && view.getViewType() !== 'markdown') || !view.editor) {
			console.warn('[EME] Could not find markdown editor view', view);
			new Notice('未发现编辑窗口，请确保光标在笔记中');
			return;
		}

		if (view.getMode && view.getMode() !== 'source') {
			new Notice('请在编辑模式下进行高亮（当前为预览模式）');
			return;
		}

		const editor = view.editor;
		const id = randomUUID();
		const highlightTag = `<mark class="eme-highlight eme-h-${color}" data-id="${id}">${text}</mark>`;

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
				createdAt: Date.now()
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
			console.error('[EME] Highlight save error', err);
		}
	}

	async activateView(type: string, side: 'main' | 'right' = 'right') {
		const { workspace } = this.app;
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
			if (!activeLeaf) activeLeaf = this.app.workspace.activeLeaf;

			const view = activeLeaf?.view!;
			const isMarkdown = view?.getViewType() === 'markdown';
			const mode = (view as any)?.getMode?.();

			// 2. Resolve target file path
			const activeFile = this.app.workspace.getActiveFile();
			const file = (view as any)?.file || activeFile;
			sourcePath = file ? file.path : '';

			// 3. Mode-specific extraction
			if (isMarkdown && mode === 'source') {
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
							if (current.matches('p, li, h1, h2, h3, h4, h5, h6, .textLayer, .eme-shadowing-item, .markdown-rendered')) {
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
					console.error('[EME] Global scan error', fileErr);
				}
			}
		} catch (e) {
			console.error('[EME] Capture error', e);
		}

		lineText = (lineText || '').trim();
		if (lineText.length > 8000) lineText = lineText.slice(0, 8000);
		return { lineText, sourcePath, lineIndex };
	}

	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() { await this.saveData(this.settings); }
}
