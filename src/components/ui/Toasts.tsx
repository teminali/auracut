import React from 'react';
import { useUiStore } from '../../store/uiStore';
import {
  Check, AlertCircle, Info, X, Loader2,
} from './icons';

const ICONS = {
  success: Check,
  error: AlertCircle,
  info: Info,
  progress: Loader2,
};

const TONES = {
  success: 'text-spectrum-green',
  error: 'text-spectrum-red',
  info: 'text-spectrum-accent',
  progress: 'text-spectrum-accent',
};

export const Toasts: React.FC = () => {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            className="pointer-events-auto w-72 rounded-squircle-sm bg-spectrum-panel border border-line-strong shadow-pop overflow-hidden animate-slide-up"
          >
            <div className="px-3 py-2.5 flex items-start gap-2.5">
              <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-px ${TONES[toast.kind]} ${toast.kind === 'progress' ? 'animate-spin' : ''}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-spectrum-text leading-snug">{toast.title}</p>
                {toast.detail && (
                  <p className="text-[10px] text-spectrum-textDim leading-snug mt-0.5 break-words">{toast.detail}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="pro-btn w-4 h-4 flex-shrink-0 -mr-0.5"
                title="Dismiss"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>

            {toast.kind === 'progress' && toast.progress !== undefined && (
              <div className="h-0.5 bg-spectrum-sunken">
                <div
                  className="h-full bg-spectrum-accent transition-[width] duration-300"
                  style={{ width: `${toast.progress}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
