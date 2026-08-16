import { describe, expect, it } from 'vitest'
import { analyze, redundancyClusters, similarityMatrix } from '../src/similarity.ts'
import type { CommunityPlugin } from '../src/types.ts'

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

const memoryA = plugin({
  name: 'dsh-plugin-memory',
  description: 'Persistent conversation memory with recall and summarization for agents.',
  readmeExcerpt: 'Persistent conversation memory for DSH agents: recall prior sessions, summarize long histories. capabilities: memory, context, session',
  capabilities: ['memory', 'context', 'session'],
  stars: 120,
  updatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
})

const memoryB = plugin({
  name: 'dsh-plugin-remember',
  description: 'Conversation memory: persists agent sessions and recalls them later.',
  readmeExcerpt: 'Persists conversation memory, recalls prior agent sessions. capabilities: memory, context, recall',
  capabilities: ['memory', 'context', 'recall'],
  stars: 15,
  updatedAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
})

const shell = plugin({
  name: 'dsh-plugin-shell-tools',
  description: 'Extra shell helpers for running build commands.',
  capabilities: ['shell'],
  stars: 5,
  updatedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
})

describe('similarityMatrix', () => {
  it('ranks related plugins far above unrelated ones and scores identical rows ~1', () => {
    const cells = similarityMatrix([memoryA, memoryB, shell])
    const memoryPair = cells.find(cell => (cell.a === 'dsh-plugin-memory' && cell.b === 'dsh-plugin-remember') || (cell.a === 'dsh-plugin-remember' && cell.b === 'dsh-plugin-memory'))!
    const shellPairs = cells.filter(cell => cell.a === 'dsh-plugin-shell-tools' || cell.b === 'dsh-plugin-shell-tools')
    expect(memoryPair.overall).toBeGreaterThan(0.35)
    for (const cell of shellPairs) expect(cell.overall).toBeLessThan(memoryPair.overall / 2)
    expect(memoryPair.capabilityJaccard).toBeCloseTo(1 / 2)

    const identical = similarityMatrix([memoryA, { ...memoryA, name: 'dsh-plugin-memory-fork' }])
    // A rebranded duplicate must clear the default 0.8 redundancy threshold.
    expect(identical[0]!.overall).toBeGreaterThan(0.8)
  })

  it('returns an empty matrix for fewer than two plugins', () => {
    expect(similarityMatrix([memoryA])).toEqual([])
  })
})

describe('redundancyClusters', () => {
  it('groups only the redundant pair above the threshold', () => {
    const matrix = similarityMatrix([memoryA, memoryB, shell])
    const clusters = redundancyClusters([memoryA, memoryB, shell], matrix, 0.3)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.members).toContain('dsh-plugin-memory')
    expect(clusters[0]!.members).toContain('dsh-plugin-remember')
    expect(clusters[0]!.members).not.toContain('dsh-plugin-shell-tools')
  })

  it('yields no clusters when everything is below the threshold', () => {
    const matrix = similarityMatrix([memoryA, shell])
    expect(redundancyClusters([memoryA, shell], matrix, 0.99)).toEqual([])
  })
})

describe('irreplaceabilityScores', () => {
  it('ranks the better-maintained duplicate higher', () => {
    const scores = analyze([memoryA, memoryB], 0.8).irreplaceability
    const a = scores.find(score => score.name === 'dsh-plugin-memory')!
    const b = scores.find(score => score.name === 'dsh-plugin-remember')!
    expect(a.score).toBeGreaterThan(b.score)
    expect(b.reasons.join(' ')).toContain('not updated')
  })
})
