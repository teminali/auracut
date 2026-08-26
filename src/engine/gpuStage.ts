/* ═══════════════════════════════════════════════════════════════════
   The GPU stage.

   `shaders.ts` sat in this directory for the life of the project as
   ninety lines of GLSL that nothing imported, and it was the honest
   answer to why chroma key, displacement and warps could not be done:
   the compositor is a 2D canvas and those effects need a per-pixel
   program. This is the missing half.

   How it fits the existing pipeline, which is the important part:

     - The 2D compositor stays in charge. A clip is rendered exactly as
       before, into an isolated layer, and the GPU is handed that layer
       as a texture. Nothing about layout, transforms, masking or
       ordering moves onto the GPU, so there is no second geometry
       implementation to keep in step with `getClipBox`.
     - The result comes back as a canvas, which `drawImage` composites
       like any other source. The export path — which reads the 2D canvas
       with `toBlob` — never learns that a shader ran.
     - Every entry point returns null when WebGL is unavailable or a
       program fails to compile, and the caller falls through to the 2D
       path. A machine with no GPU gets a film without a key, not a
       crash.

   Contexts and programs are created once and reused. Creating a WebGL
   context per clip per frame is slower than the 2D path it replaces.
   ═══════════════════════════════════════════════════════════════════ */

import {
  SHADER_CHROMA_KEY_FS,
  SHADER_RGB_GLITCH_FS,
  SHADER_MESH_FS,
  SHADER_PAGE_CURL_VS,
  SHADER_FLAG_WAVE_VS,
  SHADER_RIPPLE_VS,
  SHADER_MOTION_STREAK_FS,
  SHADER_GLITCH_TEAR_FS,
} from './shaders';

/**
 * The flat vertex program: the grid, undisplaced.
 *
 * It reads `a_texCoord` rather than deriving it from `a_position` as it
 * used to, because the mesh path needs the two to be separate — a warp
 * moves the position and must NOT move the texture coordinate. One
 * attribute layout serves both, so a full-screen pass is now simply the
 * mesh at one subdivision.
 */
const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_texCoord;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Displacement. Not in `shaders.ts` — there was nothing to run it, so
 * there was no reason to have written it.
 *
 * Samples the image through an offset driven by a smooth procedural
 * field, which is what makes heat haze, glass, ripple and liquid warps
 * all the same effect with different numbers.
 */
const SHADER_DISPLACE_FS = `
precision mediump float;
uniform sampler2D u_image;
uniform float u_amount;
uniform float u_scale;
uniform float u_time;
uniform float u_angle;
varying vec2 v_texCoord;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 p = v_texCoord;
  float s = max(0.5, u_scale);
  float nx = noise(p * s + vec2(u_time * 0.35, 0.0)) - 0.5;
  float ny = noise(p * s + vec2(0.0, u_time * 0.29) + 37.0) - 0.5;

  float c = cos(u_angle);
  float sn = sin(u_angle);
  vec2 d = vec2(nx * c - ny * sn, nx * sn + ny * c) * u_amount;

  gl_FragColor = texture2D(u_image, clamp(p + d, 0.0, 1.0));
}
`;

export type ShaderKey =
  /* fragment programs over a flat quad */
  | 'chroma_key'
  | 'displace'
  | 'rgb_glitch'
  | 'motion_streak'
  | 'glitch_tear'
  /* mesh warps — a subdivided grid with per-vertex displacement */
  | 'page_curl'
  | 'flag_wave'
  | 'ripple';

const FRAGMENT_SOURCES: Record<ShaderKey, string> = {
  chroma_key: SHADER_CHROMA_KEY_FS,
  displace: SHADER_DISPLACE_FS,
  rgb_glitch: SHADER_RGB_GLITCH_FS,
  motion_streak: SHADER_MOTION_STREAK_FS,
  glitch_tear: SHADER_GLITCH_TEAR_FS,
  /* Every mesh warp shades the same way and differs only in shape. */
  page_curl: SHADER_MESH_FS,
  flag_wave: SHADER_MESH_FS,
  ripple: SHADER_MESH_FS,
};

