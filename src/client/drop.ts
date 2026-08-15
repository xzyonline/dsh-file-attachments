export const NATIVE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export function classifyDrop(files: File[]): { generic: File[]; nativeImages: File[] } {
  return { generic: files.filter(file => !NATIVE_IMAGE_TYPES.has(file.type)), nativeImages: files.filter(file => NATIVE_IMAGE_TYPES.has(file.type)) }
}

let currentHandler: ((files: File[]) => void) | null = null
let listenerCount = 0
let overlay: HTMLElement | null = null

export function installFileDrop(target: Document, onFiles: (files: File[]) => void): () => void {
  currentHandler = onFiles
  if (listenerCount === 0) {
    target.addEventListener('drop', onDrop, true)
    target.addEventListener('dragover', onDragOver)
    // 全窗口接管：拖拽含非图片文件时在 window 捕获阶段抢在官方
    // DropOverlay 的 document 监听器之前拦截，避免「仅支持图片」的阻断提示。
    window.addEventListener('dragenter', onWindowDrag, true)
    window.addEventListener('dragover', onWindowDrag, true)
    window.addEventListener('dragleave', onWindowDragLeave, true)
  }
  listenerCount += 1
  return () => {
    if (currentHandler === onFiles) currentHandler = null
    listenerCount = Math.max(0, listenerCount - 1)
    if (listenerCount === 0) {
      target.removeEventListener('drop', onDrop, true)
      target.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragenter', onWindowDrag, true)
      window.removeEventListener('dragover', onWindowDrag, true)
      window.removeEventListener('dragleave', onWindowDragLeave, true)
      hideOverlay()
    }
  }
}

function filesOf(event: DragEvent): File[] {
  return event.dataTransfer ? [...event.dataTransfer.files] : []
}

function hasGenericFiles(event: DragEvent): boolean {
  return classifyDrop(filesOf(event)).generic.length > 0
}

function onWindowDrag(event: DragEvent): void {
  if (!currentHandler || !hasGenericFiles(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.type === 'dragover') {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    showOverlay()
  }
}

function onWindowDragLeave(event: DragEvent): void {
  if (event.relatedTarget === null) hideOverlay()
}

function onDrop(event: DragEvent): void {
  if (!currentHandler) return
  const outcome = classifyDrop(filesOf(event))
  if (outcome.generic.length === 0) return
  // 接管整次投放：捕获阶段 stopPropagation，让官方「仅支持图片」的
  // document 冒泡处理器看不到这次事件；图片拖拽不受影响（generic 为空时放行）。
  event.preventDefault()
  event.stopPropagation()
  hideOverlay()
  currentHandler(outcome.generic)
  // 输入框的拖放遮罩依赖 window dragend 复位；补发一次，避免遮罩残留
  window.dispatchEvent(dragEndEvent())
}

function dragEndEvent(): Event {
  const Ctor = (typeof DragEvent !== 'undefined' ? DragEvent : Event) as typeof Event
  return new Ctor('dragend')
}

function onDragOver(event: DragEvent): void {
  if (!(event.target instanceof Element) || !event.target.closest('[data-composer-card]')) return
  if (hasGenericFiles(event)) event.preventDefault()
}

function showOverlay(): void {
  if (overlay !== null) return
  overlay = document.createElement('div')
  overlay.setAttribute('data-file-attachments-overlay', 'true')
  overlay.textContent = '松开以添加文件到会话'
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'color-mix(in srgb, rgba(17, 18, 22, 0.88), transparent)',
    color: '#e8eaf0',
    fontSize: '16px',
    fontWeight: '600',
    pointerEvents: 'none',
    backdropFilter: 'blur(2px)',
  })
  document.body.appendChild(overlay)
}

function hideOverlay(): void {
  overlay?.remove()
  overlay = null
}
