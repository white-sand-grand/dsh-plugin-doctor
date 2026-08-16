/**
 * Plugin usage audit: scans DSH durable session logs (the
 * `sessions/<cwd-slug>/session-<id>/session.jsonl.zstd` JSONL persistence
 * layout under the DSH home) and aggregates real `tool/call` events per
 * tool name. Log lines are flat session events; events carry no wall clock,
 * so "last used" is the mtime of the newest log file containing the call —
 * an approximation owned here. Corrupt or torn artifacts are skipped and
 * counted, never thrown: an audit must not fail because one old log is
 * damaged. Attribution of a tool to an installed plugin uses the package
 * `dsh.tools` declaration convention (see README).
 *
 * @module dsh-plugin-doctor/usage
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

/** Per-tool usage aggregate. */
export interface ToolUsage {
  readonly tool: string
  readonly calls: number
  /** Number of distinct session logs containing a call to this tool. */
  readonly sessions: number
  /** ISO-8601 mtime of the newest log containing a call (approximation). */
  readonly lastUsed: string
}

/** Full audit outcome. */
export interface UsageAudit {
  readonly tools: readonly ToolUsage[]
  readonly sessionsScanned: number
  /** Session artifacts skipped because they were unreadable or torn. */
  readonly skipped: number
  /** Set when the sessions root is absent — no data yet, not an error. */
  readonly note?: string
}

/**
 * Marker thrown when the running Node lacks `zstdDecompress` in `node:zlib`
 * (added in Node 22.15). Resolved lazily per read, never at module load: a
 * top-level named import would make the whole plugin — and with it the dsh
 * plugin tree — fail to import on older Node (npx-launched dsh commonly runs
 * one).
 */
const ZSTD_UNSUPPORTED = 'node:zlib zstd support unavailable on this Node runtime'

/** Lazily resolved zstd decompressor; `undefined` on Node without zstd. */
let zstdDecompressAsync: ((buffer: Buffer) => Promise<Buffer>) | undefined
let zstdProbeDone = false

/**
 * Resolve the zstd decompressor once; safe on every Node version.
 * @returns the promisified decompressor, or `undefined` when unsupported.
 */
async function resolveZstd(): Promise<((buffer: Buffer) => Promise<Buffer>) | undefined> {
  if (!zstdProbeDone) {
    zstdProbeDone = true
    // A missing named export from a dynamic import is simply `undefined`;
    // only a top-level static import would throw at link time.
    const { zstdDecompress } = await import('node:zlib') as { zstdDecompress?: typeof import('node:zlib').zstdDecompress }
    zstdDecompressAsync = typeof zstdDecompress === 'function' ? promisify(zstdDecompress) : undefined
  }
  return zstdDecompressAsync
}

/** One discovered session artifact. */
interface Artifact {
  readonly path: string
  readonly compressed: boolean
  readonly mtimeMs: number
}

/**
 * Enumerate session log artifacts under a sessions root: one
 * `<cwd-slug>/session-<id>/session.jsonl.zstd` (or plain `.jsonl`) per session.
 * @param sessionsRoot - `$DSH_HOME/sessions` or a test fixture root.
 */
