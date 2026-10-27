'use client';

import { useEffect, useState } from 'react';
import type { PhoneState } from '../devserver-client';

/** A QR code as one SVG path, drawn from the encoder's grid of modules */
function QrCode({ text, size = 168 }: { text: string; size?: number }) {
  const [path, setPath] = useState<{ d: string; n: number } | null>(null);
  useEffect(() => {
    let live = true;
    // The encoder loads with the card, not with the studio
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
      if (live) setPath({ d, n: n + 4 });
    });
    return () => {
      live = false;
    };
  }, [text]);
  if (!path) return <div style={{ width: size, height: size }} className="animate-pulse rounded-md bg-white/[0.06]" />;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${path.n} ${path.n}`} shapeRendering="crispEdges" role="img" aria-label="QR code for the phone preview" className="rounded-md">
      <rect width={path.n} height={path.n} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Phone preview: scan to open the running app on a phone on the same network */
export function PhoneCard({ phone, error, onOpen, onClose, onDismiss }: { phone: PhoneState | null; error: string | null; onOpen: () => void; onClose: () => void; onDismiss: () => void }) {
  return (
    <div role="dialog" aria-label="Phone preview" className="absolute right-2 top-12 z-20 w-72 space-y-2.5 rounded-xl border border-border-strong bg-[var(--panel)] p-3 shadow-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-gray-100">Open on your phone</h3>
        <button onClick={onDismiss} className="text-gray-500 hover:text-gray-100" aria-label="Close">✕</button>
      </div>
      {phone ? (
        <>
          <div className="flex justify-center">
            <QrCode text={phone.url} />
          </div>
          <p className="text-[11px] leading-relaxed text-gray-400">
            Scan it with the camera of a phone on the same Wi-Fi. Edits reload there too. Anyone on your network needs this code to get in; it stops at {clock(phone.expiresAt)} if unused, or when you stop it.
          </p>
          <input readOnly value={phone.url} aria-label="Phone preview link" onFocus={(e) => e.currentTarget.select()} className="input h-7 w-full font-mono text-[11px]" />
          {phone.others.length > 0 && (
            <details className="text-[11px] text-gray-500">
              <summary className="cursor-pointer">Phone can’t reach it?</summary>
              <p className="mt-1">This machine has other addresses; try one on the phone’s network:</p>
              <ul className="mt-1 space-y-0.5 font-mono">{phone.others.map((u) => <li key={u} className="break-all">{u}</li>)}</ul>
            </details>
          )}
          <button onClick={onClose} className="btn btn-secondary btn-sm w-full">Stop sharing</button>
        </>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-gray-400">
            Shows the running app on a phone on the same Wi-Fi, with hot reload. The dev server stays private to this machine; a separate link with a random key opens it for the phone, until you stop it or it goes unused for 30 minutes.
          </p>
          {error && <p className="text-[11px] text-danger" role="alert">{error}</p>}
          <button onClick={onOpen} className="btn btn-primary btn-sm w-full">Show the QR code</button>
        </>
      )}
    </div>
  );
}
