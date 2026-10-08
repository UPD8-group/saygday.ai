import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './app/auth.jsx'
import { AddWebsite, DashboardProvider, Home, Layout, RequireBusiness, RequireSignIn } from './app/Dashboard.jsx'
import Questions from './app/Questions.jsx'
import Asked from './app/Asked.jsx'
import ChatButton from './app/ChatButton.jsx'
import Settings from './app/Settings.jsx'

export default function App() {
  return <AuthProvider>
    <Routes>
      <Route path="/app" element={<RequireSignIn><DashboardProvider><Layout /></DashboardProvider></RequireSignIn>}>
        <Route index element={<Home />} />
        <Route path="add" element={<AddWebsite />} />
        <Route path="questions" element={<RequireBusiness><Questions /></RequireBusiness>} />
        <Route path="asked" element={<RequireBusiness><Asked /></RequireBusiness>} />
        <Route path="button" element={<RequireBusiness><ChatButton /></RequireBusiness>} />
        <Route path="settings" element={<RequireBusiness allowWhileScanning><Settings /></RequireBusiness>} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  </AuthProvider>
}

