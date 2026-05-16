import { AlertCircle, CheckCircle, Info, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type ToastType = "info" | "success" | "error";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  useEffect(() => {
    if (!toast.duration) return;

    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, toast.duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  const icons = {
    info: <Info size={16} />,
    success: <CheckCircle size={16} />,
    error: <AlertCircle size={16} />,
  };

  const bgColors = {
    info: "bg-info/10 border-info/20",
    success: "bg-success/10 border-success/20",
    error: "bg-destructive/10 border-destructive/20",
  };

  const iconColors = {
    info: "text-info",
    success: "text-success",
    error: "text-destructive",
  };

  const textColors = {
    info: "text-info",
    success: "text-success",
    error: "text-destructive",
  };

  return (
    <div
      className={cn(
        "glass-card flex items-start gap-3 rounded-lg border px-4 py-3 animate-slide-in-up",
        bgColors[toast.type],
      )}
    >
      <div className={cn("mt-0.5 flex-shrink-0", iconColors[toast.type])}>{icons[toast.type]}</div>
      <p className={cn("flex-1 text-sm", textColors[toast.type])}>{toast.message}</p>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 rounded p-0.5 transition-colors hover:bg-surface-strong"
      >
        <X size={14} className="text-muted-foreground hover:text-foreground" />
      </button>
    </div>
  );
}

// Toast context hook
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info", duration = 4000) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback((message: string) => addToast(message, "success"), [addToast]);
  const error = useCallback((message: string) => addToast(message, "error", 5000), [addToast]);
  const info = useCallback((message: string) => addToast(message, "info"), [addToast]);

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    info,
  };
}
