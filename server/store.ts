import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AdminArchiveList, Archive, ArchiveList, ArchiveSummary, ParsedConversation } from '../shared/types.js';
import { MISSING_CITATION_WARNING, normalizeCachedExcerpt, normalizeChatContent, RICH_CONTENT_WARNING } from '../shared/chat-content.js';
import { AppError } from './errors.js';

interface ArchiveRow {
  id: string;
  owner_key: string;
  source_url: string;
  title: string;
  excerpt: string;
  created_at: string;
  message_count: number;
  byte_size: number;
  favorite: number;
  model: string | null;
  import_method: 'link' | 'html';
  content: string;
}

export class ArchiveStore {
  private database: DatabaseSync;

  constructor(filename: string, private maxArchives = 500, private maxTotalArchives = 10000) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS archives (
        id TEXT PRIMARY KEY,
        owner_key TEXT NOT NULL,
        source_url TEXT NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        byte_size INTEGER NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        import_method TEXT NOT NULL,
        content TEXT NOT NULL,
        UNIQUE(owner_key, source_url)
      );
      CREATE INDEX IF NOT EXISTS archives_owner_date ON archives(owner_key, created_at DESC);
    `);
  }

  private summarize(row: ArchiveRow): ArchiveSummary {
    return {
      id: row.id,
      title: row.title,
      excerpt: normalizeCachedExcerpt(row.excerpt),
      sourceUrl: row.source_url,
      createdAt: row.created_at,
      messageCount: row.message_count,
      byteSize: row.byte_size,
      favorite: Boolean(row.favorite),
      model: row.model,
      importMethod: row.import_method,
    };
  }

  private hydrate(row: ArchiveRow, ownerKey: string): Archive {
    const content = JSON.parse(row.content) as ParsedConversation;
    const warnings = new Set(content.warnings);
    const messages = content.messages.map((message) => {
      const normalized = normalizeChatContent(message.content);
      if (normalized.missingCitations) warnings.add(MISSING_CITATION_WARNING);
      if (normalized.omittedRichContent) warnings.add(RICH_CONTENT_WARNING);
      return { ...message, content: normalized.content };
    });
    return {
      ...this.summarize(row),
      favorite: row.owner_key === ownerKey ? Boolean(row.favorite) : false,
      messages,
      warnings: [...warnings],
      parseMethod: content.parseMethod,
      isOwner: row.owner_key === ownerKey,
    };
  }

  list(ownerKey: string): ArchiveList {
    const rows = this.database.prepare('SELECT id, title, excerpt, source_url, created_at, message_count, byte_size, favorite, model, import_method FROM archives WHERE owner_key = ? ORDER BY created_at DESC, rowid DESC').all(ownerKey) as unknown as ArchiveRow[];
    const archives = rows.map((row) => this.summarize(row));
    return {
      archives,
      stats: {
        total: archives.length,
        favorites: archives.filter((archive) => archive.favorite).length,
        messages: archives.reduce((total, archive) => total + archive.messageCount, 0),
        bytes: archives.reduce((total, archive) => total + archive.byteSize, 0),
      },
    };
  }

  get(id: string, ownerKey: string): Archive {
    const row = this.database.prepare('SELECT * FROM archives WHERE id = ?').get(id) as unknown as ArchiveRow | undefined;
    if (!row) throw new AppError(404, 'ARCHIVE_NOT_FOUND', '这份缓存不存在，或已被创建者删除。');
    return this.hydrate(row, ownerKey);
  }

  listAll(query: string, requestedPage: number, pageSize: number): AdminArchiveList {
    const filter = "WHERE instr(lower(title), lower(?)) > 0 OR instr(lower(source_url), lower(?)) > 0 OR instr(id, ?) > 0";
    const { total } = this.database.prepare(`SELECT COUNT(*) AS total FROM archives ${filter}`).get(query, query, query) as { total: number };
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const rows = this.database.prepare(`SELECT id, title, excerpt, source_url, created_at, message_count, byte_size, favorite, model, import_method FROM archives ${filter} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(query, query, query, pageSize, (page - 1) * pageSize) as unknown as ArchiveRow[];
    const stats = this.database.prepare('SELECT COUNT(*) AS total, COUNT(DISTINCT owner_key) AS workspaces, COALESCE(SUM(message_count), 0) AS messages, COALESCE(SUM(byte_size), 0) AS bytes FROM archives').get() as AdminArchiveList['stats'];
    return { archives: rows.map((row) => this.summarize(row)), page, pageSize, total, stats };
  }

  deleteAny(id: string) {
    const result = this.database.prepare('DELETE FROM archives WHERE id = ?').run(id);
    if (!result.changes) throw new AppError(404, 'ARCHIVE_NOT_FOUND', '这份缓存不存在，或已被删除。');
  }

  findBySource(ownerKey: string, sourceUrl: string): Archive | undefined {
    const row = this.database.prepare('SELECT * FROM archives WHERE owner_key = ? AND source_url = ?').get(ownerKey, sourceUrl) as unknown as ArchiveRow | undefined;
    return row ? this.hydrate(row, ownerKey) : undefined;
  }

  assertCapacity(ownerKey: string) {
    const owned = this.database.prepare('SELECT COUNT(*) AS total FROM archives WHERE owner_key = ?').get(ownerKey) as { total: number };
    if (owned.total >= this.maxArchives) throw new AppError(409, 'WORKSPACE_FULL', `已达到 ${this.maxArchives} 份缓存上限，请先删除不再需要的存档。`);
    const global = this.database.prepare('SELECT COUNT(*) AS total FROM archives').get() as { total: number };
    if (global.total >= this.maxTotalArchives) throw new AppError(507, 'STORAGE_FULL', '此实例已达到存档数量上限，请联系部署者清理空间。');
  }

  create(ownerKey: string, sourceUrl: string, conversation: ParsedConversation, method: 'link' | 'html'): Archive {
    const existing = this.findBySource(ownerKey, sourceUrl);
    if (existing) return existing;
    this.assertCapacity(ownerKey);
    const id = randomBytes(18).toString('base64url');
    const content = JSON.stringify(conversation);
    const excerptMessage = conversation.messages.find((message) => message.role === 'assistant') || conversation.messages[0];
    const excerpt = normalizeChatContent(excerptMessage.content).content.replace(/```[\s\S]*?```/g, '[代码片段]').replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]').replace(/\[([^\]]+)\]\((?:<[^>]*>|[^)\s]+)(?:\s+"(?:\\.|[^"\\])*")?\)/g, '$1').replace(/[#*>`_~\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    this.database.prepare(`INSERT INTO archives
      (id, owner_key, source_url, title, excerpt, created_at, message_count, byte_size, model, import_method, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ownerKey, sourceUrl, conversation.title, excerpt, new Date().toISOString(), conversation.messages.length, Buffer.byteLength(content), conversation.model, method, content);
    return this.get(id, ownerKey);
  }

  setFavorite(id: string, ownerKey: string, favorite: boolean) {
    const result = this.database.prepare('UPDATE archives SET favorite = ? WHERE id = ? AND owner_key = ?').run(favorite ? 1 : 0, id, ownerKey);
    if (!result.changes) throw new AppError(404, 'ARCHIVE_NOT_FOUND', '未找到属于当前浏览器的缓存。');
    return this.get(id, ownerKey);
  }

  delete(id: string, ownerKey: string) {
    const result = this.database.prepare('DELETE FROM archives WHERE id = ? AND owner_key = ?').run(id, ownerKey);
    if (!result.changes) throw new AppError(404, 'ARCHIVE_NOT_FOUND', '未找到属于当前浏览器的缓存。');
  }

  close() {
    this.database.close();
  }
}
