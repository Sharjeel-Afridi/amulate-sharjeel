import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API_TARGET = process.env.API_URL ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser never talks to the MCP server directly — everything routes
    // through the API so tool calls stay auditable in one place.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
