import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { Archive, ArrowUpRight, ChevronRight, CircleHelp, FolderHeart, History, House, Menu, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Brand } from './Brand';
import { GuideModal } from './Modal';
import { useLibrary } from '../lib/LibraryContext';
import { useRecentReads } from '../lib/RecentReadsContext';

interface WorkspaceContext { query: string }
export const useWorkspace = () => useOutletContext<WorkspaceContext>();

export function WorkspaceLayout() {
  const [query, setQuery] = useState('');
  const [guide, setGuide] = useState(false);
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const { data } = useLibrary();
  const { entries } = useRecentReads();
  const pageName = location.pathname === '/library' ? '全部缓存' : location.pathname === '/favorites' ? '我的收藏' : location.pathname === '/recent' ? '最近阅读' : '概览';

  useLayoutEffect(() => { setQuery(''); setMenu(false); }, [location.pathname]);
  useEffect(() => {
    if (location.hash === '#new-archive') {
      const frame = requestAnimationFrame(() => {
        document.getElementById('new-archive')?.scrollIntoView({ block: 'center' });
        document.getElementById('share-url')?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); input.current?.focus();
      }
      if (event.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  return <div className="app-shell">
    {menu && <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand /><button className="icon-button mobile-only" aria-label="关闭菜单" onClick={() => setMenu(false)}><X size={20} /></button></div>
      <div className="workspace-label"><span className="workspace-avatar">拾</span><div><strong>我的灵感空间</strong><span>Personal workspace</span></div><span className="workspace-status" title="当前浏览器的个人工作区" /></div>
      <p className="nav-caption">工作空间</p>
      <nav className="primary-nav" aria-label="主导航">
        <NavLink to="/" end><House size={19} /><span>概览</span><span className="nav-active-dot" /></NavLink>
        <NavLink to="/library"><Archive size={19} /><span>全部缓存</span><span className="nav-count">{data.stats.total}</span></NavLink>
        <NavLink to="/favorites"><FolderHeart size={19} /><span>我的收藏</span>{data.stats.favorites > 0 && <span className="nav-count">{data.stats.favorites}</span>}</NavLink>
        <NavLink to="/recent"><History size={19} /><span>最近阅读</span>{entries.length > 0 && <span className="nav-count">{entries.length}</span>}</NavLink>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><span className="note-spark"><Sparkles size={20} /></span><h3>让灵感，不止于此刻。</h3><p>收藏一次好奇，<br />留住每一个「原来如此」。</p><span className="note-line" /></div>
        <button className="sidebar-help" onClick={() => setGuide(true)}><CircleHelp size={18} /><span>使用指南</span><ArrowUpRight size={15} /></button>
        <div className="sidebar-footer"><ShieldCheck size={14} /><span>独立缓存 · 自己掌握</span><small>v1.0</small></div>
      </div>
    </aside>
    <div className="workspace-main">
      <header className="topbar">
        <button className="icon-button mobile-only" aria-label="打开菜单" aria-expanded={menu} onClick={() => setMenu(true)}><Menu size={22} /></button>
        <div className="breadcrumb"><span>工作空间</span><ChevronRight size={14} /><strong>{pageName}</strong></div>
        <div className="topbar-right"><label className="global-search"><Search size={16} /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索缓存或阅读记录…" aria-label="搜索缓存" /><kbd>⌘ K</kbd></label><span className="topbar-separator" /><button className="avatar-button" aria-label="查看工作区使用指南" onClick={() => setGuide(true)}>拾</button></div>
      </header>
      <Outlet context={{ query } satisfies WorkspaceContext} />
      <footer className="workspace-footer"><span>留住对话，让思考继续。</span><span>Made for your next bright idea <Sparkles size={12} /></span></footer>
    </div>
    {guide && <GuideModal onClose={() => setGuide(false)} />}
  </div>;
}
