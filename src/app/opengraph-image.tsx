import { ImageResponse } from 'next/og';
import { SITE } from '@/lib/site';

export const alt = `${SITE.name}: ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The card shown when a link to the site is shared (and the default for every page) */
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: 'radial-gradient(circle at 80% 10%, #1e3a8a 0%, #000 55%)', color: '#f3f4f6', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 34, letterSpacing: 6, color: '#9ca3af' }}>
          <div style={{ display: 'flex', width: 56, height: 56, borderRadius: 14, background: '#111827', border: '2px solid #3b82f6', alignItems: 'center', justifyContent: 'center', color: '#3b82f6', fontSize: 30 }}>{'>_'}</div>
          AHA!
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{SITE.tagline}</div>
          <div style={{ fontSize: 30, color: '#9ca3af', lineHeight: 1.4 }}>Describe an app or write it yourself in 40+ languages. Every change arrives with the diff and proof it builds and runs.</div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 24, color: '#60a5fa' }}>
          <span>Live values</span>
          <span style={{ color: '#4b5563' }}>·</span>
          <span>Stack builder</span>
          <span style={{ color: '#4b5563' }}>·</span>
          <span>Second reviewer</span>
          <span style={{ color: '#4b5563' }}>·</span>
          <span>Your own model</span>
        </div>
      </div>
    ),
    size,
  );
}
