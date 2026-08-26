/* ═══════════════════════════════════════════════════════════════════
   Fragment shaders for the GPU stage.

   For most of this project's life this file was exported by nothing and
   imported by nowhere — ninety lines of GLSL that read as a capability
   and was not one. `gpuStage.ts` is what runs it now.

   Written against GLSL ES 1.00 (`varying`, `texture2D`, `gl_FragColor`)
   so the same source compiles in a WebGL1 context and in a WebGL2 one,
   which is what lets the stage fall back rather than fail.
   ═══════════════════════════════════════════════════════════════════ */

export const SHADER_CHROMA_KEY_FS = `
precision mediump float;
uniform sampler2D u_image;
uniform vec3 u_keyColor;
uniform float u_similarity;
uniform float u_smoothness;
uniform float u_spill;
varying vec2 v_texCoord;

void main() {
  vec4 color = texture2D(u_image, v_texCoord);
  float dist = length(color.rgb - u_keyColor);
  float alpha = smoothstep(u_similarity, u_similarity + u_smoothness, dist);

  /*
    Despill.

    This used to desaturate by how CLOSE a pixel was to the key colour —
    which is to say it only ever touched pixels that the line above had
    already made transparent, so the control did nothing you could see.
    Spill is the opposite problem: it is the screen bouncing onto the
    subject, and it lives in the pixels that SURVIVE the key.

    So: find which channel the screen is, and where a surviving pixel has
    more of that channel than of the others, pull it back down to them.
    That is the standard limiter, and it generalises to a blue screen
    without a second branch.
  */
  float kmax = max(max(u_keyColor.r, u_keyColor.g), u_keyColor.b);
  vec3 isKey = step(kmax - 0.001, u_keyColor);
  float otherCount = max(1.0, 3.0 - dot(isKey, vec3(1.0)));
  float others = dot(color.rgb, vec3(1.0) - isKey) / otherCount;
  color.rgb = mix(color.rgb, min(color.rgb, vec3(others)), isKey * u_spill);

  gl_FragColor = vec4(color.rgb, color.a * alpha);
}
`;

/*
  Unreferenced, and one of the three below cannot run here at all.

  `SHADER_WHIP_PAN_FS`, `SHADER_RGB_GLITCH_FS` and `SHADER_FILM_GRAIN_FS`
  are exported and imported by nobody except the `rgb_glitch` key, which
  no effect in the registry names. Left as written rather than deleted,
  but with the reason recorded, because the whip pan one is not merely
  unused — it is unusable:

  it takes `u_from` AND `u_to`, i.e. two clips crossing. Kerf's
  transitions are not a pair. A `ClipTransition` belongs to ONE clip and
  is an alpha-and-transform ramp on that clip alone; `runShader` uploads
  exactly one texture, and there is no second one to give it. So this
  shader was written against a transition model this app does not have,
  and the working whip pan is `SHADER_MOTION_STREAK_FS` further down,
  which streaks the one clip it does have. Anyone reading this file for
  "does Kerf do GPU transitions" should not take these three as evidence
  either way.
*/
export const SHADER_WHIP_PAN_FS = `
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress; // 0.0 to 1.0
uniform float u_direction; // -1.0 or 1.0
varying vec2 v_texCoord;

void main() {
  vec2 p = v_texCoord;
  float offset = u_progress * u_direction;
  
  // Motion blur sampling
  vec4 c1 = vec4(0.0);
  vec4 c2 = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    float fi = float(i) / 8.0;
    c1 += texture2D(u_from, p + vec2(offset * fi * 0.4, 0.0));
    c2 += texture2D(u_to, p + vec2((offset - 1.0) * fi * 0.4, 0.0));
  }
  c1 /= 8.0;
  c2 /= 8.0;

  gl_FragColor = mix(c1, c2, step(0.5, u_progress));
}
`;

