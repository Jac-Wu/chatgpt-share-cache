import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRecentReadsStore, RECENT_READS_KEY } from './recent-reads';

const RecentReadsContext = createContext<ReturnType<typeof createRecentReadsStore> | null>(null);

export function RecentReadsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createRecentReadsStore(() => window.localStorage));

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === RECENT_READS_KEY || event.key === null) store.sync();
    };
    window.addEventListener('storage', sync);
    store.sync();
    return () => window.removeEventListener('storage', sync);
  }, [store]);

  return <RecentReadsContext.Provider value={store}>{children}</RecentReadsContext.Provider>;
}

export function useRecentReads() {
  const store = useContext(RecentReadsContext);
  if (!store) throw new Error('Missing RecentReadsProvider');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...snapshot, remember: store.remember, remove: store.remove, clear: store.clear };
}
