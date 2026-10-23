'use client';

/**
 * Create: the one place to start something. Describe what you want and get a
 * plan with reasons; pick an app from the gallery in the language that suits
 * it; build a stack choice by choice; or start from a template or a field
 * kit. Whatever you pick becomes a real project (every dependency listed and
 * wired in), and the agent can build the rest from a brief while you watch —
 * or you write it yourself.
 */

import { useMemo, useRef, useState } from 'react';
import { AUDIENCE_LABEL, KIT_LIBRARY } from '@/lib/kit-library';
import { parseBundle, type Kit } from '@/lib/kits';
import { getLanguage } from '@/lib/languages';
import { GALLERY, GALLERY_CATEGORIES, type GalleryApp, type GalleryCategory, type GallerySource } from '@/lib/gallery';
import { planApp, PLAN_EXAMPLES } from '@/lib/planner';
import { buildStack, CATEGORY_LABEL, DEFAULT_STACK, FRAMEWORKS, librariesByCategory, PY_FRAMEWORKS, resolveStack, STYLINGS, unavailable, type StackChoice } from '@/lib/stack';
import { TEMPLATES, templateFiles, type Template } from '@/lib/templates';
import { useActions } from '../actions';
import { useAiConfig } from '../ai-config';
import { kitProject } from '../kits-client';
import { useProposals } from '../proposals';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';
import { Dialog } from './Dialog';
import { Check, Sparkle } from './Icons';

export type CreateTab = 'describe' | 'gallery' | 'stack' | 'templates' | 'kits';
type TemplateFilter = 'all' | 'typescript' | 'web' | 'apps' | 'python' | 'other';

const TABS: { id: CreateTab; label: string; hint: string }[] = [
  { id: 'describe', label: 'Describe it', hint: 'Say what you want; get a plan' },
  { id: 'gallery', label: 'Gallery', hint: 'Apps, each on the stack that suits it' },
  { id: 'stack', label: 'Stack builder', hint: 'Pick framework, styling, libraries' },
  { id: 'templates', label: 'Templates', hint: 'Starters in 70+ languages' },
  { id: 'kits', label: 'Field kits', hint: 'Projects with playbooks and checks' },
];

/** Files, entry and a display name for a gallery or planner source */
function materialize(source: GallerySource, name?: string): { files: Record<string, string>; entry: string; label: string; name: string } | null {
  if ('template' in source) {
    const t = TEMPLATES.find((x) => x.id === source.template);
    if (!t) return null;
    return { ...templateFiles(t), label: t.name, name: name ?? t.id };
  }
  const built = buildStack(name ? { ...source.stack, name } : source.stack);
  return { files: built.files, entry: built.entry, label: built.summary, name: built.choice.name };
}

