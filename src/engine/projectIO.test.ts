/* @vitest-environment jsdom */
/* ═══════════════════════════════════════════════════════════════════
   projectIO — the format version ladder.

   jsdom, not node: the autosave helpers reach for `localStorage` and
   `window.setInterval`, and `deserializeProject` writes into the zustand
   stores. Nothing here renders anything.

   `tools/verify_project_format.py` already walks the same six cases
   through a running TeminaliCut, which is the right way to prove the RPC layer
   maps `migratedFrom` onto `migratedFromFormat` and that the app really
   opens the file. This file is the layer underneath, and it deliberately
   goes where the tool cannot: the ladder in isolation, malformed and
   fractional version numbers, whether a REFUSED file left the store
   alone, and the serialise/deserialise round trip.
   ═══════════════════════════════════════════════════════════════════ */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FORMAT_VERSION,
  migrateProjectFile,
  serializeProject,
  deserializeProject,
  hasAutosave,
  restoreAutosave,
  clearAutosave,
  AnyFile,
} from './projectIO';
import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';

/*
  jsdom 30 does NOT implement `localStorage` any more — it defers to
  Node's own, which is inert unless the process was started with
  `--localstorage-file`, so `window.localStorage` comes back undefined
  and every autosave call throws. Electron has the real thing, so this is
  a test-environment gap and not a product one; the shim is the smallest
  thing that lets the autosave round trip be exercised at all.

  Installed before any test runs. `projectIO` reads the global inside its
  functions rather than at import time, so this is early enough.
*/
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
    },
  });
}

/* ── Fixtures ───────────────────────────────────────────────────── */

/*
  Deliberately the same shape as the `BASE` dict in
  tools/verify_project_format.py, so a format change breaks both in the
  same way rather than leaving one of them quietly passing.
*/
const baseFile = (): AnyFile => ({
  format: 'kerf.project',
  savedAt: 0,
  project: {
    id: 't',
    name: 'Format probe',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 4000,
    backgroundColor: '#101010',
    createdAt: 0,
    updatedAt: 0,
  },
  tracks: [
    {
      id: 'tr1',
      name: 'V1',
      type: 'video',
      index: 0,
      clips: [],
      muted: false,
      locked: false,
      solo: false,
      volume: 1,
      heightPx: 72,
      collapsed: false,
    },
  ],
  markers: [],
  mediaPool: [],
});

const withVersion = (version: unknown): AnyFile => ({ ...baseFile(), version } as AnyFile);
const load = (file: AnyFile) => deserializeProject(JSON.stringify(file));

/** A known-clean starting point, so no test can pass on another's state. */
beforeEach(() => {
  localStorage.clear();
  useTimelineStore.getState().loadProject([], []);
  useTimelineStore.setState((s) => ({ ...s, mediaPool: [] }));
});

/* ── The ladder on its own ──────────────────────────────────────── */

