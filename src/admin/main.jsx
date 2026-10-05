import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Outfit, bundled like the chat window's: the admin page asks nothing of
// Google either.
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import AdminApp from './AdminApp.jsx'
import '../app/app.css'
import '../chat/chat.css'
import './admin.css'

createRoot(document.getElementById('root')).render(<StrictMode><BrowserRouter><AdminApp /></BrowserRouter></StrictMode>)
