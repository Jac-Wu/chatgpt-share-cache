import { Layers3 } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="拾光首页">
    <span className="brand-icon"><Layers3 size={23} strokeWidth={1.8} /></span>
    <span className="brand-type"><strong>拾光<span className="brand-period">.</span></strong><small>CHAT ARCHIVE</small></span>
  </Link>;
}
