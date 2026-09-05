import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';

type Notify = (message: string, kind?: 'success' | 'error') => void;
const ToastContext = createContext<Notify>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback<Notify>((message, kind = 'success') => {
    clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = setTimeout(() => setToast(null), 4200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return <ToastContext.Provider value={notify}>
    {children}
    {toast && <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      {toast.kind === 'success' ? <CheckCircle2 size={19} /> : <CircleAlert size={19} />}
      <span>{toast.message}</span>
      <button className="icon-button" onClick={() => setToast(null)} aria-label="关闭提示"><X size={16} /></button>
    </div>}
  </ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
