/* ═══════════════════════════════════════════════════════════════════
   Pre-flight card — shown live in the composer as the user types.

   Its job is to make the back-and-forth unnecessary: every blocker is
   stated plainly with a one-click remedy, so by the time the prompt is
   sent the agent already has everything it needs.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useState } from 'react';
import { PreflightReport, CapturedFrame, Annotation } from '../../types/context';
import {
  Check, AlertTriangle, CircleAlert, Camera, Pencil, ShieldCheck, X, ChevronRight,
} from '../ui/icons';

interface ContextPreflightProps {
  report: PreflightReport;
  frame: CapturedFrame | null;
  frameAttached: boolean;
  /** Force the detail open — used when Send could not clear a blocker. */
  forceOpen?: boolean;
  annotations: Annotation[];
  onToggleFrame: () => void;
  onAnnotate: () => void;
  onClearAnnotations: () => void;
}

export const ContextPreflight: React.FC<ContextPreflightProps> = ({
  report, frame, frameAttached, annotations, onToggleFrame, onAnnotate, onClearAnnotations,
  forceOpen = false,
}) => {
  const blockers = report.issues.filter((i) => i.severity === 'blocker');
  const advisories = report.issues.filter((i) => i.severity === 'advisory');

  /*
    Collapsed by default. This panel sits directly above the composer, and
    at full height it pushed the input off screen and buried the thread —
    so the common case (everything fine, or one auto-fixable thing) is one
    line, and the detail is one click away.
  */
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;

  /* When the frame is the only blocker, the strip at the bottom already
     offers the same button — do not print the same action twice. */
  const frameIsTheOnlyBlocker =
    blockers.length === 1 && blockers[0].id === 'no-frame';
  const listedBlockers = frameIsTheOnlyBlocker ? [] : blockers;

  return (
    <div
      className={`rounded-squircle-sm border overflow-hidden animate-fade-in ${
        blockers.length > 0
          ? 'border-spectrum-amber/40 bg-spectrum-amber/[0.06]'
          : 'border-spectrum-green/30 bg-spectrum-green/[0.05]'
      }`}
    >
      {/* Summary line — the whole panel when nothing needs attention */}
      <button
        aria-label="Show what the agent will be sent"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 h-[28px] flex items-center gap-1.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        {blockers.length > 0 ? (
          <CircleAlert className="w-3.5 h-3.5 text-spectrum-amber flex-shrink-0" />
        ) : (
          <ShieldCheck className="w-3.5 h-3.5 text-spectrum-green flex-shrink-0" />
        )}
        <span className="text-ui-sm font-medium text-spectrum-text flex-1 min-w-0 truncate">
          {blockers.length > 0
            ? `Send will sort ${blockers.length} thing${blockers.length === 1 ? '' : 's'} first`
            : 'Context ready'}
        </span>
        <span className="text-micro text-spectrum-textDim flex-shrink-0">{report.requirement.label}</span>
        <ChevronRight
          className={`w-3 h-3 text-spectrum-textFaint flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {/* Why this contract exists */}
      {expanded && blockers.length > 0 && (
        <p className="px-2.5 pb-1.5 text-micro text-spectrum-textDim leading-snug">
          {report.requirement.rationale}
        </p>
      )}

      {/* Blockers first — each with its remedy */}
      {expanded && listedBlockers.map((issue) => (
        <div key={issue.id} className="px-2.5 py-1.5 border-t border-line/60 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 text-spectrum-amber flex-shrink-0 mt-[3px]" />
          <div className="flex-1 min-w-0">
            <p className="text-ui-sm font-medium text-spectrum-text leading-snug">{issue.title}</p>
            <p className="text-micro text-spectrum-textDim leading-snug mt-0.5">{issue.detail}</p>
          </div>
          {issue.fix && (
            <button
              onClick={issue.fix}
              className="btn-primary h-6 px-2 text-micro flex-shrink-0 whitespace-nowrap"
            >
              {issue.fixLabel ?? 'Fix'}
            </button>
          )}
        </div>
      ))}

      {/* Advisories — worth saying, not worth blocking on */}
      {expanded && advisories.map((issue) => (
        <div key={issue.id} className="px-2.5 py-1.5 border-t border-line/60 flex items-start gap-2">
          <span className="w-3 h-3 flex-shrink-0 mt-[3px] flex items-center justify-center">
            <span className="w-1.5 h-1.5 rounded-full bg-spectrum-textDim" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-micro text-spectrum-textMuted leading-snug">{issue.title}</p>
            <p className="text-micro text-spectrum-textFaint leading-snug">{issue.detail}</p>
          </div>
          {issue.fix && (
            <button onClick={issue.fix} className="pro-btn-filled h-5 px-1.5 text-micro flex-shrink-0">
              {issue.fixLabel ?? 'Fix'}
            </button>
          )}
        </div>
      ))}

      {/* Green ticks */}
      {expanded && report.satisfied.length > 0 && (
        <div className="px-2.5 py-1.5 border-t border-line/60 flex flex-wrap gap-x-3 gap-y-0.5">
          {report.satisfied.map((s) => (
            <span key={s} className="flex items-center gap-1 text-micro text-spectrum-textDim">
              <Check className="w-2.5 h-2.5 text-spectrum-green flex-shrink-0" />
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Frame attachment strip */}
      <div className="px-2 py-1.5 border-t border-line/60 flex items-center gap-2 bg-black/15">
        {frameAttached && frame && !frame.unavailableReason ? (
          <>
            <button
              onClick={onAnnotate}
              className="relative w-14 h-8 rounded-squircle-2xs overflow-hidden border border-line-strong flex-shrink-0 group"
              title="Draw on this frame"
            aria-label="Draw on this frame"
            >
              <img src={frame.dataUrl} alt="" className="w-full h-full object-cover" />
              <span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Pencil className="w-3 h-3 text-white" />
              </span>
              {annotations.length > 0 && (
                <span className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-[#ff2d78] text-white text-micro font-bold flex items-center justify-center">
                  {annotations.length}
                </span>
              )}
            </button>

            <div className="flex-1 min-w-0">
              <p className="text-micro text-spectrum-textMuted font-mono truncate">
                {frame.timecode} · {frame.width}×{frame.height}
              </p>
              <p className="text-micro text-spectrum-textFaint truncate">
                {annotations.length > 0
                  ? annotations
                      .map((a, i) => `${i + 1}. ${a.targets[0]?.clipName ?? a.kind}`)
                      .join(' · ')
                  : 'No marks, click the thumbnail to draw'}
              </p>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={onAnnotate} className="pro-btn-filled h-6 px-2 gap-1 text-micro">
                <Pencil className="w-2.5 h-2.5" />
                {annotations.length > 0 ? 'Edit marks' : 'Draw'}
              </button>
              {annotations.length > 0 && (
                <button onClick={onClearAnnotations} className="pro-btn w-5 h-5" title="Remove all marks"
            aria-label="Remove all marks">
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
              <button onClick={onToggleFrame} className="pro-btn w-5 h-5" title="Detach the frame"
            aria-label="Detach the frame">
                <X className="w-3 h-3" />
              </button>
            </div>
          </>
        ) : (
          <>
            <Camera className="w-3.5 h-3.5 text-spectrum-textDim flex-shrink-0" />
            <span className="text-micro text-spectrum-textDim flex-1 min-w-0 truncate">
              {frame?.unavailableReason ?? 'Share the frame so I can see what you see'}
            </span>
            {!frame?.unavailableReason && (
              <button onClick={onToggleFrame} className="pro-btn-filled h-6 px-2 text-micro flex-shrink-0">
                Attach frame
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
