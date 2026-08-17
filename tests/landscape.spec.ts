import { describe, expect, it } from 'vitest'
import { assignTiers, renderClusterTree, renderLandscape, renderMermaidGraph } from '../src/landscape.ts'
import { analyze } from '../src/similarity.ts'
import type { CommunityPlugin } from '../src/types.ts'
import type { PluginUsageSummary as UsageSummary } from '../src/landscape.ts'

function plugin(overrides: Partial<CommunityPlugin> & { name: string }): CommunityPlugin {
  return {
    repo: overrides.name,
    installRef: overrides.name,
    description: '',
    readmeExcerpt: '',
    capabilities: [],
    dependencies: [],
    stars: 0,
    updatedAt: '',
    source: 'github',
    ...overrides,
  }
}

const fresh = new Date().toISOString()
const stale = new Date(Date.now() - 400 * 86_400_000).toISOString()

const used = plugin({ name: 'dsh-plugin-used', capabilities: ['a'], stars: 100, updatedAt: fresh })
const heavy = plugin({ name: 'dsh-plugin-heavy', capabilities: ['b'], stars: 80, updatedAt: fresh })
// Distinct capability and vocabulary: must not cluster with the stale plugin.
const idle = plugin({ name: 'dsh-plugin-idle', capabilities: ['d'], stars: 40, updatedAt: fresh, description: 'an unrelated niche feature set with unique vocabulary' })
const staleRedundant = plugin({
  name: 'dsh-plugin-stale',
  capabilities: ['c'],
  stars: 2,
  updatedAt: stale,
  description: 'shared capability cluster words',
  readmeExcerpt: 'shared capability cluster words repeated',
})

describe('assignTiers', () => {
  const installed = [used, heavy, idle, staleRedundant]
  const report = analyze(installed, 0.3)
  const usage: UsageSummary[] = [
    { name: 'dsh-plugin-used', calls: 3, daysSinceUse: 1 },
    { name: 'dsh-plugin-heavy', calls: 12, daysSinceUse: 0 },
    { name: 'dsh-plugin-idle', calls: 0 },
    { name: 'dsh-plugin-stale', calls: 0 },
  ]

  it('ranks volume as core, marks used as active, idle as idle', () => {
    const tiers = new Map(assignTiers(installed, usage, report).map(tier => [tier.name, tier]))
    expect(tiers.get('dsh-plugin-heavy')!.tier).toBe('core')
    expect(tiers.get('dsh-plugin-used')!.tier).toBe('active')
    expect(tiers.get('dsh-plugin-idle')!.tier).toBe('idle')
  })

  it('flags idle plus stale-or-redundant plugins for review', () => {
    const tiers = new Map(assignTiers(installed, usage, report).map(tier => [tier.name, tier]))
    expect(tiers.get('dsh-plugin-stale')!.tier).toBe('review')
    expect(tiers.get('dsh-plugin-stale')!.reason).toMatch(/never called/)
  })

  it('reports unattributed when usage cannot be measured', () => {
    const tiers = assignTiers([used], [{ name: 'dsh-plugin-used' } as PluginUsageSummary], analyze([used], 0.8))
    expect(tiers[0]!.tier).toBe('unattributed')
  })

  it('orders core first and review last', () => {
    const order = assignTiers(installed, usage, report).map(tier => tier.tier)
    expect(order.indexOf('core')).toBeLessThan(order.indexOf('active'))
    expect(order.indexOf('idle')).toBeLessThan(order.indexOf('review'))
  })
})

describe('renderMermaidGraph', () => {
  it('draws only above-threshold edges with percent labels, capped strongest-first', () => {
    const alpha = plugin({ name: 'alpha-plugin', capabilities: ['x'], description: 'shared feature vocabulary here' })
    const beta = plugin({ name: 'beta-plugin', capabilities: ['x'], description: 'shared feature vocabulary here' })
    const gamma = plugin({ name: 'gamma-plugin', capabilities: ['z'], description: 'completely unrelated domain terminology' })
    const matrix = analyze([alpha, beta, gamma], 0.3).matrix
    const graph = renderMermaidGraph(['alpha-plugin', 'beta-plugin', 'gamma-plugin'], matrix, 0.3)
    expect(graph).toContain('```mermaid')
    expect(graph).toContain('graph LR')
    expect(graph).toMatch(/---\|"\d+% · /)
    // gamma shares nothing: it appears as a node but never in an edge.
    const edgeLines = graph.split('\n').filter(line => line.includes('---|'))
    expect(edgeLines).toHaveLength(1)
    expect(edgeLines[0]).toMatch(/^ {2}n\d+ ---\|"\d+% · .+"\| n\d+$/)
    expect(graph).toContain('gamma-plugin')
  })
})

describe('renderClusterTree and renderLandscape', () => {
  it('renders clusters as an indented text fallback', () => {
    const alpha = plugin({ name: 'alpha-plugin', capabilities: ['x'], description: 'shared feature vocabulary here' })
    const beta = plugin({ name: 'beta-plugin', capabilities: ['x'], description: 'shared feature vocabulary here' })
    const clusters = analyze([alpha, beta], 0.3).clusters
    expect(clusters.length).toBeGreaterThan(0)
    const tree = renderClusterTree(clusters)
    expect(tree).toMatch(new RegExp(`- cluster \\(\\d+% cohesion\\)\\n {2}- ${clusters[0]!.members[0]}\\n {2}- ${clusters[0]!.members[1]}`))
  })

  it('composes the full report with tiers, graph, and fallback', () => {
    const alpha = plugin({ name: 'alpha-plugin', capabilities: ['x'], description: 'shared feature vocabulary here' })
    const beta = plugin({ name: 'beta-plugin', capabilities: ['x'], description: 'shared feature vocabulary here' })
    const report = analyze([alpha, beta], 0.3)
    const text = renderLandscape(
      [{ name: 'alpha-plugin', tier: 'core', reason: '12 recorded calls' }, { name: 'beta-plugin', tier: 'review', reason: 'never called' }],
      report,
      0.3,
      ['alpha-plugin', 'beta-plugin'],
      [alpha, beta],
      2,
    )
    expect(text).toContain('## Tiers')
    expect(text).toContain('## 插件相似度关系图')
    expect(text).toContain('## 为什么相似')
    expect(text).toContain('12 recorded calls')
    expect(text).toContain('功能重叠100%')
  })
})
