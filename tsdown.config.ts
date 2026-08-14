import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/client.tsx', 'src/parser-worker.ts'],
  outDir: 'lib',
  dts: true,
  format: 'esm',
})
