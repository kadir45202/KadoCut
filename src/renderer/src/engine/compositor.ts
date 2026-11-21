import type { BlendMode, Curves, EffectType, MaskType } from '@shared/project/schema'
import { CURVE_SIZE, curvesKey, curvesTexture } from './curves'
import type { Lut } from './lut'
import type { VisualLayer } from './scene'

/**
 * WebGL2 compositor shared by the preview and the export renderer. Draws layers bottom-to-top
 * with premultiplied alpha, and per layer: crop/flip, chroma key, colour correction + 3D LUT,
 * SDF masks, opacity, blend modes and transition effects (screen-space wipe, motion blur).
 */

const VERT = `#version 300 es
in vec2 a_pos;
uniform mat3 u_matrix;
uniform vec2 u_canvas;
uniform vec2 u_media;
uniform vec4 u_crop;
uniform vec2 u_flip;
out vec2 v_uv;
out vec2 v_pos;
void main() {
  // v_pos: position in the displayed (cropped, flipped) frame; v_uv: texture coordinate.
  vec2 pos = mix(u_crop.xy, u_crop.zw, a_pos);
  vec3 p = u_matrix * vec3(pos * u_media, 1.0);
  gl_Position = vec4(p.x / u_canvas.x * 2.0 - 1.0, 1.0 - p.y / u_canvas.y * 2.0, 0.0, 1.0);
  v_pos = pos;
  v_uv = vec2(u_flip.x > 0.5 ? 1.0 - pos.x : pos.x, u_flip.y > 0.5 ? 1.0 - pos.y : pos.y);
}`

