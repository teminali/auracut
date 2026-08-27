/* ═══════════════════════════════════════════════════════════════════
   Laying a montage onto detected beats.

   The tool this backs (`auto_montage_to_beats`) replaces a sequence an
   agent otherwise improvises: detect_beats, describe_timeline, then a
   delete_clip / insert_clip / patch_clip per shot and a hand-rolled
   arithmetic pass to work out where the cuts should go. That is fifteen
   to thirty calls, different every run, and the arithmetic is where it
   goes wrong silently.

   Three decisions in that arithmetic are NOT obvious, and this module
   makes each of them explicitly and reports it rather than picking one
   quietly:

     1. WHICH beats to cut on. Every beat is a cut every half second at
        120 BPM — almost never what anyone means by "cut on the beat".
        `cutEveryBeats` is a shot length in beats, and it may be
        fractional, in which case the extra cut positions are INTERPOLATED
        between detected beats and are not themselves detected onsets.
        The report says how many of the cuts are which.

     2. What happens when the MATERIAL RUNS OUT before the music does.
        Three answers, all defensible, none of them safe to assume:
        loop the sources, stop the montage early, or stretch the shot
        length so the material spans the whole span.

     3. What happens when a clip is SHORTER than the slot it must fill.
        Slow it, leave the remainder empty, or pass it over. Slowing is
        the default because it is the only one that keeps the next cut on
        its beat without showing background.

   Beat detection is NOT re-implemented here. `beatDetect.detectBeats` is
   the one detector, it took two sessions and two real bugs to make it
   correct (HANDOVER §3a), and a second one would drift from it. This
   module consumes its grid.

   `snapCutsToBeats` in the store is the other, complementary operation:
   it NUDGES cuts that already exist onto nearby beats. This one LAYS the
   cuts out on the beats in the first place. Snapping an arbitrary
   sequence cannot produce a montage — it refuses any move over its
   tolerance, and it cannot decide how long a shot should be.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore, findClipById } from '../store/timelineStore';
import { detectBeats } from './beatDetect';
import { Clip, ClipType, MediaAsset } from '../types/edl';

/* ── The material ───────────────────────────────────────────────── */

export interface MontageSource {
  /** Media-pool asset id, or the id of the clip this came from. */
  key: string;
  name: string;
  url: string;
  type: ClipType;
  /**
   * How much of the source there is, in ms. Stills have none, and carry
   * `Infinity` — an image fills any slot, so it can never be "too short".
   */
  sourceDurationMs: number;
  /** False when the probe never reported a size, i.e. it may not have decoded. */
  measured: boolean;
  width?: number;
  height?: number;
}

export type ExhaustionPolicy = 'loop' | 'stop' | 'stretch';
export type ShortClipPolicy = 'slow' | 'gap' | 'skip';
export type ReusePolicy = 'advance' | 'restart';
export type OrderPolicy = 'as-given' | 'reverse' | 'shuffle';

export interface MontagePlanOptions {
  cutEveryBeats: number;
  startMs: number;
  endMs: number;
  order: OrderPolicy;
  seed: number;
  whenMaterialRunsOut: ExhaustionPolicy;
  whenClipIsShort: ShortClipPolicy;
  reuse: ReusePolicy;
  minShotMs: number;
  maxCuts: number;
}

export const MONTAGE_DEFAULTS: MontagePlanOptions = {
  cutEveryBeats: 2,
  startMs: 0,
  endMs: Number.POSITIVE_INFINITY,
  order: 'as-given',
  seed: 1,
  whenMaterialRunsOut: 'loop',
  whenClipIsShort: 'slow',
  reuse: 'advance',
  /*
    `durationMs` has a floor of 100ms in the property schema, so a slot
    under it would be silently clamped and the next cut would no longer
    land on its beat. 120 leaves a frame of headroom at 30fps and still
    allows sixteenth-note cutting up to 125 BPM.
  */
  minShotMs: 120,
  maxCuts: 400,
};

/* ── The plan ───────────────────────────────────────────────────── */

export type SlotFill = 'trimmed' | 'exact' | 'slowed' | 'gap' | 'still';

export interface PlannedSlot {
  index: number;
  startMs: number;
  endMs: number;
  /** How long the CLIP is. Less than the slot only when `fill` is 'gap'. */
  durationMs: number;
  gapMs: number;
  sourceKey: string;
  sourceName: string;
  /** 0 the first time a source is used, 1 the second time, … */
  pass: number;
  sourceStartMs: number;
  speedMultiplier: number;
  fill: SlotFill;
  /** Whether this cut sits on a detected beat or an interpolated position. */
  onDetectedBeat: boolean;
}

