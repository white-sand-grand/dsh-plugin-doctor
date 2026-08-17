import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { zstdCompress } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { auditToolUsage, pluginToolMap } from '../src/usage.ts'

const zstdCompressAsync = promisify(zstdCompress)

/** Write one session artifact under `<root>/<slug>/<session>/session.jsonl.zstd`. */
async function writeZstdSession(root: string, slug: string, session: string, events: object[]): Promise<void> {
  const dir = join(root, slug, session)
  await mkdir(dir, { recursive: true })
  const lines = events.map(event => JSON.stringify(event)).join('\n') + '\n'
  await writeFile(join(dir, 'session.jsonl.zstd'), await zstdCompressAsync(Buffer.from(lines, 'utf8')))
}

/** Write one plain-text session artifact. */
async function writePlainSession(root: string, slug: string, session: string, events: object[]): Promise<void> {
  const dir = join(root, slug, session)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n')
}

const toolCall = (name: string) => ({ type: 'tool/call', turn: 1, step: 1, callId: 'c1', name, arguments: '{}' })

describe('auditToolUsage', () => {
  it('aggregates calls per tool across zstd and plain logs', async () => {
    const root = join(tmpdir(), `dsh-usage-${Date.now()}-a`)
    await writeZstdSession(root, 'proj-a', 'session-1', [toolCall('plugin_recommend'), toolCall('plugin_recommend'), { type: 'session' }])
    await writeZstdSession(root, 'proj-a', 'session-2', [toolCall('plugin_recommend'), toolCall('bash')])
    await writePlainSession(root, 'proj-b', 'session-3', [toolCall('read')])
    const audit = await auditToolUsage(root)
    expect(audit.sessionsScanned).toBe(3)
    expect(audit.skipped).toBe(0)
    expect(audit.tools.map(tool => tool.tool)).toEqual(['plugin_recommend', 'bash', 'read'])
    const recommend = audit.tools[0]!
    expect(recommend.calls).toBe(3)
    expect(recommend.sessions).toBe(2)
    expect(Number.isNaN(Date.parse(recommend.lastUsed))).toBe(false)
    expect(audit.note).toContain('active session')
  })

  it('skips corrupt artifacts and salvages torn-tail logs instead of failing the audit', async () => {
    const root = join(tmpdir(), `dsh-usage-${Date.now()}-b`)
    await writeZstdSession(root, 'proj', 'session-ok', [toolCall('bash')])
    // Garbage without a valid zstd magic: unreadable, must be skipped.
    const corruptDir = join(root, 'proj', 'session-corrupt')
    await mkdir(corruptDir, { recursive: true })
    await writeFile(join(corruptDir, 'session.jsonl.zstd'), Buffer.from('this is not zstd at all'))
    // A torn final frame still decodes its complete leading frames — the
    // JSONL persistence format is concatenated-frame by design — so it
    // counts as scanned, not skipped.
    const tornDir = join(root, 'proj', 'session-torn')
    await mkdir(tornDir, { recursive: true })
    const whole = await zstdCompressAsync(Buffer.from(`${JSON.stringify(toolCall('read'))}\n`, 'utf8'))
    await writeFile(join(tornDir, 'session.jsonl.zstd'), Buffer.concat([whole, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00])]))
    const audit = await auditToolUsage(root)
    expect(audit.sessionsScanned).toBe(2)
    expect(audit.skipped).toBe(1)
    expect(audit.tools.map(tool => tool.tool).sort()).toEqual(['bash', 'read'])
  })

  it('reports a note for a missing sessions root', async () => {
    const audit = await auditToolUsage(join(tmpdir(), `dsh-usage-${Date.now()}-missing`))
    expect(audit.sessionsScanned).toBe(0)
    expect(audit.note).toContain('no session logs')
  })
})

describe('pluginToolMap', () => {
  it('attributes tools via the dsh.tools declaration and ignores undeclared plugins', async () => {
    const profile = join(tmpdir(), `dsh-usage-${Date.now()}-profile`)
    const declared = join(profile, 'node_modules', 'dsh-plugin-doctor')
    await mkdir(declared, { recursive: true })
    await writeFile(join(declared, 'package.json'), JSON.stringify({ name: 'dsh-plugin-doctor', dsh: { tools: ['plugin_recommend', 'plugin_usage_audit'] } }))
    const undeclared = join(profile, 'node_modules', 'some-plugin')
    await mkdir(undeclared, { recursive: true })
    await writeFile(join(undeclared, 'package.json'), JSON.stringify({ name: 'some-plugin' }))
    const map = await pluginToolMap(profile, ['dsh-plugin-doctor', 'some-plugin', 'not-installed'])
    expect(map.get('plugin_recommend')).toBe('dsh-plugin-doctor')
    expect(map.get('plugin_usage_audit')).toBe('dsh-plugin-doctor')
    expect(map.size).toBe(2)
  })
})