export function CreateDialog({ onClose, initial = 'describe', templateFilter = 'all', onNeedModel }: { onClose: () => void; initial?: CreateTab; templateFilter?: TemplateFilter; onNeedModel: () => void }) {
  const { project, dispatch, saveSnapshot } = useWorkspace();
  const { notify } = useToast();
  const { ask } = useProposals();
  const config = useAiConfig();
  const [tab, setTab] = useState<CreateTab>(initial);
  const [stackSeed, setStackSeed] = useState<StackChoice | null>(null);
  const hasModel = !!config.provider && (!!config.keys[config.provider]?.trim() || ['ollama', 'lmstudio', 'hosted'].includes(config.provider));

  /** Replace the project (the old one goes to History), then optionally hand the agent the brief */
  const create = (files: Record<string, string>, entry: string, name: string, label: string, brief?: string) => {
    saveSnapshot(`Before new project: ${name}`);
    dispatch({ type: 'replace', project: { name, files, folders: [], entry }, git: null });
    onClose();
    if (brief) {
      // Let the new project land before the agent snapshots it
      setTimeout(() => {
        if (ask(brief, { label: `Build ${name}` }) === null) onNeedModel();
      }, 250);
      notify({ kind: 'success', title: `Created ${name}: the agent is building it`, detail: `${label}. Its work arrives as a proposal tab you review before anything changes; your previous project (${project.name}) is in History.` });
    } else notify({ kind: 'success', title: `Created ${name}`, detail: `${label}. Press Run for a live preview. Your previous project (${project.name}) is in History.` });
  };

  const openInBuilder = (choice: StackChoice) => {
    setStackSeed(choice);
    setTab('stack');
  };

  return (
    <Dialog title="Create" description="Describe an app, pick one from the gallery, build a stack, or start from a template. Your current project is kept in History." onClose={onClose} width="max-w-6xl" tall>
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <nav aria-label="Ways to start" className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col md:overflow-visible">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`shrink-0 rounded-lg px-3 py-2 text-left transition-colors ${tab === t.id ? 'bg-[var(--accent-soft)] text-gray-100' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'}`}
            >
              <span className={`block text-sm font-medium ${tab === t.id ? 'text-accent' : ''}`}>{t.label}</span>
              <span className="hidden text-[11px] leading-snug text-gray-500 md:block">{t.hint}</span>
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
          {tab === 'describe' && <Describe hasModel={hasModel} onNeedModel={onNeedModel} create={create} openInBuilder={openInBuilder} openGallery={() => setTab('gallery')} />}
          {tab === 'gallery' && <Gallery hasModel={hasModel} create={create} openInBuilder={openInBuilder} />}
          {tab === 'stack' && <StackBuilder key={stackSeed ? JSON.stringify(stackSeed) : 'default'} seed={stackSeed ?? DEFAULT_STACK} create={create} />}
          {tab === 'templates' && <Templates initial={templateFilter} create={create} />}
          {tab === 'kits' && <Kits onClose={onClose} />}
        </div>
      </div>
    </Dialog>
  );
}

type CreateFn = (files: Record<string, string>, entry: string, name: string, label: string, brief?: string) => void;

// ─── Describe ────────────────────────────────────────────────────────────────

