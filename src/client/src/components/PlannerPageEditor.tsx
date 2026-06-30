import { useEffect, useState } from 'react';
import {
  useCreateBlockNote,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
  type PartialBlock,
} from '@blocknote/core';
import { useI18n } from '../i18n';
import { taskListBlock, calendarBlock } from './planner/blocks';
import '@blocknote/mantine/style.css';

// Schema with our custom page blocks. Module-level (stable identity).
const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, tasklist: taskListBlock(), calendar: calendarBlock() },
});

function useThemeMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  );
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setMode(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

function parseContent(raw: string | null | undefined): PartialBlock[] | undefined {
  if (!raw) return undefined;
  try {
    const blocks = JSON.parse(raw);
    return Array.isArray(blocks) && blocks.length > 0 ? blocks : undefined;
  } catch {
    return undefined;
  }
}

interface PlannerPageEditorProps {
  initialContent: string | null | undefined;
  onChange: (contentJson: string) => void;
}

// Mount one instance per page via a `key` on the parent so initialContent
// is applied fresh on every page switch.
export default function PlannerPageEditor({ initialContent, onChange }: PlannerPageEditorProps) {
  const { t } = useI18n();
  const theme = useThemeMode();
  const editor = useCreateBlockNote({ schema, initialContent: parseContent(initialContent) });

  // Replace the (empty) slash-trigger block with the widget + a trailing
  // paragraph so the user can keep typing below the non-editable widget.
  const insertWidget = (type: 'tasklist' | 'calendar') => {
    const block = editor.getTextCursorPosition().block;
    editor.replaceBlocks([block], [{ type }, { type: 'paragraph' }]);
  };

  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      slashMenu={false}
      onChange={() => onChange(JSON.stringify(editor.document))}
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            [
              ...getDefaultReactSlashMenuItems(editor),
              {
                title: t('planner.block.tasklist'),
                aliases: ['todo', 'task', 'tasklist', '할일', '체크리스트'],
                group: t('planner.title'),
                onItemClick: () => insertWidget('tasklist'),
              },
              {
                title: t('planner.block.calendar'),
                aliases: ['calendar', 'cal', '캘린더', '달력'],
                group: t('planner.title'),
                onItemClick: () => insertWidget('calendar'),
              },
            ],
            query
          )
        }
      />
    </BlockNoteView>
  );
}
