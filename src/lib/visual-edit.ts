/**
 * Click-to-edit for the in-browser preview: pick an element in the running app and the studio finds the code
 * that drew it, lets you change its text or classes right there (the edit is made in the source, so the code
 * stays the truth), or hands the agent the element and its code to change anything else.
 *
 * Finding the code: JSX (React, Preact) is bundled with a runtime that stamps every page element with
 * data-nano-src="file:line:column", so a pick is exact. Vue, Svelte and plain HTML fall back to looking for the
 * element's text and classes in the project's files. Pure, so it is tested directly.
 */

/** What the preview reports about the element you picked */
export interface PickedElement {
  /** "src/App.tsx:12:7" when the element came from JSX */
  src: string | null;
  tag: string;
  /** Its visible text, trimmed and cut short */
  text: string;
  /** Its class attribute, as rendered */
  classes: string;
  /** The start of its rendered HTML */
  html: string;
  /** data-nano-src of the elements around it, innermost first: the component it sits in */
  chain?: string[];
}

export interface ElementLocation {
  file: string;
  line: number;
  column: number;
  /** From the JSX stamp (true) or a search for its text (false) */
  exact: boolean;
}

/** The attribute the JSX runtime adds; a project's own data-nano-src would be overwritten, which is fine */
export const SRC_ATTR = 'data-nano-src';

/** "src/App.tsx:12:7" → its parts, when that file exists */
export function parseSrc(src: string | null | undefined, files: Record<string, string>): ElementLocation | null {
  const m = src?.match(/^(.+):(\d+):(\d+)$/);
  if (!m) return null;
  // The bundler may prefix its namespace: "project:src/App.tsx"
  const file = m[1] in files ? m[1] : m[1].replace(/^[\w-]+:/, '');
  if (!(file in files)) return null;
  return { file, line: Number(m[2]), column: Number(m[3]), exact: true };
}

const MARKUP = /\.(tsx|jsx|vue|svelte|html|astro|js|ts)$/;

/** Offset of a 1-based line and column */
export function offsetOf(source: string, line: number, column: number): number {
  let at = 0;
  for (let l = 1; l < line; l++) {
    const next = source.indexOf('\n', at);
    if (next < 0) return source.length;
    at = next + 1;
  }
  return Math.min(source.length, at + Math.max(0, column - 1));
}

