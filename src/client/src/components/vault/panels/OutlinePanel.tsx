import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { getFileContent } from '../../../api/files';
import { MARKDOWN_EXT, extOf } from '../files-utils';

interface Props {
  projectId: string;
  activeFile: string | null;
}

interface Heading {
  level: number;
  text: string;
  id: string;
}

function parseHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  const lines = md.split('\n');
  let inFence = false;
  const ids = new Map<string, number>();
  for (const line of lines) {
    if (line.startsWith('```') || line.startsWith('~~~')) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].replace(/\s*#+\s*$/, '').trim();
    const baseId = text.toLowerCase().replace(/[^\w가-힣\s-]/g, '').trim().replace(/\s+/g, '-') || `heading-${out.length}`;
    const n = ids.get(baseId) ?? 0;
    const id = n === 0 ? baseId : `${baseId}-${n}`;
    ids.set(baseId, n + 1);
    out.push({ level, text, id });
  }
  return out;
}

export function OutlinePanel({ projectId, activeFile }: Props) {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeFile) { setContent(null); return; }
    const ext = extOf(activeFile.split('/').pop() || activeFile);
    if (!MARKDOWN_EXT.has(ext)) { setContent(null); return; }
    let cancelled = false;
    setLoading(true);
    getFileContent(projectId, activeFile)
      .then((r) => { if (!cancelled && !r.binary) setContent(r.content); })
      .catch(() => { if (!cancelled) setContent(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, activeFile]);

  const headings = useMemo(() => (content ? parseHeadings(content) : []), [content]);

  if (!activeFile) {
    return <div className="text-xs text-warm-400 px-3 py-4 text-center">{t('vault.activeFile.empty')}</div>;
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center text-xs text-warm-400 py-4 gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>
    );
  }
  if (headings.length === 0) {
    return <div className="text-xs text-warm-400 px-3 py-4 text-center">{t('vault.outline.empty')}</div>;
  }

  return (
    <div className="flex flex-col py-1">
      {headings.map((h, i) => (
        <a
          key={i}
          href={`#${h.id}`}
          className="block px-2 py-0.5 text-xs hover:bg-warm-100 text-warm-700 truncate"
          style={{ paddingLeft: 8 + (h.level - 1) * 10 }}
          title={h.text}
        >
          {h.text}
        </a>
      ))}
    </div>
  );
}
