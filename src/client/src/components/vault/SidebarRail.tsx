import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';

export interface PanelDef<TId extends string> {
  id: TId;
  label: string;
  Icon: LucideIcon;
  render: () => ReactNode;
}

interface Props<TId extends string> {
  side: 'left' | 'right';
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeId: TId;
  onActivate: (id: TId) => void;
  panels: readonly PanelDef<TId>[];
  width: number;
}

export function SidebarRail<TId extends string>({
  side, collapsed, onToggleCollapsed, activeId, onActivate, panels, width,
}: Props<TId>) {
  const { t } = useI18n();
  const active = panels.find((p) => p.id === activeId);
  const isLeft = side === 'left';

  const rail = (
    <div
      className={`flex flex-col items-center gap-0.5 py-1.5 px-0.5 shrink-0 bg-warm-50 ${
        isLeft ? 'border-r' : 'border-l'
      } border-warm-200`}
      style={{ width: 32 }}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="p-1.5 rounded hover:bg-warm-200 text-warm-500 hover:text-warm-700"
        title={collapsed ? t('vault.sidebar.expand') : t('vault.sidebar.collapse')}
      >
        {(isLeft && collapsed) || (!isLeft && !collapsed)
          ? <ChevronRight className="w-3.5 h-3.5" />
          : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>
      <div className="w-full border-t border-warm-200 my-0.5" />
      {panels.map((p) => {
        const IconCmp = p.Icon;
        const isActive = activeId === p.id && !collapsed;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              if (collapsed) onToggleCollapsed();
              onActivate(p.id);
            }}
            className={`p-1.5 rounded ${
              isActive
                ? 'bg-warm-200 text-warm-800'
                : 'text-warm-500 hover:bg-warm-200 hover:text-warm-700'
            }`}
            title={p.label}
          >
            <IconCmp className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );

  const content = collapsed ? null : (
    <div
      className="flex flex-col min-w-0 min-h-0 overflow-hidden bg-warm-0"
      style={{ width: Math.max(width - 32, 0) }}
    >
      <div className="px-3 py-2 border-b border-warm-200 text-[10px] uppercase tracking-wide text-warm-500 font-semibold shrink-0">
        {active?.label ?? ''}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {active?.render()}
      </div>
    </div>
  );

  return (
    <div className="flex shrink-0" style={{ width: collapsed ? 32 : width }}>
      {isLeft ? <>{rail}{content}</> : <>{content}{rail}</>}
    </div>
  );
}
