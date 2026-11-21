/**
 * Optional downloadable components (local AI runtimes and models).
 * They are fetched on demand into <userData>/components/<id>/ so the installer stays small.
 */
export interface ComponentFile {
  url: string
  /** File name inside the component folder. */
  name: string
  /** Extract this zip into the component folder after download. */
  extract?: boolean
}

export interface ComponentSpec {
  id: string
  group: 'whisper' | 'tts' | 'background' | 'vision' | 'llm'
  /** Approximate download size in bytes (shown in the UI). */
  size: number
  files: ComponentFile[]
}

const WHISPER_TAG = 'b5454'
const HF_WHISPER = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const HF_PIPER = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

export const COMPONENTS = {
  'whisper-runtime': {
    id: 'whisper-runtime',
    group: 'whisper',
    size: 21_715_607,
    files: [
      {
        url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-blas-bin-x64.zip`,
        name: 'whisper.zip',
        extract: true
      }
    ]
  },
  'whisper-base': {
    id: 'whisper-base',
    group: 'whisper',
    size: 147_951_465,
    files: [{ url: `${HF_WHISPER}/ggml-base.bin`, name: 'model.bin' }]
  },
  'whisper-small': {
    id: 'whisper-small',
    group: 'whisper',
    size: 487_601_967,
    files: [{ url: `${HF_WHISPER}/ggml-small.bin`, name: 'model.bin' }]
  },
  'whisper-large-v3-turbo': {
    id: 'whisper-large-v3-turbo',
    group: 'whisper',
    size: 574_041_195,
    files: [{ url: `${HF_WHISPER}/ggml-large-v3-turbo-q5_0.bin`, name: 'model.bin' }]
  },
  'piper-runtime': {
    id: 'piper-runtime',
    group: 'tts',
    size: 22_477_236,
    files: [
      {
        url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
        name: 'piper.zip',
        extract: true
      }
    ]
  },
  'piper-voice-tr': {
    id: 'piper-voice-tr',
    group: 'tts',
    size: 63_206_254,
    files: [
      { url: `${HF_PIPER}/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx`, name: 'voice.onnx' },
      { url: `${HF_PIPER}/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json`, name: 'voice.onnx.json' }
    ]
  },
  'piper-voice-en': {
    id: 'piper-voice-en',
    group: 'tts',
    size: 63_206_179,
    files: [
      { url: `${HF_PIPER}/en/en_US/lessac/medium/en_US-lessac-medium.onnx`, name: 'voice.onnx' },
      { url: `${HF_PIPER}/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json`, name: 'voice.onnx.json' }
    ]
  },
  'rvm-matting': {
    id: 'rvm-matting',
    group: 'background',
    size: 14_975_696,
    files: [
      {
        url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx',
        name: 'rvm.onnx'
      }
    ]
  },
  'llm-runtime': {
    id: 'llm-runtime',
    group: 'llm',
    size: 23_959_334,
    files: [{ url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11744/llama-b11744-bin-win-cpu-x64.zip', name: 'llama.zip', extract: true }]
  },
  'llm-gemma': {
    id: 'llm-gemma',
    group: 'llm',
    size: 1_708_582_752,
    files: [{ url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf', name: 'model.gguf' }]
  },
  'face-detector': {
    id: 'face-detector',
    group: 'vision',
    size: 1_270_727,
    files: [
      {
        url: 'https://raw.githubusercontent.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/master/models/onnx/version-RFB-320.onnx',
        name: 'face.onnx'
      }
    ]
  }
} as const satisfies Record<string, ComponentSpec>

export type ComponentId = keyof typeof COMPONENTS

export type WhisperModel = 'base' | 'small' | 'large-v3-turbo'

export const whisperComponent = (model: WhisperModel): ComponentId => `whisper-${model}`

export interface ComponentStatus {
  id: ComponentId
  installed: boolean
  size: number
}
