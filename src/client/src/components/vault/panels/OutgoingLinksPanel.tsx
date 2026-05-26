import { useMemo } from 'react';
import { FileText, ArrowRight, AlertCircle } from 'lucide-react';
import { useI18n } from '../../../i18n';
import type { VaultFile } from '../../../api/vault';

interface Props {
  files: VaultFile[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

interface OutgoingItem {
  link: string;
  target: VaultFile | null;
}

export function OutgoingLinksPanel({ files, activeFile, onSelectFile }: Props) {
  const { t } = useI18n();
  const active = useMemo(() => files.find((f) => f.relativePath === activeFile) ?? null, [files, activeFile]);

  const stemIndex = useMemo(() => {
    const m = new Map<string, VaultFile>();
    for (const f of files) {
      m.set(f.stem.toLowerCase(), f);
      m.set(f.title.toLowerCase(), f);
    }
    return m;
  }, [files]);

  const items = useMemo<OutgoingItem[]>(() => {
    if (!active) return [];
    const seen = new Set<string>();
    const out: OutgoingItem[] = [];
    for (const link of active.wikilinks) {
      const key = link.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ link, target: stemIndex.get(key) ?? null });
    }
    return out;
  }, [active, stemIndex]);

  if (!active) {
    return <div className="text-xs text-warm-400 px-3 py-4 text-center">{t('vault.activeFile.empty')}</div>;
  }
  if (items.length === 0) {
    return <div className="text-xs text-warm-400 px-3 py-4 text-center">{t('vault.outgoing.empty')}</div>;
  }
  return (
    <div className="flex flex-col py-1">
      {items.map(({ link, target }, i) => (target ? (
        <button
          key={i}
          onClick={() => onSelectFile(target.relativePath)}
          className="w-full text-left px-2 py-1.5 hover:bg-warm-100"
        >
          <div className="flex items-center gap-1.5 text-xs">
            <ArrowRight className="w-3 h-3 text-warm-400 shrink-0" />
            <FileText className="w-3 h-3 text-sky-500 shrink-0" />
            <span className="font-medium text-warm-800 truncate">{target.stem}</span>
          </div>
          <div className="text-[10px] text-warm-500 truncate pl-[26px] mt-0.5">{target.relativePath}</div>
        </button>
      ) : (
        <div key={i} className="px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-xs">
            <ArrowRight className="w-3 h-3 text-warm-400 shrink-0" />
            <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="text-warm-500 truncate italic">[[{link}]]</span>
          </div>
          <div className="text-[10px] text-warm-400 truncate pl-[26px] mt-0.5">unresolved</div>
        </div>
      )))}
    </div>
  );
}