export interface MontagePlan {
  slots: PlannedSlot[];
  /** Cut boundaries actually used, including the terminal one. */
  boundariesMs: number[];
  cutEveryBeatsRequested: number;
  cutEveryBeatsEffective: number;
  /** Grid positions per beat: 1 = beats only, 2 = half-beats, … */
  subdivision: number;
  gridPositions: number;
  interpolatedCuts: number;
  detectedBeatCuts: number;
  gridEndsMs: number;
  uncoveredMs: number;
  uncoveredFromMs: number | null;
  sourcesUsed: number;
  passes: number;
  skipped: { name: string; reason: string }[];
  warnings: string[];
}

/**
 * Turn a beat grid into cut boundaries.
 *
 * A fractional `cutEveryBeats` needs positions BETWEEN the detected
 * beats. Those are linear interpolations of the two beats either side —
 * they are arithmetic, not measurements, and every one of them is
 * counted in the report so a caller is never told that a sixteenth-note
 * cut "landed on a detected beat" when no onset was ever detected there.
 *
 * The grid deliberately does NOT extrapolate past the last detected
 * beat. Inventing beats beyond the end of the analysis is exactly the
 * "markers were a metronome" failure this codebase already fixed once.
 */
export function buildCutGrid(
  beatsMs: number[],
  cutEveryBeats: number,
  startMs: number,
  endMs: number
): { boundaries: number[]; subdivision: number; effective: number; interpolated: boolean[]; gridEndsMs: number; gridPositions: number } {
  const beats = [...beatsMs].sort((a, b) => a - b);
  if (beats.length < 2) {
    return { boundaries: [], subdivision: 1, effective: cutEveryBeats, interpolated: [], gridEndsMs: 0, gridPositions: 0 };
  }

  // Smallest denominator in 1..4 that makes `cutEveryBeats` a whole
  // number of grid steps. Anything else is rounded, and says so.
  let subdivision = 1;
  for (const d of [1, 2, 3, 4]) {
    if (Math.abs(cutEveryBeats * d - Math.round(cutEveryBeats * d)) < 1e-6) { subdivision = d; break; }
    if (d === 4) subdivision = 4;
  }
  const step = Math.max(1, Math.round(cutEveryBeats * subdivision));
  const effective = step / subdivision;

  const grid: number[] = [];
  const interp: boolean[] = [];
  for (let i = 0; i < beats.length - 1; i++) {
    const span = beats[i + 1] - beats[i];
    for (let k = 0; k < subdivision; k++) {
      grid.push(beats[i] + (span * k) / subdivision);
      interp.push(k !== 0);
    }
  }
  grid.push(beats[beats.length - 1]);
  interp.push(false);

  const boundaries: number[] = [];
  const boundaryInterp: boolean[] = [];
  for (let i = 0; i < grid.length; i += step) {
    boundaries.push(Math.round(grid[i]));
    boundaryInterp.push(interp[i]);
  }
  /* The last grid position is a boundary even when the step misses it —
     otherwise the final shot is silently shortened to nothing. */
  const lastGrid = Math.round(grid[grid.length - 1]);
  if (boundaries[boundaries.length - 1] !== lastGrid) {
    boundaries.push(lastGrid);
    boundaryInterp.push(interp[interp.length - 1]);
  }

  // Trim to the requested window, keeping the flags aligned.
  const kept: number[] = [];
  const keptInterp: boolean[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    if (boundaries[i] < startMs - 0.5) continue;
    if (boundaries[i] > endMs + 0.5) break;
    kept.push(boundaries[i]);
    keptInterp.push(boundaryInterp[i]);
  }

  return {
    boundaries: kept,
    subdivision,
    effective,
    interpolated: keptInterp,
    gridEndsMs: lastGrid,
    gridPositions: grid.length,
  };
}

/** Deterministic shuffle, so a montage can be reproduced from its seed. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = (seed >>> 0) || 1;
  const next = () => {
    // xorshift32 — small, deterministic, and does not need a dependency.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Decide every shot: which source, how long, from where in the source,
 * at what speed — and record the reason whenever the answer was forced.
 *
 * Pure arithmetic on a grid and a list of durations. Nothing here reads
 * or writes a store, which is what makes the numbers in the report the
 * same numbers the timeline gets.
 */
