/**
 * Runs once when the server starts: keep the toolchains the studio installed
 * up to date (checked soon after start and every 12 hours), but only where the
 * studio runs programs at all, which is on your own machine.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { isRunEnabled } = await import('./lib/polyglot');
  if (!isRunEnabled()) return;
  const { scheduleToolchainUpdates } = await import('./lib/toolchains');
  scheduleToolchainUpdates();
}
