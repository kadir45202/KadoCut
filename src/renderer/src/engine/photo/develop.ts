import { MAX_MASKS, type PhotoDevelop } from '@shared/photo'
import { curvesKey, curvesNeutral, curvesTexture, CURVE_SIZE } from '../curves'
import { FULL_VIEW, MASK_EDGE, MaskRaster, maskSize, type ViewRect } from './masks'
import { BLUR_FRAG, COPY_FRAG, DEVELOP_FRAG, QUAD_VERT } from './shaders'

/**
 * Lightroom-style develop pipeline on WebGL2. Per image it builds two blur layers once (half
 * resolution for texture / colour noise, 1/8 for clarity and dehaze); every render is then a single
 * full-screen pass that applies all settings, so slider changes stay real-time on large photos.
 */

interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

const DEVELOP_UNIFORMS = [
  'u_src', 'u_small', 'u_large', 'u_curveTex', 'u_srcSize', 'u_outSize', 'u_cropCenter', 'u_cropSize', 'u_angle', 'u_neutral',
  'u_temp', 'u_tint', 'u_exposure', 'u_contrast', 'u_highlights', 'u_shadows', 'u_whites', 'u_blacks',
  'u_texture', 'u_clarity', 'u_dehaze', 'u_vibrance', 'u_saturation', 'u_curves', 'u_hslHue', 'u_hslSat', 'u_hslLum',
  'u_gradeS', 'u_gradeM', 'u_gradeH', 'u_gradeLum', 'u_gradeBlend', 'u_gradeBalance',
  'u_sharpen', 'u_sharpenRadius', 'u_sharpenMask', 'u_nrLum', 'u_nrColor',
  'u_vigAmount', 'u_vigMid', 'u_vigFeather', 'u_grain', 'u_grainSize', 'u_mono',
  'u_view', 'u_clip', 'u_distortion', 'u_lensVig', 'u_caR', 'u_caB', 'u_vertical', 'u_horizontal', 'u_scale',
  'u_masks', 'u_maskCount', 'u_mA', 'u_mB', 'u_mC', 'u_overlay'
] as const

export interface RenderOptions {
  /** Show the original (before view). */
  neutral?: boolean
  /** Draw the whole straightened frame (while the crop tool is open). */
  uncropped?: boolean
  /** Part of the crop to draw (zoomed in). */
  view?: ViewRect
  /** Clipping warning colours. */
  clip?: boolean
  /** Index of the mask shown as a red overlay. */
  overlay?: number
}

/** Tint colour (offset from grey) of a colour-grading wheel. */
function wheelTint(hue: number, sat: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]
  // Remove the colour's own brightness so tinting does not lighten or darken.
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const k = sat * 0.18
  return [(r - l) * k, (g - l) * k, (b - l) * k]
}

