import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { ParsedConversation } from '../shared/types.js';
import { ArchiveStore } from '../server/store.js';
import { MISSING_CITATION_WARNING } from '../shared/chat-content.js';
import { shareUrl, otherShareUrl } from './fixtures.js';

const conversation: ParsedConversation = { title: '测试缓存', messages: [{ id: 'one', role: 'user', content: 'Hello' }, { id: 'two', role: 'assistant', content: '**world**' }], model: null, warnings: [], parseMethod: 'next-data' };

describe('SQLite 存储', () => {
  it('旧缓存读取时清理裸露引用，保持缓存 ID、时间和权限不变', () => {
    const store = new ArchiveStore(':memory:');
    try {
      const legacy = { ...conversation, messages: [{ id: 'legacy', role: 'assistant' as const, content: '中文内容。\uE200cite\uE202turn593198view2\uE201' }] };
      const created = store.create('owner', shareUrl, legacy, 'link');
      const reread = store.get(created.id, 'owner');
      assert.equal(reread.id, created.id);
      assert.equal(reread.createdAt, created.createdAt);
      assert.equal(reread.isOwner, true);
      assert.equal(reread.messages[0].content, '中文内容。〔来源未缓存〕');
      assert.ok(reread.warnings.includes(MISSING_CITATION_WARNING));
      assert.ok(!store.list('owner').archives[0].excerpt.includes('\uE200'));
    } finally { store.close(); }
  });
  it('持久化保存，同一工作区去重，重启后仍能读取', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'shiguang-store-'));
    try {
      const filename = path.join(directory, 'archive.sqlite');
      const first = new ArchiveStore(filename);
      const archive = first.create('owner', shareUrl, conversation, 'link');
      assert.equal(first.create('owner', shareUrl, conversation, 'link').id, archive.id);
      first.close();
      const reopened = new ArchiveStore(filename);
      assert.deepEqual(reopened.get(archive.id, 'owner').messages, conversation.messages);
      assert.equal(reopened.list('owner').stats.total, 1);
      reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('隔离列表和管理权限，但允许持有缓存地址的人阅读', () => {
    const store = new ArchiveStore(':memory:');
    try {
      const archive = store.create('owner', shareUrl, conversation, 'html');
      assert.equal(store.list('visitor').stats.total, 0);
      assert.equal(store.get(archive.id, 'visitor').isOwner, false);
      assert.throws(() => store.setFavorite(archive.id, 'visitor', true), { code: 'ARCHIVE_NOT_FOUND' });
      assert.throws(() => store.delete(archive.id, 'visitor'), { code: 'ARCHIVE_NOT_FOUND' });
      store.setFavorite(archive.id, 'owner', true);
      assert.equal(store.list('owner').stats.favorites, 1);
      assert.equal(store.get(archive.id, 'visitor').favorite, false);
      store.delete(archive.id, 'owner');
      assert.throws(() => store.get(archive.id, 'owner'), { code: 'ARCHIVE_NOT_FOUND' });
    } finally { store.close(); }
  });

  it('限制工作区与实例容量，已存在的缓存仍可读取', () => {
    const store = new ArchiveStore(':memory:', 1, 2);
    try {
      store.create('owner', shareUrl, conversation, 'link');
      assert.throws(() => store.create('owner', otherShareUrl, conversation, 'link'), { code: 'WORKSPACE_FULL' });
      store.create('second', shareUrl, conversation, 'link');
      assert.throws(() => store.create('third', shareUrl, conversation, 'link'), { code: 'STORAGE_FULL' });
      assert.equal(store.list('owner').stats.messages, 2);
      assert.ok(store.list('owner').stats.bytes > 0);
    } finally { store.close(); }
  });
});
