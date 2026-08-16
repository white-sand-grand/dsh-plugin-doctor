import { describe, expect, it } from 'vitest'
import { recommend } from '../src/recommend.ts'
import type { AskChoiceHook } from '../src/interaction.ts'
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

/** Stub hook answering one pre-chosen key, and recording what was asked. */
function answering(key: string): AskChoiceHook & { asked: string[] } {
  const asked: string[] = []
  const hook: AskChoiceHook = async (question, _header, choices) => {
    asked.push(question)
    expect(choices.some(choice => choice.key === key)).toBe(true)
    return key
  }
  return Object.assign(hook, { asked })
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

const MEMORY_INTENT = 'I need a memory plugin that recalls sessions'

describe('recommend: dedupe branch', () => {
  it('degraded (no hook): keep/remove outcome plus the consolidation hint', async () => {
    const search: SearchResult = { plugins: [memoryCandidate, memoryClone] }
    const result = await recommend(MEMORY_INTENT, search, installed, 0.8, 'web')
    expect(result.branch).toBe('dedupe')
    // The better-maintained candidate wins; the stale installed clone is removed.
    expect(result.removals).toContain('dsh-plugin-agent-memory')
    expect(result.report).toContain('dsh plugin --profile web remove dsh-plugin-agent-memory')
    expect(result.report).toContain('dsh plugin --profile web add github:community/dsh-plugin-memory')
    expect(result.report).toMatch(/Overlap is \*\*\d+%/)
    expect(result.report).toContain('To consolidate these into one purpose-built plugin instead')
  })

  it("asked 'keep': same outcome, marked as user-confirmed, no hint", async () => {
    const result = await recommend(MEMORY_INTENT, { plugins: [memoryCandidate, memoryClone] }, installed, 0.8, 'web', { askChoice: answering('keep') })
    expect(result.branch).toBe('dedupe')
    expect(result.report).toContain('Confirmed by you: de-duplicate')
    expect(result.report).not.toContain('To consolidate')
  })

  it("asked 'integrate': emits the integration spec and removes installed members", async () => {
    const result = await recommend(MEMORY_INTENT, { plugins: [memoryCandidate, memoryClone] }, installed, 0.8, 'web', { askChoice: answering('integrate') })
    expect(result.branch).toBe('integrate')
    expect(result.report).toContain('Integration Spec: consolidate into one plugin')
    expect(result.report).toContain('Capabilities (union of member capabilities)')
    expect(result.report).toContain('`memory`')
    expect(result.report).toContain('vs `dsh-plugin-memory`')
    expect(result.removals).toEqual(['dsh-plugin-agent-memory'])
    expect(result.report).toContain('dsh plugin --profile web remove dsh-plugin-agent-memory')
  })

  it("asked 'skip': records the finding, removes nothing", async () => {
    const result = await recommend(MEMORY_INTENT, { plugins: [memoryCandidate, memoryClone] }, installed, 0.8, 'web', { askChoice: answering('skip') })
    expect(result.branch).toBe('dedupe')
    expect(result.removals).toEqual([])
    expect(result.report).toContain('leave it as-is')
    expect(result.report).not.toContain('dsh plugin --profile web remove')
  })
})

describe('recommend: clean-match branch', () => {
  it('suggests installing the top pick', async () => {
    const result = await recommend(MEMORY_INTENT, { plugins: [memoryCandidate] }, [], 0.8, 'web')
    expect(result.branch).toBe('recommend')
    expect(result.report).toContain('dsh plugin --profile web add github:community/dsh-plugin-memory')
  })
})

describe('recommend: empty-community branch', () => {
  const JIRA_INTENT = 'I need a plugin that syncs todos with Jira boards automatically'
  // Hits 2 of 5 intent tokens ("syncs", "jira") → relevance 0.4: a near-miss.
  const jiraNearMiss = plugin({
    name: 'dsh-plugin-jira-markdown',
    description: 'Syncs Jira issues to markdown files.',
    capabilities: ['jira', 'export'],
  })

  it('degraded (no hook): spec emitted directly, pre-v0.2 behavior', async () => {
    const result = await recommend('I need a plugin that syncs todos with Jira boards via webhooks', { plugins: [] }, [], 0.8, 'web')
    expect(result.branch).toBe('spec')
    expect(result.report).toContain('Plugin Spec')
    expect(result.report).toMatch(/dsh-plugin-[a-z-]+/)
    expect(result.report).toContain('apply(ctx, config)')
    expect(result.report).toContain('defineTool')
  })

  it('degraded: near-miss competitors are listed with what they lack', async () => {
    const result = await recommend(JIRA_INTENT, { plugins: [jiraNearMiss] }, [], 0.8, 'web')
    expect(result.branch).toBe('spec')
    expect(result.report).toContain('Closest competitors')
    expect(result.report).toContain('dsh-plugin-jira-markdown')
    expect(result.report).toMatch(/missing from it: (todos|boards)/)
  })

  it("asked 'build': spec emitted as user-confirmed", async () => {
    const result = await recommend(JIRA_INTENT, { plugins: [jiraNearMiss] }, [], 0.8, 'web', { askChoice: answering('build') })
    expect(result.branch).toBe('spec')
    expect(result.report).toContain('confirmed by you')
    expect(result.report).toContain('Plugin Spec')
  })

  it("asked 'abort': no spec, competitor list kept for reference", async () => {
    const result = await recommend(JIRA_INTENT, { plugins: [jiraNearMiss] }, [], 0.8, 'web', { askChoice: answering('abort') })
    expect(result.branch).toBe('none')
    expect(result.report).not.toContain('Plugin Spec')
    expect(result.report).toContain('dsh-plugin-jira-markdown')
    expect(result.report).toContain('not to self-develop')
  })

  it('irrelevant matches do not count as community coverage', async () => {
    const irrelevant = plugin({ name: 'dsh-plugin-shell-tools', description: 'Shell helper utilities.', capabilities: ['shell'] })
    const result = await recommend(JIRA_INTENT, { plugins: [irrelevant] }, [], 0.8, 'web')
    expect(result.branch).toBe('spec')
  })
})

describe('recommend: report plumbing', () => {
  it('carries the degradation note into the report header', async () => {
    const result = await recommend('memory plugin', { plugins: [], degraded: 'GitHub API unavailable; serving stale cache' }, [], 0.8, 'web')
    expect(result.report).toContain('GitHub API unavailable')
  })
})