const FRAG = `#version 300 es
precision highp float;
precision mediump sampler3D;
in vec2 v_uv;
in vec2 v_pos;
uniform sampler2D u_tex;
uniform sampler2D u_backdrop;
uniform sampler3D u_lutTex;
uniform vec2 u_canvas;
uniform float u_opacity;
uniform int u_maskType;
uniform vec2 u_maskCenter;
uniform vec2 u_maskSize;
uniform float u_maskRot;
uniform float u_maskFeather;
uniform float u_maskRound;
uniform bool u_maskInvert;
uniform vec2 u_media;
uniform bool u_chroma;
uniform vec3 u_chromaKey;
uniform float u_chromaSim;
uniform float u_chromaSmooth;
uniform float u_chromaSpill;
uniform bool u_grade;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_saturation;
uniform float u_temperature;
uniform float u_highlights;
uniform float u_shadows;
uniform bool u_lut;
uniform bool u_curves;
uniform sampler2D u_curveTex;
uniform float u_lutSize;
uniform float u_lutIntensity;
uniform int u_blend;
uniform bool u_wipe;
uniform vec4 u_wipeParams;
uniform vec2 u_blur;
uniform bool u_fromBackdrop;
uniform int u_effect;
uniform float u_effectAmount;
uniform float u_time;
out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec2 cbcr(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}

float dot2(vec2 v) { return dot(v, v); }

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Inigo Quilez's heart and star distance functions (y up, unit size).
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}

float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

vec4 sampleTex(vec2 uv) {
  if (u_blur == vec2(0.0)) return texture(u_tex, uv);
  // Directional motion blur (whip pan).
  vec4 acc = vec4(0.0);
  for (int i = -6; i <= 6; i++) acc += texture(u_tex, uv + u_blur * float(i));
  return acc / 13.0;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 bd(vec2 uv) { return texture(u_backdrop, clamp(uv, 0.0, 1.0)).rgb; }

// Golden-angle spiral blur, radius in target pixels.
vec3 spiralBlur(vec2 uv, float radius) {
  vec3 acc = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 64; i++) {
    float r = sqrt((float(i) + 0.5) / 64.0) * radius;
    float a = float(i) * 2.39996323;
    float w = 1.0 - r / (radius * 1.15);
    acc += bd(uv + vec2(cos(a), sin(a)) * r / u_canvas) * w;
    total += w;
  }
  return acc / total;
}

// Adjustment layers read what was drawn below them, in screen space. Effect indices follow
// EFFECT_INDEX; u_time is the layer's local time, so animated effects match in preview and export.
vec4 sampleBackdrop() {
  int e = u_effect;
  float a = u_effectAmount;
  float t = u_time;
  float side = min(u_canvas.x, u_canvas.y);
  float px = max(1.0, side / 1080.0);
  vec2 aspect = u_canvas / side;
  float frame = floor(t * 24.0);
  vec2 frag = gl_FragCoord.xy;
  if (e == 2) {
    float block = max(2.0, a * 0.06 * side);
    frag = (floor(frag / block) + 0.5) * block;
  }
  vec2 q = gl_FragCoord.xy / u_canvas;
  vec2 uv = frag / u_canvas;

  // Geometry: where to read the backdrop from.
  if (e == 9) {
    float r = sin(t * 17.0) * 0.012 * a;
    vec2 d = (uv - 0.5) * aspect / (1.0 + 0.05 * a);
    d = vec2(cos(r) * d.x - sin(r) * d.y, sin(r) * d.x + cos(r) * d.y);
    uv = d / aspect + 0.5 + vec2(sin(t * 23.0) + 0.5 * sin(t * 41.0), cos(t * 19.0) + 0.5 * sin(t * 37.0)) * 0.012 * a;
  } else if (e == 11) {
    uv = (uv - 0.5) / (1.0 + a * 0.15 * exp(-fract(t * 2.0) * 5.0)) + 0.5;
  } else if (e == 13) {
    uv.x = 0.5 - abs(uv.x - 0.5);
  } else if (e == 14) {
    // Six mirrored wedges around the centre, slowly turning.
    vec2 d = (uv - 0.5) * aspect;
    float seg = 6.2831853 / 6.0;
    float ang = abs(mod(atan(d.y, d.x) + t * 0.3, seg) - seg * 0.5);
    uv = 0.5 + vec2(cos(ang), sin(ang)) * length(d) / aspect;
  } else if (e >= 15 && e <= 18) {
    vec2 cells = e == 15 ? vec2(1.0, 2.0) : e == 16 ? vec2(1.0, 3.0) : e == 17 ? vec2(2.0) : vec2(3.0);
    vec2 id = floor(uv * cells);
    vec2 f = fract(uv * cells);
    // Thin white gaps between the cells (amount = gap width).
    vec2 lo = f * u_canvas / cells;
    vec2 hi = (1.0 - f) * u_canvas / cells;
    float gw = a * 0.008 * side;
    if ((id.x > 0.0 && lo.x < gw) || (id.x < cells.x - 1.0 && hi.x < gw) || (id.y > 0.0 && lo.y < gw) || (id.y < cells.y - 1.0 && hi.y < gw)) return vec4(1.0);
    // Each cell shows the centre of the frame at the cell's aspect ratio.
    vec2 win = (1.0 / cells) / max(1.0 / cells.x, 1.0 / cells.y);
    uv = 0.5 + (f - 0.5) * win;
  } else if (e == 23) {
    vec2 d = (uv - 0.5) * aspect;
    float k = a * 1.5;
    float rmax = dot(aspect * 0.5, aspect * 0.5);
    uv = d * (1.0 + k * dot(d, d)) / (1.0 + k * rmax) / aspect + 0.5;
  } else if (e == 7) {
    float s = floor(t * 12.0);
    float burst = step(0.6, hash12(vec2(s, 7.0)));
    float band = floor(uv.y * mix(8.0, 40.0, hash12(vec2(s, 3.0))));
    if (hash12(vec2(band, s)) < a * (0.25 + 0.5 * burst)) uv.x += (hash12(vec2(band, s + 1.0)) - 0.5) * 0.25 * a;
  } else if (e == 8) {
    float line = floor(frag.y / (2.0 * px));
    uv.x += (hash12(vec2(line, frame)) - 0.5) * 0.003 * a + sin(uv.y * 40.0 + t * 3.0) * 0.0015 * a;
  } else if (e == 22) {
    uv.y += (hash12(vec2(frame, 1.0)) - 0.5) * 0.004 * a;
  }

  // Sampling.
  vec3 c;
  if (e == 1) {
    c = spiralBlur(uv, max(1.0, a * 0.035 * side));
  } else if (e == 10) {
    c = vec3(0.0);
    for (int i = 0; i < 24; i++) c += bd((uv - 0.5) * (1.0 - a * 0.2 * float(i) / 23.0) + 0.5);
    c /= 24.0;
  } else if (e == 6 || e == 7 || e == 8) {
    float sh = e == 6 ? a * 0.012 * (0.75 + 0.25 * sin(t * 4.0)) : e == 7 ? a * 0.01 * (0.4 + step(0.6, hash12(vec2(floor(t * 12.0), 7.0)))) : a * 0.004;
    vec2 off = vec2(sh / aspect.x, 0.0);
    c = vec3(bd(uv + off).r, bd(uv).g, bd(uv - off).b);
  } else {
    c = bd(uv);
  }

  // Colour.
  if (e == 3) {
    c *= 1.0 - a * smoothstep(0.35, 1.45, length((q - 0.5) * 2.0));
  } else if (e == 4) {
    c += (hash12(floor(gl_FragCoord.xy / (1.5 * px)) + frame * vec2(37.0, 17.0)) - 0.5) * a * 0.35;
  } else if (e == 5) {
    vec2 o = px / u_canvas;
    vec3 n = bd(uv + vec2(o.x, 0.0)) + bd(uv - vec2(o.x, 0.0)) + bd(uv + vec2(0.0, o.y)) + bd(uv - vec2(0.0, o.y));
    c += (c * 4.0 - n) * a * 1.5;
  } else if (e == 8) {
    c *= 1.0 - a * 0.2 * (0.5 + 0.5 * sin(gl_FragCoord.y / px * 1.5708));
    c += (hash12(gl_FragCoord.xy + frame * 13.0) - 0.5) * 0.1 * a;
    c += a * 0.12 * smoothstep(0.96, 1.0, fract(q.y * 0.7 - t * 0.12));
    c = mix(c, vec3(dot(c, LUMA)), 0.2 * a) * mix(vec3(1.0), vec3(1.06, 1.0, 0.9), a);
  } else if (e == 12) {
    c = mix(c, vec3(1.0), exp(-fract(t * 3.0) * 8.0) * a * 0.85);
  } else if (e == 19) {
    c = mix(c, 1.0 - c, a);
  } else if (e == 20) {
    c = mix(c, vec3(clamp((dot(c, LUMA) - 0.5) * 1.35 + 0.5, 0.0, 1.0)), a);
  } else if (e == 21 || e == 22) {
    vec3 sp = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
    if (e == 21) {
      c = mix(c, sp, a);
    } else {
      c = mix(c, sp, 0.85 * a);
      c *= 1.0 + (hash12(vec2(frame, 5.0)) - 0.5) * 0.15 * a;
      c += (hash12(floor(gl_FragCoord.xy / (2.0 * px)) + frame * vec2(11.0, 7.0)) - 0.5) * 0.18 * a;
      if (hash12(vec2(frame, 2.0)) > 0.4) {
        float sx = hash12(vec2(frame, 9.0)) * u_canvas.x;
        c *= 1.0 - 0.35 * a * (1.0 - smoothstep(0.0, 1.5 * px, abs(gl_FragCoord.x - sx)));
      }
      c *= 1.0 - a * smoothstep(0.5, 1.5, length((q - 0.5) * 2.0));
    }
  } else if (e == 24) {
    vec3 b = spiralBlur(uv, 0.025 * side);
    c = mix(c, 1.0 - (1.0 - c) * (1.0 - b), a * 0.8);
  } else if (e == 25) {
    vec2 p = q * aspect;
    vec2 p1 = vec2(0.1 + 0.15 * sin(t * 0.7), 0.9 + 0.1 * cos(t * 0.5)) * aspect;
    vec2 p2 = vec2(0.9 + 0.1 * sin(t * 0.6 + 1.0), 0.15 + 0.15 * sin(t * 0.9)) * aspect;
    vec3 leak = vec3(1.0, 0.55, 0.2) * smoothstep(0.75, 0.0, distance(p, p1)) + vec3(1.0, 0.3, 0.45) * smoothstep(0.6, 0.0, distance(p, p2));
    c = 1.0 - (1.0 - c) * (1.0 - clamp(leak, 0.0, 1.0) * a);
  } else if (e == 26) {
    float lv = mix(10.0, 3.0, a);
    c = floor(c * lv + 0.5) / lv;
  } else if (e == 27) {
    float bar = a * 0.2;
    if (q.y < bar || q.y > 1.0 - bar) c = vec3(0.0);
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}

vec3 grade(vec3 c) {
  c *= exp2(u_exposure);
  c += u_brightness * 0.25;
  float l = clamp(dot(c, LUMA), 0.0, 1.0);
  c += u_shadows * 0.35 * (1.0 - l) * (1.0 - l);
  c += u_highlights * 0.35 * l * l;
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  c += vec3(0.08, 0.02, -0.08) * u_temperature;
  c = mix(vec3(dot(c, LUMA)), c, 1.0 + u_saturation);
  return clamp(c, 0.0, 1.0);
}

vec3 blendFn(vec3 b, vec3 s) {
  if (u_blend == 1) return b * s;
  if (u_blend == 2) return b + s - b * s;
  if (u_blend == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (u_blend == 4) return min(b, s);
  if (u_blend == 5) return max(b, s);
  if (u_blend == 6) return min(b + s, 1.0);
  if (u_blend == 7) return (1.0 - 2.0 * s) * b * b + 2.0 * s * b;
  return abs(b - s);
}

void main() {
  vec4 c = u_fromBackdrop ? sampleBackdrop() : sampleTex(v_uv);
  if (u_chroma) {
    // Key on chroma distance (YCbCr) so lighting changes on the screen matter less.
    float d = distance(cbcr(c.rgb), cbcr(u_chromaKey));
    float a = smoothstep(u_chromaSim, u_chromaSim + max(u_chromaSmooth, 0.001), d);
    float spillMask = (1.0 - smoothstep(u_chromaSim, u_chromaSim + u_chromaSmooth + 0.15, d)) * u_chromaSpill;
    if (u_chromaKey.g >= u_chromaKey.r && u_chromaKey.g >= u_chromaKey.b) c.g = mix(c.g, min(c.g, max(c.r, c.b)), spillMask + 0.5 * u_chromaSpill);
    else if (u_chromaKey.b >= u_chromaKey.r) c.b = mix(c.b, min(c.b, max(c.r, c.g)), spillMask + 0.5 * u_chromaSpill);
    c.a *= a;
  }
  if (u_grade) c.rgb = grade(c.rgb);
  if (u_lut) {
    vec3 coord = clamp(c.rgb, 0.0, 1.0) * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
    c.rgb = mix(c.rgb, texture(u_lutTex, coord).rgb, u_lutIntensity);
  }
  if (u_curves) {
    vec3 k = clamp(c.rgb, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
    c.rgb = vec3(texture(u_curveTex, vec2(k.r, 0.5)).r, texture(u_curveTex, vec2(k.g, 0.5)).g, texture(u_curveTex, vec2(k.b, 0.5)).b);
  }

  float m = 1.0;
  if (u_maskType > 0) {
    vec2 p = (v_pos - 0.5 - u_maskCenter) * u_media;
    float cs = cos(-u_maskRot);
    float sn = sin(-u_maskRot);
    p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
    vec2 hs = max(u_maskSize * u_media * 0.5, vec2(1.0));
    float d;
    if (u_maskType == 1) d = p.y;
    else if (u_maskType == 2) d = abs(p.y) - hs.y;
    else if (u_maskType == 3) d = (length(p / hs) - 1.0) * min(hs.x, hs.y);
    else if (u_maskType == 4) d = sdBox(p, hs, u_maskRound * min(hs.x, hs.y));
    else if (u_maskType == 5) {
      vec2 q = vec2(p.x / hs.x * 0.62, -p.y / hs.y * 0.5 + 0.47);
      d = sdHeart(q) * hs.y * 2.0;
    } else {
      vec2 q = vec2(p.x / hs.x, -p.y / hs.y);
      d = sdStar5(q, 1.0, 0.45) * min(hs.x, hs.y);
    }
    float f = max(u_maskFeather, 0.75);
    m = 1.0 - smoothstep(-f, f, d);
    if (u_maskInvert) m = 1.0 - m;
  }
  if (u_wipe) {
    // Screen-space wipe: visible where the canvas position along the direction is below the edge.
    vec2 cpos = vec2(gl_FragCoord.x, u_canvas.y - gl_FragCoord.y) / u_canvas;
    // Direction (0, 0) is an iris: a circle growing from the centre (1 = reaches the corners).
    vec2 ar = vec2(u_canvas.x / u_canvas.y, 1.0);
    float s = u_wipeParams.xy == vec2(0.0) ? length((cpos - 0.5) * ar) / length(ar * 0.5) : dot(cpos - 0.5, u_wipeParams.xy) + 0.5;
    m *= 1.0 - smoothstep(u_wipeParams.z - u_wipeParams.w, u_wipeParams.z + u_wipeParams.w, s);
  }

  float alpha = c.a * u_opacity * m;
  if (u_blend == 0) {
    outColor = vec4(c.rgb * alpha, alpha);
  } else {
    vec3 b = texture(u_backdrop, gl_FragCoord.xy / u_canvas).rgb;
    outColor = vec4(mix(b, blendFn(b, c.rgb), alpha), 1.0);
  }
}`

