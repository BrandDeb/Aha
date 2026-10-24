import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCENT_PRESETS, DEFAULT_APPEARANCE, accentTokens, contrast, cssVariables, isHex, normalizeAppearance, parseHex, syntaxColors } from '../src/workspace/appearance.ts';

test('every preset is readable as text on the dark and light backgrounds', () => {
  for (const { name, hex } of ACCENT_PRESETS) {
    for (const [mode, bg] of [['dark', '#09090b'], ['light', '#f6f6f5']] as const) {
      const tokens = accentTokens(hex, mode);
      assert.ok(contrast(parseHex(tokens.accent), parseHex(bg)) >= 4.5, `${name} on ${mode}`);
    }
  }
});

test('any colour, even a hostile one, ends up readable and the button text is legible on it', () => {
  for (const hex of ['#000000', '#ffffff', '#101010', '#0000ff', '#ffff00', '#7f7f7f']) {
    for (const mode of ['dark', 'light'] as const) {
      const t = accentTokens(hex, mode);
      assert.ok(contrast(parseHex(t.accent), parseHex(mode === 'dark' ? '#09090b' : '#f6f6f5')) >= 4.5, `${hex} ${mode}`);
      assert.ok(contrast(parseHex(t.accent), parseHex(t.foreground)) >= 4.5, `${hex} ${mode} foreground`);
    }
  }
});

test('isHex and normalizeAppearance accept only usable values', () => {
  assert.ok(isHex('#12abEF'));
  for (const bad of ['12abef', '#12ab', '#12abzz', 'red', '', null, undefined, 5]) assert.ok(!isHex(bad), String(bad));
  assert.deepEqual(normalizeAppearance(undefined), DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({ accent: 'nope', tone: 'x' as never, radius: 'y' as never }), DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({ accent: '#ABCDEF', tone: 'warm', radius: 'round' }), { accent: '#abcdef', tone: 'warm', radius: 'round' });
});

test('cssVariables sets backgrounds only in dark mode, and radii always', () => {
  const dark = cssVariables({ ...DEFAULT_APPEARANCE, tone: 'warm', radius: 'sharp' }, 'dark');
  const light = cssVariables(DEFAULT_APPEARANCE, 'light');
  for (const key of ['--color-accent', '--color-accent-hover', '--color-accent-fg', '--accent-soft', '--accent-line', '--byte-ink', '--r-xs', '--r-sm', '--r-md', '--r-lg']) {
    assert.ok(key in dark && key in light, key);
  }
  assert.equal(dark['--color-black'], '#0b0a09');
  assert.equal(dark['--r-sm'], '0.1875rem');
  assert.ok(!('--color-black' in light) && !('--panel' in light));
});

test('syntax colours are readable on the editor background', () => {
  for (const { hex } of ACCENT_PRESETS) {
    for (const [mode, bg] of [['dark', '#09090b'], ['light', '#f6f6f5']] as const) {
      const s = syntaxColors(hex, mode);
      for (const colour of [s.keyword, s.string, s.number]) assert.ok(contrast(parseHex(colour), parseHex(bg)) >= 4.5, `${hex} ${mode} ${colour}`);
    }
  }
});
