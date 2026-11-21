/** GLSL for the photo develop pipeline (see develop.ts). */

export const QUAD_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}`

/** Separable 9-tap Gaussian (sigma ≈ 2 texels) along u_dir, used to build the blur layers. */
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
out vec4 outColor;
void main() {
  const float w[5] = float[5](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
  vec3 acc = texture(u_tex, v_uv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    acc += texture(u_tex, v_uv + u_dir * float(i)).rgb * w[i];
    acc += texture(u_tex, v_uv - u_dir * float(i)).rgb * w[i];
  }
  outColor = vec4(acc, 1.0);
}`

/** Plain copy (downsampling through the source's mipmaps). */
export const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
void main() { outColor = vec4(texture(u_tex, v_uv).rgb, 1.0); }`

export const DEVELOP_FRAG = `#version 300 es
precision highp float;
precision mediump sampler2DArray;
in vec2 v_uv;
uniform sampler2D u_src;
uniform sampler2D u_small;
uniform sampler2D u_large;
uniform sampler2D u_curveTex;
uniform vec2 u_srcSize;
uniform vec2 u_outSize;
/** Crop: centre (uv of the source), size (uv), rotation (radians). */
uniform vec2 u_cropCenter;
uniform vec2 u_cropSize;
uniform float u_angle;
/** Drawn part of the crop (x, y, w, h); smaller than the whole when zoomed in. */
uniform vec4 u_view;
uniform bool u_neutral;
/** Clipping warning: blown highlights red, crushed shadows blue. */
uniform bool u_clip;

/** Lens corrections and perspective transform. */
uniform float u_distortion, u_lensVig, u_caR, u_caB, u_vertical, u_horizontal, u_scale;

/** Local masks: coverage layers and per mask (exposure, contrast, highlights, shadows),
    (clarity, dehaze, temp, tint), (saturation, invert). */
uniform sampler2DArray u_masks;
uniform int u_maskCount;
uniform vec4 u_mA[8];
uniform vec4 u_mB[8];
uniform vec2 u_mC[8];
/** Mask drawn as a red overlay (-1: none). */
uniform int u_overlay;

uniform float u_temp, u_tint, u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks;
uniform float u_texture, u_clarity, u_dehaze, u_vibrance, u_saturation;
uniform bool u_curves;
uniform float u_hslHue[8];
uniform float u_hslSat[8];
uniform float u_hslLum[8];
uniform vec3 u_gradeS, u_gradeM, u_gradeH;
uniform vec3 u_gradeLum;
uniform float u_gradeBlend, u_gradeBalance;
uniform float u_sharpen, u_sharpenRadius, u_sharpenMask;
uniform float u_nrLum, u_nrColor;
uniform float u_vigAmount, u_vigMid, u_vigFeather;
uniform float u_grain, u_grainSize;
uniform bool u_mono;
out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float HUES[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0);

