import path from 'node:path';
import { readAllowedHosts } from '../shared/site-hosts.js';

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`配置值必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  }
  return parsed;
}

export function readConfig() {
  const port = integer(process.env.PORT, 3000, 1, 65535);
  const adminSecret = process.env.ADMIN_SECRET || undefined;
  if (adminSecret && (adminSecret.trim().length < 32 || adminSecret.length > 512)) {
    throw new Error('ADMIN_SECRET 必须为 32 到 512 个字符，请使用随机生成的密钥。');
  }

  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    allowedHosts: readAllowedHosts(process.env.ALLOWED_HOSTS),
    dataDir: path.resolve(process.env.DATA_DIR || './data'),
    fetchTimeout: integer(process.env.FETCH_TIMEOUT_MS, 25000, 1000, 120000),
    maxArchives: integer(process.env.MAX_ARCHIVES_PER_WORKSPACE, 500, 1, 10000),
    maxTotalArchives: integer(process.env.MAX_TOTAL_ARCHIVES, 10000, 1, 1000000),
    outboundProxy: process.env.OUTBOUND_PROXY || undefined,
    trustProxy: process.env.TRUST_PROXY || false,
    adminSecret,
  };
}

export type Config = ReturnType<typeof readConfig>;
