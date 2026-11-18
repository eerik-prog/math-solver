import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/engine/**'],
      exclude: ['src/engine/__tests__/**'],
      thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 },
    },
  },
})
