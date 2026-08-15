import { NATIVE_IMAGE_TYPES } from './drop.ts'

/** 最小剪贴板文件项视图：测试无需构造真实 DataTransferItemList，运行时由 data.items 满足。 */
export interface ClipboardFileItem {
  kind: string
  type: string
  getAsFile(): File | null
}

/**
 * 分类剪贴板文件项。
 * 与 classifyDrop 的关键差异：图片项绝不调用 getAsFile()——WebKit 的 DataTransferItem
 * 读取一次即失效，捕获阶段先把图片「用掉」会让输入框原生图片链路拿到 null。
 * 因此只用 item.type 判断，generic 项才取出 File 接管。
 */
export function classifyClipboardItems(items: ArrayLike<ClipboardFileItem>): { generic: File[]; nativeImages: number } {
  const generic: File[] = []
  let nativeImages = 0
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (item === undefined || item.kind !== 'file') continue
    if (NATIVE_IMAGE_TYPES.has(item.type)) {
      nativeImages += 1
      continue
    }
    const file = item.getAsFile()
    if (file !== null) generic.push(file)
  }
  return { generic, nativeImages }
}

let currentHandler: ((files: File[]) => void) | null = null
let listenerCount = 0

/** 与 installFileDrop 同构：文档级捕获阶段 paste 监听，ref-count 卸载。 */
export function installFilePaste(target: Document, onFiles: (files: File[]) => void): () => void {
  currentHandler = onFiles
  if (listenerCount === 0) {
    target.addEventListener('paste', onPaste, true)
  }
  listenerCount += 1
  return () => {
    if (currentHandler === onFiles) currentHandler = null
    listenerCount = Math.max(0, listenerCount - 1)
    if (listenerCount === 0) {
      target.removeEventListener('paste', onPaste, true)
    }
  }
}

function onPaste(event: ClipboardEvent): void {
  if (!currentHandler) return
  if (!(event.target instanceof Element)) return
  // 只接管输入框卡片内的粘贴，页面其它输入（设置、搜索等）不受影响
  if (!event.target.closest('[data-composer-card]')) return
  const data = event.clipboardData
  if (data === null) return
  const { generic } = classifyClipboardItems(data.items)
  if (generic.length === 0) return
  // 接管整次粘贴：捕获阶段 stopPropagation，让输入框自带的「仅支持图片」paste 处理器看不到这次事件
  event.preventDefault()
  event.stopPropagation()
  currentHandler(generic)
}