const MASK_INDEX: Record<MaskType, number> = { none: 0, linear: 1, mirror: 2, circle: 3, rectangle: 4, heart: 5, star: 6 }
const BLEND_INDEX: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  add: 6,
  softLight: 7,
  difference: 8
}

const EFFECT_INDEX: Record<EffectType, number> = {
  none: 0, blur: 1, pixelate: 2, vignette: 3, grain: 4, sharpen: 5, rgbSplit: 6, glitch: 7, vhs: 8, shake: 9, zoomBlur: 10,
  zoomPulse: 11, strobe: 12, mirror: 13, kaleido: 14, split2: 15, split3: 16, split4: 17, split9: 18, invert: 19, noir: 20,
  sepia: 21, oldFilm: 22, fisheye: 23, glow: 24, lightLeak: 25, posterize: 26, letterbox: 27
}

/** Pixels for a layer: a DOM/bitmap source, or raw RGBA (export decoders). */
export type LayerSource =
  | { kind: 'element'; source: TexImageSource; width: number; height: number; version: number }
  | { kind: 'pixels'; data: Uint8Array; width: number; height: number; version: number }
  /** Adjustment layer: re-draws what is already on screen. */
  | { kind: 'backdrop' }

export interface DrawItem {
  layer: VisualLayer
  source: LayerSource
  lut?: Lut
}

