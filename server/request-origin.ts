import { isIP } from 'node:net';
import type { Request } from 'express';
import { AppError } from './errors.js';

export function requestOrigin(request: Request, allowedHosts: string[]): string {
  const trusted = request.app.get('trust proxy fn') as ((address: string, hop: number) => boolean) | undefined;
  if (request.socket.remoteAddress && trusted?.(request.socket.remoteAddress, 0)) {
    if ([request.get('X-Forwarded-Host'), request.get('X-Forwarded-Proto')].some((value) => value?.includes(','))) {
      throw new AppError(400, 'INVALID_REQUEST_ORIGIN', '反向代理提供了多个访问地址，请配置代理覆盖 Host 和协议转发头。');
    }
  }

  const host = request.host;
  const protocol = request.protocol;
  if (!host || /[\s/@\\?#,]/.test(host) || !['http', 'https'].includes(protocol)) {
    throw new AppError(400, 'INVALID_REQUEST_ORIGIN', '当前访问地址无效，请检查域名、端口和反向代理配置。');
  }
  let url: URL;
  try { url = new URL(`${protocol}://${host}`); }
  catch { throw new AppError(400, 'INVALID_REQUEST_ORIGIN', '当前访问地址无效，请检查域名、端口和反向代理配置。'); }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!isIP(hostname) && hostname !== 'localhost' && !hostname.endsWith('.localhost') && !allowedHosts.includes(hostname)) {
    throw new AppError(403, 'HOST_NOT_ALLOWED', '当前访问域名未获授权，请将其加入 ALLOWED_HOSTS 后重启服务。');
  }
  return url.origin;
}
