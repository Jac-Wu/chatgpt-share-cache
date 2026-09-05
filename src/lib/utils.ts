export function formatBytes(bytes: number) {
  if (bytes === 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value));
}

export function fullDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const previous = document.activeElement as HTMLElement | null;
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const success = document.execCommand('copy');
    area.remove();
    previous?.focus();
    if (!success) throw new Error('无法自动复制，请选中地址后手动复制。');
  }
}

export function archiveUrl(id: string) {
  return `${window.location.origin}/c/${id}`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后再试。';
}
