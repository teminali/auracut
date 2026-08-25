/* Transient UI state: toasts, command palette, shortcut sheet, context menus. */

import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'progress';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  /** 0-100 for `progress` toasts. */
  progress?: number;
  /** ms before auto-dismiss; 0 keeps it until removed explicitly. */
  ttl?: number;
  createdAt: number;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  icon?: React.ElementType;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface UiState {
  toasts: Toast[];
  isCommandPaletteOpen: boolean;
  isShortcutsOpen: boolean;
  contextMenu: ContextMenuState | null;

  pushToast: (toast: Omit<Toast, 'id' | 'createdAt' | 'ttl'> & { id?: string; ttl?: number }) => string;
  updateToast: (id: string, patch: Partial<Toast>) => void;
  dismissToast: (id: string) => void;

  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  setShortcutsOpen: (open: boolean) => void;

  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeContextMenu: () => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  isCommandPaletteOpen: false,
  isShortcutsOpen: false,
  contextMenu: null,

  pushToast: (toast) => {
    const id = toast.id ?? `toast_${++toastSeq}`;
    const ttl = toast.ttl ?? (toast.kind === 'error' ? 6000 : toast.kind === 'progress' ? 0 : 3200);

    set((s) => {
      // Re-using an id replaces in place, which is how progress toasts update.
      const existing = s.toasts.findIndex((t) => t.id === id);
      const next: Toast = { ...toast, id, ttl, createdAt: Date.now() };
      if (existing !== -1) {
        const copy = [...s.toasts];
        copy[existing] = next;
        return { toasts: copy };
      }
      return { toasts: [...s.toasts, next].slice(-5) };
    });

    if (ttl > 0) {
      window.setTimeout(() => {
        // Only dismiss if this exact toast is still showing.
        const current = get().toasts.find((t) => t.id === id);
        if (current && (current.ttl ?? 0) > 0) get().dismissToast(id);
      }, ttl);
    }

    return id;
  },

  updateToast: (id, patch) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ isCommandPaletteOpen: !s.isCommandPaletteOpen })),
  setShortcutsOpen: (isShortcutsOpen) => set({ isShortcutsOpen }),

  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),
}));

/** Convenience wrapper used across engines that don't want the hook. */
export const toast = {
  success: (title: string, detail?: string) => useUiStore.getState().pushToast({ kind: 'success', title, detail }),
  error: (title: string, detail?: string) => useUiStore.getState().pushToast({ kind: 'error', title, detail }),
  info: (title: string, detail?: string) => useUiStore.getState().pushToast({ kind: 'info', title, detail }),
};
