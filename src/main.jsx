import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './app/app.css'
import './chat/chat.css'

createRoot(document.getElementById('root')).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
