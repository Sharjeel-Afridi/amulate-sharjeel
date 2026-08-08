import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { A2uiDemo } from './demo.js'

/**
 * Entry point for /a2ui-demo.html only. The production entry stays main.tsx —
 * this exists so the A2UI module can be exercised without touching the app.
 */

const root = document.getElementById('a2ui-demo-root')
if (!root) throw new Error('#a2ui-demo-root missing from a2ui-demo.html')

createRoot(root).render(
  <StrictMode>
    <A2uiDemo />
  </StrictMode>,
)