export const SHADER_RGB_GLITCH_FS = `
precision mediump float;
uniform sampler2D u_image;
uniform float u_amount;
varying vec2 v_texCoord;

void main() {
  vec2 p = v_texCoord;
  float split = u_amount * 0.02;
  
  float r = texture2D(u_image, p + vec2(split, 0.0)).r;
  float g = texture2D(u_image, p).g;
  float b = texture2D(u_image, p - vec2(split, 0.0)).b;
  float a = texture2D(u_image, p).a;

  gl_FragColor = vec4(r, g, b, a);
}
`;

export const SHADER_FILM_GRAIN_FS = `
precision mediump float;
uniform sampler2D u_image;
uniform float u_intensity;
uniform float u_time;
varying vec2 v_texCoord;

float random(vec2 p) {
  return fract(sin(dot(p + u_time, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 color = texture2D(u_image, v_texCoord);
  float noise = (random(v_texCoord) - 0.5) * u_intensity * 0.15;
  gl_FragColor = vec4(color.rgb + noise, color.a);
}
`;

/* ═══════════════════════════════════════════════════════════════════
   MESH WARPS — vertex programs.

   Everything above this line is a fragment program: it can decide what
   colour a pixel is, and it can decide which texel to read, but the
   sheet it reads from is always a flat full-screen rectangle. That is
   why `NEXT.md` listed page curl under "still not possible" rather than
   under "not written yet" — a page curl is not a colour decision, it is
   a *shape*. The sheet leaves the plane, folds over itself, and shows
   you its back.

   So `gpuStage` now draws a subdivided grid instead of one quad, and
   these programs move its vertices. The rules that follow from that:

     • **The texture coordinate is never displaced.** `v_texCoord` is the
       undisplaced grid coordinate, always inside 0..1. The image is
       carried BY the geometry, which is what lets a warp push pixels
       outside the source rectangle — a UV-offset fragment warp cannot,
       because it can only ever read what is already there.
     • **Shading comes from the surface slope**, computed here from the
       displacement's own derivative. A fragment program cannot do this:
       it does not know what shape the sheet is. If the shading in these
       warps ever stops tracking the geometry, the geometry is what to
       distrust.
     • **`v_back` says the fragment is looking at the reverse of the
       sheet.** Only the curl folds, so only the curl ever sets it.
     • uv.y = 0 is the BOTTOM of the frame. The stage uploads the layer
       with `UNPACK_FLIP_Y_WEBGL`, so the grid, the angles below and the
       `angle` parameters of the effects that use them are all y-up.
   ═══════════════════════════════════════════════════════════════════ */

const MESH_VS_PREAMBLE = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
uniform float u_aspect;
uniform float u_shading;
varying vec2 v_texCoord;
varying float v_shade;
varying float v_back;

const float PI = 3.14159265359;

/* A fixed key light, slightly up and to the left of the viewer. */
const vec3 KEY_LIGHT = vec3(-0.35, 0.45, 0.82);

/*
  Lambert, normalised so a FLAT surface returns exactly 1.0.

  Without that normalisation every warp would darken its own untouched
  regions the moment shading was switched on, and "the warp changed the
  picture" would stop meaning anything — the check could not tell a
  displaced pixel from a merely dimmer one. u_shading = 0 disables the
  term entirely, which is the control that separates the two.
*/
float shadeFor(vec3 n) {
  float flatLit = KEY_LIGHT.z;               // dot(vec3(0,0,1), KEY_LIGHT)
  float lit = clamp(dot(normalize(n), normalize(KEY_LIGHT)), 0.0, 1.0)
            / clamp(flatLit, 0.001, 1.0);
  return mix(1.0, lit, clamp(u_shading, 0.0, 1.0));
}