/**
 * Vertex programs, and how finely the grid each one runs on is cut.
 *
 * A key with no entry here is a flat full-screen pass and draws at one
 * subdivision — two triangles, exactly the quad this stage used to have.
 *
 * The numbers are the resolution of the SHAPE, not of the image: the
 * image is sampled per fragment either way. A page curl and a ripple get
 * the finest grid because both concentrate their curvature in one place
 * — the fold, and the innermost ring — and too coarse a grid there shows
 * as facets: a sawtooth along the ring's edge at 64, gone at 96. A flag
 * is gentle by comparison and 64 is past the point where more subdivision
 * changes the picture.
 *
 * 96 is also the practical ceiling of the index type: a grid of n gets
 * (n+1)^2 vertices, and `Uint16Array` indices stop at 65,535, so n = 255
 * is the hard limit and 96 (9,409 vertices, 55,296 indices) sits well
 * inside it.
 */
const MESH_VERTEX_SOURCES: Partial<Record<ShaderKey, string>> = {
  page_curl: SHADER_PAGE_CURL_VS,
  flag_wave: SHADER_FLAG_WAVE_VS,
  ripple: SHADER_RIPPLE_VS,
};

const MESH_SUBDIVISIONS: Partial<Record<ShaderKey, number>> = {
  page_curl: 96,
  flag_wave: 64,
  /* 64 was visibly faceted where the rings are tightest, right at the
     centre — a sawtooth along the innermost ring's edge, which is where
     the curvature is highest. Same reason as the curl. */
  ripple: 96,
};

/** True when this key draws a displaced mesh rather than a flat quad. */
function isMeshShader(key: ShaderKey): boolean {
  return MESH_VERTEX_SOURCES[key] !== undefined;
}

let glCanvas: HTMLCanvasElement | null = null;
let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
let unavailable = false;
const programs = new Map<ShaderKey, WebGLProgram | null>();
let texture: WebGLTexture | null = null;

/** Grid buffers, one set per subdivision count, built on first use. */
interface MeshBuffers {
  vertices: WebGLBuffer;
  indices: WebGLBuffer;
  count: number;
}
const meshes = new Map<number, MeshBuffers | null>();

/*
  The forced-off switch.

  Every entry point in this file already returned null when WebGL was
  missing, and every caller already fell through to the 2D path — but on
  a machine that HAS WebGL there was no way to reach that path, so
  nothing had ever exercised it end to end. `set_gpu_stage` flips this,
  which makes the fallback something you can render and look at rather
  than something the code claims. It goes through the same `context()`
  return as a machine with no GPU, deliberately: a switch that took a
  different route would be testing the switch.
*/
let forcedOff = false;

/** Create the context if it does not exist yet. Does not resize it. */
function ensureContext() {
  if (unavailable) return null;
  if (!glCanvas) {
    glCanvas = document.createElement('canvas');
    /*
      `premultipliedAlpha: false` matters. The chroma shader writes
      straight (non-premultiplied) RGBA, and with the default the browser
      would treat those as premultiplied and darken every partially
      transparent edge — a green screen would key correctly and then show
      a grey fringe on every strand of hair.
    */
    gl = (glCanvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true })
      ?? glCanvas.getContext('webgl', { premultipliedAlpha: false, alpha: true })) as
      WebGL2RenderingContext | WebGLRenderingContext | null;
    if (!gl) {
      unavailable = true;
      return null;
    }
  }
  if (!gl || !glCanvas) return null;
  return { gl, canvas: glCanvas };
}

function context(width: number, height: number) {
  if (forcedOff) return null;
  const ctx = ensureContext();
  if (!ctx) return null;
  if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
    ctx.canvas.width = width;
    ctx.canvas.height = height;
  }
  return ctx;
}

/**
 * Build (or fetch) the grid for `n` subdivisions.
 *
 * Interleaved as [x, y, u, v] so one buffer feeds both attributes, and
 * indexed so the shared edge between two quads is one vertex and not
 * two — at n = 96 that is 9,409 vertex programs instead of 55,296.
 *
 * Position and texture coordinate start out as the same rectangle. They
 * stop being the same the moment a vertex program moves the position,
 * and that divergence IS the warp.
 */
