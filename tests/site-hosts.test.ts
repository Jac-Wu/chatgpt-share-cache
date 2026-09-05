import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readAllowedHosts } from '../shared/site-hosts.js';

describe('访问域名白名单', () => {
  it('默认不授权外部域名，显式配置的域名规范化并去重', () => {
    assert.deepEqual(readAllowedHosts(), []);
    assert.deepEqual(readAllowedHosts(' ARCHIVE.EXAMPLE.COM, other.example, archive.example.com '), ['archive.example.com', 'other.example']);
    assert.deepEqual(readAllowedHosts(''), []);
  });

  it('拒绝协议、凭据、端口、路径和通配符', () => {
    for (const value of ['https://archive.example.com', 'user@archive.example.com', 'archive.example.com:3000', 'archive.example.com/path', '*', '*.example.com', 'archive.example.com?x=1', 'archive.example.com#x']) {
      assert.throws(() => readAllowedHosts(value));
    }
  });
});
