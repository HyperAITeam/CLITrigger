import { useEffect, useMemo, useState } from 'react';
import * as projectsApi from '../api/projects';
import { useI18n } from '../i18n';

interface Props {
  projectId: string;
  filePath: string;
  onResolved: () => void;
  onError: (msg: string | null) => void;
}

type Choice = 'ours' | 'theirs' | 'both';

type Segment =
  | { kind: 'text'; lines: string[] }
  | { kind: 'conflict'; ours: string[]; theirs: string[]; label: string };

// Split a conflicted file into plain-text runs and conflict regions. The
// <<<<<<< / ======= / >>>>>>> marker lines are dropped; a diff3 base section
// (|||||||…=======) is skipped. ponytail: diff3 base is discarded, not offered
// as a third pick — add it if anyone actually merges with conflictStyle=diff3.
export function parseConflicts(content: string): Segment[] {
  const lines = content.split('\n');
  const segments: Segment[] = [];
  let text: string[] = [];
  const flush = () => { if (text.length) { segments.push({ kind: 'text', lines: text }); text = []; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('<<<<<<<')) {
      flush();
      const label = line.slice(7).trim() || 'HEAD';
      i++;
      const ours: string[] = [];
      while (i < lines.length && !lines[i].startsWith('|||||||') && !lines[i].startsWith('=======')) { ours.push(lines[i]); i++; }
      if (i < lines.length && lines[i].startsWith('|||||||')) {
        i++;
        while (i < lines.length && !lines[i].startsWith('=======')) i++;
      }
      if (i < lines.length && lines[i].startsWith('=======')) i++;
      const theirs: string[] = [];
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) { theirs.push(lines[i]); i++; }
      if (i < lines.length && lines[i].startsWith('>>>>>>>')) i++;
      segments.push({ kind: 'conflict', ours, theirs, label });
    } else {
      text.push(line);
      i++;
    }
  }
  flush();
  return segments;
}

// Rebuild the file from each region's choice. Unresolved regions keep their
// markers, so the marker check below still flags them.
export function reconstruct(segments: Segment[], choices: Record<number, Choice>): string {
  const out: string[] = [];
  segments.forEach((seg, idx) => {
    if (seg.kind === 'text') { out.push(...seg.lines); return; }
    const c = choices[idx];
    if (c === 'ours') out.push(...seg.ours);
    else if (c === 'theirs') out.push(...seg.theirs);
    else if (c === 'both') out.push(...seg.ours, ...seg.theirs);
    else out.push(`<<<<<<< ${seg.label}`, ...seg.ours, '=======', ...seg.theirs, '>>>>>>> incoming');
  });
  return out.join('\n');
}

// Only the extremely-unlikely-in-real-content start/end markers count — a
// 7-equals line is a legit Markdown/RST heading rule, so it's excluded.
const MARKER_RE = /^(<{7}|>{7})/m;

function Lines({ lines, tint }: { lines: string[]; tint: string }) {
  return (
    <pre className={`px-3 py-1.5 font-mono text-xs leading-relaxed overflow-x-auto ${tint}`}>
      {lines.length ? lines.map((l, i) => <div key={i}>{l || ' '}</div>) : <div className="italic opacity-50">∅</div>}
    </pre>
  );
}

export default function ConflictResolver({ projectId, filePath, onResolved, onError }: Props) {
  const { t } = useI18n();
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [manual, setManual] = useState(false);
  const [manualText, setManualText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setManual(false); setChoices({}); setLoadError(false);
    projectsApi.getConflictFile(projectId, filePath)
      .then((r) => { if (!cancelled) setSegments(parseConflicts(r.content)); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, filePath]);

  const conflictIndices = useMemo(
    () => (segments ? segments.map((s, i) => (s.kind === 'conflict' ? i : -1)).filter((i) => i >= 0) : []),
    [segments],
  );
  const resolvedCount = conflictIndices.filter((i) => choices[i]).length;
  const unresolved = conflictIndices.length - resolvedCount;
  const guidedContent = useMemo(() => (segments ? reconstruct(segments, choices) : ''), [segments, choices]);

  const contentToSave = manual ? manualText : guidedContent;
  const hasMarkers = MARKER_RE.test(contentToSave);
  const saveDisabled = saving || hasMarkers || (!manual && unresolved > 0);

  const pick = (idx: number, choice: Choice) => setChoices((prev) => ({ ...prev, [idx]: choice }));

  const enterManual = () => { setManualText(guidedContent); setManual(true); };

  const save = async () => {
    setSaving(true);
    onError(null);
    try {
      await projectsApi.resolveConflictContent(projectId, filePath, contentToSave);
      onResolved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save resolution');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#1A1A1A] text-gray-200">
      <div className="px-3 py-2 border-b border-gray-700 shrink-0 flex items-center gap-2">
        <span className="text-xs font-mono text-gray-100 truncate flex-1" title={filePath}>{filePath}</span>
        {!loading && !loadError && (
          <>
            <span className={`text-2xs ${unresolved > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {unresolved > 0 ? t('git.cr.unresolved').replace('{n}', String(unresolved)) : t('git.cr.allResolved')}
            </span>
            <button
              className="text-2xs px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
              onClick={() => (manual ? setManual(false) : enterManual())}
            >
              {manual ? t('git.cr.guided') : t('git.cr.manual')}
            </button>
            <button
              className="text-2xs px-2 py-0.5 rounded bg-accent text-white disabled:opacity-40"
              disabled={saveDisabled}
              onClick={save}
              title={hasMarkers ? t('git.cr.markersRemain') : undefined}
            >
              {saving ? '…' : t('git.cr.save')}
            </button>
          </>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400">{t('git.loadingDiff')}</div>
      ) : loadError ? (
        <div className="flex-1 flex items-center justify-center text-xs text-status-error">{t('git.cr.loadFailed')}</div>
      ) : manual ? (
        <textarea
          className="flex-1 w-full bg-[#1A1A1A] text-gray-100 font-mono text-xs p-3 resize-none focus:outline-none"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          spellCheck={false}
        />
      ) : conflictIndices.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400">{t('git.cr.noConflicts')}</div>
      ) : (
        <div className="flex-1 overflow-auto">
          {segments!.map((seg, idx) =>
            seg.kind === 'text' ? (
              <Lines key={idx} lines={seg.lines} tint="text-gray-500" />
            ) : (
              <div key={idx} className="my-1 border-y border-gray-700">
                <div className="flex items-center gap-1 px-3 py-1 bg-gray-800/60">
                  {(['ours', 'theirs', 'both'] as Choice[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => pick(idx, c)}
                      className={`text-2xs px-2 py-0.5 rounded border transition-colors ${
                        choices[idx] === c
                          ? 'bg-accent text-white border-accent'
                          : 'border-gray-600 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {c === 'ours' ? t('git.acceptOurs') : c === 'theirs' ? t('git.acceptTheirs') : t('git.cr.both')}
                    </button>
                  ))}
                </div>
                <div className={choices[idx] === 'theirs' ? 'opacity-40' : ''}>
                  <div className="px-3 pt-1 text-2xs text-emerald-400">{t('git.cr.ours')}</div>
                  <Lines lines={seg.ours} tint="text-gray-100 bg-emerald-500/10" />
                </div>
                <div className={choices[idx] === 'ours' ? 'opacity-40' : ''}>
                  <div className="px-3 pt-1 text-2xs text-sky-400">{t('git.cr.theirs')}</div>
                  <Lines lines={seg.theirs} tint="text-gray-100 bg-sky-500/10" />
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
