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

import { SHADER_CHROMA_KEY_FS, SHADER_RGB_GLITCH_FS } from './shaders';

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = (a_position + 1.0) * 0.5;
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

export type ShaderKey = 'chroma_key' | 'displace' | 'rgb_glitch';

const FRAGMENT_SOURCES: Record<ShaderKey, string> = {
  chroma_key: SHADER_CHROMA_KEY_FS,
  displace: SHADER_DISPLACE_FS,
  rgb_glitch: SHADER_RGB_GLITCH_FS,
};

let glCanvas: HTMLCanvasElement | null = null;
let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
let unavailable = false;
const programs = new Map<ShaderKey, WebGLProgram | null>();
let quadBuffer: WebGLBuffer | null = null;
let texture: WebGLTexture | null = null;

function context(width: number, height: number) {
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

  if (glCanvas.width !== width || glCanvas.height !== height) {
    glCanvas.width = width;
    glCanvas.height = height;
  }
  return { gl, canvas: glCanvas };
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

  const vs = compile(g, g.VERTEX_SHADER, VERTEX_SHADER);
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

/**
 * Run one fragment shader over `source` and hand back a canvas.
 *
 * Returns null whenever the GPU path cannot be taken, so every caller
 * reads as "try the GPU, otherwise carry on".
 */
export function runShader(
  source: CanvasImageSource,
  key: ShaderKey,
  uniforms: Record<string, number | [number, number, number]>,
  width: number,
  height: number
): HTMLCanvasElement | null {
  const ctx = context(width, height);
  if (!ctx) return null;
  const { gl: g, canvas } = ctx;

  const p = program(g as WebGLRenderingContext, key);
  if (!p) return null;

  if (!quadBuffer) {
    quadBuffer = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, quadBuffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  }
  if (!texture) texture = g.createTexture();

  g.viewport(0, 0, width, height);
  g.clearColor(0, 0, 0, 0);
  g.clear(g.COLOR_BUFFER_BIT);
  g.useProgram(p);

  g.bindBuffer(g.ARRAY_BUFFER, quadBuffer);
  const loc = g.getAttribLocation(p, 'a_position');
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);

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

  for (const [name, value] of Object.entries(uniforms)) {
    const u = g.getUniformLocation(p, name);
    if (!u) continue;
    if (Array.isArray(value)) g.uniform3f(u, value[0], value[1], value[2]);
    else g.uniform1f(u, value);
  }

  g.disable(g.BLEND);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  return canvas;
}

/** #rrggbb to 0..1 RGB. Returns mid-grey rather than throwing on nonsense. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Whether a GPU path is usable at all — for reporting, not for control flow. */
export function gpuAvailable(): boolean {
  return !unavailable && context(2, 2) !== null;
}
