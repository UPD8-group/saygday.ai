import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from '../app/auth.jsx'
import SignIn from './SignIn.jsx'

// The sign-in card on /login. The page arrives with a still copy of the form;
// anything typed into it before this loads is kept.
const mount = document.getElementById('sign-in')
if (mount) {
  const typed = mount.querySelector('input')?.value || ''
  createRoot(mount).render(<StrictMode><AuthProvider><SignIn initialEmail={typed} /></AuthProvider></StrictMode>)
}
