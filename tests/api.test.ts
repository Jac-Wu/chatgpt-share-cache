import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { ArchiveStore } from '../server/store.js';
import { conversationData, nextHtml, referencePayload, shareUrl, singleShareData, singleShareUrl, streamHtml } from './fixtures.js';

describe('缓存 API', () => {
  let store: ArchiveStore;
  let app: ReturnType<typeof createApp>;
  let fetches: number;
  beforeEach(() => {
    store = new ArchiveStore(':memory:');
    fetches = 0;
    app = createApp({ store, config: { ...readConfig(), allowedHosts: ['archive.example.com'], trustProxy: false }, production: true, disableRateLimit: true, fetchHtml: async () => { fetches += 1; return nextHtml(); } });
  });
  afterEach(() => store.close());

  it('未配置域名时仅允许 localhost 与 IP，示例域名也必须显式授权', async () => {
    const localApp = createApp({ store, config: { ...readConfig(), allowedHosts: [], trustProxy: false }, disableRateLimit: true });
    for (const host of ['localhost:3000', '192.168.1.2:3000', '[::1]:3000']) {
      await request(localApp).get('/api/health').set('Host', host).expect(200);
    }
    await request(localApp).get('/api/health').set('Host', 'archive.example.com').expect(403);
  });

  it('单条分享支持自动抓取、稳定去重、引用读取和干净导出', async () => {
    const singleApp = createApp({ store, config: { ...readConfig(), allowedHosts: ['archive.example.com'], trustProxy: false }, disableRateLimit: true, fetchHtml: async (url) => {
      assert.equal(url, singleShareUrl);
      fetches += 1;
      return streamHtml([referencePayload(singleShareData())]);
    } });
    const owner = request.agent(singleApp).set('Host', 'localhost:3000');
    await owner.get('/api/archives').expect(200);
    const created = await owner.post('/api/archives').set('X-Requested-With', 'Shiguang').send({ url: singleShareUrl }).expect(201);
    assert.equal(created.body.archive.messageCount, 1);
    assert.equal(created.body.archive.sourceUrl, singleShareUrl);
    const repeated = await owner.post('/api/archives').set('X-Requested-With', 'Shiguang').send({ url: `${singleShareUrl}?tracking=true` }).expect(200);
    assert.equal(repeated.body.cacheUrl, created.body.cacheUrl);
    const exported = await owner.get(`/api/archives/${created.body.archive.id}/export`).expect(200);
    assert.ok(exported.text.includes('https://example.com/source-a'));
    assert.ok(exported.text.includes('来源未缓存'));
    assert.ok(!exported.text.includes('\uE200'));
    assert.equal(fetches, 1);
  });

  it('HTML 导入的单条回复同样还原来源', async () => {
    const owner = request.agent(app).set('Host', 'localhost:3000');
    const created = await owner.post('/api/archives/import').set('X-Requested-With', 'Shiguang').send({ url: singleShareUrl, html: streamHtml([referencePayload(singleShareData())]) }).expect(201);
    assert.equal(created.body.archive.messageCount, 1);
    assert.ok(created.body.archive.messages[0].content.includes('引用来源：'));
    assert.equal(fetches, 0);
  });

  it('生成固定地址，重复请求命中缓存，重读不访问上游', async () => {
    const owner = request.agent(app).set('Host', 'localhost:3000');
    await owner.get('/api/archives').expect(200);
    const created = await owner.post('/api/archives').set('X-Requested-With', 'Shiguang').send({ url: shareUrl }).expect(201);
    assert.equal(created.body.archive.title, conversationData.title);
    assert.equal(created.body.archive.isOwner, true);
    assert.match(created.body.cacheUrl, /^http:\/\/localhost:3000\/c\/[\w-]{24}$/);
    const repeated = await owner.post('/api/archives').set('X-Requested-With', 'Shiguang').send({ url: `${shareUrl}?tracking=true` }).expect(200);
    assert.equal(repeated.body.cached, true);
    assert.equal(repeated.body.cacheUrl, created.body.cacheUrl);
    const freshReader = await request(app).get(`/api/archives/${created.body.archive.id}`).expect(200);
    assert.equal(freshReader.body.isOwner, false);
    assert.equal(fetches, 1);
    assert.ok(!JSON.stringify(freshReader.body).includes('owner_key'));
  });

  it('支持 HTML 导入、列表、收藏、导出和删除', async () => {
    const owner = request.agent(app).set('Host', 'localhost:3000');
    await owner.get('/api/archives').expect(200);
    const created = await owner.post('/api/archives/import').set('X-Requested-With', 'Shiguang').send({ url: shareUrl, html: nextHtml() }).expect(201);
    const id = created.body.archive.id as string;
    assert.equal(fetches, 0);
    assert.equal(created.body.archive.importMethod, 'html');
    const listing = await owner.get('/api/archives').expect(200);
    assert.equal(listing.body.stats.total, 1);
    assert.equal(listing.body.stats.messages, 2);
    await owner.patch(`/api/archives/${id}`).set('X-Requested-With', 'Shiguang').send({ favorite: true }).expect(200);
    const exported = await owner.get(`/api/archives/${id}/export`).expect(200);
    assert.match(exported.headers['content-disposition'], /attachment/);
    assert.ok(exported.text.includes(conversationData.title));
    await owner.delete(`/api/archives/${id}`).set('X-Requested-With', 'Shiguang').expect(204);
    await owner.get(`/api/archives/${id}`).expect(404);
  });

  it('拒绝跨来源请求、无效 JSON、非法地址和非所有者操作', async () => {
    const owner = request.agent(app).set('Host', 'localhost:3000');
    await owner.post('/api/archives').send({ url: shareUrl }).expect(403);
    await owner.post('/api/archives').set('X-Requested-With', 'Shiguang').set('Origin', 'https://evil.test').send({ url: shareUrl }).expect(403);
    await owner.post('/api/archives').set('X-Requested-With', 'Shiguang').send({ url: 'http://127.0.0.1/secret' }).expect(400);
    await owner.post('/api/archives').set('X-Requested-With', 'Shiguang').set('Content-Type', 'application/json').send('{bad').expect(400);
    const created = await owner.post('/api/archives/import').set('X-Requested-With', 'Shiguang').send({ url: shareUrl, html: nextHtml() }).expect(201);
    await request(app).delete(`/api/archives/${created.body.archive.id}`).set('X-Requested-With', 'Shiguang').expect(404);
    const other = await request(app).get('/api/archives').expect(200);
    assert.equal(other.body.stats.total, 0);
  });

  it('同一工作区同时提交只抓取一次', async () => {
    const owner = request.agent(app).set('Host', 'localhost:3000');
    await owner.get('/api/archives').expect(200);
    const responses = await Promise.all([1, 2].map(() => owner.post('/api/archives').set('X-Requested-With', 'Shiguang').send({ url: shareUrl })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
    assert.equal(responses[0].body.cacheUrl, responses[1].body.cacheUrl);
    assert.equal(fetches, 1);
  });

  it('安全响应头禁止外部脚本和框架，拒绝未授权 Host', async () => {
    await request(app).post('/api/archives/import').set('Host', 'evil.test').set('X-Requested-With', 'Shiguang').send({ url: shareUrl, html: nextHtml() }).expect(403);
    const result = await request(app).post('/api/archives/import').set('Host', 'localhost:3000').set('X-Requested-With', 'Shiguang').send({ url: shareUrl, html: nextHtml() }).expect(201);
    assert.ok(result.body.cacheUrl.startsWith('http://localhost:3000/'));
    assert.ok(result.headers['content-security-policy'].includes("script-src 'self'"));
    assert.ok(result.headers['content-security-policy'].includes("frame-ancestors 'none'"));
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['referrer-policy'], 'no-referrer');
    assert.ok(result.headers['set-cookie'][0].includes('HttpOnly'));
  });

  it('地址跟随当前域名、IPv4、IPv6 和端口，命中缓存不保留旧地址', async () => {
    const owner = request.agent(app);
    let archiveId: string | undefined;
    for (const host of ['archive.example.com', '192.168.1.2:3000', 'localhost:8080', '[::1]:3000']) {
      const created = await owner.post('/api/archives/import').set('Host', host).set('Origin', `http://${host}`).set('X-Requested-With', 'Shiguang').send({ url: shareUrl, html: nextHtml() }).expect(archiveId ? 200 : 201);
      archiveId ||= created.body.archive.id as string;
      assert.equal(created.body.archive.id, archiveId);
      assert.equal(created.body.cacheUrl, `http://${host}${created.body.cachePath}`);
      assert.equal(created.headers['strict-transport-security'], undefined);
      assert.ok(!created.headers['content-security-policy'].includes('upgrade-insecure-requests'));
    }
  });

  it('动态地址仍严格拒绝跨域、跨端口、跨协议与不透明来源', async () => {
    for (const origin of ['https://evil.test', 'http://localhost:3000', 'http://archive.example.com:8080', 'https://archive.example.com', 'null']) {
      const denied = await request(app).post('/api/archives').set('Host', 'archive.example.com').set('Origin', origin).set('X-Requested-With', 'Shiguang').send({ url: shareUrl }).expect(403);
      assert.equal(denied.body.code, 'ORIGIN_REJECTED');
    }
    assert.equal(fetches, 0);
  });

  it('不信任代理时忽略伪造转发头，不能改变返回地址或 Cookie 安全属性', async () => {
    const created = await request(app).post('/api/archives/import').set('Host', 'archive.example.com').set('X-Forwarded-Host', 'evil.test').set('X-Forwarded-Proto', 'https').set('Origin', 'http://archive.example.com').set('X-Requested-With', 'Shiguang').send({ url: shareUrl, html: nextHtml() }).expect(201);
    assert.equal(created.body.cacheUrl, `http://archive.example.com${created.body.cachePath}`);
    assert.ok(!created.headers['set-cookie'][0].includes('Secure'));
    assert.equal(created.headers['strict-transport-security'], undefined);
  });

  it('可信 HTTPS 反向代理还原公开地址，并按请求切换安全响应头和 Cookie', async () => {
    const proxiedApp = createApp({ store, config: { ...readConfig(), allowedHosts: ['archive.example.com'], trustProxy: 'loopback' }, production: true, disableRateLimit: true });
    const created = await request(proxiedApp).post('/api/archives/import').set('Host', '127.0.0.1:3000').set('X-Forwarded-Host', 'archive.example.com:8443').set('X-Forwarded-Proto', 'https').set('Origin', 'https://archive.example.com:8443').set('X-Requested-With', 'Shiguang').send({ url: shareUrl, html: nextHtml() }).expect(201);
    assert.equal(created.body.cacheUrl, `https://archive.example.com:8443${created.body.cachePath}`);
    assert.ok(created.headers['set-cookie'][0].includes('Secure'));
    assert.ok(created.headers['strict-transport-security']);
    assert.ok(created.headers['content-security-policy'].includes('upgrade-insecure-requests'));
    const direct = await request(proxiedApp).get('/api/archives').set('Host', '192.168.1.2:3000').expect(200);
    assert.ok(!direct.headers['set-cookie'][0].includes('Secure'));
    assert.equal(direct.headers['strict-transport-security'], undefined);
    assert.ok(!direct.headers['content-security-policy'].includes('upgrade-insecure-requests'));
  });

  it('拒绝非法 Host、协议和含糊的代理转发头', async () => {
    for (const host of ['user@archive.example.com', 'archive.example.com/path', 'archive.example.com:invalid', 'archive.example.com,evil.test']) {
      await request(app).get('/api/archives').set('Host', host).expect(400);
    }
    const proxiedApp = createApp({ store, config: { ...readConfig(), allowedHosts: ['archive.example.com'], trustProxy: 'loopback' }, disableRateLimit: true });
    for (const [header, value, status] of [
      ['X-Forwarded-Host', 'evil.test', 403],
      ['X-Forwarded-Host', 'archive.example.com,evil.test', 400],
      ['X-Forwarded-Proto', 'javascript', 400],
      ['X-Forwarded-Proto', 'https,http', 400],
    ] as const) {
      await request(proxiedApp).get('/api/archives').set('Host', 'archive.example.com').set(header, value).expect(status);
    }
  });
});
