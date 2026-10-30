import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 相对路径，便于部署到 GitHub Pages 这类子路径下
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: false },
})
