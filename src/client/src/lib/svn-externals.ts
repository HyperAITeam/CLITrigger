// svn:externals line parser/serializer.
//
// Supported forms (SVN ≥ 1.5 "new" format first, legacy second):
//   [-rOP] URL[@PEG] LOCALPATH
//   LOCALPATH [-rOP] URL
// Lines that don't parse (comments, blanks, exotic syntax) are kept verbatim
// so a table edit never destroys what it doesn't understand.

export interface ExternalEntry {
  path: string;
  url: string;
  peg: string;        // '' = HEAD
  operative: string;  // '' = none
}

export type ExternalsLine =
  | { kind: 'entry'; entry: ExternalEntry }
  | { kind: 'raw'; text: string };

const URL_RE = /^(\^\/|\/\/|\/|\.\.\/|[a-z][a-z0-9+.-]*:\/\/)/i;

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

const normalizeRev = (rev: string) => (/^HEAD$/i.test(rev) ? '' : rev);

export function parseExternalsLine(text: string): ExternalsLine {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('#')) return { kind: 'raw', text };

  const tokens = tokenize(trimmed);
  let operative = '';
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '-r' && i + 1 < tokens.length) {
      operative = tokens[i + 1];
      tokens.splice(i, 2);
      break;
    }
    const attached = /^-r(\S+)$/.exec(tokens[i]);
    if (attached) {
      operative = attached[1];
      tokens.splice(i, 1);
      break;
    }
  }
  if (tokens.length !== 2) return { kind: 'raw', text };

  const newFormat = URL_RE.test(tokens[0]);
  let url = newFormat ? tokens[0] : tokens[1];
  const path = newFormat ? tokens[1] : tokens[0];
  if (!URL_RE.test(url)) return { kind: 'raw', text };

  let peg = '';
  const at = url.lastIndexOf('@');
  if (at > 0 && /^(\d+|HEAD|\{[^}]*\})$/i.test(url.slice(at + 1))) {
    peg = url.slice(at + 1);
    url = url.slice(0, at);
  }
  return { kind: 'entry', entry: { path, url, peg: normalizeRev(peg), operative: normalizeRev(operative) } };
}

export function parseExternals(value: string): ExternalsLine[] {
  return value.split(/\r?\n/).map(parseExternalsLine);
}

export function formatExternalEntry(entry: ExternalEntry): string {
  const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const parts: string[] = [];
  if (entry.operative) parts.push(`-r${entry.operative}`);
  parts.push(quote(entry.peg ? `${entry.url}@${entry.peg}` : entry.url), quote(entry.path));
  return parts.join(' ');
}

export function serializeExternals(lines: ExternalsLine[]): string {
  return lines
    .map((line) => (line.kind === 'raw' ? line.text : formatExternalEntry(line.entry)))
    .join('\n');
}
