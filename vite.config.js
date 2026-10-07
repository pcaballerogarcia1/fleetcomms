/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Entorno de pruebas: las vistas previas de Vercel (cualquier rama que no
// sea main) usan el proyecto de Firebase de pruebas, nunca el real. Son los
// datos públicos de la app web (como los de producción en firebase.js.js).
// Si en Vercel se ponen variables VITE_FIREBASE_*, mandan esas.
const PRUEBAS = {
  VITE_FIREBASE_API_KEY: "AIzaSyDfsCXOt8HZGZjdgEKl7b8oh_1frAwyFnk",
  VITE_FIREBASE_AUTH_DOMAIN: "operanzia-pruebas.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "operanzia-pruebas",
  VITE_FIREBASE_STORAGE_BUCKET: "operanzia-pruebas.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "583227156396",
  VITE_FIREBASE_APP_ID: "1:583227156396:web:5557bf6ac24244709cbc09",
};
if (process.env.VERCEL_ENV === "preview" || process.env.ENTORNO === "pruebas") {
  process.env.VITE_ENTORNO = "pruebas";
  for (const [k, v] of Object.entries(PRUEBAS)) process.env[k] ||= v;
}

export default defineConfig({
  // Versión (commit) en cada error registrado — ver error-report.js
  define: { __APP_VERSION__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7)) },
  // Compilación de medida (MEDIR=1, solo en local o en la CI, nunca en
  // Vercel): Firestore pasa por src/medidor-firestore.js, que cuenta las
  // lecturas y escrituras de cada pantalla (ver e2e/).
  resolve: process.env.MEDIR
    ? { alias: [{ find: /^firebase\/firestore$/, replacement: fileURLToPath(new URL("./src/medidor-firestore.js", import.meta.url)) }] }
    : {},
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Operanzia Rutas',
        short_name: 'Rutas',
        description: 'App de rutas para operarios de Operanzia',
        theme_color: '#0f1623',
        background_color: '#0f1623',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/rutas',
        scope: '/',
        lang: 'es',
        icons: [
          { src: 'pwa-64x64.png',           sizes: '64x64',   type: 'image/png' },
          { src: 'pwa-192x192.png',          sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',          sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  // Los tests de reglas van aparte (necesitan el emulador): npm run test:rules
  test: { exclude: [...configDefaults.exclude, "rules-tests/**", "e2e/**"] },
})
