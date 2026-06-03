import { useEffect, useState, useCallback } from 'react';
import { X } from 'lucide-react';

interface ToastData {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

const typeStyles = {
  info: 'border-jarvis-cyan',
  success: 'border-jarvis-green',
  error: 'border-jarvis-red',
  warning: 'border-jarvis-amber',
};

// Global toast array and subscribers
let toasts: ToastData[] = [];
let listeners: (() => void)[] = [];

function notify() {
  listeners.forEach((fn) => fn());
}

export function showToast(message: string, type: ToastData['type'] = 'info') {
  const id = `toast-${Date.now()}`;
  toasts = [...toasts, { id, message, type }];
  notify();

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 5000);
}

export function ToastContainer() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, []);

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 glass-surface border rounded-lg px-4 py-3 animate-msg-fade ${typeStyles[toast.type]}`}
        >
          <span className="font-sans text-[0.85rem] text-jarvis-fg flex-1">{toast.message}</span>
          <button
            onClick={() => dismiss(toast.id)}
            className="text-jarvis-fg-dim hover:text-jarvis-fg transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
