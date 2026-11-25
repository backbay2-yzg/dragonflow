import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => {
        const Icon =
          toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? AlertCircle : Info;

        const iconColor =
          toast.type === 'success'
            ? 'text-[var(--df-success)]'
            : toast.type === 'error'
              ? 'text-[var(--df-danger)]'
              : 'text-primary-text';

        return (
          <div
            key={toast.id}
            className="df-float pointer-events-auto flex items-start gap-2.5 rounded-[10px] border border-hairline-strong bg-surface-2 p-3"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-ink">{toast.title}</div>
              {toast.message && (
                <div className="selectable mt-0.5 text-[13px] [overflow-wrap:anywhere] text-ink-muted">
                  {toast.message}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="df-btn-ghost min-h-[22px] p-1 text-ink-subtle"
              aria-label="关闭通知"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
