import { useEffect, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import '@blocknote/mantine/style.css';

// Reads the app's current theme ([data-theme="dark"] on <html>) and tracks changes.
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
  // Stored BlockNote document JSON (or null for an empty page).
  initialContent: string | null | undefined;
  onChange: (contentJson: string) => void;
}

// Mount one instance per page via a `key` on the parent so initialContent
// is applied fresh on every page switch (no manual replaceBlocks needed).
export default function PlannerPageEditor({ initialContent, onChange }: PlannerPageEditorProps) {
  const theme = useThemeMode();
  const editor = useCreateBlockNote({ initialContent: parseContent(initialContent) });

  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      onChange={() => onChange(JSON.stringify(editor.document))}
    />
  );
}
