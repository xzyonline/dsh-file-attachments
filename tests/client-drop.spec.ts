// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyDrop, installFileDrop } from '../src/client/drop.ts'

function fakeDrag(type: string, files: File[], target?: EventTarget): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files, dropEffect: 'none', types: ['Files'] } })
  if (target !== undefined) Object.defineProperty(event, 'target', { value: target })
  return event
}

const genericFile = () => new File(['x'], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
const imageFile = () => new File(['x'], 'shot.png', { type: 'image/png' })

function overlayCount(): number {
  return document.querySelectorAll('[data-file-attachments-overlay]').length
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('classifyDrop', () => {
  it('splits native images from generic files', () => {
    const { generic, nativeImages } = classifyDrop([imageFile(), genericFile()])
    expect(generic).toHaveLength(1)
    expect(nativeImages).toHaveLength(1)
  })
})

describe('installFileDrop full-window takeover', () => {
  it('intercepts window drag of generic files (no "images only" toast path)', () => {
    const dispose = installFileDrop(document, vi.fn())
    const event = fakeDrag('dragover', [genericFile()])
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(overlayCount()).toBe(1)
    dispose()
  })

  it('leaves image-only drags untouched for the native pipeline', () => {
    const dispose = installFileDrop(document, vi.fn())
    const event = fakeDrag('dragover', [imageFile()])
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(overlayCount()).toBe(0)
    dispose()
  })

  it('hands a drop anywhere in the window to the handler and hides the overlay', () => {
    const onFiles = vi.fn()
    const dispose = installFileDrop(document, onFiles)
    window.dispatchEvent(fakeDrag('dragover', [genericFile()]))
    expect(overlayCount()).toBe(1)
    const dropEvent = fakeDrag('drop', [genericFile()], document.body)
    document.dispatchEvent(dropEvent)
    expect(dropEvent.defaultPrevented).toBe(true)
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(overlayCount()).toBe(0)
    dispose()
  })

  it('uninstalls every listener on dispose', () => {
    const dispose = installFileDrop(document, vi.fn())
    dispose()
    const event = fakeDrag('dragover', [genericFile()])
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(overlayCount()).toBe(0)
  })
})
