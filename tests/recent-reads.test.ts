import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecentReadsStore, MAX_RECENT_READS, parseRecentReads, RECENT_READS_KEY } from '../src/lib/recent-reads.js';

function archive(index: number, title = `阅读记录 ${index}`) {
  return { id: String(index).padStart(24, '0'), title, excerpt: '值得再次阅读的摘要', messageCount: 2 };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('本机最近阅读', () => {
  it('仅保存必要摘要，重新初始化后恢复，不保存正文、权限或绝对地址', () => {
    const storage = memoryStorage();
    const store = createRecentReadsStore(() => storage);
    const full = { ...archive(1), messages: [{ content: '私有正文不保存在阅读历史' }], isOwner: true, favorite: true, sourceUrl: 'https://example.com/private' };
    store.remember(full, '2026-09-06T10:00:00.000Z');
    const saved = JSON.parse(storage.getItem(RECENT_READS_KEY)!);
    assert.deepEqual(Object.keys(saved[0]).sort(), ['excerpt', 'id', 'lastReadAt', 'messageCount', 'title']);
    assert.deepEqual(createRecentReadsStore(() => storage).getSnapshot(), store.getSnapshot());
    assert.equal(store.getSnapshot().persistent, true);
  });

  it('重复阅读更新摘要与时间、按最近阅读排序，并限制 50 条', () => {
    const storage = memoryStorage();
    const store = createRecentReadsStore(() => storage);
    for (let index = 0; index < 55; index += 1) store.remember(archive(index), new Date(Date.UTC(2026, 8, 6, 10, 0, index)).toISOString());
    assert.equal(store.getSnapshot().entries.length, MAX_RECENT_READS);
    assert.equal(store.getSnapshot().entries[0].id, archive(54).id);
    assert.equal(store.getSnapshot().entries.at(-1)?.id, archive(5).id);
    store.remember(archive(5, '再次阅读更新了标题'), '2026-09-06T11:00:00.000Z');
    assert.equal(store.getSnapshot().entries.length, MAX_RECENT_READS);
    assert.equal(store.getSnapshot().entries[0].title, '再次阅读更新了标题');
    assert.equal(store.getSnapshot().entries.filter((entry) => entry.id === archive(5).id).length, 1);
  });

  it('忽略损坏数据、伪造路径和非法字段，摘要长度受限并保留最新重复项', () => {
    for (const raw of [null, '{broken', '{}', 'null', 'x'.repeat(200001)]) assert.deepEqual(parseRecentReads(raw), []);
    const valid = { ...archive(1), lastReadAt: '2026-09-06T10:00:00.000Z' };
    const parsed = parseRecentReads(JSON.stringify([
      { ...valid, id: '../../outside' },
      { ...valid, lastReadAt: 'invalid date' },
      { ...valid, messageCount: -1 },
      { ...valid, title: '' },
      null,
      valid,
      { ...valid, title: '新'.repeat(300), excerpt: '摘'.repeat(400), lastReadAt: '2026-09-06T11:00:00.000Z' },
    ]));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].title.length, 160);
    assert.equal(parsed[0].excerpt.length, 200);
    assert.equal(parsed[0].lastReadAt, '2026-09-06T11:00:00.000Z');
  });

  it('读取最新存储后再更新，多标签页同步新增、单条移除和清空', () => {
    const storage = memoryStorage();
    const first = createRecentReadsStore(() => storage);
    const second = createRecentReadsStore(() => storage);
    let notifications = 0;
    const unsubscribe = second.subscribe(() => { notifications += 1; });
    first.remember(archive(1));
    second.remember(archive(2));
    assert.equal(second.getSnapshot().entries.length, 2);
    first.sync();
    assert.equal(first.getSnapshot().entries.length, 2);
    first.remove(archive(1).id);
    second.sync();
    assert.deepEqual(second.getSnapshot().entries.map((entry) => entry.id), [archive(2).id]);
    storage.setItem('unrelated-setting', 'keep');
    first.clear();
    second.sync();
    assert.deepEqual(second.getSnapshot().entries, []);
    assert.equal(storage.getItem(RECENT_READS_KEY), null);
    assert.equal(storage.getItem('unrelated-setting'), 'keep');
    assert.equal(notifications, 3);
    unsubscribe();
    second.sync();
    assert.equal(notifications, 3);
  });

  it('本地存储被禁用时在内存保留，恢复权限后可再次持久化', () => {
    let blocked = true;
    const storage = memoryStorage();
    const store = createRecentReadsStore(() => {
      if (blocked) throw new Error('Storage blocked');
      return storage;
    });
    assert.equal(store.getSnapshot().persistent, false);
    store.remember(archive(1));
    store.remember(archive(2));
    assert.equal(store.getSnapshot().entries.length, 2);
    store.remove(archive(1).id);
    assert.equal(store.getSnapshot().entries.length, 1);
    blocked = false;
    store.remember(archive(3));
    assert.equal(store.getSnapshot().persistent, true);
    assert.equal(createRecentReadsStore(() => storage).getSnapshot().entries.length, 2);
  });

  it('写入配额不足时不丢失同一标签页内的连续阅读', () => {
    const storage = memoryStorage();
    const normal = createRecentReadsStore(() => storage);
    normal.remember(archive(1));
    const failedStorage = { ...storage, setItem: () => { throw new Error('Quota exceeded'); } };
    const store = createRecentReadsStore(() => failedStorage);
    store.remember(archive(2));
    store.remember(archive(3));
    assert.equal(store.getSnapshot().persistent, false);
    assert.equal(store.getSnapshot().entries.length, 3);
    assert.equal(parseRecentReads(storage.getItem(RECENT_READS_KEY)).length, 1);
  });
});
