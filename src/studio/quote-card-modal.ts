// ============================================================
// HiLighter - Quote card editor modal (金句卡片)
// ============================================================
// Opens from the notebook reader's per-entry image action. Live
// canvas preview with style controls — font size / family, layout,
// aspect ratio, background (palette / custom color / image upload /
// URL) plus a mask layer (opacity, color, light effect, background
// blur) between the backdrop and the text. Downloads the PNG.

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../i18n';
import type { HighlightNote } from '../models';
import { wrapCardText } from './xhs-wrap';
import { setCssProps } from '../utils/css-props';

// ── Style model ───────────────────────────────────────────

export type QuoteAspectId = '3:4' | '4:3' | '1:1' | '16:9' | '9:16';
export type MaskColorId = 'black' | 'navy' | 'warm';
export type MaskLightId = 'none' | 'vignette' | 'center' | 'top' | 'bottom';

export interface QuoteCardSettings {
	fontSize: number;
	fontId: string;
	layoutId: 'center' | 'left' | 'quote';
	aspectId: QuoteAspectId;
	/** Palette id, `custom:<hex>` from the color picker. */
	backgroundId: string;
	/** Custom gradient: end hex ('' = solid custom color). */
	customEnd: string;
	/** Custom gradient direction in degrees (90/135/45/180). */
	customAngle: number;
	// Typography tuning
	margin: number;        // px, horizontal page margin
	lineSpacing: number;   // multiplier of the font size
	letterSpacing: number; // px between glyphs (canvas letterSpacing)
	/** Quote text color; '' = auto (follows the background ink). */
	inkColor: string;
	/** Watermark style on the exported card (removal is a paid unlock). */
	watermarkId: 'highlight' | 'text' | 'serif' | 'stamp' | 'outline';
	// Mask layer (between backdrop and text)
	maskOpacity: number;   // 0-0.9
	maskColor: MaskColorId;
	maskLight: MaskLightId;
	bgBlur: number;        // px, image backdrops only
}

interface QuoteFont {
	id: string;
	stack: string;
	labelKey: string;
}

/** Chinese + Latin stacks; every platform falls through gracefully. */
const QUOTE_FONTS: ReadonlyArray<QuoteFont> = [
	{
		id: 'serif',
		stack: '"Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.serif',
	},
	{
		id: 'sans',
		stack: '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.sans',
	},
	{
		id: 'kai',
		stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.kai',
	},
	{
		id: 'fangsong',
		stack: '"Fangsong SC", "STFangsong", "FangSong", "Noto Serif CJK SC", serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.fangsong',
	},
	{
		id: 'yuanti',
		stack: '"Yuanti SC", "PingFang SC", "Noto Sans CJK SC", sans-serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.yuanti',
	},
	{
		id: 'libian',
		stack: '"Libian SC", "LiSu", "STLibian", "隶书", serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.libian',
	},
	{
		id: 'xingkai',
		stack: '"Xingkau SC", "STXingkai", "Xingkai SC", cursive',
		labelKey: 'bookshelf.notebook.quoteModal.font.xingkai',
	},
	{
		id: 'georgia',
		stack: 'Georgia, "Times New Roman", serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.georgia',
	},
	{
		id: 'helvetica',
		stack: '"Helvetica Neue", Helvetica, Arial, sans-serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.helvetica',
	},
	{
		id: 'palatino',
		stack: '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.palatino',
	},
	{
		id: 'didot',
		stack: 'Didot, "Bodoni MT", "Playfair Display", Georgia, serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.didot',
	},
	{
		id: 'baskerville',
		stack: 'Baskerville, "Baskerville Old Face", Garamond, Georgia, serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.baskerville',
	},
	{
		id: 'futura',
		stack: 'Futura, "Century Gothic", "Trebuchet MS", sans-serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.futura',
	},
	{
		id: 'avenir',
		stack: 'Avenir, "Avenir Next", "Gill Sans", "Segoe UI", sans-serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.avenir',
	},
	{
		id: 'amtypewriter',
		stack: '"American Typewriter", Rockwell, "Courier New", serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.amtypewriter',
	},
	{
		id: 'courier',
		stack: '"Courier New", "SF Mono", Menlo, Consolas, monospace',
		labelKey: 'bookshelf.notebook.quoteModal.font.courier',
	},
	{
		id: 'hand',
		stack: '"Snell Roundhand", "Apple Chancery", "Segoe Script", "Brush Script MT", cursive',
		labelKey: 'bookshelf.notebook.quoteModal.font.hand',
	},
	{
		id: 'impact',
		stack: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
		labelKey: 'bookshelf.notebook.quoteModal.font.impact',
	},
];

/** Long side stays 1080-class; each aspect gets crisp pixel dims. */
const QUOTE_ASPECTS: Record<QuoteAspectId, { w: number; h: number }> = {
	'3:4': { w: 1080, h: 1440 },
	'4:3': { w: 1440, h: 1080 },
	'1:1': { w: 1080, h: 1080 },
	'16:9': { w: 1440, h: 810 },
	'9:16': { w: 1080, h: 1920 },
};

interface QuoteBackground {
	id: string;
	from: string;
	/** Absent = solid fill. */
	to?: string;
	/** Gradient direction in degrees; 180 = top→bottom (default). */
	angle?: number;
	ink: string;
	muted: string;
	accent: string;
}

