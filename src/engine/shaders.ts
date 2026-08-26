/**
 * Kerf GLSL GPU Shaders Engine
 * Realtime WebGL2 Fragment Shaders for Transitions, Color Grades & VFX
 */

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
  float mask = length(color.rgb - u_keyColor);
  float alpha = smoothstep(u_similarity, u_similarity + u_smoothness, mask);
  
  // Spill suppression (desaturate remaining key color fringes)
  float spillVal = max(0.0, 1.0 - mask / (u_similarity + 0.1));
  color.rgb = mix(color.rgb, vec3(dot(color.rgb, vec3(0.299, 0.587, 0.114))), spillVal * u_spill);

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