function mesh(g: WebGLRenderingContext, n: number): MeshBuffers | null {
  if (meshes.has(n)) return meshes.get(n) ?? null;

  const side = n + 1;
  const data = new Float32Array(side * side * 4);
  let w = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = x / n;
      const v = y / n;
      data[w++] = u * 2 - 1;
      data[w++] = v * 2 - 1;
      data[w++] = u;
      data[w++] = v;
    }
  }

  const idx = new Uint16Array(n * n * 6);
  let i = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * side + x;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      idx[i++] = a; idx[i++] = b; idx[i++] = c;
      idx[i++] = b; idx[i++] = d; idx[i++] = c;
    }
  }

  const vertices = g.createBuffer();
  const indices = g.createBuffer();
  if (!vertices || !indices) {
    meshes.set(n, null);
    return null;
  }
  g.bindBuffer(g.ARRAY_BUFFER, vertices);
  g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
  g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, indices);
  g.bufferData(g.ELEMENT_ARRAY_BUFFER, idx, g.STATIC_DRAW);

  const built = { vertices, indices, count: idx.length };
  meshes.set(n, built);
  return built;
}

function compile(g: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = g.createShader(type);
  if (!shader) return null;
  g.shaderSource(shader, source);
  g.compileShader(shader);
  if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
    console.warn('[gpuStage] shader failed to compile:', g.getShaderInfoLog(shader));
    g.deleteShader(shader);
    return null;
  }
  return shader;
}

function program(g: WebGLRenderingContext, key: ShaderKey): WebGLProgram | null {
  if (programs.has(key)) return programs.get(key) ?? null;

  const vs = compile(g, g.VERTEX_SHADER, MESH_VERTEX_SOURCES[key] ?? VERTEX_SHADER);
  const fs = compile(g, g.FRAGMENT_SHADER, FRAGMENT_SOURCES[key]);
  if (!vs || !fs) {
    programs.set(key, null);
    return null;
  }

  const p = g.createProgram();
  if (!p) {
    programs.set(key, null);
    return null;
  }
  g.attachShader(p, vs);
  g.attachShader(p, fs);
  g.linkProgram(p);
  if (!g.getProgramParameter(p, g.LINK_STATUS)) {
    console.warn('[gpuStage] program failed to link:', g.getProgramInfoLog(p));
    programs.set(key, null);
    return null;
  }
  programs.set(key, p);
  return p;
}

/** What a uniform may be. `vec2` is here for the mesh warps' centres. */
export type UniformValue = number | [number, number] | [number, number, number];

/**
 * Run one shader program over `source` and hand back a canvas.
 *
 * Flat keys draw two triangles; mesh keys draw a subdivided grid whose
 * vertex program displaces it. The caller does not choose — the key
 * does — so a call site cannot ask for a page curl and get a flat pass.
 *
 * Returns null whenever the GPU path cannot be taken, so every caller
 * reads as "try the GPU, otherwise carry on".
 */