/** Full-frame colour wash drawn over everything (e.g. fade through white). */
export interface Flash {
  color: string
  amount: number
}

interface TextureEntry {
  texture: WebGLTexture
  version: number
  used: boolean
}

const UNIFORMS = [
  'u_matrix', 'u_canvas', 'u_media', 'u_crop', 'u_flip', 'u_tex', 'u_backdrop', 'u_lutTex', 'u_opacity',
  'u_maskType', 'u_maskCenter', 'u_maskSize', 'u_maskRot', 'u_maskFeather', 'u_maskRound', 'u_maskInvert',
  'u_chroma', 'u_chromaKey', 'u_chromaSim', 'u_chromaSmooth', 'u_chromaSpill',
  'u_grade', 'u_exposure', 'u_contrast', 'u_brightness', 'u_saturation', 'u_temperature', 'u_highlights', 'u_shadows',
  'u_lut', 'u_lutSize', 'u_lutIntensity', 'u_curves', 'u_curveTex', 'u_blend', 'u_wipe', 'u_wipeParams', 'u_blur',
  'u_fromBackdrop', 'u_effect', 'u_effectAmount', 'u_time'
] as const

export class Compositor {
  private gl: WebGL2RenderingContext
  private program!: WebGLProgram
  private vao!: WebGLVertexArrayObject
  private u = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>
  private textures = new Map<string, TextureEntry>()
  private luts = new Map<string, WebGLTexture>()
  private curveTextures = new Map<string, WebGLTexture>()
  private backdrop: WebGLTexture | null = null
  private solid: WebGLTexture | null = null
  lost = false

  constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    opts: { preserveDrawingBuffer?: boolean } = {}
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance'
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.init()
    canvas.addEventListener('webglcontextlost', ((e: Event) => {
      e.preventDefault()
      this.lost = true
    }) as EventListener)
    canvas.addEventListener('webglcontextrestored', () => {
      this.textures.clear()
      this.luts.clear()
      this.curveTextures.clear()
      this.backdrop = null
      this.solid = null
      this.init()
      this.lost = false
    })
  }

  private init() {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(sh)}`)
      return sh
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(program)}`)
    this.program = program
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(program, name)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  }

  resize(width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
  }

  private newTexture(target: number = this.gl.TEXTURE_2D): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture()!
    gl.bindTexture(target, texture)
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    return texture
  }

  private upload(key: string, src: Exclude<LayerSource, { kind: 'backdrop' }>) {
    const gl = this.gl
    let entry = this.textures.get(key)
    if (!entry) {
      entry = { texture: this.newTexture(), version: -1, used: true }
      this.textures.set(key, entry)
    }
    entry.used = true
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, entry.texture)
    // Video frames change continuously (version -1); stills only re-upload when their version changes.
    if (src.version < 0 || src.version !== entry.version) {
      if (src.kind === 'pixels') {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.source)
      }
      entry.version = src.version
    }
  }

  private bindLut(lut: Lut) {
    const gl = this.gl
    let tex = this.luts.get(lut.key)
    gl.activeTexture(gl.TEXTURE2)
    if (!tex) {
      tex = this.newTexture(gl.TEXTURE_3D)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data)
      this.luts.set(lut.key, tex)
    }
    gl.bindTexture(gl.TEXTURE_3D, tex)
  }

  private bindCurves(curves: Curves) {
    const gl = this.gl
    const key = curvesKey(curves)
    let tex = this.curveTextures.get(key)
    gl.activeTexture(gl.TEXTURE3)
    if (!tex) {
      // Keep the cache small: curves change while the user drags points.
      if (this.curveTextures.size > 32) {
        for (const t of this.curveTextures.values()) gl.deleteTexture(t)
        this.curveTextures.clear()
      }
      tex = this.newTexture()
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, CURVE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curvesTexture(curves))
      this.curveTextures.set(key, tex)
    }
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  /** Copies what has been drawn so far, for blend modes that read the backdrop. */
  private captureBackdrop(width: number, height: number) {
    const gl = this.gl
    this.backdrop ??= this.newTexture()
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.backdrop)
    // The drawing buffer has no alpha channel, so copy as RGB.
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, width, height, 0)
  }

  /** Draws the frame; canvas pixels map to target pixels as `p * scale + offset`. */
  render(items: DrawItem[], background: string, scale = 1, flash: Flash | null = null, offset: [number, number] = [0, 0]) {
    if (this.lost) return
    const gl = this.gl
    const u = this.u
    const { width, height } = this.canvas
    gl.viewport(0, 0, width, height)
    const bg = parseHex(background)
    gl.clearColor(bg[0], bg[1], bg[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(u.u_canvas, width, height)
    gl.uniform1i(u.u_tex, 0)
    gl.uniform1i(u.u_backdrop, 1)
    gl.uniform1i(u.u_lutTex, 2)
    gl.uniform1i(u.u_curveTex, 3)

    for (const entry of this.textures.values()) entry.used = false

    for (const { layer, source, lut } of items) {
      if (layer.opacity <= 0) continue
      const fromBackdrop = source.kind === 'backdrop'
      if (fromBackdrop) this.captureBackdrop(width, height)
      else this.upload(layer.clip.id, source)
      gl.uniform1i(u.u_fromBackdrop, fromBackdrop ? 1 : 0)
      gl.uniform1i(u.u_effect, layer.effect ? EFFECT_INDEX[layer.effect.type] : 0)
      gl.uniform1f(u.u_effectAmount, layer.effect?.amount ?? 0)
      gl.uniform1f(u.u_time, layer.local)
      const [a, b, c, d, e, f] = layer.matrix
      // mat3 column-major, scaled from canvas pixels to the render target size.
      gl.uniformMatrix3fv(u.u_matrix, false, [a * scale, b * scale, 0, c * scale, d * scale, 0, e * scale + offset[0], f * scale + offset[1], 1])
      gl.uniform2f(u.u_media, layer.width, layer.height)
      const crop = layer.crop
      gl.uniform4f(u.u_crop, crop?.left ?? 0, crop?.top ?? 0, 1 - (crop?.right ?? 0), 1 - (crop?.bottom ?? 0))
      gl.uniform2f(u.u_flip, crop?.flipH ? 1 : 0, crop?.flipV ? 1 : 0)
      gl.uniform1f(u.u_opacity, layer.opacity)

      const mask = layer.mask
      gl.uniform1i(u.u_maskType, mask ? MASK_INDEX[mask.type] : 0)
      if (mask) {
        gl.uniform2f(u.u_maskCenter, mask.cx, mask.cy)
        gl.uniform2f(u.u_maskSize, mask.width, mask.height)
        gl.uniform1f(u.u_maskRot, (mask.rotation * Math.PI) / 180)
        gl.uniform1f(u.u_maskFeather, mask.feather * 0.25 * Math.min(layer.width, layer.height))
        gl.uniform1f(u.u_maskRound, mask.roundness)
        gl.uniform1i(u.u_maskInvert, mask.invert ? 1 : 0)
      }

      const chroma = layer.chroma
      gl.uniform1i(u.u_chroma, chroma ? 1 : 0)
      if (chroma) {
        gl.uniform3f(u.u_chromaKey, ...parseHex(chroma.color))
        gl.uniform1f(u.u_chromaSim, chroma.similarity * 0.5)
        gl.uniform1f(u.u_chromaSmooth, chroma.smoothness * 0.5)
        gl.uniform1f(u.u_chromaSpill, chroma.spill)
      }

      const color = layer.color
      gl.uniform1i(u.u_grade, color ? 1 : 0)
      if (color) {
        gl.uniform1f(u.u_exposure, color.exposure)
        gl.uniform1f(u.u_contrast, color.contrast)
        gl.uniform1f(u.u_brightness, color.brightness)
        gl.uniform1f(u.u_saturation, color.saturation)
        gl.uniform1f(u.u_temperature, color.temperature)
        gl.uniform1f(u.u_highlights, color.highlights)
        gl.uniform1f(u.u_shadows, color.shadows)
      }
      gl.uniform1i(u.u_lut, lut && layer.lutIntensity > 0 ? 1 : 0)
      if (lut && layer.lutIntensity > 0) {
        this.bindLut(lut)
        gl.uniform1f(u.u_lutSize, lut.size)
        gl.uniform1f(u.u_lutIntensity, layer.lutIntensity)
      }

      gl.uniform1i(u.u_curves, layer.curves ? 1 : 0)
      if (layer.curves) this.bindCurves(layer.curves)

      const wipe = layer.wipe
      gl.uniform1i(u.u_wipe, wipe ? 1 : 0)
      if (wipe) gl.uniform4f(u.u_wipeParams, wipe.dirX, wipe.dirY, wipe.edge, wipe.feather)
      gl.uniform2fv(u.u_blur, layer.blur ? blurStep(layer) : [0, 0])

      const blend = BLEND_INDEX[layer.blend]
      gl.uniform1i(u.u_blend, blend)
      if (blend && !fromBackdrop) {
        this.captureBackdrop(width, height)
        gl.disable(gl.BLEND)
      } else {
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      }
      gl.activeTexture(gl.TEXTURE0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    if (flash && flash.amount > 0) this.drawFlash(flash, width, height)

    // Free textures of layers that left the screen.
    for (const [key, entry] of this.textures) {
      if (!entry.used) {
        gl.deleteTexture(entry.texture)
        this.textures.delete(key)
      }
    }
  }

  private drawFlash(flash: Flash, width: number, height: number) {
    const gl = this.gl
    const u = this.u
    const [r, g, b] = parseHex(flash.color)
    this.solid ??= this.newTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.solid)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r * 255, g * 255, b * 255, 255]))
    gl.uniformMatrix3fv(u.u_matrix, false, [1, 0, 0, 0, 1, 0, 0, 0, 1])
    gl.uniform2f(u.u_media, width, height)
    gl.uniform4f(u.u_crop, 0, 0, 1, 1)
    gl.uniform2f(u.u_flip, 0, 0)
    gl.uniform1f(u.u_opacity, Math.min(1, flash.amount))
    for (const flag of [u.u_maskType, u.u_chroma, u.u_grade, u.u_lut, u.u_curves, u.u_wipe, u.u_blend, u.u_fromBackdrop, u.u_effect]) gl.uniform1i(flag, 0)
    gl.uniform2f(u.u_blur, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** RGBA pixels of the last frame, bottom row first (as WebGL returns them). */
  readPixels(target?: Uint8Array): Uint8Array {
    const gl = this.gl
    const { width, height } = this.canvas
    const out = target ?? new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out)
    return out
  }

  dispose() {
    for (const entry of this.textures.values()) this.gl.deleteTexture(entry.texture)
    for (const tex of this.luts.values()) this.gl.deleteTexture(tex)
    for (const tex of this.curveTextures.values()) this.gl.deleteTexture(tex)
    this.textures.clear()
    this.luts.clear()
    this.curveTextures.clear()
  }
}

/** Converts a canvas-space blur vector into a per-tap texture-space step. */
function blurStep(layer: VisualLayer): [number, number] {
  const [a, b, c, d] = layer.matrix
  const det = a * d - b * c
  if (!layer.blur || Math.abs(det) < 1e-9) return [0, 0]
  const { x, y } = layer.blur
  // Inverse 2×2 maps the canvas vector to media pixels, then to texture units.
  let mx = (d * x - c * y) / det / layer.width
  let my = (-b * x + a * y) / det / layer.height
  if (layer.crop?.flipH) mx = -mx
  if (layer.crop?.flipV) my = -my
  return [mx / 12, my / 12]
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
