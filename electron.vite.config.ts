import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // Utility-process entry: heavy jobs run here so a crash never takes down the app.
          worker: resolve(import.meta.dirname, 'src/worker/index.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/preload/index.ts'),
          export: resolve(import.meta.dirname, 'src/preload/export.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react()]
  }
})
