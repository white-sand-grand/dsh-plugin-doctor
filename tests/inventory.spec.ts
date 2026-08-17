import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readInventory, readPluginRows, resolveDshHome, toPluginRows } from '../src/inventory.ts'

describe('inventory', () => {
  it('reads dsh.profile.bundles from the profile manifest under $DSH_HOME', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-rec-'))
    await mkdir(join(home, 'profiles', 'web'), { recursive: true })
    await writeFile(
      join(home, 'profiles', 'web', 'package.json'),
      JSON.stringify({ dsh: { profile: { bundles: ['dsh-plugin-doctor'] } }, dependencies: { 'some-lib': '1.0.0' } }),
      'utf8',
    )
    const inventory = await readInventory('web', { DSH_HOME: home })
    expect(inventory.note).toBeUndefined()
    expect(inventory.names).toEqual(['dsh-plugin-doctor'])
  })

  it('reports a missing profile as an empty list with a note, not an error', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-rec-'))
    const inventory = await readInventory('web', { DSH_HOME: home })
    expect(inventory.names).toEqual([])
    expect(inventory.note).toContain("has no package.json")
  })

  it('resolves the DSH home with env precedence over ~/.dsh', () => {
    expect(resolveDshHome({ DSH_HOME: '/custom/home' })).toBe('/custom/home')
    expect(resolveDshHome({ DSH_HOME: '  ' })).toContain('.dsh')
  })

  it('projects names into similarity-comparable rows', () => {
    const rows = toPluginRows(['a', 'b'])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'a', stars: 0 })
  })

  it('reads installed package descriptions, keywords, and dependencies', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-rec-'))
    const root = join(home, 'profiles', 'web', 'node_modules', 'dsh-plugin-graph')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      description: 'Visualize plugin dependencies',
      keywords: ['graph', 'dependency'],
      dependencies: { alpha: '1.0.0' },
      peerDependencies: { beta: '2.0.0' },
    }))
    const rows = await readPluginRows('web', ['dsh-plugin-graph'], { DSH_HOME: home })
    expect(rows[0]).toMatchObject({
      description: 'Visualize plugin dependencies',
      capabilities: ['graph', 'dependency'],
      dependencies: ['alpha', 'beta'],
    })
  })
})
