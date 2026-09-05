import type { Archive } from '../../shared/types';

export const RECENT_READS_KEY = 'shiguang:recent-reads:v1';
export const MAX_RECENT_READS = 50;

export interface RecentRead {
  id: string;
  title: string;
  excerpt: string;
  messageCount: number;
  lastReadAt: string;
}

type ReadArchive = Pick<Archive, 'id' | 'title' | 'excerpt' | 'messageCount'>;
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface RecentReadsSnapshot { entries: RecentRead[]; persistent: boolean }

function normalizeEntry(value: unknown): RecentRead | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== 'string' || !/^[\w-]{24}$/.test(entry.id) || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.excerpt !== 'string') return null;
  if (typeof entry.messageCount !== 'number' || !Number.isInteger(entry.messageCount) || entry.messageCount < 1 || entry.messageCount > 1000) return null;
  if (typeof entry.lastReadAt !== 'string' || entry.lastReadAt.length > 32 || !Number.isFinite(Date.parse(entry.lastReadAt))) return null;
  return { id: entry.id, title: entry.title.trim().slice(0, 160), excerpt: entry.excerpt.slice(0, 200), messageCount: entry.messageCount, lastReadAt: new Date(entry.lastReadAt).toISOString() };
}

function recentFirst(entries: RecentRead[]): RecentRead[] {
  const sorted = [...entries].sort((first, second) => second.lastReadAt.localeCompare(first.lastReadAt));
  const unique = new Map<string, RecentRead>();
  for (const entry of sorted) if (!unique.has(entry.id)) unique.set(entry.id, entry);
  return [...unique.values()].slice(0, MAX_RECENT_READS);
}

export function parseRecentReads(raw: string | null): RecentRead[] {
  if (!raw || raw.length > 200000) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return recentFirst(data.slice(0, 1000).map(normalizeEntry).filter((entry): entry is RecentRead => entry !== null));
  } catch { return []; }
}

export function createRecentReadsStore(getStorage: () => BrowserStorage) {
  function read(): RecentRead[] | null {
    try { return parseRecentReads(getStorage().getItem(RECENT_READS_KEY)); }
    catch { return null; }
  }

  const initial = read();
  let snapshot: RecentReadsSnapshot = { entries: initial || [], persistent: initial !== null };
  const listeners = new Set<() => void>();

  function publish(next: RecentReadsSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function update(change: (entries: RecentRead[]) => RecentRead[]) {
    const current = snapshot.persistent ? read() ?? snapshot.entries : snapshot.entries;
    const entries = change(current);
    let persistent = true;
    try {
      const storage = getStorage();
      if (entries.length) storage.setItem(RECENT_READS_KEY, JSON.stringify(entries));
      else storage.removeItem(RECENT_READS_KEY);
    } catch { persistent = false; }
    publish({ entries, persistent });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    remember: (archive: ReadArchive, lastReadAt = new Date().toISOString()) => {
      const entry = normalizeEntry({ id: archive.id, title: archive.title, excerpt: archive.excerpt, messageCount: archive.messageCount, lastReadAt });
      if (entry) update((entries) => recentFirst([entry, ...entries.filter((previous) => previous.id !== entry.id)]));
    },
    remove: (id: string) => update((entries) => entries.filter((entry) => entry.id !== id)),
    clear: () => update(() => []),
    sync: () => {
      const entries = read();
      if (entries !== null) publish({ entries, persistent: true });
      else publish({ ...snapshot, persistent: false });
    },
  };
}
