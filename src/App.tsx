import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { ToastProvider } from './components/Toast';
import { LibraryProvider } from './lib/LibraryContext';
import { Dashboard } from './pages/Dashboard';
import { RecentReadsProvider } from './lib/RecentReadsContext';
import { RecentReadsPage } from './pages/RecentReadsPage';

const Reader = lazy(() => import('./pages/Reader').then((module) => ({ default: module.Reader })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="reader-error"><h1>页面遇到了一点问题。</h1><p>你的缓存仍保存在服务器，可以刷新页面重试。</p><button className="button button-dark" onClick={() => window.location.reload()}>刷新页面</button></main>;
    return this.props.children;
  }
}

export function App() {
  return <ErrorBoundary><BrowserRouter><ToastProvider><LibraryProvider><RecentReadsProvider><a href="#main-content" className="skip-link">跳至主要内容</a><Suspense fallback={<main className="reader-loading" role="status"><h1>正在准备阅读空间…</h1></main>}><Routes><Route element={<WorkspaceLayout />}><Route index element={<Dashboard />} /><Route path="library" element={<Dashboard view="library" />} /><Route path="favorites" element={<Dashboard view="favorites" />} /><Route path="recent" element={<RecentReadsPage />} /></Route><Route path="admin" element={<AdminPage />} /><Route path="c/:id" element={<Reader />} /><Route path="demo/:id" element={<Reader demo />} /><Route path="*" element={<main className="reader-error"><h1>这里还没有留下足迹。</h1><p>页面不存在，回到工作空间继续探索吧。</p><Link to="/" className="button button-dark"><ArrowLeft size={16} />返回首页</Link></main>} /></Routes></Suspense></RecentReadsProvider></LibraryProvider></ToastProvider></BrowserRouter></ErrorBoundary>;
}
