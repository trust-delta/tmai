import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

// Hook to trigger a confirmation dialog — returns a Promise<boolean>
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx.confirm;
}

// Provider that renders the dialog overlay
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state) confirmBtnRef.current?.focus();
  }, [state]);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const handleResolve = useCallback(
    (value: boolean) => {
      state?.resolve(value);
      setState(null);
    },
    [state],
  );

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          role="dialog"
          ref={backdropRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === backdropRef.current) handleResolve(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleResolve(false);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-hairline-strong bg-surface-strong p-5 shadow-2xl">
            {state.title && (
              <h3 className="mb-1 text-sm font-semibold text-foreground">{state.title}</h3>
            )}
            <p className="text-[13px] leading-relaxed text-muted-foreground">{state.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleResolve(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
              >
                {state.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                ref={confirmBtnRef}
                onClick={() => handleResolve(true)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  state.variant === "danger"
                    ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
                    : "bg-primary/15 text-primary hover:bg-primary/25"
                }`}
              >
                {state.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
