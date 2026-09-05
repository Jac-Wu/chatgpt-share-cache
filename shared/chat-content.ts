export const MISSING_CITATION_WARNING = '部分引用未保存来源信息，已标注「来源未缓存」；请查看原始分享，重新缓存可尝试恢复来源链接。';
export const RICH_CONTENT_WARNING = '图片或交互卡片未缓存，已替换为文字提示。';

interface SourceLink {
  url: string;
  title: string;
}

interface CodeRange {
  start: number;
  end: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sourceLink(value: unknown): SourceLink | undefined {
  const rawUrl = typeof value === 'string' ? value : record(value) ? value.url : undefined;
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096 || /[\u0000-\u001f\u007f]/.test(rawUrl)) return undefined;
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    const rawTitle = record(value) ? value.title || value.attribution : undefined;
    const title = typeof rawTitle === 'string' ? rawTitle.replace(/[\r\n\uE200-\uE206]/g, ' ').trim().slice(0, 200) : '';
    return { url: url.href, title: title || url.hostname };
  } catch { return undefined; }
}

function sourcesFrom(reference: Record<string, unknown>): SourceLink[] {
  const sources = new Map<string, SourceLink>();
  const queue: unknown[] = [reference];
  const seen = new WeakSet<object>();
  for (let index = 0; index < queue.length && index < 300 && sources.size < 20; index += 1) {
    const current = queue[index];
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current.slice(0, 50)); continue; }
    if (!record(current)) continue;
    const source = sourceLink(current);
    if (source) sources.set(source.url, source);
    for (const key of ['items', 'supporting_websites', 'fallback_items', 'sources', 'source', 'metadata']) {
      if (current[key] && typeof current[key] === 'object') queue.push(current[key]);
    }
  }
  if (!sources.size && Array.isArray(reference.safe_urls)) {
    for (const value of reference.safe_urls.slice(0, 20)) {
      const source = sourceLink(value);
      if (source) sources.set(source.url, source);
    }
  }
  return [...sources.values()];
}

function codeRanges(content: string): CodeRange[] {
  const fences: CodeRange[] = [];
  let open: { marker: string; start: number } | undefined;
  let offset = 0;
  for (const line of content.split('\n')) {
    if (open) {
      const close = line.match(/^ {0,3}(`+|~+)[\t\r ]*$/);
      if (close && close[1][0] === open.marker[0] && close[1].length >= open.marker.length) {
        fences.push({ start: open.start, end: offset + line.length });
        open = undefined;
      }
    } else {
      const start = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (start && (start[1][0] !== '`' || !start[2].includes('`'))) open = { marker: start[1], start: offset };
    }
    offset += line.length + 1;
  }
  if (open) fences.push({ start: open.start, end: content.length });

  const ranges = [...fences];
  let segmentStart = 0;
  for (const fence of [...fences, { start: content.length, end: content.length }]) {
    const segment = content.slice(segmentStart, fence.start);
    const runs = [...segment.matchAll(/`+/g)];
    const nextRuns = new Array<number>(runs.length).fill(-1);
    const nextByLength = new Map<number, number>();
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      nextRuns[index] = nextByLength.get(runs[index][0].length) ?? -1;
      nextByLength.set(runs[index][0].length, index);
    }
    for (let index = 0; index < runs.length; index += 1) {
      let backslashes = 0;
      for (let previous = runs[index].index - 1; previous >= 0 && segment[previous] === '\\'; previous -= 1) backslashes += 1;
      const next = nextRuns[index];
      if (backslashes % 2 || next < 0 || /\n[\t\r ]*\n/.test(segment.slice(runs[index].index, runs[next].index))) continue;
      ranges.push({ start: segmentStart + runs[index].index, end: segmentStart + runs[next].index + runs[next][0].length });
      index = next;
    }
    segmentStart = fence.end;
  }
  return ranges.sort((first, second) => first.start - second.start);
}

export function normalizeChatContent(content: string, references: unknown = []) {
  let missingCitations = false;
  let omittedRichContent = false;
  if (!content.includes('\uE200')) return { content, missingCitations, omittedRichContent };

  const resolved = new Map<string, SourceLink[]>();
  if (Array.isArray(references)) {
    for (const reference of references.slice(0, 2000)) {
      if (!record(reference) || typeof reference.matched_text !== 'string' || !reference.matched_text.startsWith('\uE200cite\uE202')) continue;
      const links = sourcesFrom(reference);
      if (links.length) resolved.set(reference.matched_text, links);
    }
  }
  const sourceNumbers = new Map<string, number>();
  const protectedRanges = codeRanges(content);
  let rangeIndex = 0;
  const normalized = content.replace(/\uE200([^\uE200\uE201\r\n]{1,20000})\uE201/g, (marker: string, payload: string, position: number) => {
    while (rangeIndex < protectedRanges.length && protectedRanges[rangeIndex].end <= position) rangeIndex += 1;
    if (protectedRanges[rangeIndex]?.start <= position) return marker;
    const [kind, detail] = payload.split('\uE202');
    if (kind === 'cite') {
      const sources = resolved.get(marker);
      if (!sources?.length) { missingCitations = true; return '〔来源未缓存〕'; }
      return sources.map((source) => {
        if (!sourceNumbers.has(source.url)) sourceNumbers.set(source.url, sourceNumbers.size + 1);
        const title = source.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `[来源 ${sourceNumbers.get(source.url)}](<${source.url}> "引用来源：${title}")`;
      }).join(' ');
    }
    if (kind === 'entity' && detail) {
      try {
        const entity: unknown = JSON.parse(detail);
        if (Array.isArray(entity) && typeof entity[1] === 'string') return entity[1].replace(/[\\`*_[\]<>]/g, '\\$&');
      } catch {}
    }
    omittedRichContent = true;
    if (['i', 'image', 'image_group'].includes(kind)) return '〔图片未缓存，请查看原始分享〕';
    return '〔交互内容未缓存，请查看原始分享〕';
  });
  return { content: normalized, missingCitations, omittedRichContent };
}

export function normalizeCachedExcerpt(excerpt: string) {
  return normalizeChatContent(excerpt).content.replace(/\uE200cite(?:\uE202[\w-]*)*$/, '〔来源未缓存〕');
}