describe('migrateProjectFile', () => {
  it('leaves a current file alone and takes no steps', () => {
    const file = withVersion(FORMAT_VERSION);
    const r = migrateProjectFile(file);
    expect(r.from).toBe(FORMAT_VERSION);
    expect(r.steps).toBe(0);
    expect(r.file.version).toBe(FORMAT_VERSION);
  });

  it('walks a legacy file up to the current version, one step at a time', () => {
    const r = migrateProjectFile(withVersion(1));
    expect(r.from).toBe(1);
    expect(r.steps).toBe(FORMAT_VERSION - 1);
    expect(r.file.version).toBe(FORMAT_VERSION);
  });

  it('treats a missing version as 1, because that is what pre-versioning files are', () => {
    const noVersion = baseFile();
    expect('version' in noVersion).toBe(false);
    const r = migrateProjectFile(noVersion);
    expect(r.from).toBe(1);
    expect(r.steps).toBe(FORMAT_VERSION - 1);
    expect(r.file.version).toBe(FORMAT_VERSION);
  });

  it('treats junk in the version field as 1 rather than trusting it', () => {
    // A string "2" is not a number 2. Reading it as current would skip
    // the ladder on a file nobody can vouch for.
    for (const junk of ['2', null, undefined, NaN, 0, -5, {}, []]) {
      const r = migrateProjectFile(withVersion(junk));
      expect(r.from, String(junk)).toBe(1);
    }
  });

  it('does not mutate the file it was handed', () => {
    // The caller still holds the parsed object; migrating in place would
    // make a failed load leave a half-upgraded file behind.
    const original = withVersion(1);
    const before = JSON.stringify(original);
    migrateProjectFile(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('stops rather than skipping a rung it has no step for', () => {
    /*
      A version between two rungs — 1.5, from a build that shipped a
      half-finished format — must report steps: 0 so the caller refuses
      it. Silently jumping to the top is how a file gets interpreted by
      code that does not understand it. Not reachable through the app,
      which is why the RPC-level tool cannot cover it.
    */
    const r = migrateProjectFile(withVersion(1.5));
    expect(r.from).toBe(1.5);
    expect(r.steps).toBe(0);
    expect(r.file.version).toBe(1.5);
  });

  it('reports the future untouched and leaves refusing to the caller', () => {
    const r = migrateProjectFile(withVersion(99));
    expect(r.from).toBe(99);
    expect(r.steps).toBe(0);
  });
});

/* ── Opening a file ─────────────────────────────────────────────── */

describe('deserializeProject: the version gate', () => {
  it('opens a current file with no migration reported', () => {
    const r = load(withVersion(FORMAT_VERSION));
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.migratedFrom).toBeUndefined();
  });

  it('opens a legacy file and says where it came from', () => {
    // `migratedFrom` is what the RPC layer renames to
    // `migratedFromFormat` and what the home screen shows the user, so
    // "it opened" is not enough — it has to carry the number.
    const r = load(withVersion(1));
    expect(r.ok).toBe(true);
    expect(r.migratedFrom).toBe(1);
  });

  it('opens a pre-versioning file as format 1', () => {
    const r = load(baseFile());
    expect(r.ok).toBe(true);
    expect(r.migratedFrom).toBe(1);
  });

  it('REFUSES a file from a newer TeminaliCut', () => {
    const r = load(withVersion(FORMAT_VERSION + 1));
    expect(r.ok).toBe(false);
    // The message has to carry both numbers or the user cannot act on it.
    expect(r.error).toContain(String(FORMAT_VERSION + 1));
    expect(r.error).toContain(String(FORMAT_VERSION));
    expect(r.error).toMatch(/newer version/i);
  });

  it('the refusal boundary is exactly one above the current version', () => {
    // Off-by-one here either locks users out of their own files or lets
    // the future in. Both ends of the boundary, explicitly.
    expect(load(withVersion(FORMAT_VERSION)).ok).toBe(true);
    expect(load(withVersion(FORMAT_VERSION + 0.5)).ok).toBe(false);
    expect(load(withVersion(FORMAT_VERSION + 1)).ok).toBe(false);
    expect(load(withVersion(999)).ok).toBe(false);
  });

  it('REFUSES a version it has no upgrade path from', () => {
    const r = load(withVersion(1.5));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('no upgrade path');
    expect(r.error).toContain('1.5');
  });

  it('refusing the future must not have touched the stores', () => {
    /*
      The entire argument for refusing a newer file is that loading it
      would let older code reinterpret and then re-save it. If the refusal
      path has already replaced the timeline by the time it returns, the
      user's current work is gone and the newer file is loaded anyway —
      the exact damage the check exists to prevent, with an error dialog
      on top. This is the test the RPC-level tool cannot make, because
      from outside there is nothing to compare against.
    */
    const sentinel = baseFile();
    (sentinel as { version: number }).version = FORMAT_VERSION;
    (sentinel.tracks as { id: string }[])[0].id = 'sentinel-track';
    expect(load(sentinel).ok).toBe(true);
    expect(useTimelineStore.getState().tracks[0].id).toBe('sentinel-track');

    const projectBefore = useProjectStore.getState().project;
    expect(load(withVersion(999)).ok).toBe(false);
    expect(useTimelineStore.getState().tracks[0].id).toBe('sentinel-track');
    expect(useProjectStore.getState().project).toBe(projectBefore);
  });
});

describe('deserializeProject: rejecting what is not a project', () => {
  it('rejects text that is not JSON at all', () => {
    // Reachable from the app only by picking the wrong file, which is
    // exactly why it must not throw.
    for (const junk of ['', 'not json', '{', '<html></html>']) {
      const r = deserializeProject(junk);
      expect(r.ok, junk).toBe(false);
      expect(r.error, junk).toMatch(/not valid JSON/i);
    }
  });

  it('rejects valid JSON that is not a TeminaliCut project', () => {
    /*
      `null` is the interesting one and it used to THROW. It is valid
      JSON, so it sails past the try/catch around `JSON.parse` and then
      dies on the property read — the single input that could make this
      function raise instead of returning a LoadResult. Every caller,
      `restoreAutosave` on startup included, assumes it never does. A
      four-byte truncated file gets you there.
    */
    for (const json of ['{}', '[]', 'null', '42', '"a string"', '{"format":"other.thing","version":2}']) {
      const r = deserializeProject(json);
      expect(r.ok, json).toBe(false);
      expect(r.error, json).toMatch(/not a TeminaliCut project/i);
    }
  });

  it('rejects a project missing its tracks or its settings', () => {
    const noTracks = withVersion(FORMAT_VERSION);
    delete noTracks.tracks;
    expect(load(noTracks).error).toMatch(/missing its tracks or settings/i);

    const badTracks = { ...withVersion(FORMAT_VERSION), tracks: 'not an array' };
    expect(load(badTracks as AnyFile).ok).toBe(false);

    const noProject = withVersion(FORMAT_VERSION);
    delete noProject.project;
    expect(load(noProject).ok).toBe(false);
  });

  it('checks the format tag before the version, so junk is not called futuristic', () => {
    // A random JSON file with a high `version` should be told it is not
    // a TeminaliCut project, not that it needs a newer TeminaliCut.
    const r = deserializeProject(JSON.stringify({ format: 'something.else', version: 5000 }));
    expect(r.error).toMatch(/not a TeminaliCut project/i);
  });
});

/* ── What a successful load actually does ───────────────────────── */

describe('deserializeProject: loading', () => {
  it('puts the tracks and settings into the stores', () => {
    const file = withVersion(FORMAT_VERSION);
    (file.project as { name: string }).name = 'Loaded by test';
    expect(load(file).ok).toBe(true);
    expect(useTimelineStore.getState().tracks).toHaveLength(1);
    expect(useProjectStore.getState().project.name).toBe('Loaded by test');
  });

  it('backfills fields a legacy clip never had', () => {
    /*
      The reason an old file "mostly worked" before there was a ladder:
      every clip is rebuilt through `createClip`. Worth pinning, because
      it is the thing that makes ADDING a field need no migration step —
      and if it ever stops being true, the ladder gains a lot of rungs.
    */
    const file = withVersion(1);
    (file.tracks as { clips: unknown[] }[])[0].clips = [
      { id: 'c1', trackId: 'tr1', type: 'video', name: 'ancient clip' },
    ];
    expect(load(file).ok).toBe(true);
    const clip = useTimelineStore.getState().tracks[0].clips[0];
    expect(clip.transform).toBeDefined();
    expect(clip.transform.scaleX).toBe(1);
    expect(clip.keyframes).toEqual([]);
    expect(clip.effects).toEqual([]);
    expect(clip.fitMode).toBe('cover');
  });

  it('defaults a track\'s collapsed flag rather than leaving it undefined', () => {
    const file = withVersion(1);
    delete (file.tracks as Record<string, unknown>[])[0].collapsed;
    expect(load(file).ok).toBe(true);
    expect(useTimelineStore.getState().tracks[0].collapsed).toBe(false);
  });

  it('names the assets that will not resolve after a reload', () => {
    /*
      Object URLs die with the page. The format records them anyway so
      the user is told WHICH media to relink instead of opening a project
      full of silently broken clips.
    */
    const file = withVersion(FORMAT_VERSION);
    file.mediaPool = [
      { id: 'a', name: 'dropped-in.mp4', type: 'video', url: 'blob:http://x/1', thumbnailUrl: '', durationMs: 1000 },
      { id: 'b', name: 'on-disk.mp4', type: 'video', url: 'file:///tmp/on-disk.mp4', thumbnailUrl: '', durationMs: 1000 },
      { id: 'c', name: 'remote.mp4', type: 'video', url: 'https://example.com/r.mp4', thumbnailUrl: '', durationMs: 1000 },
    ];
    const r = load(file);
    expect(r.ok).toBe(true);
    expect(r.relinkNeeded).toEqual(['dropped-in.mp4']);
    // The pool is restored whole, not filtered down to the good ones.
    expect(useTimelineStore.getState().mediaPool).toHaveLength(3);
  });

  it('omits relinkNeeded entirely when every asset resolves', () => {
    // Absent, not an empty array — callers test it for truthiness.
    const file = withVersion(FORMAT_VERSION);
    file.mediaPool = [
      { id: 'b', name: 'on-disk.mp4', type: 'video', url: 'file:///tmp/x.mp4', thumbnailUrl: '', durationMs: 1 },
    ];
    expect(load(file).relinkNeeded).toBeUndefined();
    expect(load(withVersion(FORMAT_VERSION)).relinkNeeded).toBeUndefined();
  });

  it('replaces the media pool wholesale rather than merging into it', () => {
    /*
      Recorded because it has already cost a session: opening a project
      whose mediaPool is [] empties the pool for the life of the app, and
      tools/verify_keyframes.py had thirteen checks report ERROR on a
      build where all thirteen worked. Whether replace or merge is right
      is a product question; that it REPLACES is a fact other suites have
      to plan around.
    */
    const withPool = withVersion(FORMAT_VERSION);
    withPool.mediaPool = [
      { id: 'a', name: 'chart.png', type: 'image', url: 'file:///tmp/c.png', thumbnailUrl: '', durationMs: 1 },
    ];
    load(withPool);
    expect(useTimelineStore.getState().mediaPool).toHaveLength(1);

    load(withVersion(FORMAT_VERSION)); // mediaPool: []
    expect(useTimelineStore.getState().mediaPool).toHaveLength(0);
  });

  it('resets the playhead and the undo history on load', () => {
    useTimelineStore.setState((s) => ({ ...s, playheadMs: 9999 }));
    load(withVersion(FORMAT_VERSION));
    expect(useTimelineStore.getState().playheadMs).toBe(0);
    expect(useTimelineStore.getState().historyIndex).toBe(0);
    // Undoing straight after a load must not reach the previous project.
    expect(useTimelineStore.getState().history).toHaveLength(1);
  });
});

/* ── Round trip ─────────────────────────────────────────────────── */

describe('serialize -> deserialize', () => {
  it('stamps the current version and the right format tag', () => {
    const file = JSON.parse(serializeProject());
    expect(file.format).toBe('kerf.project');
    expect(file.version).toBe(FORMAT_VERSION);
    expect(typeof file.savedAt).toBe('number');
  });

  it('a file this build writes is a file this build opens clean', () => {
    /*
      The one invariant that must never break: the writer and the reader
      agree. If `serializeProject` ever emitted a version the gate
      refuses, every save would produce an unopenable file.
    */
    const file = withVersion(FORMAT_VERSION);
    (file.project as { name: string }).name = 'Round trip';
    (file.tracks as { clips: unknown[] }[])[0].clips = [
      { id: 'c1', trackId: 'tr1', type: 'video', name: 'a clip', startTimeMs: 1500, durationMs: 2500 },
    ];
    expect(load(file).ok).toBe(true);

    const again = deserializeProject(serializeProject());
    expect(again.ok).toBe(true);
    expect(again.migratedFrom).toBeUndefined();
    expect(useProjectStore.getState().project.name).toBe('Round trip');
    const clip = useTimelineStore.getState().tracks[0].clips[0];
    expect(clip.startTimeMs).toBe(1500);
    expect(clip.durationMs).toBe(2500);
  });

  it('survives a second round trip without drifting', () => {
    const file = withVersion(FORMAT_VERSION);
    (file.tracks as { clips: unknown[] }[])[0].clips = [
      { id: 'c1', trackId: 'tr1', type: 'text', name: 'Title' },
    ];
    load(file);
    const first = serializeProject();
    deserializeProject(first);
    const second = serializeProject();
    // `savedAt` is a clock reading; everything else must be identical.
    const strip = (json: string) => {
      const o = JSON.parse(json);
      delete o.savedAt;
      return JSON.stringify(o);
    };
    expect(strip(second)).toBe(strip(first));
  });
});

/* ── Autosave ───────────────────────────────────────────────────── */

describe('autosave', () => {
  it('reports absence before anything is stored', () => {
    expect(hasAutosave()).toBe(false);
    const r = restoreAutosave();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no autosave/i);
  });

  it('restores what was stored, and clears cleanly', () => {
    const file = withVersion(FORMAT_VERSION);
    (file.project as { name: string }).name = 'Autosaved';
    load(file);
    localStorage.setItem('kerf.autosave', serializeProject());

    expect(hasAutosave()).toBe(true);
    useProjectStore.getState().loadProjectSettings({
      ...useProjectStore.getState().project,
      name: 'Something else',
    });
    expect(restoreAutosave().ok).toBe(true);
    expect(useProjectStore.getState().project.name).toBe('Autosaved');

    clearAutosave();
    expect(hasAutosave()).toBe(false);
  });

  it('a corrupt autosave is refused, not thrown', () => {
    // A quota-truncated write leaves half a JSON document behind, and
    // this runs on startup — throwing here would be a dead app.
    localStorage.setItem('kerf.autosave', '{"format":"kerf.project","ver');
    expect(hasAutosave()).toBe(true);
    expect(restoreAutosave().ok).toBe(false);
  });
});

/* ── Media pool identity ──────────────────────────────────────────── */

describe('the media pool holds one entry per asset id', () => {
  it('replaces rather than duplicating when an id comes back', async () => {
    /*
      `addMediaAsset` unshifted unconditionally, and several assets carry
      a FIXED id: the starter's bed is `starter:kerf-film-bed` and every
      seeded sample is `media_*`. Opening the starter twice therefore put
      two entries with the same id in the pool, and React logged
      "Encountered two children with the same key" on every media panel
      render. Found in the packaged app's own error log.

      `open_starter_project` is a tool, so an agent can do this in a loop.
    */
    const { useTimelineStore } = await import('../store/timelineStore');
    const store = useTimelineStore.getState();

    const asset = {
      id: 'starter:kerf-film-bed',
      name: 'bed', type: 'audio' as const, url: 'file:///bed.wav',
      durationMs: 1000, addedAt: 0,
    };

    store.addMediaAsset(asset as never);
    store.addMediaAsset(asset as never);
    store.addMediaAsset({ ...asset, name: 'bed renamed' } as never);

    const pool = useTimelineStore.getState().mediaPool;
    const mine = pool.filter((a) => a.id === 'starter:kerf-film-bed');
    expect(mine).toHaveLength(1);
    // The later add wins, so re-importing updates rather than shadowing.
    expect(mine[0].name).toBe('bed renamed');
    // Every id in the pool is unique, not just this one.
    expect(new Set(pool.map((a) => a.id)).size).toBe(pool.length);
  });
});

describe('loading heals a pool that a previous bug duplicated', () => {
  it('drops repeats of the same asset id on restore', async () => {
    /*
      Fixing `addMediaAsset` stops NEW duplicates and does nothing for a
      project or an autosave already holding five copies of the starter's
      bed, which is then restored on every launch for ever. Measured on
      the installed build: the fix held (five more opens added nothing)
      while the pool still carried five copies from before it.
    */
    const { useTimelineStore } = await import('../store/timelineStore');
    const { deserializeProject, serializeProject } = await import('./projectIO');

    const asset = (name: string) => ({
      id: 'starter:kerf-film-bed', name, type: 'audio' as const,
      url: 'file:///bed.wav', durationMs: 1000, addedAt: 0,
    });

    // A file written while the bug was live.
    const file = JSON.parse(serializeProject());
    file.mediaPool = [asset('first'), asset('dupe'), asset('dupe again')];

    const result = deserializeProject(JSON.stringify(file));
    expect(result.ok).toBe(true);

    const pool = useTimelineStore.getState().mediaPool;
    const beds = pool.filter((a) => a.id === 'starter:kerf-film-bed');
    expect(beds).toHaveLength(1);
    // First wins, so a stale copy behind a fresher one cannot resurrect.
    expect(beds[0].name).toBe('first');
  });
});
