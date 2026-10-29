/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // #1112：`?url` 引入的 .mjs（pdf.js worker）產出時改成 .js。
        // nginx:alpine 的 mime.types 沒有 mjs，會回 application/octet-stream，
        // 加上 nosniff 瀏覽器就不肯當 module worker 載入。
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.mjs')
            ? 'assets/[name]-[hash].js'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: [
      'node_modules/**',
      'dist/**',
      'tests/e2e/**',  // Exclude Playwright E2E tests
      '**/*.spec.ts'   // Exclude Playwright test files
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        'dist/',
        'tests/e2e/'
      ],
      thresholds: {
        global: {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90
        }
      }
    }
  }
})
