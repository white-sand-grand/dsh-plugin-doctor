import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OfficialReleaseSource,
  analyzeCapabilityOverlaps,
  analyzePeerConflicts,
  analyzeToolTakeovers,
  appendBehindContent,
  assembleSyncStatus,
  compareVersions,
  detectLocalVersion,
  parseVersion,
  pickLatestRelease,
  rangeExcludes,
  renderSyncAdvisory,
} from '../src/official-sync.ts'
import type { CommunityPlugin } from '../src/types.ts'

/** Stub the platform fetch used by the HTTP fallback layer. */
function stubFetch(handler: (url: string) => { status: number; body: string }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const response = handler(String(input))
    return new Response(response.body, { status: response.status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const RELEASES_URL_SUBSTRING = '/repos/deepseek-ai/deepseek-harness/releases'

/** One official release entry as GitHub serves it. */
function releaseEntry(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([{
    tag_name: 'dsh-v0.1.1-rc.2',
    name: 'v0.1.1-rc.2',
    draft: false,
    prerelease: true,
    published_at: '2026-08-21T12:35:08Z',
    html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2',
    body: '* adds a native session search tool\n* improves file panel performance',
    ...overrides,
  }])
}

function pluginRow(overrides: Partial<CommunityPlugin> = {}): CommunityPlugin {
  return {
    name: 'dsh-plugin-memory',
    repo: 'community/dsh-plugin-memory',
    installRef: 'github:community/dsh-plugin-memory',
    description: '',
    readmeExcerpt: '',
    capabilities: [],
    dependencies: [],
    stars: 0,
    updatedAt: '',
    source: 'cache',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('version parsing and comparison', () => {
  it('parses tag, name, CLI, and manifest spellings', () => {
    expect(parseVersion('dsh-v0.1.1-rc.2')).toEqual({ major: 0, minor: 1, patch: 1, prerelease: ['rc', '2'] })
    expect(parseVersion('v0.1.1')).toEqual({ major: 0, minor: 1, patch: 1, prerelease: [] })
    expect(parseVersion('V1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion(' 0.1.0-rc.5\n')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: ['rc', '5'] })
    expect(parseVersion('')).toBeUndefined()
    expect(parseVersion('abc')).toBeUndefined()
    expect(parseVersion('1.2')).toBeUndefined()
    expect(parseVersion(undefined)).toBeUndefined()
  })

  it('orders prereleases below their release and rc identifiers numerically', () => {
    const versions = ['0.1.0-rc.7', '0.1.1-rc.1', '0.1.1-rc.2', '0.1.1', '0.2.0-rc.1'].map(raw => parseVersion(raw)!)
    for (let index = 1; index < versions.length; index++) {
      expect(compareVersions(versions[index - 1]!, versions[index]!)).toBe(-1)
      expect(compareVersions(versions[index]!, versions[index - 1]!)).toBe(1)
    }
    expect(compareVersions(parseVersion('0.1.1-rc.2')!, parseVersion('0.1.1-rc.2')!)).toBe(0)
  })

  it('ranks numeric prerelease identifiers below alphanumeric ones and shorter prefixes lower', () => {
    expect(compareVersions(parseVersion('1.0.0-1')!, parseVersion('1.0.0-alpha')!)).toBe(-1)
    expect(compareVersions(parseVersion('1.0.0-rc.1')!, parseVersion('1.0.0-rc.1.1')!)).toBe(-1)
  })

  it('tests ranges against candidates with ecosystem operators', () => {
    const rc1 = parseVersion('0.2.0-rc.1')!
    expect(rangeExcludes('>=0.1.0-rc.2 <0.2.0', rc1)).toBe(true)
    expect(rangeExcludes('>=0.1.0-rc.2 <0.2.0', parseVersion('0.1.1-rc.2')!)).toBe(false)
    expect(rangeExcludes('^4.0.0', parseVersion('5.0.0')!)).toBe(true)
    expect(rangeExcludes('^4.0.0', parseVersion('4.9.1')!)).toBe(false)
    // Caret fixes the leftmost non-zero component (semver's ^0.x rules).
    expect(rangeExcludes('^0.2.3', parseVersion('0.3.0')!)).toBe(true)
    expect(rangeExcludes('^0.2.3', parseVersion('0.2.9')!)).toBe(false)
    expect(rangeExcludes('^0.0.3', parseVersion('0.0.4')!)).toBe(true)
    expect(rangeExcludes('^0.0.3', parseVersion('0.0.3')!)).toBe(false)
    expect(rangeExcludes('^0.0.3', parseVersion('1.0.0')!)).toBe(true)
    // An empty disjunction branch matches everything, as in npm.
    expect(rangeExcludes('>=2.0.0 ||', parseVersion('1.0.0')!)).toBe(false)
    expect(rangeExcludes('~1.2.3', parseVersion('1.3.0')!)).toBe(true)
    expect(rangeExcludes('~1.2.3', parseVersion('1.2.9')!)).toBe(false)
    expect(rangeExcludes('1.x', parseVersion('1.9.9')!)).toBe(false)
    expect(rangeExcludes('1.x', parseVersion('2.0.0')!)).toBe(true)
    expect(rangeExcludes('*', parseVersion('9.9.9')!)).toBe(false)
    expect(rangeExcludes('>=1.0.0 <2.0.0 || ^3.0.0', parseVersion('3.5.0')!)).toBe(false)
    expect(rangeExcludes('>=1.0.0 <2.0.0 || ^3.0.0', parseVersion('2.5.0')!)).toBe(true)
    expect(rangeExcludes('workspace:*', parseVersion('1.0.0')!)).toBeUndefined()
    expect(rangeExcludes('github:owner/repo#main', parseVersion('1.0.0')!)).toBeUndefined()
  })
})

describe('pickLatestRelease', () => {
  it('takes the first non-draft entry, skipping drafts', () => {
    const payload = JSON.parse(releaseEntry()) as unknown[]
    const withDraft = [Object.assign(JSON.parse(releaseEntry())[0], { draft: true }), ...payload]
    const picked = pickLatestRelease(withDraft)
    expect(picked.release?.tag).toBe('dsh-v0.1.1-rc.2')
    expect(picked.release?.version && compareVersions(picked.release.version, parseVersion('0.1.1-rc.2')!)).toBe(0)
  })

  it('reports a cause for empty, shapeless, or all-draft payloads', () => {
    expect(pickLatestRelease([]).cause).toContain('no published release')
    expect(pickLatestRelease({}).cause).toContain('no published release')
    const draftOnly = [Object.assign(JSON.parse(releaseEntry())[0], { draft: true })]
    expect(pickLatestRelease(draftOnly).cause).toContain('no published release')
  })
})

describe('OfficialReleaseSource', () => {
  it('caches the listing inside the TTL window', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: releaseEntry() }))
    const source = new OfficialReleaseSource({}, 30)
    const first = await source.latest()
    const second = await source.latest()
    expect(first.degraded).toBeUndefined()
    expect(second.release?.tag).toBe(first.release?.tag)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('annotates rate limits and HTTP failures with stable notes', async () => {
    stubFetch(() => ({ status: 403, body: 'rate limit exceeded' }))
    const limited = await new OfficialReleaseSource({}, 30).latest()
    expect(limited.degraded).toContain('Official release check unavailable')
    expect(limited.degraded).toContain('rate limit')

    stubFetch(() => ({ status: 500, body: 'oops' }))
    const serverError = await new OfficialReleaseSource({}, 30).latest()
    expect(serverError.degraded).toContain('HTTP 500')

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network down'))))
    const networkError = await new OfficialReleaseSource({}, 30).latest()
    expect(networkError.degraded).toContain('network down')
  })

  it('reports a cause when the repository publishes no comparable release', async () => {
    stubFetch(() => ({ status: 200, body: '[]' }))
    const result = await new OfficialReleaseSource({}, 30).latest()
    expect(result.release).toBeUndefined()
    expect(result.degraded).toContain('no published release')
  })

  it('serves the stale cache once the TTL expires and the refetch fails', async () => {
    vi.useFakeTimers()
    try {
      stubFetch(() => ({ status: 200, body: releaseEntry() }))
      const source = new OfficialReleaseSource({}, 30)
      await source.latest()
      vi.setSystemTime(Date.now() + 31 * 60_000)
      stubFetch(() => ({ status: 403, body: 'rate limit' }))
      const result = await source.latest()
      expect(result.release?.tag).toBe('dsh-v0.1.1-rc.2')
      expect(result.degraded).toContain('serving cached release data')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('detectLocalVersion', () => {
  it('prefers a readable CLI probe', async () => {
    const local = await detectLocalVersion('web', () => ({ ok: true, output: '0.1.1-rc.1' }), { DSH_HOME: join(tmpdir(), 'dsh-sync-absent') })
    expect(local.source).toBe('cli')
    expect(local.raw).toBe('0.1.1-rc.1')
    expect(local.version && compareVersions(local.version, parseVersion('0.1.1-rc.1')!)).toBe(0)
  })

  it('falls back to the profile manifest when the CLI fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-sync-'))
    const manifestDir = join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(manifestDir, { recursive: true })
    await writeFile(join(manifestDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.1-rc.1' }))
    const local = await detectLocalVersion('web', () => ({ ok: false, detail: 'dsh not found on PATH' }), { DSH_HOME: home })
    expect(local.source).toBe('manifest')
    expect(local.version?.minor).toBe(1)
    expect(local.note).toBeUndefined()
  })

  it('falls through to the manifest when the CLI prints junk', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-sync-'))
    const manifestDir = join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(manifestDir, { recursive: true })
    await writeFile(join(manifestDir, 'package.json'), JSON.stringify({ version: '0.1.1-rc.2' }))
    const local = await detectLocalVersion('web', () => ({ ok: true, output: 'not-a-version' }), { DSH_HOME: home })
    expect(local.source).toBe('manifest')
  })

  it('returns an explanatory note when nothing can be detected', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-sync-'))
    const local = await detectLocalVersion('web', () => ({ ok: false, detail: 'dsh not found on PATH' }), { DSH_HOME: home })
    expect(local.version).toBeUndefined()
    expect(local.note).toContain('local DSH version unknown')
    expect(local.note).toContain('could not be read')
    expect(local.note).toContain("no @deepseek-ai/dsh version found under profile 'web'")
  })
})

describe('finding analyzers', () => {
  const release = {
    tag: 'dsh-v0.2.0-rc.1',
    name: 'v0.2.0-rc.1',
    version: parseVersion('0.2.0-rc.1')!,
    body: 'The new task_board tool ships natively. Improved memory storage backend.',
    url: 'https://example.test/release',
    publishedAt: '2026-08-21T00:00:00Z',
  }

  it('flags peer ranges that exclude the official version and skips unparseable ones', () => {
    const findings = analyzePeerConflicts([
      { pkg: 'old-plugin', peer: '@deepseek-ai/dsh-tools', range: '>=0.1.0-rc.2 <0.2.0' },
      { pkg: 'fine-plugin', peer: '@deepseek-ai/cordis', range: '>=4.0.0 <5' },
      { pkg: 'odd-plugin', peer: '@deepseek-ai/dsh-settings', range: 'workspace:*' },
    ], release)
    const exclusions = findings.filter(finding => finding.detail.includes('excludes the official'))
    expect(exclusions).toHaveLength(1)
    expect(exclusions[0]!.refs).toEqual(['old-plugin'])
    expect(findings.some(finding => finding.detail.includes('could not be interpreted'))).toBe(true)
  })

  it('matches tool names on identifier boundaries only', () => {
    const owners = new Map([['search', 'pkg-search'], ['task_board', 'pkg-board'], ['ab', 'pkg-short']])
    const decoyBody = { ...release, body: 'adds a native web_search provider' }
    expect(analyzeToolTakeovers(owners, decoyBody)).toHaveLength(0)
    const takeover = analyzeToolTakeovers(owners, release)
    expect(takeover).toHaveLength(1)
    expect(takeover[0]!.detail).toContain('`task_board` of `pkg-board`')
  })

  it('requires two shared keywords or one five-plus-character keyword', () => {
    const syncBody = { ...release, body: 'improved todo items sync handling' }
    const twoShared = analyzeCapabilityOverlaps([
      pluginRow({ name: 'dsh-todo-sync', description: 'todo list helper' }),
    ], syncBody)
    expect(twoShared).toHaveLength(1)

    const oneShortShared = analyzeCapabilityOverlaps([
      pluginRow({ name: 'dsh-noter', description: 'note keeping helper' }),
    ], syncBody)
    expect(oneShortShared).toHaveLength(0)

    const oneLongShared = analyzeCapabilityOverlaps([
      pluginRow({ name: 'dsh-memory', description: 'conversation memory' }),
    ], release)
    expect(oneLongShared).toHaveLength(1)
  })
})

describe('assembly and rendering', () => {
  const local = { raw: '0.1.1-rc.1', version: parseVersion('0.1.1-rc.1')!, source: 'cli' as const }
  const fetched = {
    release: {
      tag: 'dsh-v0.1.1-rc.2',
      name: 'v0.1.1-rc.2',
      version: parseVersion('0.1.1-rc.2')!,
      body: '* adds a native session_search tool',
      url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2',
      publishedAt: '2026-08-21T12:35:08Z',
    },
  }

  it('renders a matching one-liner for up-to-date installs', () => {
    const current = { raw: '0.1.1-rc.2', version: parseVersion('0.1.1-rc.2')!, source: 'cli' as const }
    const result = assembleSyncStatus(current, fetched)
    expect(result.status).toBe('up-to-date')
    expect(result.findings).toHaveLength(0)
    expect(result.report).toContain('### Official sync')
    expect(result.report).toContain('matches the latest official release')
  })

  it('recognizes newer local builds as ahead', () => {
    const result = assembleSyncStatus(
      { raw: '0.2.0', version: parseVersion('0.2.0')!, source: 'manifest' },
      fetched,
    )
    expect(result.status).toBe('ahead')
    expect(result.report).toContain('newer than the latest official release')
  })

  it('stays unknown when either side lacks a comparable version', () => {
    const unknownLocal = assembleSyncStatus({ note: 'local DSH version unknown (x)' }, fetched)
    expect(unknownLocal.status).toBe('unknown')
    expect(unknownLocal.report).toContain('local DSH version unknown')

    const weirdTag = assembleSyncStatus(local, {
      release: { ...fetched.release, tag: 'nightly-build', version: undefined },
    })
    expect(weirdTag.status).toBe('unknown')
    expect(weirdTag.report).toContain('not a comparable version')
  })

  it('fills the behind report with changes, findings, and notes', () => {
    const assembled = assembleSyncStatus(local, fetched)
    expect(assembled.status).toBe('behind')
    const result = appendBehindContent(assembled, {
      profile: 'web',
      releaseBody: fetched.release.body,
      installedRows: [pluginRow({ name: 'dsh-session-search', description: 'session search over logs' })],
      peers: [{ pkg: 'stale-one', peer: '@deepseek-ai/dsh-tools', range: '<0.1.1-rc.2' }],
      toolOwners: new Map([['session_search', 'stale-two']]),
      inventoryNote: 'profile web read fine',
    })
    expect(result.report).toContain('### Official sync: local DSH is behind')
    expect(result.report).toContain('0.1.1-rc.1')
    expect(result.report).toContain('See the release at https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2')
    expect(result.report).toContain('> Local inventory: profile web read fine')
    expect(result.report).toContain('**Official changes in this release**')
    expect(result.report).toContain('- [WARNING]')
    expect(result.report).toContain('excludes the official')
    expect(result.report).toContain('`session_search` of `stale-two` appears in the official dsh-v0.1.1-rc.2 release notes')
    expect(result.findings.length).toBeGreaterThanOrEqual(2)
    expect(result.releaseNotes).toContain('native session_search tool')
  })

  it('truncates oversized release bodies', () => {
    const result = appendBehindContent(assembleSyncStatus(local, fetched), {
      profile: 'web',
      releaseBody: 'x'.repeat(3000),
      installedRows: [],
      peers: [],
      toolOwners: new Map(),
    })
    expect(result.releaseNotes).toContain('(truncated)')
    expect(result.report).toContain('(truncated)')
  })

  it('caps combined findings across kinds', () => {
    const crowd = Array.from({ length: 12 }, (_, index) =>
      pluginRow({ name: `dsh-crowd-${index}`, description: 'memory storage persistence layer cache' }))
    const result = appendBehindContent(assembleSyncStatus(local, fetched), {
      profile: 'web',
      releaseBody: 'memory storage persistence layer cache improvements everywhere',
      installedRows: crowd,
      peers: [],
      toolOwners: new Map(),
    })
    expect(result.findings).toHaveLength(10)
  })

  it('renders the guard advisory only for behind statuses, capped at five bullets', () => {
    expect(renderSyncAdvisory(undefined)).toBe('')
    const upToDate = assembleSyncStatus(local, { ...fetched, release: { ...fetched.release, tag: 'dsh-v0.0.1', version: parseVersion('0.0.1')! } })
    expect(renderSyncAdvisory(upToDate)).toBe('')
    const crowd = Array.from({ length: 8 }, (_, index) =>
      pluginRow({ name: `dsh-crowd-${index}`, description: 'memory storage persistence layer cache' }))
    const behind = appendBehindContent(assembleSyncStatus(local, fetched), {
      profile: 'web',
      releaseBody: 'memory storage persistence layer cache improvements everywhere',
      installedRows: crowd,
      peers: [],
      toolOwners: new Map(),
    })
    const advisory = renderSyncAdvisory(behind)
    expect(advisory).toContain('### Official update advisory')
    expect(advisory).toContain('Advisory only')
    expect(advisory.split('\n').filter(line => line.startsWith('- '))).toHaveLength(5)
  })

  it('handles an empty release body gracefully', () => {
    const result = appendBehindContent(assembleSyncStatus(local, fetched), {
      profile: 'web',
      releaseBody: '',
      installedRows: [],
      peers: [],
      toolOwners: new Map(),
    })
    expect(result.report).toContain('(no release notes provided)')
    expect(result.releaseNotes).toBeUndefined()
    expect(result.report).toContain('No installed plugin declares peer ranges, tool names, or capabilities conflicting')
  })
})