export function planMontage(
  beatsMs: number[],
  sourcesIn: MontageSource[],
  optionsIn: Partial<MontagePlanOptions> = {}
): MontagePlan {
  const o: MontagePlanOptions = { ...MONTAGE_DEFAULTS, ...optionsIn };
  const warnings: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  let sources = sourcesIn;
  if (o.order === 'reverse') sources = [...sources].reverse();
  if (o.order === 'shuffle') sources = shuffled(sources, o.seed);

  if (sources.length === 0) {
    return {
      slots: [], boundariesMs: [], cutEveryBeatsRequested: o.cutEveryBeats,
      cutEveryBeatsEffective: o.cutEveryBeats, subdivision: 1, gridPositions: 0,
      interpolatedCuts: 0, detectedBeatCuts: 0, gridEndsMs: 0,
      uncoveredMs: 0, uncoveredFromMs: null, sourcesUsed: 0, passes: 0,
      skipped, warnings: ['No usable material was given, so no montage was laid.'],
    };
  }

  let grid = buildCutGrid(beatsMs, o.cutEveryBeats, o.startMs, o.endMs);
  if (Math.abs(grid.effective - o.cutEveryBeats) > 1e-6) {
    warnings.push(
      `cutEveryBeats ${o.cutEveryBeats} is not a whole number of 1/4-beat steps; ` +
      `it was rounded to ${grid.effective}.`
    );
  }

  let effective = grid.effective;

  /* ── material vs. span ────────────────────────────────────────── */
  let boundaries = grid.boundaries;
  let interpolated = grid.interpolated;
  let slotsWanted = Math.max(0, boundaries.length - 1);
  let uncoveredMs = 0;
  let uncoveredFromMs: number | null = null;

  if (slotsWanted > sources.length) {
    if (o.whenMaterialRunsOut === 'stop') {
      const cut = sources.length;
      uncoveredFromMs = boundaries[cut];
      uncoveredMs = boundaries[boundaries.length - 1] - boundaries[cut];
      boundaries = boundaries.slice(0, cut + 1);
      interpolated = interpolated.slice(0, cut + 1);
      slotsWanted = cut;
    } else if (o.whenMaterialRunsOut === 'stretch') {
      const factor = Math.ceil(slotsWanted / sources.length);
      const rebuilt = buildCutGrid(beatsMs, effective * factor, o.startMs, o.endMs);
      boundaries = rebuilt.boundaries;
      interpolated = rebuilt.interpolated;
      effective = rebuilt.effective;
      slotsWanted = Math.max(0, boundaries.length - 1);
      grid = { ...grid, subdivision: rebuilt.subdivision };
      if (slotsWanted > sources.length) {
        // The grid cannot be coarsened past the last beat; the tail is honest about it.
        uncoveredFromMs = boundaries[sources.length];
        uncoveredMs = boundaries[boundaries.length - 1] - boundaries[sources.length];
        boundaries = boundaries.slice(0, sources.length + 1);
        interpolated = interpolated.slice(0, sources.length + 1);
        slotsWanted = sources.length;
      }
    }
  }

  if (slotsWanted > o.maxCuts) {
    warnings.push(
      `The grid asked for ${slotsWanted} shots; capped at maxCuts=${o.maxCuts}. ` +
      `Raise maxCuts or increase cutEveryBeats.`
    );
    uncoveredFromMs = boundaries[o.maxCuts];
    uncoveredMs = boundaries[boundaries.length - 1] - boundaries[o.maxCuts];
    boundaries = boundaries.slice(0, o.maxCuts + 1);
    interpolated = interpolated.slice(0, o.maxCuts + 1);
    slotsWanted = o.maxCuts;
  }

  /* ── shot by shot ─────────────────────────────────────────────── */
  const slots: PlannedSlot[] = [];
  const useCount = new Map<string, number>();
  let cursor = 0; // index into `sources`, so 'skip' can move past one

  for (let i = 0; i < slotsWanted; i++) {
    const startMs = boundaries[i];
    const endMs = boundaries[i + 1];
    const slotMs = endMs - startMs;

    if (slotMs < o.minShotMs) {
      // Guarded upstream by the tool, but a caller of planMontage direct
      // must not get a slot the store will clamp underneath it.
      warnings.push(
        `Shot ${i + 1} would be ${slotMs}ms, under minShotMs ${o.minShotMs}; it was dropped.`
      );
      continue;
    }

    // Pick a source, honouring 'skip' for material that cannot fill this slot.
    let chosen: MontageSource | null = null;
    let tried = 0;
    while (tried < sources.length) {
      const candidate = sources[cursor % sources.length];
      const fits = candidate.sourceDurationMs >= slotMs;
      if (fits || o.whenClipIsShort !== 'skip') { chosen = candidate; break; }
      skipped.push({
        name: candidate.name,
        reason: `${Math.round(candidate.sourceDurationMs)}ms of source cannot fill a ${slotMs}ms shot`,
      });
      cursor++;
      tried++;
    }
    if (!chosen) {
      // Every source was too short and the policy was 'skip'. Falling back
      // to the longest one and SAYING so beats laying nothing at all.
      chosen = [...sources].sort((a, b) => b.sourceDurationMs - a.sourceDurationMs)[0];
      warnings.push(
        `Shot ${i + 1}: every source is shorter than ${slotMs}ms, so "skip" had nothing left. ` +
        `Used "${chosen.name}" slowed instead.`
      );
    }

    const pass = useCount.get(chosen.key) ?? 0;
    useCount.set(chosen.key, pass + 1);
    cursor++;

    const isStill = !Number.isFinite(chosen.sourceDurationMs);
    let sourceStartMs = 0;
    let speedMultiplier = 1;
    let durationMs = slotMs;
    let gapMs = 0;
    let fill: SlotFill;

    if (isStill) {
      fill = 'still';
    } else if (chosen.sourceDurationMs >= slotMs) {
      const headroom = chosen.sourceDurationMs - slotMs;
      if (o.reuse === 'advance' && headroom > 0) {
        // Successive uses walk forward through the source, so a looped
        // montage does not show the same three seconds four times.
        sourceStartMs = Math.round((pass * slotMs) % (headroom + 1));
      }
      fill = headroom === 0 ? 'exact' : 'trimmed';
    } else if (o.whenClipIsShort === 'gap') {
      durationMs = Math.round(chosen.sourceDurationMs);
      gapMs = slotMs - durationMs;
      fill = 'gap';
    } else {
      // 'slow' (and the 'skip' fallback): stretch the source over the slot.
      const wanted = chosen.sourceDurationMs / slotMs;
      if (wanted < 0.05) {
        /* speed.multiplier has a floor of 0.05 in the property schema, so
           a request under it would be clamped and the shot would run out
           of source anyway — with nothing said. Report the gap instead. */
        durationMs = Math.round(chosen.sourceDurationMs / 0.05);
        gapMs = slotMs - durationMs;
        speedMultiplier = 0.05;
        fill = 'gap';
        warnings.push(
          `"${chosen.name}" is ${Math.round(chosen.sourceDurationMs)}ms and shot ${i + 1} is ` +
          `${slotMs}ms, past the 0.05x slow-motion floor. It fills ${durationMs}ms and ` +
          `${gapMs}ms of the shot is background.`
        );
      } else {
        speedMultiplier = Math.round(wanted * 1000) / 1000;
        fill = 'slowed';
      }
    }

    slots.push({
      index: i,
      startMs,
      endMs,
      durationMs,
      gapMs,
      sourceKey: chosen.key,
      sourceName: chosen.name,
      pass,
      sourceStartMs,
      speedMultiplier,
      fill,
      onDetectedBeat: interpolated[i] === false,
    });
  }

  const unmeasured = sources.filter((s) => s.type === 'video' && !s.measured);
  if (unmeasured.length > 0) {
    warnings.push(
      `${unmeasured.length} video source(s) reported no pixel dimensions when probed ` +
      `(${unmeasured.map((s) => s.name).join(', ')}). Their durations may be the import ` +
      `default rather than a measurement. Check them before trusting the shot lengths.`
    );
  }

  const detectedBeatCuts = slots.filter((s) => s.onDetectedBeat).length;

  return {
    slots,
    boundariesMs: boundaries,
    cutEveryBeatsRequested: o.cutEveryBeats,
    cutEveryBeatsEffective: effective,
    subdivision: grid.subdivision,
    gridPositions: grid.gridPositions,
    interpolatedCuts: slots.length - detectedBeatCuts,
    detectedBeatCuts,
    gridEndsMs: grid.gridEndsMs,
    uncoveredMs: Math.max(0, Math.round(uncoveredMs)),
    uncoveredFromMs: uncoveredFromMs === null ? null : Math.round(uncoveredFromMs),
    sourcesUsed: useCount.size,
    passes: Math.max(0, ...Array.from(useCount.values())),
    skipped,
    warnings,
  };
}

