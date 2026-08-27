"""
How Kerf behaves on a long timeline. Measurement, not a pass/fail suite.

    Kerf must be running (KERF_DEBUG=1 for the memory numbers).
    KERF_RPC_PORT=<port> python3 tools/measure_scale.py

HANDOVER §8 has listed "No performance work. Long timelines, many clips,
4K playback, memory over a long session — all unmeasured" since the app
was built, and §2 of NEXT.md is the reason this is a measuring tool and
not a suite: **timings on this machine move with load**, a single pair of
readings minutes apart established a 1.6x difference that did not exist,
and a threshold on an absolute millisecond figure would be a flaky check
that teaches people to ignore red.

So this reports SHAPE rather than asserting speed. The question worth
answering is not "how many ms" — that depends on the machine, the load
and whether the window is up — it is **"what happens when the timeline
gets ten times longer?"** A cost that grows with the square of the clip
count is a design problem at any speed; one that grows linearly is
arithmetic, and you can buy your way out of it.

Fits a power law to each measurement: cost proportional to clips^k.

    k ~ 0     the cost does not depend on clip count at all
    k ~ 1     linear — every clip costs the same to consider
    k ~ 2     quadratic — something looks at every clip for every clip

Run it before and after touching the render path. The exponent is stable
across machines and load in a way the milliseconds are not.
"""
import sys, os, json, time, math, statistics, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok, token, ENDPOINT

# Enough spread to fit a slope, few enough points to run in a coffee break.
CLIP_COUNTS = [25, 50, 100, 200, 400]
REPEATS = 3


def debug_eval(expression):
    body = json.dumps({'method': 'debug/eval', 'params': {'expression': expression}}).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={'x-kerf-token': token(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r).get('result')
    except Exception:
        return None


def heap_mb():
    """Chromium's JS heap. None without KERF_DEBUG=1, and that is fine —
    the timing numbers do not depend on it."""
    v = debug_eval('performance.memory ? performance.memory.usedJSHeapSize : 0')
    try:
        return float(v) / (1024 * 1024) if v else None
    except (TypeError, ValueError):
        return None


def build(n):
    """A timeline of n shape clips laid end to end.

    Shapes, not media: this is measuring what the COMPOSITOR and the
    stores do with clip count, and media would add decode time that
    varies with what the OS has cached. Four tracks, because a real long
    timeline is layered and a single track would miss any per-track cost.
    """
    ok(call('reset_project', {'name': f'scale{n}', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#101010',
                              'durationMs': max(4000, n * 200)}), 'reset')
    tracks = [ok(call('add_track', {'type': 'video', 'name': f'V{i}'}), 't')['trackId']
              for i in range(4)]
    for i in range(n):
        ok(call('add_shape_layer', {
            'kind': 'rectangle' if i % 2 else 'ellipse',
            'trackId': tracks[i % len(tracks)],
            'startTimeMs': i * 200,
            'durationMs': 600,
            'style': {'fill': f'#{(i * 37) % 256:02x}{(i * 71) % 256:02x}{(i * 113) % 256:02x}'},
        }), f'shape {i}')
    return tracks


def timed(fn, repeats=REPEATS):
    """Median of several runs. The median rather than the mean because a
    single scheduling hiccup should not move the number."""
    out = []
    for _ in range(repeats):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return statistics.median(out)


def exponent(counts, values):
    """Least-squares slope of log(value) against log(count).

    Reported to one decimal because the third digit is noise, and the
    whole point is telling 1 from 2.
    """
    pairs = [(math.log(c), math.log(v)) for c, v in zip(counts, values) if v > 0]
    if len(pairs) < 2:
        return float('nan')
    mx = sum(p[0] for p in pairs) / len(pairs)
    my = sum(p[1] for p in pairs) / len(pairs)
    num = sum((x - mx) * (y - my) for x, y in pairs)
    den = sum((x - mx) ** 2 for x, _ in pairs)
    return num / den if den else float('nan')


print('Kerf at scale — cost against clip count\n')
print('  Reports the power-law exponent k in cost ~ clips^k, because absolute')
print('  milliseconds on this machine move with load (NEXT.md §2). k~1 is')
print('  linear and fine; k~2 means something is looking at every clip for')
print('  every clip.\n')

base_heap = heap_mb()
rows = []

for n in CLIP_COUNTS:
    t_build = timed(lambda: build(n), repeats=1)

    mid = (n * 200) // 2
    t_frame = timed(lambda: ok(call('get_frame_context', {'atMs': mid, 'includeImage': True}), 'f'))
    t_desc = timed(lambda: ok(call('describe_timeline', {}), 'd'))

    out = f'/tmp/kerf-scale-{n}.mp4'
    r = ok(call('render_export', {'resolution': '720p', 'durationMs': 1000, 'outputPath': out}), 'r')
    composite_per_frame = r['timing']['compositeMs'] / max(1, r['frames'])

    heap = heap_mb()
    rows.append({
        'clips': n, 'build_ms': t_build, 'frame_ms': t_frame,
        'describe_ms': t_desc, 'composite_ms_per_frame': composite_per_frame,
        'heap_mb': heap,
    })
    print(f"  {n:4d} clips   build {t_build:8.0f}ms   get_frame {t_frame:7.1f}ms   "
          f"describe {t_desc:6.1f}ms   composite {composite_per_frame:6.3f}ms/frame"
          + (f"   heap {heap:6.1f}MB" if heap else ""))

print('\n  scaling (cost ~ clips^k):')
for key, label in (('frame_ms', 'get_frame_context'),
                   ('describe_ms', 'describe_timeline'),
                   ('composite_ms_per_frame', 'composite per frame'),
                   ('build_ms', 'building the timeline')):
    k = exponent([r['clips'] for r in rows], [r[key] for r in rows])
    verdict = ('flat' if k < 0.4 else 'LINEAR' if k < 1.4 else
               'super-linear' if k < 1.7 else 'QUADRATIC — a design problem')
    print(f"    {label:24s} k = {k:5.2f}   {verdict}")

if base_heap and rows[-1]['heap_mb']:
    print(f"\n  heap: {base_heap:.1f}MB at rest -> {rows[-1]['heap_mb']:.1f}MB at "
          f"{rows[-1]['clips']} clips  ({rows[-1]['heap_mb'] - base_heap:+.1f}MB)")

print("\n  Absolute figures are for THIS machine at this load; the exponents are")
print("  the part worth comparing across runs.")