function Describe({ hasModel, onNeedModel, create, openInBuilder, openGallery }: { hasModel: boolean; onNeedModel: () => void; create: CreateFn; openInBuilder: (c: StackChoice) => void; openGallery: () => void }) {
  const [text, setText] = useState('');
  const plan = useMemo(() => (text.trim().length >= 6 ? planApp(text) : null), [text]);
  const made = useMemo(() => (plan ? materialize(plan.source, plan.name) : null), [plan]);

  const go = (withAgent: boolean) => {
    if (!plan || !made) return;
    if (withAgent && !hasModel) {
      onNeedModel();
      return;
    }
    create(made.files, made.entry, made.name, plan.label, withAgent ? plan.brief : undefined);
  };

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="describe-app" className="text-lg font-semibold tracking-tight text-gray-100">
          What do you want to build?
        </label>
        <p className="mt-1 text-sm text-gray-400">Plain words are enough. The studio picks the language and stack that fit and says why; the agent builds it on a private copy, and you review every change. Or create the starter and write it yourself.</p>
        <textarea
          id="describe-app"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(true);
          }}
          rows={3}
          autoFocus
          placeholder="An expense tracker that saves to a database, with charts by category"
          className="input mt-3 min-h-24 w-full resize-y py-2.5 text-[15px] leading-relaxed"
        />
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Examples">
          {PLAN_EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setText(ex)} className="rounded-full border border-border px-2.5 py-1 text-xs text-gray-400 transition-colors hover:border-border-strong hover:text-gray-100">
              {ex}
            </button>
          ))}
        </div>
      </div>

      {plan && made && (
        <section aria-label="The plan" className="rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)]/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="eyebrow">The plan</div>
              <div className="mt-1 truncate font-mono text-sm text-gray-100" title={made.label}>
                {made.name} · {made.label}
              </div>
            </div>
            <span className="badge text-[11px]">{Object.keys(made.files).length} files</span>
          </div>
          <ul className="mt-3 space-y-1.5">
            {plan.reasons.map((r) => (
              <li key={r} className="flex gap-2 text-sm leading-relaxed text-gray-300">
                <Check size={14} className="mt-1 shrink-0 text-accent" /> {r}
              </li>
            ))}
          </ul>
          {plan.similar && (
            <p className="mt-3 text-xs text-gray-500">
              Close to <button onClick={openGallery} className="text-accent hover:underline">{plan.similar.name}</button> in the gallery.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => go(true)} className="btn btn-primary btn-sm">
              <Sparkle size={14} /> {hasModel ? 'Create and build it with the agent' : 'Set up a model to build it'}
            </button>
            <button onClick={() => go(false)} className="btn btn-secondary btn-sm">
              Create the starter only
            </button>
            {'stack' in plan.source && (
              <button onClick={() => openInBuilder({ ...(plan.source as { stack: StackChoice }).stack, name: plan.name })} className="btn btn-ghost btn-sm">
                Adjust the stack…
              </button>
            )}
            <span className="text-[11px] text-gray-500">{hasModel ? 'Ctrl/⌘ + Enter' : 'The starter works without a model.'}</span>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Gallery ─────────────────────────────────────────────────────────────────

function Art({ app, size = 'h-20' }: { app: GalleryApp; size?: string }) {
  return (
    <div className={`${size} relative grid place-items-center overflow-hidden rounded-lg`} style={{ background: `linear-gradient(135deg, ${app.art.from}, ${app.art.to})` }} aria-hidden="true">
      <span className="font-mono text-3xl font-semibold text-white/90 drop-shadow">{app.art.glyph}</span>
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_60%)]" />
    </div>
  );
}

function Gallery({ hasModel, create, openInBuilder }: { hasModel: boolean; create: CreateFn; openInBuilder: (c: StackChoice) => void }) {
  const [category, setCategory] = useState<GalleryCategory | 'All'>('All');
  const [open, setOpen] = useState<GalleryApp | null>(null);
  const [variant, setVariant] = useState(0);
  const [brief, setBrief] = useState('');
  const shown = GALLERY.filter((a) => category === 'All' || a.category === category);

  if (open) {
    const source = open.variants?.[variant]?.source ?? open.source;
    const made = materialize(source, open.id);
    return (
      <div className="space-y-4">
        <button onClick={() => setOpen(null)} className="text-xs text-gray-400 hover:text-gray-100">
          ← All apps
        </button>
        <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
          <Art app={open} size="h-36" />
          <div className="min-w-0 space-y-2">
            <h3 className="text-xl font-semibold tracking-tight text-gray-100">{open.name}</h3>
            <p className="text-sm text-gray-300">{open.pitch}</p>
            <p className="text-sm leading-relaxed text-gray-400">
              <span className="text-gray-200">Why this stack: </span>
              {open.why}
            </p>
          </div>
        </div>
        {open.variants && (
          <div>
            <div className="eyebrow mb-2">Language and stack</div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Language and stack">
              {open.variants.map((v, i) => (
                <button key={v.label} role="radio" aria-checked={variant === i} onClick={() => setVariant(i)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${variant === i ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent' : 'border-border text-gray-400 hover:text-gray-100'}`}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {made && <p className="font-mono text-xs text-gray-500">{made.label} · {Object.keys(made.files).length} files</p>}
        <div>
          <label htmlFor="gallery-brief" className="eyebrow mb-2 block">
            What the agent will build
          </label>
          <textarea id="gallery-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} className="input w-full resize-y py-2 text-sm leading-relaxed" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={!made || !hasModel} onClick={() => made && create(made.files, made.entry, made.name, made.label, brief)} className="btn btn-primary btn-sm">
            <Sparkle size={14} /> Create and build it with the agent
          </button>
          <button disabled={!made} onClick={() => made && create(made.files, made.entry, made.name, made.label)} className="btn btn-secondary btn-sm">
            Create the starter only
          </button>
          {'stack' in source && (
            <button onClick={() => openInBuilder({ ...source.stack, name: open.id })} className="btn btn-ghost btn-sm">
              Adjust the stack…
            </button>
          )}
          {!hasModel && <span className="text-[11px] text-gray-500">Building with the agent needs a model (Settings → AI models).</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
        {(['All', ...GALLERY_CATEGORIES] as const).map((c) => (
          <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${category === c ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent' : 'border-border text-gray-400 hover:text-gray-100'}`}>
            {c}
          </button>
        ))}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((app) => (
          <li key={app.id}>
            <button
              onClick={() => {
                setOpen(app);
                setVariant(0);
                setBrief(app.brief);
              }}
              className="group h-full w-full rounded-xl border border-border p-2.5 text-left transition-colors hover:border-border-strong hover:bg-white/[0.03]"
            >
              <Art app={app} />
              <div className="px-1 pb-1 pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-100">{app.name}</span>
                  <span className="shrink-0 text-[10px] text-gray-500">{app.category}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-400">{app.pitch}</p>
                <p className="mt-2 truncate font-mono text-[10px] text-gray-500">{app.variants ? `${app.variants.length} languages and stacks` : 'stack' in app.source ? buildStack(app.source.stack).summary : TEMPLATES.find((t) => 'template' in app.source && t.id === app.source.template)?.name}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Stack builder ───────────────────────────────────────────────────────────

function OptionCard({ selected, disabled, title, blurb, why, onClick, multi }: { selected: boolean; disabled?: string | null; title: string; blurb: string; why?: string; onClick: () => void; multi?: boolean }) {
  return (
    <button
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      aria-disabled={!!disabled}
      onClick={() => !disabled && onClick()}
      title={disabled ?? why}
      className={`h-full w-full rounded-lg border px-3 py-2 text-left transition-colors ${disabled ? 'cursor-not-allowed border-border opacity-45' : selected ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-border hover:border-border-strong hover:bg-white/[0.03]'}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={`text-sm font-medium ${selected ? 'text-accent' : 'text-gray-100'}`}>{title}</span>
        {selected && <Check size={14} className="shrink-0 text-accent" />}
      </span>
      <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{disabled ?? blurb}</span>
    </button>
  );
}

function StackBuilder({ seed, create }: { seed: StackChoice; create: CreateFn }) {
  const [choice, setChoice] = useState<StackChoice>(seed);
  const built = useMemo(() => buildStack(choice), [choice]);
  const resolved = resolveStack(choice).choice;
  const set = (patch: Partial<StackChoice>) => setChoice((c) => ({ ...c, ...patch }));
  const toggle = (id: string) => setChoice((c) => ({ ...c, libraries: c.libraries.includes(id) ? c.libraries.filter((x) => x !== id) : [...c.libraries, id] }));
  const groups = librariesByCategory(choice.kind);
  const fileList = Object.keys(built.files).sort();

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-5">
        <div className="segmented self-start" role="radiogroup" aria-label="Kind of project">
          <button role="radio" aria-checked={choice.kind === 'web'} onClick={() => set({ kind: 'web', libraries: DEFAULT_STACK.libraries })}>
            Web app (npm)
          </button>
          <button role="radio" aria-checked={choice.kind === 'python'} onClick={() => set({ kind: 'python', libraries: ['pydantic', 'pytest', 'ruff'] })}>
            Python (uv)
          </button>
        </div>

        {choice.kind === 'web' ? (
          <>
            <fieldset>
              <legend className="eyebrow mb-2">Framework</legend>
              <div role="radiogroup" aria-label="Framework" className="grid gap-2 sm:grid-cols-3">
                {FRAMEWORKS.map((f) => (
                  <OptionCard key={f.id} selected={choice.framework === f.id} title={f.name} blurb={f.blurb} why={f.why} onClick={() => set({ framework: f.id })} />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="eyebrow mb-2">Styling</legend>
              <div role="radiogroup" aria-label="Styling" className="grid gap-2 sm:grid-cols-4">
                {STYLINGS.map((s) => (
                  <OptionCard key={s.id} selected={choice.styling === s.id} title={s.name} blurb={s.blurb} why={s.why} onClick={() => set({ styling: s.id })} />
                ))}
              </div>
            </fieldset>
          </>
        ) : (
          <fieldset>
            <legend className="eyebrow mb-2">Framework</legend>
            <div role="radiogroup" aria-label="Python framework" className="grid gap-2 sm:grid-cols-4">
              {PY_FRAMEWORKS.map((f) => (
                <OptionCard key={f.id} selected={choice.pyFramework === f.id} title={f.name} blurb={f.blurb} why={f.why} onClick={() => set({ pyFramework: f.id })} />
              ))}
            </div>
          </fieldset>
        )}

        {groups.map((g) => (
          <fieldset key={g.category}>
            <legend className="eyebrow mb-2">{CATEGORY_LABEL[g.category]}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {g.libraries.map((lib) => (
                <OptionCard key={lib.id} multi selected={resolved.libraries.includes(lib.id)} disabled={unavailable(lib, choice)} title={lib.name} blurb={lib.blurb} why={lib.why} onClick={() => toggle(lib.id)} />
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <aside className="lg:sticky lg:top-0 lg:self-start" aria-label="Your stack">
        <div className="space-y-3 rounded-xl border border-border bg-white/[0.02] p-4">
          <label className="block">
            <span className="eyebrow">Project name</span>
            <input value={choice.name} onChange={(e) => set({ name: e.target.value })} className="input mt-1.5 h-8 w-full font-mono text-sm" />
          </label>
          <p className="text-sm leading-relaxed text-gray-200">{built.summary}</p>
          {built.notes.length > 0 && (
            <ul className="space-y-1" aria-label="Adjustments">
              {built.notes.map((n) => (
                <li key={n} className="text-[11px] text-warn">
                  {n}
                </li>
              ))}
            </ul>
          )}
          <div>
            <div className="eyebrow mb-1.5">Dependencies</div>
            {built.commands.map((cmd) => (
              <pre key={cmd} className="mb-1.5 whitespace-pre-wrap break-words rounded-md bg-black/40 p-2 font-mono text-[10.5px] leading-relaxed text-gray-300">
                {cmd}
              </pre>
            ))}
            <p className="text-[11px] text-gray-500">{choice.kind === 'web' ? 'Listed in package.json with versions; installed on the first Run.' : 'Listed in pyproject.toml, as uv add writes them; uv installs them on the first Run.'}</p>
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-gray-400">{fileList.length} files</summary>
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto font-mono text-[11px] text-gray-500">
              {fileList.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
          <button onClick={() => create(built.files, built.entry, built.choice.name, built.summary)} className="btn btn-primary btn-sm w-full">
            Create project
          </button>
        </div>
      </aside>
    </div>
  );
}

// ─── Templates and kits ──────────────────────────────────────────────────────

function Templates({ initial, create }: { initial: TemplateFilter; create: CreateFn }) {
  const [filter, setFilter] = useState<TemplateFilter>(initial);
  const [query, setQuery] = useState('');
  const groupOf = (t: Template) => ((t.language ?? 'typescript') === 'typescript' || t.language === 'python' || t.language === 'web' ? (t.language ?? 'typescript') : 'other');
  const tagOf = (t: Template) => (t.language === 'web' ? 'Web' : t.language === 'python' ? 'Python' : (t.language ?? 'typescript') === 'typescript' ? 'TS' : (getLanguage(t.language!)?.name.split(' ')[0] ?? t.language));
  const q = query.trim().toLowerCase();
  const shown = TEMPLATES.filter((t) => (filter === 'all' || (filter === 'apps' ? t.app : groupOf(t) === filter)) && (!q || `${t.name} ${t.description} ${tagOf(t)}`.toLowerCase().includes(q)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="segmented" role="group" aria-label="Language">
          {([['all', 'All'], ['apps', 'Full apps'], ['typescript', 'TypeScript'], ['web', 'Web'], ['python', 'Python · AI'], ['other', 'Other languages']] as const).map(([value, label]) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates…" aria-label="Search templates" className="input h-8 min-w-40 flex-1 text-sm" />
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {shown.map((template) => {
          const { files, entry } = templateFiles(template);
          const count = Object.keys(files).length;
          return (
            <li key={template.id}>
              <button onClick={() => create(files, entry, template.id, template.name)} className="group h-full w-full rounded-xl border border-border p-4 text-left transition-colors hover:border-border-strong hover:bg-white/[0.04]">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-100">{template.name}</span>
                    <span className="badge shrink-0 px-1.5 py-0 text-[10px]">{tagOf(template)}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-gray-500">{count > 1 ? `${count} files` : template.filename}</span>
                </div>
                <p className="mt-1 text-sm text-gray-400">{template.description}</p>
                <pre className="mt-3 max-h-20 overflow-hidden font-mono text-[11px] leading-relaxed text-gray-500 [mask-image:linear-gradient(to_bottom,black_50%,transparent)]">{template.code.split('\n').slice(0, 5).join('\n')}</pre>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="py-8 text-center text-sm text-gray-500">No template matches “{query}”.</li>}
      </ul>
    </div>
  );
}

function Kits({ onClose }: { onClose: () => void }) {
  const { project, dispatch, saveSnapshot } = useWorkspace();
  const { notify } = useToast();
  const actions = useActions();
  const importRef = useRef<HTMLInputElement>(null);
  const openKit = (kit: Kit, files: Record<string, string>) => {
    saveSnapshot(`Before opening kit: ${kit.name}`);
    dispatch({ type: 'replace', project: kitProject(kit, files), git: null });
    notify({ kind: 'success', title: `Opened kit: ${kit.name}`, detail: `Your previous project (${project.name}) is in History.` });
    actions.openPanel('kit');
    onClose();
  };
  const importKit = async (file: File) => {
    const parsed = parseBundle(await file.text());
    if ('error' in parsed) return notify({ kind: 'error', title: 'Could not open the kit', detail: parsed.error });
    openKit(parsed.kit, parsed.files);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">A kit is a project plus its playbook, the variables and connectors it needs, checks that prove it works, and house rules for the agent. Each one runs on sample data as soon as it opens.</p>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {KIT_LIBRARY.map(({ kit, files }) => (
          <li key={kit.id}>
            <button onClick={() => openKit(kit, files)} className="h-full w-full rounded-xl border border-border p-4 text-left transition-colors hover:border-border-strong hover:bg-white/[0.04]">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-gray-100">{kit.name}</span>
                <span className="badge shrink-0 px-1.5 py-0 text-[10px]">{AUDIENCE_LABEL[kit.audience]}</span>
              </span>
              <p className="mt-1 text-sm text-gray-400">{kit.summary}</p>
              <p className="mt-2 font-mono text-[11px] text-gray-500">
                {kit.steps.length} steps · {kit.checks.length} check{kit.checks.length === 1 ? '' : 's'} · {Object.keys(files).length} files
              </p>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button onClick={() => importRef.current?.click()} className="btn btn-secondary btn-sm">
          Open a kit file…
        </button>
        <span className="text-xs text-gray-500">A .nanokit.json from your team, a customer or a vendor. Nothing in it runs until you run it.</span>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Kit file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importKit(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
