// A single stack node: tab bar at the top + active tab content.
// All panes (one per tab) stay mounted simultaneously — only `display` is
// toggled — so PTY live output never drops when the user switches tabs.

import { X, Minus, ZoomIn, ZoomOut, ExternalLink } from 'lucide-react';
import { useI18n } from '../../i18n';
import { CMD, CMD_FONT } from '../terminal-theme';
import SessionPane, { type PaneIntent } from './SessionPane';
import SessionThemePicker from '../SessionThemePicker';
import { useSessionFontSize } from '../../hooks/useSessionFontSize';
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

  const stopMouseDown = (e: React.MouseEvent) => {
    // Tab content area: prevent bubbling so the group-chrome drag doesn't
    // start when the user clicks/drags inside the terminal viewport.
    e.stopPropagation();
  };

  return (
    <div
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
        {/* Spacer so group action buttons (when present) sit at the right
            and the empty area between still bubbles mousedown to the parent
            for group dragging. */}
        <div style={{ flex: 1, minWidth: 8 }} />
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
        onMouseDown={stopMouseDown}
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

