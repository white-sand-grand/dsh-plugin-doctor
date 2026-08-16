import { describe, expect, it } from 'vitest'
import { recommend } from '../src/recommend.ts'
import type { CommunityPlugin, SearchResult } from '../src/types.ts'

function plugin(overrides: Partial<CommunityPlugin> & { name: string }): CommunityPlugin {
  return {
    repo: overrides.name,
    installRef: `github:community/${overrides.name}`,
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

const memoryCandidate = plugin({
  name: 'dsh-plugin-memory',
  description: 'Persistent conversation memory with recall and summarization.',
  readmeExcerpt: 'Persistent conversation memory for agents: recall sessions, summarize histories. capabilities: memory, context, session',
  capabilities: ['memory', 'context', 'session'],
  stars: 120,
  updatedAt: new Date().toISOString(),
})

const memoryClone = plugin({
  name: 'dsh-plugin-agent-memory',
  description: 'Persistent conversation memory with recall and summarization.',
  readmeExcerpt: 'Persistent conversation memory for agents: recall sessions, summarize histories. capabilities: memory, context, session',
  capabilities: ['memory', 'context', 'session'],
  stars: 12,
  updatedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
})

const installed = [plugin({ name: 'dsh-plugin-agent-memory', source: 'cache', description: 'Persistent conversation memory with recall and summarization.', capabilities: ['memory', 'context', 'session'] })]

describe('recommend branches', () => {
  it('branch dedupe: overlapping candidates produce a removal suggestion with the command', () => {
    const search: SearchResult = { plugins: [memoryCandidate, memoryClone] }
    const result = recommend('I need a memory plugin that recalls sessions', search, installed, 0.8, 'web')
    expect(result.branch).toBe('dedupe')
    // The better-maintained candidate wins; the stale installed clone is removed.
    expect(result.removals).toContain('dsh-plugin-agent-memory')
    expect(result.report).toContain('dsh plugin --profile web remove dsh-plugin-agent-memory')
    expect(result.report).toContain('dsh plugin --profile web add github:community/dsh-plugin-memory')
    expect(result.report).toMatch(/Overlap is \*\*\d+%/)
  })

  it('branch recommend: a clean match suggests installing the top pick', () => {
    const search: SearchResult = { plugins: [memoryCandidate] }
    const result = recommend('I need a memory plugin that recalls sessions', search, [], 0.8, 'web')
    expect(result.branch).toBe('recommend')
    expect(result.report).toContain('dsh plugin --profile web add github:community/dsh-plugin-memory')
  })

  it('branch spec: an empty community yields a Plugin Spec for building it yourself', () => {
    const search: SearchResult = { plugins: [] }
    const result = recommend('I need a plugin that syncs todos with Jira boards', search, [], 0.8, 'web')
    expect(result.branch).toBe('spec')
    expect(result.report).toContain('Plugin Spec')
    expect(result.report).toMatch(/dsh-plugin-[a-z-]+/)
    expect(result.report).toContain('apply(ctx, config)')
    expect(result.report).toContain('defineTool')
  })

  it('branch spec: irrelevant matches do not count as community coverage', () => {
    const irrelevant = plugin({ name: 'dsh-plugin-shell-tools', description: 'Shell helper utilities.', capabilities: ['shell'] })
    const result = recommend('I need a Jira board sync plugin', { plugins: [irrelevant] }, [], 0.8, 'web')
    expect(result.branch).toBe('spec')
  })

  it('carries the degradation note into the report header', () => {
    const result = recommend('memory plugin', { plugins: [], degraded: 'GitHub API unavailable; serving stale cache' }, [], 0.8, 'web')
    expect(result.report).toContain('GitHub API unavailable')
  })
})
