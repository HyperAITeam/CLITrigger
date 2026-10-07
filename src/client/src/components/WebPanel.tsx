import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Maximize2, Minimize2, Plus, Star, X } from 'lucide-react';
import { useI18n } from '../i18n';
import Button from './Button';

const TABS_KEY = 'webPanelTabs';
const FAVORITES_KEY = 'webPanelFavorites';
// Pre-tabs single-URL key; read once to seed the first tab.
const LEGACY_URL_KEY = 'plannerWebPanelUrl';
const DEFAULT_URL = 'https://www.notion.so';
// The <webview> tag only exists in the Electron shell; browsers get a fallback
// because sites like notion.so send X-Frame-Options and refuse iframes.
const isElectron = 'electronAPI' in window;

// `src` is bound to the <webview src> attribute and only changes on Go, a
// favorite click or open-in-new-tab. `url` follows the guest's own navigations
// (address bar, persisted, restored into `src` on load). Kept apart so a
// navigation event never rewrites the src attribute, which would re-navigate
// the guest. `canGoBack` is sampled from the guest on each navigation.
type Tab = { id: string; src: string; url: string; title: string; canGoBack?: boolean };
type TabsState = { tabs: Tab[]; activeId: string };
type Favorite = { url: string; title: string };
// The slice of Electron's <webview> API used here.
type Guest = HTMLElement & { goBack(): void; canGoBack(): boolean };

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

function loadFavorites(): Favorite[] {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '') as Favorite[];
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

