import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two pages: the dashboard (index.html) and the chat window that opens on a
// business's website (chat.html, loaded by public/widget.js).
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: 'index.html', chat: 'chat.html' } } },
})
