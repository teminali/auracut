"""
Every capability the store has must be reachable by a tool — enforced.

    Kerf must be running.  python3 tools/verify_tool_coverage.py
                           python3 tools/verify_tool_coverage.py --selftest

This is the audit from NEXT.md §6c turned into a check that cannot rot.
Run by hand it reported `105 store actions, 66 unreachable`; left as a
one-off python snippet in a markdown file it would report that number
again next month whatever anyone did about it.

WHY THE STATIC HALF IS NOT ENOUGH
---------------------------------
The snippet in NEXT.md answers one question — does the string
`.someAction(` appear in `toolRegistry.ts` — and then a human waves a
hand at the rest: "filtering the ones `patch_clip` already covers
through property paths, and the genuinely UI-only ones". Both halves of
that hand-wave are exactly the kind of claim this repo has learned not
to accept:

  * "`patch_clip` covers it" is a claim about a property path RESOLVING
    AND WRITING. `mask.rotation` was settable, keyframeable, listed,
    rendered — and `patch_clip` returned success while writing nothing.
    So every COVERED_BY_PATCH entry below is PROVEN at runtime here, by
    driving `patch_clip` and reading the before/after it reports back.
    A path that no longer writes fails this suite.

  * "it is UI-only" is a judgement, so it is written down WITH ITS
    REASON, one line each, and anything not on the list is a FAILURE.
    A future action added to the store is unreachable and unexplained
    until somebody either writes a tool or writes a reason.

And the list is kept honest in both directions: an entry that HAS grown
a tool since it was excused also fails, so the excuses cannot outlive
the thing they were excusing.
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

results = []


def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:44s} {detail}")
    results.append(good)


# ── the store's surface, and what the registry reaches ──────────────

def store_actions():
    src = open(os.path.join(ROOT, 'src/store/timelineStore.ts')).read()
    m = re.search(r'interface TimelineActions \{(.*?)\n\}', src, re.S)
    if not m:
        raise SystemExit('ERROR: could not find `interface TimelineActions` — '
                         'the store was restructured and this suite needs updating.')
    return sorted(set(re.findall(r'^\s{2}(\w+):\s*\(', m.group(1), re.M)))


def reached_by_tools():
    src = open(os.path.join(ROOT, 'src/mcp/toolRegistry.ts')).read()
    return src


# ── the two excuses, each with its reason ───────────────────────────

# Reachable through `patch_clip` / `patch_clips`, which write clip
# properties by path. Each entry names a REPRESENTATIVE PATH and a value
# to write, and the runtime half below proves the path actually writes.
COVERED_BY_PATCH = {
    'setClipProperty':      ('name', 'renamed by patch'),
    'setClipBlendMode':     ('blendMode', 'screen'),
    'setClipFitMode':       ('fitMode', 'cover'),
    'toggleClipLock':       ('locked', True),
    'updateClipTransform':  ('transform.x', 137.0),
    'updateClipsTransform': ('transform.y', 91.0),
    'resetClipTransform':   ('transform.scaleX', 0.5),
    'updateClipMask':       ('mask.featherPx', 12.0),
    'updateClipFilters':    ('filters.brightness', 22.0),
    'updateClipChromaKey':  ('chromaKey.similarity', 55.0),
    'updateClipAudio':      ('audio.volume', 0.4),
    'updateClipText':       ('textStyle.fontSize', 44.0),
    'updateShapeStyle':     ('shapeStyle.fill', '#ff0088'),
}

# Deliberately not exposed. One line of reason each — if you cannot
# write the reason, the honest conclusion is that it IS a gap.
UI_ONLY = {
    'setZoomLevel':       'timeline zoom is a view of the edit, not part of it',
    'zoomToFit':          'ditto; takes a viewport width in px, which an agent has no notion of',
    'setTrackHeight':     'track row height in the editor UI; affects no output',
    'toggleCanvasGuides': 'overlay drawn on the editing canvas only, never on export',
    'toggleSnapping':     'behaviour of dragging in the UI; an agent passes exact times',
    'toggleRippleEdit':   'behaviour of dragging in the UI; the tools take an explicit ripple flag',
    'togglePlay':         'preview transport; export renders offline and never plays',
    'setIsPlaying':       'preview transport, as above',
    'toggleLoop':         'preview transport, as above',
    'setPlaybackRate':    'preview transport speed; clip speed is `set_speed`, which does affect output',
    'nudgePlayhead':      'relative playhead move; `seek` sets it absolutely, which is what an agent wants',
    'selectClip':         'singular form of the selection that `select_clips` already sets',
    'clearSelection':     '`select_clips` with an empty list',
    'setSelectedTrackId': 'track selection is UI focus; every track tool takes an explicit trackId',
    'setAssetPeaks':      'internal waveform cache, filled by the audio decoder, not an edit',
    'insertClipObject':   'internal: re-inserts an existing clip object during undo and paste',
    # Grouping looks like an editing capability and is not one outside
    # the mouse. `clip.groupId` is read in exactly one place —
    # ClipBlock.tsx's drag handler — so it makes clips move together
    # when a HUMAN drags them. No store operation honours it: `moveClip`
    # moves one clip straight out of its group and leaves the rest
    # behind, and `trimClip` ignores it entirely, though edl.ts:430 says
    # "move and trim together". Exposing it would give an agent a flag
    # that changes nothing the agent itself can do — a tool that reports
    # success and does nothing, which is the thing this repo keeps
    # finding. Logged as a gap in HANDOVER §4 instead of papered over.
    'groupSelected':      'groupId is honoured only by the UI drag handler; no store op or render reads it',
    'ungroupSelected':    'ditto — the inverse of a UI-only flag',
}


def main(selftest=False):
    actions = store_actions()
    registry = reached_by_tools()

    direct = [a for a in actions if f'.{a}(' in registry]
    missing = [a for a in actions if a not in direct]

    print(f'\n  {len(actions)} store actions · {len(direct)} reached directly by a tool\n')

    # ── 1. nothing may be unclassified ──────────────────────────────
    unexplained = [a for a in missing
                   if a not in COVERED_BY_PATCH and a not in UI_ONLY]
    check('every store action is reachable or excused',
          not unexplained,
          'all accounted for' if not unexplained
          else f'{len(unexplained)} unreachable and unexplained: {", ".join(unexplained)}')

    # ── 2. the excuses may not outlive what they excused ────────────
    stale = [a for a in list(COVERED_BY_PATCH) + list(UI_ONLY) if a in direct]
    check('no excuse outlives its gap',
          not stale,
          'none stale' if not stale
          else f'{", ".join(stale)} now has a tool — delete the entry')

    # ── 3. prove the patch_clip claim, path by path ─────────────────
    # A shape clip carries every prefix except textStyle; a text clip
    # carries textStyle. Both are built so no claim goes untested.
    ok(call('reset_project', {'name': 'coverage', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': 2000}), 'reset')
    vt = ok(call('add_track', {'type': 'video', 'name': 'V'}), 'track')['trackId']
    tt = ok(call('add_track', {'type': 'text', 'name': 'T'}), 'track')['trackId']
    shape = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': vt,
                                        'startTimeMs': 0, 'durationMs': 2000}), 'shape')['clipId']
    text = ok(call('add_text_layer', {'trackId': tt, 'text': 'coverage',
                                      'startTimeMs': 0, 'durationMs': 2000}), 'text')['clipId']

    for action, (path, value) in sorted(COVERED_BY_PATCH.items()):
        clip = text if path.startswith('textStyle') else shape

        # `locked` is the one path that would lock the clip against the
        # rest of this loop, so it is set and immediately released.
        r = ok(call('patch_clip', {'clipId': clip, 'properties': {path: value}}), f'patch {path}')
        changes = {c['path']: c for c in r.get('changes', [])}
        applied = path in r.get('applied', [])
        wrote = path in changes and changes[path]['from'] != changes[path]['to']

        if selftest:
            # Hold it STILL: write the value that is already there. A
            # path that reports a change here is reporting noise, and
            # the check above it would pass on noise too.
            same = ok(call('patch_clip', {'clipId': clip, 'properties': {path: value}}),
                      f'restate {path}')
            rest = {c['path']: c for c in same.get('changes', [])}
            moved = path in rest and rest[path]['from'] != rest[path]['to']
            check(f'{action} · {path} still',
                  not moved,
                  f"rewriting {value!r} reports no change" if not moved
                  else f"reported {rest[path]['from']!r} -> {rest[path]['to']!r} on a REWRITE")
        else:
            check(f'{action} · patch_clip {path}',
                  applied and wrote,
                  f"{changes[path]['from']!r} -> {changes[path]['to']!r}" if wrote
                  else f'applied={applied} changes={r.get("changes")} — path did NOT write')

        if path == 'locked':
            ok(call('patch_clip', {'clipId': clip, 'properties': {'locked': False}}), 'unlock')

    # ── 4. patch_clips, the batch form ──────────────────────────────
    if not selftest:
        r = ok(call('patch_clips', {'clipIds': [shape, text],
                                    'properties': {'transform.rotation': 15.0}}), 'patch_clips')
        n = r.get('updatedClips', 0)
        check('updateClipsTransform · patch_clips batch', n >= 2,
              f'patched {n} clips in one call')

    kind = 'tool-coverage selftest' if selftest else 'tool-coverage'
    print(f'\n{sum(results)}/{len(results)} {kind} checks passed')
    if not all(results):
        failed = len(results) - sum(results)
        print(f'failing: {failed}')
        sys.exit(1)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--selftest', action='store_true',
                    help='hold every property still and require each to report NO change')
    main(ap.parse_args().selftest)