float luma(vec3 c) { return dot(c, LUMA); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

/** Weight of colour band i for a hue in degrees (triangles between neighbouring band centres). */
float bandWeight(int i, float hue) {
  float c = HUES[i];
  float prev = i == 0 ? HUES[7] - 360.0 : HUES[i - 1];
  float next = i == 7 ? HUES[0] + 360.0 : HUES[i + 1];
  float h = hue;
  if (h - c > 180.0) h -= 360.0;
  if (c - h > 180.0) h += 360.0;
  if (h < c) return clamp((h - prev) / (c - prev), 0.0, 1.0);
  return clamp((next - h) / (next - c), 0.0, 1.0);
}

/** Crop position → frame position through the crop and straighten transform. */
vec2 frameUv(vec2 uv) {
  vec2 q = (uv - 0.5) * u_cropSize * u_srcSize;
  float cs = cos(u_angle);
  float sn = sin(u_angle);
  q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
  return u_cropCenter + q / u_srcSize;
}

/** Frame position → source uv through scale, perspective and lens distortion. */
vec2 lensUv(vec2 f) {
  float aspect = u_srcSize.x / u_srcSize.y;
  vec2 p = (f - 0.5) * vec2(aspect, 1.0) * 2.0;
  p /= 1.0 + u_scale;
  float w = max(0.2, 1.0 - 0.4 * u_vertical * p.y - 0.4 * u_horizontal * p.x / aspect);
  p /= w;
  float r2 = dot(p, p) / (aspect * aspect + 1.0);
  p *= 1.0 - u_distortion * 0.25 * r2;
  return p / (vec2(aspect, 1.0) * 2.0) + 0.5;
}

/** Source colour with lateral chromatic aberration removed (red / blue scaled about the centre). */
vec3 srcAt(vec2 s) {
  if (u_caR == 0.0 && u_caB == 0.0) return texture(u_src, s).rgb;
  vec2 d = s - 0.5;
  return vec3(texture(u_src, 0.5 + d * (1.0 + u_caR * 0.006)).r, texture(u_src, s).g, texture(u_src, 0.5 + d * (1.0 + u_caB * 0.006)).b);
}

float maskAt(int i, vec2 f) {
  float w = texture(u_masks, vec3(f, float(i))).r;
  return u_mC[i].y > 0.5 ? 1.0 - w : w;
}

void main() {
  // WebGL draws bottom-up; images are top-down.
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 cuv = u_view.xy + uv * u_view.zw;
  vec2 f = frameUv(cuv);
  vec2 suv = lensUv(f);
  if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 c = srcAt(suv);
  if (u_neutral) {
    outColor = vec4(c, 1.0);
    return;
  }

  // Local adjustments add to the global sliders where their masks are.
  vec4 la = vec4(0.0);
  vec4 lb = vec4(0.0);
  float lsat = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_maskCount) break;
    float w = maskAt(i, f);
    la += w * u_mA[i];
    lb += w * u_mB[i];
    lsat += w * u_mC[i].x;
  }
  float exposure = u_exposure + la.x;
  float contrast = clamp(u_contrast + la.y, -1.0, 1.0);
  float highlights = u_highlights + la.z;
  float shadows = u_shadows + la.w;
  float clarity = u_clarity + lb.x;
  float dehaze = clamp(u_dehaze + lb.y, -1.0, 1.0);
  float temp = u_temp + lb.z;
  float tint = u_tint + lb.w;
  float saturation = u_saturation + lsat;

  vec2 texel = 1.0 / u_srcSize;
  // Screen pixels per source pixel: detail filters work in output pixels when zoomed out.
  float pxStep = max(1.0, (u_cropSize.x * u_view.z * u_srcSize.x) / u_outSize.x);
  vec3 small = texture(u_small, suv).rgb;
  vec3 large = texture(u_large, suv).rgb;

  // Noise reduction: edge-preserving average of the neighbourhood (luminance), chroma from the blur.
  if (u_nrLum > 0.0) {
    vec3 acc = vec3(0.0);
    float total = 0.0;
    float range = 0.02 + 0.18 * u_nrLum;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec3 s = srcAt(suv + vec2(float(x), float(y)) * texel * pxStep);
        float d = luma(s) - luma(c);
        float w = exp(-(d * d) / (2.0 * range * range)) * exp(-float(x * x + y * y) / 8.0);
        acc += s * w;
        total += w;
      }
    }
    c = mix(c, acc / total, u_nrLum);
  }
  if (u_nrColor > 0.0) {
    float l = luma(c);
    c = l + mix(c - l, small - luma(small), u_nrColor);
  }

  // Sharpening: unsharp mask against a radius-scaled cross, optionally only on edges.
  if (u_sharpen > 0.0) {
    vec2 o = texel * pxStep * u_sharpenRadius;
    vec3 n = srcAt(suv + vec2(o.x, 0.0)) + srcAt(suv - vec2(o.x, 0.0)) + srcAt(suv + vec2(0.0, o.y)) + srcAt(suv - vec2(0.0, o.y));
    vec3 detail = c - n * 0.25;
    float edge = smoothstep(0.0, 0.15, length(detail) * 4.0);
    c += detail * u_sharpen * 2.0 * mix(1.0, edge, u_sharpenMask);
  }

  // Texture (fine detail) and clarity (local midtone contrast).
  c += (c - small) * u_texture * 1.2;
  float l0 = luma(c);
  c += (l0 - luma(large)) * clarity * 1.6 * (4.0 * l0 * (1.0 - l0));

  // Dehaze: remove (or add) the low-frequency veil estimated from the large blur.
  if (dehaze != 0.0) {
    float haze = clamp(min(min(large.r, large.g), large.b), 0.0, 1.0);
    if (dehaze > 0.0) {
      float k = dehaze * 0.7 * haze;
      c = (c - k) / max(1.0 - k, 0.2);
      c = mix(vec3(luma(c)), c, 1.0 + dehaze * 0.25);
    } else {
      c = mix(c, vec3(0.5 + 0.5 * luma(large)), -dehaze * 0.5);
    }
  }

  // White balance and exposure in linear light.
  vec3 lin = pow(max(c, 0.0), vec3(2.2));
  // Lens vignetting: brighten (or darken) towards the corners of the original frame.
  if (u_lensVig != 0.0) {
    vec2 ps = (suv - 0.5) * vec2(u_srcSize.x / u_srcSize.y, 1.0) * 2.0;
    float rs = dot(ps, ps) / (pow(u_srcSize.x / u_srcSize.y, 2.0) + 1.0);
    lin *= max(0.0, 1.0 + u_lensVig * 1.5 * rs * rs);
  }
  vec3 wb = vec3(1.0 + 0.35 * temp, 1.0 - 0.3 * tint, 1.0 - 0.35 * temp);
  wb.rb *= 1.0 + 0.12 * tint;
  lin *= max(wb, 0.05) / dot(max(wb, 0.05), LUMA);
  lin *= exp2(exposure);
  // Soft shoulder so bright pushes roll off instead of clipping hard.
  lin = lin / (1.0 + max(lin - 1.0, 0.0) * 0.6);
  c = pow(max(lin, 0.0), vec3(1.0 / 2.2));

  // Contrast: S-curve around mid grey.
  vec3 s = c * c * (3.0 - 2.0 * c);
  c = contrast >= 0.0 ? mix(c, s, contrast) : mix(c, vec3(0.5), -contrast * 0.5);

  // Tone regions by luminance.
  float L = clamp(luma(c), 0.0, 1.0);
  float wBlacks = 1.0 - smoothstep(0.0, 0.3, L);
  float wShadows = smoothstep(0.0, 0.2, L) * (1.0 - smoothstep(0.3, 0.65, L));
  float wHighlights = smoothstep(0.35, 0.7, L) * (1.0 - 0.5 * smoothstep(0.85, 1.0, L));
  float wWhites = smoothstep(0.65, 1.0, L);
  c += u_blacks * 0.18 * wBlacks + shadows * 0.3 * wShadows + highlights * 0.3 * wHighlights + u_whites * 0.18 * wWhites;
  c = clamp(c, 0.0, 1.0);

  // Tone curve (master, then per channel).
  if (u_curves) {
    vec3 k = c * (255.0 / 256.0) + 0.5 / 256.0;
    c = vec3(texture(u_curveTex, vec2(k.r, 0.5)).r, texture(u_curveTex, vec2(k.g, 0.5)).g, texture(u_curveTex, vec2(k.b, 0.5)).b);
  }

  // Colour mixer.
  vec3 hsv = rgb2hsv(c);
  float hue = hsv.x * 360.0;
  float dh = 0.0;
  float ds = 0.0;
  float dl = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = bandWeight(i, hue);
    dh += w * u_hslHue[i];
    ds += w * u_hslSat[i];
    dl += w * u_hslLum[i];
  }
  float chroma = hsv.y;
  if (u_mono) {
    // B&W: the luminance sliders lighten or darken what each colour turns into.
    float g = luma(c) + dl * 0.35 * chroma * hsv.z;
    c = vec3(clamp(g, 0.0, 1.0));
  } else {
    hsv.x = fract(hsv.x + dh * 30.0 / 360.0 + 1.0);
    hsv.y = clamp(hsv.y * (1.0 + ds), 0.0, 1.0);
    vec3 mixed = hsv2rgb(hsv);
    c = mixed + dl * 0.3 * chroma * hsv.z;
    // Vibrance boosts muted colours most; saturation scales all.
    float l = luma(c);
    c = mix(vec3(l), c, 1.0 + u_vibrance * (1.0 - chroma) * 0.9);
    c = mix(vec3(luma(c)), c, max(0.0, 1.0 + saturation));
  }

  // Colour grading: tints and lightness per tonal range.
  float Lg = clamp(luma(c), 0.0, 1.0);
  float center = 0.5 - 0.25 * u_gradeBalance;
  float sharp = 1.0 + (1.0 - u_gradeBlend) * 2.0;
  float wS = pow(clamp(1.0 - Lg / max(center, 0.05), 0.0, 1.0), sharp);
  float wH = pow(clamp((Lg - center) / max(1.0 - center, 0.05), 0.0, 1.0), sharp);
  float wM = clamp(1.0 - wS - wH, 0.0, 1.0);
  c += u_gradeS * wS + u_gradeM * wM + u_gradeH * wH;
  c += u_gradeLum.x * 0.15 * wS + u_gradeLum.y * 0.15 * wM + u_gradeLum.z * 0.15 * wH;

  // Post-crop vignette and grain, in output space.
  if (u_vigAmount != 0.0) {
    float ar = (u_cropSize.x * u_srcSize.x) / (u_cropSize.y * u_srcSize.y);
    vec2 d = (cuv - 0.5) * vec2(ar, 1.0);
    float r = length(d) / length(vec2(ar, 1.0) * 0.5);
    float v = smoothstep(u_vigMid * 0.9, u_vigMid * 0.9 + 0.05 + u_vigFeather, r);
    c = u_vigAmount < 0.0 ? c * (1.0 + u_vigAmount * v) : mix(c, vec3(1.0), u_vigAmount * v);
  }
  if (u_grain > 0.0) {
    vec2 cell = floor(cuv * u_outSize / u_view.zw / (1.0 + u_grainSize * 3.0));
    float n = hash12(cell) + hash12(cell + 17.0) - 1.0;
    float lg = luma(c);
    c += n * u_grain * 0.18 * (1.0 - abs(lg - 0.5));
  }
  c = clamp(c, 0.0, 1.0);
  if (u_overlay >= 0) c = mix(c, vec3(1.0, 0.18, 0.12), 0.55 * maskAt(u_overlay, f));
  if (u_clip) {
    float hi = max(max(c.r, c.g), c.b);
    if (hi >= 0.998) c = vec3(1.0, 0.12, 0.12);
    else if (hi <= 0.002) c = vec3(0.1, 0.4, 1.0);
  }
  outColor = vec4(c, 1.0);
}`
