import { createContext, useContext } from 'react';
import type { PlannerItem, PlannerTag } from '../../types';

export type ConvertMode = 'todo' | 'schedule' | 'session';

// Project context made available to custom BlockNote blocks embedded in a page,
// so a task block can create/convert page-owned tasks without prop drilling
// through the editor.
export interface PlannerPageCtx {
  projectId: string;
  pageId: string;
  projectCliTool?: string;
  existingTags: PlannerTag[];
  // onDone fires after a successful conversion so the calling block can refresh.
  openConvert: (item: PlannerItem, mode: ConvertMode, onDone?: () => void) => void;
}

const PlannerPageContext = createContext<PlannerPageCtx | null>(null);

export const PlannerPageProvider = PlannerPageContext.Provider;

export function usePlannerPage(): PlannerPageCtx {
  const ctx = useContext(PlannerPageContext);
  if (!ctx) throw new Error('usePlannerPage must be used within a PlannerPageProvider');
  return ctx;
}
