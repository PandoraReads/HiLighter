// ============================================================
// HiLighter - XHS share-card canvas generators (extracted)
// ============================================================

import type { HighlightNote } from '../models';
import { t } from '../i18n';
import { wrapCardText } from './xhs-wrap';

/** Picks one of the four styles at random and downloads a PNG. */
export function generateXhsImage(note: HighlightNote): void {
    const styles = [xhsStyleBold, xhsStyleMinimal, xhsStyleWarm, xhsStyleSerif];
    const styleFn = styles[Math.floor(Math.random() * styles.length)]!;
    styleFn(note);
}

function downloadCanvas(canvas: HTMLCanvasElement): void {
    const link = createEl('a');
    link.download = `hilighter-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    return wrapCardText(text, maxWidth, value => ctx.measureText(value).width);
}

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const dpr = 2;
    const canvas = createEl('canvas');
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    return { canvas, ctx };
}

// ── Style 1: Bold block color + giant decorative quotes ──
function xhsStyleBold(note: HighlightNote): void {
    const W = 1080, H = 1440;
    const { canvas, ctx } = newCanvas(W, H);

    const palettes = [
        { bg: '#2A75BB', text: '#FFFFFF', sub: 'rgba(255,255,255,0.5)', mark: 'rgba(255,255,255,0.12)' },
        { bg: '#1A3A5C', text: '#FFFFFF', sub: 'rgba(255,255,255,0.45)', mark: 'rgba(255,255,255,0.08)' },
        { bg: '#C62828', text: '#FFFFFF', sub: 'rgba(255,255,255,0.5)', mark: 'rgba(255,255,255,0.1)' },
        { bg: '#2E7D32', text: '#FFFFFF', sub: 'rgba(255,255,255,0.45)', mark: 'rgba(255,255,255,0.08)' },
        { bg: '#4A148C', text: '#FFFFFF', sub: 'rgba(255,255,255,0.45)', mark: 'rgba(255,255,255,0.08)' },
        { bg: '#E65100', text: '#FFFFFF', sub: 'rgba(255,255,255,0.5)', mark: 'rgba(255,255,255,0.1)' },
    ];
    const pal = palettes[Math.floor(Math.random() * palettes.length)]!;

    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);

    // Giant decorative quote marks
    ctx.save();
    ctx.font = 'italic 360px Georgia, serif';
    ctx.fillStyle = pal.mark;
    ctx.textAlign = 'left';
    ctx.fillText('“', 30, 320);
    ctx.textAlign = 'right';
    ctx.fillText('”', W - 30, H - 140);
    ctx.restore();

    // Quote text
    const padX = 120;
    let y = 360;
    ctx.fillStyle = pal.text;
    ctx.font = 'bold 48px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    const lines = wrapText(ctx, note.text, W - padX * 2);
    lines.forEach((line, i) => {
        if (y > H - 300) return;
        if (i === lines.length - 1) ctx.fillStyle = pal.sub;
        ctx.fillText(line, padX, y);
        y += 68;
    });

    // Thin divider
    y += 30;
    ctx.strokeStyle = pal.sub;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + 60, y);
    ctx.stroke();

    // Watermark
    y = H - 100;
    ctx.fillStyle = pal.sub;
    ctx.font = '300 22px "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(t('brand.watermark'), padX, y);

    downloadCanvas(canvas);
}

// ── Style 2: Minimal light + centered + soft serif ──
function xhsStyleMinimal(note: HighlightNote): void {
    const W = 1080, H = 1080;
    const { canvas, ctx } = newCanvas(W, H);

    const bgs = ['#F0F4F8', '#E8F5E9', '#FFF8E1', '#F3E5F5', '#E0F2F1'];
    const bg = bgs[Math.floor(Math.random() * bgs.length)]!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Subtle center glow
    const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 400);
    glow.addColorStop(0, 'rgba(255,255,255,0.6)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Centered quote
    const padX = 140;
    ctx.fillStyle = '#2C2C2C';
    ctx.font = '36px "Songti SC", "STSong", "Georgia", serif';
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, '“' + note.text + '”', W - padX * 2);
    const lineH = 56;
    const totalH = lines.length * lineH;
    let startY = (H - totalH) / 2;
    lines.forEach(line => {
        ctx.fillText(line, W / 2, startY);
        startY += lineH;
    });

    // Divider
    startY += 30;
    ctx.strokeStyle = '#CCC';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 30, startY);
    ctx.lineTo(W / 2 + 30, startY);
    ctx.stroke();

    // Source
    startY += 36;
    const filename = note.sourcePath.split('/').pop()?.replace('.md', '') || '';
    ctx.fillStyle = '#999';
    ctx.font = '22px "PingFang SC", sans-serif';
    ctx.fillText(filename, W / 2, startY);

    // Bottom watermark
    ctx.fillStyle = '#BBB';
    ctx.font = '18px "PingFang SC", sans-serif';
    ctx.fillText(t('brand.watermark'), W / 2, H - 48);

    downloadCanvas(canvas);
}

// ── Style 3: Warm paper + accent left bar + hand-written feel ──
function xhsStyleWarm(note: HighlightNote): void {
    const W = 1080, H = 1440;
    const { canvas, ctx } = newCanvas(W, H);

    // Warm paper background
    ctx.fillStyle = '#FBF7F0';
    ctx.fillRect(0, 0, W, H);

    // Paper grain texture
    ctx.save();
    ctx.globalAlpha = 0.03;
    for (let i = 0; i < 8000; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#8B7355';
        ctx.fillRect(Math.random() * W, Math.random() * H, Math.random() * 2, Math.random() * 2);
    }
    ctx.restore();

    // Left accent bar
    const accentColors = ['#C0392B', '#2980B9', '#27AE60', '#8E44AD', '#D35400', '#16A085'];
    const accent = accentColors[Math.floor(Math.random() * accentColors.length)]!;
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 8, H);

    // Small decorative circle top-right
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.beginPath();
    ctx.arc(W - 100, 140, 80, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.restore();

    // Quote text
    const padX = 100;
    let y = 180;
    ctx.fillStyle = '#2C2C2C';
    ctx.font = '42px "Songti SC", "STSong", "Georgia", serif';
    ctx.textAlign = 'left';
    const lines = wrapText(ctx, note.text, W - padX * 2);
    lines.forEach(line => {
        if (y > H - 400) return;
        ctx.fillText(line, padX, y);
        y += 62;
    });

    // Note text if exists
    if (note.note) {
        y += 20;
        ctx.strokeStyle = '#E0D8CC';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(W - padX, y);
        ctx.stroke();
        y += 36;
        ctx.fillStyle = '#777';
        ctx.font = '28px "PingFang SC", "Hiragino Sans GB", sans-serif';
        const noteLines = wrapText(ctx, note.note, W - padX * 2);
        noteLines.forEach(line => {
            if (y > H - 220) return;
            ctx.fillText(line, padX, y);
            y += 42;
        });
    }

    // Tags
    if (note.tags && note.tags.length > 0) {
        y = H - 200;
        ctx.fillStyle = accent;
        ctx.font = '500 22px "PingFang SC", sans-serif';
        let tagX = padX;
        note.tags.forEach(tag => {
            const label = '# ' + tag;
            ctx.fillText(label, tagX, y);
            tagX += ctx.measureText(label).width + 24;
        });
    }

    // Bottom watermark
    ctx.fillStyle = '#C8BFB0';
    ctx.font = '20px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('brand.watermark'), W / 2, H - 48);

    downloadCanvas(canvas);
}

// ── Style 4: Serif editorial + large drop cap ──
function xhsStyleSerif(note: HighlightNote): void {
    const W = 1080, H = 1440;
    const { canvas, ctx } = newCanvas(W, H);

    // Deep dark background
    const darks = ['#1C1C1E', '#1A2332', '#2D1F2F', '#1E2D1E', '#2B1D1D'];
    ctx.fillStyle = darks[Math.floor(Math.random() * darks.length)]!;
    ctx.fillRect(0, 0, W, H);

    // Top thin accent line
    const accents = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#FF8A5C', '#D4A5FF'];
    const accent = accents[Math.floor(Math.random() * accents.length)]!;
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 4);

    // Drop cap (first character, large)
    const padX = 90;
    const startsWithLatin = /^[A-Za-z0-9\u00c0-\u024f]/.test(note.text);
    const firstChar = startsWithLatin ? '“' : Array.from(note.text)[0] ?? '';
    const restText = startsWithLatin ? note.text : note.text.slice(firstChar.length);

    ctx.fillStyle = accent;
    ctx.font = '120px "Songti SC", "STSong", "Georgia", serif';
    ctx.textAlign = 'left';
    ctx.fillText(firstChar, padX, 220);

    // Rest of quote
    ctx.fillStyle = '#E8E8E8';
    ctx.font = '38px "Songti SC", "STSong", "Georgia", serif';
    const restLines = wrapText(ctx, restText, W - padX * 2 - 100);
    let y = 300;
    restLines.forEach(line => {
        if (y > H - 400) return;
        ctx.fillText(line, padX, y);
        y += 56;
    });

    // Decorative thin line
    y += 20;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(W - padX, y);
    ctx.stroke();

    // Note if exists
    if (note.note) {
        y += 40;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '26px "PingFang SC", sans-serif';
        const noteLines = wrapText(ctx, note.note, W - padX * 2);
        noteLines.forEach(line => {
            if (y > H - 220) return;
            ctx.fillText(line, padX, y);
            y += 40;
        });
    }

    // Bottom: source + watermark
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '20px "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    const filename = note.sourcePath.split('/').pop()?.replace('.md', '') || '';
    ctx.fillText(filename, padX, H - 48);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillText(t('brand.watermark'), W - padX, H - 48);

    downloadCanvas(canvas);
}