const QUOTE_BACKGROUNDS: ReadonlyArray<QuoteBackground> = [
	// Light / pastel (dark ink)
	{ id: 'cream', from: '#F7F3EA', ink: '#3A342B', muted: 'rgba(58, 52, 43, .5)', accent: '#B08954' },
	{ id: 'mist', from: '#F0F4F8', to: '#DFE9F2', ink: '#2F3A46', muted: 'rgba(47, 58, 70, .5)', accent: '#6A8CAF' },
	{ id: 'blush', from: '#F9DDE3', to: '#F2C3CB', ink: '#5A3A42', muted: 'rgba(90, 58, 66, .5)', accent: '#C4707F' },
	{ id: 'sage', from: '#E7EDE4', to: '#D5E0D0', ink: '#33413A', muted: 'rgba(51, 65, 58, .5)', accent: '#6B8F71' },
	{ id: 'sky', from: '#9AD0F0', to: '#5B9BD5', ink: '#24384A', muted: 'rgba(36, 56, 74, .55)', accent: '#2F6FA8' },
	// Deep / dark (light ink)
	{ id: 'ink', from: '#1C1C1E', ink: '#ECECEC', muted: 'rgba(236, 236, 236, .45)', accent: '#FF8A5C' },
	{ id: 'navy', from: '#23395B', to: '#141E33', ink: '#E8ECF4', muted: 'rgba(232, 236, 244, .45)', accent: '#F0C05A' },
	{ id: 'forest', from: '#2E4B3F', to: '#1B2E26', ink: '#E6EFE8', muted: 'rgba(230, 239, 232, .45)', accent: '#D9B26A' },
	{ id: 'wine', from: '#7A2E3C', to: '#4E1D27', ink: '#F6E9EC', muted: 'rgba(246, 233, 236, .45)', accent: '#E8B04B' },
	{ id: 'gold', from: '#3A3122', to: '#191510', ink: '#F0E6D2', muted: 'rgba(240, 230, 210, .45)', accent: '#D4AF6A' },
	{ id: 'charcoal', from: '#5A5A5A', to: '#262626', ink: '#F0F0F0', muted: 'rgba(240, 240, 240, .45)', accent: '#E8B04B' },
	{ id: 'mocha', from: '#B08D6E', to: '#6E4F38', ink: '#FAF3EC', muted: 'rgba(250, 243, 236, .5)', accent: '#F0D5B8' },
	// Vivid gradients (light ink)
	{ id: 'dusk', from: '#E76F6F', to: '#5B2A5E', ink: '#FDF6F0', muted: 'rgba(253, 246, 240, .55)', accent: '#FFD166' },
	{ id: 'sunrise', from: '#F8B195', to: '#F67280', ink: '#FFF9F5', muted: 'rgba(255, 249, 245, .6)', accent: '#FFE066' },
	{ id: 'coral', from: '#FF9A8B', to: '#FF6A88', ink: '#FFFAF6', muted: 'rgba(255, 250, 246, .6)', accent: '#FFE9A8' },
	{ id: 'aurora', from: '#3FB8A6', to: '#2E5E8C', ink: '#F2FBF8', muted: 'rgba(242, 251, 248, .55)', accent: '#B8F0E4' },
	{ id: 'mint', from: '#B7E4C7', to: '#6BB58A', ink: '#1F3D2C', muted: 'rgba(31, 61, 44, .55)', accent: '#2F7D4F' },
	{ id: 'ocean', from: '#4A90C4', to: '#234E7D', ink: '#EFF7FD', muted: 'rgba(239, 247, 253, .55)', accent: '#BFE0F5' },
	{ id: 'lavender', from: '#BFA7E8', to: '#7C63B8', ink: '#261E3D', muted: 'rgba(38, 30, 61, .55)', accent: '#4A3670' },
	{ id: 'grape', from: '#6A3093', to: '#2B1145', ink: '#F5EEFB', muted: 'rgba(245, 238, 251, .5)', accent: '#D9B8F0' },
];

/** Mask ink colors (the veil between backdrop and text). */
const MASK_COLORS: Record<MaskColorId, string> = {
	black: '#000000',
	navy: '#0E1A2E',
	warm: '#2A1E14',
};

