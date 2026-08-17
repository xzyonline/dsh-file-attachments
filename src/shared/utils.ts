import { basename } from 'node:path'

/**
 * 统一的 AbortSignal 检查：既抛出自定义 reason，又保留 AbortError 兜底。
 * host 与 worker 两侧共享，避免 5 份拷贝各自漂移。
 */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * 清理用户提供的文件名：去掉控制字符、按路径语义取 basename、
 * 把路径分隔符换成 `_`、并按 UTF-8 字节数截断到 255。
 */
export function sanitizeFilename(name: string): string {
  const withoutControls = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  const base = basename(withoutControls.replace(/\\/g, '/')).replace(/[\\/]/g, '_')
  if (!base) return 'unnamed'

  const encoder = new TextEncoder()
  let output = ''
  for (const character of base) {
    if (encoder.encode(output + character).byteLength > 255) break
    output += character
  }
  return output || 'unnamed'
}