/*
  Depth, so the fold can cover what it folded over.

  The stage draws with the depth test on and blending OFF, and the grid
  is emitted row by row rather than back to front, so painter's order
  would put the far edge of a curled page on top of the near one on
  roughly half of all angles. 'height' is in the same units as the rest
  of the vertex program; 'full' is the largest height that program can
  reach, so the mapping stays inside the clip volume whatever the radius.
*/
float depthFor(float height, float full) {
  return 0.9 - 1.7 * clamp(height / max(full, 0.0001), 0.0, 1.0);
}
`;

/**
 * Page curl.
 *
 * The sheet wraps around a cylinder of radius `u_radius` lying on the
 * page, perpendicular to `u_angle`. Points before the curl line stay
 * exactly where they were; points past it travel around the cylinder
 * (arc length is preserved, which is why the page does not stretch),
 * and points past the half-turn lie flat on top of the sheet, printed
 * side down.
 *
 * The normal is the cylinder's own normal, so the shading band across
 * the curl is the geometry, not a painted gradient.
 */
export const SHADER_PAGE_CURL_VS = MESH_VS_PREAMBLE + `
uniform float u_progress;   // 0 = flat, 1 = the sheet has left the frame
uniform float u_angle;      // the direction the curl travels, radians, y-up
uniform float u_radius;     // cylinder radius, in frame heights

void main() {
  vec2 uv = a_texCoord;
  v_texCoord = uv;

  /* Aspect-corrected page space: y spans 1, x spans the aspect ratio, so
     the curl is a cylinder and not an ellipse on a 16:9 frame. */
  vec2 w = vec2(uv.x * u_aspect, uv.y);
  vec2 d = vec2(cos(u_angle), sin(u_angle));
  vec2 perp = vec2(-d.y, d.x);

  /* How far the page reaches along the curl direction — from its four
     corners, so any angle works without a special case. */
  float c1 = dot(vec2(u_aspect, 0.0), d);
  float c2 = dot(vec2(0.0, 1.0), d);
  float c3 = dot(vec2(u_aspect, 1.0), d);
  float sMin = min(min(0.0, c1), min(c2, c3));
  float sMax = max(max(0.0, c1), max(c2, c3));

  float R = max(0.015, u_radius);

  /*
     The curl line starts ON the far edge. It does not need to start
     BEYOND it: a point exactly on the line has travelled zero arc length
     and so is not displaced, which is why progress 0 still measures as
     pixel-identical to no effect at all. Starting a half-turn out, as
     this first did, buys nothing and spends the first 15% of the
     animation on a frame that does not move.

     Where it ENDS is worth deriving rather than guessing, and guessing
     cost a render: the first version travelled a whole extra page-length
     past the near edge, on the assumption that the folded-over half
     needed room to leave. It does not. The flat part sits at sOut = s;
     the cylinder reaches s0 + R at most; and the folded-back part runs
     from s0 BACKWARDS. So nothing on the sheet is ever further along
     than s0 + R, and the sheet is clear of the frame the moment
     s0 + R < sMin. Travelling twice that far meant the page was gone by
     progress 45 and the second half of every curl was an empty frame.
  */
  float s0 = mix(sMax, sMin - R * 1.2, clamp(u_progress, 0.0, 1.0));

  float s = dot(w, d);
  float q = dot(w, perp);
  float past = s - s0;

  float sOut = s;
  float height = 0.0;
  vec3 n = vec3(0.0, 0.0, 1.0);
  float back = 0.0;

  if (past > 0.0) {
    float phi = past / R;
    if (phi <= PI) {
      // On the cylinder. Arc length past the line is R * phi.
      sOut = s0 + R * sin(phi);
      height = R * (1.0 - cos(phi));
    } else {
      // Past the half-turn: flat again, printed side down, running back
      // over the sheet it came from.
      sOut = s0 - (past - PI * R);
      height = 2.0 * R;
      phi = PI;
    }
    /* The ink faces +z where the sheet is flat and rotates with phi, so
       the reverse comes into view at a quarter turn. */
    n = vec3(-sin(phi) * d, cos(phi));
    back = step(PI * 0.5, phi);
    if (back > 0.5) n = -n;
  }

  v_back = back;
  v_shade = shadeFor(n);

  vec2 wOut = d * sOut + perp * q;
  vec2 outUv = vec2(wOut.x / max(u_aspect, 0.0001), wOut.y);
  gl_Position = vec4(outUv * 2.0 - 1.0, depthFor(height, 2.0 * R), 1.0);
}
`;

/**
 * Flag / wave.
 *
 * A travelling sine lifts the sheet out of the plane. What you see is
 * the projection of that: the raised parts come toward the viewer and
 * grow slightly, the sheet swings across the wave direction, and the
 * slope shades it. The three together are what make it read as cloth
 * rather than as a rectangle breathing.
 *
 * `u_anchor` tapers the amplitude to zero at the leading edge — a flag
 * on a pole. The taper's own derivative is in the slope, so the shading
 * stays correct right up to the pole instead of banding there.
 */
export const SHADER_FLAG_WAVE_VS = MESH_VS_PREAMBLE + `
uniform float u_amp;      // out-of-plane amplitude, in frame heights
uniform float u_waves;    // wave count across the frame along u_angle
uniform float u_time;     // radians of phase; must advance or nothing moves
uniform float u_angle;    // direction the wave travels, radians, y-up
uniform float u_anchor;   // 0 = free cloth, 1 = pinned at the leading edge