// `visible`: whether the host is actually showing the panel. The host keeps
// the panel mounted while hidden (see ProjectDetail) so guests survive tab
// switches; this prop is what stops hidden guests from being created at all.
export default function WebPanel({ visible = true }: { visible?: boolean } = {}) {
  const { t } = useI18n();
  const [{ tabs, activeId }, setState] = useState<TabsState>(loadTabs);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  // Lazy guests: a <webview> is only created for a tab once it has been the
  // active tab while the panel was visible. Every guest is a full renderer
  // process (400-600 MB for Notion / Atlassian), so restored tabs stay idle
  // until clicked instead of all loading at startup. Once created it stays
  // mounted, so switching back never reloads.
  const [loadedIds, setLoadedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (visible) setLoadedIds((s) => (s.has(active.id) ? s : new Set(s).add(active.id)));
  }, [visible, active.id]);
  const [draft, setDraft] = useState(active.url);
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites);
  const [fullscreen, setFullscreen] = useState(false);
  // Fullscreen-only: folds the tab bar + address bar away so the guest gets
  // the whole screen. A small handle at the top edge brings them back.
  const [chromeHidden, setChromeHidden] = useState(false);
  const collapsed = fullscreen && chromeHidden;
  const inputRef = useRef<HTMLInputElement>(null);
  const guestAreaRef = useRef<HTMLDivElement>(null);
  // Live <webview> per tab id, for imperative calls (back).
  const guestsRef = useRef(new Map<string, Guest>());

  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: tabs.map(({ id, url }) => ({ id, url })), activeId }));
  }, [tabs, activeId]);

  useEffect(() => { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); }, [favorites]);

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
    const guest = el as Guest;
    const id = el.dataset.tabId!;
    guestsRef.current.set(id, guest);
    const onTitle = (e: Event) => patchTab(id, { title: (e as Event & { title: string }).title });
    const onNavigate = (e: Event) => {
      const { url, isMainFrame } = e as Event & { url: string; isMainFrame?: boolean };
      if (isMainFrame !== false) patchTab(id, { url, canGoBack: guest.canGoBack() });
    };
    el.addEventListener('page-title-updated', onTitle);
    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', onNavigate);
    return () => {
      guestsRef.current.delete(id);
      el.removeEventListener('page-title-updated', onTitle);
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', onNavigate);
    };
  }, [patchTab]);

  const tabLabel = (tab: Tab) => {
    if (tab.title) return tab.title;
    try { return new URL(tab.url).hostname; } catch { return t('web.newTab'); }
  };

  const isFavorite = favorites.some((favorite) => favorite.url === active.url);
  const toggleFavorite = () => {
    if (!active.url) return;
    setFavorites((list) => (isFavorite
      ? list.filter((favorite) => favorite.url !== active.url)
      : [...list, { url: active.url, title: tabLabel(active) }]));
  };
  const removeFavorite = (url: string) => setFavorites((list) => list.filter((favorite) => favorite.url !== url));

  return (
    // Fullscreen only swaps classes on this root: the <webview> nodes must stay
    // mounted, since remounting reloads the guest page.
    <div
      className={fullscreen ? 'fixed inset-0 z-modal flex flex-col' : 'flex flex-col flex-1 min-h-0'}
      style={fullscreen ? { backgroundColor: 'var(--color-bg-card)' } : undefined}
      // Ctrl/Cmd+T opens a tab like a browser. Only reaches here while focus is
      // on the host side (tab strip, address bar) — keys inside the guest page
      // stay in the guest's own process.
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 't') {
          e.preventDefault();
          newTab();
        }
      }}
    >
      <div role="tablist" className={`${collapsed ? 'hidden' : 'flex'} items-end gap-0.5 px-2 border-b border-theme-border overflow-x-auto`}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            onClick={() => setState((s) => ({ ...s, activeId: tab.id }))}
            // Middle-click closes the tab like a browser; mousedown is
            // prevented so Windows/Linux do not enter autoscroll mode.
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } }}
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
      <form onSubmit={(e) => { e.preventDefault(); go(); }} className={`${collapsed ? 'hidden' : 'flex'} items-center gap-2 p-2 border-b border-theme-border`}>
        <button
          type="button"
          onClick={() => guestsRef.current.get(active.id)?.goBack()}
          disabled={!active.canGoBack}
          className="p-1 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-md transition-colors flex-shrink-0 disabled:opacity-40 disabled:pointer-events-none"
          title={t('web.back')}
          aria-label={t('web.back')}
        >
          <ArrowLeft size={14} />
        </button>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('web.urlPlaceholder')}
          className="input-field flex-1"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={toggleFavorite}
          disabled={!active.url}
          aria-pressed={isFavorite}
          className="p-1 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-md transition-colors flex-shrink-0 disabled:opacity-40 disabled:pointer-events-none"
          title={isFavorite ? t('web.removeFavorite') : t('web.addFavorite')}
          aria-label={isFavorite ? t('web.removeFavorite') : t('web.addFavorite')}
        >
          <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} className={isFavorite ? 'text-accent' : undefined} />
        </button>
        <Button type="submit" size="sm">{t('web.go')}</Button>
        {fullscreen && (
          <button
            type="button"
            onClick={() => setChromeHidden(true)}
            className="p-1 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-md transition-colors flex-shrink-0"
            title={t('web.hideBar')}
            aria-label={t('web.hideBar')}
          >
            <ChevronUp size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => { setFullscreen((v) => !v); setChromeHidden(false); }}
          className="p-1 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-md transition-colors flex-shrink-0"
          title={fullscreen ? t('web.exitFullscreen') : t('web.fullscreen')}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </form>
      {favorites.length > 0 && (
        <div className={`${collapsed ? 'hidden' : 'flex'} items-center gap-1 px-2 py-1 border-b border-theme-border overflow-x-auto`}>
          {favorites.map((favorite) => (
            <div key={favorite.url} className="group flex items-center flex-shrink-0 rounded-md hover:bg-theme-hover">
              <button
                type="button"
                onClick={() => patchTab(active.id, { src: favorite.url, url: favorite.url })}
                className="px-2 py-0.5 text-xs text-theme-text-secondary hover:text-theme-text truncate max-w-[160px]"
                title={favorite.url}
              >
                {favorite.title}
              </button>
              <button
                type="button"
                onClick={() => removeFavorite(favorite.url)}
                className="p-0.5 mr-0.5 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-theme-hover"
                title={t('web.removeFavorite')}
                aria-label={`${t('web.removeFavorite')}: ${favorite.title}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      {collapsed && (
        <button
          type="button"
          onClick={() => setChromeHidden(false)}
          className="absolute top-0 left-1/2 -translate-x-1/2 z-10 px-3 py-0.5 rounded-b-md bg-theme-card border border-t-0 border-theme-border shadow-card text-warm-400 hover:text-warm-600 transition-colors"
          title={t('web.showBar')}
          aria-label={t('web.showBar')}
        >
          <ChevronDown size={14} />
        </button>
      )}
      <div ref={guestAreaRef} className="flex-1 min-h-0 flex flex-col">
        {isElectron ? (
          tabs.map((tab) => (tab.src && loadedIds.has(tab.id)
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
