// ============================================================
// HiLighter - Settings Tab
// ============================================================

import { App, PluginSettingTab, Setting, Platform, Notice, Modal,
	moment
} from 'obsidian';
import type HiLighterPlugin from './main';
import { DEFAULT_SETTINGS, type HiLighterSettings, type ResearchPrompt, type AIModelConfig, type ThemeId, type CardDensity, type StudioColumns, AI_MODEL_PRESETS } from './models';
import { db } from './db';
import type { HighlightNote } from './models';
import { t, setLang, resolveAutoLanguage, SUPPORTED_LANGUAGES } from './i18n';
import { newCustomColorId } from './colors';
import { ConfirmModal } from './ui/confirm-modal';
import { normalizeImageFolder } from './image-path';
import { normalizeVaultFolder } from './vault-path';
import { fetchAvailableModels } from './ai-service';
import { resolveModelAlias } from './ai-endpoint';

/** Rotating starter hexes for the "add custom color" button. */
const DEFAULT_NEW_COLOR_HEXES = ['#b39ddb', '#f0a35e', '#64b5f6', '#81c784', '#e57373', '#4db6ac'];

export { DEFAULT_SETTINGS };
export type { HiLighterSettings };

export class HiLighterSettingTab extends PluginSettingTab {
	plugin: HiLighterPlugin;

