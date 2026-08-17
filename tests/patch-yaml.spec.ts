import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The shipped `cordis.patch.yml` broke once (v0.5.0) through a four-space
 * indentation slip under `config:` — dsh refuses to boot the whole profile on
 * a malformed overlay, so this pins the file's structural invariants without
 * pulling in a YAML dependency: sibling keys must share one indentation, and
 * every expected config key must be present.
 */
describe('cordis.patch.yml structural invariants', () => {
  const requiredKeys = [
    'githubTokenEnv',
    'similarityThreshold',
    'cacheTtlMinutes',
    'enableRegistryFallback',
    'allowExecuteActions',
  ]

  it('indents all config keys uniformly under one config: block', async () => {
    const lines = (await readFile(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')).split('\n')
    const configStart = lines.findIndex(line => /^ {6}config:$/.test(line))
    expect(configStart).toBeGreaterThan(-1)
    const configKeys = lines.slice(configStart + 1).filter(line => /^\s+\S+:/.test(line))
    expect(configKeys.length).toBe(requiredKeys.length)
    const indents = new Set(configKeys.map(line => (line.match(/^\s+/) ?? [''])[0]))
    expect(indents.size).toBe(1)
  })

  it('carries the insert row with the plugin id and every config key', async () => {
    const text = await readFile(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('- insert:')
    expect(text).toContain('id: plugin-doctor')
    expect(text).toContain('name: dsh-plugin-doctor')
    for (const key of requiredKeys) {
      expect(text).toContain(`${key}:`)
    }
  })
})
