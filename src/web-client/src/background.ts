// Background module — generates patterns using recolored src.svg logos + emojis
// Persists config in cookie so backgrounds stay consistent across reloads

import { getColorScheme } from './favicon';
// Note: favicon.ts still handles the browser tab icon separately
import { PALETTES, PALETTE_NAMES as _NAMES } from './palettes';

// ── Cookie helpers ──────────────────────────────────────────────────────────

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}

function loadConfig(): BgConfig | null {
  try {
    const raw = getCookie('fh-bg-config');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveConfig(config: BgConfig) {
  setCookie('fh-bg-config', JSON.stringify(config));
}

// ── Types ───────────────────────────────────────────────────────────────────

export const FAVICON_PATTERNS = ['mosaic', 'lotus', 'stacks', 'sprinkle', 'prism'] as const;
export const RETRO_PATTERNS = ['layer', 'cybertron', 'panic', 'stack3d', 'wave'] as const;
export const ALL_PATTERNS = [...FAVICON_PATTERNS, ...RETRO_PATTERNS] as const;
export type BgPattern = (typeof ALL_PATTERNS)[number];

// Legacy compat — kept for main.ts imports
export type BgType = 'favicon' | 'retro';

export { _NAMES as PALETTE_NAMES };

export interface BgConfig {
  type: BgType;
  pattern: string;
  palette: number;
  zoom: number;
  color: string;
  seed: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const EMOJIS = ['🛡️', '🔐', '🗝️', '🕊️', '✊', '📜', '⚖️', '🏛️', '🔒', '👁️‍🗨️', '🌐', '🗳️'];

// PALETTES now imported from palettes.ts (100 triplets)

// ── Seeded random ───────────────────────────────────────────────────────────

function mulberry32(a: number) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Canvas setup ────────────────────────────────────────────────────────────

let bgCanvas: HTMLCanvasElement | null = null;

function getOrCreateCanvas(): HTMLCanvasElement {
  if (bgCanvas) return bgCanvas;
  bgCanvas = document.createElement('canvas');
  bgCanvas.id = 'fh-bg-canvas';
  Object.assign(bgCanvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    zIndex: '-2',
    pointerEvents: 'none',
  });
  document.body.prepend(bgCanvas);
  return bgCanvas;
}

function sizeCanvas(canvas: HTMLCanvasElement) {
  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
}

// ── Image loading ───────────────────────────────────────────────────────────

// ── SVG logo loading with dynamic color ─────────────────────────────────────

let svgLogoTemplate: string | null = null;
const coloredLogoCache = new Map<string, HTMLImageElement>();

async function loadSvgTemplate(): Promise<string> {
  if (svgLogoTemplate) return svgLogoTemplate;
  const resp = await fetch('/src.svg');
  let svg = await resp.text();
  // Remove the background rectangle (first <path> with translate(0,0) that fills the full bounding box)
  svg = svg.replace(/<path[^>]*transform="translate\(0,0\)"[^/]*\/>/, '');
  svgLogoTemplate = svg;
  return svg;
}

async function getColoredLogo(color: string): Promise<HTMLImageElement> {
  const cached = coloredLogoCache.get(color);
  if (cached) return cached;
  const template = await loadSvgTemplate();
  // Replace all fills with the target color
  const colored = template
    .replace(/fill="#0F0E0E"/g, `fill="${color}"`)
    .replace(/fill="#000000"/g, `fill="${color}"`);
  const blob = new Blob([colored], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { coloredLogoCache.set(color, img); URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// ── Draw helpers ────────────────────────────────────────────────────────────

function drawEmoji(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, emoji: string, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `${size}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, 0);
  ctx.restore();
}

function drawLogoImg(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, height: number, angle = 0, alpha = 1) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const w = height * aspect;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(img, -w / 2, -height / 2, w, height);
  ctx.restore();
}

// ── Unified pattern renderers ───────────────────────────────────────────────
// All patterns receive recolored src.svg logos (3 palette colors) + mix in emojis.
// No pattern should be 100% logos or 100% emojis.

type PatternRenderer = (ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], palette: string[], zoom: number, rand: () => number) => void;

function renderMosaic(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], _palette: string[], zoom: number, rand: () => number) {
  const cellSize = Math.round(48 * zoom);
  const cols = Math.ceil(w / cellSize) + 1;
  const rows = Math.ceil(h / cellSize) + 1;
  let logoIdx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const offsetX = (r % 2) * (cellSize / 2);
      const x = c * cellSize + offsetX;
      const y = r * cellSize;
      if (rand() < 0.10) {
        drawEmoji(ctx, x, y, cellSize * 0.5, EMOJIS[Math.floor(rand() * EMOJIS.length)]);
      } else {
        drawLogoImg(ctx, logos[logoIdx++ % logos.length], x, y, cellSize * 0.5, 0, 0.4 + rand() * 0.6);
      }
    }
  }
}

function renderLotus(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], _palette: string[], zoom: number, rand: () => number) {
  const cx = w / 2, cy = h / 2;
  const maxRadius = Math.max(w, h) * 0.8;
  const rings = Math.round(8 * zoom);
  let logoIdx = 0;
  for (let ring = 1; ring <= rings; ring++) {
    const radius = (ring / rings) * maxRadius;
    const count = Math.round(ring * 6 * zoom);
    const fSize = Math.round((30 + ring * 4) * zoom);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + ring * 0.3;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (rand() < 0.08) {
        drawEmoji(ctx, x, y, fSize * 0.7, EMOJIS[Math.floor(rand() * EMOJIS.length)], angle);
      } else {
        drawLogoImg(ctx, logos[logoIdx++ % logos.length], x, y, fSize * 0.6, angle + Math.PI / 2, 0.5 + rand() * 0.5);
      }
    }
  }
}

function renderStacks(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], _palette: string[], zoom: number, rand: () => number) {
  const colCount = Math.round(6 * zoom) + 2;
  const colWidth = w / colCount;
  let logoIdx = 0;
  for (let c = 0; c < colCount; c++) {
    const x = c * colWidth + colWidth / 2;
    const baseSize = (28 + rand() * 40) * zoom;
    const rotation = (rand() - 0.5) * 0.3;
    let y = -baseSize;
    while (y < h + baseSize) {
      const size = baseSize * (0.6 + rand() * 0.8);
      if (rand() < 0.09) {
        drawEmoji(ctx, x + (rand() - 0.5) * 10, y, size * 0.6, EMOJIS[Math.floor(rand() * EMOJIS.length)], rotation);
      } else {
        drawLogoImg(ctx, logos[logoIdx++ % logos.length], x + (rand() - 0.5) * 10, y, size * 0.5, rotation, 0.4 + rand() * 0.6);
      }
      y += size * 0.9;
    }
  }
}

function renderSprinkle(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], _palette: string[], zoom: number, rand: () => number) {
  const count = Math.round(120 * zoom * zoom);
  let logoIdx = 0;
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const size = (16 + rand() * 50) * zoom;
    const angle = rand() * Math.PI * 2;
    if (rand() < 0.12) {
      drawEmoji(ctx, x, y, size * 0.6, EMOJIS[Math.floor(rand() * EMOJIS.length)], angle);
    } else {
      drawLogoImg(ctx, logos[logoIdx++ % logos.length], x, y, size * 0.5, angle, 0.3 + rand() * 0.7);
    }
  }
}

function renderPrism(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], _palette: string[], zoom: number, rand: () => number) {
  const bandWidth = Math.round(60 * zoom);
  const angle = Math.PI / 6 + (rand() - 0.5) * 0.3;
  const diagonal = Math.sqrt(w * w + h * h);
  const bandCount = Math.ceil(diagonal / bandWidth) + 2;
  let logoIdx = 0;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angle);
  for (let b = -bandCount; b <= bandCount; b++) {
    const by = b * bandWidth;
    const fSize = Math.round(28 * zoom);
    const count = Math.ceil(diagonal / (fSize * 0.8));
    for (let i = -count / 2; i < count / 2; i++) {
      const fx = i * fSize * 0.8;
      if (rand() < 0.08) {
        drawEmoji(ctx, fx, by, fSize * 0.5, EMOJIS[Math.floor(rand() * EMOJIS.length)]);
      } else {
        drawLogoImg(ctx, logos[logoIdx++ % logos.length], fx, by, fSize * 0.4, 0, 0.4 + rand() * 0.6);
      }
    }
  }
  ctx.restore();
}

function renderLayer(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], _palette: string[], zoom: number, rand: () => number) {
  const layers = 14;
  const baseH = Math.round(80 * zoom);
  const cx = w / 2, cy = h / 2;
  const step = 8 * zoom;
  for (let i = layers - 1; i >= 0; i--) {
    const t = i / layers;
    const alpha = 0.15 + t * 0.7;
    drawLogoImg(ctx, logos[i % logos.length], cx + i * step, cy + i * step * 0.7, baseH, 0, alpha);
  }
  drawLogoImg(ctx, logos[1], cx, cy, baseH, 0, 1);
  // Scatter emojis around the layered logos
  const emojiCount = Math.round(6 + 4 * zoom);
  for (let i = 0; i < emojiCount; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = (0.15 + rand() * 0.35) * Math.min(w, h);
    drawEmoji(ctx, cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist,
      Math.round(20 + rand() * 24) * zoom, EMOJIS[Math.floor(rand() * EMOJIS.length)], rand() * 0.4);
  }
}

function renderCybertron(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], _palette: string[], zoom: number, rand: () => number) {
  const logo = logos[0];
  const size = Math.round(32 * zoom);
  const aspect = logo.naturalWidth / logo.naturalHeight;
  const gapX = size * aspect * 1.3;
  const gapY = size * 1.4;
  const cols = Math.ceil(w / gapX) + 1;
  const rows = Math.ceil(h / gapY) + 1;
  const startX = (w - cols * gapX) / 2 + gapX / 2;
  const startY = (h - rows * gapY) / 2 + gapY / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * gapX;
      const y = startY + r * gapY;
      const dx = (x - w / 2) / (w / 2);
      const dy = (y - h / 2) / (h / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0.1, 1 - dist * 0.6);
      if (rand() < 0.08) {
        drawEmoji(ctx, x, y, size * 0.7, EMOJIS[Math.floor(rand() * EMOJIS.length)]);
      } else {
        drawLogoImg(ctx, logos[(r + c) % logos.length], x, y, size, 0, alpha);
      }
    }
  }
}

function renderPanic(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], palette: string[], zoom: number, rand: () => number) {
  const copies = 9;
  const size = Math.round(90 * zoom);
  const cx = w / 2, cy = h / 2;
  const offX = 12 * zoom, offY = 9 * zoom;
  for (let i = copies - 1; i >= 0; i--) {
    const x = cx + (i - copies / 2) * offX;
    const y = cy + (i - copies / 2) * offY;
    const alpha = 0.3 + (i / copies) * 0.6;
    const logo = logos[i % logos.length];
    const aspect = logo.naturalWidth / logo.naturalHeight;
    const lw = size * aspect;
    ctx.save();
    ctx.globalAlpha = alpha * 0.4;
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = palette[i % palette.length];
    ctx.fillRect(x - lw / 2, y - size / 2, lw, size);
    ctx.restore();
    drawLogoImg(ctx, logo, x, y, size, 0, alpha);
  }
  drawLogoImg(ctx, logos[1], cx, cy, size, 0, 1);
  // Scatter emojis around the panic stack
  const emojiCount = Math.round(5 + 3 * zoom);
  for (let i = 0; i < emojiCount; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = (0.2 + rand() * 0.3) * Math.min(w, h);
    drawEmoji(ctx, cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist,
      Math.round(22 + rand() * 20) * zoom, EMOJIS[Math.floor(rand() * EMOJIS.length)], rand() * 0.5);
  }
}

function renderStack3d(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], _palette: string[], zoom: number, rand: () => number) {
  const layers = 16;
  const size = Math.round(70 * zoom);
  const cx = w / 2;
  const baseY = h / 2 + layers * 4 * zoom;
  const step = 8 * zoom;
  for (let i = layers - 1; i >= 0; i--) {
    const y = baseY - i * step;
    const t = i / layers;
    drawLogoImg(ctx, logos[i % logos.length], cx, y, size, 0, 0.2 + t * 0.8);
  }
  // Scatter emojis around the 3D stack
  const emojiCount = Math.round(6 + 3 * zoom);
  for (let i = 0; i < emojiCount; i++) {
    const x = cx + (rand() - 0.5) * w * 0.6;
    const y = rand() * h;
    drawEmoji(ctx, x, y, Math.round(18 + rand() * 22) * zoom,
      EMOJIS[Math.floor(rand() * EMOJIS.length)], (rand() - 0.5) * 0.4);
  }
}

function renderWave(ctx: CanvasRenderingContext2D, w: number, h: number, logos: HTMLImageElement[], _palette: string[], zoom: number, rand: () => number) {
  const diagonal = Math.sqrt(w * w + h * h);
  const count = Math.round(50 * zoom);
  const baseSize = Math.round(diagonal * 0.04 * zoom);
  const cx = w / 2, cy = h / 2;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const angle = t * Math.PI * 8;
    const radius = t * diagonal * 0.5;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius * 0.55;
    const s = baseSize * (0.4 + t * 1.4);
    if (rand() < 0.10) {
      drawEmoji(ctx, x, y, s * 0.6, EMOJIS[Math.floor(rand() * EMOJIS.length)], angle);
    } else {
      drawLogoImg(ctx, logos[i % logos.length], x, y, s, Math.sin(angle) * 0.2, 0.15 + t * 0.85);
    }
  }
}

const PATTERN_RENDERERS: Record<string, PatternRenderer> = {
  mosaic: renderMosaic, lotus: renderLotus, stacks: renderStacks,
  sprinkle: renderSprinkle, prism: renderPrism,
  layer: renderLayer, cybertron: renderCybertron, panic: renderPanic,
  stack3d: renderStack3d, wave: renderWave,
};

// ── Background fill ─────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function fillBackground(ctx: CanvasRenderingContext2D, w: number, h: number, scheme: string, palette?: string[]) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (palette) {
    // Tint the gradient with palette primary — deep and rich, not plain gray
    const [r, g, b] = hexToRgb(palette[0]);
    if (scheme === 'dark') {
      grad.addColorStop(0, `rgb(${Math.round(r * 0.08)}, ${Math.round(g * 0.08)}, ${Math.round(b * 0.08)})`);
      grad.addColorStop(1, `rgb(${Math.round(r * 0.15)}, ${Math.round(g * 0.15)}, ${Math.round(b * 0.15)})`);
    } else {
      grad.addColorStop(0, `rgb(${Math.round(230 + r * 0.1)}, ${Math.round(230 + g * 0.1)}, ${Math.round(230 + b * 0.1)})`);
      grad.addColorStop(1, `rgb(${Math.round(210 + r * 0.15)}, ${Math.round(210 + g * 0.15)}, ${Math.round(210 + b * 0.15)})`);
    }
  } else {
    if (scheme === 'dark') {
      grad.addColorStop(0, '#0a0a0a');
      grad.addColorStop(1, '#1a1a1a');
    } else {
      grad.addColorStop(0, '#f0f0f0');
      grad.addColorStop(1, '#e0e0e0');
    }
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ── Luminance detection ─────────────────────────────────────────────────────
// Sample the canvas after rendering. If >50% of sampled pixels are light,
// switch the page to dark text so content stays readable.

function measureLuminance(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  // Sample a sparse grid (every 50th pixel) for speed
  const step = 50;
  let total = 0;
  let count = 0;
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      // Relative luminance (ITU-R BT.709)
      const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      total += L;
      count++;
    }
  }
  return total / count / 255; // 0 = black, 1 = white
}

function applyLuminanceMode(luminance: number) {
  const root = document.documentElement;
  if (luminance > 0.5) {
    // Light background — use dark text
    root.style.setProperty('color-scheme', 'light');
    root.style.setProperty('--foreground', '#1a1a1a');
    root.style.setProperty('--foreground-muted', 'rgba(26, 26, 26, 0.65)');
    root.style.setProperty('--foreground-faint', 'rgba(26, 26, 26, 0.4)');
    root.style.setProperty('--card-foreground', '#1a1a1a');
    root.style.setProperty('--glass', 'rgba(0, 0, 0, 0.05)');
    root.style.setProperty('--glass-border', 'rgba(0, 0, 0, 0.12)');
    document.body.classList.add('bg-light');
    document.body.classList.remove('bg-dark');
  } else {
    // Dark background — use light text
    root.style.setProperty('color-scheme', 'dark');
    root.style.setProperty('--foreground', '#ffffff');
    root.style.setProperty('--foreground-muted', 'rgba(255, 255, 255, 0.55)');
    root.style.setProperty('--foreground-faint', 'rgba(255, 255, 255, 0.4)');
    root.style.setProperty('--card-foreground', '#ffffff');
    root.style.setProperty('--glass', 'rgba(255, 255, 255, 0.03)');
    root.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.1)');
    document.body.classList.add('bg-dark');
    document.body.classList.remove('bg-light');
  }
}

// ── Main render ─────────────────────────────────────────────────────────────

async function render(config: BgConfig) {
  const canvas = getOrCreateCanvas();
  sizeCanvas(canvas);
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const scheme = getColorScheme();

  const rand = mulberry32(config.seed);
  const palette = PALETTES[config.palette % PALETTES.length];

  fillBackground(ctx, w, h, scheme, palette);

  // Apply palette colors to page CSS vars + OAT theme overrides
  const root = document.documentElement;
  root.style.setProperty('--palette-primary', palette[0]);
  root.style.setProperty('--palette-secondary', palette[1]);
  root.style.setProperty('--palette-accent', palette[2]);

  // Drive OAT's theming so buttons, progress, links, etc. all respond
  root.style.setProperty('--primary', palette[1]);
  root.style.setProperty('--primary-foreground', '#fff');
  root.style.setProperty('--accent', palette[2]);
  root.style.setProperty('--ring', palette[2]);

  try {
    // All patterns use recolored src.svg — one image per palette color (3 total)
    const logos = await Promise.all(palette.map(c => getColoredLogo(c)));
    const renderer = PATTERN_RENDERERS[config.pattern];
    if (renderer) renderer(ctx, w, h, logos, palette, config.zoom, rand);
  } catch (e) {
    console.error(`[Background] Failed to load image for ${config.pattern}:`, e);
    // Gradient background still renders — just no pattern overlay
  }

  // Measure canvas luminance and flip text colors if background is light
  const luminance = measureLuminance(ctx, w, h);
  applyLuminanceMode(luminance);
  console.log(`[Background] ${config.type}/${config.pattern} rendered (luminance: ${luminance.toFixed(2)})`);
}

// ── Public API ──────────────────────────────────────────────────────────────

let currentConfig: BgConfig | null = null;

function makeConfig(type: BgType, pattern?: string): BgConfig {
  const seed = Math.floor(Math.random() * 2147483647);
  const zoom = 0.6 + Math.random() * 0.8;
  const paletteIdx = Math.floor(Math.random() * PALETTES.length);

  if (!pattern) {
    pattern = type === 'favicon'
      ? FAVICON_PATTERNS[Math.floor(Math.random() * FAVICON_PATTERNS.length)]
      : RETRO_PATTERNS[Math.floor(Math.random() * RETRO_PATTERNS.length)];
  }

  return { type, pattern, palette: paletteIdx, zoom, color: '', seed };
}

export async function set(mode: 'random' | 'favicon' | 'retro' = 'random') {
  // Try to restore from cookie on random mode
  const saved = loadConfig();
  if (saved && mode === 'random') {
    currentConfig = saved;
    await render(saved);
    return;
  }

  let type: BgType;
  if (mode === 'random') {
    type = Math.random() < 0.5 ? 'favicon' : 'retro';
  } else {
    type = mode;
  }

  currentConfig = makeConfig(type);
  saveConfig(currentConfig);
  await render(currentConfig);
}

/** Force a specific type + pattern combo (for dev cycling). Always generates new seed/palette. */
export async function setExact(type: BgType, pattern: string) {
  currentConfig = makeConfig(type, pattern);
  saveConfig(currentConfig);
  await render(currentConfig);
}

/** Cycle to the next pattern within the current type, or across all patterns. */
export async function cycle() {
  if (!currentConfig) {
    await set('random');
    return;
  }

  const allPatterns: { type: BgType; pattern: string }[] = [
    ...FAVICON_PATTERNS.map(p => ({ type: 'favicon' as BgType, pattern: p })),
    ...RETRO_PATTERNS.map(p => ({ type: 'retro' as BgType, pattern: p })),
  ];

  const idx = allPatterns.findIndex(
    e => e.type === currentConfig!.type && e.pattern === currentConfig!.pattern
  );
  const next = allPatterns[(idx + 1) % allPatterns.length];

  currentConfig = { ...makeConfig(next.type, next.pattern) };
  saveConfig(currentConfig);
  await render(currentConfig);
}

/** Redraw current config (e.g. after resize). */
export async function redraw() {
  if (currentConfig) await render(currentConfig);
}

/** Get current config (read-only). */
export function getConfig(): BgConfig | null {
  return currentConfig ? { ...currentConfig } : null;
}

/** Clear persisted cookie so next load picks fresh. */
export function clearConfig() {
  document.cookie = 'fh-bg-config=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  currentConfig = null;
}

// ── Resize handler ──────────────────────────────────────────────────────────

let resizeTimer: ReturnType<typeof setTimeout>;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (currentConfig) render(currentConfig); }, 150);
});

// Re-render on color scheme change
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (currentConfig) render(currentConfig);
});
