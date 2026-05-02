// Recursive renderer for a group's layout tree. A `stack` leaf delegates to
// StackView; a `split` is laid out as a flex row/column with Splitters
// between siblings.

import { Fragment, useRef } from 'react';
import StackView, { type StackViewProps } from './StackView';
import Splitter from './Splitter';
import type { LayoutNode, LayoutSplit, Path } from './groupTree';

// Props passed all the way down to every StackView. We require all of
// StackView's props except `stack` and `path`, which are filled in per-leaf.
type StackViewLeafProps = Omit<StackViewProps, 'stack' | 'path'>;

interface LayoutNodeViewProps extends StackViewLeafProps {
  node: LayoutNode;
  path: Path;
  onSplitSizes: (path: Path, sizes: number[]) => void;
}

export default function LayoutNodeView(props: LayoutNodeViewProps) {
  const { node, path, onSplitSizes, ...stackProps } = props;
  if (node.kind === 'stack') {
    return <StackView stack={node} path={path} {...stackProps} />;
  }
  return <SplitView split={node} path={path} onSplitSizes={onSplitSizes} stackProps={stackProps} />;
}

interface SplitViewProps {
  split: LayoutSplit;
  path: Path;
  onSplitSizes: (path: Path, sizes: number[]) => void;
  stackProps: StackViewLeafProps;
}

const MIN_PANE_PX = 80;

function SplitView({ split, path, onSplitSizes, stackProps }: SplitViewProps) {
  const isHoriz = split.orientation === 'horizontal';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const childRefs = useRef<(HTMLDivElement | null)[]>([]);
  // initialSizes: snapshot at mousedown — must NOT mutate during drag, since
  // Splitter sends cumulative deltaPx from mousedown and any baseline drift
  // makes the divider run away from the cursor.
  // finalSizes: latest committed % pair, persisted on mouseup.
  const dragRef = useRef<{
    i: number;
    initialSizes: number[];
    finalSizes: number[];
    total: number;
  } | null>(null);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHoriz ? 'row' : 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {split.children.map((child, i) => (
        <Fragment key={i}>
          <div
            ref={(el) => { childRefs.current[i] = el; }}
            style={{
              flex: `0 0 ${split.sizes[i]}%`,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <LayoutNodeView
              node={child}
              path={[...path, i]}
              onSplitSizes={onSplitSizes}
              {...stackProps}
            />
          </div>
          {i < split.children.length - 1 && (
            <Splitter
              orientation={split.orientation}
              onDragStart={() => {
                const cont = containerRef.current;
                if (!cont) return;
                const snapshot = split.sizes.slice();
                dragRef.current = {
                  i,
                  initialSizes: snapshot,
                  finalSizes: snapshot.slice(),
                  total: isHoriz ? cont.clientWidth : cont.clientHeight,
                };
              }}
              onDrag={(deltaPx) => {
                const st = dragRef.current;
                if (!st || st.total <= 0) return;
                const sizePxA = (st.initialSizes[st.i] / 100) * st.total;
                const sizePxB = (st.initialSizes[st.i + 1] / 100) * st.total;
                const totalPair = sizePxA + sizePxB;
                const newPxA = Math.max(MIN_PANE_PX, Math.min(totalPair - MIN_PANE_PX, sizePxA + deltaPx));
                const newPxB = totalPair - newPxA;
                const newPctA = (newPxA / st.total) * 100;
                const newPctB = (newPxB / st.total) * 100;
                const elA = childRefs.current[st.i];
                const elB = childRefs.current[st.i + 1];
                if (elA) elA.style.flexBasis = `${newPctA}%`;
                if (elB) elB.style.flexBasis = `${newPctB}%`;
                const finalSizes = st.initialSizes.slice();
                finalSizes[st.i] = newPctA;
                finalSizes[st.i + 1] = newPctB;
                st.finalSizes = finalSizes;
              }}
              onDragEnd={() => {
                const st = dragRef.current;
                if (st) onSplitSizes(path, st.finalSizes);
                dragRef.current = null;
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