const float SWAY = 0.55;   // how far the sheet swings across the wave
const float PERSP = 0.42;  // how much nearer parts of the sheet grow

void main() {
  vec2 uv = a_texCoord;
  v_texCoord = uv;
  v_back = 0.0;

  vec2 d = vec2(cos(u_angle), sin(u_angle));
  vec2 perp = vec2(-d.y, d.x);

  float g = dot(uv, d);
  float k = u_waves * 2.0 * PI;
  float phase = g * k - u_time;

  /* smoothstep taper, and its own derivative — 6g(1-g) — so the slope
     below is the slope of what is actually drawn. */
  float gc = clamp(g, 0.0, 1.0);
  float taper = mix(1.0, gc * gc * (3.0 - 2.0 * gc), clamp(u_anchor, 0.0, 1.0));
  float dTaper = clamp(u_anchor, 0.0, 1.0) * 6.0 * gc * (1.0 - gc);

  float h = u_amp * sin(phase) * taper;
  float dhdg = u_amp * (k * cos(phase) * taper + sin(phase) * dTaper);

  /* uv.x covers 'aspect' world units, so an x gradient in uv is that
     many times smaller in the world. Getting this wrong tilts the
     lighting on every frame that is not square. */
  vec3 n = normalize(vec3(-dhdg * d.x / max(u_aspect, 0.0001), -dhdg * d.y, 1.0));
  v_shade = shadeFor(n);

  vec2 outUv = 0.5 + (uv - 0.5) * (1.0 + h * PERSP);
  outUv += vec2(perp.x / max(u_aspect, 0.0001), perp.y) * h * SWAY;

  gl_Position = vec4(outUv * 2.0 - 1.0,
                     depthFor(h + abs(u_amp), 2.0 * abs(u_amp) + 0.0001), 1.0);
}
`;

/**
 * Ripple.
 *
 * Concentric waves spreading from `u_center`, decaying with distance.
 * The surface is pushed OUTWARD along the radius by the wave height, in
 * the plane — which is why the edge of the image ripples and pixels land
 * outside the rectangle they started in. That is the difference from the
 * `displace` effect one file over: displace offsets the texture read, so
 * it can only ever rearrange pixels that are already inside the frame.
 *
 * Stylised, not refraction: a real water surface displaces the image by
 * the SLOPE of the wave, not its height. This is the look, said plainly.
 */
export const SHADER_RIPPLE_VS = MESH_VS_PREAMBLE + `
uniform float u_amp;      // displacement, in frame heights
uniform float u_rings;    // rings per frame height
uniform float u_time;     // radians of phase; must advance or nothing moves
uniform vec2  u_center;   // in uv, y-up
uniform float u_falloff;  // decay per frame height