/* ── Reading material off the project ───────────────────────────── */

const timeline = () => useTimelineStore.getState();

function assetToSource(asset: MediaAsset): MontageSource {
  const still = asset.type === 'image' || asset.type === 'sticker';
  return {
    key: asset.id,
    name: asset.name,
    url: asset.url,
    type: asset.type,
    sourceDurationMs: still ? Number.POSITIVE_INFINITY : asset.durationMs,
    measured: still ? asset.width !== undefined : asset.width !== undefined,
    width: asset.width,
    height: asset.height,
  };
}

function clipToSource(clip: Clip): MontageSource {
  const still = clip.type === 'image' || clip.type === 'sticker';
  return {
    key: clip.id,
    name: clip.name,
    url: clip.mediaUrl ?? '',
    type: clip.type,
    sourceDurationMs: still
      ? Number.POSITIVE_INFINITY
      : clip.sourceDurationMs || clip.durationMs,
    measured: clip.naturalWidth !== undefined,
    width: clip.naturalWidth,
    height: clip.naturalHeight,
  };
}

/** Resolve `assetIds` against the media pool, by id then by name. */
export function resolveSources(refs: string[]): MontageSource[] {
  const pool = timeline().mediaPool;
  return refs.map((ref) => {
    const asset =
      pool.find((a) => a.id === ref) ??
      pool.find((a) => a.name.toLowerCase() === ref.toLowerCase()) ??
      pool.find((a) => a.name.toLowerCase().includes(ref.toLowerCase()));
    if (!asset) {
      throw new Error(
        `No media asset "${ref}". In the pool: ${pool.map((a) => a.name).join(', ') || '(empty)'}`
      );
    }
    return assetToSource(asset);
  });
}

