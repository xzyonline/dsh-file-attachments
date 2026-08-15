import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/client.tsx'],
  outDir: 'lib/.client-build',
  dts: false,
  format: 'cjs',
  platform: 'neutral',
  external: ['react', 'react/jsx-runtime'],
  sourcemap: false,
  clean: true,
})
