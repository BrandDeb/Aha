'use client';

import { useMemo, useState } from 'react';
import { formatSkillMd, projectSkills, PROJECT_SKILLS_DIR, toSkillName, type SkillDoc, type SkillMeta } from '@/lib/skills/format';
import { fetchSkill, skillAction, useSkillIndex } from '../skills-client';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

interface Found {
  dir: string;
  name: string;
  description: string;
  license?: string;
  files: number;
  error?: string;
}

/** Popular open-source skill collections (each checked to hold SKILL.md folders) */
const SUGGESTED = [
  { source: 'anthropics/skills', label: 'Anthropic’s skills' },
  { source: 'obra/superpowers', label: 'Superpowers (workflows)' },
  { source: 'trailofbits/skills', label: 'Trail of Bits (security)' },
  { source: 'huggingface/skills', label: 'Hugging Face (ML)' },
  { source: 'vercel-labs/agent-skills', label: 'Vercel (web)' },
];

const TEMPLATE = `# What this skill does

## When to use it
- …

## Steps
1. …
2. …

## Rules
- …
`;

/** Settings → Skills: what the agent knows how to do, from GitHub or written by you */
export function SkillSettings() {
  const { index, set } = useSkillIndex();
  const { project, dispatch } = useWorkspace();
  const { notify } = useToast();
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<{ source: string; sha: string; skills: Found[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Record<string, SkillDoc | 'loading'>>({});
  const [draft, setDraft] = useState<{ name: string; description: string; body: string; where: 'mine' | 'project' } | null>(null);
  const [filter, setFilter] = useState('');
  const project_ = useMemo(() => projectSkills(project.files), [project.files]);
  const writable = index?.writable ?? false;

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(label);
    try {
      return await fn();
    } catch (error) {
      notify({ kind: 'error', title: `${label} failed`, detail: (error as Error).message });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const discover = async (from = source) => {
    if (!from.trim()) return;
    setSource(from);
    const result = await run('Finding skills', () => skillAction<{ sha: string; skills: Found[] }>({ action: 'discover', source: from }));
    if (!result) return;
    setFound({ source: from, sha: result.sha, skills: result.skills });
    setPicked(new Set(result.skills.filter((s) => !s.error).map((s) => s.dir)));
  };

  const install = async () => {
    if (!found) return;
    const result = await run('Installing', () => skillAction<{ results: { dir: string; name?: string; error?: string }[]; skills: SkillMeta[] }>({ action: 'install', source: found.source, sha: found.sha, dirs: [...picked] }));
    if (!result) return;
    set(result.skills);
    const ok = result.results.filter((r) => r.name);
    const failed = result.results.filter((r) => r.error);
    notify(
      failed.length
        ? { kind: 'error', title: `Installed ${ok.length}, ${failed.length} failed`, detail: failed.map((f) => `${f.dir}: ${f.error}`).join('; ') }
        : { kind: 'success', title: `Installed ${ok.length} skill${ok.length === 1 ? '' : 's'}`, detail: ok.map((r) => r.name).join(', ') }
    );
    if (ok.length) setFound(null);
  };

  const toggle = async (s: SkillMeta) => {
    const result = await run('Saving', () => skillAction({ action: 'enable', name: s.name, enabled: !s.enabled }));
    if (result) set(result.skills);
  };

  const view = async (name: string) => {
    if (open[name]) return setOpen(({ [name]: _, ...rest }) => rest);
    setOpen((prev) => ({ ...prev, [name]: 'loading' }));
    const doc = project_.find((p) => p.meta.name === name) ?? (await fetchSkill(name));
    setOpen((prev) => (doc ? { ...prev, [name]: doc } : (({ [name]: _, ...rest }) => rest)(prev)));
  };

  const save = async () => {
    if (!draft) return;
    const name = toSkillName(draft.name);
    if (draft.where === 'project') {
      // put: creates the file (write only changes files that already exist)
      dispatch({ type: 'put', files: { [`${PROJECT_SKILLS_DIR}/${name}/SKILL.md`]: formatSkillMd({ name, description: draft.description, body: draft.body }) } });
      notify({ kind: 'success', title: `Added ${name} to this project`, detail: `${PROJECT_SKILLS_DIR}/${name}/SKILL.md travels with the project.` });
      setDraft(null);
      return;
    }
    const result = await run('Saving the skill', () => skillAction({ action: 'create', name, description: draft.description, body: draft.body }));
    if (result) {
      set(result.skills);
      notify({ kind: 'success', title: `Saved ${name}`, detail: 'The agent can use it in every project.' });
      setDraft(null);
    }
  };

  const edit = async (s: SkillMeta) => {
    const doc = await fetchSkill(s.name);
    if (doc) setDraft({ name: s.name, description: doc.meta.description, body: doc.body, where: 'mine' });
  };

  const all = index?.skills ?? [];
  const q = filter.trim().toLowerCase();
  const matches = (s: SkillMeta) => !q || s.name.includes(q) || s.description.toLowerCase().includes(q);
  const installed = all.filter((s) => s.origin === 'installed' && matches(s));
  const builtin = all.filter((s) => s.origin === 'builtin' && matches(s));
  const enabledCount = all.filter((s) => s.enabled).length + project_.length;

  const Row = ({ s }: { s: SkillMeta }) => {
    const doc = open[s.name];
    const fromGithub = s.origin === 'installed' && s.source && s.source !== 'you';
    return (
      <li className="rounded-lg border border-border p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-gray-100">{s.name}</span>
              {s.source && <span className="badge max-w-[16rem] truncate px-1.5 py-0 text-[10px]" title={s.source}>{s.source === 'you' ? 'yours' : s.source}</span>}
              {s.origin === 'project' && <span className="badge px-1.5 py-0 text-[10px]">this project</span>}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-gray-400" title={s.description}>{s.description}</p>
            <div className="mt-1.5 flex flex-wrap gap-3 text-[11px]">
              <button onClick={() => void view(s.name)} className="text-gray-400 hover:text-gray-100">{doc ? 'Hide' : 'Read'}</button>
              {s.source === 'you' && writable && <button onClick={() => void edit(s)} className="text-gray-400 hover:text-gray-100">Edit</button>}
              {fromGithub && writable && (
                <button
                  onClick={async () => {
                    const r = await run('Updating', () => skillAction<{ updated: boolean; skills: SkillMeta[] }>({ action: 'update', name: s.name }));
                    if (r) {
                      set(r.skills);
                      notify({ kind: r.updated ? 'success' : 'info', title: r.updated ? `Updated ${s.name}` : `${s.name} is up to date` });
                    }
                  }}
                  className="text-gray-400 hover:text-gray-100"
                >
                  Update
                </button>
              )}
              {s.origin === 'installed' && writable && (
                <button
                  onClick={async () => {
                    const r = await run('Removing', () => skillAction({ action: 'remove', name: s.name }));
                    if (r) set(r.skills);
                  }}
                  className="text-gray-400 hover:text-danger"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          {s.origin !== 'project' && (
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-gray-400" title={s.enabled ? 'The agent may use it' : 'Turned off'}>
              <input type="checkbox" checked={s.enabled} disabled={!writable || busy !== null} onChange={() => void toggle(s)} aria-label={`Use ${s.name}`} />
              {s.enabled ? 'On' : 'Off'}
            </label>
          )}
        </div>
        {doc === 'loading' && <p className="mt-2 text-xs text-gray-500">Loading…</p>}
        {doc && doc !== 'loading' && (
          <div className="mt-2 space-y-1.5">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-gray-300">{doc.body}</pre>
            {doc.files.length > 0 && <p className="text-[11px] text-gray-500">Files: {doc.files.slice(0, 20).join(', ')}{doc.files.length > 20 ? ` and ${doc.files.length - 20} more` : ''}</p>}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-gray-400">
        Skills teach the agent how to do particular kinds of work well. They use the open Agent Skills format (a folder with a SKILL.md), so skills written for Claude and other agents work here, and any GitHub repository can hold them. The agent sees each skill’s name and description and loads the rest only when a task calls for it. Type <span className="font-mono text-gray-300">/skill-name</span> at the start of a request to use one directly.
      </p>
      <p className="text-xs text-gray-500">{enabledCount} skill{enabledCount === 1 ? '' : 's'} available to the agent.</p>

      {!writable && index && (
        <p className="rounded-lg border border-border p-3 text-xs text-gray-400">Installing and writing skills is off on this server: it only happens when the studio runs on your own machine. Built-in skills and the project’s own (in {PROJECT_SKILLS_DIR}/) still work.</p>
      )}

      {writable && (
        <section className="space-y-2" aria-label="Add from GitHub">
          <h3 className="text-sm font-medium text-gray-100">Add from GitHub</h3>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void discover();
            }}
          >
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="owner/repo, a folder in it, or a link to a SKILL.md" aria-label="GitHub repository" spellCheck={false} className="input h-9 flex-1 font-mono text-xs" />
            <button type="submit" disabled={!source.trim() || busy !== null} className="btn btn-primary btn-sm h-9">{busy === 'Finding skills' ? 'Looking…' : 'Find skills'}</button>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            Try:
            {SUGGESTED.map((s) => (
              <button key={s.source} onClick={() => void discover(s.source)} className="badge hover:text-gray-100" disabled={busy !== null}>{s.label} · {s.source}</button>
            ))}
            <span>Private repositories work when you’re signed in with GitHub.</span>
          </div>

          {found && (
            <div className="space-y-2 rounded-lg border border-border p-3" aria-label="Skills found">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-300">
                  {found.skills.length} skill{found.skills.length === 1 ? '' : 's'} in <span className="font-mono">{found.source}</span> at <span className="font-mono">{found.sha.slice(0, 7)}</span>
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setPicked(new Set(picked.size ? [] : found.skills.filter((s) => !s.error).map((s) => s.dir)))} className="text-[11px] text-gray-400 hover:text-gray-100">{picked.size ? 'None' : 'All'}</button>
                  <button onClick={() => void install()} disabled={!picked.size || busy !== null} className="btn btn-primary btn-sm h-7">{busy === 'Installing' ? 'Installing…' : `Install ${picked.size}`}</button>
                </div>
              </div>
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {found.skills.map((s) => (
                  <li key={s.dir}>
                    <label className={`flex items-start gap-2 rounded-md p-2 ${s.error ? 'opacity-60' : 'hover:bg-white/[0.04]'}`}>
                      <input
                        type="checkbox"
                        disabled={!!s.error}
                        checked={picked.has(s.dir)}
                        onChange={() => setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.dir)) next.delete(s.dir);
                          else next.add(s.dir);
                          return next;
                        })}
                        className="mt-0.5"
                        aria-label={`Install ${s.name}`}
                      />
                      <span className="min-w-0">
                        <span className="font-mono text-xs text-gray-100">{s.name}</span>
                        <span className="ml-2 text-[10px] text-gray-500">{s.files} file{s.files === 1 ? '' : 's'}{s.license ? ` · ${s.license}` : ''}</span>
                        <span className="mt-0.5 block line-clamp-2 text-[11px] text-gray-400">{s.error ?? s.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-500">Read a skill before you rely on it: its instructions guide the agent. Installing never runs anything, and anything a skill asks the agent to run still needs your OK.</p>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2" aria-label="Write your own">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-100">Your own</h3>
          {!draft && <button onClick={() => setDraft({ name: '', description: '', body: TEMPLATE, where: writable ? 'mine' : 'project' })} className="btn btn-secondary btn-sm h-7">Write a skill</button>}
        </div>
        {draft && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="name, e.g. release-notes" aria-label="Skill name" className="input h-8 font-mono text-xs" />
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} placeholder="What it does and when to use it, in the words you’d ask with. The agent decides from this." aria-label="Skill description" className="input resize-none text-xs" />
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={10} aria-label="Skill instructions" spellCheck={false} className="input font-mono text-xs leading-relaxed" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="segmented" role="group" aria-label="Where to keep it">
                <button aria-pressed={draft.where === 'mine'} disabled={!writable} onClick={() => setDraft({ ...draft, where: 'mine' })}>For me, everywhere</button>
                <button aria-pressed={draft.where === 'project'} onClick={() => setDraft({ ...draft, where: 'project' })}>In this project</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setDraft(null)} className="btn btn-ghost btn-sm h-7">Cancel</button>
                <button onClick={() => void save()} disabled={!toSkillName(draft.name) || !draft.description.trim() || !draft.body.trim() || busy !== null} className="btn btn-primary btn-sm h-7">Save skill</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2" aria-label="Installed skills">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-100">Skills</h3>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter skills" className="input h-7 w-40 text-xs" />
        </div>
        {project_.length > 0 && (
          <>
            <h4 className="eyebrow pt-1">This project ({PROJECT_SKILLS_DIR}/)</h4>
            <ul className="space-y-2">{project_.filter((p) => matches(p.meta)).map((p) => <Row key={`p-${p.meta.name}`} s={p.meta} />)}</ul>
          </>
        )}
        {installed.length > 0 && (
          <>
            <h4 className="eyebrow pt-1">Installed and yours</h4>
            <ul className="space-y-2">{installed.map((s) => <Row key={s.name} s={s} />)}</ul>
          </>
        )}
        <h4 className="eyebrow pt-1">Built in</h4>
        {!index ? <p className="text-xs text-gray-500">Loading…</p> : <ul className="space-y-2">{builtin.map((s) => <Row key={s.name} s={s} />)}</ul>}
      </section>
    </div>
  );
}
