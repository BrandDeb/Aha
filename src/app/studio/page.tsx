import { redirect } from 'next/navigation';

/**
 * The studio's multi-file explorer, terminal and Git tools now live in the
 * workspace at /. Keep old links working.
 */
export default function StudioPage() {
  redirect('/');
}
