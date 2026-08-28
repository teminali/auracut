/* ═══════════════════════════════════════════════════════════════════
   What's new — the whole list, not just the headline.

   The promotion bar can carry one sentence. This is where the sentence
   goes when somebody wants the rest of it: every release this build is
   running or has run, newest first, with the current one marked.

   It shows nothing newer than the running version. A changelog that
   describes features the reader does not have is a sales page, and the
   update promotion is already the honest way to offer those.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { visibleReleases, formatReleaseDate } from '../../services/changelog';
import { X, Sparkle, Check } from '../ui/icons';

export const ChangelogSheet: React.FC<{
  currentVersion: string;
  onClose: () => void;
}> = ({ currentVersion, onClose }) => {
  const releases = visibleReleases(currentVersion);

  /* Escape closes it, as it does every other sheet in the app. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="modal-shell w-[560px] max-w-[92vw]">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Sparkle className="w-3.5 h-3.5 text-spectrum-accent" />
            <span className="text-ui font-semibold text-spectrum-text">What’s new</span>
          </div>
          <button onClick={onClose} className="pro-btn w-6 h-6" aria-label="Close the changelog">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto px-4 py-4 space-y-5">
          {releases.length === 0 ? (
            <p className="text-ui-sm text-spectrum-textDim py-6 text-center">
              No release notes for this build yet.
            </p>
          ) : (
            releases.map((release, i) => (
              <section key={release.version} className="changelog-entry">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-ui-lg font-semibold text-spectrum-text">
                    {release.headline}
                  </h3>
                  <span className="changelog-version">{release.version}</span>
                  {i === 0 && <span className="changelog-current">Running now</span>}
                  <span className="text-micro text-spectrum-textFaint ml-auto">
                    {formatReleaseDate(release.date)}
                  </span>
                </div>
                <p className="text-ui-sm text-spectrum-textDim leading-snug mt-1.5">
                  {release.detail}
                </p>
                <ul className="mt-2.5 space-y-1.5">
                  {release.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="w-3 h-3 text-spectrum-accent flex-shrink-0 mt-[3px]" />
                      <span className="text-ui-sm text-spectrum-textMuted leading-snug">{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="p-3 border-t border-line flex justify-end">
          <button onClick={onClose} className="btn-primary h-8 px-4 text-ui">Done</button>
        </div>
      </div>
    </div>
  );
};
