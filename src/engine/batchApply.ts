/* ═══════════════════════════════════════════════════════════════════
   Batch apply — one property patch, many clips, chosen by a predicate.

   The altitude argument in one place: "mute every audio clip after the
   two-minute mark" is, improvised, a `describe_timeline`, a mental filter
   over the JSON, N × `patch_clip`, and a re-`describe_timeline` to check.
   It is also silently wrong the moment one of those clips is locked,
   because `patchClip` does not consult `locked` at all and reports the
   write as applied.

   ── The thing this module exists to do ─────────────────────────────

   REPORT THE SKIPS. Every clip in the project is examined and lands in
   exactly one of three buckets:

     applied   — patched, with the per-path before/after
     skipped   — matched the predicate but was not written, and why
     rejected  — did not match, naming the FIRST predicate that excluded it

   Silence about skipped clips is the failure this codebase exists to
   prevent. `patch_clips` — the tool this one grows out of — collapses its
   whole outcome to `updatedClips: N` and a de-duplicated warning list, so
   a run that touched three of the eleven clips you meant looks exactly
   like one that touched all three you meant.

   ── Locked clips ───────────────────────────────────────────────────

   Skipped by DEFAULT here, which is a deliberate difference from
   `patch_clip` / `patch_clips`. Those two write straight through a lock:
   `timelineStore.patchClip` never reads `clip.locked` or `track.locked`,
   while every other mutator in that store does (`splitClip`, `trimClip`,
   `moveClip`, `updateClipTransform` …). A bulk edit is precisely where
   that inconsistency does damage, so this asks first and says who it
   left out. `includeLocked: true` restores the old behaviour explicitly.
   ═══════════════════════════════════════════════════════════════════ */

import { Clip, ClipType, Track } from '../types/edl';
import { getClipProperty, PROPERTY_SCHEMA, resolvePropertyAlias, validateProperty } from './propertyPath';

/* ── Selection ──────────────────────────────────────────────────── */

export interface ClipSelector {
  /** Explicit clip ids. Bypasses every other predicate. */
  clipIds?: string[];
  /** Track ids or track names (substring, case-insensitive). */
  tracks?: string[];
  clipTypes?: ClipType[];
  /** Substring (case-insensitive), or `/pattern/flags` for a regex. */
  nameMatch?: string;
  startMs?: number;
  endMs?: number;
  /** How a clip must relate to [startMs, endMs]. Default 'overlap'. */
  timeMode?: 'overlap' | 'contained';
  /** Restrict to the current selection. */
  selectedOnly?: boolean;
}

export interface ClipWithContext {
  clip: Clip;
  trackId: string;
  trackName: string;
  trackLocked: boolean;
}

export interface RejectedClip {
  clipId: string;
  name: string;
  type: ClipType;
  trackName: string;
  /** The predicate that excluded it, and what it wanted. */
  reason: string;
}

export interface SelectionReport {
  matched: ClipWithContext[];
  rejected: RejectedClip[];
  /** Per-predicate: how many clips it alone was responsible for excluding. */
  predicates: { predicate: string; value: string; excluded: number }[];
  totalClips: number;
}

