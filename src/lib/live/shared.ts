/** Live values: what the server sends back, and which files it can run. Shared by the server and the editor. */

export interface LiveRequest {
  projectId: string;
  files: Record<string, string>;
  entry: string;
  args: string[];
}

/** What one line did: how often it ran, and the values it produced (first few, and the last) */
export interface LiveLine {
  hits: number;
  values: Record<string, { n: number; first: string[]; last: string }>;
}

/** One moment of the run, for Rewind: the line that ran and what it set, printed, returned or threw */
export interface LiveStep {
  file: string;
  line: number;
  values?: Record<string, string>;
}

export interface LiveResult {
  ok: boolean;
  /** Every line that ran, in order (the first 20,000), for scrubbing through the run */
  steps?: LiveStep[];
  /** Per file: lines that hold a statement, and what each line that ran did */
  files: Record<string, { statementLines: number[]; lines: Record<number, LiveLine> }>;
  output: string;
  code: number | null;
  ms: number;
  /** The program ran too long or too much: values are from the start of the run */
  truncated?: boolean;
  error?: string;
}

export const LIVE_SOURCE = /\.(?:[cm]?[jt]s)$/;
export const liveSupported = (entry: string) => (LIVE_SOURCE.test(entry) && !entry.endsWith('.d.ts')) || entry.endsWith('.py');