/** Output size (pixels) of a photo's crop, scaled so its long edge is at most `maxEdge`. */
export function croppedSize(width: number, height: number, crop: PhotoDevelop['crop'], maxEdge = Infinity): { width: number; height: number } {
  const w = Math.max(1, crop.w * width)
  const h = Math.max(1, crop.h * height)
  const k = Math.min(1, maxEdge / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

export class PhotoRenderer {
  readonly gl: WebGL2RenderingContext
  private develop!: WebGLProgram
  private blur!: WebGLProgram
  private copy!: WebGLProgram
  private vao!: WebGLVertexArrayObject
  private u = {} as Record<(typeof DEVELOP_UNIFORMS)[number], WebGLUniformLocation | null>
  private src: WebGLTexture | null = null
  private small: Target | null = null
  private large: Target | null = null
  private curveTex: WebGLTexture | null = null
  private curveKey = ''
  private probe: Target | null = null
  private maskTex: WebGLTexture | null = null
  private maskDims = { w: 0, h: 0 }
  private maskLayers: (Uint8Array | null)[] = []
  private masks = new MaskRaster()
  width = 0
  height = 0
  readonly maxSize: number

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    this.init()
    this.allocMasks(1, 1)
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
    const link = (frag: string) => {
      const p = gl.createProgram()!
      gl.attachShader(p, compile(gl.VERTEX_SHADER, QUAD_VERT))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag))
      gl.bindAttribLocation(p, 0, 'a_pos')
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(p)}`)
      return p
    }
    this.develop = link(DEVELOP_FRAG)
    this.blur = link(BLUR_FRAG)
    this.copy = link(COPY_FRAG)
    for (const name of DEVELOP_UNIFORMS) this.u[name] = gl.getUniformLocation(this.develop, name)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }

  private texture(mipmap = false): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private target(w: number, h: number): Target {
    const gl = this.gl
    const tex = this.texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { tex, fbo, w, h }
  }

  private freeTarget(t: Target | null) {
    if (!t) return
    this.gl.deleteTexture(t.tex)
    this.gl.deleteFramebuffer(t.fbo)
  }

  private pass(program: WebGLProgram, input: WebGLTexture, out: Target, dir?: [number, number]) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
    gl.viewport(0, 0, out.w, out.h)
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, input)
    gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0)
    if (dir) gl.uniform2f(gl.getUniformLocation(program, 'u_dir'), dir[0], dir[1])
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** Blurred copy of the source at 1/`div` size (`rounds` × separable Gaussian). */
  private blurLayer(div: number, rounds: number): Target {
    const w = Math.max(4, Math.round(this.width / div))
    const h = Math.max(4, Math.round(this.height / div))
    const a = this.target(w, h)
    const b = this.target(w, h)
    this.pass(this.copy, this.src!, a)
    for (let i = 0; i < rounds; i++) {
      this.pass(this.blur, a.tex, b, [1 / w, 0])
      this.pass(this.blur, b.tex, a, [0, 1 / h])
    }
    this.freeTarget(b)
    return a
  }

  /** Uploads a photo (sRGB pixels, already oriented) and prepares its blur layers. */
  setImage(source: TexImageSource, width: number, height: number) {
    const gl = this.gl
    if (this.src) gl.deleteTexture(this.src)
    this.freeTarget(this.small)
    this.freeTarget(this.large)
    this.width = width
    this.height = height
    this.src = this.texture(true)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
    this.small = this.blurLayer(2, 1)
    this.large = this.blurLayer(8, 2)
  }

  get ready() {
    return !!this.src
  }

  private bindCurves(dev: PhotoDevelop): boolean {
    if (curvesNeutral(dev.curves)) return false
    const gl = this.gl
    const key = curvesKey(dev.curves)
    this.curveTex ??= this.texture()
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
    if (key !== this.curveKey) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, CURVE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curvesTexture(dev.curves))
      this.curveKey = key
    }
    return true
  }

  private allocMasks(w: number, h: number) {
    const gl = this.gl
    if (this.maskTex) gl.deleteTexture(this.maskTex)
    this.maskTex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTex)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, w, h, MAX_MASKS, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    this.maskDims = { w, h }
    this.maskLayers = []
  }

  /** Uploads the coverage image of every mask that changed; returns how many masks are active. */
  private bindMasks(dev: PhotoDevelop): number {
    const gl = this.gl
    const masks = dev.masks.slice(0, MAX_MASKS)
    this.masks.keep(new Set(masks.map((m) => m.id)))
    if (!masks.length) return 0
    const { w, h } = maskSize(this.width, this.height, Math.min(MASK_EDGE, Math.max(this.width, this.height)))
    if (w !== this.maskDims.w || h !== this.maskDims.h) this.allocMasks(w, h)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    masks.forEach((m, i) => {
      const { data, changed } = this.masks.get(m, w, h)
      if (!changed && this.maskLayers[i] === data) return
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, w, h, 1, gl.RED, gl.UNSIGNED_BYTE, data)
      this.maskLayers[i] = data
    })
    const a = new Float32Array(MAX_MASKS * 4)
    const b = new Float32Array(MAX_MASKS * 4)
    const c = new Float32Array(MAX_MASKS * 2)
    masks.forEach((m, i) => {
      const j = m.adjust
      a.set([j.exposure, j.contrast, j.highlights, j.shadows], i * 4)
      b.set([j.clarity, j.dehaze, j.temp, j.tint], i * 4)
      c.set([j.saturation, m.invert ? 1 : 0], i * 2)
    })
    gl.uniform4fv(this.u.u_mA, a)
    gl.uniform4fv(this.u.u_mB, b)
    gl.uniform2fv(this.u.u_mC, c)
    return masks.length
  }

  /** Renders the developed photo into the canvas at `outW`×`outH`. */
  render(dev: PhotoDevelop, outW: number, outH: number, opts: RenderOptions = {}) {
    if (!this.ready) return
    if (this.canvas.width !== outW || this.canvas.height !== outH) {
      this.canvas.width = outW
      this.canvas.height = outH
    }
    this.draw(dev, null, outW, outH, opts)
  }

  /** RGBA pixels of a small clean render (no overlays), for the histogram. */
  pixels(dev: PhotoDevelop, outW: number, outH: number, opts: Pick<RenderOptions, 'neutral' | 'uncropped'> = {}): Uint8Array | null {
    if (!this.ready) return null
    if (!this.probe || this.probe.w !== outW || this.probe.h !== outH) {
      this.freeTarget(this.probe)
      this.probe = this.target(outW, outH)
    }
    this.draw(dev, this.probe.fbo, outW, outH, opts)
    const px = new Uint8Array(outW * outH * 4)
    this.gl.readPixels(0, 0, outW, outH, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    return px
  }

  private draw(dev: PhotoDevelop, fbo: WebGLFramebuffer | null, outW: number, outH: number, opts: RenderOptions) {
    if (!this.src || !this.small || !this.large) return
    const gl = this.gl
    const u = this.u
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, outW, outH)
    gl.useProgram(this.develop)
    gl.bindVertexArray(this.vao)
    const bind = (unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(loc, unit)
    }
    bind(0, this.src, u.u_src)
    bind(1, this.small.tex, u.u_small)
    bind(2, this.large.tex, u.u_large)
    gl.uniform1i(u.u_curveTex, 3)
    gl.uniform2f(u.u_srcSize, this.width, this.height)
    gl.uniform2f(u.u_outSize, outW, outH)
    const crop = opts.uncropped ? { x: 0, y: 0, w: 1, h: 1, angle: 0 } : dev.crop
    gl.uniform2f(u.u_cropCenter, crop.x + crop.w / 2, crop.y + crop.h / 2)
    gl.uniform2f(u.u_cropSize, crop.w, crop.h)
    gl.uniform1f(u.u_angle, (crop.angle * Math.PI) / 180)
    gl.uniform1i(u.u_neutral, opts.neutral ? 1 : 0)
    const view = opts.view ?? FULL_VIEW
    gl.uniform4f(u.u_view, view.x, view.y, view.w, view.h)
    gl.uniform1i(u.u_clip, opts.clip ? 1 : 0)
    gl.uniform1f(u.u_distortion, dev.lens.distortion)
    gl.uniform1f(u.u_lensVig, dev.lens.vignette)
    gl.uniform1f(u.u_caR, dev.lens.caRed)
    gl.uniform1f(u.u_caB, dev.lens.caBlue)
    gl.uniform1f(u.u_vertical, dev.transform.vertical)
    gl.uniform1f(u.u_horizontal, dev.transform.horizontal)
    gl.uniform1f(u.u_scale, dev.transform.scale)
    gl.uniform1i(u.u_masks, 4)
    const maskCount = this.bindMasks(dev)
    gl.uniform1i(u.u_maskCount, maskCount)
    gl.uniform1i(u.u_overlay, opts.overlay !== undefined && opts.overlay >= 0 && opts.overlay < maskCount ? opts.overlay : -1)

    gl.uniform1f(u.u_temp, dev.temp)
    gl.uniform1f(u.u_tint, dev.tint)
    gl.uniform1f(u.u_exposure, dev.exposure)
    gl.uniform1f(u.u_contrast, dev.contrast)
    gl.uniform1f(u.u_highlights, dev.highlights)
    gl.uniform1f(u.u_shadows, dev.shadows)
    gl.uniform1f(u.u_whites, dev.whites)
    gl.uniform1f(u.u_blacks, dev.blacks)
    gl.uniform1f(u.u_texture, dev.texture)
    gl.uniform1f(u.u_clarity, dev.clarity)
    gl.uniform1f(u.u_dehaze, dev.dehaze)
    gl.uniform1f(u.u_vibrance, dev.vibrance)
    gl.uniform1f(u.u_saturation, dev.saturation)
    gl.uniform1i(u.u_curves, this.bindCurves(dev) ? 1 : 0)
    gl.uniform1fv(u.u_hslHue, dev.hsl.hue)
    gl.uniform1fv(u.u_hslSat, dev.hsl.sat)
    gl.uniform1fv(u.u_hslLum, dev.hsl.lum)
    const g = dev.grading
    gl.uniform3fv(u.u_gradeS, wheelTint(g.shadows.hue, g.shadows.sat))
    gl.uniform3fv(u.u_gradeM, wheelTint(g.midtones.hue, g.midtones.sat))
    gl.uniform3fv(u.u_gradeH, wheelTint(g.highlights.hue, g.highlights.sat))
    gl.uniform3f(u.u_gradeLum, g.shadows.lum, g.midtones.lum, g.highlights.lum)
    gl.uniform1f(u.u_gradeBlend, g.blending)
    gl.uniform1f(u.u_gradeBalance, g.balance)
    gl.uniform1f(u.u_sharpen, dev.sharpen.amount)
    gl.uniform1f(u.u_sharpenRadius, dev.sharpen.radius)
    gl.uniform1f(u.u_sharpenMask, dev.sharpen.masking)
    gl.uniform1f(u.u_nrLum, dev.noise.luminance)
    gl.uniform1f(u.u_nrColor, dev.noise.color)
    gl.uniform1f(u.u_vigAmount, opts.uncropped ? 0 : dev.vignette.amount)
    gl.uniform1f(u.u_vigMid, dev.vignette.midpoint)
    gl.uniform1f(u.u_vigFeather, dev.vignette.feather)
    gl.uniform1f(u.u_grain, dev.grain.amount)
    gl.uniform1f(u.u_grainSize, dev.grain.size)
    gl.uniform1i(u.u_mono, dev.mono ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  dispose() {
    const gl = this.gl
    if (this.src) gl.deleteTexture(this.src)
    this.freeTarget(this.small)
    this.freeTarget(this.large)
    if (this.curveTex) gl.deleteTexture(this.curveTex)
    if (this.maskTex) gl.deleteTexture(this.maskTex)
    this.freeTarget(this.probe)
    this.src = null
    this.small = null
    this.large = null
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
