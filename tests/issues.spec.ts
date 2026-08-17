import { describe, expect, it, vi } from 'vitest'
import { searchOfficialIssues } from '../src/issues.ts'

describe('searchOfficialIssues', () => {
  it('returns matching open issues, excludes pull requests, and normalizes refs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain('/repos/owner/plugin/issues?state=open')
      return new Response(JSON.stringify([
        { title: 'Recursive watcher causes UI freeze', html_url: 'https://github.com/owner/plugin/issues/119', body: 'file panel watcher recursion', updated_at: '2026-08-16T00:00:00Z' },
        { title: 'A pull request', html_url: 'https://github.com/owner/plugin/pull/4', body: 'watcher', pull_request: {}, updated_at: '2026-08-15T00:00:00Z' },
        { title: 'Unrelated issue', html_url: 'https://github.com/owner/plugin/issues/2', body: 'documentation', updated_at: '2026-08-14T00:00:00Z' },
      ]), { status: 200 })
    }))
    const result = await searchOfficialIssues({}, ['github:owner/plugin'], 'file panel watcher', undefined)
    expect(result.degraded).toBeUndefined()
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ repo: 'owner/plugin', title: 'Recursive watcher causes UI freeze' })
    vi.unstubAllGlobals()
  })

  it('reports a degraded lookup without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 403 })))
    const result = await searchOfficialIssues({}, ['owner/plugin'], 'watcher', undefined)
    expect(result.issues).toEqual([])
    expect(result.degraded).toContain('could not be checked')
    vi.unstubAllGlobals()
  })
})
