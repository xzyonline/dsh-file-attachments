import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3080')
const endpoint = `${base.origin}/api/dsh-file-attachments/v1/files`
const fixturePath = process.argv[3] ?? process.env.DSH_SMOKE_FILE
const sessionId = `smoke_${randomUUID().replaceAll('-', '').slice(0, 24)}`
const otherSessionId = `smoke_other_${randomUUID().replaceAll('-', '').slice(0, 20)}`
const batchId = `batch_${randomUUID().replaceAll('-', '').slice(0, 20)}`
const fileName = fixturePath ? basename(fixturePath) : 'smoke.config'
const body = fixturePath ? await readFile(fixturePath) : Buffer.from('[server]\npassword=smoke-secret\n', 'utf8')
const origin = process.env.DSH_SMOKE_ORIGIN ?? base.origin

async function json(response) {
  const text = await response.text()
  try { return JSON.parse(text) } catch { return { raw: text } }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

let uploadedId
let cleanupComplete = false

try {
  const probe = await fetch(endpoint, { method: 'OPTIONS' })
  assert(probe.status !== 404, `plugin route is missing (HTTP ${probe.status})`)

  const uploadedResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/octet-stream',
      'x-dsh-session-id': sessionId,
      'x-dsh-batch-id': batchId,
      'x-dsh-file-name': encodeURIComponent(fileName),
    },
    body,
  })
  const uploaded = await json(uploadedResponse)
  assert(uploadedResponse.status === 201 && uploaded.ok === true, `upload failed (HTTP ${uploadedResponse.status})`)
  assert(uploaded.metadata?.id && uploaded.metadata?.detected?.kind, 'upload did not return verified metadata')
  uploadedId = uploaded.metadata.id

  const crossSessionResponse = await fetch(`${endpoint}/${encodeURIComponent(uploadedId)}`, {
    headers: { 'x-dsh-session-id': otherSessionId },
  })
  const crossSession = await json(crossSessionResponse)
  assert(crossSessionResponse.status === 403 && crossSession.error?.code === 'ATTACHMENT_FORBIDDEN', 'cross-session metadata read was not rejected')

  const deletedResponse = await fetch(`${endpoint}/${encodeURIComponent(uploadedId)}`, {
    method: 'DELETE',
    headers: { 'x-dsh-session-id': sessionId },
  })
  const deleted = await json(deletedResponse)
  assert(deletedResponse.status === 200 && deleted.ok === true, `draft cleanup failed (HTTP ${deletedResponse.status})`)
  cleanupComplete = true

  console.log(`PASS route reachable: ${base.origin}`)
  console.log(`PASS upload/type detection: ${uploaded.metadata.detected.kind}`)
  console.log('PASS cross-session metadata rejection: ATTACHMENT_FORBIDDEN')
  console.log('PASS disposable draft deletion')
  console.log('SKIP tool-level reads: requires a real DSH session log containing the uploaded marker')
} catch (error) {
  console.error(`smoke failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (uploadedId && !cleanupComplete) {
    await fetch(`${endpoint}/${encodeURIComponent(uploadedId)}`, {
      method: 'DELETE',
      headers: { 'x-dsh-session-id': sessionId },
    }).catch(() => undefined)
  }
}