async function findArtifacts(sessionsRoot: string): Promise<Artifact[]> {
  const artifacts: Artifact[] = []
  let slugs: string[] = []
  try {
    slugs = (await readdir(sessionsRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return artifacts
  }
  for (const slug of slugs) {
    let sessionDirs: string[] = []
    try {
      sessionDirs = (await readdir(join(sessionsRoot, slug), { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch {
      continue
    }
    for (const sessionDir of sessionDirs) {
      for (const [name, compressed] of [['session.jsonl.zstd', true], ['session.jsonl', false]] as const) {
        const path = join(sessionsRoot, slug, sessionDir, name)
        try {
          const mtimeMs = (await stat(path)).mtimeMs
          artifacts.push({ path, compressed, mtimeMs })
        } catch {
          // This suffix doesn't exist for the session; try the other one.
        }
      }
    }
  }
  return artifacts
}

/**
 * Read one artifact's text: zstd-decompressed or plain UTF-8. Throws
 * {@link ZSTD_UNSUPPORTED} for compressed artifacts on Node runtimes
 * without `node:zlib` zstd support.
 * @param artifact - the artifact to read.
 * @returns decoded text lines.
 */
async function readArtifact(artifact: Artifact): Promise<string> {
  if (!artifact.compressed) return readFile(artifact.path, 'utf8')
  const decompress = await resolveZstd()
  if (decompress === undefined) throw new Error(ZSTD_UNSUPPORTED)
  return (await decompress(await readFile(artifact.path))).toString('utf8')
}

/**
 * Aggregate `tool/call` events across every session log under the root.
 * @param sessionsRoot - `$DSH_HOME/sessions` or a test fixture root.
 */
export async function auditToolUsage(sessionsRoot: string): Promise<UsageAudit> {
  const artifacts = await findArtifacts(sessionsRoot)
  if (artifacts.length === 0) {
    return { tools: [], sessionsScanned: 0, skipped: 0, note: 'no session logs found yet — usage data accumulates as you use DSH' }
  }
  const calls = new Map<string, { count: number; sessions: number; lastMtime: number }>()
  let scanned = 0
  let skipped = 0
  let zstdUnsupported = 0
  for (const artifact of artifacts) {
    let text: string
    try {
      text = await readArtifact(artifact)
    } catch (error) {
      if (error instanceof Error && error.message === ZSTD_UNSUPPORTED) zstdUnsupported++
      skipped++
      continue
    }
    scanned++
    const seen = new Set<string>()
    for (const line of text.split('\n')) {
      if (!line.includes('"tool/call"')) continue
      try {
        const event = JSON.parse(line) as { type?: string; name?: string }
        if (event.type !== 'tool/call' || typeof event.name !== 'string') continue
        const entry = calls.get(event.name) ?? { count: 0, sessions: 0, lastMtime: 0 }
        entry.count++
        entry.lastMtime = Math.max(entry.lastMtime, artifact.mtimeMs)
        if (!seen.has(event.name)) {
          seen.add(event.name)
          entry.sessions++
        }
        calls.set(event.name, entry)
      } catch {
        // A malformed line inside an otherwise readable log doesn't invalidate
        // the rest of the audit.
      }
    }
  }
  const tools: ToolUsage[] = [...calls.entries()]
    .map(([tool, entry]) => ({ tool, calls: entry.count, sessions: entry.sessions, lastUsed: new Date(entry.lastMtime).toISOString() }))
    .sort((x, y) => y.calls - x.calls || x.tool.localeCompare(y.tool))
  const note = zstdUnsupported > 0
    ? `${zstdUnsupported} zstd-compressed session log${zstdUnsupported === 1 ? '' : 's'} skipped: this Node runtime lacks node:zlib zstd support (Node ≥22.15 enables usage data)`
    : undefined
  return { tools, sessionsScanned: scanned, skipped, ...(note === undefined ? {} : { note }) }
}

/**
 * Build a tool-name → package-name map for installed plugins that declare
 * their tools via the `dsh.tools` field in package.json. Plugins without the
 * declaration simply don't participate in attribution (their tools read as
 * unattributed, not as unused).
 * @param profileDir - the profile directory whose node_modules holds installs.
 * @param installed - installed plugin package names.
 */
export async function pluginToolMap(profileDir: string, installed: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const name of installed) {
    try {
      const manifest = JSON.parse(await readFile(join(profileDir, 'node_modules', name, 'package.json'), 'utf8')) as {
        dsh?: { tools?: unknown }
      }
      const tools = Array.isArray(manifest.dsh?.tools)
        ? manifest.dsh!.tools.filter((tool): tool is string => typeof tool === 'string')
        : []
      for (const tool of tools) map.set(tool, name)
    } catch {
      // Unreadable manifests leave that plugin's tools unattributed.
    }
  }
  return map
}
