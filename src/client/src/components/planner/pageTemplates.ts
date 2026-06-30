import type { PartialBlock } from '@blocknote/core';

// Page-creation templates. `blocks` is BlockNote document content (null = blank).
// Body text is Korean (app is Korean-first); only the picker label/desc are i18n.
export interface PageTemplate {
  id: string;
  labelKey: string;
  descKey: string;
  title: string;       // default page title
  blocks: PartialBlock[] | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (level: 1 | 2 | 3, text: string): any => ({ type: 'heading', props: { level }, content: text });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = (text?: string): any => (text ? { type: 'paragraph', content: text } : { type: 'paragraph' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bullet = (text?: string): any => (text ? { type: 'bulletListItem', content: text } : { type: 'bulletListItem' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tasklist = (): any => ({ type: 'tasklist' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const calendar = (): any => ({ type: 'calendar' });

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    id: 'blank',
    labelKey: 'planner.tpl.blank',
    descKey: 'planner.tpl.blank.desc',
    title: '',
    blocks: null,
  },
  {
    id: 'meeting',
    labelKey: 'planner.tpl.meeting',
    descKey: 'planner.tpl.meeting.desc',
    title: '회의 노트',
    blocks: [
      h(1, '회의 노트'),
      p('📅 날짜: '),
      p('👥 참석자: '),
      h(2, '안건'),
      bullet(),
      h(2, '논의'),
      p(),
      h(2, '액션 아이템'),
      tasklist(),
    ],
  },
  {
    id: 'daily',
    labelKey: 'planner.tpl.daily',
    descKey: 'planner.tpl.daily.desc',
    title: '데일리 플랜',
    blocks: [
      h(1, '데일리 플랜'),
      h(2, '오늘 할 일'),
      tasklist(),
      h(2, '일정'),
      calendar(),
      h(2, '메모'),
      p(),
    ],
  },
  {
    id: 'project',
    labelKey: 'planner.tpl.project',
    descKey: 'planner.tpl.project.desc',
    title: '프로젝트 플랜',
    blocks: [
      h(1, '프로젝트 플랜'),
      h(2, '개요'),
      p(),
      h(2, '마일스톤'),
      tasklist(),
      h(2, '일정'),
      calendar(),
      h(2, '리스크 / 메모'),
      p(),
    ],
  },
  {
    id: 'weekly',
    labelKey: 'planner.tpl.weekly',
    descKey: 'planner.tpl.weekly.desc',
    title: '위클리 플래너',
    blocks: [
      h(1, '위클리 플래너'),
      h(2, '이번 주 목표'),
      bullet(),
      h(2, '할 일'),
      tasklist(),
      h(2, '주간 일정'),
      calendar(),
    ],
  },
];
