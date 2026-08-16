/**
 * Runtime smoke check for development: mounts the built plugin on a real
 * Cordis Context with the published ToolRuntime and executes
 * `plugin_recommend` end-to-end — registration, argument validation,
 * execution (live GitHub, degraded if unreachable), and output rendering.
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
const expected = ['plugin_community_search', 'plugin_similarity_analyze', 'plugin_recommend', 'plugin_usage_audit', 'plugin_landscape']
const missing = expected.filter(name => !registered.includes(name))
if (missing.length > 0) {
  console.error('MISSING TOOLS:', missing, '— registered:', registered)
  process.exit(1)
}
console.log('OK: all five tools registered:', expected.join(', '))

const auditExecution = await ctx.tools.execute({
  signal: AbortSignal.timeout(30_000),
  callId: 'verify-audit',
  name: 'plugin_usage_audit',
  arguments: {},
})
console.log(`OK: plugin_usage_audit executed (isError=${auditExecution.isError})`)
if (auditExecution.isError) {
  console.error('FAIL: plugin_usage_audit errored')
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
