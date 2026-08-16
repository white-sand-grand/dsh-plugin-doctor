import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { zstdCompress } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

// Simulate an older Node runtime: node:zlib without the zstd exports. The
// plugin must still import and the audit must degrade with a clear note
// instead of failing the module load (the npx + Node <22.15 field report).
vi.mock('node:zlib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:zlib')>()
  return { ...actual, zstdDecompress: undefined }
})

const zstdCompressAsync = promisify(zstdCompress)

describe('usage audit on Node without node:zlib zstd', () => {
  it('degrades with an explanatory note while plain logs still aggregate', async () => {
    const { auditToolUsage } = await import('../src/usage.ts')
    const root = join(tmpdir(), `dsh-usage-oldnode-${Date.now()}`)
    const compressedDir = join(root, 'proj', 'session-z')
    await mkdir(compressedDir, { recursive: true })
    await writeFile(join(compressedDir, 'session.jsonl.zstd'), await zstdCompressAsync(Buffer.from('{}\n', 'utf8')))
    const plainDir = join(root, 'proj', 'session-p')
    await mkdir(plainDir, { recursive: true })
    await writeFile(join(plainDir, 'session.jsonl'), `${JSON.stringify({ type: 'tool/call', turn: 1, step: 1, callId: 'c', name: 'bash', arguments: '{}' })}\n`)
    const audit = await auditToolUsage(root)
    expect(audit.sessionsScanned).toBe(1)
    expect(audit.skipped).toBe(1)
    expect(audit.note).toContain('lacks node:zlib zstd support')
    expect(audit.tools.map(tool => tool.tool)).toEqual(['bash'])
  })
})
