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
