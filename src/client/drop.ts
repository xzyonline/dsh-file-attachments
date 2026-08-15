export const NATIVE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export function classifyDrop(files: File[]): { generic: File[]; nativeImages: File[] } {
  return { generic: files.filter(file => !NATIVE_IMAGE_TYPES.has(file.type)), nativeImages: files.filter(file => NATIVE_IMAGE_TYPES.has(file.type)) }
}

let currentHandler: ((files: File[]) => void) | null = null
let listenerCount = 0

export function installFileDrop(target: Document, onFiles: (files: File[]) => void): () => void {
  currentHandler = onFiles
  if (listenerCount === 0) {
    target.addEventListener('drop', onDrop, true)
    target.addEventListener('dragover', onDragOver)
  }
  listenerCount += 1
  return () => {
    if (currentHandler === onFiles) currentHandler = null
    listenerCount = Math.max(0, listenerCount - 1)
    if (listenerCount === 0) {
      target.removeEventListener('drop', onDrop, true)
      target.removeEventListener('dragover', onDragOver)
    }
  }
}

function filesOf(event: DragEvent): File[] {
  return event.dataTransfer ? [...event.dataTransfer.files] : []
}

function onDrop(event: DragEvent): void {
  if (!currentHandler || !(event.target instanceof Element) || !event.target.closest('[data-composer-card]')) return
  const outcome = classifyDrop(filesOf(event))
  if (outcome.generic.length === 0) return
  // 接管整次投放：捕获阶段 stopPropagation，让输入框自带的「仅支持图片」document 冒泡处理器看不到这次事件
  event.preventDefault()
  event.stopPropagation()
  currentHandler(outcome.generic)
  // 输入框的拖放遮罩依赖 window dragend 复位；补发一次，避免遮罩残留
  window.dispatchEvent(new DragEvent('dragend'))
}

function onDragOver(event: DragEvent): void {
  if (!(event.target instanceof Element) || !event.target.closest('[data-composer-card]')) return
  if (classifyDrop(filesOf(event)).generic.length > 0) event.preventDefault()
}
