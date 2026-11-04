import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PwaStatus } from './pwa/PwaStatus'
import { registerPwa } from './pwa/register'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaStatus />
    <div id="roam-app"><App /></div>
  </StrictMode>,
)

// Production only; registration failure is reported without blocking the app.
if (import.meta.env.PROD) void registerPwa()
