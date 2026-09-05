import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({ title, children, onClose, className = '' }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const titleId = useId();
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    container.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab') {
        const elements = container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select, textarea, [tabindex="0"]');
        if (!elements?.length) { event.preventDefault(); return; }
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === container.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  return createPortal(<div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`modal ${className}`} ref={container} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={20} /></button></div>
      {children}
    </div>
  </div>, document.body);
}

export function GuideModal({ onClose }: { onClose: () => void }) {
  return <Modal title="把一段好对话，留给未来的自己。" onClose={onClose} className="guide-modal">
    <p className="modal-description">三步，让转瞬即逝的灵感拥有一个固定地址。</p>
    <ol className="guide-steps">
      <li><span>01</span><div><h3>在 ChatGPT 中创建分享</h3><p>支持 chatgpt.com/share/ 开头的整段对话分享，以及 chatgpt.com/s/t_ 开头的单条回复分享。复制公开链接后即可缓存。</p></div></li>
      <li><span>02</span><div><h3>粘贴链接，交给拾光</h3><p>我们会提取可读取的对话文本，在当前部署的服务器中创建独立缓存。</p></div></li>
      <li><span>03</span><div><h3>重读、收藏，或再次分享</h3><p>复制新生成的访问地址。只要此服务和数据仍在，即可读取已保存的内容。读过的缓存会出现在首页「最近阅读」，访客也能再次打开；记录仅保存在当前浏览器，可随时移除或清空。</p></div></li>
    </ol>
    <div className="guide-note"><strong>遇到访问限制？试试「导入网页」</strong><p>在浏览器打开原分享，等待对话完整加载，使用浏览器「另存为」保存 HTML 网页，再上传 .html 文件。不要上传登录页面、验证页面或账户导出文件。</p></div>
    <div className="privacy-note"><strong>关于内容与隐私</strong><p>缓存地址持有者均可阅读。请勿保存敏感内容；你需要拥有保存和再分享内容的权限。图片、附件与外部资源不下载。清除浏览器 Cookie 后会失去原缓存的管理权限，但不会自动删除缓存。此工具与 OpenAI 无隶属关系。</p></div>
    <button className="button button-dark modal-done" onClick={onClose}>明白了，开始收藏灵感</button>
  </Modal>;
}
