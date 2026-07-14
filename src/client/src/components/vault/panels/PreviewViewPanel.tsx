import { useEffect, useState, useSyncExternalStore } from 'react';
import { editBuffer, type EditBufferSnapshot } from '../vault-edit-buffer';
import { useVaultZoom } from '../../../hooks/useVaultZoom';
import { getBinaryFileUrl } from '../../../api/files';
import { resolveVaultRelative } from '../files-utils';
import MarkdownContent from '../../MarkdownContent';

const EMPTY: EditBufferSnapshot = { active: false, path: null, content: '' };

// Right-rail live preview of the currently-edited markdown buffer. Reads the
// external edit buffer so typing re-renders only this panel. Read-only: link
// clicks / checkbox toggles are intentionally omitted.
export function PreviewViewPanel({ projectId }: { projectId: string }) {
  const snap = useSyncExternalStore(editBuffer.subscribe, editBuffer.getSnapshot, () => EMPTY);
  const [zoom] = useVaultZoom(projectId);
  const [debounced, setDebounced] = useState(snap.content);

  // ponytail: naive 150ms debounce so react-markdown doesn't re-parse on every
  // keystroke. Bump the delay / go incremental if huge docs still lag.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(snap.content), 150);
    return () => clearTimeout(id);
  }, [snap.content]);

  return (
    <div className="p-4 vault-md-zoom" style={{ fontSize: `${zoom}px` }}>
      <MarkdownContent
        content={debounced}
        resolveImageSrc={(src) => {
          const resolved = resolveVaultRelative(snap.path, src);
          return resolved ? getBinaryFileUrl(projectId, resolved) : src;
        }}
      />
    </div>
  );
}
