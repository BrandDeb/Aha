/**
 * Build from a picture: a screenshot of an app you like, a mock-up, or a sketch on paper becomes the brief.
 * The image goes to the model with the request (it has to be one that reads images), and the brief tells the
 * agent how to read it: a sketch is a layout to interpret, a screenshot a design to match. Pure helpers.
 */

import type { ImageInput } from './agent/types.ts';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** Providers cap images around 5 MB; larger ones are scaled down in the browser before they get here */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A data: URL as an image to send, or why it can't be */
export function imageFromDataUrl(url: string): ImageInput | { error: string } {
  const m = url.match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: 'That is not an image.' };
  if (!(IMAGE_TYPES as readonly string[]).includes(m[1])) return { error: 'Use a PNG, JPEG, WebP or GIF image.' };
  const bytes = Math.floor((m[2].length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) return { error: `The image is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB.` };
  return { mediaType: m[1], data: m[2] };
}

export type PictureKind = 'screenshot' | 'sketch';

/** The brief for building from a picture, on top of the plan's own brief */
export function pictureBrief(kind: PictureKind, note: string, planBrief: string): string {
  const how =
    kind === 'sketch'
      ? `The attached image is a hand-drawn sketch or wireframe. Read it as a layout: boxes are sections or cards, scribbles are text, circles and squares with words are buttons and inputs, arrows are navigation. Turn it into a clean, finished, working app in that layout; choose a tasteful modern style yourself, since the sketch only fixes the structure.`
      : `The attached image is a screenshot or mock-up of the app to build. Match it closely: the layout and its proportions, the visual hierarchy, colours, typography (closest web font), spacing, corner radii and shadows, and every visible piece of text. Use realistic placeholder data where it shows data.`;
  return `${how}

Make it real, not a picture of an app: every button, link, input and tab you can see should work (local state is fine where there is no backend), the layout should hold up on a phone, and it should build and run.${note.trim() ? `\n\nAlso: ${note.trim()}` : ''}

${planBrief}`;
}

/** What to plan from when a picture comes with little or no text */
export function pictureRequest(kind: PictureKind, note: string): string {
  const text = note.trim();
  if (text.length >= 6) return text;
  return kind === 'sketch' ? 'A web app from my sketch' : 'A web app from my screenshot';
}
