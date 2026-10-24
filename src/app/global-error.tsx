'use client';

import { CrashScreen } from '@/components/CrashScreen';

/** The root layout itself crashed, so there is no stylesheet: the screen carries its own basic styles */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <CrashScreen error={error} retry={reset} standalone />
      </body>
    </html>
  );
}
