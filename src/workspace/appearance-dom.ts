'use client';

import { setEditorAccent } from '@/components/CodeEditor';
import { cssVariables, type Appearance, type Mode } from './appearance';

const VARS_KEY = 'nanocli:appearance-vars';
const TONE_VARS = ['--color-black', '--bar', '--panel', '--raised'];

/**
 * Put the appearance on <html> as CSS variables. Both modes' values are saved
 * so the pre-paint script in the layout can restore them before first paint.
 */
export function applyAppearance(appearance: Appearance, mode: Mode): void {
  const root = document.documentElement;
  const vars = cssVariables(appearance, mode);
  for (const name of TONE_VARS) if (!(name in vars)) root.style.removeProperty(name); // light mode uses the stylesheet's
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  try {
    localStorage.setItem(VARS_KEY, JSON.stringify({ dark: cssVariables(appearance, 'dark'), light: cssVariables(appearance, 'light') }));
  } catch {
    // storage blocked: the look is applied for this session only
  }
  setEditorAccent(appearance.accent);
}
