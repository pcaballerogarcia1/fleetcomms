import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PlanningApp from './planning.jsx'

const isPlanning = window.location.pathname.startsWith('/planning')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isPlanning ? <PlanningApp /> : <App />}
  </StrictMode>,
)
