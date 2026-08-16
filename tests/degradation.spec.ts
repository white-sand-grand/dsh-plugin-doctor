import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommunitySource } from '../src/github.ts'
import type { CommunityPlugin } from '../src/types.ts'

/** Stub the platform fetch used by the HTTP fallback layer. */
function stubFetch(handler: (url: string) => { status: number; body: string } | Promise<{ status: number; body: string }>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const response = await handler(String(input))
    return new Response(response.body, { status: response.status })
  }))
}

/** A search-API payload with one repo plus its README. */
function githubPayload(): { status: number; body: string } {
  return {
    status: 200,
    body: JSON.stringify({
      items: [{
        full_name: 'community/dsh-plugin-memory',
        name: 'dsh-plugin-memory',
        description: 'Persistent conversation memory.',
        stargazers_count: 42,
        pushed_at: '2026-08-01T00:00:00Z',
      }],
    }),
  }
}

const readmeBody = () => ({
  status: 200,
  body: 'memory plugin\ncapabilities: memory, context\ndependencies: dsh-tools',
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CommunitySource degradation chain', () => {
  it('serves the live listing, then absorbs an upstream outage within the TTL window', async () => {
    let failing = false
    stubFetch(url => {
      if (url.includes('/search/repositories')) {
        return failing ? { status: 403, body: 'rate limit' } : githubPayload()
      }
      return readmeBody()
    })
    const source = new CommunitySource({}, 30)
    const first = await source.search('memory', {}, undefined)
    expect(first.plugins.map(plugin => plugin.name)).toEqual(['dsh-plugin-memory'])
    expect(first.degraded).toBeUndefined()

    failing = true
    const second = await source.search('memory', {}, undefined)
    // Inside the TTL the cache is fresh, not degraded: the outage is invisible.
    expect(second.plugins.map(plugin => plugin.name)).toEqual(['dsh-plugin-memory'])
    expect(second.degraded).toBeUndefined()
  })

  it('degrades to the stale cache with a note once the TTL expires', async () => {
    vi.useFakeTimers()
    try {
      stubFetch(url => (url.includes('/search/repositories') ? githubPayload() : readmeBody()))
      const source = new CommunitySource({}, 30)
      await source.search('memory', {}, undefined)
      vi.setSystemTime(Date.now() + 31 * 60_000)
      stubFetch(() => ({ status: 403, body: 'rate limit' }))
      const result = await source.search('memory', {}, undefined)
      expect(result.plugins).toHaveLength(1)
      expect(result.degraded).toContain('stale cache')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the built-in registry snapshot on cold failure', async () => {
    stubFetch(() => ({ status: 429, body: 'rate limit exhausted' }))
    const source = new CommunitySource({}, 30)
    const result = await source.search('memory', {}, undefined)
    expect(result.plugins.length).toBeGreaterThan(0)
    expect(result.plugins.every(plugin => plugin.source === 'registry')).toBe(true)
    expect(result.degraded).toContain('registry snapshot')
  })

  it('never throws on network errors', async () => {
    stubFetch(() => Promise.reject(new Error('network down')))
    const source = new CommunitySource({}, 30)
    const result = await source.search('anything', {}, undefined)
    expect(result.degraded).toContain('network down')
  })

  it('parses capabilities and dependencies from the README excerpt', async () => {
    stubFetch(url => (url.includes('/search/repositories') ? githubPayload() : readmeBody()))
    const source = new CommunitySource({}, 30)
    const [plugin] = (await source.search('memory', {}, undefined)).plugins as [CommunityPlugin]
    expect(plugin.capabilities).toEqual(['memory', 'context'])
    expect(plugin.dependencies).toEqual(['dsh-tools'])
    expect(plugin.installRef).toBe('github:community/dsh-plugin-memory')
  })
})
