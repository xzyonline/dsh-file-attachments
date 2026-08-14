import { describe, expect, it } from 'vitest'
import { createAttachmentToolDefinitions } from '../src/tools.ts'

describe('attachment tools', () => {
  it('registers exactly the three stable tool names and schemas', () => {
    const definitions = createAttachmentToolDefinitions({} as never, {} as never)
    expect(definitions.map(definition => definition.name)).toEqual(['attachment_info', 'read_attachment', 'list_archive'])
    expect(definitions[0]!.parameters.attachment_id!.required).toBe(true)
    expect(definitions[1]!.parameters.archive_path!.type).toBe('string')
  })
})
