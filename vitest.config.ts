import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // pdfjs 首次动态 import（legacy/pdf.min.mjs, 512KB）在 CI 慢机器上
    // 可能超过 vitest 默认 5s；留足冷启动余量。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
