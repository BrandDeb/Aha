/**
 * The look of the studio, as data: one accent colour (any hex), a background
 * tone and a corner radius. Everything else (hover shade, text on the accent,
 * soft fills, editor syntax colours) is derived, and the accent is nudged until
 * it is readable on the background, so no choice produces an unreadable UI.
 * Pure functions, so they can be tested without a browser.
 */

export type Tone = 'neutral' | 'cool' | 'warm';
export type Radius = 'sharp' | 'default' | 'round';
export type Mode = 'dark' | 'light';

export interface Appearance {
  accent: string;
  tone: Tone;
  radius: Radius;
}

export const DEFAULT_APPEARANCE: Appearance = { accent: '#5aa2ff', tone: 'neutral', radius: 'default' };

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#5aa2ff' },
  { name: 'Violet', hex: '#9b8cff' },
  { name: 'Rose', hex: '#ff6b8b' },
  { name: 'Amber', hex: '#ffb454' },
  { name: 'Teal', hex: '#2dd4bf' },
  { name: 'Green', hex: '#34e88a' },
  { name: 'White', hex: '#f2f2f4' },
];

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

export type RGB = [number, number, number];

export const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

export function parseHex(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: RGB): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** WCAG relative luminance */
export function luminance([r, g, b]: RGB): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `amount` of `toward` mixed into `from` (0 = from, 1 = toward) */
export function mix(from: RGB, toward: RGB, amount: number): RGB {
  return [0, 1, 2].map((i) => from[i] + (toward[i] - from[i]) * amount) as RGB;
}

/** Move a colour toward white (dark UI) or black (light UI) until it reaches the contrast ratio on the background */
export function ensureContrast(color: RGB, background: RGB, minimum: number): RGB {
  const target: RGB = luminance(background) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  let result = color;
  for (let step = 0; step < 20 && contrast(result, background) < minimum; step++) result = mix(result, target, 0.08);
  return result;
}

function rotateHue([r, g, b]: RGB, degrees: number): RGB {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    h *= 60;
  }
  const hue = (((h + degrees) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Dark backgrounds per tone: page, bar, panel, raised */
const TONES: Record<Tone, [string, string, string, string]> = {
  neutral: ['#09090b', '#0c0c0f', '#0f0f12', '#141418'],
  cool: ['#080a0f', '#0b0e14', '#0e1118', '#131720'],
  warm: ['#0b0a09', '#0f0d0c', '#12100e', '#181513'],
};

const RADII: Record<Radius, [string, string, string, string]> = {
  sharp: ['0.125rem', '0.1875rem', '0.25rem', '0.375rem'],
  default: ['0.375rem', '0.5rem', '0.75rem', '1rem'],
  round: ['0.625rem', '0.875rem', '1.125rem', '1.5rem'],
};

const LIGHT_BACKGROUND: RGB = [246, 246, 245];

export interface AccentTokens {
  accent: string;
  hover: string;
  foreground: string;
  soft: string;
  line: string;
  ink: string;
}

/** The accent in the form the UI needs it, readable on the given mode's background */
export function accentTokens(hex: string, mode: Mode, tone: Tone = 'neutral'): AccentTokens {
  const source = parseHex(isHex(hex) ? hex : DEFAULT_APPEARANCE.accent);
  const background = mode === 'dark' ? parseHex(TONES[tone][0]) : LIGHT_BACKGROUND;
  const accent = ensureContrast(source, background, 4.5);
  const hover = mode === 'dark' ? mix(accent, [255, 255, 255], 0.25) : mix(accent, [0, 0, 0], 0.15);
  const foreground = contrast(accent, [8, 8, 10]) >= contrast(accent, [255, 255, 255]) ? '#08080a' : '#ffffff';
  const rgb = accent.map(Math.round).join(' ');
  return {
    accent: toHex(accent),
    hover: toHex(hover),
    foreground,
    soft: `rgb(${rgb} / ${mode === 'dark' ? 0.14 : 0.1})`,
    line: `rgb(${rgb} / 0.4)`,
    ink: rgb,
  };
}

/** CSS custom properties to set on <html> for this appearance and mode */
export function cssVariables(appearance: Appearance, mode: Mode): Record<string, string> {
  const tokens = accentTokens(appearance.accent, mode, appearance.tone);
  const [xs, sm, md, lg] = RADII[appearance.radius] ?? RADII.default;
  const vars: Record<string, string> = {
    '--color-accent': tokens.accent,
    '--color-accent-hover': tokens.hover,
    '--color-accent-fg': tokens.foreground,
    '--accent-soft': tokens.soft,
    '--accent-line': tokens.line,
    '--byte-ink': tokens.ink,
    '--r-xs': xs,
    '--r-sm': sm,
    '--r-md': md,
    '--r-lg': lg,
  };
  if (mode === 'dark') {
    const [page, bar, panel, raised] = TONES[appearance.tone] ?? TONES.neutral;
    vars['--color-black'] = page;
    vars['--bar'] = bar;
    vars['--panel'] = panel;
    vars['--raised'] = raised;
  }
  return vars;
}

/** Editor syntax colours that go with the accent: keywords take it, strings and numbers sit near it on the wheel */
export function syntaxColors(accentHex: string, mode: Mode): { keyword: string; string: string; number: string } {
  const accent = parseHex(accentTokens(accentHex, mode).accent);
  const background = mode === 'dark' ? parseHex(TONES.neutral[0]) : LIGHT_BACKGROUND;
  const neutral: RGB = mode === 'dark' ? [212, 212, 217] : [38, 38, 42];
  return {
    keyword: toHex(accent),
    string: toHex(ensureContrast(mix(accent, neutral, 0.45), background, 4.5)),
    number: toHex(ensureContrast(rotateHue(mix(accent, neutral, 0.2), 150), background, 4.5)),
  };
}

/** Accept whatever was stored and return a usable appearance */
export function normalizeAppearance(value: Partial<Appearance> | undefined | null): Appearance {
  const tones: Tone[] = ['neutral', 'cool', 'warm'];
  const radii: Radius[] = ['sharp', 'default', 'round'];
  return {
    accent: isHex(value?.accent) ? value.accent.toLowerCase() : DEFAULT_APPEARANCE.accent,
    tone: tones.includes(value?.tone as Tone) ? (value!.tone as Tone) : DEFAULT_APPEARANCE.tone,
    radius: radii.includes(value?.radius as Radius) ? (value!.radius as Radius) : DEFAULT_APPEARANCE.radius,
  };
}
