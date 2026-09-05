import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { conversationData, nextHtml, referencePayload, shareUrl, singleShareData, singleShareUrl, streamHtml } from '../fixtures';

test('首页、阅读示例和键盘搜索正常工作', async ({ page }, info) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '好对话，值得被留住。' })).toBeVisible();
  await expect(page.getByText('你的灵感收藏，从这里开始。')).toBeVisible();
  await expect(page.getByText('示例内容 · 非真实缓存')).toBeVisible();
  await page.screenshot({ path: info.outputPath('home-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: /从零理解异步/ }).click();
  await expect(page.getByRole('heading', { name: '从零理解异步：让代码慢慢说' })).toBeVisible();
  await expect(page.locator('.code-block')).toBeVisible();
  await page.screenshot({ path: info.outputPath('reader-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: '拾光首页' }).first().click();
  await expect(page.getByRole('heading', { name: '好对话，值得被留住。' })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await expect(page.getByRole('textbox', { name: '搜索缓存' })).toBeFocused();
  await page.getByRole('button', { name: '使用指南', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('导入、复制地址、去重、收藏、公开阅读、导出和删除', async ({ page, context, browser }, info) => {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://localhost:3177/')) externalRequests.push(request.url()); });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '解析并缓存' })).toBeEnabled();
  await page.getByRole('button', { name: '导入网页', exact: true }).click();
  await page.getByRole('textbox', { name: 'ChatGPT 分享链接' }).fill(shareUrl);
  await page.getByLabel('选择 HTML 网页文件').setInputFiles({ name: 'conversation.html', mimeType: 'text/html', buffer: Buffer.from(nextHtml()) });
  await page.getByRole('button', { name: '导入并缓存' }).click();
  await expect(page.getByText('缓存成功，灵感有了新地址。')).toBeVisible();
  const cacheUrl = await page.getByRole('textbox', { name: '缓存访问地址' }).inputValue();
  await page.getByRole('button', { name: '复制地址', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(cacheUrl);
  await page.getByRole('button', { name: '导入并缓存' }).click();
  await expect(page.getByText('这段灵感，已经好好保存。')).toBeVisible();
  expect(await page.getByRole('textbox', { name: '缓存访问地址' }).inputValue()).toBe(cacheUrl);
  await expect(page.locator('.archive-card')).toHaveCount(1);
  await page.getByRole('button', { name: `收藏：${conversationData.title}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `取消收藏：${conversationData.title}`, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('cached-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: '打开阅读', exact: true }).click();
  await expect(page.getByRole('heading', { name: conversationData.title, exact: true })).toBeVisible();
  await expect(page.locator('.prose table')).toBeVisible();
  await expect(page.locator('.katex')).toBeVisible();
  await expect(page.locator('.uncached-image')).toBeVisible();
  await expect(page.getByText('手动导入 · 内容由创建者提供，原始来源未经验证')).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__archiveXss'))).toBeUndefined();
  expect(await page.locator('.prose a[href^="javascript:"]').count()).toBe(0);
  expect(externalRequests).toEqual([]);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出 Markdown' }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!, 'utf8')).toContain(conversationData.title);
  const visitor = await browser.newContext();
  const sharedPage = await visitor.newPage();
  await sharedPage.goto(cacheUrl);
  await expect(sharedPage.getByRole('heading', { name: conversationData.title, exact: true })).toBeVisible();
  await expect(sharedPage.getByRole('button', { name: '取消收藏', exact: true })).toHaveCount(0);
  await sharedPage.reload();
  await expect(sharedPage.getByRole('heading', { name: conversationData.title, exact: true })).toBeVisible();
  await visitor.close();
  await page.goto('/favorites');
  await expect(page.locator('.archive-card')).toHaveCount(1);
  await page.getByRole('textbox', { name: '搜索缓存' }).fill('完全不存在的关键词');
  await expect(page.getByText('还没找到这段对话')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索缓存' }).fill('');
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.locator('.archive-list')).toBeVisible();
  await page.getByRole('button', { name: `更多操作：${conversationData.title}` }).click();
  await page.getByRole('button', { name: '删除缓存', exact: true }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('给喜欢的对话，一颗星。')).toBeVisible();
  await page.goto(cacheUrl);
  await expect(page.getByText('这份缓存不存在，或已被创建者删除。')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('单条分享正确展示引用，复制和导出不包含内部标记', async ({ page, context }, info) => {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://localhost:3177/')) externalRequests.push(request.url()); });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '解析并缓存' })).toBeEnabled();
  await page.getByRole('button', { name: '导入网页', exact: true }).click();
  await page.getByRole('textbox', { name: 'ChatGPT 分享链接' }).fill(singleShareUrl);
  await page.getByLabel('选择 HTML 网页文件').setInputFiles({
    name: 'single-reply.html',
    mimeType: 'text/html',
    buffer: Buffer.from(streamHtml([referencePayload(singleShareData())])),
  });
  await page.getByRole('button', { name: '导入并缓存' }).click();
  await expect(page.getByText('缓存成功，灵感有了新地址。')).toBeVisible();
  await page.getByRole('link', { name: '打开阅读', exact: true }).click();
  await expect(page.getByRole('heading', { name: '单条回复与引用示例', exact: true })).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '原始分享', exact: true })).toHaveAttribute('href', singleShareUrl);
  const firstSource = page.getByRole('link', { name: '来源 1', exact: true });
  await expect(firstSource).toHaveAttribute('href', 'https://example.com/source-a');
  await expect(firstSource).toHaveAttribute('title', '引用来源：示例来源 A');
  await expect(firstSource).toHaveAttribute('class', 'citation-link');
  await expect(firstSource).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: '来源 2', exact: true })).toHaveAttribute('href', 'https://example.org/source-b');
  await expect(page.locator('.prose')).toContainText('20:00—21:00 和 9月30日');
  await expect(page.locator('.prose')).toContainText('〔来源未缓存〕');
  await expect(page.locator('.prose')).toContainText('〔图片未缓存，请查看原始分享〕');
  expect(await page.locator('.prose').innerText()).not.toMatch(/[\uE200-\uE202]|turn593198|Never include/);
  await page.getByRole('button', { name: '复制第 1 条消息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('https://example.com/source-a');
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toMatch(/[\uE200-\uE202]/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出 Markdown' }).click();
  const markdown = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(markdown).toContain('https://example.org/source-b');
  expect(markdown).not.toMatch(/[\uE200-\uE202]/);
  await page.reload();
  await expect(firstSource).toBeVisible();
  await page.screenshot({ path: info.outputPath('single-reply-citations.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('域名和 IP 访问均生成当前地址，不受旧 PUBLIC_BASE_URL 影响', async ({ page }) => {
  for (const origin of ['http://archive.example.com:3177', 'http://127.0.0.1:3177']) {
    await page.goto(origin);
    await expect(page.getByRole('button', { name: '解析并缓存' })).toBeEnabled();
    await page.getByRole('button', { name: '导入网页', exact: true }).click();
    await page.getByRole('textbox', { name: 'ChatGPT 分享链接' }).fill(shareUrl);
    await page.getByLabel('选择 HTML 网页文件').setInputFiles({ name: 'conversation.html', mimeType: 'text/html', buffer: Buffer.from(nextHtml()) });
    await page.getByRole('button', { name: '导入并缓存' }).click();
    await expect(page.getByText('缓存成功，灵感有了新地址。')).toBeVisible();
    const cacheUrl = await page.getByRole('textbox', { name: '缓存访问地址' }).inputValue();
    expect(new URL(cacheUrl).origin).toBe(origin);
    await page.getByRole('link', { name: '打开阅读', exact: true }).click();
    await expect(page).toHaveURL(cacheUrl);
    await expect(page.getByRole('heading', { name: conversationData.title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收藏对话', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  }
});

test('无效链接显示明确错误，不产生虚假缓存', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '解析并缓存' })).toBeEnabled();
  await page.getByRole('button', { name: '解析并缓存' }).click();
  await expect(page.getByText('先粘贴一个 ChatGPT 公开分享链接吧。')).toBeVisible();
  await page.getByRole('textbox', { name: 'ChatGPT 分享链接' }).fill('http://localhost:3000/internal');
  await page.getByRole('button', { name: '解析并缓存' }).click();
  await expect(page.getByRole('alert')).toContainText('请输入有效的 ChatGPT 分享链接');
  await expect(page.locator('.archive-card')).toHaveCount(0);
});

test('手机端无横向溢出，导航与阅读正常', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('你的灵感收藏，从这里开始。')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('home-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.getByRole('link', { name: /全部缓存/ }).click();
  await expect(page.getByRole('heading', { name: '你的每一段好对话。' })).toBeVisible();
  await page.goto('/demo/ideas');
  await expect(page.getByRole('heading', { name: '把模糊的灵感，变成可执行的计划' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('reader-mobile.png'), fullPage: true });
});
