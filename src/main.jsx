import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './App.jsx'
import './app/app.css'
import './chat/chat.css'

// A data router lets the dashboard save pending edits before browser Back/Forward.
const router = createBrowserRouter([{ path: '*', element: <App /> }])
createRoot(document.getElementById('root')).render(<StrictMode><RouterProvider router={router} /></StrictMode>)
