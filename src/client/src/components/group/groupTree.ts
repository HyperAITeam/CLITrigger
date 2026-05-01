// Layout tree primitives for VS Code-style grouped session windows.
//
// A group's `root` is a recursive LayoutNode. A `stack` is a leaf that holds
// one or more session tabs (with one active). A `split` is an internal node
// that lays out children horizontally or vertically with proportional sizes.
//
// Path is an array of child indices used to address nodes inside the tree.
// [] is the root, [0] is the first child of root, [0,1] is the second child
// of the first child of root, and so on.

export type LayoutStack = { kind: 'stack'; tabs: string[]; activeTab: string };
export type LayoutSplit = {
  kind: 'split';
  orientation: 'horizontal' | 'vertical';
  children: LayoutNode[];
  sizes: number[]; // percentages summing to 100
};
export type LayoutNode = LayoutStack | LayoutSplit;

export type Path = number[];
export type DockSide = 'left' | 'right' | 'top' | 'bottom' | 'center';

export function makeStack(tabs: string[], activeTab?: string): LayoutStack {
  return { kind: 'stack', tabs: tabs.slice(), activeTab: activeTab ?? tabs[0] };
}

export function getNode(root: LayoutNode, path: Path): LayoutNode | null {
  let cur: LayoutNode = root;
  for (const i of path) {
    if (cur.kind !== 'split') return null;
    if (i < 0 || i >= cur.children.length) return null;
    cur = cur.children[i];
  }
  return cur;
}

export function findStackContaining(root: LayoutNode, sessionId: string): Path | null {
  if (root.kind === 'stack') {
    return root.tabs.includes(sessionId) ? [] : null;
  }
  for (let i = 0; i < root.children.length; i++) {
    const sub = findStackContaining(root.children[i], sessionId);
    if (sub) return [i, ...sub];
  }
  return null;
}

export function allSessionIds(root: LayoutNode): string[] {
  if (root.kind === 'stack') return root.tabs.slice();
  return root.children.flatMap(allSessionIds);
}

export function activeSessionIds(root: LayoutNode): string[] {
  if (root.kind === 'stack') return [root.activeTab];
  return root.children.flatMap(activeSessionIds);
}

// Removes a session from the tree. Returns the simplified root, or null if
// the entire tree collapses (last tab removed).
export function removeTab(root: LayoutNode, sessionId: string): LayoutNode | null {
  return removeTabRec(root, sessionId);
}