/** 1-based line and column of an offset */
export function positionOf(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

/**
 * Where an element is in the code: its JSX stamp, or else the best place its text (or classes) appear, in a
 * file that holds markup. Null when nothing matches well enough to be useful.
 */
export function locateElement(files: Record<string, string>, el: PickedElement): ElementLocation | null {
  const exact = parseSrc(el.src, files);
  if (exact) return exact;
  const text = el.text.trim().split('\n')[0].trim().slice(0, 80);
  const classes = el.classes.trim();
  let best: { score: number; loc: ElementLocation } | null = null;
  for (const [file, source] of Object.entries(files)) {
    if (!MARKUP.test(file) || file.includes('node_modules/')) continue;
    const tries: { needle: string; score: number }[] = [];
    if (text.length >= 2) tries.push({ needle: `>${text}<`, score: 6 }, { needle: text, score: 3 });
    if (classes) tries.push({ needle: `"${classes}"`, score: 4 });
    for (const t of tries) {
      const at = source.indexOf(t.needle);
      if (at < 0) continue;
      // Back up to the tag that holds it
      const open = source.lastIndexOf(`<${el.tag}`, at);
      const start = open >= 0 && at - open < 600 ? open : at;
      const bonus = open >= 0 && at - open < 600 ? 2 : 0;
      // Markup files beat scripts that only mention the text
      const kind = /\.(tsx|jsx|vue|svelte|html|astro)$/.test(file) ? 1 : 0;
      const score = t.score + bonus + kind;
      if (!best || score > best.score) best = { score, loc: { file, ...positionOf(source, start), exact: false } };
    }
  }
  return best && best.score >= 4 ? best.loc : null;
}

/** The opening tag that starts at (or just after) an offset: "<button className="x" onClick={…}>" */
export function openingTag(source: string, offset: number): { start: number; end: number; name: string; selfClosing: boolean } | null {
  const start = source.indexOf('<', offset);
  if (start < 0 || start - offset > 2) return null;
  const name = source.slice(start + 1).match(/^[\w.:-]+/)?.[0];
  if (!name) return null;
  let i = start + 1 + name.length;
  let depth = 0;
  let quote: string | null = null;
  for (; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote && source[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return { start, end: i + 1, name, selfClosing: source[i - 1] === '/' };
  }
  return null;
}

/** The element's class attribute, when it is a plain string the studio can rewrite */
export function classAttr(source: string, tag: { start: number; end: number }): { name: string; value: string; start: number; end: number } | null {
  const text = source.slice(tag.start, tag.end);
  const m = text.match(/\s(className|class)=(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\})/);
  if (!m || m.index === undefined) return null;
  const value = m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? '';
  // The value's own span inside the source
  const valueAt = text.indexOf(value, m.index + m[1].length + 1);
  return { name: m[1], value, start: tag.start + valueAt, end: tag.start + valueAt + value.length };
}

/** The element's text when it is written literally in the code: "Save" in <button>Save</button> */
export function literalText(source: string, tag: { end: number; name: string; selfClosing: boolean }): { value: string; start: number; end: number } | null {
  if (tag.selfClosing) return null;
  // Up to the first child element or expression: "Count: " in <p>Count: {n}</p>
  const next = source.slice(tag.end).search(/[<{]/);
  const stop = next < 0 ? source.length : tag.end + next;
  const raw = source.slice(tag.end, stop);
  const value = raw.trim();
  if (!value) return null;
  const lead = raw.length - raw.trimStart().length;
  return { value, start: tag.end + lead, end: tag.end + lead + value.length };
}

/** What can be edited in place for the element at a location: its text and its classes, when they're literal */
export function editableAt(source: string, loc: Pick<ElementLocation, 'line' | 'column'>): { tag: string; text: string | null; classes: string | null } | null {
  const tag = openingTag(source, offsetOf(source, loc.line, loc.column));
  if (!tag) return null;
  return { tag: tag.name, text: literalText(source, tag)?.value ?? null, classes: classAttr(source, tag)?.value ?? null };
}

/** Change the element's literal text or classes in its source; null when that part isn't a literal */
export function applyEdit(source: string, loc: Pick<ElementLocation, 'line' | 'column'>, edit: { text?: string; classes?: string }): string | null {
  const tag = openingTag(source, offsetOf(source, loc.line, loc.column));
  if (!tag) return null;
  // Text comes after the tag and classes inside it: change the later span first so the earlier one's offsets hold
  let out = source;
  if (edit.text !== undefined) {
    const span = literalText(source, tag);
    if (!span) return null;
    // JSX text can't hold { } < > unescaped
    const safe = edit.text.replace(/[{}<>]/g, (c) => `{'${c}'}`);
    out = out.slice(0, span.start) + safe + out.slice(span.end);
  }
  if (edit.classes !== undefined) {
    const span = classAttr(source, tag);
    if (!span) return null;
    out = out.slice(0, span.start) + edit.classes.replace(/["'`]/g, '') + out.slice(span.end);
  }
  return out;
}

/** The request the agent gets for "change this element" */
export function visualEditPrompt(el: PickedElement, loc: ElementLocation | null, request: string, source?: string): string {
  const where = loc ? `${loc.file}:${loc.line}${loc.exact ? '' : ' (found by its text, so check it is the right one)'}` : 'not found in the code; search for it';
  const lines = source && loc ? source.split('\n') : [];
  const snippet = loc && lines.length ? lines.slice(Math.max(0, loc.line - 4), loc.line + 8).map((l, i) => `${Math.max(1, loc.line - 3) + i}| ${l}`).join('\n') : '';
  return [
    `In the running app I picked this element: <${el.tag}>${el.text ? ` with the text "${el.text.slice(0, 120)}"` : ''}${el.classes ? ` and classes "${el.classes}"` : ''}.`,
    `It is drawn by ${where}.`,
    el.chain?.length ? `It sits inside: ${el.chain.slice(0, 4).join(' → ')}.` : '',
    snippet ? `The code there:\n\`\`\`\n${snippet}\n\`\`\`` : `Its HTML: ${el.html.slice(0, 400)}`,
    `Change: ${request.trim()}`,
    'Change only what that asks for, in the code that draws this element (or the component and styles it uses), and keep the rest of the page as it is.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The picker that runs in the app's page: hover outlines an element and shows its tag, a click picks it (the
 * click never reaches the app) and Escape stops. Plain ES5 text, injected before the app's own code.
 */
export const PICKER_PRELUDE = `(function () {
  var on = false, box = null, label = null;
  var srcOf = function (el) { var s = el.closest && el.closest('[${SRC_ATTR}]'); return s ? s.getAttribute('${SRC_ATTR}') : null; };
  var ensure = function () {
    if (box) return;
    box = document.createElement('div');
    box.setAttribute('style', 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4c9dff;background:rgba(76,157,255,.12);border-radius:3px;transition:all .06s');
    label = document.createElement('div');
    label.setAttribute('style', 'position:fixed;z-index:2147483647;pointer-events:none;font:11px/1.6 ui-monospace,monospace;background:#4c9dff;color:#fff;padding:0 5px;border-radius:3px');
  };
  var show = function (el) {
    ensure();
    var r = el.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    var src = srcOf(el);
    label.textContent = el.tagName.toLowerCase() + (src ? '  ' + src.split('/').pop() : '');
    label.style.left = r.left + 'px'; label.style.top = Math.max(0, r.top - 18) + 'px';
    if (!box.parentNode) { document.documentElement.appendChild(box); document.documentElement.appendChild(label); }
  };
  var hide = function () { if (box && box.parentNode) { box.remove(); label.remove(); } };
  var set = function (value) { on = value; document.documentElement.style.cursor = on ? 'crosshair' : ''; if (!on) hide(); };
  addEventListener('mousemove', function (e) { if (on && e.target && e.target.nodeType === 1) show(e.target); }, true);
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(function (t) { addEventListener(t, function (e) { if (on) { e.preventDefault(); e.stopPropagation(); } }, true); });
  addEventListener('click', function (e) {
    if (!on) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target, chain = [], p = el.parentElement;
    while (p && chain.length < 6) { var s = p.getAttribute('${SRC_ATTR}'); if (s && chain.indexOf(s) < 0) chain.push(s); p = p.parentElement; }
    var own = el.getAttribute('${SRC_ATTR}');
    parent.postMessage({ source: 'aha-app', type: 'picked', element: {
      src: own || srcOf(el), tag: el.tagName.toLowerCase(), text: String(el.innerText || el.textContent || '').trim().slice(0, 300),
      classes: String(el.getAttribute('class') || ''), html: el.outerHTML.slice(0, 800), chain: chain
    } }, '*');
    set(false);
  }, true);
  addEventListener('keydown', function (e) { if (on && e.key === 'Escape') { set(false); parent.postMessage({ source: 'aha-app', type: 'pick-cancelled' }, '*'); } }, true);
  addEventListener('message', function (e) { if (e.source === parent && e.data && e.data.source === 'aha-preview' && e.data.type === 'pick') set(!!e.data.on); });
})();`;

/**
 * The module that replaces the JSX dev runtime in the preview: the framework's own, plus the source stamp.
 * Self-contained (the preview frame embeds its source), so the attribute name is written out.
 */
export function jsxStampModule(runtimeUrl: string): string {
  return `import * as rt from ${JSON.stringify(runtimeUrl)};
export const Fragment = rt.Fragment;
export function jsxDEV(type, props, key, isStatic, source, self) {
  if (typeof type === 'string' && source && props) props = Object.assign({}, props, { 'data-nano-src': source.fileName + ':' + source.lineNumber + ':' + source.columnNumber });
  return rt.jsxDEV(type, props, key, isStatic, source, self);
}`;
}
