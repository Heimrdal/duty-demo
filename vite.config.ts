import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// base './' — сборка открывается с GitHub Pages (/duty-demo/) и как файл.
// mode "single" -> один самодостаточный HTML (открывается по двойному клику, file://)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: mode === 'single' ? { outDir: 'dist-single' } : { outDir: 'dist' },
  preview: { host: '0.0.0.0', port: 4173 },
}))
