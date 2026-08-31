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
import { Sparkle, Download, ChevronLeft, ChevronRight, X, ExternalLink, Package } from '../ui/icons';
import { usePackagesStore } from '../../store/packagesStore';

/** How long a slide holds before the next one, when there are two. */
const DWELL_MS = 8000;

interface Slide {
  id: 'update' | 'feature' | 'packages';
  kicker: string;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  actionIcon?: React.ElementType;
  icon: React.ElementType;
  busy?: boolean;
  progressPercent?: number;
  onDismiss?: () => void;
}

export const PromoCarousel: React.FC = () => {
  const { status, currentVersion, isDesktop, sideload, quitForUpdate, openReleases } = useUpdater();
  const [showChangelog, setShowChangelog] = React.useState(false);

  /* The version this user has already been shown, read once. Kept in
     state so dismissing hides the slide without a reload. */
  const [seen, setSeen] = React.useState<string | null>(() => readSeenRelease());
  const [updateDismissed, setUpdateDismissed] = React.useState<string | null>(null);
  const [packagesDismissed, setPackagesDismissed] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [installed, setInstalled] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);

  const packages = usePackagesStore((s) => s.packages);
  const hardware = usePackagesStore((s) => s.hardware);
  const downloads = usePackagesStore((s) => s.downloads);
  const installAll = usePackagesStore((s) => s.installAll);
  const setModalOpen = usePackagesStore((s) => s.setModalOpen);

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
  } else if (status.state === 'downloading') {
    slides.push({
      id: 'update',
      kicker: 'Downloading Update',
      title: `Downloading FrontierCut ${status.version}`,
      body: `Downloading update bundle in background (${status.percent}%). It will be ready to restart in a moment.`,
      actionLabel: `${status.percent}%`,
      onAction: () => {},
      icon: Download,
      busy: true,
      progressPercent: status.percent,
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

  /* Recommended Packages & Models alert slide */
  const allCoreReady = packages.ffmpeg?.installed && packages.ffprobe?.installed;
  const recommendedModel = Object.values(packages).find(
    (p) => p.category === 'ai-stt' && (p.recommended || p.id === 'model-base')
  );
  const modelReady = recommendedModel?.installed;
  const isDownloading = Object.values(downloads).some(
    (d) => d.status === 'downloading' || d.status === 'extracting'
  );

  if ((!allCoreReady || !modelReady) && !packagesDismissed) {
    slides.push({
      id: 'packages',
      kicker: hardware.isAppleSilicon ? 'Apple Silicon' : 'Setup',
      title: `Recommended Core Pack: FFmpeg + ${recommendedModel?.name || 'Whisper Speech'}`,
      body: `Hardware-tuned for your machine (${hardware.cores} cores, ${hardware.totalMemGb} GB RAM). Enables hardware video rendering and offline AI subtitles.`,
      actionLabel: isDownloading ? 'Downloading…' : 'Install Recommended Pack',
      onAction: () => {
        if (!isDownloading) void installAll(recommendedModel?.id);
        else setModalOpen(true);
      },
      icon: Package,
      busy: isDownloading,
      onDismiss: () => setPackagesDismissed(true),
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
      <div key={active.id} className="promo-slide flex items-center gap-3 min-w-0 flex-1">
        <span className="promo-icon flex-shrink-0 w-8 h-8 rounded-squircle-xs bg-[#f0a173]/15 border border-[#f0a173]/30 flex items-center justify-center text-[#f0a173]">
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="promo-kicker uppercase font-mono text-ui-xs tracking-wider px-1.5 py-0.5 rounded-[4px] bg-[#f0a173]/20 text-[#f0a173] font-bold flex-shrink-0">
              {active.kicker}
            </span>
            <p className="promo-title text-ui font-semibold text-white truncate min-w-0">
              {active.title}
            </p>
          </div>
          <p className="promo-body text-ui-xs text-spectrum-textMuted truncate min-w-0">
            {active.body}
          </p>
          {active.progressPercent !== undefined && (
            <div className="w-full max-w-[280px] h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden border border-[#3a3a3a] mt-1">
              <div
                className="h-full bg-[#f0a173] transition-all duration-150"
                style={{ width: `${active.progressPercent}%` }}
              />
            </div>
          )}
        </div>
        <button
          onClick={active.onAction}
          disabled={active.busy}
          className="promo-action h-7 px-3 rounded-squircle-xs bg-[#f08b46] hover:bg-[#ff9654] text-white font-medium text-ui-xs flex items-center gap-1.5 flex-shrink-0 shadow-sm transition-all hover:scale-[1.02]"
        >
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
