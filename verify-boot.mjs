/**
 * Runtime smoke check for development: mounts the built plugin on a real
 * Cordis Context with the published ToolRuntime and executes
 * `plugin_install_guard`, `plugin_usage_audit`, `plugin_official_sync`, and
 * `plugin_recommend` end-to-end — registration, argument validation,
 * execution, and output rendering.
 *
 * Run from the package root after `pnpm run build`: `node verify-boot.mjs`
 * @module dsh-plugin-doctor/verify-boot
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from './lib/index.js'

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(plugin, {})

const registered = ctx.tools.schemas().map(tool => tool.name)
const expected = ['plugin_community_search', 'plugin_similarity_analyze', 'plugin_recommend', 'plugin_install_guard', 'plugin_usage_audit', 'plugin_landscape', 'plugin_official_sync']
const missing = expected.filter(name => !registered.includes(name))
if (missing.length > 0) {
  console.error('MISSING TOOLS:', missing, '— registered:', registered)
  process.exit(1)
}
console.log('OK: all seven tools registered:', expected.join(', '))

const promptAssembly = await ctx.systemPrompt.assemble()
const guardGuidance = promptAssembly.sections.find(section => section.name === 'tool:plugin-install-guard')?.text ?? ''
if (!guardGuidance.includes('Before installing two or more') || !guardGuidance.includes('safeToInstall: true')) {
  console.error('FAIL: plugin_install_guard prompt guidance is missing')
  process.exit(1)
}
console.log('OK: plugin_install_guard preflight guidance registered')

const graphGuidance = promptAssembly.sections.find(section => section.name === 'tool:plugin-relation-graph')?.text ?? ''
if (!graphGuidance.includes('plugin_landscape') || !graphGuidance.includes('Chinese function explanation')) {
  console.error('FAIL: plugin relation graph prompt guidance is missing')
  process.exit(1)
}
console.log('OK: plugin relation graph guidance registered')

const issueGuidance = promptAssembly.sections.find(section => section.name === 'tool:plugin-official-issues')?.text ?? ''
if (!issueGuidance.includes('official GitHub') || !issueGuidance.includes('current session')) {
  console.error('FAIL: official issue guidance is missing')
  process.exit(1)
}
console.log('OK: official issue safety guidance registered')

const syncGuidance = promptAssembly.sections.find(section => section.name === 'tool:plugin-official-sync')?.text ?? ''
if (!syncGuidance.includes('plugin_official_sync') || !syncGuidance.includes('advisory')) {
  console.error('FAIL: official sync guidance is missing')
  process.exit(1)
}
console.log('OK: official sync guidance registered')

globalThis.fetch = async input => {
  const url = String(input)
  if (url.includes('/repos/deepseek-ai/deepseek-harness/releases')) {
    // Deliberately newer than any real install so the smoke run exercises the
    // behind path; the assertion below anchors only on the marker common to
    // every outcome, keeping this deterministic on machines without dsh.
    return new Response(JSON.stringify([{
      tag_name: 'dsh-v9.9.9-rc.1',
      name: 'v9.9.9-rc.1',
      draft: false,
      prerelease: true,
      published_at: '2026-01-01T00:00:00Z',
      html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v9.9.9-rc.1',
      body: 'Improvements\n* adds a native example_tool',
    }]), { status: 200 })
  }
  if (url.includes('/repos/one/alpha') || url.includes('/repos/two/beta')) {
    return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 })
  }
  if (url.includes('raw.githubusercontent.com') && url.endsWith('/package.json')) {
    const name = url.includes('/one/alpha/') ? 'alpha' : 'beta'
    return new Response(JSON.stringify({ name, dsh: { tools: ['shared_tool'] } }), { status: 200 })
  }
  if (url.includes('raw.githubusercontent.com') && url.endsWith('/cordis.patch.yml')) {
    return new Response('- insert:\n    - id: shared-row\n      name: shared-plugin\n', { status: 200 })
  }
  return new Response('not found', { status: 404 })
}

const guardExecution = await ctx.tools.execute({
  signal: AbortSignal.timeout(30_000),
  callId: 'verify-install-guard',
  name: 'plugin_install_guard',
  arguments: { refs: ['github:one/alpha', 'https://github.com/two/beta'] },
})
const guardReport = guardExecution.content?.map(block => block.text ?? '').join('\n') ?? ''
console.log(`OK: plugin_install_guard executed (isError=${guardExecution.isError})`)
if (guardExecution.isError || !guardReport.includes('INSTALL BLOCKED')) {
  console.error('FAIL: plugin_install_guard did not block the mocked conflict')
  process.exit(1)
}

const auditExecution = await ctx.tools.execute({
  signal: AbortSignal.timeout(30_000),
  callId: 'verify-audit',
  name: 'plugin_usage_audit',
  arguments: {},
})
console.log(`OK: plugin_usage_audit executed (isError=${auditExecution.isError})`)
if (auditExecution.isError) {
  console.error(auditExecution.content?.map(block => block.text ?? '').join('\n') ?? '(no error detail)')
  console.error('FAIL: plugin_usage_audit errored')
  process.exit(1)
}

const syncExecution = await ctx.tools.execute({
  signal: AbortSignal.timeout(30_000),
  callId: 'verify-official-sync',
  name: 'plugin_official_sync',
  arguments: {},
})
const syncReport = syncExecution.content?.map(block => block.text ?? '').join('\n') ?? ''
console.log(`OK: plugin_official_sync executed (isError=${syncExecution.isError})`)
console.log(syncReport.split('\n').slice(0, 4).join(' | '))
if (syncExecution.isError || !syncReport.includes('Official sync')) {
  console.error('FAIL: plugin_official_sync did not produce a sync report')
  process.exit(1)
}

const execution = await ctx.tools.execute({
  signal: AbortSignal.timeout(60_000),
  callId: 'verify-1',
  name: 'plugin_recommend',
  arguments: { intent: 'I need a plugin that remembers conversation memory' },
})
const report = execution.content?.map(block => block.text ?? '').join('\n') ?? ''
console.log(`OK: plugin_recommend executed (isError=${execution.isError})`)
console.log(report.split('\n').slice(0, 4).join(' | '))
if (execution.isError || report.length === 0) {
  console.error('FAIL: plugin_recommend did not produce a report')
  process.exit(1)
}
console.log('OK: smoke check passed')
process.exit(0)
