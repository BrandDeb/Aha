'use client';

import type { MorningReport, ReportAction } from '@/lib/morning';
import { Dialog } from './Dialog';

const TONE = { good: 'text-accent', bad: 'text-danger', warn: 'text-warn', neutral: 'text-gray-500' } as const;
const MARK = { good: '✓', bad: '✕', warn: '●', neutral: '·' } as const;

/** What happened while you were away, each item one click from where you act on it */
export function MorningReportDialog({ report, onAction, onClose }: { report: MorningReport; onAction: (action: ReportAction) => void; onClose: () => void }) {
  return (
    <Dialog title="While you were away" description={report.headline} onClose={onClose} width="max-w-xl">
      <div className="space-y-5">
        {report.sections.map((section) => (
          <section key={section.title} aria-label={section.title}>
            <h3 className="eyebrow mb-1.5">{section.title}</h3>
            <ul className="space-y-0.5">
              {section.items.map((item, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      if (item.action) onAction(item.action);
                      onClose();
                    }}
                    disabled={!item.action}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/[0.05]"
                  >
                    <span className={`mt-0.5 text-xs ${TONE[item.tone]}`} aria-hidden="true">{MARK[item.tone]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-100">{item.label}</span>
                      {item.detail && <span className={`block text-xs ${item.tone === 'neutral' ? 'text-gray-500' : TONE[item.tone]}`}>{item.detail}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {report.quiet && <p className="text-sm text-gray-400">Nothing needs you. Turn the worker on (Agent → Keep going) and it will have work for you next time.</p>}
        <div className="flex justify-end">
          <button onClick={onClose} className="btn btn-primary btn-sm">Start working</button>
        </div>
      </div>
    </Dialog>
  );
}
