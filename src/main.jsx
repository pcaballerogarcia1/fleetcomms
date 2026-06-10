import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PlanningApp from './planning.jsx'
import SchedulingApp from './scheduling.jsx'

const path = window.location.pathname
const isPlanning   = path.startsWith('/planning')
const isScheduling = path.startsWith('/scheduling')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isScheduling ? <SchedulingApp /> : isPlanning ? <PlanningApp /> : <App />}
  </StrictMode>,
)
