import { describe, expect, it } from 'vitest'
import { analyzeInstallConflicts } from '../src/install-check.ts'
import type { InstallInspection } from '../src/install-check.ts'

function inspection(ref: string, packageJson: Record<string, unknown>, patchText = ''): InstallInspection {
  return { ref, packageJson, patchText }
}

describe('analyzeInstallConflicts', () => {
  it('blocks duplicate tools and Cordis patch ownership', () => {
    const result = analyzeInstallConflicts([
      inspection('github:one/alpha', { name: 'alpha', dsh: { tools: ['shared_tool'] } }, '- insert:\n    - id: shared-row\n      name: shared-plugin\n'),
      inspection('github:two/beta', { name: 'beta', dsh: { tools: ['shared_tool'] } }, '- insert:\n    - id: shared-row\n      name: shared-plugin\n'),
    ])
    expect(result.safeToInstall).toBe(false)
    expect(result.conflicts.map(conflict => conflict.kind)).toEqual(['tool', 'patch-id', 'patch-name'])
    expect(result.report).toContain('INSTALL BLOCKED')
    expect(result.report).toContain('duplicate tool registration')
  })

  it('blocks incompatible peer dependency major versions', () => {
    const result = analyzeInstallConflicts([
      inspection('github:one/alpha', { name: 'alpha', peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' } }),
      inspection('github:two/beta', { name: 'beta', peerDependencies: { '@deepseek-ai/cordis': '^5.0.0' } }),
    ])
    expect(result.safeToInstall).toBe(false)
    expect(result.conflicts[0]).toMatchObject({ kind: 'peer-dependency', severity: 'block' })
  })

  it('reports different same-major peer ranges as a warning', () => {
    const result = analyzeInstallConflicts([
      inspection('github:one/alpha', { name: 'alpha', peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' } }),
      inspection('github:two/beta', { name: 'beta', peerDependencies: { '@deepseek-ai/cordis': '^4.2.0' } }),
    ])
    expect(result.safeToInstall).toBe(true)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]!.severity).toBe('warning')
  })

  it('blocks a repository that cannot be inspected', () => {
    const result = analyzeInstallConflicts([{ ref: 'https://example.test/plugin', error: 'unsupported repository host' }])
    expect(result.safeToInstall).toBe(false)
    expect(result.uninspected).toEqual(['https://example.test/plugin'])
    expect(result.report).toContain('could not be inspected')
  })

  it('explains how to recover from GitHub rate limiting while staying blocked', () => {
    const result = analyzeInstallConflicts([{ ref: 'github:one/alpha', error: 'package.json returned HTTP 403', errorKind: 'rate-limit' }])
    expect(result.safeToInstall).toBe(false)
    expect(result.report).toContain('githubTokenEnv')
    expect(result.report).toContain('limit reset')
  })

  it('passes independent plugins with different tools and patch rows', () => {
    const result = analyzeInstallConflicts([
      inspection('github:one/alpha', { name: 'alpha', dsh: { tools: ['alpha_tool'] } }, '- insert:\n    - id: alpha-row\n      name: alpha-plugin\n      config:\n        name: shared-config-value\n'),
      inspection('github:two/beta', { name: 'beta', dsh: { tools: ['beta_tool'] } }, '- insert:\n    - id: beta-row\n      name: beta-plugin\n      config:\n        name: shared-config-value\n'),
    ])
    expect(result.safeToInstall).toBe(true)
    expect(result.conflicts).toEqual([])
    expect(result.report).toContain('Install preflight passed')
  })
})
