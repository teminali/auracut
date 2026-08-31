/* ═══════════════════════════════════════════════════════════════════
   The promotion bar at the top of the home screen.

   Two things are ever worth interrupting somebody's launcher for: a
   version they can install, and a feature they have just been given and
   do not know about. So there are exactly two slides, they are built
   from real state rather than a content list, and when neither applies
   the bar renders NOTHING rather than a placeholder.

   The arrows and the dots appear only when there are two slides. A
   carousel control that cannot move is a control that teaches people
   their clicks do not work, and this bar is usually showing one thing.

   Auto-advance stops on hover and on focus, and never runs at all under
   `prefers-reduced-motion` — a bar that changes under the pointer as
   somebody reaches for it is the reason carousels have the reputation
   they have.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useUpdater } from '../../hooks/useUpdater';
import {
  Release, unseenRelease, readSeenRelease, writeSeenRelease,
} from '../../services/changelog';
import { ChangelogSheet } from './ChangelogSheet';
import { Sparkle, Download, ChevronLeft, ChevronRight, X, ExternalLink } from '../ui/icons';

/** How long a slide holds before the next one, when there are two. */
const DWELL_MS = 8000;

interface Slide {
  id: 'update' | 'feature';
  kicker: string;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  actionIcon?: React.ElementType;
  icon: React.ElementType;
  busy?: boolean;
  onDismiss?: () => void;
}

export const PromoCarousel: React.FC = () => {
  const { status, currentVersion, isDesktop, sideload, quitForUpdate, openReleases } = useUpdater();
  const [showChangelog, setShowChangelog] = React.useState(false);

  /* The version this user has already been shown, read once. Kept in
     state so dismissing hides the slide without a reload. */
  const [seen, setSeen] = React.useState<string | null>(() => readSeenRelease());
  const [updateDismissed, setUpdateDismissed] = React.useState<string | null>(null);

  const [busy, setBusy] = React.useState(false);
  const [installed, setInstalled] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);

  const feature = unseenRelease(currentVersion, seen);

  const pending = status.state === 'available' || status.state === 'manual-only';
  const newVersion = pending ? status.version : '';
  const canSideload = status.state === 'manual-only' ? status.canSideload : true;

  const install = React.useCallback(async () => {
    setBusy(true);
    setFailed(null);
    const result = await sideload();
    setBusy(false);
    if (result.ok) setInstalled(result.message);
    else setFailed(result.message);
  }, [sideload]);

  const slides: Slide[] = [];

  /*
    The update, first, because it is the one with a deadline. An
    installed-and-waiting update outranks an offered one: the bundle is
    already swapped and the only thing left is the restart.
  */
  if (installed) {
    slides.push({
      id: 'update',
      kicker: 'Ready',
      title: 'Update installed',
      body: installed,
      actionLabel: 'Quit FrontierCut',
      onAction: quitForUpdate,
      icon: Download,
    });
  } else if (isDesktop && pending && updateDismissed !== newVersion) {
    slides.push({
      id: 'update',
      kicker: 'Update',
      title: `FrontierCut ${newVersion} is available`,
      body: failed ?? (canSideload
        ? 'Install it now and restart when you are ready.'
        : 'This copy is not somewhere FrontierCut can replace it, so the download page is the way in.'),
      actionLabel: canSideload ? (busy ? 'Updating…' : 'Update now') : 'Open downloads',
      onAction: canSideload ? () => void install() : openReleases,
      actionIcon: canSideload ? undefined : ExternalLink,
      icon: Download,
      busy,
      onDismiss: () => setUpdateDismissed(newVersion),
    });
  }

  if (feature) {
    slides.push({
      id: 'feature',
      kicker: `New in ${feature.version}`,
      title: feature.headline,
      body: feature.detail,
      actionLabel: 'See what’s new',
      onAction: () => setShowChangelog(true),
      icon: Sparkle,
      onDismiss: () => {
        writeSeenRelease(feature.version);
        setSeen(feature.version);
      },
    });
  }

  return (
    <>
      {slides.length > 0 && (
        <Carousel
          slides={slides}
          /* Dismissing the first of two must not leave the strip showing
             an index that no longer exists. Keying on the ids resets it. */
          key={slides.map((s) => s.id).join('+')}
        />
      )}
      {showChangelog && (
        <ChangelogSheet
          currentVersion={currentVersion}
          onClose={() => {
            setShowChangelog(false);
            /* Reading the changelog IS seeing it. Closing the sheet
               without this leaves the promotion up, which reads as the
               app not having noticed. */
            if (feature) {
              writeSeenRelease(feature.version);
              setSeen(feature.version);
            }
          }}
        />
      )}
    </>
  );
};

const Carousel: React.FC<{ slides: Slide[] }> = ({ slides }) => {
  const [index, setIndex] = React.useState(0);
  const [held, setHeld] = React.useState(false);
  const many = slides.length > 1;

  /* Clamp rather than trust: a slide can disappear while it is showing. */
  const active = slides[Math.min(index, slides.length - 1)];

  React.useEffect(() => {
    if (!many || held) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % slides.length),
      DWELL_MS
    );
    return () => window.clearInterval(timer);
  }, [many, held, slides.length]);

  const go = (delta: number) =>
    setIndex((i) => (i + delta + slides.length) % slides.length);

  const Icon = active.icon;
  const ActionIcon = active.actionIcon;

  return (
    <div
      className="promo-bar"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      role="region"
      aria-label="Announcements"
      aria-roledescription={many ? 'carousel' : undefined}
    >
      {many && (
        <button className="promo-arrow" onClick={() => go(-1)} aria-label="Previous announcement">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Keyed on the slide, so React remounts it and the entrance runs. */}
      <div key={active.id} className="promo-slide">
        <span className="promo-icon">
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="promo-kicker">{active.kicker}</span>
          <p className="promo-title">{active.title}</p>
          <p className="promo-body">{active.body}</p>
        </div>
        <button onClick={active.onAction} disabled={active.busy} className="promo-action">
          {ActionIcon && <ActionIcon className="w-3.5 h-3.5" />}
          {active.actionLabel}
        </button>
      </div>

      {many && (
        <button className="promo-arrow" onClick={() => go(1)} aria-label="Next announcement">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}

      {many && (
        <div className="promo-dots" role="tablist" aria-label="Choose an announcement">
          {slides.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === index}
              aria-label={s.title}
              onClick={() => setIndex(i)}
              className={`promo-dot ${i === index ? 'promo-dot-on' : ''}`}
            />
          ))}
        </div>
      )}

      {active.onDismiss && (
        <button
          onClick={active.onDismiss}
          className="promo-close"
          title="Not now"
          aria-label="Dismiss this announcement"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