function removeTabRec(node: LayoutNode, sessionId: string): LayoutNode | null {
  if (node.kind === 'stack') {
    if (!node.tabs.includes(sessionId)) return node;
    const newTabs = node.tabs.filter(t => t !== sessionId);
    if (newTabs.length === 0) return null;
    const activeTab = node.activeTab === sessionId ? newTabs[0] : node.activeTab;
    return { kind: 'stack', tabs: newTabs, activeTab };
  }
  const newChildren: LayoutNode[] = [];
  const newSizes: number[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const result = removeTabRec(node.children[i], sessionId);
    if (result !== null) {
      newChildren.push(result);
      newSizes.push(node.sizes[i]);
    }
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  const sum = newSizes.reduce((a, b) => a + b, 0) || 1;
  return {
    kind: 'split',
    orientation: node.orientation,
    children: newChildren,
    sizes: newSizes.map(s => (s / sum) * 100),
  };
}

// Adds a tab into the stack at `path`. The new tab becomes active.
export function insertIntoStack(root: LayoutNode, path: Path, sessionId: string): LayoutNode {
  return replaceAt(root, path, (target) => {
    if (target.kind !== 'stack') throw new Error('insertIntoStack: target must be a stack');
    if (target.tabs.includes(sessionId)) {
      // Already present — just activate.
      return { ...target, activeTab: sessionId };
    }
    return { kind: 'stack', tabs: [...target.tabs, sessionId], activeTab: sessionId };
  });
}

// Wraps the node at `path` in a new split, placing `newStack` on the given side.
export function insertAtSide(
  root: LayoutNode,
  path: Path,
  side: 'left' | 'right' | 'top' | 'bottom',
  newStack: LayoutNode,
): LayoutNode {
  const orientation: 'horizontal' | 'vertical' =
    side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
  const placeFirst = side === 'left' || side === 'top';
  return replaceAt(root, path, (target) => {
    const children = placeFirst ? [newStack, target] : [target, newStack];
    return { kind: 'split', orientation, children, sizes: [50, 50] };
  });
}

// Replaces the node at `path` with the result of `transform`, applying
// simplification along the way (1-child splits collapse, same-orientation
// nested splits flatten).
export function replaceAt(
  root: LayoutNode,
  path: Path,
  transform: (n: LayoutNode) => LayoutNode,
): LayoutNode {
  if (path.length === 0) return simplify(transform(root));
  if (root.kind !== 'split') throw new Error('replaceAt: path traverses non-split');
  const [head, ...rest] = path;
  if (head < 0 || head >= root.children.length) throw new Error('replaceAt: bad path');
  const newChildren = root.children.map((c, i) =>
    i === head ? replaceAt(c, rest, transform) : c,
  );
  return simplify({ ...root, children: newChildren });
}

// Collapses 1-child splits and flattens nested splits with the same orientation.
export function simplify(node: LayoutNode): LayoutNode {
  if (node.kind === 'stack') return node;
  const children = node.children.map(simplify);
  const flatChildren: LayoutNode[] = [];
  const flatSizes: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    const cSize = node.sizes[i] ?? 100 / children.length;
    if (c.kind === 'split' && c.orientation === node.orientation) {
      const total = c.sizes.reduce((a, b) => a + b, 0) || 1;
      for (let j = 0; j < c.children.length; j++) {
        flatChildren.push(c.children[j]);
        flatSizes.push((c.sizes[j] / total) * cSize);
      }
    } else {
      flatChildren.push(c);
      flatSizes.push(cSize);
    }
  }
  if (flatChildren.length === 1) return flatChildren[0];
  const sum = flatSizes.reduce((a, b) => a + b, 0) || 1;
  return {
    kind: 'split',
    orientation: node.orientation,
    children: flatChildren,
    sizes: flatSizes.map(s => (s / sum) * 100),
  };
}

export function setActiveTab(root: LayoutNode, sessionId: string): LayoutNode {
  if (root.kind === 'stack') {
    if (!root.tabs.includes(sessionId)) return root;
    return { ...root, activeTab: sessionId };
  }
  return { ...root, children: root.children.map(c => setActiveTab(c, sessionId)) };
}

export function reorderTab(root: LayoutNode, sessionId: string, newIndex: number): LayoutNode {
  if (root.kind === 'stack') {
    if (!root.tabs.includes(sessionId)) return root;
    const cur = root.tabs.indexOf(sessionId);
    const idx = Math.max(0, Math.min(newIndex, root.tabs.length - 1));
    if (idx === cur) return root;
    const newTabs = root.tabs.slice();
    newTabs.splice(cur, 1);
    newTabs.splice(idx, 0, sessionId);
    return { ...root, tabs: newTabs };
  }
  return { ...root, children: root.children.map(c => reorderTab(c, sessionId, newIndex)) };
}

export function setSplitSizes(root: LayoutNode, path: Path, sizes: number[]): LayoutNode {
  return replaceAt(root, path, (target) => {
    if (target.kind !== 'split') throw new Error('setSplitSizes: target must be a split');
    if (target.children.length !== sizes.length) throw new Error('setSplitSizes: size count mismatch');
    return { ...target, sizes };
  });
}

// Clean up a tree by removing any session ids not in `validIds`. Returns null
// if the whole tree collapses.
export function pruneInvalid(root: LayoutNode, validIds: Set<string>): LayoutNode | null {
  const ids = allSessionIds(root);
  let cur: LayoutNode | null = root;
  for (const id of ids) {
    if (!cur) break;
    if (!validIds.has(id)) cur = removeTab(cur, id);
  }
  return cur;
}
