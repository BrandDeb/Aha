'use client';

import { useEffect, useRef } from 'react';
import { BYTE_SAMPLE_BASE64 } from '@/lib/byte-sample';

/**
 * The bytes of a real scriptc executable, drawn as a full-screen hexdump
 * behind the glass. A scan band sweeps down like a compiler pass,
 * brightening the bytes it crosses. Static when reduced motion is preferred.
 */
export function ByteField({ intensity = 'ambient' }: { intensity?: 'ambient' | 'hero' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const bytes = Uint8Array.from(atob(BYTE_SAMPLE_BASE64), (c) => c.charCodeAt(0));
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const base = intensity === 'hero' ? 0.075 : 0.06;
    const peak = intensity === 'hero' ? 0.38 : 0.26;
    const fontSize = 13;
    const lineHeight = 22;
    const cell = 24; // width of one "xx " byte column
    const gutter = 92; // offset column

    let ink = '255 255 255';
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let scan = -200;

    const readInk = () => {
      ink = getComputedStyle(document.documentElement).getPropertyValue('--byte-ink').trim() || '255 255 255';
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${fontSize}px ${getComputedStyle(document.body).getPropertyValue('--font-plex-mono') || 'monospace'}, monospace`;
      ctx.textBaseline = 'middle';
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const columns = Math.max(4, Math.floor((width - gutter - 16) / cell));
      const rows = Math.ceil(height / lineHeight) + 1;
      const band = 140;

      for (let row = 0; row < rows; row++) {
        const y = row * lineHeight + lineHeight / 2;
        const distance = Math.abs(y - scan);
        const lift = reduceMotion ? 0 : Math.max(0, 1 - distance / band);
        const alpha = base + (peak - base) * lift * lift;

        ctx.fillStyle = `rgb(${ink} / ${(alpha * 0.7).toFixed(3)})`;
        ctx.fillText((row * columns).toString(16).padStart(8, '0'), 16, y);

        ctx.fillStyle = `rgb(${ink} / ${alpha.toFixed(3)})`;
        for (let col = 0; col < columns; col++) {
          ctx.fillText(hex[(row * columns + col) % hex.length], gutter + col * cell, y);
        }
      }
    };

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (time - last < 33) return; // ~30 fps is plenty for an ambient sweep
      const delta = last ? time - last : 16;
      last = time;
      scan += delta * 0.06;
      if (scan > height + 300) scan = -300;
      draw();
    };

    const onVisibility = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (!document.hidden && !reduceMotion) frame = requestAnimationFrame(tick);
    };

    readInk();
    resize();
    const observer = new MutationObserver(() => {
      readInk();
      draw();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (!reduceMotion) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 select-none"
    />
  );
}