void main() {
  vec2 uv = a_texCoord;
  v_texCoord = uv;
  v_back = 0.0;

  vec2 w = (uv - u_center) * vec2(u_aspect, 1.0);
  float r = length(w);
  vec2 dir = r > 0.0001 ? w / r : vec2(0.0, 0.0);

  float k = u_rings * 2.0 * PI;
  float phase = r * k - u_time;
  float decay = exp(-r * max(u_falloff, 0.0));

  float h = u_amp * sin(phase) * decay;
  float dhdr = u_amp * decay * (k * cos(phase) - max(u_falloff, 0.0) * sin(phase));

  vec3 n = normalize(vec3(-dhdr * dir, 1.0));
  v_shade = shadeFor(n);

  vec2 outUv = uv + vec2(dir.x / max(u_aspect, 0.0001), dir.y) * h;

  gl_Position = vec4(outUv * 2.0 - 1.0,
                     depthFor(h + abs(u_amp), 2.0 * abs(u_amp) + 0.0001), 1.0);
}
`;

/**
 * The one fragment program every mesh warp shares.
 *
 * The warps differ in shape, not in shading model, so they differ in
 * their vertex program and nothing else. Three copies of this that had
 * to be kept in step is exactly how the despill bug survived.
 */
export const SHADER_MESH_FS = `
precision mediump float;
uniform sampler2D u_image;
uniform vec3 u_backColor;
uniform float u_backMix;
varying vec2 v_texCoord;
varying float v_shade;
varying float v_back;

void main() {
  vec4 c = texture2D(u_image, v_texCoord);

  /*
    The stage draws the mesh with the depth test ON and blending OFF, so
    a fragment that survives the depth test overwrites what is under it —
    alpha included. Without this discard the transparent surround of a
    folded page would punch a hole through the page it folded over.
  */
  if (c.a < 0.004) discard;

  vec3 rgb = c.rgb;
  if (v_back > 0.5) rgb = mix(u_backColor, rgb, clamp(u_backMix, 0.0, 1.0));
  gl_FragColor = vec4(rgb * v_shade, c.a);
}
`;

/* ═══════════════════════════════════════════════════════════════════
   TRANSITIONS ON THE GPU.

   All fourteen transitions already work on the 2D canvas, so nothing
   here is a capability. `NEXT.md` §4 calls it "quality and speed"; the
   speed half turned out to go the other way, and that is the useful
   finding. Measured on six stacked full-frame 1080p clips, interleaved,
   three exports of each condition:

       transition      composite/frame, GPU    composite/frame, 2D
       none                       0.30 ms                0.36 ms
       crossfade                  0.32 ms                0.29 ms
       blur_dissolve              0.24 ms                0.33 ms
       whip_pan                   3.14 ms                0.31 ms
       glitch                     1.78 ms                0.33 ms

   A GPU pass uploads the whole canvas as a texture and reads it back
   again, and at 1080p that is about 5 ms per clip per frame — far more
   than the affine transform and alpha that ten of the fourteen actually
   need. So TWO are here, both for quality the 2D canvas cannot reach at
   any price, and the other twelve are deliberately left where they are.
   The numbers are in `verify_gpu.py` and in NEXT.md.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Motion streak, for the whip pan.
 *
 * The 2D path spent a `blur(22px)` on a whip pan. A gaussian is the
 * wrong shape for motion: it destroys the detail ACROSS the pan as
 * thoroughly as the detail along it, so a whip pan came out looking
 * out-of-focus rather than fast. This samples along the direction of
 * travel only, so a vertical edge in a horizontal whip survives — 2.4x
 * more of it than the gaussian keeps, measured in `verify_gpu.py`.
 *
 * **A radial mode was built, measured, and taken out again**, and the
 * numbers are here because the next person to read this shader will have
 * the same idea. Adding `uniform float u_radial` and
 * `q += (p - u_center) * (u_radial * f)` to the loop below gives a zoom
 * streak, and wiring it to `zoom_in` / `zoom_out` in
 * `resolveTransitionEffect` looked good. It cost **+6.4 ms per clip per
 * frame at 1080p** (six stacked clips, interleaved, three of each:
 * composite 0.25 -> 2.99 ms, composite+encode +38.6 ms), and it was not
 * a port — the 2D zoom had no blur at all, so there was no worse thing
 * being replaced and no control to measure it against. A quality claim
 * with no falsifiable test is not one this repo keeps. Whip pan and
 * glitch both have one; the zooms did not, so they stayed on 2D.
 */
export const SHADER_MOTION_STREAK_FS = `
precision mediump float;
uniform sampler2D u_image;
uniform vec2 u_linear;   // streak vector, in uv
varying vec2 v_texCoord;

