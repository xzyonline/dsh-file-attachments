import React from 'react'
import type { AttachmentMetadata } from '../shared/contracts.ts'

interface TypePresentation { icon: string; color: string }

/** 按检测到的 family/kind 区分图标与颜色;无法识别或元数据缺失时给出中性占位。 */
export function typePresentation(metadata: AttachmentMetadata): TypePresentation {
  const detected = metadata.detected ?? { family: 'unknown', kind: 'unknown', mime: '', confidence: 'low', readable: false, mismatch: false, risks: [] }
  const { family, kind } = detected
  if (family === 'image') return { icon: '🖼️', color: '#b06ec4' }
  if (family === 'archive') return { icon: '🗜️', color: '#b7791f' }
  if (family === 'binary') return { icon: '📦', color: '#8a8f98' }
  if (family === 'document') {
    switch (kind) {
      case 'pdf': return { icon: '📕', color: '#e05656' }
      case 'xlsx':
      case 'xls':
      case 'ods': return { icon: '📊', color: '#3b9b68' }
      case 'pptx':
      case 'odp': return { icon: '📽️', color: '#d68a3c' }
      case 'epub': return { icon: '📖', color: '#6c8fd4' }
      default: return { icon: '📝', color: '#5b8ff9' }
    }
  }
  if (family === 'text') {
    switch (kind) {
      case 'markdown': return { icon: '📄', color: '#6c8fd4' }
      case 'config-json':
      case 'config-yaml':
      case 'config-ini':
      case 'config-toml':
      case 'config-xml':
      case 'plist':
      case 'env': return { icon: '⚙️', color: '#b7791f' }
      case 'csv':
      case 'tsv': return { icon: '📊', color: '#3b9b68' }
      case 'sql': return { icon: '🗄️', color: '#5b8ff9' }
      case 'shell':
      case 'source-typescript':
      case 'source-javascript':
      case 'source-python':
      case 'source-c':
      case 'source-cpp':
      case 'source-go':
      case 'source-rust':
      case 'source-java': return { icon: '💻', color: '#7a86a6' }
      default: return { icon: '📃', color: '#8a8f98' }
    }
  }
  return { icon: '❓', color: '#8a8f98' }
}

export function FileAttachmentDock(props: { files: AttachmentMetadata[]; onRemove: (id: string) => void; armedId?: string | null; onArm?: (id: string) => void }): React.ReactElement {
  return <div aria-label="文件附件" data-testid="file-attachment-dock" style={dockStyle}>
    {props.files.map(file => {
      const presentation = typePresentation(file)
      const detected = file.detected ?? { family: 'unknown', kind: 'unknown', mime: '', confidence: 'low', readable: false, mismatch: false, risks: [] }
      return <div key={file.id} style={fileStyle}>
        <span aria-hidden="true" style={{ ...iconStyle, color: presentation.color }}>{presentation.icon}</span>
        <span style={detailsStyle}>
          <span style={nameStyle}>{file.safeName}</span>
          <span style={metaStyle}>
            <span>{formatKind(detected.kind)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(file.bytes)}</span>
            {detected.mismatch && <span role="status" title="文件扩展名与实际内容不一致" style={warningStyle}>格式需确认</span>}
          </span>
        </span>
        {props.armedId === file.id
          ? <button type="button" aria-label={`确认移除 ${file.safeName}`} title="再次点击确认移除附件" onClick={() => props.onRemove(file.id)} style={confirmStyle}>确认移除</button>
          : <button type="button" aria-label={`移除 ${file.safeName}`} title="移除附件" onClick={() => props.onArm?.(file.id)} style={removeStyle}>×</button>}
      </div>
    })}
  </div>
}

const dockStyle: React.CSSProperties = {
  boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', gap: 8,
  width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 4 * var(--dsh-composer-dock-inset, 8px))',
  maxWidth: 'calc(var(--dsh-composer-card-max-width, 780px) - 4 * var(--dsh-composer-dock-inset, 8px))',
  margin: '0 auto', padding: '2px 0',
}

const fileStyle: React.CSSProperties = {
  boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, maxWidth: '100%', flex: '0 1 320px',
  padding: '8px 10px', border: '1px solid rgba(127, 127, 127, .28)', borderRadius: 12,
  background: 'var(--dsw-specific-tip, rgba(127, 127, 127, .10))', color: 'var(--dsw-alias-label-primary, inherit)',
}

const iconStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
  width: 28, height: 32, borderRadius: 8, background: 'var(--dsw-alias-state-business-tertiary, rgba(72, 132, 255, .18))', fontSize: 18,
}

const detailsStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 }
const nameStyle: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: 1.35 }
const metaStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, color: 'var(--dsw-alias-label-tertiary, rgba(127, 127, 127, .92))', fontSize: 12, lineHeight: 1.3 }
const warningStyle: React.CSSProperties = { color: 'var(--dsw-alias-state-warn-primary, #b7791f)', fontWeight: 600 }
const removeStyle: React.CSSProperties = { flex: '0 0 auto', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary, rgba(127, 127, 127, .95))', fontSize: 20, lineHeight: 1, padding: '2px 4px', cursor: 'pointer' }
const confirmStyle: React.CSSProperties = { flex: '0 0 auto', border: 0, borderRadius: 6, background: 'var(--dsw-alias-state-error-primary, #c04545)', color: '#fff', fontSize: 12, lineHeight: '20px', padding: '0 8px', cursor: 'pointer' }

function formatKind(kind: string): string {
  const labels: Record<string, string> = {
    cfb: '复合文档', markdown: 'Markdown', 'config-json': 'JSON', 'config-yaml': 'YAML',
    'config-ini': 'INI', 'config-text': '文本', csv: 'CSV', tsv: 'TSV',
  }
  return labels[kind] ?? kind.toUpperCase()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
