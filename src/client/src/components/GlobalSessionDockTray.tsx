// App-level dock tray for minimized session windows. Lives above ProjectDetail
// so it stays mounted across workspace switches — minimized sessions from any
// project remain visible until the user explicitly closes them.
//
// State source: each project's host writes its groups to
// `localStorage["sessionGroups:<projectId>"]`. We aggregate by walking every
// key with that prefix and pulling out groups where `minimized === true`.
// Updates come from two channels:
//   - the `storage` event (fires in OTHER tabs when a project's host writes)
//   - the custom `session-windows:changed` event (the host dispatches this on
//     every persist so the tray re-reads in the SAME tab too — `storage` is
//     not delivered to the originating tab)
//
// Click semantics:
//   - same-project chip: dispatch `session-windows:restore` for the host to
//     route through its canonical restore logic (z-bump etc.).
//   - cross-project chip: stash `pendingSessionRestore` in sessionStorage then
//     navigate. The destination host (remounted via key={projectId}) picks the
//     intent up on mount and un-minimizes the group.
//
// Close (X) semantics:
//   - same-project chip: dispatch `session-windows:close` so the host's
//     confirmRunningStop prompt still gates the action.
//   - cross-project chip: edit the other project's localStorage entry
//     directly. The underlying PTY is NOT stopped — this is "close the
//     window", not "stop the session". Re-mounting that project shows no
//     window for it; the PTY can be re-attached from the Sessions list.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { CMD, CMD_FONT } from './terminal-theme';
import { allSessionIds, type LayoutNode } from './group/groupTree';
import * as projectsApi from '../api/projects';
import type { Project } from '../types';
import { resolveProjectColor } from '../lib/projectColor';

interface MinimizedChip {
  projectId: string;
  groupId: string;
  sessionIds: string[];
  titles: Record<string, string>;
}

const STORAGE_PREFIX = 'sessionGroups:';
const RESTORE_KEY = 'pendingSessionRestore';

function readAllMinimized(): MinimizedChip[] {
  const chips: MinimizedChip[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const projectId = key.slice(STORAGE_PREFIX.length);
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as {
          groups?: Array<{
            id: string;
            minimized?: boolean;
            root?: LayoutNode;
          }>;
          titles?: Record<string, string>;
        };
        if (!Array.isArray(parsed.groups)) continue;
        const titles = parsed.titles ?? {};
        for (const g of parsed.groups) {
          if (!g?.minimized || !g.root) continue;
          chips.push({
            projectId,
            groupId: g.id,
            sessionIds: allSessionIds(g.root),
            titles,
          });
        }
      } catch { /* skip malformed entry */ }
    }
  } catch { /* localStorage blocked entirely */ }
  chips.sort((a, b) =>
    a.projectId.localeCompare(b.projectId) || a.groupId.localeCompare(b.groupId)
  );
  return chips;
}

function getCurrentProjectId(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m ? m[1] : null;
}

export default function GlobalSessionDockTray() {
  const navigate = useNavigate();
  const location = useLocation();
  const [chips, setChips] = useState<MinimizedChip[]>(() => readAllMinimized());
  const [projectMap, setProjectMap] = useState<Record<string, Project>>({});
  const currentProjectId = getCurrentProjectId(location.pathname);

  const refresh = useCallback(() => setChips(readAllMinimized()), []);

  useEffect(() => {
    const load = () => projectsApi.getProjects()
      .then((list) => {
        const map: Record<string, Project> = {};
        for (const p of list) map[p.id] = p;
        setProjectMap(map);
      })
      .catch(() => { /* ignore — falls back to id-hash color */ });
    load();
    window.addEventListener('projects:changed', load);
    return () => window.removeEventListener('projects:changed', load);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      // null fires on localStorage.clear(); otherwise only react to ours.
      if (e.key === null || e.key.startsWith(STORAGE_PREFIX)) refresh();
    };
    const onSelf = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('session-windows:changed', onSelf);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('session-windows:changed', onSelf);
    };
  }, [refresh]);

  // Route changes can affect which chips are "current project" (visual
  // emphasis) — re-read so chips that were just minimized in the new project
  // appear without waiting for a separate persist.
  useEffect(() => { refresh(); }, [location.pathname, refresh]);

  if (chips.length === 0) return null;

  const handleRestore = (chip: MinimizedChip) => {
    if (chip.projectId === currentProjectId) {
      window.dispatchEvent(new CustomEvent('session-windows:restore', {
        detail: { projectId: chip.projectId, groupId: chip.groupId },
      }));
      return;
    }
    try {
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify({
        projectId: chip.projectId, groupId: chip.groupId,
      }));
    } catch { /* private mode; navigation will still happen, just no restore */ }
    navigate(`/projects/${chip.projectId}`);
  };

  const handleClose = (chip: MinimizedChip) => {
    if (chip.projectId === currentProjectId) {
      window.dispatchEvent(new CustomEvent('session-windows:close', {
        detail: { projectId: chip.projectId, groupId: chip.groupId },
      }));
      return;
    }
    try {
      const key = STORAGE_PREFIX + chip.projectId;
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          groups?: Array<{ id: string }>;
          [k: string]: unknown;
        };
        if (Array.isArray(parsed.groups)) {
          parsed.groups = parsed.groups.filter(g => g.id !== chip.groupId);
          localStorage.setItem(key, JSON.stringify(parsed));
        }
      }
    } catch { /* ignore — chip just won't disappear until next refresh */ }
    refresh();
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: 8, left: 8,
        display: 'flex', gap: 6,
        zIndex: 900,
        maxWidth: 'calc(100vw - 16px)',
        flexWrap: 'wrap',
      }}
    >
      {chips.map((chip) => {
        const labels = chip.sessionIds.map(id => chip.titles[id] || id);
        const label = labels.length === 1
          ? labels[0]
          : `${labels[0]} +${labels.length - 1}`;
        const isOther = chip.projectId !== currentProjectId;
        return (
          <div
            key={`${chip.projectId}:${chip.groupId}`}
            onClick={() => handleRestore(chip)}
            title={`${isOther ? `[${chip.projectId}] ` : ''}${labels.join(' · ')}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: CMD.titleBg,
              border: `1px solid ${CMD.separator}`,
              opacity: isOther ? 0.75 : 1,
              borderRadius: 6,
              padding: '4px 6px 4px 4px',
              fontFamily: CMD_FONT,
              fontSize: 12,
              color: CMD.titleText,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
              maxWidth: 240,
              userSelect: 'none',
            }}
          >
            <div
              style={{
                height: 12, width: 12, borderRadius: 3, flexShrink: 0,
                background: projectMap[chip.projectId]
                  ? resolveProjectColor(projectMap[chip.projectId])
                  : resolveProjectColor({ id: chip.projectId }),
              }}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {label}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleClose(chip); }}
              aria-label="close"
              style={{
                background: 'transparent', border: 'none', color: CMD.titleText,
                cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
                justifyContent: 'center', borderRadius: 3,
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
