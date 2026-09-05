import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { AdminSessions } from '../server/admin.js';
import { createApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { ArchiveStore } from '../server/store.js';
import type { ParsedConversation } from '../shared/types.js';
import { shareUrl } from './fixtures.js';

const secret = 'test-only-admin-secret-with-at-least-32-characters';
const conversation: ParsedConversation = { title: '第一份管理测试', messages: [{ id: 'test', role: 'assistant', content: '测试正文' }], model: null, warnings: [], parseMethod: 'next-data' };

describe('管理密钥与会话', () => {
  it('密钥未配置时禁用，弱密钥和过长密钥拒绝启动且不泄露密钥', () => {
    const previous = process.env.ADMIN_SECRET;
    try {
      delete process.env.ADMIN_SECRET;
      assert.equal(readConfig().adminSecret, undefined);
      for (const value of ['short-secret', ' '.repeat(40), 'x'.repeat(513)]) {
        process.env.ADMIN_SECRET = value;
        assert.throws(() => readConfig(), (error: unknown) => error instanceof Error && error.message.includes('ADMIN_SECRET') && !error.message.includes(value));
      }
      process.env.ADMIN_SECRET = secret;
      assert.equal(readConfig().adminSecret, secret);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = previous;
    }
  });

  it('校验密钥，随机会话绑定访问地址，8 小时到期且退出不可重放', () => {
    let now = 1000;
    const sessions = new AdminSessions(secret, () => now);
    assert.equal(sessions.verify(secret), true);
    for (const value of [null, {}, '', 'wrong', 'x'.repeat(513)]) assert.equal(sessions.verify(value), false);
    const session = sessions.create('https://archive.example.com');
    const second = sessions.create('https://archive.example.com');
    assert.match(session.token, /^[a-f\d]{64}$/);
    assert.notEqual(session.token, second.token);
    assert.ok(sessions.get(session.token, 'https://archive.example.com'));
    assert.equal(sessions.get(session.token, 'http://archive.example.com'), undefined);
    assert.equal(sessions.get('forged', 'https://archive.example.com'), undefined);
    sessions.revoke(session.token);
    assert.equal(sessions.get(session.token, 'https://archive.example.com'), undefined);
    now += 8 * 60 * 60 * 1000;
    assert.equal(sessions.get(second.token, 'https://archive.example.com'), undefined);
  });

  it('重启和密钥轮换不接受旧会话；会话数量有上限且过期会话可回收', () => {
    let now = 0;
    const sessions = new AdminSessions(secret, () => now);
    const session = sessions.create('http://localhost');
    for (const value of [secret, `${secret}-rotated`]) assert.equal(new AdminSessions(value).get(session.token, 'http://localhost'), undefined);
    for (let index = 1; index < 1000; index += 1) sessions.create('http://localhost');
    assert.throws(() => sessions.create('http://localhost'), { code: 'ADMIN_SESSION_LIMIT' });
    now += 8 * 60 * 60 * 1000;
    assert.ok(sessions.create('http://localhost'));
  });
});

describe('管理 API', () => {
  let store: ArchiveStore;
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    store = new ArchiveStore(':memory:');
    app = createApp({ store, config: { ...readConfig(), allowedHosts: ['archive.example.com'], adminSecret: secret, trustProxy: false }, production: true, disableRateLimit: true });
  });
  afterEach(() => store.close());

  const agentFor = (target: ReturnType<typeof createApp>) => request.agent(target).set('Host', 'localhost:3000');
  const login = (agent: ReturnType<typeof agentFor>, value = secret) => agent.post('/api/admin/login').set('X-Requested-With', 'Shiguang').send({ secret: value });

  it('未配置密钥时所有管理接口关闭，普通缓存不受影响', async () => {
    const disabled = createApp({ store, config: { ...readConfig(), allowedHosts: ['archive.example.com'], adminSecret: undefined }, disableRateLimit: true });
    const agent = agentFor(disabled);
    for (const path of ['/api/admin/session', '/api/admin/archives']) {
      const result = await agent.get(path).expect(503);
      assert.equal(result.body.code, 'ADMIN_DISABLED');
      assert.equal(result.headers['cache-control'], 'no-store');
    }
    await login(agent).expect(503);
    await agent.delete('/api/admin/archives/anything').set('X-Requested-With', 'Shiguang').expect(503);
    await agent.get('/api/archives').expect(200);
  });

  it('未登录与伪造 Cookie 不能枚举或删除全站数据', async () => {
    const archive = store.create('owner-one', shareUrl, conversation, 'html');
    const agent = agentFor(app);
    await agent.get('/api/admin/archives').expect(401);
    await agent.get('/api/admin/session').set('Cookie', `shiguang_admin=${'a'.repeat(64)}`).expect(401);
    await agent.delete(`/api/admin/archives/${archive.id}`).set('X-Requested-With', 'Shiguang').expect(401);
    const result = await login(agent, 'wrong').expect(401);
    assert.equal(result.body.code, 'ADMIN_INVALID_SECRET');
    assert.ok(!JSON.stringify(result.body).includes(secret));
    assert.ok(store.get(archive.id, 'owner-one'));
  });

  it('密钥只用于登录，使用独立 HttpOnly Cookie，重新登录轮换令牌并退出撤销', async () => {
    const agent = agentFor(app);
    const loggedIn = await login(agent).expect(200);
    const cookie = (loggedIn.headers['set-cookie'] as unknown as string[]).find((value) => value.startsWith('shiguang_admin='))!;
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Path=/api/admin', 'Max-Age=28800']) assert.ok(cookie.includes(flag));
    assert.ok(!cookie.includes('Secure'));
    assert.ok(!cookie.includes(secret));
    assert.deepEqual(Object.keys(loggedIn.body), ['expiresAt']);
    await agent.get('/api/admin/session').expect(200);
    await login(agent).expect(200);
    await request(app).get('/api/admin/archives').set('Host', 'localhost:3000').set('Cookie', cookie.split(';')[0]).expect(401);
    const session = await agent.get('/api/admin/archives').expect(200);
    assert.equal(session.headers['cache-control'], 'no-store');
    await agent.delete('/api/admin/session').set('X-Requested-With', 'Shiguang').expect(204);
    await agent.get('/api/admin/archives').expect(401);
  });

  it('只在可信 HTTPS 代理下设置 Secure Cookie，拒绝跨协议会话重放', async () => {
    const proxied = createApp({ store, config: { ...readConfig(), allowedHosts: ['archive.example.com'], adminSecret: secret, trustProxy: 'loopback' }, production: true, disableRateLimit: true });
    const result = await request(proxied).post('/api/admin/login').set('Host', '127.0.0.1:3000').set('X-Forwarded-Host', 'archive.example.com').set('X-Forwarded-Proto', 'https').set('Origin', 'https://archive.example.com').set('X-Requested-With', 'Shiguang').send({ secret }).expect(200);
    const cookie = (result.headers['set-cookie'] as unknown as string[]).find((value) => value.startsWith('shiguang_admin='))!;
    assert.ok(cookie.includes('Secure'));
    await request(proxied).get('/api/admin/session').set('Host', '127.0.0.1:3000').set('X-Forwarded-Host', 'archive.example.com').set('X-Forwarded-Proto', 'https').set('Cookie', cookie.split(';')[0]).expect(200);
    await request(proxied).get('/api/admin/session').set('Host', 'archive.example.com').set('Cookie', cookie.split(';')[0]).expect(401);
  });

  it('登录、删除和退出都要求同源写请求', async () => {
    const archive = store.create('owner-one', shareUrl, conversation, 'html');
    const agent = agentFor(app);
    await agent.post('/api/admin/login').send({ secret }).expect(403);
    await agent.post('/api/admin/login').set('X-Requested-With', 'Shiguang').set('Origin', 'https://evil.test').send({ secret }).expect(403);
    await login(agent).expect(200);
    for (const path of [`/api/admin/archives/${archive.id}`, '/api/admin/session']) {
      await agent.delete(path).expect(403);
      await agent.delete(path).set('X-Requested-With', 'Shiguang').set('Origin', 'http://localhost:3001').expect(403);
    }
    await agent.get('/api/admin/session').expect(200);
    assert.ok(store.get(archive.id, 'owner-one'));
  });

  it('跨工作区分页、搜索与全站统计不泄露身份或正文，不授予普通接口管理权', async () => {
    const first = store.create('private-owner-one', shareUrl, conversation, 'html');
    const second = store.create('private-owner-two', shareUrl, { ...conversation, title: '第二份 100%_cache' }, 'link');
    const agent = agentFor(app);
    await login(agent).expect(200);
    const list = await agent.get('/api/admin/archives?pageSize=1').expect(200);
    assert.equal(list.body.total, 2);
    assert.equal(list.body.stats.workspaces, 2);
    assert.equal(list.body.stats.messages, 2);
    assert.equal(list.body.archives.length, 1);
    assert.equal(list.body.archives[0].id, second.id);
    const next = await agent.get('/api/admin/archives?pageSize=1&page=2').expect(200);
    assert.equal(next.body.archives[0].id, first.id);
    const filtered = await agent.get('/api/admin/archives').query({ q: '100%_' }).expect(200);
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.stats.total, 2);
    assert.equal(filtered.body.archives[0].id, second.id);
    const byId = await agent.get('/api/admin/archives').query({ q: first.id }).expect(200);
    assert.equal(byId.body.total, 1);
    const byUrl = await agent.get('/api/admin/archives').query({ q: shareUrl }).expect(200);
    assert.equal(byUrl.body.total, 2);
    const injection = await agent.get('/api/admin/archives').query({ q: "' OR 1=1 --" }).expect(200);
    assert.equal(injection.body.total, 0);
    assert.equal(injection.body.page, 1);
    const encoded = JSON.stringify(list.body);
    for (const field of ['owner_key', 'ownerKey', 'private-owner', 'content']) assert.ok(!encoded.includes(field));
    assert.equal(Object.hasOwn(list.body.archives[0], 'messages'), false);
    const owned = await agent.get('/api/archives').expect(200);
    assert.equal(owned.body.stats.total, 0);
    await agent.delete(`/api/archives/${first.id}`).set('X-Requested-With', 'Shiguang').expect(404);
    await agent.patch(`/api/archives/${first.id}`).set('X-Requested-With', 'Shiguang').send({ favorite: true }).expect(404);
  });

  it('管理删除使公开地址和导出失效，分页自动回退到最后有效页', async () => {
    const first = store.create('owner-one', shareUrl, conversation, 'html');
    const second = store.create('owner-two', shareUrl, conversation, 'html');
    const agent = agentFor(app);
    await login(agent).expect(200);
    await agent.delete(`/api/admin/archives/${second.id}`).set('X-Requested-With', 'Shiguang').expect(204);
    await request(app).get(`/api/archives/${second.id}`).expect(404);
    await request(app).get(`/api/archives/${second.id}/export`).expect(404);
    const listing = await agent.get('/api/admin/archives?pageSize=1&page=2').expect(200);
    assert.equal(listing.body.page, 1);
    assert.equal(listing.body.stats.workspaces, 1);
    assert.equal(listing.body.archives[0].id, first.id);
    await agent.delete(`/api/admin/archives/${second.id}`).set('X-Requested-With', 'Shiguang').expect(404);
    await agent.delete(`/api/admin/archives/${first.id}`).set('X-Requested-With', 'Shiguang').expect(204);
    const empty = await agent.get('/api/admin/archives').expect(200);
    assert.deepEqual(empty.body.stats, { total: 0, workspaces: 0, messages: 0, bytes: 0 });
  });

  it('拒绝非法分页、重复参数、过长搜索与异常登录正文', async () => {
    const agent = agentFor(app);
    await login(agent).expect(200);
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=NaN', 'page=1000001', 'pageSize=101', 'page=1&page=2', 'q=a&q=b', `q=${'x'.repeat(201)}`]) {
      await agent.get(`/api/admin/archives?${query}`).expect(400);
    }
    await agent.post('/api/admin/login').set('X-Requested-With', 'Shiguang').set('Content-Type', 'application/json').send('{').expect(400);
    await login(agent, 'x'.repeat(5000)).expect(413);
    await agent.post('/api/admin/login').set('X-Requested-With', 'Shiguang').send({ secret: {} }).expect(401);
  });

  it('每 IP 15 分钟最多 10 次失败登录，正确密钥也不能绕过锁定', async () => {
    const limited = createApp({ store, config: { ...readConfig(), allowedHosts: ['archive.example.com'], adminSecret: secret, trustProxy: false } });
    const agent = agentFor(limited);
    for (let attempt = 0; attempt < 10; attempt += 1) await login(agent, 'wrong').expect(401);
    const result = await login(agent).expect(429);
    assert.equal(result.body.code, 'ADMIN_RATE_LIMITED');
    assert.ok(result.headers['retry-after']);
    await agent.get('/api/admin/archives').expect(401);
  });
});
