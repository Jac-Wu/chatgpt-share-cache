import { History } from 'lucide-react';
import { RecentReads } from '../components/RecentReads';
import { useWorkspace } from '../components/WorkspaceLayout';

export function RecentReadsPage() {
  const { query } = useWorkspace();
  return <main className="dashboard" id="main-content"><section className="library-hero"><div><span className="eyebrow">YOUR READING TRAIL</span><h1>读过的，都有迹可循。</h1><p>别人分享的好对话，也能留在你的阅读足迹里。</p></div><span className="recent-page-icon" aria-hidden="true"><History size={32} /></span></section><RecentReads query={query} /></main>;
}
