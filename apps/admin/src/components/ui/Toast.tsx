// This file is deprecated. Toast system not yet migrated to new location.
// Kept for backward compatibility - provides no-op implementations.
"use client";

import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (toast: Omit<Toast, "id">) => string;
  hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2, 9);
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);

    if (toast.duration !== 0) {
      setTimeout(() => hideToast(id), toast.duration ?? 5000);
    }
    return id;
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, hideToast }}>
      {children}
      <ToastContainer toasts={toasts} onClose={hideToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Durante build/SSR sem provider, retorna implementação no-op
    if (typeof window === "undefined") {
      return {
        toasts: [],
        showToast: () => "",
        hideToast: () => {},
      };
    }
    throw new Error("useToast deve ser usado dentro de ToastProvider");
  }
  return ctx;
}

function ToastContainer({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  if (toasts.length === 0) return null;

  const icons = {
    success: <CheckCircle size={20} strokeWidth={2} />,
    error: <AlertCircle size={20} strokeWidth={2} />,
    warning: <AlertTriangle size={20} strokeWidth={2} />,
    info: <Info size={20} strokeWidth={2} />,
  };

  return (
    <div className="toast-container" role="region" aria-live="polite" aria-label="Notificações">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.type}`}
          role="alert"
          aria-live="assertive"
        >
          <div className="toast__icon">{icons[toast.type]}</div>
          <div className="toast__content">
            <div className="toast__title">{toast.title}</div>
            {toast.message && <div className="toast__message">{toast.message}</div>}
          </div>
          <button
            type="button"
            className="toast__close"
            onClick={() => onClose(toast.id)}
            aria-label="Fechar notificação"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "danger",
  loading = false,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="confirm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="confirm-header">
          <h2 id="confirm-title" className="confirm-title">{title}</h2>
          <button type="button" className="confirm-close" onClick={onClose} aria-label="Fechar">
            <X size={20} strokeWidth={2} />
          </button>
        </header>
        <div className="confirm-body">
          <p className="confirm-message">{message}</p>
        </div>
        <footer className="confirm-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn-primary ${variant === "danger" ? "btn-primary--danger" : ""}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Processando…" : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: "danger" | "primary";
    confirmLabel?: string;
    cancelLabel?: string;
    loading?: boolean;
  }>({ open: false, title: "", message: "", onConfirm: () => {}, loading: false });

  const confirm = useCallback(
    (options: {
      title: string;
      message: string;
      onConfirm: () => void;
      variant?: "danger" | "primary";
      confirmLabel?: string;
      cancelLabel?: string;
    }) => {
      setState({ open: true, ...options, loading: false });
    },
    []
  );

  const setLoading = useCallback((loading: boolean) => {
    setState((s) => ({ ...s, loading }));
  }, []);

  const close = useCallback(() => setState((s) => ({ ...s, open: false, loading: false })), []);

  return { ...state, confirm, close, setLoading };
}