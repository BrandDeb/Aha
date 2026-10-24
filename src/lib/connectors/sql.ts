/**
 * Guard for the database connectors. The databases are opened read-only as
 * well (the real protection); this refuses anything but a single read
 * statement up front, so the model gets a clear message instead of a driver
 * error, and a multi-statement string can't end a read-only transaction early.
 */

export type Dialect = 'sqlite' | 'postgres';

/** The SQL with comments, string literals and quoted identifiers blanked out, so structure can be inspected safely */
export function stripSql(sql: string, dialect: Dialect): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"' || (dialect === 'sqlite' && c === '`')) {
      const quote = c;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) i += 2;
        else if (sql[i] === quote) break;
        else if (sql[i] === '\\' && dialect === 'postgres' && quote === "'" && /e$/i.test(out.trimEnd())) i += 2;
        else i++;
      }
      i++;
      out += quote === "'" ? "''" : '""';
    } else if (c === '$' && dialect === 'postgres') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end < 0 ? sql.length : end + tag.length;
        out += "''";
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const ALLOWED_START: Record<Dialect, RegExp> = {
  sqlite: /^(?:select|with|values|explain)\b/i,
  postgres: /^(?:select|with|values|table|show|explain)\b/i,
};

/** Null when the SQL is a single read statement, otherwise a message for the model */
export function checkReadOnlySql(sql: string, dialect: Dialect): string | null {
  if (typeof sql !== 'string' || !sql.trim()) return 'The query is empty.';
  if (sql.length > 20_000) return 'The query is too long (limit 20,000 characters).';
  const code = stripSql(sql, dialect).trim().replace(/;\s*$/, '').trim();
  if (code.includes(';')) return 'Send one statement at a time.';
  if (!ALLOWED_START[dialect].test(code)) return 'Only read queries are allowed: SELECT, WITH, VALUES, EXPLAIN' + (dialect === 'postgres' ? ', SHOW or TABLE.' : '.');
  if (dialect === 'sqlite' && /\b(?:attach|detach|pragma|load_extension)\b/i.test(code)) return 'ATTACH, PRAGMA and extensions are not allowed.';
  if (dialect === 'postgres' && /\b(?:pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|pg_sleep|set_config|pg_terminate_backend|pg_cancel_backend)\b/i.test(code)) {
    return 'That function is not allowed.';
  }
  return null;
}

/** Render rows as a compact table for a model to read */
export function formatTable(columns: string[], rows: unknown[][], total?: number): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return 'NULL';
    if (v instanceof Uint8Array) return `<blob ${v.length} bytes>`;
    if (v instanceof Date) return v.toISOString();
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
    const single = text.replace(/\s+/g, ' ');
    return single.length > 200 ? `${single.slice(0, 197)}…` : single;
  };
  if (!columns.length) return '(no columns)';
  const lines = [columns.join(' | '), columns.map(() => '---').join(' | '), ...rows.map((r) => r.map(cell).join(' | '))];
  if (!rows.length) lines.push('(no rows)');
  if (total !== undefined && total > rows.length) lines.push(`… showing ${rows.length} of at least ${total} rows`);
  return lines.join('\n');
}
