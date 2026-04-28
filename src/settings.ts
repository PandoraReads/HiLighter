// ============================================================
// HiLighter - Settings Tab
// ============================================================

import { App, PluginSettingTab, Setting, Platform, Notice, Modal } from 'obsidian';
import type HiLighterPlugin from './main';
import { DEFAULT_SETTINGS, type HiLighterSettings, type ResearchPrompt } from './models';
import { db } from './db';
import type { HighlightNote } from './models';

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

		containerEl.createEl('h2', { text: 'HiLighter' });

		// ── AI Integration ──────────────────────────────────────
		containerEl.createEl('h3', { text: 'AI 大模型设置' });

		new Setting(containerEl)
			.setName('AI 提供商')
			.setDesc('选择高亮笔记中使用的 AI 模型服务')
			.addDropdown(drop => {
				drop.addOption('deepseek', 'DeepSeek')
					.addOption('gemini', 'Google Gemini')
					.addOption('ark', '火山引擎 (豆包)')
					.addOption('custom', '自定义 (OpenAI 兼容)')
					.setValue(this.plugin.settings.aiProvider)
					.onChange(async (v) => {
						this.plugin.settings.aiProvider = v as HiLighterSettings['aiProvider'];
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (this.plugin.settings.aiProvider === 'deepseek') {
			new Setting(containerEl)
				.setName('DeepSeek API Key')
				.setDesc('在 platform.deepseek.com 获取')
				.addText(t => t
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.deepseekApiKey)
					.onChange(async (v) => {
						this.plugin.settings.deepseekApiKey = v.trim();
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.aiProvider === 'gemini') {
			new Setting(containerEl)
				.setName('Gemini API Key')
				.setDesc('在 aistudio.google.com 获取')
				.addText(t => t
					.setPlaceholder('AIza...')
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (v) => {
						this.plugin.settings.geminiApiKey = v.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Gemini 模型')
				.setDesc('可用模型: gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-pro, gemini-pro 等')
				.addText(t => t
					.setPlaceholder('gemini-2.5-flash')
					.setValue(this.plugin.settings.geminiModel || 'gemini-2.5-flash')
					.onChange(async (v) => {
						this.plugin.settings.geminiModel = v.trim() || 'gemini-2.5-flash';
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.aiProvider === 'ark') {
			new Setting(containerEl)
				.setName('火山引擎 API Key')
				.setDesc('在 console.volcengine.com/ark 获取')
				.addText(t => t
					.setPlaceholder('Bearer ...')
					.setValue(this.plugin.settings.arkApiKey)
					.onChange(async (v) => {
						this.plugin.settings.arkApiKey = v.trim();
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.aiProvider === 'custom') {
			new Setting(containerEl)
				.setName('API 地址')
				.setDesc('OpenAI 兼容的 API 端点，例如 https://api.openai.com/v1/chat/completions')
				.addText(t => t
					.setPlaceholder('https://api.example.com/v1/chat/completions')
					.setValue(this.plugin.settings.customApiUrl)
					.onChange(async (v) => {
						this.plugin.settings.customApiUrl = v.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('模型名称')
				.setDesc('例如 gpt-4o、claude-3-haiku、qwen-turbo 等')
				.addText(t => t
					.setPlaceholder('gpt-4o')
					.setValue(this.plugin.settings.customModel)
					.onChange(async (v) => {
						this.plugin.settings.customModel = v.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('API Key')
				.setDesc('对应服务的 API 密钥')
				.addText(t => t
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.customApiKey)
					.onChange(async (v) => {
						this.plugin.settings.customApiKey = v.trim();
						await this.plugin.saveSettings();
					}));
		}

		// ── Shortcut Settings (desktop only) ────────────────────────
		if (!Platform.isMobile) {
			containerEl.createEl('h3', { text: '快捷键设置' });

			containerEl.createEl('p', {
				text: '选中文本后，按下快捷键才会弹出高亮菜单。',
				cls: 'hl-settings-hint'
			});

			containerEl.createEl('p', {
				text: '注意：请避免使用 Obsidian 或系统已占用的快捷键，否则可能无法生效。',
				cls: 'hl-settings-hint'
			});
			containerEl.querySelector('.hl-settings-hint:last-of-type')?.setAttr('style', 'color: var(--text-warning)');

			const isMac = navigator.platform?.includes('Mac');
				const defaultShortcut = isMac ? 'Cmd+2' : 'Ctrl+2';

				new Setting(containerEl)
					.setName('高亮快捷键')
					.setDesc('格式: 修饰键+按键，例如 Cmd+2、Ctrl+Shift+H')
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
						t.inputEl.style.width = '120px';
					});
		}

		// ── Research Prompts ────────────────────────────────────
		containerEl.createEl('h3', { text: '研究提示语管理' });

		containerEl.createEl('p', {
			text: '管理多个研究提示语，在使用中切换。点击卡片的"研究"按钮时将使用当前选中的提示语。',
			cls: 'hl-settings-hint'
		});

		// Active prompt selector
		new Setting(containerEl)
			.setName('当前使用的提示语')
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
				.setName(prompt.name + (isActive ? ' (当前使用)' : ''))
				.setDesc(prompt.prompt.length > 80 ? prompt.prompt.substring(0, 80) + '...' : prompt.prompt)
				.addButton(btn => btn
					.setButtonText('编辑')
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
					.setButtonText('删除')
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
			.setName('添加新提示语')
			.addButton(btn => btn
				.setButtonText('新增')
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
		containerEl.createEl('h3', { text: '数据管理' });

		// Export Data
		new Setting(containerEl)
			.setName('导出数据')
			.setDesc('将所有高亮笔记数据导出为 JSON 文件')
			.addButton(btn => btn
				.setButtonText('导出')
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
					new Notice('数据导出成功');
				})
			);

		// Import Data
		new Setting(containerEl)
			.setName('导入数据')
			.setDesc('从 JSON 文件导入高亮笔记数据')
			.addButton(btn => btn
				.setButtonText('导入')
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
										new Notice(`成功导入 ${count} 条高亮笔记`);
									}
								} catch (err) {
									console.error('Import error:', err);
									new Notice('导入失败：文件格式无效');
								}
							};
							reader.readAsText(file);
						} catch (err) {
							console.error('File read error:', err);
							new Notice('导入失败：无法读取文件');
						}
					};
					input.click();
				})
			);
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
		this.titleEl.setText(this.prompt ? '编辑研究提示语' : '新增研究提示语');
		this.modalEl.addClass('hl-glass-modal');

		const container = contentEl.createDiv('hl-glass-modal-body');

		// Name input
		const nameWrap = container.createDiv('hl-glass-field');
		nameWrap.createEl('label', { text: '提示语名称', cls: 'hl-glass-label' });
		this.nameInput = nameWrap.createEl('input', {
			type: 'text',
			placeholder: '例如：深度解析、快速摘要...',
			cls: 'hl-glass-input'
		});
		this.nameInput.value = this.prompt?.name || '';

		// Prompt textarea
		const promptWrap = container.createDiv('hl-glass-field');
		promptWrap.createEl('label', { text: '提示语内容', cls: 'hl-glass-label' });
		this.promptInput = promptWrap.createEl('textarea', {
			placeholder: '输入自定义研究提示语...',
			cls: 'hl-glass-textarea'
		});
		this.promptInput.value = this.prompt?.prompt || '';

		// Actions
		const actions = container.createDiv('hl-glass-modal-actions');
		const cancelBtn = actions.createEl('button', { text: '取消', cls: 'hl-glass-btn-cancel' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = actions.createEl('button', { cls: 'hl-glass-btn-confirm', text: '保存' });
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
			new Notice('请输入提示语名称');
			return;
		}
		if (!prompt) {
			new Notice('请输入提示语内容');
			return;
		}
		this.onSubmit({ name, prompt });
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
