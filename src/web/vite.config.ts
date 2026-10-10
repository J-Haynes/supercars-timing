import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: Vite on :5173 proxies the API and SignalR hub to the .NET server on :5080.
// Build: output goes to the server's wwwroot so `dotnet run` serves the app.
const server = process.env.TIMING_SERVER ?? 'http://localhost:5080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/hubs': { target: server, ws: true },
    },
  },
  build: {
    outDir: '../SupercarsTiming.Server/wwwroot',
    emptyOutDir: true,
  },
})
