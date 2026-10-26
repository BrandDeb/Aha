/**
 * The desktop downloads: one entry per platform, with a stable file name in a
 * GitHub release that CI keeps current (.github/workflows/desktop.yml publishes
 * every build to the `desktop-latest` release, and version tags to their own).
 * The download page reads the release once an hour for sizes and build dates;
 * without it (offline, rate-limited, not published yet) the links still work.
 */

export const DOWNLOADS_REPO = process.env.NEXT_PUBLIC_DOWNLOADS_REPO || 'BrandDeb/Aha';
export const DOWNLOADS_TAG = 'desktop-latest';

export type PlatformId = 'mac' | 'windows' | 'linux';

export interface Platform {
  id: PlatformId;
  name: string;
  /** Who it is for, in one line */
  requirement: string;
  /** File name in the release; null when there is no installer for this platform yet */
  file: string | null;
  kind: string;
  /** What to do after downloading */
  steps: string[];
  /** The first-launch prompt an unsigned build gets, and how to get past it */
  unsigned?: string;
}

export const PLATFORMS: Platform[] = [
  {
    id: 'mac',
    name: 'macOS',
    requirement: 'Apple silicon (M1 or later), macOS 11 Big Sur or newer',
    file: 'Aha-macOS-arm64.dmg',
    kind: 'Disk image (.dmg)',
    steps: ['Open the downloaded .dmg.', 'Drag Aha! to Applications (don’t open it from the disk image).', 'Open it from Applications. The first start takes a few seconds while the studio starts.'],
    unsigned: 'This build isn’t notarized by Apple yet, so the first time macOS says it can’t verify it. Choose Done, then open System Settings → Privacy & Security, scroll down and choose Open Anyway (once). On older macOS: right-click the app and choose Open. If it says the app is damaged, that copy came from an older build: run xattr -cr "/Applications/Aha.app" in Terminal, or download it again.',
  },
  {
    id: 'windows',
    name: 'Windows',
    requirement: 'Windows 10 or 11, 64-bit (x64)',
    file: 'Aha-Windows-x64-setup.exe',
    kind: 'Installer (.exe)',
    steps: ['Run the downloaded installer.', 'It installs for your user account (no administrator rights needed) and adds a Start menu entry.', 'Open Aha! from the Start menu.'],
    unsigned: 'This build isn’t code-signed yet, so SmartScreen may say “Windows protected your PC”. Click More info, then Run anyway.',
  },
  {
    id: 'linux',
    name: 'Linux',
    requirement: 'Any distribution with Node.js 24, or Docker',
    file: null,
    kind: 'Run from source',
    steps: ['git clone https://github.com/' + (process.env.NEXT_PUBLIC_DOWNLOADS_REPO || 'BrandDeb/Aha') + '.git', 'cd Aha && npm ci && npm run build', 'npm start, then open http://localhost:3000'],
  },
];

export const releaseUrl = (repo = DOWNLOADS_REPO, tag = DOWNLOADS_TAG) => `https://github.com/${repo}/releases/tag/${tag}`;
/** Where the builds run, for when a file isn't published yet */
export const buildsUrl = (repo = DOWNLOADS_REPO) => `https://github.com/${repo}/actions/workflows/desktop.yml`;
export const downloadUrl = (file: string, repo = DOWNLOADS_REPO, tag = DOWNLOADS_TAG) => `https://github.com/${repo}/releases/download/${tag}/${file}`;

/** The platform a browser runs on, from its user agent (Apple silicon and Intel Macs look the same) */
export function detectPlatform(userAgent: string, platform = ''): PlatformId | null {
  const text = `${platform} ${userAgent}`;
  if (/iPhone|iPad|iPod|Android/i.test(text)) return null;
  if (/Mac/i.test(text)) return 'mac';
  if (/Win/i.test(text)) return 'windows';
  if (/Linux|X11|CrOS/i.test(text)) return 'linux';
  return null;
}

export interface ReleaseInfo {
  /** When the release was last built */
  updatedAt: string | null;
  /** The commit it was built from, when the notes say so */
  commit: string | null;
  assets: Record<string, { size: number; url: string; updatedAt: string }>;
}

interface GitHubRelease {
  published_at?: string;
  body?: string | null;
  assets?: { name: string; size: number; browser_download_url: string; updated_at: string }[];
}

/** Pure: the parts of a GitHub release the page shows */
export function releaseInfo(release: GitHubRelease): ReleaseInfo {
  const assets: ReleaseInfo['assets'] = {};
  let latest: string | null = null;
  for (const a of release.assets ?? []) {
    assets[a.name] = { size: a.size, url: a.browser_download_url, updatedAt: a.updated_at };
    if (!latest || a.updated_at > latest) latest = a.updated_at;
  }
  const commit = /\b([0-9a-f]{7,40})\b/.exec(release.body ?? '')?.[1]?.slice(0, 7) ?? null;
  return { updatedAt: latest ?? release.published_at ?? null, commit, assets };
}

/**
 * The release, refreshed at most every 10 minutes: 'missing' when GitHub says it doesn't exist yet (the page
 * then says the files are being built instead of linking to a 404), null when it can't be read (offline,
 * rate-limited: the links are shown and most likely work)
 */
export async function fetchRelease(repo = DOWNLOADS_REPO, tag = DOWNLOADS_TAG): Promise<ReleaseInfo | 'missing' | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 404) return 'missing';
    if (!response.ok) return null;
    return releaseInfo((await response.json()) as GitHubRelease);
  } catch {
    return null;
  }
}

export const formatSize = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);
