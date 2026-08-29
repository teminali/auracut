/*
 * @vitest-environment jsdom
 *
 * Where the Player lives, and what opening it is allowed to mean.
 *
 * There is ONE Player and two doors into it: Home's Play action and the
 * Editor monitor's fullscreen button. Both set the same flag, which is
 * the whole reason the flag is in the store rather than being local
 * state in one of the two screens.
 *
 * The rule these checks exist to hold is the one that is easy to break
 * by accident later: WATCHING IS NOT EDITING. Opening the Player from
 * Home leaves `showHome` true, and autosave is wired to `showHome` — so
 * if anything ever makes the Player imply "in the editor", a project
 * that was only played starts writing an autosave slot, and Home starts
 * offering to recover work nobody did. Verified against the running app
 * as well: 26 seconds inside the Player, longer than the 20s autosave
 * period, wrote no slot.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
  The store persists, so it needs somewhere to persist TO before it is
  imported. jsdom here has no localStorage, and zustand resolves its
  storage at module scope — so this has to be hoisted above the import
  or `setState` throws on the first write.
*/
vi.hoisted(() => {
  const mem = new Map<string, string>();
  const shim = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = shim;
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  }
  return {};
});

import { useLayoutStore } from './layoutStore';

const layout = () => useLayoutStore.getState();

describe('the player flag', () => {
  beforeEach(() => {
    useLayoutStore.setState({ isPlayerOpen: false, showHome: true });
  });

  it('starts closed', () => {
    expect(layout().isPlayerOpen).toBe(false);
  });

  it('opens and closes through the store, not through a screen', () => {
    layout().openPlayer();
    expect(layout().isPlayerOpen).toBe(true);
    layout().closePlayer();
    expect(layout().isPlayerOpen).toBe(false);
  });

  it('does not move the user off home when opened from home', () => {
    // The whole non-destructive viewing session rests on this.
    expect(layout().showHome).toBe(true);
    layout().openPlayer();
    expect(layout().showHome).toBe(true);
  });

  it('does not send the user home when opened from the editor', () => {
    useLayoutStore.setState({ showHome: false });
    layout().openPlayer();
    expect(layout().showHome).toBe(false);
    layout().closePlayer();
    expect(layout().showHome).toBe(false);
  });

  it('is one flag, so both doors reach the same player', () => {
    // Two callers, one piece of state. If this ever became two booleans
    // there would be two players and only one of them would be real.
    layout().openPlayer();
    const fromHome = layout().isPlayerOpen;
    layout().closePlayer();
    useLayoutStore.setState({ showHome: false });
    layout().openPlayer();
    expect(layout().isPlayerOpen).toBe(fromHome);
  });

  it('is NOT persisted, so the app can never start up inside it', () => {
    /*
      A persisted player flag would restore an app into a fullscreen
      player over whatever project happened to load, with no timeline
      behind it. `partialize` is what stops it, and this is the check
      that keeps it out of the list.
    */
    layout().openPlayer();
    /* Ask the store what it actually writes, rather than guessing the
       key name: `partialize` IS the list, and this fails the moment
       somebody adds the flag to it. */
    const partialize = useLayoutStore.persist.getOptions().partialize;
    expect(partialize).toBeTypeOf('function');
    const persisted = partialize!(useLayoutStore.getState()) as unknown as Record<string, unknown>;
    expect(Object.keys(persisted)).not.toContain('isPlayerOpen');
    expect(Object.keys(persisted)).not.toContain('showHome');
  });
});
