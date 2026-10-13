// 좌표계 설정(Z-up)은 Three.js 객체가 만들어지기 전에 적용되어야 하므로 가장 먼저 import한다.
import './scene/coordinates'
import './assets/main.css'
import './i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
