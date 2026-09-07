import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Minimize2, Plus, X } from 'lucide-react';
import { useI18n } from '../i18n';
import Button from './Button';

const TABS_KEY = 'webPanelTabs';
// Pre-tabs single-URL key; read once to seed the first tab.
const LEGACY_URL_KEY = 'plannerWebPanelUrl';
const DEFAULT_URL = 'https://www.notion.so';
// The <webview> tag only exists in the Electron shell; browsers get a fallback
// because sites like notion.so send X-Frame-Options and refuse iframes.
const isElectron = 'electronAPI' in window;

// `src` is bound to the <webview src> attribute and only changes on Go or
// open-in-new-tab. `url` follows the guest's own navigations (address bar,
// persisted, restored into `src` on load). Kept apart so a navigation event
// never rewrites the src attribute, which would re-navigate the guest.
type Tab = { id: string; src: string; url: string; title: string };
type TabsState = { tabs: Tab[]; activeId: string };

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_URL;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function makeTab(url = ''): Tab {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), src: url, url, title: '' };
}

function loadTabs(): TabsState {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) || '') as { tabs?: { id: string; url: string }[]; activeId?: string };
    if (saved.tabs?.length) {
      const tabs = saved.tabs.map(({ id, url }) => ({ id, src: url, url, title: '' }));
      const activeId = tabs.some((tab) => tab.id === saved.activeId) ? saved.activeId! : tabs[0].id;
      return { tabs, activeId };
    }
  } catch { /* first run or corrupt entry — seed below */ }
  const first = makeTab(localStorage.getItem(LEGACY_URL_KEY) || DEFAULT_URL);
  return { tabs: [first], activeId: first.id };
}

