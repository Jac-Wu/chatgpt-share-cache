import { expect, test, type APIRequestContext } from '@playwright/test';
import type { CreateArchiveResult } from '../../shared/types';
import { RECENT_READS_KEY } from '../../src/lib/recent-reads';
import { conversationData, nextHtml, otherShareUrl, shareUrl } from '../fixtures';

async function createArchive(request: APIRequestContext, title: string, url = shareUrl) {
  const response = await request.post('/api/archives/import', {
    headers: { 'X-Requested-With': 'Shiguang' },
    data: { url, html: nextHtml({ ...conversationData, title }, url) },
  });
  expect(response.status()).toBe(201);
  return await response.json() as CreateArchiveResult;
}

test('访客回到首页可继续阅读，刷新后保留，重复阅读置顶且不授予管理权限', async ({ page, context, request }, info) => {
  const first = await createArchive(request, '访客读过的第一段对话');
  const second = await createArchive(request, '访客读过的第二段对话', otherShareUrl);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const archive of [first, second]) {
    await page.goto(archive.cachePath);
    await expect(page.getByRole('heading', { name: archive.archive.title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '收藏对话', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: '返回首页', exact: true }).click();
    await expect(page.getByRole('region', { name: '最近阅读', exact: true })).toBeVisible();
  }
  await expect(page.locator('.recent-read-card')).toHaveCount(2);
  await expect(page.locator('.recent-read-card').first()).toContainText(second.archive.title);
  await expect(page.locator('.archive-card')).toHaveCount(0);
  const library = await (await context.request.get('/api/archives')).json();
  expect(library.stats.total).toBe(0);
  expect((await context.request.delete(`/api/archives/${first.archive.id}`, { headers: { 'X-Requested-With': 'Shiguang' } })).status()).toBe(404);
  await page.reload();
  await expect(page.locator('.recent-read-card')).toHaveCount(2);
  await page.getByRole('link', { name: `继续阅读：${first.archive.title}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: first.archive.title, exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回首页', exact: true }).click();
  await expect(page.locator('.recent-read-card').first()).toContainText(first.archive.title);
  await expect(page.locator('.recent-read-card')).toHaveCount(2);
  await page.getByRole('button', { name: `复制阅读地址：${first.archive.title}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(first.cacheUrl);
  await page.screenshot({ path: info.outputPath('recent-reads-home.png'), fullPage: true });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /最近阅读/ }).click();
  await expect(page.getByRole('heading', { name: '读过的，都有迹可循。', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索缓存' }).fill('第二段');
  await expect(page.locator('.recent-read-card')).toHaveCount(1);
  await expect(page.locator('.recent-read-card')).toContainText(second.archive.title);
  await page.getByRole('textbox', { name: '搜索缓存' }).fill('没有这样的阅读记录');
  await expect(page.getByText('没有匹配的阅读记录')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索缓存' }).fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('recent-reads-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('多标签页同步，移除与清空仅修改本机记录，不删除服务器缓存', async ({ page, context, request }) => {
  const first = await createArchive(request, '跨标签页同步的阅读记录');
  const second = await createArchive(request, '保留在服务器的第二份缓存', otherShareUrl);
  await page.goto(first.cachePath);
  await expect(page.getByRole('heading', { name: first.archive.title, exact: true })).toBeVisible();
  const otherTab = await context.newPage();
  await otherTab.goto('/recent');
  await expect(otherTab.locator('.recent-read-card')).toHaveCount(1);
  await page.goto(second.cachePath);
  await expect(page.getByRole('heading', { name: second.archive.title, exact: true })).toBeVisible();
  await expect(otherTab.locator('.recent-read-card')).toHaveCount(2);
  await otherTab.getByRole('button', { name: `移除阅读记录：${first.archive.title}`, exact: true }).click();
  await page.getByRole('link', { name: '返回首页', exact: true }).click();
  await expect(page.locator('.recent-read-card')).toHaveCount(1);
  await expect(page.locator('.recent-read-card')).toContainText(second.archive.title);
  await otherTab.evaluate(() => localStorage.setItem('unrelated-setting', 'keep'));
  await otherTab.getByRole('button', { name: '清空阅读记录', exact: true }).click();
  await expect(otherTab.getByRole('dialog')).toContainText('不会删除任何服务器缓存');
  await otherTab.getByRole('button', { name: '再想想', exact: true }).click();
  await expect(otherTab.locator('.recent-read-card')).toHaveCount(1);
  await otherTab.getByRole('button', { name: '清空阅读记录', exact: true }).click();
  await otherTab.getByRole('button', { name: '确认清空', exact: true }).click();
  await expect(otherTab.getByText('还没有阅读记录', { exact: true })).toBeVisible();
  await expect(page.locator('.recent-read-card')).toHaveCount(0);
  expect(await otherTab.evaluate((key) => localStorage.getItem(key), RECENT_READS_KEY)).toBeNull();
  expect(await otherTab.evaluate(() => localStorage.getItem('unrelated-setting'))).toBe('keep');
  for (const archive of [first, second]) expect((await request.get(`/api/archives/${archive.archive.id}`)).status()).toBe(200);
  await otherTab.close();
});

test('示例和失败页面不记录，网络故障保留历史，确认删除才清理失效记录', async ({ page, request }) => {
  const created = await createArchive(request, '服务故障时仍保留的阅读记录');
  await page.goto('/demo/ideas');
  await expect(page.getByText('你正在阅读演示内容，这不是一份真实缓存。')).toBeVisible();
  await page.goto('/c/does-not-exist');
  await expect(page.getByRole('heading', { name: '这段对话，暂时找不到了。' })).toBeVisible();
  await page.goto('/recent');
  await expect(page.getByText('还没有阅读记录', { exact: true })).toBeVisible();
  await page.goto(created.cachePath);
  await expect(page.getByRole('heading', { name: created.archive.title, exact: true })).toBeVisible();
  const apiPath = `**/api/archives/${created.archive.id}`;
  await page.route(apiPath, (route) => route.abort('failed'));
  await page.reload();
  await expect(page.getByRole('heading', { name: '这段对话，暂时找不到了。' })).toBeVisible();
  await page.goto('/recent');
  await expect(page.locator('.recent-read-card')).toHaveCount(1);
  await page.unroute(apiPath);
  expect((await request.delete(`/api/archives/${created.archive.id}`, { headers: { 'X-Requested-With': 'Shiguang' } })).status()).toBe(204);
  await page.getByRole('link', { name: `继续阅读：${created.archive.title}`, exact: true }).click();
  await expect(page.getByText('这份缓存不存在，或已被创建者删除。')).toBeVisible();
  await page.goto('/recent');
  await expect(page.getByText('还没有阅读记录', { exact: true })).toBeVisible();
});

test('新浏览器隔离记录，同一浏览器恢复本地存储后可继续阅读', async ({ page, context, browser, request }) => {
  const created = await createArchive(request, '仅保存在我的浏览器的记录');
  await page.goto(created.cachePath);
  await expect(page.getByRole('heading', { name: created.archive.title, exact: true })).toBeVisible();
  const state = await context.storageState();
  const resumed = await browser.newContext({ storageState: state });
  const resumedPage = await resumed.newPage();
  await resumedPage.goto('http://localhost:3177/recent');
  await expect(resumedPage.locator('.recent-read-card')).toContainText(created.archive.title);
  await resumed.close();
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto('http://localhost:3177/recent');
  await expect(freshPage.getByText('还没有阅读记录', { exact: true })).toBeVisible();
  await fresh.close();
  await page.goto('http://127.0.0.1:3177/recent');
  await expect(page.getByText('还没有阅读记录', { exact: true })).toBeVisible();
});

test('存储被禁用或损坏时不白屏，无法持久化会明确提示', async ({ page, request }) => {
  const created = await createArchive(request, '浏览器禁用存储时仍可阅读');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/recent');
  await page.evaluate((key) => localStorage.setItem(key, '{broken'), RECENT_READS_KEY);
  await page.reload();
  await expect(page.getByText('还没有阅读记录', { exact: true })).toBeVisible();
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.goto(created.cachePath);
  await expect(page.getByRole('heading', { name: created.archive.title, exact: true })).toBeVisible();
  await expect(page.getByText(/浏览器暂时无法保存阅读记录/)).toBeVisible();
  await page.getByRole('link', { name: '返回首页', exact: true }).click();
  await expect(page.locator('.recent-read-card')).toHaveCount(1);
  await page.goto('/recent');
  await expect(page.getByText('还没有阅读记录', { exact: true })).toBeVisible();
  await expect(page.getByText(/浏览器暂时无法保存阅读记录/)).toBeVisible();
  expect(errors).toEqual([]);
});
