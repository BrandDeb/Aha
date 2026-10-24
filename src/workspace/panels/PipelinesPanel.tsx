'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEPLOY_TARGETS, deployAvailability, generatePipeline, PROVIDERS, type DeployTarget, type Provider } from '@/lib/pipelines/generate';
import { parsePipeline, pipelineFiles, type Pipeline } from '@/lib/pipelines/parse';
import { detectStacks } from '@/lib/pipelines/stack';
import { useCiOnSave } from '../ci-on-save';
import { failureReport, fetchPipelinesEnabled, runPipelineFile, type PipelineEvent, type PipelineResult } from '../pipelines-client';
import { useProposals } from '../proposals';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

type Status = 'running' | 'passed' | 'failed' | 'skipped';
interface StepView { name: string; status: Status; note?: string; ms?: number }
interface JobView { id: string; name: string; status: Status; reason?: string; notes?: string[]; steps: StepView[] }
interface RunView { file: string; job?: string; jobs: JobView[]; output: string; result: PipelineResult | null }

const ICON: Record<Status, string> = { running: '◌', passed: '✓', failed: '✗', skipped: '–' };
const TONE: Record<Status, string> = { running: 'text-accent', passed: 'text-accent', failed: 'text-danger', skipped: 'text-gray-500' };
const MAX_OUTPUT = 200_000;