export function runShader(
  source: CanvasImageSource,
  key: ShaderKey,
  uniforms: Record<string, UniformValue>,
  width: number,
  height: number
): HTMLCanvasElement | null {
  const ctx = context(width, height);
  if (!ctx) return null;
  const { gl: g, canvas } = ctx;

  const p = program(g as WebGLRenderingContext, key);
  if (!p) return null;

  const subdivisions = MESH_SUBDIVISIONS[key] ?? 1;
  const grid = mesh(g as WebGLRenderingContext, subdivisions);
  if (!grid) return null;

  if (!texture) texture = g.createTexture();

  g.viewport(0, 0, width, height);
  g.clearColor(0, 0, 0, 0);

  /*
    Depth, for the mesh path only.

    A folded page covers the part of itself it folded over, and the grid
    is emitted in row order rather than back to front, so without a depth
    buffer the far half of a curl draws on top of the near half on any
    angle whose rows run the wrong way. The flat path explicitly turns it
    off again — this context is shared between keys, and a state left
    enabled by the previous clip is the kind of thing that shows up as
    "the chroma key stopped working after we added the curl".
  */
  const meshed = isMeshShader(key);
  if (meshed) {
    g.enable(g.DEPTH_TEST);
    g.depthFunc(g.LESS);
    g.clearDepth(1);
    g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
  } else {
    g.disable(g.DEPTH_TEST);
    g.clear(g.COLOR_BUFFER_BIT);
  }

  g.useProgram(p);

  g.bindBuffer(g.ARRAY_BUFFER, grid.vertices);
  g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, grid.indices);
  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  /* A program that never reads an attribute has it optimised out and
     `getAttribLocation` answers -1. Enabling -1 is a GL error, not a
     no-op. */
  const posLoc = g.getAttribLocation(p, 'a_position');
  if (posLoc >= 0) {
    g.enableVertexAttribArray(posLoc);
    g.vertexAttribPointer(posLoc, 2, g.FLOAT, false, stride, 0);
  }
  const uvLoc = g.getAttribLocation(p, 'a_texCoord');
  if (uvLoc >= 0) {
    g.enableVertexAttribArray(uvLoc);
    g.vertexAttribPointer(uvLoc, 2, g.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
  }

  g.activeTexture(g.TEXTURE0);
  g.bindTexture(g.TEXTURE_2D, texture);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  // The 2D layer is bottom-up relative to GL's texture origin.
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  try {
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, source as TexImageSource);
  } catch {
    return null;
  }
  g.uniform1i(g.getUniformLocation(p, 'u_image'), 0);

  /*
    The aspect ratio is set here rather than by the caller. Every mesh
    warp needs it to stay round on a 16:9 frame, and a caller that
    forgets it gets an elliptical page curl that still looks plausible —
    the worst kind of wrong. A caller may still override it.
  */
  const aspect = g.getUniformLocation(p, 'u_aspect');
  if (aspect) g.uniform1f(aspect, height > 0 ? width / height : 1);

  for (const [name, value] of Object.entries(uniforms)) {
    const u = g.getUniformLocation(p, name);
    if (!u) continue;
    if (Array.isArray(value)) {
      if (value.length === 2) g.uniform2f(u, value[0], value[1]);
      else g.uniform3f(u, value[0], value[1], value[2]);
    } else {
      g.uniform1f(u, value);
    }
  }

  g.disable(g.BLEND);
  g.drawElements(g.TRIANGLES, grid.count, g.UNSIGNED_SHORT, 0);
  return canvas;
}

/** #rrggbb to 0..1 RGB. Returns mid-grey rather than throwing on nonsense. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Whether this machine has a WebGL context at all.
 *
 * Reports the HARDWARE, not the switch: `setGpuStageEnabled(false)` does
 * not make a GPU disappear, and a report that conflated the two would
 * make the forced fallback indistinguishable from a real one. Probes
 * without resizing — the old version called `context(2, 2)`, which
 * resized the shared canvas to 2x2 as a side effect of being asked a
 * question.
 */
export function gpuAvailable(): boolean {
  return ensureContext() !== null;
}

/** Whether the stage is currently allowed to run. */
export function gpuStageEnabled(): boolean {
  return !forcedOff;
}

/**
 * Force every GPU path off, so the 2D fallback can be rendered and
 * measured on a machine that does have a GPU.
 *
 * This is the only way to construct the no-WebGL case on hardware that
 * is not missing WebGL, and the fallback is a promise this codebase
 * makes in writing: "a machine with no GPU gets a film without a key,
 * not a crash."
 */
export function setGpuStageEnabled(enabled: boolean): void {
  forcedOff = !enabled;
}

/**
 * Whether `key` will actually run if it is asked to.
 *
 * Compiles the program if it has not been compiled yet, so the answer is
 * the real one rather than a prediction. Callers that must decide
 * BEFORE they draw — the transitions, which have to leave the 2D
 * equivalent in place if the shader is not going to run — need this to
 * be exact; asking `gpuAvailable()` and then having the program fail to
 * link would silently drop a transition's blur entirely.
 */
export function gpuShaderReady(key: ShaderKey): boolean {
  if (forcedOff) return false;
  const ctx = ensureContext();
  if (!ctx) return false;
  return program(ctx.gl as WebGLRenderingContext, key) !== null;
}
