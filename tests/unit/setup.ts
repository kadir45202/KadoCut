// Renderer modules read the preload bridge at import time; unit tests run without Electron.
;(globalThis as unknown as { window: unknown }).window = { maker: {}, makerFiles: {} }

// Text layout measures with a 2D canvas; a fixed-advance stub is enough for logic tests.
class FakeContext {
  font = '10px sans-serif'
  letterSpacing = '0px'
  measureText(text: string) {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10)
    return { width: text.length * px * 0.5 }
  }
}
;(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  constructor(
    public width: number,
    public height: number
  ) {}
  getContext() {
    return new FakeContext()
  }
}
