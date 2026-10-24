'use client';

import { CrashScreen } from '@/components/CrashScreen';

/** A page crashed: explain, offer recovery, and keep the project safe */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashScreen error={error} retry={reset} />;
}
