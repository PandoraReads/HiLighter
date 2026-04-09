// ============================================================
// HiLighter - Settings Tab
// ============================================================

import { App, PluginSettingTab, Setting, Platform, Notice } from 'obsidian';
import type HiLighterPlugin from './main';
import { DEFAULT_SETTINGS, type EMESettings } from './models';
import { db } from './db';
import type { HighlightNote } from './models';

export { DEFAULT_SETTINGS };
export type { EMESettings };

export class EMESettingTab extends PluginSettingTab {
	plugin: HiLighterPlugin;

	constructor(app: App, plugin: HiLighterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('eme-settings');

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
						this.plugin.settings.aiProvider = v as EMESettings['aiProvider'];
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

		// ── Research Prompt ────────────────────────────────────
		containerEl.createEl('h3', { text: '研究提示语设置' });

		containerEl.createEl('p', {
			text: '自定义点击卡片"研究"按钮时发送给大模型的系统提示语。留空则使用默认提示语。',
			cls: 'eme-settings-hint'
		});

		new Setting(containerEl)
			.setName('研究提示语')
			.addTextArea(t => {
				t.setPlaceholder('在此输入自定义的研究提示语...')
					.setValue(this.plugin.settings.researchPrompt || '')
					.onChange(async (v) => {
						this.plugin.settings.researchPrompt = v;
						await this.plugin.saveSettings();
					});
				t.inputEl.rows = 8;
				t.inputEl.style.width = '100%';
			});

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

		// ── Ribbon Icons ──────────────────────────────────────
		containerEl.createEl('h3', { text: '侧边栏图标' });

		new Setting(containerEl)
			.setName('显示高亮笔记图标')
			.addToggle(t => t
				.setValue(this.plugin.settings.ribbonHighlightIcon)
				.onChange(async (v) => {
					this.plugin.settings.ribbonHighlightIcon = v;
					await this.plugin.saveSettings();
				}));

		// ── Device Info ─────────────────────────────────────────
		containerEl.createEl('h3', { text: '设备信息' });

		new Setting(containerEl)
			.setName('当前设备 ID')
			.setDesc('唯一设备标识')
			.addText(t => t
				.setValue(this.plugin.settings.deviceId)
				.setDisabled(true)
			);
	}
}
