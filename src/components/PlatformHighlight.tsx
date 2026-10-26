'use client';

import { useEffect } from 'react';
import { detectPlatform } from '@/lib/downloads';

/** Marks the download card for the visitor's system (the server can't know it, so the page renders neutral) */
export function PlatformHighlight() {
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const mine = detectPlatform(nav.userAgent, nav.userAgentData?.platform ?? '');
    if (!mine) return;
    const card = document.querySelector<HTMLElement>(`[data-platform="${mine}"]`);
    if (!card) return;
    card.dataset.mine = 'true';
    card.querySelector<HTMLElement>('[data-mine-label]')?.setAttribute('data-mine', 'true');
  }, []);
  return null;
}