export default function WebPanel() {
  const { t } = useI18n();
  const [{ tabs, activeId }, setState] = useState<TabsState>(loadTabs);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const [draft, setDraft] = useState(active.url);
  const [fullscreen, setFullscreen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const guestAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: tabs.map(({ id, url }) => ({ id, url })), activeId }));
  }, [tabs, activeId]);

  // Address bar mirrors the active tab; switching tabs or navigating inside
  // the guest replaces whatever was being typed, like a browser does.
  useEffect(() => { setDraft(active.url); }, [active.id, active.url]);

  const patchTab = useCallback((id: string, patch: Partial<Tab>) => {
    setState((s) => ({ ...s, tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) }));
  }, []);

  const newTab = useCallback((url = '') => {
    const tab = makeTab(url);
    setState((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
    if (!url) inputRef.current?.focus();
  }, []);

  const closeTab = (id: string) => {
    setState((s) => {
      const index = s.tabs.findIndex((tab) => tab.id === id);
      const remaining = s.tabs.filter((tab) => tab.id !== id);
      if (remaining.length === 0) {
        const blank = makeTab();
        return { tabs: [blank], activeId: blank.id };
      }
      if (s.activeId !== id) return { ...s, tabs: remaining };
      // Right neighbour (now sitting at the same index), else the left one.
      return { tabs: remaining, activeId: remaining[Math.min(index, remaining.length - 1)].id };
    });
  };

  const go = () => {
    const next = normalizeUrl(draft);
    setDraft(next);
    patchTab(active.id, { src: next, url: next });
  };

  // window.open / target=_blank inside a guest is denied in main
  // (setWindowOpenHandler) and the URL forwarded here to open as a new tab.
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onWebPanelOpenUrl?: (cb: (url: string) => void) => () => void } }).electronAPI;
    return api?.onWebPanelOpenUrl?.((url) => newTab(url));
  }, [newTab]);

  // Drags (floating terminals, splitters, tab tear-out) run on window-level
  // mousemove/mouseup. A <webview> guest is out-of-process and swallows those
  // once the cursor enters it, so the drag freezes or never sees mouseup. Make
  // the guests click-through for the duration of any host mouse press (set on
  // the container; pointer-events inherits). Presses inside a guest never
  // reach the host, so the guests stay clickable.
  useEffect(() => {
    const el = guestAreaRef.current;
    if (!el) return;
    const down = () => { el.style.pointerEvents = 'none'; };
    const up = () => { el.style.pointerEvents = ''; };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('mouseup', up, true);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('blur', up);
    };
  }, []);

  // Stable ref callback (React 19 runs the returned cleanup on unmount), so the
  // listeners attach once per guest instead of on every render.
  const bindGuest = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const id = el.dataset.tabId!;
    const onTitle = (e: Event) => patchTab(id, { title: (e as Event & { title: string }).title });
    const onNavigate = (e: Event) => {
      const { url, isMainFrame } = e as Event & { url: string; isMainFrame?: boolean };
      if (isMainFrame !== false) patchTab(id, { url });
    };
    el.addEventListener('page-title-updated', onTitle);
    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', onNavigate);
    return () => {
      el.removeEventListener('page-title-updated', onTitle);
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', onNavigate);
    };
  }, [patchTab]);

  const tabLabel = (tab: Tab) => {
    if (tab.title) return tab.title;
    try { return new URL(tab.url).hostname; } catch { return t('web.newTab'); }
  };

  return (
    // Fullscreen only swaps classes on this root: the <webview> nodes must stay
    // mounted, since remounting reloads the guest page.
    <div
      className={fullscreen ? 'fixed inset-0 z-modal flex flex-col' : 'flex flex-col flex-1 min-h-0'}
      style={fullscreen ? { backgroundColor: 'var(--color-bg-card)' } : undefined}
    >
      <div role="tablist" className="flex items-end gap-0.5 px-2 border-b border-theme-border overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            onClick={() => setState((s) => ({ ...s, activeId: tab.id }))}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs whitespace-nowrap cursor-pointer transition-colors ${
              tab.id === activeId ? 'border-b-2 border-accent text-accent font-medium' : 'text-theme-text-secondary hover:text-theme-text'
            }`}
          >
            <span className="truncate max-w-[160px]">{tabLabel(tab)}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="p-0.5 rounded hover:bg-theme-hover"
              title={t('web.closeTab')}
              aria-label={t('web.closeTab')}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => newTab()}
          className="p-1 mb-1 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-md transition-colors flex-shrink-0"
          title={t('web.newTab')}
          aria-label={t('web.newTab')}
        >
          <Plus size={14} />
        </button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); go(); }} className="flex items-center gap-2 p-2 border-b border-theme-border">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('web.urlPlaceholder')}
          className="input-field flex-1"
          spellCheck={false}
        />
        <Button type="submit" size="sm">{t('web.go')}</Button>
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          className="p-1 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-md transition-colors flex-shrink-0"
          title={fullscreen ? t('web.exitFullscreen') : t('web.fullscreen')}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </form>
      <div ref={guestAreaRef} className="flex-1 min-h-0 flex flex-col">
        {isElectron ? (
          tabs.map((tab) => (tab.src
            // createElement instead of JSX: @types/react types `allowpopups` as
            // boolean, but React 19 strips boolean values from attributes it
            // doesn't know, so the guest would silently lose window.open
            // (target=_blank links). Electron only checks attribute presence, so
            // an empty string is the correct value.
            ? createElement('webview', {
                key: tab.id,
                ref: bindGuest,
                'data-tab-id': tab.id,
                src: tab.src,
                partition: 'persist:webpanel',
                allowpopups: '',
                // display:none for inactive tabs. Electron's webview is an
                // OOPIF, so hiding it no longer recreates (= reloads) the guest.
                className: tab.id === activeId ? 'flex-1 min-h-0' : 'hidden',
              })
            : tab.id === activeId && (
              <div key={tab.id} className="flex-1 flex items-center justify-center text-sm text-theme-text-secondary">
                {t('web.emptyTab')}
              </div>
            )))
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-theme-text-secondary">
            <span>{t('web.desktopOnly')}</span>
            <Button size="sm" className="flex items-center gap-1.5" onClick={() => window.open(active.url || DEFAULT_URL, '_blank', 'noopener')}>
              <ExternalLink size={14} />
              {t('web.openExternal')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