function compileNameMatch(pattern: string): (name: string) => boolean {
  const re = /^\/(.*)\/([gimsuy]*)$/.exec(pattern);
  if (re) {
    /* An invalid regex used to be a silent zero-match. Say so instead —
       the caller can then fix the pattern rather than the timeline. */
    let compiled: RegExp;
    try {
      compiled = new RegExp(re[1], re[2].replace('g', ''));
    } catch (err) {
      throw new Error(
        `nameMatch "${pattern}" is not a valid regular expression: ${(err as Error).message}. `
        + 'Drop the slashes for a plain case-insensitive substring match.'
      );
    }
    return (name) => compiled.test(name);
  }
  const needle = pattern.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

/**
 * Walk every clip in the project once and sort it into matched or
 * rejected. Rejection carries the predicate that did it, so "nothing
 * matched" is always answerable without a second call.
 */
export function selectClips(
  tracks: Track[],
  selectedClipIds: string[],
  selector: ClipSelector
): SelectionReport {
  const matched: ClipWithContext[] = [];
  const rejected: RejectedClip[] = [];
  const counts = new Map<string, number>();
  let total = 0;

  const explicit = selector.clipIds && selector.clipIds.length > 0
    ? new Set(selector.clipIds)
    : null;
  const wantedTypes = selector.clipTypes && selector.clipTypes.length > 0
    ? new Set<ClipType>(selector.clipTypes)
    : null;
  const nameTest = selector.nameMatch ? compileNameMatch(selector.nameMatch) : null;
  const selected = new Set(selectedClipIds);

  /* Track references resolve to ids up front, so "no track called X" is a
     hard error rather than an empty result set. */
  let wantedTrackIds: Set<string> | null = null;
  if (selector.tracks && selector.tracks.length > 0) {
    wantedTrackIds = new Set<string>();
    for (const ref of selector.tracks) {
      const byId = tracks.find((t) => t.id === ref);
      if (byId) { wantedTrackIds.add(byId.id); continue; }
      const needle = ref.toLowerCase();
      const hits = tracks.filter(
        (t) => t.name.toLowerCase().includes(needle) || t.type === needle
      );
      if (hits.length === 0) {
        throw new Error(
          `No track matching "${ref}". Tracks: ${tracks.map((t) => `${t.name} (${t.type})`).join(', ')}.`
        );
      }
      for (const t of hits) wantedTrackIds.add(t.id);
    }
  }

  const hasTime = selector.startMs !== undefined || selector.endMs !== undefined;
  const from = selector.startMs ?? -Infinity;
  const to = selector.endMs ?? Infinity;
  const timeMode = selector.timeMode ?? 'overlap';

  const reject = (ctx: ClipWithContext, predicate: string, reason: string) => {
    rejected.push({
      clipId: ctx.clip.id, name: ctx.clip.name, type: ctx.clip.type,
      trackName: ctx.trackName, reason,
    });
    counts.set(predicate, (counts.get(predicate) ?? 0) + 1);
  };

  for (const track of tracks) {
    for (const clip of track.clips) {
      total++;
      const ctx: ClipWithContext = {
        clip, trackId: track.id, trackName: track.name, trackLocked: track.locked,
      };

      if (explicit) {
        if (explicit.has(clip.id)) matched.push(ctx);
        else reject(ctx, 'clipIds', 'not in the explicit clipIds list');
        continue;
      }

      if (selector.selectedOnly && !selected.has(clip.id)) {
        reject(ctx, 'selectedOnly', 'not in the current selection');
        continue;
      }
      if (wantedTrackIds && !wantedTrackIds.has(track.id)) {
        reject(ctx, 'tracks', `on track "${track.name}", which is not in the requested tracks`);
        continue;
      }
      if (wantedTypes && !wantedTypes.has(clip.type)) {
        reject(ctx, 'clipTypes',
          `is a ${clip.type} clip; wanted ${[...wantedTypes].join('/')}`);
        continue;
      }
      if (nameTest && !nameTest(clip.name)) {
        reject(ctx, 'nameMatch', `name "${clip.name}" does not match ${selector.nameMatch}`);
        continue;
      }
      if (hasTime) {
        const clipStart = clip.startTimeMs;
        const clipEnd = clip.startTimeMs + clip.durationMs;
        const inRange = timeMode === 'contained'
          ? clipStart >= from && clipEnd <= to
          : clipStart < to && clipEnd > from;
        if (!inRange) {
          reject(ctx, 'timeRange',
            `spans ${clipStart}–${clipEnd}ms, which does not ${timeMode === 'contained' ? 'sit inside' : 'overlap'} `
            + `${from === -Infinity ? '−∞' : from}–${to === Infinity ? '∞' : to}ms`);
          continue;
        }
      }

      matched.push(ctx);
    }
  }

  const describe = (key: string): string => {
    switch (key) {
      case 'clipIds': return (selector.clipIds ?? []).join(', ');
      case 'tracks': return (selector.tracks ?? []).join(', ');
      case 'clipTypes': return (selector.clipTypes ?? []).join(', ');
      case 'nameMatch': return selector.nameMatch ?? '';
      case 'selectedOnly': return 'current selection';
      case 'timeRange':
        return `${from === -Infinity ? '−∞' : from}–${to === Infinity ? '∞' : to}ms (${timeMode})`;
      default: return '';
    }
  };

  return {
    matched,
    rejected,
    predicates: [...counts.entries()].map(([predicate, excluded]) => ({
      predicate, value: describe(predicate), excluded,
    })),
    totalClips: total,
  };
}

/* ── Applying ───────────────────────────────────────────────────── */

export interface AppliedClip {
  clipId: string;
  name: string;
  type: ClipType;
  trackName: string;
  changed: { path: string; from: unknown; to: unknown }[];
  /** Paths that were already at the requested value. */
  unchanged: string[];
  /** Paths this clip refused, with the validator's reason. */
  failed?: string[];
}

export interface SkippedClip {
  clipId: string;
  name: string;
  type: ClipType;
  trackName: string;
  reason: string;
}

export interface BatchApplyResult {
  dryRun: boolean;
  relative: boolean;
  properties: string[];
  /** Paths no clip in the project could ever accept. */
  unknownProperties?: { path: string; error: string }[];
  totalClips: number;
  matched: number;
  applied: number;
  skipped: number;
  rejected: number;
  clips: AppliedClip[];
  skippedClips: SkippedClip[];
  rejectedClips: RejectedClip[];
  predicates: { predicate: string; value: string; excluded: number }[];
  summary: string;
}

export interface BatchApplyOptions {
  relative?: boolean;
  dryRun?: boolean;
  includeLocked?: boolean;
  includeHidden?: boolean;
  limit?: number;
}

/** Paths that are not in the schema at all — as opposed to not on this clip. */
export function unknownPropertyPaths(paths: string[]): { path: string; error: string }[] {
  const known = new Set(PROPERTY_SCHEMA.map((s) => s.path));
  const out: { path: string; error: string }[] = [];
  for (const raw of paths) {
    const path = raw.includes('.') || raw === 'name' ? raw : (resolvePropertyAlias(raw) ?? raw);
    if (path.startsWith('effects.')) continue; // resolved per clip against its stack
    if (known.has(path)) continue;
    out.push({
      path: raw,
      error: `"${raw}" is not a property path Kerf knows. Call list_properties for the surface.`,
    });
  }
  return out;
}

/**
 * Run the patch over a selection.
 *
 * `patch` is the store's `patchClip`, injected so this module never
 * imports the store — which is what lets the unit tests drive it.
 */
export function runBatchApply(
  selection: SelectionReport,
  properties: Record<string, unknown>,
  opts: BatchApplyOptions,
  patch: (clipId: string, values: Record<string, unknown>) => {
    applied: string[];
    errors: string[];
    changes: { path: string; from: unknown; to: unknown }[];
  }
): BatchApplyResult {
  const paths = Object.keys(properties);
  const unknown = unknownPropertyPaths(paths);
  if (unknown.length === paths.length && paths.length > 0) {
    throw new Error(
      `None of the requested properties exist: ${unknown.map((u) => u.path).join(', ')}. `
      + 'Nothing was changed. Call list_properties to see what a clip exposes.'
    );
  }

  const applied: AppliedClip[] = [];
  const skipped: SkippedClip[] = [];
  const limit = opts.limit ?? Infinity;

  for (const ctx of selection.matched) {
    const { clip, trackName, trackLocked } = ctx;
    const row = { clipId: clip.id, name: clip.name, type: clip.type, trackName };

    if (clip.locked && !opts.includeLocked) {
      skipped.push({ ...row, reason: 'clip is locked (patch_clip would have written through it; pass includeLocked to do that)' });
      continue;
    }
    if (trackLocked && !opts.includeLocked) {
      skipped.push({ ...row, reason: `track "${trackName}" is locked; pass includeLocked to write anyway` });
      continue;
    }
    if (clip.hidden && opts.includeHidden === false) {
      skipped.push({ ...row, reason: 'clip is hidden and includeHidden is false' });
      continue;
    }
    if (applied.length >= limit) {
      skipped.push({ ...row, reason: `limit of ${limit} clip(s) already reached` });
      continue;
    }

    /* Relative resolves per clip: "+10 saturation" across five clips that
       start at five different values must move each by ten, not flatten
       them all onto one number. */
    let values = properties;
    if (opts.relative) {
      values = Object.fromEntries(
        Object.entries(properties).map(([path, value]) => {
          if (typeof value !== 'number') return [path, value];
          const resolved = path.includes('.') || path === 'name'
            ? path : (resolvePropertyAlias(path) ?? path);
          const current = getClipProperty(clip, resolved);
          return [path, (typeof current === 'number' ? current : 0) + value];
        })
      );
    }

    if (opts.dryRun) {
      /*
        A dry run has to answer with what the REAL run would do, which
        means running the same validator rather than echoing the request
        back. Without this it happily planned `textStyle.fontSize` onto a
        shape clip — a change the real call rejects — and reported it with
        no `from` value, which reads as "currently unset" rather than
        "not a property this clip has". A preview that over-promises is
        worse than no preview, because the caller commits to it.

        It also picks up the schema's clamping, so a dry run of
        `filters.saturation: 400` shows the 200 that would land.
      */
      const changed: { path: string; from: unknown; to: unknown }[] = [];
      const same: string[] = [];
      const refused: string[] = [];
      for (const [path, value] of Object.entries(values)) {
        const resolved = path.includes('.') || path === 'name'
          ? path : (resolvePropertyAlias(path) ?? path);
        const verdict = validateProperty(clip, resolved, value);
        if (!verdict.ok) {
          refused.push(verdict.error ?? `Could not set ${resolved}`);
          continue;
        }
        const current = getClipProperty(clip, resolved);
        if (Object.is(current, verdict.value)) same.push(resolved);
        else changed.push({ path: resolved, from: current, to: verdict.value });
      }
      if (changed.length === 0 && same.length === 0) {
        skipped.push({
          ...row,
          reason: `no requested property would apply to this ${clip.type} clip, `
            + (refused.join('; ') || 'the validator reported nothing'),
        });
        continue;
      }
      applied.push({
        ...row, changed, unchanged: same,
        ...(refused.length ? { failed: [...new Set(refused)] } : {}),
      });
      continue;
    }

    const result = patch(clip.id, values);
    const changed = result.changes.filter((c) => !Object.is(c.from, c.to));
    const same = result.changes.filter((c) => Object.is(c.from, c.to)).map((c) => c.path);

    if (result.applied.length === 0) {
      skipped.push({
        ...row,
        reason: `no requested property applied to this ${clip.type} clip, `
          + (result.errors.length ? result.errors.join('; ') : 'the store reported no writes'),
      });
      continue;
    }

    applied.push({
      ...row,
      changed: changed.map((c) => ({ path: c.path, from: c.from, to: c.to })),
      unchanged: same,
      ...(result.errors.length ? { failed: [...new Set(result.errors)] } : {}),
    });
  }

  const noOps = applied.filter((a) => a.changed.length === 0).length;
  const summary = [
    `${applied.length} of ${selection.matched.length} matched clip(s) ${opts.dryRun ? 'would be' : ''} patched`,
    skipped.length ? `${skipped.length} matched but skipped` : null,
    noOps ? `${noOps} already at the requested value` : null,
    selection.rejected.length ? `${selection.rejected.length} of ${selection.totalClips} did not match the predicate` : null,
  ].filter(Boolean).join('; ');

  return {
    dryRun: opts.dryRun === true,
    relative: opts.relative === true,
    properties: paths,
    ...(unknown.length ? { unknownProperties: unknown } : {}),
    totalClips: selection.totalClips,
    matched: selection.matched.length,
    applied: applied.length,
    skipped: skipped.length,
    rejected: selection.rejected.length,
    clips: applied,
    skippedClips: skipped,
    rejectedClips: selection.rejected,
    predicates: selection.predicates,
    summary,
  };
}