/*
  32, not 13.

  13 taps across a streak 7% of the frame wide leaves 11px between
  samples at 1920 — wider than a rule on the test chart, so a thin line
  was sampled once or twice and survived as a row of GHOSTS instead of
  smearing. It read as banding, and it fooled the first version of the
  directional check: the ghosts are themselves vertical edges, so the
  metric that was supposed to show vertical detail being destroyed
  showed it being preserved. The picture was right and the reading was
  wrong, which is the harder way round to catch.
*/
const int TAPS = 32;

void main() {
  vec2 p = v_texCoord;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;

  for (int i = 0; i < TAPS; i++) {
    float f = float(i) / float(TAPS - 1) - 0.5;   // -0.5 .. 0.5
    vec2 q = p + u_linear * f;
    vec4 c = texture2D(u_image, clamp(q, 0.0, 1.0));

    /*
      Premultiply before averaging.

      The layer carries STRAIGHT alpha, and canvas stores fully
      transparent pixels as (0,0,0,0). Averaging straight RGB across a
      transparent neighbour therefore drags the colour toward black —
      a dark halo on every soft edge, worst exactly where the streak is
      longest. This is the same class of mistake as the premultiplied
      fringe the chroma key had to fix at upload time.
    */
    float wgt = max(0.0, 1.0 - abs(f) * 1.4);     // triangular
    acc += vec4(c.rgb * c.a, c.a) * wgt;
    wsum += wgt;
  }

  acc /= max(wsum, 0.0001);
  gl_FragColor = acc.a > 0.001 ? vec4(acc.rgb / acc.a, acc.a) : vec4(0.0);
}
`;

/**
 * Glitch — a real channel split, plus per-row tearing.
 *
 * What it replaces is worth recording. The 2D glitch transition drew the
 * clip three times through
 * `sepia(1) hue-rotate(-50deg) saturate(6)`, which is a *tint* that
 * approximates isolating a channel and is not one: it leaks the other
 * two channels back in, so the "red" pass was never only red. It also
 * only ever ran on clips with `mediaUrl` — a text or shape clip got a
 * glitch transition with no glitch in it at all.
 *
 * `u_phase` comes from the transition's own progress, never from the
 * wall clock, so a rendered frame and a previewed frame agree.
 */
export const SHADER_GLITCH_TEAR_FS = `
precision mediump float;
uniform sampler2D u_image;
uniform float u_split;   // channel separation, in uv
uniform float u_tear;    // row displacement, in uv
uniform float u_rows;    // how many tear bands the frame is cut into
uniform float u_phase;
varying vec2 v_texCoord;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 p = v_texCoord;

  float band = floor(p.y * max(u_rows, 1.0));
  float jitter = (hash(vec2(band, floor(u_phase * 8.0))) - 0.5) * 2.0;
  /* Only some bands tear, or it reads as a wobble rather than a break. */
  float active = step(0.62, hash(vec2(band + 19.0, floor(u_phase * 8.0) + 3.0)));
  p.x += jitter * u_tear * active;

  float r = texture2D(u_image, clamp(p + vec2(u_split, 0.0), 0.0, 1.0)).r;
  float g = texture2D(u_image, clamp(p, 0.0, 1.0)).g;
  float b = texture2D(u_image, clamp(p - vec2(u_split, 0.0), 0.0, 1.0)).b;

  /* Alpha from the unsplit read: the shape of the clip must not smear
     with the channels, or the clip grows a coloured double edge. */
  float a = texture2D(u_image, clamp(p, 0.0, 1.0)).a;

  gl_FragColor = vec4(r, g, b, a);
}
`;
