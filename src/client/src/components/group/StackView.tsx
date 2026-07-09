// A single stack node: tab bar at the top + active tab content.
// All panes (one per tab) stay mounted simultaneously — only `display` is
// toggled — so PTY live output never drops when the user switches tabs.

import { useState } from 'react';
import { X, Minus, Plus, ZoomIn, ZoomOut, ExternalLink, RotateCw } from 'lucide-react';
import { useI18n } from '../../i18n';
import { CMD, CMD_FONT } from '../terminal-theme';
import SessionPane, { type PaneIntent } from './SessionPane';
import SessionThemePicker from '../SessionThemePicker';
import SessionAliasInserter from '../SessionAliasInserter';
import { useSessionFontSize } from '../../hooks/useSessionFontSize';
import { useSessionWindowsOptional } from '../SessionWindowsHost';
import type { LayoutStack, Path } from './groupTree';
import type { Session } from '../../types';
import type { WsEvent } from '../../hooks/useWebSocket';

export interface StackViewProps {
  stack: LayoutStack;
  path: Path;
  groupId: string;
  // Map for O(1) session lookup
  sessionsById: Map<string, Session>;
  // Color for each session in this group
  colors: Record<string, string>;
  // Per-session intent for SessionPane (auto-start vs replay-only)
  intents: Record<string, { intent: PaneIntent; nonce: number }>;
  onTabClick: (sessionId: string) => void;
  onTabClose: (sessionId: string) => void;
  onTabMouseDown: (sessionId: string, path: Path, e: React.MouseEvent) => void;
  // Called by a SessionPane when its session transitions out of running.
  onPaneAutoClose: (sessionId: string) => void;
  // Registers the stack content rect so the host can hit-test drag drops.
  registerRect: (path: Path, rect: { x: number; y: number; w: number; h: number } | null) => void;
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  // When this stack is the entire group (no split anywhere), the unified
  // chrome is hidden and the stack's tab bar carries the group's
  // minimize/close buttons. Otherwise these are undefined.
  groupActions?: {
    onMinimizeGroup: () => void;
    onCloseGroup: () => void;
    // Optional: present only in the main app window, not inside a popout
    // (a popout can't pop itself out further).
    onPopOutGroup?: () => void;
  };
}

const TAB_HEIGHT = 26;

