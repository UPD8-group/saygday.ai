import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './app/auth.jsx'
import { AddWebsite, DashboardProvider, Home, Layout, RequireBusiness, RequireSignIn } from './app/Dashboard.jsx'
import Questions from './app/Questions.jsx'
import Asked from './app/Asked.jsx'
import ChatButton from './app/ChatButton.jsx'
import Settings from './app/Settings.jsx'
import Checkout from './app/Checkout.jsx'
import BillingPage from './app/BillingPage.jsx'
import Setup from './app/Setup.jsx'
import StudioConnect from './app/StudioConnect.jsx'

export default function App() {
  return <AuthProvider>
    <Routes>
      <Route path="/app/connect/oo-studio" element={<RequireSignIn><StudioConnect /></RequireSignIn>} />
      <Route path="/app" element={<RequireSignIn><DashboardProvider><Layout /></DashboardProvider></RequireSignIn>}>
        <Route index element={<Home />} />
        <Route path="add" element={<AddWebsite />} />
        <Route path="setup" element={<RequireBusiness><Setup /></RequireBusiness>} />
        <Route path="setup/:step" element={<RequireBusiness><Setup /></RequireBusiness>} />
        <Route path="questions" element={<RequireBusiness><Questions /></RequireBusiness>} />
        <Route path="asked" element={<RequireBusiness><Asked /></RequireBusiness>} />
        <Route path="button" element={<RequireBusiness><ChatButton /></RequireBusiness>} />
        <Route path="settings" element={<RequireBusiness allowWhileScanning><Settings /></RequireBusiness>} />
        <Route path="billing" element={<RequireBusiness allowWhileScanning><BillingPage /></RequireBusiness>} />
        <Route path="checkout" element={<RequireBusiness allowWhileScanning><Checkout /></RequireBusiness>} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  </AuthProvider>
}

