import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const root = createRoot(document.getElementById('root')!)

// The hidden export window loads the same bundle with #/export.
if (location.hash === '#/export') {
  void import('./engine/export/runExport').then((m) => m.runExport())
} else {
  void import('./features/app/App').then(({ App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  )
}