export default function StackView({
  stack,
  path,
  groupId,
  sessionsById,
  colors,
  intents,
  onTabClick,
  onTabClose,
  onTabMouseDown,
  onPaneAutoClose,
  registerRect,
  sendMessage,
  subscribeBinary,
  onEvent,
  groupActions,
}: StackViewProps) {
  const { t } = useI18n();
  const [activeFontSize, , bumpActiveFontSize] = useSessionFontSize(stack.activeTab);
  // Per-tab remount counter. Bumping a tab's value re-keys its SessionTerminal
  // so xterm.js is disposed and recreated. Server-side PTY is untouched —
  // the mount-time `session:subscribe` replays from DB chunks.
  const [remountKeys, setRemountKeys] = useState<Record<string, number>>({});
  const refreshActiveTab = () => {
    const sid = stack.activeTab;
    if (!sid) return;
    setRemountKeys((prev) => ({ ...prev, [sid]: (prev[sid] || 0) + 1 }));
  };
  // Optional host context — null when StackView is rendered inside a popout
  // OS window (PopoutPage mounts StackView without a SessionWindowsHost
  // above it). In that case there is nothing to raise.
  const sessionWindows = useSessionWindowsOptional();

  const onPaneAreaMouseDown = (e: React.MouseEvent) => {
    // Bring the window to the front when the user clicks anywhere inside the
    // terminal viewport, but stop propagation so the group-chrome drag
    // doesn't start.
    if (e.button === 0 && stack.activeTab) {
      sessionWindows?.focus(stack.activeTab);
    }
    e.stopPropagation();
  };

  // Ctrl+Tab / Ctrl+Shift+Tab handler — only meaningful for multi-tab stacks.
  // Wraps around at both ends. Undefined for single-tab so SessionTerminal
  // lets the key fall through to the PTY.
  const cycleTab = stack.tabs.length > 1
    ? (dir: 'next' | 'prev') => {
        const idx = stack.tabs.indexOf(stack.activeTab);
        if (idx < 0) return;
        const n = stack.tabs.length;
        const nextIdx = dir === 'next' ? (idx + 1) % n : (idx - 1 + n) % n;
        onTabClick(stack.tabs[nextIdx]);
      }
    : undefined;

  // F5 / Ctrl+Shift+R (Cmd+Shift+R on Mac) → refresh the active tab's
  // rendering, same as the header button. Bound on the stack root so only the
  // stack holding DOM focus reacts (splits / multiple windows stay
  // independent), and it works in popouts too. SessionTerminal swallows the
  // same keys so the PTY never receives them; the keydown still bubbles up
  // to here. Note: claiming F5 means TUI apps that bind it (htop, mc) can't
  // see it while the terminal is focused.
  const onStackKeyDown = (e: React.KeyboardEvent) => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const otherMod = isMac ? e.ctrlKey : e.metaKey;
    const plainF5 = e.key === 'F5' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const modShiftR = mod && !otherMod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'r';
    if (!plainF5 && !modShiftR) return;
    e.preventDefault();
    refreshActiveTab();
  };

  return (
    <div
      onKeyDown={onStackKeyDown}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: CMD.bg,
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          height: TAB_HEIGHT,
          background: CMD.titleBg,
          borderBottom: `1px solid ${CMD.separator}`,
          flexShrink: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        {stack.tabs.map((sid) => {
          const session = sessionsById.get(sid);
          const isActive = sid === stack.activeTab;
          const color = colors[sid] || CMD.titleText;
          return (
            <div
              key={sid}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                if (groupActions) {
                  // Single-stack mode: don't start a tab-detach drag here.
                  // Let the mousedown bubble so the whole window drags via
                  // the wrapper's group chrome handler (which also detects
                  // dock targets). Active-tab swap still happens.
                  onTabClick(sid);
                  return;
                }
                e.stopPropagation();
                onTabClick(sid);
                onTabMouseDown(sid, path, e);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 6px 0 10px',
                fontFamily: CMD_FONT,
                fontSize: 11,
                color: isActive ? CMD.bright : CMD.titleText,
                background: isActive ? CMD.bg : 'transparent',
                borderRight: `1px solid ${CMD.separator}`,
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                maxWidth: 200,
                position: 'relative',
              }}
              title={session?.title || sid}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  fontFamily: CMD_FONT,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: -0.5,
                  lineHeight: 1,
                  color,
                  width: 16,
                  textAlign: 'center',
                }}
              >
                {'>_'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                {session?.title || sid}
              </span>
              <button
                data-no-drag
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onTabClose(sid); }}
                aria-label="close-tab"
                title={t('group.closeTab') || 'Close tab'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: CMD.titleText,
                  cursor: 'pointer',
                  padding: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 3,
                  flexShrink: 0,
                }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
        {/* New-tab "+" button. Spawns a raw-shell session and inserts it as
            a new tab in this stack. Hidden in popouts (no host context).
            Ctrl/Cmd+T triggers the same action globally via the host. */}
        {sessionWindows && (
          <button
            data-no-drag
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => { sessionWindows.createRawShellTab(groupId, path).catch(() => { /* swallow */ }); }}
            aria-label="new-tab"
            title={`${t('group.newTab') || 'New shell tab'} (Ctrl+T)`}
            style={{
              background: 'transparent',
              border: 'none',
              borderRight: `1px solid ${CMD.separator}`,
              color: CMD.titleText,
              cursor: 'pointer',
              padding: '0 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              height: '100%',
            }}
          >
            <Plus size={13} />
          </button>
        )}
        {/* Spacer so group action buttons (when present) sit at the right
            and the empty area between still bubbles mousedown to the parent
            for group dragging. */}
        <div style={{ flex: 1, minWidth: 8 }} />
        <SessionAliasInserter sessionId={stack.activeTab} sendMessage={sendMessage} />
        <button
          data-no-drag
          onMouseDown={(e) => e.stopPropagation()}
          onClick={refreshActiveTab}
          aria-label="refresh-terminal"
          title={`${t('session.refresh') || 'Refresh rendering'} (F5 · Ctrl+Shift+R) — ${t('session.refresh.hint') || 'Rebuild the terminal view (PTY stays running)'}`}
          style={groupBtnStyle}
        >
          <RotateCw size={12} />
        </button>
        <button
          data-no-drag
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => bumpActiveFontSize(-1)}
          aria-label="decrease-font"
          title={`${t('session.fontDecrease') || 'Decrease font size'} (${activeFontSize}px) · Ctrl+wheel`}
          style={groupBtnStyle}
        >
          <ZoomOut size={13} />
        </button>
        <button
          data-no-drag
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => bumpActiveFontSize(+1)}
          aria-label="increase-font"
          title={`${t('session.fontIncrease') || 'Increase font size'} (${activeFontSize}px) · Ctrl+wheel`}
          style={groupBtnStyle}
        >
          <ZoomIn size={13} />
        </button>
        <SessionThemePicker sessionId={stack.activeTab} />
        {groupActions && (
          <>
            {groupActions.onPopOutGroup && (
              <button
                data-no-drag
                onMouseDown={(e) => e.stopPropagation()}
                onClick={groupActions.onPopOutGroup}
                aria-label="pop-out"
                title={t('session.popOut') || 'Pop out to separate window'}
                style={groupBtnStyle}
              >
                <ExternalLink size={13} />
              </button>
            )}
            <button
              data-no-drag
              onMouseDown={(e) => e.stopPropagation()}
              onClick={groupActions.onMinimizeGroup}
              aria-label="minimize"
              title={t('session.minimize') || 'Minimize'}
              style={groupBtnStyle}
            >
              <Minus size={13} />
            </button>
            <button
              data-no-drag
              onMouseDown={(e) => e.stopPropagation()}
              onClick={groupActions.onCloseGroup}
              aria-label="close"
              style={groupBtnStyle}
            >
              <X size={13} />
            </button>
          </>
        )}
      </div>
      {/* Pane area — all panes mounted, only active visible.
          Tagged with data-* attrs so the host's drag flow can hit-test which
          stack the cursor is over via document.elementFromPoint(). */}
      <div
        data-group-id={groupId}
        data-stack-path={path.join('.')}
        ref={(el) => {
          if (!el) {
            registerRect(path, null);
            return;
          }
          const r = el.getBoundingClientRect();
          registerRect(path, { x: r.left, y: r.top, w: r.width, h: r.height });
        }}
        onMouseDown={onPaneAreaMouseDown}
        style={{ flex: 1, position: 'relative', minHeight: 0, minWidth: 0 }}
      >
        {stack.tabs.map((sid) => {
          const session = sessionsById.get(sid);
          if (!session) return null;
          const intentInfo = intents[sid] || { intent: 'open' as PaneIntent, nonce: 0 };
          return (
            <SessionPane
              key={sid}
              session={session}
              visible={sid === stack.activeTab}
              intent={intentInfo.intent}
              intentNonce={intentInfo.nonce}
              onClose={() => onPaneAutoClose(sid)}
              sendMessage={sendMessage}
              subscribeBinary={subscribeBinary}
              onEvent={onEvent}
              onCycleTab={cycleTab}
              remountKey={remountKeys[sid] || 0}
            />
          );
        })}
      </div>
    </div>
  );
}

const groupBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: CMD.titleText,
  cursor: 'pointer',
  padding: '0 6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 0,
  flexShrink: 0,
  height: '100%',
};