/** The visual clips already sitting on a track, in timeline order. */
export function sourcesFromTrack(trackId: string): MontageSource[] {
  const track = timeline().tracks.find((t) => t.id === trackId);
  if (!track) return [];
  return [...track.clips]
    .filter((c) => Boolean(c.mediaUrl) && c.type !== 'audio')
    .sort((a, b) => a.startTimeMs - b.startTimeMs)
    .map(clipToSource);
}

/* ── Applying it ────────────────────────────────────────────────── */

export interface AppliedShot {
  index: number;
  clipId: string;
  name: string;
  sourceName: string;
  /** Where the clip ACTUALLY landed, read back from the store. */
  startMs: number;
  durationMs: number;
  /** The beat this shot was aimed at. */
  beatMs: number;
  /** startMs - beatMs, after the store has had its say. Should be 0. */
  offsetFromBeatMs: number;
  onDetectedBeat: boolean;
  sourceStartMs: number;
  speedMultiplier: number;
  fill: SlotFill;
  gapMs: number;
  pass: number;
  errors?: string[];
}

export interface ApplyResult {
  trackId: string;
  clipsRemoved: number;
  shots: AppliedShot[];
  maxOffsetMs: number;
  meanOffsetMs: number;
  patchErrors: string[];
}

/**
 * Write a plan onto a track.
 *
 * Every clip is READ BACK after it is placed and the report quotes what
 * the store actually holds, not what was asked for. `durationMs` has a
 * floor, `startTimeMs` is rounded and clamped, and a locked track refuses
 * everything — echoing the request back would describe a montage that was
 * never laid.
 */
export function applyMontage(
  plan: MontagePlan,
  sources: MontageSource[],
  trackId: string,
  opts: { clearTrack: boolean; muteSourceAudio: boolean; fitMode: 'cover' | 'contain' }
): ApplyResult {
  const state = timeline();
  const track = state.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`No track "${trackId}".`);
  if (track.locked) throw new Error(`Track "${track.name}" is locked. Unlock it first.`);

  /*
    The material is taken from the SOURCE LIST, not looked up again by id.

    When the material is the clips already on the track — the "re-cut what
    is here" case — `clearTrack` deletes those clips before the first shot
    is placed, so a lookup by clip id finds nothing and every shot lands
    with an empty `mediaUrl`. That version reported fifteen shots, all
    exactly on the beat, and rendered fifteen seconds of black: the report
    was true about the timing and silent about the picture. It was caught
    by sampling the rendered frame, which is the only thing that could
    have caught it, and it is the reason this function takes `sources`.
  */
  const byKey = new Map(sources.map((s) => [s.key, s]));
  const patchErrors: string[] = [];

  state.beginTransaction();

  let clipsRemoved = 0;
  if (opts.clearTrack) {
    for (const clip of [...track.clips]) {
      if (timeline().deleteClip(clip.id, false)) clipsRemoved++;
    }
  }

  const shots: AppliedShot[] = [];
  for (const slot of plan.slots) {
    const source = byKey.get(slot.sourceKey);
    if (!source) throw new Error(`Plan referenced a source "${slot.sourceKey}" that was not given.`);
    if (!source.url) {
      throw new Error(
        `"${source.name}" has no media URL, so a shot cut from it would render nothing. ` +
        `Import it before building the montage.`
      );
    }

    /*
      Everything goes in through `insertClip`, which builds the clip with
      `createClip` — hand-assembling one is how a clip ends up missing a
      field the compositor reads.
    */
    const asset: MediaAsset = {
      id: `montage_${slot.sourceKey}`,
      name: source.name,
      type: source.type,
      url: source.url,
      thumbnailUrl: source.type === 'audio' ? '' : source.url,
      durationMs: Number.isFinite(source.sourceDurationMs)
        ? Math.round(source.sourceDurationMs)
        : slot.durationMs,
      width: source.width,
      height: source.height,
      fileSizeFormatted: '-',
    };

    const clipId = timeline().insertClip(trackId, asset, slot.startMs);
    const patch = timeline().patchClip(clipId, {
      name: `${slot.index + 1}. ${slot.sourceName}`,
      startTimeMs: slot.startMs,
      durationMs: slot.durationMs,
      sourceStartMs: slot.sourceStartMs,
      'speed.multiplier': slot.speedMultiplier,
      fitMode: opts.fitMode,
      'audio.volume': opts.muteSourceAudio ? 0 : 1,
    });
    if (patch.errors.length > 0) {
      patchErrors.push(`shot ${slot.index + 1} (${slot.sourceName}): ${patch.errors.join('; ')}`);
    }

    const placed = findClipById(timeline().tracks, clipId);
    const actualStart = placed?.startTimeMs ?? slot.startMs;
    shots.push({
      index: slot.index + 1,
      clipId,
      name: placed?.name ?? slot.sourceName,
      sourceName: slot.sourceName,
      startMs: actualStart,
      durationMs: placed?.durationMs ?? slot.durationMs,
      beatMs: slot.startMs,
      offsetFromBeatMs: actualStart - slot.startMs,
      onDetectedBeat: slot.onDetectedBeat,
      sourceStartMs: placed?.sourceStartMs ?? slot.sourceStartMs,
      speedMultiplier: placed?.speed?.multiplier ?? slot.speedMultiplier,
      fill: slot.fill,
      gapMs: slot.gapMs,
      pass: slot.pass,
      ...(patch.errors.length ? { errors: patch.errors } : {}),
    });
  }

  timeline().commitTransaction('Auto montage to beats');

  const offsets = shots.map((s) => Math.abs(s.offsetFromBeatMs));
  return {
    trackId,
    clipsRemoved,
    shots,
    maxOffsetMs: offsets.length ? Math.max(...offsets) : 0,
    meanOffsetMs: offsets.length
      ? Math.round((offsets.reduce((a, b) => a + b, 0) / offsets.length) * 100) / 100
      : 0,
    patchErrors,
  };
}

