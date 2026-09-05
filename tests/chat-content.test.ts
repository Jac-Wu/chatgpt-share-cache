import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeCachedExcerpt, normalizeChatContent } from '../shared/chat-content.js';
import { citedMarker } from './fixtures.js';

describe('ChatGPT 引用和富文本标记', () => {
  it('将引用元数据转为可点击来源，合并支持网站并稳定复用编号', () => {
    const secondMarker = '\uE200cite\uE202turnOthersearch0\uE201';
    const result = normalizeChatContent(`中文回复。${citedMarker}\n再次引用：${secondMarker}`, [
      { matched_text: citedMarker, items: [{ title: '来源 A', url: 'https://example.com/a', supporting_websites: [{ title: '来源 B', url: 'https://example.org/b' }] }] },
      { matched_text: secondMarker, items: [{ title: '来源 A', url: 'https://example.com/a' }] },
    ]);
    assert.equal(result.missingCitations, false);
    assert.ok(result.content.includes('[来源 1](<https://example.com/a> "引用来源：来源 A")'));
    assert.ok(result.content.includes('[来源 2](<https://example.org/b> "引用来源：来源 B")'));
    assert.equal(result.content.match(/\[来源 1\]/g)?.length, 2);
    assert.ok(!result.content.includes('\uE200'));
  });

  it('没有元数据的旧标记明确提示，不伪造来源或损坏中文时间', () => {
    const original = '9月30日早上出发、10月1日晚上回来，20:00—21:00。';
    const result = normalizeChatContent(`${original}${citedMarker}`);
    assert.equal(result.content, `${original}〔来源未缓存〕`);
    assert.equal(result.missingCitations, true);
    assert.ok(!result.content.includes('turn593198'));
  });

  it('保留行内代码、多反引号、围栏代码和未关闭围栏中的字面标记', () => {
    const samples = [
      `\`${citedMarker}\``,
      `\`\`code \` ${citedMarker}\`\``,
      `\`\`\`text\n${citedMarker}\n\`\`\``,
      `\`\`\`\`text\n\`\`\`\n${citedMarker}\n\`\`\`\``,
      `~~~text\n${citedMarker}\n~~~`,
      `\`\`\`text\n${citedMarker}`,
    ];
    for (const content of samples) {
      const result = normalizeChatContent(content);
      assert.equal(result.content, content);
      assert.equal(result.missingCitations, false);
    }
    const mixed = normalizeChatContent(`正文${citedMarker}\n\n\`\`\`text\n${citedMarker}\n\`\`\`\n\n正文${citedMarker}`);
    assert.equal(mixed.content.match(/来源未缓存/g)?.length, 2);
    assert.equal(mixed.content.match(/\uE200/g)?.length, 1);
  });

  it('忽略危险协议和凭据网址，正确转义引用标题', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https://user:secret@example.com/', 'https://example.com/\nattack']) {
      const result = normalizeChatContent(citedMarker, [{ matched_text: citedMarker, items: [{ title: 'unsafe', url }] }]);
      assert.equal(result.content, '〔来源未缓存〕');
    }
    const result = normalizeChatContent(citedMarker, [{ matched_text: citedMarker, items: [{ title: 'Title "quoted" (2026)', url: 'https://example.com/a_(b)' }] }]);
    assert.ok(result.content.includes('<https://example.com/a_(b)>'));
    assert.ok(result.content.includes('Title \\"quoted\\" (2026)'));
  });

  it('支持安全 URL 回退和直接网页引用，不按无关正文替换', () => {
    const result = normalizeChatContent(`保持这段正文不变。${citedMarker}`, [
      { matched_text: '保持这段正文不变', safe_urls: ['https://evil.example/'] },
      { matched_text: citedMarker, safe_urls: ['https://example.com/source'] },
    ]);
    assert.ok(result.content.startsWith('保持这段正文不变。'));
    assert.ok(result.content.includes('https://example.com/source'));
    assert.ok(!result.content.includes('evil.example'));
  });

  it('图片和未知交互标记使用占位，实体保留可读名称', () => {
    const result = normalizeChatContent('图片：\uE200i\uE202turn0image0\uE201\n地点：\uE200entity\uE202["place","示例地点","location"]\uE201\n\uE200widget\uE202unknown\uE201');
    assert.ok(result.content.includes('图片未缓存'));
    assert.ok(result.content.includes('地点：示例地点'));
    assert.ok(result.content.includes('交互内容未缓存'));
    assert.equal(result.omittedRichContent, true);
    assert.ok(!result.content.includes('\uE200'));
  });

  it('清理被历史摘要截断的引用标记', () => {
    assert.equal(normalizeCachedExcerpt('摘要 \uE200cite\uE202turn123vi'), '摘要 〔来源未缓存〕');
  });
});
