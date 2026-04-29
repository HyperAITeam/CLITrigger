export interface WikilinkRef {
  raw: string;
  title: string;
  alias?: string;
  start: number;
  end: number;
}

const WIKILINK_PATTERN = /\[\[([^\]\n|#]+)(?:#[^\]\n|]+)?(?:\|([^\]\n]+))?\]\]/g;

export function parseWikilinks(body: string): WikilinkRef[] {
  if (!body) return [];
  const refs: WikilinkRef[] = [];
  WIKILINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_PATTERN.exec(body)) !== null) {
    const title = match[1].trim();
    if (!title) continue;
    refs.push({
      raw: match[0],
      title,
      alias: match[2]?.trim() || undefined,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return refs;
}
