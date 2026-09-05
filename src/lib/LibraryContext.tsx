import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ArchiveList } from '../../shared/types';
import { api } from './api';
import { errorMessage } from './utils';

const empty: ArchiveList = { archives: [], stats: { total: 0, favorites: 0, messages: 0, bytes: 0 } };

interface LibraryState {
  data: ArchiveList;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

const LibraryContext = createContext<LibraryState | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ArchiveList>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const result = await api.list();
      if (current === revision.current) { setData(result); setError(''); }
    } catch (failure) {
      if (current === revision.current) setError(errorMessage(failure));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); return () => { revision.current += 1; }; }, [refresh]);

  return <LibraryContext.Provider value={{ data, loading, error, refresh }}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('Missing LibraryProvider');
  return context;
}