	constructor(app: App, plugin: HiLighterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('hl-settings');

		// No plugin-name heading here: Obsidian already shows the plugin name
		// in the settings tab, and the review rules forbid repeating it.

		// ── Language ──────────────────────────────────────────
		new Setting(containerEl).setName(t('settings.language')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.language'))
			.setDesc(t('settings.language.desc'))
			.addDropdown(drop => {
				drop.addOption('auto', t('settings.language.auto'));
				for (const lang of SUPPORTED_LANGUAGES) {
					drop.addOption(lang.id, lang.label);
				}
				drop.setValue(this.plugin.settings.language)
					.onChange(async (v) => {
						this.plugin.settings.language = v;
						setLang(v === 'auto' ? resolveAutoLanguage(moment.locale()) : v);
						await this.plugin.saveSettings();
						this.display();
						this.plugin.refreshAllViews();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.translationTarget'))
			.setDesc(t('settings.translationTarget.desc'))
			.addText(t => t
				.setPlaceholder('中文')
				.setValue(this.plugin.settings.translationTargetLang)
				.onChange(async (v) => {
					this.plugin.settings.translationTargetLang = v.trim();
					await this.plugin.saveSettings();
				}));

		// ── Appearance ──────────────────────────────────────────
		new Setting(containerEl).setName(t('settings.appearance')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.appearance.theme'))
			.setDesc(t('settings.appearance.theme.desc'))
			.addDropdown(drop => {
				drop.addOption('editorial', t('settings.theme.editorial'))
					.addOption('native', t('settings.theme.native'))
					.addOption('paper', t('settings.theme.paper'))
					.addOption('ocean', t('settings.theme.ocean'))
					.addOption('forest', t('settings.theme.forest'))
					.addOption('galaxy', t('settings.theme.galaxy'))
					.addOption('cyber', t('settings.theme.cyber'))
					.addOption('sunset', t('settings.theme.sunset'))
					.addOption('rose', t('settings.theme.rose'))
					.setValue((this.plugin.settings.theme as string) === 'minimal' ? 'editorial' : this.plugin.settings.theme)
					.onChange(async (v) => {
						this.plugin.settings.theme = v as ThemeId;
						await this.plugin.saveSettings();
						this.plugin.refreshAllViews();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.appearance.density'))
			.setDesc(t('settings.appearance.density.desc'))
			.addDropdown(drop => {
				drop.addOption('comfortable', t('settings.density.comfortable'))
					.addOption('cozy', t('settings.density.cozy'))
					.addOption('compact', t('settings.density.compact'))
					.setValue(this.plugin.settings.cardDensity)
					.onChange(async (v) => {
						this.plugin.settings.cardDensity = v as CardDensity;
						await this.plugin.saveSettings();
						this.plugin.refreshAllViews();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.appearance.accent'))
			.setDesc(t('settings.appearance.accent.desc'))
			.addColorPicker(cp => {
				if (this.plugin.settings.accentColor) cp.setValue(this.plugin.settings.accentColor);
				cp.onChange(async (v) => {
					this.plugin.settings.accentColor = v;
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
				});
			})
			.addExtraButton(btn => {
				btn.setIcon('rotate-ccw')
					.setTooltip(t('settings.appearance.reset'))
					.onClick(async () => {
						this.plugin.settings.accentColor = '';
						await this.plugin.saveSettings();
						this.display();
						this.plugin.refreshAllViews();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.appearance.columns'))
			.setDesc(t('settings.appearance.columns.desc'))
			.addDropdown(drop => {
				drop.addOption('auto', t('settings.columns.auto'));
				[1, 2, 3, 4].forEach(n => drop.addOption(String(n), String(n)));
				drop.setValue(String(this.plugin.settings.studioColumns))
					.onChange(async (v) => {
						this.plugin.settings.studioColumns = (v === 'auto' ? 'auto' : Number(v)) as StudioColumns;
						await this.plugin.saveSettings();
						this.plugin.refreshAllViews();
					});
			});

		containerEl.createEl('p', {
			text: t('settings.appearance.colorLabels.desc'),
			cls: 'hl-settings-hint'
		});

		const colorKeys = ['yellow', 'pink', 'blue', 'green'] as const;
		colorKeys.forEach(color => {
			new Setting(containerEl)
				.setName(t('settings.colorLabels.' + color))
				.addText(txt => {
					txt.setPlaceholder(t('settings.colorLabels.placeholder'))
						.setValue(this.plugin.settings.colorLabels[color] || '')
						.onChange(async (v) => {
							this.plugin.settings.colorLabels = {
								...this.plugin.settings.colorLabels,
								[color]: v.trim()
							};
							await this.plugin.saveSettings();
							this.plugin.refreshAllViews();
						});
					txt.inputEl.setCssProps({ width: '180px' });
				});
		});

		// ── Custom highlight colors manager ─────────────────────
		new Setting(containerEl).setName(t('settings.customColors')).setHeading();
		containerEl.createEl('p', {
			text: t('settings.customColors.desc'),
			cls: 'hl-settings-hint'
		});

		const renderCustomColors = (wrap: HTMLElement) => {
			wrap.empty();
			const list = this.plugin.settings.customColors || [];

			list.forEach((c) => {
				const row = new Setting(wrap);
				row.setName(c.name || c.hex)
					.setDesc(c.id);
				row.addColorPicker(cp => {
					cp.setValue(c.hex);
					cp.onChange(async (v) => {
						this.plugin.settings.customColors = (this.plugin.settings.customColors || [])
							.map(x => x.id === c.id ? { ...x, hex: v } : x);
						await this.plugin.saveSettings();
						this.plugin.refreshAllViews();
						renderCustomColors(wrap);
					});
				});
				row.addText(txt => {
					txt.setPlaceholder(t('colors.namePlaceholder'))
						.setValue(c.name)
						.onChange(async (v) => {
							this.plugin.settings.customColors = (this.plugin.settings.customColors || [])
								.map(x => x.id === c.id ? { ...x, name: v.trim() } : x);
							await this.plugin.saveSettings();
							this.plugin.refreshAllViews();
						});
					txt.inputEl.setCssProps({ width: '140px' });
				});
				row.addExtraButton(btn => {
					btn.setIcon('trash-2')
						.setTooltip(t('colors.delete'))
						.onClick(() => {
							new ConfirmModal(this.app, t('colors.deleteConfirm', { name: c.name || c.hex }), async () => {
								this.plugin.settings.customColors = (this.plugin.settings.customColors || [])
									.filter(x => x.id !== c.id);
								await this.plugin.saveSettings();
								this.plugin.refreshAllViews();
								renderCustomColors(wrap);
							}, { confirmText: t('btn.delete'), warning: true }).open();
						});
				});
			});

			new Setting(wrap)
				.setName(t('colors.add'))
				.setDesc(t('colors.add.desc'))
				.addExtraButton(btn => {
					btn.setIcon('plus')
						.setTooltip(t('colors.add'))
						.onClick(async () => {
							const id = newCustomColorId();
							const hex = DEFAULT_NEW_COLOR_HEXES[(this.plugin.settings.customColors || []).length % DEFAULT_NEW_COLOR_HEXES.length]!;
							this.plugin.settings.customColors = [
								...(this.plugin.settings.customColors || []),
								{ id, name: '', hex },
							];
							await this.plugin.saveSettings();
							this.plugin.refreshAllViews();
							renderCustomColors(wrap);
						});
				});
		};
		renderCustomColors(containerEl.createDiv('hl-custom-colors-wrap'));

		// ── Flashcard Review (FSRS) ─────────────────────────────
		new Setting(containerEl).setName(t('settings.fsrs.title')).setHeading();
		containerEl.createEl('p', {
			text: t('settings.fsrs.desc'),
			cls: 'hl-settings-hint'
		});

		new Setting(containerEl)
			.setName(t('settings.fsrs.retention'))
			.setDesc(t('settings.fsrs.retention.desc'))
			.addDropdown(drop => {
				['0.80', '0.85', '0.90', '0.95', '0.99'].forEach(v => drop.addOption(v, v));
				drop.setValue(String(this.plugin.settings.fsrs?.desiredRetention ?? 0.9))
					.onChange(async (v) => {
						this.plugin.settings.fsrs = {
							...this.plugin.settings.fsrs,
							desiredRetention: Number(v),
						};
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.fsrs.newPerDay'))
			.setDesc(t('settings.fsrs.newPerDay.desc'))
			.addText(txt => {
				txt.inputEl.type = 'number';
				txt.setValue(String(this.plugin.settings.fsrs?.newPerDay ?? 20))
					.onChange(async (v) => {
						const parsed = Number(v);
						if (!Number.isFinite(parsed)) return;
						const n = Math.max(0, Math.min(200, Math.round(parsed)));
						this.plugin.settings.fsrs = {
							...this.plugin.settings.fsrs,
							newPerDay: n,
						};
						await this.plugin.saveSettings();
					});
				txt.inputEl.setCssProps({ width: '80px' });
			});

		new Setting(containerEl)
			.setName(t('settings.fsrs.fuzz'))
			.setDesc(t('settings.fsrs.fuzz.desc'))
			.addToggle(tg => {
				tg.setValue(this.plugin.settings.fsrs?.enableFuzz ?? false)
					.onChange(async (v) => {
						this.plugin.settings.fsrs = {
							...this.plugin.settings.fsrs,
							enableFuzz: v,
						};
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('fsrs.resetAll'))
			.setDesc(t('fsrs.resetAll.desc'))
			.addExtraButton(btn => {
				btn.setIcon('rotate-ccw')
					.setTooltip(t('fsrs.resetAll'))
					.onClick(() => {
						new ConfirmModal(this.app, t('fsrs.resetAllConfirm'), async () => {
							const cleared = await db.resetAllFsrs();
							new Notice(t('fsrs.resetAllDone', { count: cleared }));
							this.plugin.refreshAllViews();
						}, { confirmText: t('btn.confirm'), warning: true }).open();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.noteImageFolder'))
			.setDesc(t('settings.noteImageFolder.desc'))
			.addText(text => text
				.setPlaceholder(t('settings.noteImageFolder.placeholder'))
				.setValue(this.plugin.settings.noteImageFolder || '')
				.onChange(async value => {
					try {
						this.plugin.settings.noteImageFolder = normalizeImageFolder(value);
						await this.plugin.saveSettings();
					} catch {
						new Notice(t('settings.noteImageFolder.invalid'));
					}
				}));

		new Setting(containerEl)
			.setName(t('settings.groupExportFolder'))
			.setDesc(t('settings.groupExportFolder.desc'))
			.addText(text => text
				.setPlaceholder(t('settings.groupExportFolder.placeholder'))
				.setValue(this.plugin.settings.groupExportFolder || '')
				.onChange(async value => {
					try {
						this.plugin.settings.groupExportFolder = normalizeVaultFolder(value);
						await this.plugin.saveSettings();
					} catch {
						new Notice(t('settings.groupExportFolder.invalid'));
					}
				}));

		new Setting(containerEl)
			.setName(t('settings.pdfOverlay'))
			.setDesc(t('settings.pdfOverlay.desc'))
			.addToggle(tg => {
				tg.setValue(this.plugin.settings.pdfOverlay ?? true)
					.onChange(async (v) => {
						this.plugin.settings.pdfOverlay = v;
						await this.plugin.saveSettings();
					});
			});

		// ── Shortcut Settings (desktop only) ────────────────────────
		if (!Platform.isMobile) {
			new Setting(containerEl).setName(t('settings.shortcuts')).setHeading();

			const isMac = Platform.isMacOS;
			const defaultShortcut = isMac ? 'Cmd+2' : 'Ctrl+2';

			new Setting(containerEl)
				.setName(t('settings.shortcuts.useShortcut'))
				.setDesc(t('settings.shortcuts.useShortcut.desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.useShortcut)
					.onChange(async (v) => {
						this.plugin.settings.useShortcut = v;
						await this.plugin.saveSettings();
						this.display();
					}));

			if (this.plugin.settings.useShortcut) {
				containerEl.createEl('p', {
					text: t('settings.shortcuts.hint1'),
					cls: 'hl-settings-hint'
				});

				containerEl.createEl('p', {
					text: t('settings.shortcuts.hint2'),
					cls: 'hl-settings-hint hl-settings-hint--warning'
				});

				new Setting(containerEl)
					.setName(t('settings.shortcuts.highlight'))
					.setDesc(t('settings.shortcuts.highlight.desc'))
					.addText(t => {
						t.setPlaceholder(defaultShortcut)
							.setValue(this.plugin.settings.highlightShortcut || defaultShortcut)
							.onChange(async (v) => {
								const cleaned = v.trim();
								if (cleaned.includes('+') && cleaned.split('+').pop()!.length > 0) {
									this.plugin.settings.highlightShortcut = cleaned;
									await this.plugin.saveSettings();
								}
							});
						t.inputEl.setCssProps({ width: '120px' });
					});
			}
		}

		// ── AI Integration ──────────────────────────────────────
		new Setting(containerEl).setName(t('settings.aiSection')).setHeading();

		// Active model selector
		if (this.plugin.settings.aiModels.length > 0) {
			new Setting(containerEl)
				.setName(t('settings.aiModel.active'))
				.addDropdown(drop => {
					this.plugin.settings.aiModels.forEach(m => {
						drop.addOption(m.id, m.name);
					});
					drop.setValue(this.plugin.settings.activeModelId || this.plugin.settings.aiModels[0]?.id || '')
						.onChange(async (v) => {
							this.plugin.settings.activeModelId = v;
							await this.plugin.saveSettings();
							this.display();
						});
				});
		} else {
			containerEl.createEl('p', {
				text: t('settings.aiModel.emptyHint'),
				cls: 'hl-settings-hint'
			});
		}

		// Model list
		const models = this.plugin.settings.aiModels;
		models.forEach(model => {
			const isActive = model.id === this.plugin.settings.activeModelId;
			const maskedKey = model.apiKey ? model.apiKey.substring(0, 6) + '***' : '(' + t('modal.modelEdit.keyRequired') + ')';
			const modelSetting = new Setting(containerEl)
				.setName(model.name + (isActive ? t('settings.aiModel.activeSuffix') : ''))
				.setDesc(`${model.model} · ${maskedKey}`)
				.addButton(btn => btn
					.setButtonText(t('btn.edit'))
					.onClick(() => {
						new ModelEditModal(this.app, model, async (updated) => {
							const models = this.plugin.settings.aiModels;
							const idx = models.findIndex(m => m.id === model.id);
							if (idx !== -1) {
								models[idx] = { id: models[idx]!.id!, ...updated };
								await this.plugin.saveSettings();
								this.display();
							}
						}).open();
					}));

			if (models.length > 1) {
				modelSetting.addButton(btn => btn
					.setButtonText(t('btn.delete'))
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.aiModels = models.filter(m => m.id !== model.id);
						if (this.plugin.settings.activeModelId === model.id) {
							this.plugin.settings.activeModelId = this.plugin.settings.aiModels[0]?.id || '';
						}
						await this.plugin.saveSettings();
						this.display();
					}));
			}
		});

		// Add model buttons
		new Setting(containerEl)
			.setName(t('settings.aiModel.add'))
			.addButton(btn => btn
				.setButtonText(t('btn.add'))
				.onClick(() => {
					new ModelEditModal(this.app, null, async (result) => {
						const newModel: AIModelConfig = {
							id: Date.now().toString(36) + Math.random().toString(36).slice(2),
							...result,
						};
						this.plugin.settings.aiModels.push(newModel);
						if (!this.plugin.settings.activeModelId) {
							this.plugin.settings.activeModelId = newModel.id;
						}
						await this.plugin.saveSettings();
						this.display();
					}).open();
				}))
			.addButton(btn => btn
				.setButtonText(t('settings.aiModel.addPreset'))
				.onClick(() => {
					new PresetAddModal(this.app, this.plugin, () => this.display()).open();
				}));

		containerEl.createEl('p', {
			text: t('settings.aiModel.keyHint'),
			cls: 'hl-settings-hint'
		});

		// ── Research Prompts ────────────────────────────────────
		new Setting(containerEl).setName(t('settings.research')).setHeading();

		containerEl.createEl('p', {
			text: t('settings.research.hint'),
			cls: 'hl-settings-hint'
		});

		// Active prompt selector
		new Setting(containerEl)
			.setName(t('settings.research.active'))
			.addDropdown(drop => {
				const prompts = this.plugin.settings.researchPrompts;
				prompts.forEach(p => {
					drop.addOption(p.id, p.name);
				});
				drop.setValue(this.plugin.settings.activeResearchPromptId || prompts[0]?.id || '')
					.onChange(async (v) => {
						this.plugin.settings.activeResearchPromptId = v;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		// Prompt list
		const prompts = this.plugin.settings.researchPrompts;
		prompts.forEach((prompt, index) => {
			const isActive = prompt.id === this.plugin.settings.activeResearchPromptId;
			const promptSetting = new Setting(containerEl)
				.setName(prompt.name + (isActive ? t('settings.research.activeSuffix') : ''))
				.setDesc(prompt.prompt.length > 80 ? prompt.prompt.substring(0, 80) + '...' : prompt.prompt)
				.addButton(btn => btn
					.setButtonText(t('btn.edit'))
					.onClick(() => {
						new PromptEditModal(this.app, prompt, async (updated) => {
							const prompts = this.plugin.settings.researchPrompts;
							const idx = prompts.findIndex(p => p.id === prompt.id);
							if (idx !== -1) {
								const existing = prompts[idx];
								prompts[idx] = { id: existing!.id, name: updated.name, prompt: updated.prompt };
								await this.plugin.saveSettings();
								this.display();
							}
						}).open();
					}));

			// Don't allow deleting the last prompt
			if (prompts.length > 1) {
				promptSetting.addButton(btn => btn
					.setButtonText(t('btn.delete'))
					.setWarning()
					.onClick(async () => {
						const prompts = this.plugin.settings.researchPrompts;
						this.plugin.settings.researchPrompts = prompts.filter(p => p.id !== prompt.id);
						// If deleting the active prompt, switch to the first one
						if (this.plugin.settings.activeResearchPromptId === prompt.id) {
							this.plugin.settings.activeResearchPromptId = this.plugin.settings.researchPrompts[0]?.id || '';
						}
						await this.plugin.saveSettings();
						this.display();
					}));
			}
		});

		// Add new prompt button
		new Setting(containerEl)
			.setName(t('settings.research.add'))
			.addButton(btn => btn
				.setButtonText(t('btn.add'))
				.onClick(() => {
					new PromptEditModal(this.app, null, async (result) => {
						const newPrompt: ResearchPrompt = {
							id: Date.now().toString(36) + Math.random().toString(36).slice(2),
							name: result.name,
							prompt: result.prompt,
						};
						this.plugin.settings.researchPrompts.push(newPrompt);
						this.plugin.settings.activeResearchPromptId = newPrompt.id;
						await this.plugin.saveSettings();
						this.display();
					}).open();
				}));

		// ── Data Management ──────────────────────────────────────
		new Setting(containerEl).setName(t('settings.data')).setHeading();

		// Export Data
		new Setting(containerEl)
			.setName(t('settings.data.export'))
			.setDesc(t('settings.data.export.desc'))
			.addButton(btn => btn
				.setButtonText(t('btn.export'))
				.onClick(async () => {
					const data = await db.getAllHighlights();
					const dataStr = JSON.stringify(data, null, 2);
					const blob = new Blob([dataStr], { type: 'application/json' });
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = `hilighter-data-${new Date().toISOString().split('T')[0]}.json`;
					a.click();
					URL.revokeObjectURL(url);
					new Notice(t('settings.data.export.success'));
				})
			);

		// Import Data
		new Setting(containerEl)
			.setName(t('settings.data.import'))
			.setDesc(t('settings.data.import.desc'))
			.addButton(btn => btn
				.setButtonText(t('btn.import'))
				.onClick(() => {
					const input = document.createElement('input');
					input.type = 'file';
					input.accept = 'application/json';
					input.onchange = async (e) => {
						const file = (e.target as HTMLInputElement).files?.[0];
						if (!file) return;

						try {
							const reader = new FileReader();
							reader.onload = async (event) => {
								try {
									const importedData = JSON.parse(event.target?.result as string);
									if (Array.isArray(importedData)) {
										let count = 0;
										for (const item of importedData) {
											if (item.id && item.text && item.color) {
												await db.addHighlightNote(item);
												count++;
											}
										}
										new Notice(t('settings.data.import.success', { count }));
									}
								} catch (err) {
									console.error('Import error:', err);
									new Notice(t('settings.data.import.invalidFile'));
								}
							};
							reader.readAsText(file);
						} catch (err) {
							console.error('File read error:', err);
							new Notice(t('settings.data.import.readError'));
						}
					};
					input.click();
				})
			);

		// ── Data Sync ──────────────────────────────────────────
		new Setting(containerEl).setName(t('settings.sync')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.sync.enable'))
			.setDesc(t('settings.sync.enable.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncEnabled)
				.onChange(async (v) => {
					this.plugin.settings.syncEnabled = v;
					await this.plugin.saveSettings();
					this.plugin.restartSyncWatcher();
					this.display();
				}));

		if (this.plugin.settings.syncEnabled) {
			new Setting(containerEl)
				.setName(t('settings.sync.filePath'))
				.setDesc(t('settings.sync.filePath.desc'))
				.addText(text => text
					.setPlaceholder('.hilighter/sync-data.json')
					.setValue(this.plugin.settings.syncFilePath)
					.onChange(async (v) => {
						this.plugin.settings.syncFilePath = v.trim() || '.hilighter/sync-data.json';
						await this.plugin.saveSettings();
						this.plugin.restartSyncWatcher();
					}));

			if (!Platform.isMobile) {
				new Setting(containerEl)
					.setName(t('settings.sync.onUnload'))
					.setDesc(t('settings.sync.onUnload.desc'))
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.syncOnUnload)
						.onChange(async (v) => {
							this.plugin.settings.syncOnUnload = v;
							await this.plugin.saveSettings();
						}));
			}

			new Setting(containerEl)
				.setName(t('settings.sync.autoImport'))
				.setDesc(t('settings.sync.autoImport.desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.syncAutoImport)
					.onChange(async (v) => {
						this.plugin.settings.syncAutoImport = v;
						await this.plugin.saveSettings();
						this.plugin.restartSyncWatcher();
					}));

			new Setting(containerEl)
				.setName(t('settings.sync.autoExport'))
				.setDesc(t('settings.sync.autoExport.desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.syncAutoExport)
					.onChange(async (v) => {
						this.plugin.settings.syncAutoExport = v;
						await this.plugin.saveSettings();
						this.plugin.restartSyncWatcher();
					}));

			if (this.plugin.syncController) {
				const autoStatus = this.plugin.syncController.getSyncStatus();
				const state = autoStatus.paused ? t('settings.sync.status.paused') : t('settings.sync.status.watching');
				new Setting(containerEl).setName(t('settings.sync.status.auto', { state }));
			}

			// Sync status
			const statusSetting = new Setting(containerEl)
				.setName(t('settings.sync.status'))
				.setDesc(t('settings.sync.status.notFound'));

			const syncPath = this.plugin.settings.syncFilePath;
			(async () => {
				try {
					if (await this.app.vault.adapter.exists(syncPath)) {
						const raw = await this.app.vault.adapter.read(syncPath);
						const syncData = JSON.parse(raw);
						const timeStr = syncData.exportedAt
							? new Date(syncData.exportedAt).toLocaleString()
							: '—';
						statusSetting.setDesc(t('settings.sync.status.info', {
							count: syncData.count ?? syncData.highlights?.length ?? 0,
							time: timeStr,
						}));
					}
				} catch {
					// keep default "not found" desc
				}
			})();

			new Setting(containerEl)
				.setName(t('settings.sync.exportNow'))
				.addButton(btn => btn
					.setButtonText(t('settings.sync.exportNow'))
					.onClick(() => this.plugin.exportSyncFile()));

			new Setting(containerEl)
				.setName(t('settings.sync.importNow'))
				.setDesc(t('settings.sync.importNow.desc'))
				.addButton(btn => btn
					.setButtonText(t('settings.sync.importNow'))
					.onClick(() => this.plugin.importSyncFile()));
		}
	}
}

// ── Prompt Edit Modal (Glass Morphism) ──────────────────────
class PromptEditModal extends Modal {
	private prompt: ResearchPrompt | null;
	private onSubmit: (result: { name: string; prompt: string }) => void;
	private nameInput!: HTMLInputElement;
	private promptInput!: HTMLTextAreaElement;

	constructor(app: App, prompt: ResearchPrompt | null, onSubmit: (result: { name: string; prompt: string }) => void) {
		super(app);
		this.prompt = prompt;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.prompt ? t('modal.promptEdit.title.edit') : t('modal.promptEdit.title.new'));
		this.modalEl.addClass('hl-glass-modal');

		const container = contentEl.createDiv('hl-glass-modal-body');

		// Name input
		const nameWrap = container.createDiv('hl-glass-field');
		nameWrap.createEl('label', { text: t('modal.promptEdit.name'), cls: 'hl-glass-label' });
		this.nameInput = nameWrap.createEl('input', {
			type: 'text',
			placeholder: t('modal.promptEdit.name.placeholder'),
			cls: 'hl-glass-input'
		});
		this.nameInput.value = this.prompt?.name || '';

		// Prompt textarea
		const promptWrap = container.createDiv('hl-glass-field');
		promptWrap.createEl('label', { text: t('modal.promptEdit.content'), cls: 'hl-glass-label' });
		this.promptInput = promptWrap.createEl('textarea', {
			placeholder: t('modal.promptEdit.content.placeholder'),
			cls: 'hl-glass-textarea'
		});
		this.promptInput.value = this.prompt?.prompt || '';

		// Actions
		const actions = container.createDiv('hl-glass-modal-actions');
		const cancelBtn = actions.createEl('button', { text: t('btn.cancel'), cls: 'hl-glass-btn-cancel' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = actions.createEl('button', { cls: 'hl-glass-btn-confirm', text: t('btn.save') });
		confirmBtn.onclick = () => this.handleSubmit();

		this.nameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.promptInput.focus();
			}
		});
		this.promptInput.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') this.close();
		});

		setTimeout(() => this.nameInput.focus(), 50);
	}

	private handleSubmit() {
		const name = this.nameInput.value.trim();
		const prompt = this.promptInput.value.trim();
		if (!name) {
			new Notice(t('modal.promptEdit.nameRequired'));
			return;
		}
		if (!prompt) {
			new Notice(t('modal.promptEdit.contentRequired'));
			return;
		}
		this.onSubmit({ name, prompt });
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ── Model Edit Modal ──────────────────────────────────────────
interface ModelFormValues { name: string; baseUrl: string; model: string; apiKey: string }

class ModelEditModal extends Modal {
	private model: AIModelConfig | null;
	private prefill: Omit<ModelFormValues, 'apiKey'> | null;
	private onSubmit: (result: ModelFormValues) => void;
	private nameInput!: HTMLInputElement;
	private baseUrlInput!: HTMLInputElement;
	private modelInput!: HTMLInputElement;
	private apiKeyInput!: HTMLInputElement;
	private modelsDatalist: HTMLDataListElement | null = null;
	private fetchBtn: HTMLButtonElement | null = null;

	constructor(app: App, model: AIModelConfig | null, onSubmit: (result: ModelFormValues) => void, prefill?: Omit<ModelFormValues, 'apiKey'>) {
		super(app);
		this.model = model;
		this.onSubmit = onSubmit;
		this.prefill = prefill || null;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.model ? t('modal.modelEdit.title.edit') : t('modal.modelEdit.title.new'));
		this.modalEl.addClass('hl-glass-modal');

		const container = contentEl.createDiv('hl-glass-modal-body');
		const initial = this.model
			? { name: this.model.name, baseUrl: this.model.baseUrl, model: this.model.model }
			: this.prefill;

		// Name
		const nameWrap = container.createDiv('hl-glass-field');
		nameWrap.createEl('label', { text: t('modal.modelEdit.name'), cls: 'hl-glass-label' });
		this.nameInput = nameWrap.createEl('input', {
			type: 'text',
			placeholder: t('modal.modelEdit.name.placeholder'),
			cls: 'hl-glass-input'
		});
		this.nameInput.value = initial?.name || '';

		// Base URL
		const urlWrap = container.createDiv('hl-glass-field');
		urlWrap.createEl('label', { text: t('modal.modelEdit.baseUrl'), cls: 'hl-glass-label' });
		this.baseUrlInput = urlWrap.createEl('input', {
			type: 'text',
			placeholder: t('modal.modelEdit.baseUrl.placeholder'),
			cls: 'hl-glass-input'
		});
		this.baseUrlInput.value = initial?.baseUrl || '';

		// Model ID
		const modelWrap = container.createDiv('hl-glass-field');
		modelWrap.createEl('label', { text: t('modal.modelEdit.model'), cls: 'hl-glass-label' });
		this.modelInput = modelWrap.createEl('input', {
			type: 'text',
			placeholder: t('modal.modelEdit.model.placeholder'),
			cls: 'hl-glass-input',
			attr: { list: 'hl-model-list' }
		});
		this.modelInput.value = initial?.model || '';
		this.modelsDatalist = modelWrap.createEl('datalist', { attr: { id: 'hl-model-list' } });

		// API Key
		const keyWrap = container.createDiv('hl-glass-field');
		keyWrap.createEl('label', { text: t('modal.modelEdit.apiKey'), cls: 'hl-glass-label' });
		this.apiKeyInput = keyWrap.createEl('input', {
			type: 'password',
			placeholder: t('modal.modelEdit.apiKey.placeholder'),
			cls: 'hl-glass-input'
		});
		this.apiKeyInput.value = this.model?.apiKey || '';

		// Fetch model list button (needs both URL and key, so it lives below both fields)
		const fetchRow = keyWrap.createDiv('hl-model-fetch-row');
		this.fetchBtn = fetchRow.createEl('button', {
			text: t('modal.modelEdit.fetchModels'),
			cls: 'hl-glass-btn-cancel'
		});
		this.fetchBtn.onclick = () => { void this.handleFetchModels(); };

		// Actions
		const actions = container.createDiv('hl-glass-modal-actions');
		const cancelBtn = actions.createEl('button', { text: t('btn.cancel'), cls: 'hl-glass-btn-cancel' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = actions.createEl('button', { cls: 'hl-glass-btn-confirm', text: t('btn.save') });
		confirmBtn.onclick = () => this.handleSubmit();

		this.nameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); this.baseUrlInput.focus(); }
		});
		this.baseUrlInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); this.modelInput.focus(); }
		});
		this.modelInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); this.apiKeyInput.focus(); }
		});
		this.apiKeyInput.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') this.close();
		});

		setTimeout(() => this.nameInput.focus(), 50);
	}

	/** Pull live model ids from the provider and offer them as autocomplete. */
	private async handleFetchModels(): Promise<void> {
		const baseUrl = this.baseUrlInput.value.trim();
		const apiKey = this.apiKeyInput.value.trim();
		if (!baseUrl || !apiKey) {
			new Notice(t('modal.modelEdit.fetchNeedUrlAndKey'));
			return;
		}
		if (this.fetchBtn) {
			this.fetchBtn.disabled = true;
			this.fetchBtn.setText(t('modal.modelEdit.fetching'));
		}
		try {
			const ids = await fetchAvailableModels(baseUrl, apiKey);
			if (ids.length === 0) {
				new Notice(t('modal.modelEdit.fetchEmpty'));
				return;
			}
			if (!this.modelsDatalist) return;
			this.modelsDatalist.empty();
			ids.forEach(id => this.modelsDatalist!.createEl('option', { value: id }));

			// The prefilled/preset model may not exist for this key's platform
			// (e.g. new Kimi keys no longer serve moonshot-v1-*). Surface it and
			// default to the first available model instead of failing at call time.
			const current = this.modelInput.value.trim();
			if (current && !ids.includes(current)) {
				this.modelInput.value = ids[0]!;
				new Notice(t('modal.modelEdit.fetchAutoCorrected', { from: current, to: ids[0]! }));
			} else {
				new Notice(t('modal.modelEdit.fetchOk', { count: String(ids.length) }));
			}
		} catch (err: any) {
			new Notice(err?.message || String(err));
		} finally {
			if (this.fetchBtn) {
				this.fetchBtn.disabled = false;
				this.fetchBtn.setText(t('modal.modelEdit.fetchModels'));
			}
		}
	}

	private handleSubmit() {
		const name = this.nameInput.value.trim();
		const baseUrl = this.baseUrlInput.value.trim();
		if (!name) { new Notice(t('modal.modelEdit.nameRequired')); return; }
		if (!baseUrl) { new Notice(t('modal.modelEdit.urlRequired')); return; }

		// Auto-correct well-known product names to real API model ids
		const resolved = resolveModelAlias(this.modelInput.value);
		if (!resolved.id) { new Notice(t('modal.modelEdit.modelRequired')); return; }
		if (resolved.correctedFrom) {
			new Notice(t('modal.modelEdit.aliasCorrected', { from: resolved.correctedFrom, to: resolved.id }));
		}

		const apiKey = this.apiKeyInput.value.trim();
		if (!apiKey) { new Notice(t('modal.modelEdit.keyRequired')); return; }
		this.onSubmit({ name, baseUrl, model: resolved.id, apiKey });
		this.close();
	}

	onClose() { this.contentEl.empty(); }
}

// ── Preset Add Modal ──────────────────────────────────────────
class PresetAddModal extends Modal {
	private plugin: HiLighterPlugin;
	private onDone: () => void;

	constructor(app: App, plugin: HiLighterPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t('settings.aiModel.addPreset'));
		this.modalEl.addClass('hl-glass-modal');

		const container = contentEl.createDiv('hl-glass-modal-body');

		AI_MODEL_PRESETS.forEach(preset => {
			const alreadyAdded = this.plugin.settings.aiModels.some(m => m.name === preset.name);
			const setting = new Setting(container)
				.setName(`${preset.name} · ${preset.label}`)
				.setDesc(`${preset.model} · ${preset.baseUrl}`);

			if (alreadyAdded) {
				setting.addButton(btn => btn
					.setButtonText('✓')
					.setDisabled(true));
			} else {
				setting.addButton(btn => btn
					.setButtonText(t('btn.add'))
					.onClick(async () => {
						new ModelEditModal(this.app, null, async (result) => {
							const newModel: AIModelConfig = {
								id: Date.now().toString(36) + Math.random().toString(36).slice(2),
								name: result.name,
								baseUrl: result.baseUrl,
								model: result.model,
								apiKey: result.apiKey,
							};
							this.plugin.settings.aiModels.push(newModel);
							if (!this.plugin.settings.activeModelId) {
								this.plugin.settings.activeModelId = newModel.id;
							}
							await this.plugin.saveSettings();
							this.onDone();
							this.close();
						}, { name: preset.name, baseUrl: preset.baseUrl, model: preset.model }).open();
					}));
			}
		});

		const actions = container.createDiv('hl-glass-modal-actions');
		const closeBtn = actions.createEl('button', { text: t('btn.cancel'), cls: 'hl-glass-btn-cancel' });
		closeBtn.onclick = () => this.close();
	}

	onClose() { this.contentEl.empty(); }
}