/* ── The whole operation ────────────────────────────────────────── */

export interface AutoMontageArgs {
  audioClipId?: string;
  audioAssetId?: string;
  assetIds?: string[];
  trackId?: string;
  cutEveryBeats?: number;
  startMs?: number;
  endMs?: number;
  order?: OrderPolicy;
  seed?: number;
  whenMaterialRunsOut?: ExhaustionPolicy;
  whenClipIsShort?: ShortClipPolicy;
  reuse?: ReusePolicy;
  clearTrack?: boolean;
  muteSourceAudio?: boolean;
  fitMode?: 'cover' | 'contain';
  minShotMs?: number;
  maxCuts?: number;
  dryRun?: boolean;
}

/** Everything `auto_montage_to_beats` reports back. */
export interface MontageReport {
  [key: string]: unknown;
}

export async function autoMontageToBeats(args: AutoMontageArgs): Promise<MontageReport> {
  const state = timeline();

  /* ── the music ────────────────────────────────────────────────── */
  let audioClip: Clip | undefined;
  let audioPlacedNote: string | undefined;

  if (args.audioClipId) {
    audioClip = findClipById(state.tracks, args.audioClipId) ?? undefined;
    if (!audioClip) {
      // Fall back to a name match, the way resolveClipId does.
      const needle = args.audioClipId.toLowerCase();
      for (const t of state.tracks) {
        for (const c of t.clips) if (c.name.toLowerCase().includes(needle)) { audioClip = c; break; }
        if (audioClip) break;
      }
    }
    if (!audioClip) throw new Error(`No clip matching "${args.audioClipId}".`);
  } else if (args.audioAssetId) {
    const asset =
      state.mediaPool.find((a) => a.id === args.audioAssetId) ??
      state.mediaPool.find((a) => a.name.toLowerCase().includes(args.audioAssetId!.toLowerCase()));
    if (!asset) throw new Error(`No media asset "${args.audioAssetId}" for the music.`);

    const existing = state.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.mediaUrl === asset.url && c.type === 'audio');
    if (existing) {
      audioClip = existing;
    } else {
      const audioTrack = state.tracks.find((t) => t.type === 'audio');
      const atId = audioTrack ? audioTrack.id : timeline().addTrack('audio', 'Music');
      const newId = timeline().insertClip(atId, asset, 0);
      audioClip = findClipById(timeline().tracks, newId) ?? undefined;
      audioPlacedNote = `"${asset.name}" was not on the timeline; it was placed at 0ms on an audio track.`;
    }
  } else {
    audioClip = state.tracks
      .filter((t) => t.type === 'audio')
      .flatMap((t) => t.clips)
      .find((c) => c.mediaUrl);
  }

  if (!audioClip?.mediaUrl) {
    throw new Error(
      'No audio clip with media to cut against. Put the music on an audio track first, ' +
      'or pass audioAssetId to have it placed.'
    );
  }

  const beats = await detectBeats(audioClip.mediaUrl, audioClip.startTimeMs);
  timeline().setBeatMarkers(beats.beatsMs);

  /* ── the track ────────────────────────────────────────────────── */
  const after = timeline();
  let trackId = args.trackId;
  if (trackId && !after.tracks.some((t) => t.id === trackId)) {
    const needle = trackId.toLowerCase();
    const byName = after.tracks.find(
      (t) => t.name.toLowerCase().includes(needle) || t.type === needle
    );
    if (!byName) throw new Error(`No track matching "${trackId}".`);
    trackId = byName.id;
  }
  let trackCreated = false;
  if (!trackId) {
    const videoTrack = after.tracks.find((t) => t.type === 'video');
    if (videoTrack) trackId = videoTrack.id;
    else { trackId = timeline().addTrack('video', 'Montage'); trackCreated = true; }
  }

  /* ── the material ─────────────────────────────────────────────── */
  let sources: MontageSource[];
  let materialFrom: string;
  if (args.assetIds && args.assetIds.length > 0) {
    sources = resolveSources(args.assetIds);
    materialFrom = 'the media assets given';
  } else {
    sources = sourcesFromTrack(trackId);
    materialFrom = `the ${sources.length} clip(s) already on the track`;
    if (sources.length === 0) {
      /*
        "The track is empty" would be a lie on the starter project, whose
        first video track holds 49 shape and text clips and no footage.
        Say which of the two it is, or the caller goes looking for a
        track that is right there.
      */
      const onTrack = timeline().tracks.find((t) => t.id === trackId)?.clips.length ?? 0;
      throw new Error(
        onTrack === 0
          ? 'No material: the target track is empty and no assetIds were given. ' +
            'Pass assetIds, or import media and put it on the track first.'
          : `No material: the target track holds ${onTrack} clip(s) but none of them is ` +
            'footage or a still, shapes, text and adjustment layers have nothing to cut. ' +
            'Pass assetIds, or point trackId at the track with the media on it.'
      );
    }
  }

  /* ── the span ─────────────────────────────────────────────────── */
  const audioStart = audioClip.startTimeMs;
  const audioEnd = audioClip.startTimeMs + audioClip.durationMs;
  const startMs = args.startMs ?? audioStart;
  const endMs = args.endMs ?? audioEnd;

  const plan = planMontage(beats.beatsMs, sources, {
    cutEveryBeats: args.cutEveryBeats ?? MONTAGE_DEFAULTS.cutEveryBeats,
    startMs,
    endMs,
    order: args.order ?? MONTAGE_DEFAULTS.order,
    seed: args.seed ?? MONTAGE_DEFAULTS.seed,
    whenMaterialRunsOut: args.whenMaterialRunsOut ?? MONTAGE_DEFAULTS.whenMaterialRunsOut,
    whenClipIsShort: args.whenClipIsShort ?? MONTAGE_DEFAULTS.whenClipIsShort,
    reuse: args.reuse ?? MONTAGE_DEFAULTS.reuse,
    minShotMs: args.minShotMs ?? MONTAGE_DEFAULTS.minShotMs,
    maxCuts: args.maxCuts ?? MONTAGE_DEFAULTS.maxCuts,
  });

  /*
    A grid finer than the store's duration floor is refused rather than
    laid: `durationMs` clamps at 100ms, so the shots would come out longer
    than asked and every cut after the first would drift off its beat —
    while the tool reported the beat positions it had intended.
  */
  const shortest = plan.boundariesMs.length > 1
    ? Math.min(...plan.boundariesMs.slice(1).map((b, i) => b - plan.boundariesMs[i]))
    : Number.POSITIVE_INFINITY;
  const minShot = args.minShotMs ?? MONTAGE_DEFAULTS.minShotMs;
  if (plan.boundariesMs.length > 1 && shortest < minShot) {
    throw new Error(
      `cutEveryBeats ${plan.cutEveryBeatsEffective} at ${beats.bpm.toFixed(1)} BPM gives shots of ` +
      `${Math.round(shortest)}ms, under minShotMs ${minShot}. Kerf clamps a clip to 100ms, so the ` +
      `cuts would drift off the beat. Increase cutEveryBeats, or lower minShotMs if you mean it.`
    );
  }

  const anchoredPct = beats.beatsMs.length
    ? Math.round((beats.beatsAnchored / beats.beatsMs.length) * 100)
    : 0;

  const music = {
    clipId: audioClip.id,
    name: audioClip.name,
    bpm: Number(beats.bpm.toFixed(1)),
    beatsDetected: beats.beatsMs.length,
    beatsOnRealOnsets: beats.beatsAnchored,
    onsetsDetected: beats.onsetsDetected,
    confidence:
      `${anchoredPct}% of the beats sit on a detected onset; the rest are interpolated ` +
      `at the estimated tempo.`,
    firstBeatMs: beats.beatsMs[0] ?? null,
    lastBeatMs: beats.beatsMs[beats.beatsMs.length - 1] ?? null,
    ...(audioPlacedNote ? { note: audioPlacedNote } : {}),
  };

  const gridReport = {
    cutEveryBeats: plan.cutEveryBeatsEffective,
    ...(Math.abs(plan.cutEveryBeatsEffective - plan.cutEveryBeatsRequested) > 1e-6
      ? { requested: plan.cutEveryBeatsRequested }
      : {}),
    subdivision: plan.subdivision,
    cutsOnDetectedBeats: plan.detectedBeatCuts,
    cutsOnInterpolatedPositions: plan.interpolatedCuts,
    ...(plan.interpolatedCuts > 0
      ? {
          note:
            'Interpolated positions sit between two detected beats by arithmetic. ' +
            'No onset was detected there, so they are as accurate as the tempo, not as ' +
            'accurate as the detector.',
        }
      : {}),
    gridEndsMs: plan.gridEndsMs,
  };

  const material = {
    from: materialFrom,
    sourcesAvailable: sources.length,
    sourcesUsed: plan.sourcesUsed,
    shotsPlanned: plan.slots.length,
    whenMaterialRunsOut: args.whenMaterialRunsOut ?? MONTAGE_DEFAULTS.whenMaterialRunsOut,
    timesEachSourceUsedAtMost: plan.passes,
    reuse: args.reuse ?? MONTAGE_DEFAULTS.reuse,
    reuseNote:
      (args.reuse ?? MONTAGE_DEFAULTS.reuse) === 'advance'
        ? 'A source used more than once starts later in itself each time, so a loop is not a repeat.'
        : 'A source used more than once restarts from its beginning each time.',
    uncoveredMs: plan.uncoveredMs,
    uncoveredFromMs: plan.uncoveredFromMs,
    ...(plan.uncoveredMs > 0
      ? {
          uncoveredNote:
            `The music runs ${plan.uncoveredMs}ms past the last shot (from ` +
            `${plan.uncoveredFromMs}ms). Nothing is on the video track there.`,
        }
      : {}),
  };

  const shortSlots = plan.slots.filter((s) => s.fill === 'slowed' || s.fill === 'gap');
  const short = {
    whenClipIsShort: args.whenClipIsShort ?? MONTAGE_DEFAULTS.whenClipIsShort,
    shotsAffected: shortSlots.length,
    ...(plan.skipped.length ? { skipped: plan.skipped } : {}),
    ...(shortSlots.length
      ? {
          shots: shortSlots.map((s) => ({
            shot: s.index + 1,
            source: s.sourceName,
            slotMs: s.endMs - s.startMs,
            ...(s.fill === 'slowed'
              ? { slowedTo: `${s.speedMultiplier}x` }
              : { filledMs: s.durationMs, gapMs: s.gapMs }),
          })),
        }
      : {}),
  };

  if (args.dryRun) {
    return {
      dryRun: true,
      music,
      grid: gridReport,
      material,
      short,
      shots: plan.slots.map((s) => ({
        shot: s.index + 1,
        source: s.sourceName,
        startMs: s.startMs,
        durationMs: s.durationMs,
        onDetectedBeat: s.onDetectedBeat,
        fill: s.fill,
        ...(s.speedMultiplier !== 1 ? { speed: `${s.speedMultiplier}x` } : {}),
        ...(s.gapMs ? { gapMs: s.gapMs } : {}),
      })),
      trackId,
      ...(plan.warnings.length ? { warnings: plan.warnings } : {}),
      note: 'Nothing was changed. Call again without dryRun to lay it.',
    };
  }

  const applied = applyMontage(plan, sources, trackId, {
    clearTrack: args.clearTrack ?? true,
    muteSourceAudio: args.muteSourceAudio ?? true,
    fitMode: args.fitMode ?? 'cover',
  });

  const warnings = [...plan.warnings, ...applied.patchErrors];

  /*
    The montage starts at the first BEAT in the span, which is almost
    never 0: a track with a 209ms riser has its first beat at 488ms, and
    the video track is empty until then. That is a hole in the picture,
    and it has to be said rather than left for someone to find in the
    render.
  */
  const leadInMs = applied.shots.length ? applied.shots[0].startMs - startMs : 0;
  if (leadInMs > 0) {
    warnings.push(
      `The first beat in the span is at ${applied.shots[0].startMs}ms, so nothing is on the ` +
      `video track for the first ${leadInMs}ms. Set startMs earlier, or put something there.`
    );
  }

  if (applied.maxOffsetMs > 0) {
    warnings.push(
      `${applied.shots.filter((s) => s.offsetFromBeatMs !== 0).length} shot(s) did not land ` +
      `exactly on their beat; worst ${applied.maxOffsetMs}ms. The store moved them.`
    );
  }

  return {
    music,
    grid: gridReport,
    material,
    short,
    track: {
      trackId,
      created: trackCreated,
      clipsRemoved: applied.clipsRemoved,
      clearedFirst: args.clearTrack ?? true,
    },
    audio: {
      sourceAudioMuted: args.muteSourceAudio ?? true,
      note:
        (args.muteSourceAudio ?? true)
          ? 'Each shot is muted so the music is the only sound. Pass muteSourceAudio:false to keep it.'
          : 'Source audio is kept, which will play under the music.',
    },
    cuts: applied.shots.length,
    leadInMs,
    cutAccuracy: {
      maxOffsetFromBeatMs: applied.maxOffsetMs,
      meanOffsetFromBeatMs: applied.meanOffsetMs,
      note:
        'Measured from the clips as the store holds them, not from the request. ' +
        'This is distance to the DETECTED beat; the detector itself is typically ' +
        'within ~10ms of the audio.',
    },
    montageMs: applied.shots.length
      ? applied.shots[applied.shots.length - 1].startMs +
        applied.shots[applied.shots.length - 1].durationMs -
        applied.shots[0].startMs
      : 0,
    shots: applied.shots,
    transitions: 'none, every cut is hard, which is what puts the edit on the beat',
    ...(warnings.length ? { warnings } : {}),
  };
}