/** The Pipelines tab: set up CI/CD for the project, and run its pipelines on this machine */
export function PipelinesPanel({ onFailure, onPassed }: { onFailure: (report: string) => void; onPassed: () => void }) {
  const { project, dispatch } = useWorkspace();
  const files = project.files;
  const ciFiles = useMemo(() => pipelineFiles(files), [files]);
  const parsed = useMemo(() => ciFiles.map((path) => ({ path, pipeline: parsePipeline(path, files[path]) })), [ciFiles, files]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void fetchPipelinesEnabled().then(setEnabled);
  }, []);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.output]);
  useEffect(() => {
    return () => abort.current?.abort();
  }, []);

  const start = useCallback(
    async (file: string, job?: string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      let output = '';
      setRun({ file, job, jobs: [], output: '', result: null });
      const apply = (event: PipelineEvent) => {
        if (event.t === 'out') {
          output = (output + event.d).slice(-MAX_OUTPUT);
          setRun((r) => (r ? { ...r, output } : r));
          return;
        }
        setRun((r) => {
          if (!r) return r;
          const jobs = [...r.jobs];
          if (event.t === 'job') {
            const i = jobs.findIndex((j) => j.id === event.id);
            const next: JobView = { id: event.id, name: event.name, status: event.status, reason: event.reason, notes: event.notes ?? jobs[i]?.notes, steps: jobs[i]?.steps ?? [] };
            if (i >= 0) jobs[i] = next;
            else jobs.push(next);
          } else {
            const i = jobs.findIndex((j) => j.id === event.job);
            if (i < 0) return r;
            const steps = [...jobs[i].steps];
            steps[event.index] = { name: event.name, status: event.status, note: event.note, ms: event.ms };
            jobs[i] = { ...jobs[i], steps };
          }
          return { ...r, jobs };
        });
      };
      const result = await runPipelineFile(project.name, files, file, job, apply, controller.signal);
      setRun((r) => (r ? { ...r, result } : r));
      if (result.ok) onPassed();
      else {
        const report = failureReport(file, result, output);
        if (report) onFailure(report);
      }
    },
    [project.name, files, onFailure, onPassed]
  );

  const running = !!run && !run.result;
  const hooks = useMemo(() => ({ onFailure, onPassed }), [onFailure, onPassed]);
  const onSave = useCiOnSave(project.name, files, hooks);
  const setCiOnSave = (next: boolean) => {
    onSave.setOn(next);
    if (next) void onSave.run();
  };

  return (
    <div className="space-y-6 p-4">
      <section className="space-y-3" aria-labelledby="ci-files">
        <div className="flex items-center justify-between">
          <h3 id="ci-files" className="eyebrow">Pipelines</h3>
          {ciFiles.length > 0 && (
            <button onClick={() => setSetupOpen((o) => !o)} className="btn btn-ghost btn-sm" aria-expanded={setupOpen}>
              {setupOpen ? 'Close' : 'New pipeline'}
            </button>
          )}
        </div>
        {ciFiles.length === 0 && <p className="text-sm leading-relaxed text-gray-400">No CI/CD yet. Set it up below: the studio reads your project and writes a workflow that lints, tests and builds it on every push, and can deploy it. You can run it here before you push.</p>}
        {enabled === false && ciFiles.length > 0 && <p className="text-xs text-gray-500">This server doesn’t run commands (it isn’t on your own machine), so pipelines run on GitHub or GitLab only.</p>}
        {onSave.available && (
          <label className="flex items-start gap-2 rounded-lg border border-white/[0.06] p-3 text-xs">
            <input type="checkbox" checked={onSave.on} onChange={(e) => setCiOnSave(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="text-gray-100">Run on every save</span>
              <span className="block text-gray-500">
                Works here = works in CI: each save (⌘S) runs {onSave.ciFile} here in the background, and the status bar shows the result before you push.
              </span>
            </span>
          </label>
        )}
        {parsed.map(({ path, pipeline }) => (
          <div key={path} className="space-y-2 rounded-lg border border-white/[0.06] p-3">
            <div className="flex items-center gap-2">
              <button onClick={() => dispatch({ type: 'open', path })} className="min-w-0 flex-1 truncate text-left font-mono text-xs text-gray-200 hover:text-accent" title="Open the file">
                {path}
              </button>
              {'error' in pipeline ? null : (
                <button onClick={() => void start(path)} disabled={!enabled || running} className="btn btn-secondary btn-sm shrink-0">
                  Run all
                </button>
              )}
            </div>
            {'error' in pipeline ? (
              <p className="text-xs text-danger">{pipeline.error}</p>
            ) : (
              <JobList pipeline={pipeline} run={run?.file === path ? run : null} disabled={!enabled || running} onRun={(job) => void start(path, job)} />
            )}
          </div>
        ))}
      </section>

      {run && (
        <section className="space-y-2" aria-labelledby="ci-run" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <h3 id="ci-run" className="eyebrow">
              {running ? 'Running' : run.result?.ok ? 'Passed' : run.result?.error === 'stopped' ? 'Stopped' : 'Failed'} · {run.job ?? 'all jobs'}
              {run.result && ` · ${Math.round(run.result.ms / 1000)} s`}
            </h3>
            {running && <button onClick={() => abort.current?.abort()} className="btn btn-ghost btn-sm">Stop</button>}
          </div>
          {run.result?.error && run.result.error !== 'stopped' && !run.result.jobs.length && <p className="text-xs text-danger">{run.result.error}</p>}
          {run.jobs.map((job) => (
            <div key={job.id} className="space-y-1">
              <p className="text-xs">
                <span className={TONE[job.status]}>{ICON[job.status]}</span> <span className="font-medium text-gray-100">{job.name}</span>
                {job.reason && <span className="text-gray-500"> · {job.reason}</span>}
              </p>
              {job.notes?.map((n) => <p key={n} className="pl-4 text-[11px] text-gray-500">{n}</p>)}
              <ol className="space-y-0.5 pl-4">
                {job.steps.filter(Boolean).map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-[12px]">
                    <span className={`w-3 shrink-0 ${TONE[s.status]}`} aria-label={s.status}>{ICON[s.status]}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-300" title={s.name}>{s.name}</span>
                    {s.note && s.status !== 'passed' && <span className="truncate text-gray-500" title={s.note}>{s.note}</span>}
                    {s.ms !== undefined && s.status === 'passed' && <span className="shrink-0 font-mono text-[11px] text-gray-500">{s.ms < 1000 ? `${s.ms} ms` : `${(s.ms / 1000).toFixed(1)} s`}</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {run.output && (
            <pre ref={logRef} className="max-h-72 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-gray-300" aria-label="Pipeline output">
              {run.output}
            </pre>
          )}
          {run.result && !run.result.ok && run.result.error !== 'stopped' && run.result.jobs.some((j) => j.status === 'failed') && (
            <p className="text-xs text-gray-500">The failure is in the debug bar above the editor: “Debug this” gives it to the agent, which reproduces it with this pipeline and proposes a fix.</p>
          )}
        </section>
      )}

      {(ciFiles.length === 0 || setupOpen) && <Setup onDone={() => setSetupOpen(false)} />}
    </div>
  );
}

function JobList({ pipeline, run, disabled, onRun }: { pipeline: Pipeline; run: RunView | null; disabled: boolean; onRun: (job: string) => void }) {
  return (
    <ul className="space-y-1">
      {pipeline.jobs.map((job) => {
        const last = run?.jobs.find((j) => j.id === job.id);
        return (
          <li key={job.id} className="flex items-center gap-2 text-xs">
            <span className={`w-3 ${last ? TONE[last.status] : 'text-gray-600'}`} aria-label={last?.status ?? 'not run'}>{last ? ICON[last.status] : '·'}</span>
            <span className="min-w-0 flex-1 truncate text-gray-300" title={job.skip ?? job.notes.join('\n')}>
              {job.name}
              {job.skip && <span className="text-gray-500"> · runs on {pipeline.provider === 'github' ? 'GitHub' : 'GitLab'} only</span>}
            </span>
            <span className="font-mono text-[11px] text-gray-500">{job.steps.filter((s) => s.kind === 'run').length} steps</span>
            {!job.skip && (
              <button onClick={() => onRun(job.id)} disabled={disabled} className="rounded px-1.5 py-0.5 text-[11px] text-gray-400 hover:bg-white/[0.06] hover:text-accent disabled:opacity-40" aria-label={`Run ${job.name}`}>
                Run
              </button>
            )}
          </li>
        );
      })}
      {pipeline.notes.map((n) => <li key={n} className="text-[11px] text-gray-500">{n}</li>)}
    </ul>
  );
}

function Setup({ onDone }: { onDone: () => void }) {
  const { project, git, dispatch, saveSnapshot } = useWorkspace();
  const { notify } = useToast();
  const proposals = useProposals();
  const files = project.files;
  const stacks = useMemo(() => detectStacks(files), [files]);
  const [provider, setProvider] = useState<Provider>(() => (git ? 'github' : '.gitlab-ci.yml' in files ? 'gitlab' : 'github'));
  const [deploy, setDeploy] = useState<DeployTarget>('none');
  // Deploys follow the main branch: the linked branch when it is one, else main
  const linked = git?.branch;
  const branch = linked && ['main', 'master', 'trunk', 'develop'].includes(linked) ? linked : 'main';
  const generated = useMemo(() => generatePipeline(stacks, files, { provider, deploy, branch, name: project.name }), [stacks, files, provider, deploy, branch, project.name]);
  const path = PROVIDERS.find((p) => p.id === provider)!.path;
  const exists = path in files;

  const add = () => {
    if ('error' in generated) return;
    if (exists && !window.confirm(`Replace ${path}? The current version is saved to History first.`)) return;
    saveSnapshot(exists ? `Before replacing ${path}` : 'Before adding CI');
    // put: adds the file or replaces it (write only changes files that exist)
    dispatch({ type: 'put', files: { [generated.path]: generated.content } });
    dispatch({ type: 'open', path: generated.path });
    notify({ kind: 'success', title: `Added ${generated.path}`, detail: provider === 'github' ? 'Run it here from this tab; commit it from the Git tab and GitHub runs it on every push.' : 'Run it here from this tab; push it and GitLab runs it on every push.' });
    onDone();
  };

  if (!stacks.length) {
    return (
      <section className="space-y-2" aria-labelledby="ci-setup">
        <h3 id="ci-setup" className="eyebrow">Set up CI/CD</h3>
        <p className="text-sm text-gray-400">The studio can’t tell how this project is built yet. Add a package.json, pyproject.toml, go.mod, Cargo.toml (or similar), or let the agent write the pipeline.</p>
        <button onClick={() => proposals.ask('Set up CI for this project: write .github/workflows/ci.yml that installs what it needs and runs its lint, tests and build on every push and pull request. Keep it minimal and pin action versions.', { label: 'Set up CI', approaches: 0 })} className="btn btn-secondary btn-sm w-full">
          Ask the agent to set up CI
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="ci-setup">
      <h3 id="ci-setup" className="eyebrow">Set up CI/CD</h3>
      <div className="space-y-1 text-xs">
        {stacks.map((s) => (
          <p key={s.id} className="text-gray-300">
            <span className="font-medium text-gray-100">{s.name}</span>
            <span className="text-gray-500"> · {[...(s.install.length ? ['install'] : []), ...s.checks.map((c) => c.label.toLowerCase())].join(', ') || 'set up only'}</span>
          </p>
        ))}
      </div>
      <div role="radiogroup" aria-label="CI service" className="flex gap-1 rounded-lg bg-white/[0.04] p-1">
        {PROVIDERS.map((p) => (
          <button key={p.id} role="radio" aria-checked={provider === p.id} onClick={() => setProvider(p.id)} className={`flex-1 rounded-md px-2 py-1 text-xs ${provider === p.id ? 'bg-white/[0.08] text-gray-100' : 'text-gray-400 hover:text-gray-100'}`}>
            {p.name}
          </button>
        ))}
      </div>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs text-gray-400">Deploy</legend>
        {DEPLOY_TARGETS.map((t) => {
          const available = deployAvailability(t.id, stacks[0], files, provider);
          return (
            <label key={t.id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs ${available.ok ? 'cursor-pointer hover:bg-white/[0.04]' : 'opacity-50'}`} title={available.ok ? t.detail : available.reason}>
              <input type="radio" name="deploy" value={t.id} checked={deploy === t.id} disabled={!available.ok} onChange={() => setDeploy(t.id)} className="mt-0.5 accent-[var(--color-accent)]" />
              <span>
                <span className="text-gray-100">{t.id === 'pages' ? (provider === 'github' ? 'GitHub Pages' : 'GitLab Pages') : t.id === 'docker' ? (provider === 'github' ? 'Container image (ghcr.io)' : 'Container image (GitLab registry)') : t.name}</span>
                <span className="block text-gray-500">{available.ok ? t.detail : available.reason}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {!('Dockerfile' in files) && (
        <button onClick={() => proposals.ask('Write a production Dockerfile and a .dockerignore for this project: a small, multi-stage image that builds the project and runs it as a non-root user. Match the versions the project uses.', { label: 'Write a Dockerfile', approaches: 0 })} className="btn btn-ghost btn-sm w-full">
          Ask the agent to write a Dockerfile
        </button>
      )}
      {'error' in generated ? (
        <p className="text-xs text-danger">{generated.error}</p>
      ) : (
        <>
          <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-gray-300" aria-label={`Preview of ${generated.path}`}>
            {generated.content}
          </pre>
          {generated.secrets.length > 0 && (
            <p className="text-xs text-gray-400">
              Add these secrets {provider === 'github' ? 'in the repository’s Settings → Secrets and variables → Actions' : 'as masked CI/CD variables'}: <span className="font-mono text-gray-200">{generated.secrets.join(', ')}</span>
            </p>
          )}
          {generated.notes.map((n) => <p key={n} className="text-xs text-gray-500">{n}</p>)}
          <button onClick={add} className="btn btn-primary btn-sm w-full">
            {exists ? `Replace ${generated.path}` : `Add ${generated.path}`}
          </button>
        </>
      )}
    </section>
  );
}
