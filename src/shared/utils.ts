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
 * 替换 Windows 保留字符与设备名、并按 UTF-8 字节数截断到 255。
 * 纯预防（safeName 当前不落盘，但防未来导出/跨平台使用时踩坑）。
 */
export function sanitizeFilename(name: string): string {
  const withoutControls = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  // 先取 basename（反斜杠归一为 /），再替换 Windows 保留字符 < > : " | ? *
  let base = basename(withoutControls.replace(/\\/g, '/')).replace(/[\\/]/g, '_')
  base = base.replace(/[<>:"|?*]/g, '_')
  if (!base) return 'unnamed'

  // Windows 保留设备名(CON/PRN/AUX/NUL/COM1-9/LPT1-9,不区分扩展名)前缀 `_` 规避。
  const stem = base.replace(/\.[^.]*$/, '')
  if (WINDOWS_DEVICE_NAMES.has(stem.toUpperCase())) base = `_${base}`

  const encoder = new TextEncoder()
  let output = ''
  for (const character of base) {
    if (encoder.encode(output + character).byteLength > 255) break
    output += character
  }
  return output || 'unnamed'
}

/** Windows 保留设备名（大小写不敏感）。 */
const WINDOWS_DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])
