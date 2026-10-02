import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { siteInputs, sitePages } from './site/vite-plugin.mjs'

// The public website (site/*.html, one page an address), the dashboard
// (app.html, at /app) and the chat window that opens on a business's website
// (chat.html, loaded by public/widget.js).
export default defineConfig({
  appType: 'mpa',
  plugins: [react(), sitePages()],
  build: { rollupOptions: { input: { app: 'app.html', chat: 'chat.html', ...siteInputs } } },
})
