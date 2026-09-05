export function readAllowedHosts(value = ''): string[] {
  return [...new Set(value.split(',').map((host) => host.trim()).filter(Boolean).map((host) => {
    const url = new URL(`http://${host}`);
    if (/[\s/@\\?#:*]/.test(host) || url.pathname !== '/' || url.hostname !== host.toLowerCase()) {
      throw new Error('ALLOWED_HOSTS 必须是逗号分隔的域名，不包含协议、端口、路径或通配符。');
    }
    return url.hostname;
  }))];
}
