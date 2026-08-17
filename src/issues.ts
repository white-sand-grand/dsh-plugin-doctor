/** Official GitHub issue lookup used before plugin installation decisions. */

import { fetchJson } from './http.ts'
import type { HttpDeps } from './http.ts'

/** One open issue that may explain an installation risk. */
export interface OfficialIssue {
  readonly repo: string
  readonly title: string
  readonly url: string
  readonly updatedAt: string
  readonly matches: readonly string[]
}

interface GitHubIssue {
  title?: unknown
  html_url?: unknown
  body?: unknown
  updated_at?: unknown
  pull_request?: unknown
}

/** Search open issues in the supplied official repositories. */
export async function searchOfficialIssues(
  deps: HttpDeps,
  refs: readonly string[],
  intent: string,
  signal: AbortSignal | undefined,
): Promise<{ issues: readonly OfficialIssue[]; degraded?: string }> {
  const repositories = [...new Set(refs.map(normalizeRepo).filter((repo): repo is string => repo !== undefined))]
  const terms = [...new Set([
    ...tokens(intent),
    ...repositories.flatMap(repo => tokens(repo.split('/')[1] ?? repo)),
  ])]
  const issues: OfficialIssue[] = []
  const failures: string[] = []
  for (const repo of repositories) {
    try {
      const payload = await fetchJson(deps, `https://api.github.com/repos/${repo}/issues?state=open&per_page=30&sort=updated`, signal)
      if (!Array.isArray(payload)) continue
      for (const item of payload as GitHubIssue[]) {
        if (item.pull_request !== undefined || typeof item.title !== 'string' || typeof item.html_url !== 'string') continue
        const haystack = `${repo} ${item.title} ${typeof item.body === 'string' ? item.body : ''}`.toLowerCase()
        const matches = terms.filter(term => haystack.includes(term))
        if (matches.length === 0 && terms.length > 0) continue
        issues.push({
          repo,
          title: item.title,
          url: item.html_url,
          updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
          matches: [...new Set(matches)],
        })
      }
    } catch (error) {
      failures.push(`${repo}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  issues.sort((a, b) => b.matches.length - a.matches.length || b.updatedAt.localeCompare(a.updatedAt))
  const degraded = failures.length === 0 ? undefined : `Official GitHub issues could not be checked for ${failures.length} repository${failures.length === 1 ? '' : 'ies'}; installation can continue, but review may be incomplete.`
  return { issues: issues.slice(0, 8), ...(degraded === undefined ? {} : { degraded }) }
}

function normalizeRepo(ref: string): string | undefined {
  const trimmed = ref.trim().replace(/^github:/, '').replace(/\.git$/, '')
  const url = /^https?:\/\/github\.com\/([^/]+\/[^/#?]+)(?:[/?#].*)?$/i.exec(trimmed)?.[1]
  return url ?? (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : undefined)
}

function tokens(input: string): string[] {
  return [...new Set(input.toLowerCase().split(/[^a-z0-9+#-]+/).flatMap(token => token.split('-')).filter(token => token.length > 2 && !new Set(['the', 'and', 'for', 'plugin', 'need', 'want', 'with', 'dsh']).has(token)))]
}
