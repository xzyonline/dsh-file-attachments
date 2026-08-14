import React from 'react'
import { describe, expect, it } from 'vitest'
import { FileAttachButton } from '../src/client/FileAttachButton.tsx'
import { classifyDrop } from '../src/client/drop.ts'

function file(name: string, type: string): File { return new File(['x'], name, { type }) }

describe('attachment client UI', () => {
  it('exposes an accessible file button and forwards selected non-images', () => {
    const selected: File[] = []
    const fragment = FileAttachButton({ onFiles: files => selected.push(...files) })
    const children = fragment.props.children as React.ReactElement[]
    expect(children[0]!.props['aria-label']).toBe('添加文件')
    children[1]!.props.onChange({ currentTarget: { files: [file('a.txt', 'text/plain')] } })
    expect(selected[0]?.name).toBe('a.txt')
  })

  it('leaves images for the native handler in mixed drops', () => {
    const outcome = classifyDrop([file('app.config', 'text/plain'), file('screen.png', 'image/png')])
    expect(outcome.generic.map(item => item.name)).toEqual(['app.config'])
    expect(outcome.nativeImages.map(item => item.name)).toEqual(['screen.png'])
  })
})