/** Relative luminance of a hex color (0-1, sRGB approximation). */
function hexLuminance(hex: string): number {
	const value = hex.replace('#', '');
	const r = parseInt(value.slice(0, 2), 16) / 255;
	const g = parseInt(value.slice(2, 4), 16) / 255;
	const b = parseInt(value.slice(4, 6), 16) / 255;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Builds a background from a custom hex (ink picked by luminance). */
function customBackground(hex: string): QuoteBackground {
	const light = hexLuminance(hex) > 0.55;
	return light
		? { id: `custom:${hex}`, from: hex, ink: '#2A2A2A', muted: 'rgba(42, 42, 42, .5)', accent: '#8A6D3B' }
		: { id: `custom:${hex}`, from: hex, ink: '#F5F5F2', muted: 'rgba(245, 245, 242, .55)', accent: '#FFD166' };
}

/** Lightens (factor > 0) or darkens (factor < 0) a hex color. */
function shadeHex(hex: string, factor: number): string {
	const value = hex.replace('#', '');
	const scaled = [0, 2, 4]
		.map(i => parseInt(value.slice(i, i + 2), 16))
		.map(n => factor < 0
			? Math.round(n * (1 + factor))
			: Math.round(n + (255 - n) * factor));
	return `#${scaled.map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Custom gradient from two hexes (ink from the average luminance). */
function customGradientBackground(from: string, end: string, angle: number): QuoteBackground {
	const light = (hexLuminance(from) + hexLuminance(end)) / 2 > 0.55;
	return light
		? { id: `custom:${from}`, from, to: end, angle, ink: '#2A2A2A', muted: 'rgba(42, 42, 42, .5)', accent: '#8A6D3B' }
		: { id: `custom:${from}`, from, to: end, angle, ink: '#F5F5F2', muted: 'rgba(245, 245, 242, .55)', accent: '#FFD166' };
}

/** Sensible default end color: a shade of the primary. */
function defaultGradientEnd(hex: string): string {
	return hexLuminance(hex) > 0.55 ? shadeHex(hex, -0.35) : shadeHex(hex, 0.35);
}

/** Linear-gradient endpoints for one of the supported angles. */
function gradientCoords(angle: number, w: number, h: number): [number, number, number, number] {
	switch (angle) {
		case 90: return [0, 0, w, 0];    // 左右
		case 135: return [0, 0, w, h];   // 左上→右下
		case 45: return [0, h, w, 0];    // 左下→右上
		default: return [0, 0, 0, h];    // 180: 上下
	}
}

function resolveBackground(settings: QuoteCardSettings): QuoteBackground {
	const id = settings.backgroundId;
	if (id.startsWith('custom:')) {
		const from = id.slice('custom:'.length);
		if (settings.customEnd) {
			return customGradientBackground(from, settings.customEnd, settings.customAngle);
		}
		return customBackground(from);
	}
	return QUOTE_BACKGROUNDS.find(item => item.id === id) ?? QUOTE_BACKGROUNDS[0]!;
}

/** Loaded background picture (upload data URL or network image). */
interface BgImage {
	src: string;
	img: HTMLImageElement;
}

/** Session memory: last style (and image) starts the next modal. */
let lastSettings: QuoteCardSettings = {
	fontSize: 42,
	fontId: 'serif',
	layoutId: 'center',
	aspectId: '3:4',
	backgroundId: 'cream',
	customEnd: '',
	customAngle: 180,
	margin: 130,
	lineSpacing: 1.55,
	letterSpacing: 0,
	inkColor: '',
	watermarkId: 'highlight',
	maskOpacity: 0,
	maskColor: 'black',
	maskLight: 'none',
	bgBlur: 0,
};
let lastBgImageSrc: string | null = null;

// ── Rendering ─────────────────────────────────────────────

/** Cover-fit draw of one image across the whole card. */
function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number): void {
	const imageRatio = img.width / img.height;
	const cardRatio = w / h;
	let dw = w;
	let dh = h;
	let dx = 0;
	let dy = 0;
	if (imageRatio > cardRatio) {
		dh = h;
		dw = h * imageRatio;
		dx = (w - dw) / 2;
	} else {
		dw = w;
		dh = w / imageRatio;
		dy = (h - dh) / 2;
	}
	ctx.drawImage(img, dx, dy, dw, dh);
}

/** rgba() string of a hex at the given alpha. */
function hexAlpha(hex: string, alpha: number): string {
	const value = hex.replace('#', '');
	const r = parseInt(value.slice(0, 2), 16);
	const g = parseInt(value.slice(2, 4), 16);
	const b = parseInt(value.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The mask layer: a colored veil + optional light effect painted
 * between the backdrop and the text.
 */
function drawMask(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	settings: QuoteCardSettings,
): void {
	const maskHex = MASK_COLORS[settings.maskColor] ?? MASK_COLORS.black;
	const opacity = settings.maskOpacity;
	if (opacity > 0) {
		ctx.fillStyle = hexAlpha(maskHex, opacity);
		ctx.fillRect(0, 0, w, h);
	}
	switch (settings.maskLight) {
		case 'vignette': {
			const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
			grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
			grad.addColorStop(1, hexAlpha(maskHex, 0.55));
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, w, h);
			break;
		}
		case 'center': {
			const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.62);
			grad.addColorStop(0, 'rgba(255, 255, 255, .22)');
			grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, w, h);
			break;
		}
		case 'top': {
			const grad = ctx.createLinearGradient(0, 0, 0, h * 0.55);
			grad.addColorStop(0, 'rgba(255, 255, 255, .18)');
			grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, w, h);
			break;
		}
		case 'bottom': {
			const grad = ctx.createLinearGradient(0, h * 0.45, 0, h);
			grad.addColorStop(0, hexAlpha(maskHex, 0));
			grad.addColorStop(1, hexAlpha(maskHex, 0.5));
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, w, h);
			break;
		}
		default:
			break;
	}
}

/** Paints one styled card. Pure drawing — no DOM beyond ctx. */
export function drawQuoteCard(
	ctx: CanvasRenderingContext2D,
	note: HighlightNote,
	settings: QuoteCardSettings,
	title: string,
	bgImage: BgImage | null,
): void {
	const bg = resolveBackground(settings);
	const font = QUOTE_FONTS.find(item => item.id === settings.fontId) ?? QUOTE_FONTS[0]!;
	const aspect = QUOTE_ASPECTS[settings.aspectId] ?? QUOTE_ASPECTS['3:4'];
	const W = aspect.w;
	const H = aspect.h;

	// ── Backdrop: image (optionally blurred) or palette ──
	if (bgImage) {
		if (settings.bgBlur > 0) ctx.filter = `blur(${settings.bgBlur}px)`;
		drawImageCover(ctx, bgImage.img, W, H);
		ctx.filter = 'none';
	} else if (bg.to) {
		const [x0, y0, x1, y1] = gradientCoords(bg.angle ?? 180, W, H);
		const grad = ctx.createLinearGradient(x0, y0, x1, y1);
		grad.addColorStop(0, bg.from);
		grad.addColorStop(1, bg.to);
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, W, H);
	} else {
		ctx.fillStyle = bg.from;
		ctx.fillRect(0, 0, W, H);
	}

	// ── Mask layer sits between backdrop and text ──
	drawMask(ctx, W, H, settings);

	// Image backdrops need light ink regardless of the palette pick;
	// an explicit ink color overrides everything.
	const autoInk = bgImage ? '#F5F5F2' : bg.ink;
	const autoMuted = bgImage ? 'rgba(245, 245, 242, .66)' : bg.muted;
	const ink = settings.inkColor || autoInk;
	const muted = settings.inkColor ? hexAlpha(settings.inkColor, 0.62) : autoMuted;
	const accent = bgImage ? '#FFD166' : bg.accent;

	const size = settings.fontSize;
	const lineH = Math.round(size * settings.lineSpacing);
	const quoteFont = `${size}px ${font.stack}`;
	// Glyph spacing (Chromium canvas letterSpacing; measureText honors
	// it, so wrapping stays correct).
	const canvasCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
	canvasCtx.letterSpacing = `${settings.letterSpacing}px`;
	const maxQuoteLines = Math.min(18, Math.max(4, Math.floor((H - 300) / lineH)));
	const maxNoteLines = 8;

	// One shared page margin, clamped so text always fits.
	const padX = Math.max(24, Math.min(settings.margin, Math.round(W / 2) - 40));

	// ── Quote block (text verbatim — no decorative quotes added) ──
	const measure = (value: string): number => ctx.measureText(value).width;
	let y: number;
	if (settings.layoutId === 'center') {
		ctx.font = quoteFont;
		const lines = wrapCardText(note.text, W - padX * 2, measure).slice(0, maxQuoteLines);
		const blockH = lines.length * lineH;
		y = Math.max(lineH, (H - blockH) / 2 - lineH * 0.6);
		ctx.textAlign = 'center';
		ctx.fillStyle = ink;
		for (const line of lines) {
			ctx.fillText(line, W / 2, y);
			y += lineH;
		}
	} else if (settings.layoutId === 'quote') {
		// Giant decorative quote marks frame the text (height-clamped)
		const giantPx = Math.min(size * 6, H * 0.28);
		ctx.fillStyle = muted;
		ctx.font = `italic ${giantPx}px Georgia, serif`;
		ctx.textAlign = 'left';
		ctx.fillText('“', padX - 40, giantPx);
		ctx.textAlign = 'right';
		ctx.fillText('”', W - padX + 40, H - 160);
		ctx.font = quoteFont;
		const lines = wrapCardText(note.text, W - padX * 2, measure).slice(0, maxQuoteLines);
		y = giantPx + Math.round(giantPx * 0.18);
		ctx.textAlign = 'left';
		ctx.fillStyle = ink;
		for (const line of lines) {
			ctx.fillText(line, padX, y);
			y += lineH;
		}
	} else {
		ctx.font = quoteFont;
		const lines = wrapCardText(note.text, W - padX * 2, measure).slice(0, maxQuoteLines);
		y = 200;
		ctx.textAlign = 'left';
		ctx.fillStyle = ink;
		for (const line of lines) {
			ctx.fillText(line, padX, y);
			y += lineH;
		}
	}

	// ── Note block (muted, smaller) ──
	const noteText = note.note.trim();
	if (noteText) {
		y += 26;
		ctx.strokeStyle = muted;
		ctx.lineWidth = 2;
		ctx.beginPath();
		if (settings.layoutId === 'center') {
			ctx.moveTo(W / 2 - 36, y);
			ctx.lineTo(W / 2 + 36, y);
		} else {
			ctx.moveTo(padX, y);
			ctx.lineTo(padX + 72, y);
		}
		ctx.stroke();
		y += Math.round(size * 0.85);
		ctx.font = `${Math.max(20, Math.round(size * 0.56))}px ${QUOTE_FONTS[1]!.stack}`;
		ctx.fillStyle = muted;
		const noteLines = wrapCardText(noteText, W - padX * 2, measure).slice(0, maxNoteLines);
		for (const line of noteLines) {
			ctx.fillText(line, settings.layoutId === 'center' ? W / 2 : padX, y);
			y += Math.round(size * 0.82);
		}
	}

	// ── Footer: book title + watermark ──
	canvasCtx.letterSpacing = '0px';
	ctx.font = `22px ${QUOTE_FONTS[1]!.stack}`;
	ctx.fillStyle = muted;
	if (settings.layoutId === 'center') {
		ctx.textAlign = 'center';
		if (title) ctx.fillText(title, W / 2, H - 110);
		drawWatermark(ctx, settings, W, H, ink, accent, 'center');
	} else {
		ctx.textAlign = 'left';
		if (title) ctx.fillText(title, padX, H - 60);
		drawWatermark(ctx, settings, W, H, ink, accent, 'right', padX);
	}
}

/**
 * The HiLighter watermark, five styles:
 * - highlight: the brand gesture — a slightly tilted marker swipe
 *   behind the wordmark, like someone highlighted it (default)
 * - text: plain letter-spaced wordmark
 * - serif: italic serif editorial small-caps feel
 * - stamp: wordmark inside a rounded outline, seal-like
 * - outline: hollow stroked letters
 */
function drawWatermark(
	ctx: CanvasRenderingContext2D,
	settings: QuoteCardSettings,
	w: number,
	h: number,
	ink: string,
	accent: string,
	align: 'center' | 'right',
	padX = 0,
): void {
	const label = t('brand.watermark');
	const baselineY = h - 60;
	const canvasCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
	canvasCtx.letterSpacing = '2px';
	let font = `600 19px ${QUOTE_FONTS[1]!.stack}`;
	if (settings.watermarkId === 'serif') {
		font = `italic 600 20px Georgia, "Songti SC", serif`;
	}
	ctx.font = font;
	const textW = ctx.measureText(label).width;
	const x = align === 'center' ? w / 2 - textW / 2 : w - padX - textW;
	ctx.textAlign = 'left';

	switch (settings.watermarkId) {
		case 'highlight': {
			// Rounded marker swipe under the lower half of the glyphs.
			const barH = 13;
			const barPad = 7;
			ctx.save();
			ctx.translate(x - barPad + 1, baselineY - barH + 4);
			ctx.rotate(-0.035);
			ctx.beginPath();
			ctx.roundRect(0, 0, textW + barPad * 2, barH, barH / 2);
			ctx.fillStyle = hexAlpha(accent, 0.85);
			ctx.fill();
			ctx.restore();
			// Wordmark reads in the auto ink, like real highlighted text.
			ctx.fillStyle = ink;
			ctx.fillText(label, x, baselineY);
			break;
		}
		case 'serif': {
			// Editorial: muted italic serif, wider tracking.
			canvasCtx.letterSpacing = '3px';
			ctx.fillStyle = ink;
			ctx.fillText(label, x, baselineY);
			break;
		}
		case 'stamp': {
			// Seal: rounded outline + accent wordmark inside.
			const padS = 9;
			const boxH = 30;
			const top = baselineY - 21;
			ctx.strokeStyle = hexAlpha(accent, 0.9);
			ctx.lineWidth = 1.6;
			ctx.beginPath();
			ctx.roundRect(x - padS, top, textW + padS * 2, boxH, 7);
			ctx.stroke();
			ctx.fillStyle = accent;
			ctx.fillText(label, x, baselineY);
			break;
		}
		case 'outline': {
			// Hollow letters, stroked only.
			ctx.lineWidth = 1;
			ctx.strokeStyle = hexAlpha(ink, 0.75);
			ctx.strokeText(label, x, baselineY);
			break;
		}
		default: {
			ctx.fillStyle = accent;
			ctx.fillText(label, x, baselineY);
			break;
		}
	}
	canvasCtx.letterSpacing = '0px';
}

// ── Modal ─────────────────────────────────────────────────

export class QuoteCardModal extends Modal {
	private note: HighlightNote;
	private title: string;
	private settings: QuoteCardSettings;
	private bgImage: BgImage | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private activeChip: HTMLElement | null = null;
	private customOptsEl: HTMLElement | null = null;

	constructor(app: App, note: HighlightNote, title: string) {
		super(app);
		this.note = note;
		this.title = title;
		this.settings = { ...lastSettings };
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('hl-quote-modal');

		contentEl.createEl('h3', { text: t('bookshelf.notebook.quoteModal.title'), cls: 'hl-quote-title' });

		const body = contentEl.createDiv('hl-quote-body');

		// Left: live preview (full-res canvas, CSS-scaled to fit)
		const preview = body.createDiv('hl-quote-preview');
		this.canvas = preview.createEl('canvas', { attr: { 'aria-label': t('bookshelf.notebook.quoteModal.title') } });
		this.renderCard();

		// Right: style controls (scrolls when the viewport is short)
		const controls = body.createDiv('hl-quote-controls');
		this.buildSliderRow(controls, 'bookshelf.notebook.quoteModal.fontSize', 28, 64, 2,
			() => this.settings.fontSize, size => this.update({ fontSize: size }));
		this.buildSliderRow(controls, 'bookshelf.notebook.quoteModal.margin', 24, 240, 4,
			() => this.settings.margin, margin => this.update({ margin }));
		this.buildSliderRow(controls, 'bookshelf.notebook.quoteModal.lineSpacing', 1.2, 2.2, 0.05,
			() => this.settings.lineSpacing, lineSpacing => this.update({ lineSpacing }));
		this.buildSliderRow(controls, 'bookshelf.notebook.quoteModal.letterSpacing', 0, 10, 0.5,
			() => this.settings.letterSpacing, letterSpacing => this.update({ letterSpacing }));
		this.buildInkColorRow(controls);
		this.buildFontRow(controls);
		this.buildSegmented(
			controls,
			'bookshelf.notebook.quoteModal.layout',
			(['center', 'left', 'quote'] as const).map(id => ({
				id,
				label: t(`bookshelf.notebook.quoteModal.layout.${id}`),
			})),
			this.settings.layoutId,
			layoutId => this.update({ layoutId }),
		);
		this.buildSegmented(
			controls,
			'bookshelf.notebook.quoteModal.aspect',
			(Object.keys(QUOTE_ASPECTS) as QuoteAspectId[]).map(id => ({ id, label: id })),
			this.settings.aspectId,
			aspectId => this.update({ aspectId }),
		);
		this.buildBackgroundRow(controls);
		this.buildMaskSection(controls);
		// Watermark style: five variants, always on (no free removal).
		const WATERMARK_STYLES: ReadonlyArray<QuoteCardSettings['watermarkId']> = [
			'highlight', 'text', 'serif', 'stamp', 'outline',
		];
		const currentWatermark = WATERMARK_STYLES.includes(this.settings.watermarkId)
			? this.settings.watermarkId
			: 'highlight';
		this.buildChipRow(
			controls,
			'bookshelf.notebook.quoteModal.watermark',
			WATERMARK_STYLES.map(id => ({
				id,
				label: t(`bookshelf.notebook.quoteModal.watermark.${id}`),
			})),
			currentWatermark,
			watermarkId => this.update({ watermarkId }),
		);

		// Footer actions
		const actions = contentEl.createDiv('hl-quote-actions');
		const download = actions.createEl('button', {
			cls: 'hl-quote-download',
			text: t('bookshelf.notebook.quoteModal.download'),
		});
		download.onclick = () => this.download();

		// Restore the session's image background, if any.
		if (lastBgImageSrc) {
			void this.loadBackground(lastBgImageSrc).then(() => this.renderCard());
		}
	}

	onClose(): void {
		lastSettings = { ...this.settings };
		lastBgImageSrc = this.bgImage?.src ?? null;
		this.contentEl.empty();
	}

	private update(patch: Partial<QuoteCardSettings>): void {
		this.settings = { ...this.settings, ...patch };
		this.renderCard();
	}

	private renderCard(): void {
		const canvas = this.canvas;
		if (!canvas) return;
		// Full-resolution draw; the preview <canvas> is CSS-scaled down.
		const aspect = QUOTE_ASPECTS[this.settings.aspectId] ?? QUOTE_ASPECTS['3:4'];
		canvas.width = aspect.w;
		canvas.height = aspect.h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		drawQuoteCard(ctx, this.note, this.settings, this.title, this.bgImage);
	}

	private buildSliderRow(
		parent: HTMLElement,
		labelKey: string,
		min: number,
		max: number,
		step: number,
		get: () => number,
		set: (value: number) => void,
	): void {
		const row = parent.createDiv('hl-quote-row');
		row.createSpan({ cls: 'hl-quote-row-label', text: t(labelKey) });
		const value = row.createSpan({ cls: 'hl-quote-row-value', text: String(get()) });
		const slider = row.createEl('input', {
			cls: 'hl-quote-slider',
			attr: { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': t(labelKey) },
		});
		slider.value = String(get());
		slider.oninput = () => {
			const parsed = Number(slider.value) || get();
			value.setText(String(parsed));
			set(parsed);
		};
	}

	/** Text color: 自动 (background ink) + preset swatches + custom picker. */
	private buildInkColorRow(parent: HTMLElement): void {
		const PRESET_INKS: ReadonlyArray<{ hex: string; label: string }> = [
			{ hex: '#FFFFFF', label: '白' },
			{ hex: '#F7F3EA', label: '米白' },
			{ hex: '#2A2A2A', label: '墨黑' },
			{ hex: '#D4AF6A', label: '金' },
			{ hex: '#E8656C', label: '绯红' },
			{ hex: '#9DB8D9', label: '雾蓝' },
		];
		const row = parent.createDiv('hl-quote-row hl-quote-row-wrap');
		row.createSpan({ cls: 'hl-quote-row-label', text: t('bookshelf.notebook.quoteModal.ink') });

		const pick = (target: HTMLElement | null, hex: string): void => {
			autoChip.toggleClass('is-active', hex === '');
			row.querySelectorAll('.hl-quote-swatch').forEach(el => {
				(el as HTMLElement).classList.remove('is-active');
				(el as HTMLElement).setAttribute('aria-pressed', 'false');
			});
			if (target) {
				target.classList.add('is-active');
				target.setAttribute('aria-pressed', 'true');
			}
			this.update({ inkColor: hex });
		};

		const autoChip = row.createEl('button', {
			cls: `hl-quote-chip${this.settings.inkColor === '' ? ' is-active' : ''}`,
			text: t('bookshelf.notebook.quoteModal.ink.auto'),
		});
		autoChip.onclick = () => pick(null, '');

		const swatches = row.createDiv('hl-quote-swatches');
		for (const preset of PRESET_INKS) {
			const selected = this.settings.inkColor.toLowerCase() === preset.hex.toLowerCase();
			const swatch = swatches.createEl('button', {
				cls: `hl-quote-swatch${selected ? ' is-active' : ''}`,
				attr: { 'aria-label': preset.label, title: preset.label, 'aria-pressed': String(selected) },
			});
			setCssProps(swatch, { background: preset.hex });
			swatch.onclick = () => pick(swatch, preset.hex);
		}

		// Custom text color: rainbow chip + hidden <input type=color>
		const isCustomInk = this.settings.inkColor !== ''
			&& !PRESET_INKS.some(preset => preset.hex.toLowerCase() === this.settings.inkColor.toLowerCase());
		const custom = swatches.createEl('button', {
			cls: `hl-quote-swatch hl-quote-swatch-custom${isCustomInk ? ' is-active' : ''}`,
			attr: {
				'aria-label': t('bookshelf.notebook.quoteModal.ink.custom'),
				title: t('bookshelf.notebook.quoteModal.ink.custom'),
				'aria-pressed': String(isCustomInk),
			},
		});
		if (isCustomInk) setCssProps(custom, { background: this.settings.inkColor });
		const inkInput = swatches.createEl('input', {
			cls: 'hl-quote-color-input',
			attr: {
				type: 'color',
				'aria-hidden': 'true',
				tabindex: '-1',
				value: this.settings.inkColor || '#ffffff',
			},
		});
		custom.onclick = () => inkInput.click();
		inkInput.oninput = () => {
			setCssProps(custom, { background: inkInput.value });
			pick(custom, inkInput.value);
		};
	}

	/** Font picker: wrapping chips, each labelled in its own font. */
	private buildFontRow(parent: HTMLElement): void {
		const row = parent.createDiv('hl-quote-row hl-quote-row-wrap');
		row.createSpan({ cls: 'hl-quote-row-label', text: t('bookshelf.notebook.quoteModal.font') });
		const chips = row.createDiv('hl-quote-fonts');
		for (const font of QUOTE_FONTS) {
			const selected = font.id === this.settings.fontId;
			const chip = chips.createEl('button', {
				cls: `hl-quote-font-chip${selected ? ' is-active' : ''}`,
				text: t(font.labelKey),
				attr: { 'aria-pressed': String(selected) },
			});
			setCssProps(chip, { 'font-family': font.stack });
			chip.onclick = () => {
				chips.querySelectorAll('.hl-quote-font-chip').forEach(el => {
					(el as HTMLElement).classList.remove('is-active');
					(el as HTMLElement).setAttribute('aria-pressed', 'false');
				});
				chip.addClass('is-active');
				chip.setAttribute('aria-pressed', 'true');
				this.update({ fontId: font.id });
			};
		}
	}

	private buildSegmented<T extends string>(
		parent: HTMLElement,
		labelKey: string,
		options: Array<{ id: T; label: string }>,
		current: T,
		onPick: (id: T) => void,
	): void {
		const row = parent.createDiv('hl-quote-row');
		row.createSpan({ cls: 'hl-quote-row-label', text: t(labelKey) });
		const seg = row.createDiv('hl-quote-seg');
		options.forEach(option => {
			const btn = seg.createEl('button', {
				cls: `hl-quote-seg-btn${option.id === current ? ' is-active' : ''}`,
				text: option.label,
				attr: { 'aria-pressed': String(option.id === current) },
			});
			btn.onclick = () => {
				seg.querySelectorAll('.hl-quote-seg-btn').forEach(el => {
					(el as HTMLElement).classList.remove('is-active');
					(el as HTMLElement).setAttribute('aria-pressed', 'false');
				});
				btn.addClass('is-active');
				btn.setAttribute('aria-pressed', 'true');
				onPick(option.id);
			};
		});
	}

	/** Chip row used by the mask controls (color / light effect). */
	private buildChipRow<T extends string>(
		parent: HTMLElement,
		labelKey: string,
		options: Array<{ id: T; label: string }>,
		current: T,
		onPick: (id: T) => void,
	): void {
		const row = parent.createDiv('hl-quote-row hl-quote-row-wrap');
		row.createSpan({ cls: 'hl-quote-row-label', text: t(labelKey) });
		const chips = row.createDiv('hl-quote-chips');
		for (const option of options) {
			const selected = option.id === current;
			const chip = chips.createEl('button', {
				cls: `hl-quote-chip${selected ? ' is-active' : ''}`,
				text: option.label,
				attr: { 'aria-pressed': String(selected) },
			});
			chip.onclick = () => {
				chips.querySelectorAll('.hl-quote-chip').forEach(el => {
					(el as HTMLElement).classList.remove('is-active');
					(el as HTMLElement).setAttribute('aria-pressed', 'false');
				});
				chip.addClass('is-active');
				chip.setAttribute('aria-pressed', 'true');
				onPick(option.id);
			};
		}
	}

	/** Shows the 纯色/渐变 options only while a custom color is active. */
	private syncCustomOpts(): void {
		const opts = this.customOptsEl;
		if (!opts) return;
		const isCustom = this.settings.backgroundId.startsWith('custom:');
		opts.toggleClass('is-active', isCustom);
		opts.toggleClass('is-gradient', isCustom && !!this.settings.customEnd);
	}

	private buildBackgroundRow(parent: HTMLElement): void {
		const row = parent.createDiv('hl-quote-row hl-quote-row-wrap');
		row.createSpan({ cls: 'hl-quote-row-label', text: t('bookshelf.notebook.quoteModal.background') });
		const swatches = row.createDiv('hl-quote-swatches');

		const selectSwatch = (el: HTMLElement): void => {
			swatches.querySelectorAll('.hl-quote-swatch').forEach(other => {
				other.classList.remove('is-active');
				other.setAttribute('aria-pressed', 'false');
			});
			el.classList.add('is-active');
			el.setAttribute('aria-pressed', 'true');
		};

		for (const bg of QUOTE_BACKGROUNDS) {
			const selected = bg.id === this.settings.backgroundId;
			const swatch = swatches.createEl('button', {
				cls: `hl-quote-swatch${selected ? ' is-active' : ''}`,
				attr: { 'aria-label': bg.id, title: bg.id, 'aria-pressed': String(selected) },
			});
			setCssProps(swatch, {
				background: bg.to
					? `linear-gradient(160deg, ${bg.from}, ${bg.to})`
					: bg.from,
			});
			swatch.onclick = () => {
				selectSwatch(swatch);
				// Picking a palette color drops an active image.
				if (this.bgImage) {
					this.bgImage = null;
					lastBgImageSrc = null;
					this.activeChip?.remove();
					this.activeChip = null;
				}
				this.update({ backgroundId: bg.id });
				this.syncCustomOpts();
			};
		}

		// Custom color picker: rainbow chip + hidden <input type=color>
		const isCustom = this.settings.backgroundId.startsWith('custom:');
		const customSwatch = swatches.createEl('button', {
			cls: `hl-quote-swatch hl-quote-swatch-custom${isCustom ? ' is-active' : ''}`,
			attr: {
				'aria-label': t('bookshelf.notebook.quoteModal.bgImage.customColor'),
				title: t('bookshelf.notebook.quoteModal.bgImage.customColor'),
				'aria-pressed': String(isCustom),
			},
		});
		if (isCustom) {
			setCssProps(customSwatch, { background: this.settings.backgroundId.slice('custom:'.length) });
		}
		const colorInput = swatches.createEl('input', {
			cls: 'hl-quote-color-input',
			attr: {
				type: 'color',
				'aria-hidden': 'true',
				tabindex: '-1',
				...(isCustom ? { value: this.settings.backgroundId.slice('custom:'.length) } : {}),
			},
		});
		customSwatch.onclick = () => colorInput.click();
		colorInput.oninput = () => {
			const hex = colorInput.value;
			selectSwatch(customSwatch);
			setCssProps(customSwatch, { background: hex });
			if (this.bgImage) {
				this.bgImage = null;
				lastBgImageSrc = null;
				this.activeChip?.remove();
				this.activeChip = null;
			}
			// The gradient end (if any) stays; changing the primary just
			// re-anchors the custom background.
			this.update({ backgroundId: `custom:${hex}` });
			this.syncCustomOpts();
		};

		// Custom options: 纯色 / 渐变 + (gradient) end color + direction
		const customOpts = row.createDiv('hl-quote-custom-opts');
		const solidBtn = customOpts.createEl('button', {
			cls: `hl-quote-chip${this.settings.customEnd ? '' : ' is-active'}`,
			text: t('bookshelf.notebook.quoteModal.bgImage.customSolid'),
		});
		const gradBtn = customOpts.createEl('button', {
			cls: `hl-quote-chip${this.settings.customEnd ? ' is-active' : ''}`,
			text: t('bookshelf.notebook.quoteModal.bgImage.customGradient'),
		});
		const gradOpts = customOpts.createDiv('hl-quote-grad-opts');
		const endSwatch = gradOpts.createEl('button', {
			cls: 'hl-quote-swatch hl-quote-grad-end',
			attr: {
				'aria-label': t('bookshelf.notebook.quoteModal.bgImage.customEnd'),
				title: t('bookshelf.notebook.quoteModal.bgImage.customEnd'),
			},
		});
		const endInput = gradOpts.createEl('input', {
			cls: 'hl-quote-color-input',
			attr: {
				type: 'color',
				'aria-hidden': 'true',
				tabindex: '-1',
				value: this.settings.customEnd || '#ffffff',
			},
		});
		endSwatch.onclick = () => endInput.click();
		endInput.oninput = () => {
			setCssProps(endSwatch, { background: endInput.value });
			this.update({ customEnd: endInput.value });
		};
		const angleChips = gradOpts.createDiv('hl-quote-chips');
		const ANGLES: Array<{ angle: number; labelKey: string }> = [
			{ angle: 180, labelKey: 'bookshelf.notebook.quoteModal.bgImage.angle.180' },
			{ angle: 135, labelKey: 'bookshelf.notebook.quoteModal.bgImage.angle.135' },
			{ angle: 90, labelKey: 'bookshelf.notebook.quoteModal.bgImage.angle.90' },
		];
		for (const entry of ANGLES) {
			const selected = this.settings.customAngle === entry.angle;
			const chip = angleChips.createEl('button', {
				cls: `hl-quote-chip${selected ? ' is-active' : ''}`,
				text: t(entry.labelKey),
			});
			chip.onclick = () => {
				angleChips.querySelectorAll('.hl-quote-chip').forEach(el => {
					(el as HTMLElement).classList.remove('is-active');
				});
				chip.addClass('is-active');
				this.update({ customAngle: entry.angle });
			};
		}
		solidBtn.onclick = () => {
			solidBtn.addClass('is-active');
			gradBtn.removeClass('is-active');
			this.update({ customEnd: '' });
			this.syncCustomOpts();
		};
		gradBtn.onclick = () => {
			gradBtn.addClass('is-active');
			solidBtn.removeClass('is-active');
			// Entering gradient mode without an end color yet: seed one.
			const end = this.settings.customEnd
				|| defaultGradientEnd(this.settings.backgroundId.slice('custom:'.length));
			endInput.value = end;
			setCssProps(endSwatch, { background: end });
			this.update({ customEnd: end });
			this.syncCustomOpts();
		};
		this.customOptsEl = customOpts;
		if (this.settings.customEnd) setCssProps(endSwatch, { background: this.settings.customEnd });
		this.syncCustomOpts();

		// Custom image backgrounds: upload button + URL field.
		const imageRow = row.createDiv('hl-quote-bg-row');
		const upload = imageRow.createEl('button', {
			cls: 'hl-quote-bg-btn',
			text: t('bookshelf.notebook.quoteModal.bgImage.upload'),
		});
		const fileInput = imageRow.createEl('input', {
			cls: 'hl-quote-file-input',
			attr: {
				type: 'file',
				accept: 'image/png,image/jpeg,image/webp',
				'aria-hidden': 'true',
				tabindex: '-1',
			},
		});
		upload.onclick = () => fileInput.click();
		fileInput.onchange = () => {
			const file = fileInput.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = () => {
				const src = typeof reader.result === 'string' ? reader.result : '';
				if (src) void this.loadBackground(src).then(() => this.renderCard());
			};
			reader.readAsDataURL(file);
			fileInput.value = '';
		};

		// URL input + apply travel as ONE flex item so they never split.
		const urlGroup = imageRow.createDiv('hl-quote-url-group');
		const urlInput = urlGroup.createEl('input', {
			cls: 'hl-quote-url-input',
			attr: {
				type: 'text',
				placeholder: t('bookshelf.notebook.quoteModal.bgImage.urlPlaceholder'),
				'aria-label': t('bookshelf.notebook.quoteModal.bgImage.urlPlaceholder'),
			},
		});
		const apply = urlGroup.createEl('button', {
			cls: 'hl-quote-bg-btn',
			text: t('bookshelf.notebook.quoteModal.bgImage.apply'),
		});
		const applyUrl = (): void => {
			const url = urlInput.value.trim();
			if (!/^https?:\/\//i.test(url)) {
				new Notice(t('bookshelf.notebook.quoteModal.bgImage.badUrl'));
				return;
			}
			void this.loadBackground(url)
				.then(() => {
					urlInput.value = '';
					this.renderCard();
				})
				.catch(() => {
					new Notice(t('bookshelf.notebook.quoteModal.bgImage.loadFailed'));
				});
		};
		apply.onclick = applyUrl;
		urlInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				applyUrl();
			}
		});
	}

	/** Mask layer controls: opacity / blur sliders + color / light chips. */
	private buildMaskSection(parent: HTMLElement): void {
		const section = parent.createDiv('hl-quote-mask');
		const head = section.createDiv('hl-quote-mask-head');
		head.createDiv({ cls: 'hl-quote-mask-title', text: t('bookshelf.notebook.quoteModal.mask') });
		const reset = head.createEl('button', {
			cls: 'hl-quote-mask-reset',
			text: t('bookshelf.notebook.quoteModal.mask.reset'),
		});
		const content = section.createDiv('hl-quote-mask-content');
		const renderControls = (): void => {
			content.empty();
			this.buildSliderRow(content, 'bookshelf.notebook.quoteModal.mask.opacity', 0, 90, 5,
				() => Math.round(this.settings.maskOpacity * 100),
				value => this.update({ maskOpacity: value / 100 }));
			this.buildSliderRow(content, 'bookshelf.notebook.quoteModal.mask.blur', 0, 20, 1,
				() => this.settings.bgBlur, blur => this.update({ bgBlur: blur }));
			this.buildChipRow(
				content,
				'bookshelf.notebook.quoteModal.mask.color',
				(['black', 'navy', 'warm'] as const).map(id => ({
					id,
					label: t(`bookshelf.notebook.quoteModal.mask.color.${id}`),
				})),
				this.settings.maskColor,
				maskColor => this.update({ maskColor }),
			);
			this.buildChipRow(
				content,
				'bookshelf.notebook.quoteModal.mask.light',
				(['none', 'vignette', 'center', 'top', 'bottom'] as const).map(id => ({
					id,
					label: t(`bookshelf.notebook.quoteModal.mask.light.${id}`),
				})),
				this.settings.maskLight,
				maskLight => this.update({ maskLight }),
			);
		};
		renderControls();
		// Reset clears every mask effect and rebuilds the controls so
		// sliders and chip states visibly return to their defaults.
		reset.onclick = () => {
			this.update({ maskOpacity: 0, bgBlur: 0, maskColor: 'black', maskLight: 'none' });
			renderControls();
		};
	}

	/** Marks the image as the active background (chip + light inks). */
	private markImageActive(): void {
		this.activeChip?.remove();
		const row = this.contentEl.querySelector('.hl-quote-bg-row');
		if (!row) return;
		const chip = row.createDiv('hl-quote-bg-active');
		chip.createSpan({ text: t('bookshelf.notebook.quoteModal.bgImage.active') });
		const clear = chip.createEl('button', {
			cls: 'hl-quote-bg-clear',
			text: t('bookshelf.notebook.quoteModal.bgImage.clear'),
		});
		clear.onclick = () => {
			this.bgImage = null;
			lastBgImageSrc = null;
			chip.remove();
			this.activeChip = null;
			this.renderCard();
		};
		this.activeChip = chip;
	}

	/** Loads an image (data URL or network URL with CORS). */
	private loadBackground(src: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
			img.onload = () => {
				this.bgImage = { src, img };
				lastBgImageSrc = src;
				this.markImageActive();
				resolve();
			};
			img.onerror = () => reject(new Error('image load failed'));
			img.src = src;
		});
	}

	private download(): void {
		const canvas = this.canvas;
		if (!canvas) return;
		try {
			const link = createEl('a');
			link.download = `hilighter-quote-${Date.now()}.png`;
			link.href = canvas.toDataURL('image/png');
			link.click();
			this.close();
		} catch {
			// Tainted canvas: the network image's server denied CORS.
			new Notice(t('bookshelf.notebook.quoteModal.bgImage.exportFailed'));
		}
	}
}
