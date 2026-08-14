const NATIVE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export function classifyDrop(files: File[]): { generic: File[]; nativeImages: File[] } {
  return { generic: files.filter(file => !NATIVE_IMAGE_TYPES.has(file.type)), nativeImages: files.filter(file => NATIVE_IMAGE_TYPES.has(file.type)) }
}

export function installFileDrop(target: Document, onFiles: (files: File[]) => void): () => void {
  const onDrop = (event: DragEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-composer-card]')) return
    const outcome = classifyDrop([...event.dataTransfer?.files ?? []])
    if (outcome.generic.length === 0) return
    event.preventDefault()
    onFiles(outcome.generic)
  }
  const onDragOver = (event: DragEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-composer-card]')) return
    const outcome = classifyDrop([...event.dataTransfer?.files ?? []])
    if (outcome.generic.length > 0) event.preventDefault()
  }
  target.addEventListener('drop', onDrop)
  target.addEventListener('dragover', onDragOver)
  return () => { target.removeEventListener('drop', onDrop); target.removeEventListener('dragover', onDragOver) }
}
