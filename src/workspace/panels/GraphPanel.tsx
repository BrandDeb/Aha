'use client';

import { useMemo } from 'react';
import { basename, buildDependencyGraph } from '../project';
import { useWorkspace } from '../store';

const NODE_W = 132;
const NODE_H = 30;
const GAP_X = 18;
const GAP_Y = 54;

export function GraphPanel() {
  const { project, dispatch } = useWorkspace();
  const graph = useMemo(() => buildDependencyGraph(project.files, project.entry), [project.files, project.entry]);

  const layout = useMemo(() => {
    // Layer reachable files by depth; unreachable files go on a final row
    const layers: string[][] = [];
    for (const [file, depth] of Object.entries(graph.depth)) (layers[depth] ??= []).push(file);
    layers.forEach((layer) => layer.sort());
    if (graph.unreachable.length) layers.push(graph.unreachable);
    const width = Math.max(1, ...layers.map((l) => l.length)) * (NODE_W + GAP_X);
    const positions: Record<string, { x: number; y: number }> = {};
    layers.forEach((layer, row) => {
      const rowWidth = layer.length * (NODE_W + GAP_X) - GAP_X;
      layer.forEach((file, col) => {
        positions[file] = { x: (width - rowWidth) / 2 + col * (NODE_W + GAP_X), y: 12 + row * (NODE_H + GAP_Y) };
      });
    });
    return { positions, width, height: 24 + layers.length * (NODE_H + GAP_Y) - GAP_Y };
  }, [graph]);

  const inCycle = new Set(graph.cycles.flat());
  const externals = [...new Set(Object.values(graph.external).flat())].sort();
  const unresolved = Object.entries(graph.unresolved);

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="eyebrow">Dependency graph</h3>
        <span className="font-mono text-[11px] text-gray-500">{Object.keys(graph.edges).length} modules</span>
      </div>

      {Object.keys(graph.edges).length === 0 ? (
        <p className="text-sm text-gray-500">No TypeScript or JavaScript files yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border p-2">
          <svg width={layout.width} height={layout.height} role="img" aria-label="Import graph of the project" className="mx-auto block">
            <defs>
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="currentColor" className="text-gray-500" />
              </marker>
            </defs>
            {Object.entries(graph.edges).flatMap(([from, targets]) =>
              targets.map((to) => {
                const a = layout.positions[from];
                const b = layout.positions[to];
                if (!a || !b) return null;
                const cyclic = inCycle.has(from) && inCycle.has(to);
                const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
                const upward = y2 <= y1;
                const d = upward
                  ? `M${x1},${a.y} C${x1 + 60},${a.y - 40} ${x2 + 60},${y2 + NODE_H + 40} ${x2},${y2 + NODE_H}`
                  : `M${x1},${y1} C${x1},${y1 + GAP_Y / 2} ${x2},${y2 - GAP_Y / 2} ${x2},${y2}`;
                return (
                  <path
                    key={`${from}->${to}`}
                    d={d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={cyclic ? 1.5 : 1}
                    strokeDasharray={cyclic ? '4 3' : undefined}
                    className={cyclic ? 'text-gray-100' : 'text-gray-600'}
                    markerEnd="url(#arrow)"
                  />
                );
              })
            )}
            {Object.entries(layout.positions).map(([file, { x, y }]) => {
              const isEntry = file === project.entry;
              const unreachable = graph.unreachable.includes(file);
              return (
                <g key={file} transform={`translate(${x},${y})`} className="cursor-pointer" onClick={() => dispatch({ type: 'open', path: file })}>
                  <title>{file}{unreachable ? ' — not imported by the entry' : ''}</title>
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={15}
                    className={isEntry ? 'fill-gray-100' : 'fill-gray-900'}
                    stroke="currentColor"
                    strokeDasharray={unreachable ? '3 3' : undefined}
                    style={{ color: inCycle.has(file) ? 'var(--color-gray-100)' : 'var(--frost)' }}
                  />
                  <text
                    x={NODE_W / 2}
                    y={NODE_H / 2 + 4}
                    textAnchor="middle"
                    className={`font-mono text-[11px] ${isEntry ? 'fill-black' : unreachable ? 'fill-gray-500' : 'fill-gray-200'}`}
                  >
                    {basename(file).length > 18 ? `${basename(file).slice(0, 16)}…` : basename(file)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <section className="space-y-2 text-sm" aria-label="Suggestions">
        <h3 className="eyebrow">Suggestions</h3>
        {graph.cycles.length === 0 && graph.unreachable.length === 0 && unresolved.length === 0 && (
          <p className="text-gray-500">No circular imports, no unused files, every import resolves.</p>
        )}
        {graph.cycles.map((cycle, i) => (
          <p key={i} className="text-gray-300">
            <span className="font-mono text-gray-100">⟲ cycle</span> {cycle.join(' → ')} → {cycle[0]}. Move the shared code into its own module to break it.
          </p>
        ))}
        {graph.unreachable.length > 0 && (
          <p className="text-gray-300">
            <span className="font-mono text-gray-100">◌ unused</span> {graph.unreachable.join(', ')} {graph.unreachable.length > 1 ? 'are' : 'is'} never imported by {project.entry || 'the entry'} and won&apos;t be in the binary.
          </p>
        )}
        {unresolved.map(([file, specs]) => (
          <p key={file} className="text-gray-300">
            <span className="font-mono text-danger">✕ missing</span> {file} imports {specs.join(', ')}, which isn&apos;t in the project.
          </p>
        ))}
      </section>

      {externals.length > 0 && (
        <section className="space-y-2" aria-label="External modules">
          <h3 className="eyebrow">External modules</h3>
          <div className="flex flex-wrap gap-1.5">
            {externals.map((m) => <span key={m} className="badge font-mono">{m}</span>)}
          </div>
          <p className="text-xs text-gray-500">Node built-ins are provided by scriptc&apos;s runtime. npm packages aren&apos;t installed on the build server.</p>
        </section>
      )}
    </div>
  );
}
