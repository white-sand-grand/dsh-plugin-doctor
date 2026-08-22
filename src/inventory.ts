/**
 * Local installed-plugin inventory: reads a profile's `package.json`
 * (`dsh.profile.bundles`) under `$DSH_HOME/profiles/<name>`, mirroring the
 * DSH home precedence (`$DSH_HOME` override, then `~/.dsh`). A missing or
 * unreadable profile yields an empty list plus a note — never a thrown error.
 *
 * @module dsh-plugin-doctor/inventory
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CommunityPlugin } from './types.ts'

/** Environment variable overriding the DSH home. */
const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Resolve the DSH home the same way the harness does: `$DSH_HOME` (non-empty)
 * wins over `~/.dsh`.
 * @param env - environment mapping to read from.
 */
export function resolveDshHome(env: Record<string, string | undefined> = process.env): string {
  const override = env[DSH_HOME_ENV]
  return override !== undefined && override.trim().length > 0 ? override : join(homedir(), '.dsh')
}

/** Result of reading the local inventory. */
export interface Inventory {
  /** Installed bundle/package names; empty when nothing is installed or the profile is absent. */
  readonly names: readonly string[]
  /** Explanation when the list could not be read; `undefined` on success. */
  readonly note?: string
}

/**
 * Read one profile's installed plugin list from disk.
 * @param profile - profile name under the DSH home, e.g. `web`.
 * @param env - environment mapping for home resolution (tests inject here).
 */
export async function readInventory(
  profile: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Inventory> {
  const manifestPath = join(resolveDshHome(env), 'profiles', profile, 'package.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
      dependencies?: Record<string, unknown>
    }
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles)
      ? manifest.dsh!.profile!.bundles.filter((entry): entry is string => typeof entry === 'string')
      : []
    const dependencies = manifest.dependencies === undefined ? [] : Object.keys(manifest.dependencies)
    // Bundles are the plugin-shaped entries; other dependencies are libraries.
    return { names: bundles.length > 0 ? bundles : dependencies }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { names: [], note: `profile '${profile}' has no package.json yet (no third-party plugins installed)` }
    return { names: [], note: `could not read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Project inventory names into {@link CommunityPlugin} rows so they share the
 * similarity vocabulary with community candidates. Text fields derive from the
 * package name; capability tags stay empty unless the caller supplies them.
 * @param names - installed plugin names.
 */
export function toPluginRows(names: readonly string[]): CommunityPlugin[] {
  return names.map(name => ({
    name,
    repo: name,
    installRef: name,
    description: '',
    readmeExcerpt: '',
    capabilities: [],
    dependencies: [],
    stars: 0,
    updatedAt: '',
    source: 'cache' as const,
  }))
}

/**
 * Read installed package metadata for relation-graph labels and similarity.
 * Missing manifests fall back to the name-only inventory row.
 * @param profile - profile whose node_modules tree owns the packages.
 * @param names - installed bundle/package names.
 */
export async function readPluginRows(
  profile: string,
  names: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<CommunityPlugin[]> {
  const profileRoot = join(resolveDshHome(env), 'profiles', profile)
  return await Promise.all(names.map(async (name) => {
    const fallback = toPluginRows([name])[0]!
    try {
      const manifest = JSON.parse(await readFile(join(profileRoot, 'node_modules', name, 'package.json'), 'utf8')) as {
        description?: unknown
        keywords?: unknown
        dependencies?: Record<string, unknown>
        peerDependencies?: Record<string, unknown>
      }
      return {
        ...fallback,
        description: typeof manifest.description === 'string' ? manifest.description : '',
        capabilities: Array.isArray(manifest.keywords)
          ? manifest.keywords.filter((value): value is string => typeof value === 'string')
          : [],
        dependencies: [...new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.peerDependencies ?? {}),
        ])],
      }
    } catch {
      return fallback
    }
  }))
}

/** One installed package's peer-dependency range for one dependency. */
export interface PeerDependencyRow {
  readonly pkg: string
  readonly peer: string
  readonly range: string
}

/**
 * Read every installed package's `peerDependencies` ranges — the values the
 * row readers discard. Unreadable manifests contribute nothing.
 * @param profile - profile whose node_modules tree owns the packages.
 * @param names - installed bundle/package names.
 * @param env - environment mapping for home resolution (tests inject here).
 */
export async function readPeerDependencies(
  profile: string,
  names: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<PeerDependencyRow[]> {
  const profileRoot = join(resolveDshHome(env), 'profiles', profile)
  const perPackage = await Promise.all(names.map(async (name) => {
    try {
      const manifest = JSON.parse(await readFile(join(profileRoot, 'node_modules', name, 'package.json'), 'utf8')) as {
        peerDependencies?: Record<string, unknown>
      }
      return Object.entries(manifest.peerDependencies ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([peer, range]) => ({ pkg: name, peer, range }))
    } catch {
      // Absent or unreadable manifest contributes no peer rows.
      return []
    }
  }))
  return perPackage.flat()
}

/** Read top-level installs and DSH plugin-shaped dependencies from aggregates. */
export async function readRecommendRows(
  profile: string,
  names: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<CommunityPlugin[]> {
  const root = join(resolveDshHome(env), 'profiles', profile, 'node_modules')
  const rows = new Map<string, CommunityPlugin>()
  const providedBy = new Map<string, string>()
  const queue = [...names]
  while (queue.length > 0) {
    const name = queue.shift()!
    if (rows.has(name)) continue
    const fallback = toPluginRows([name])[0]!
    try {
      const manifest = JSON.parse(await readFile(join(root, name, 'package.json'), 'utf8')) as {
        description?: unknown; keywords?: unknown; dependencies?: Record<string, unknown>; peerDependencies?: Record<string, unknown>; dsh?: unknown
      }
      const dependencyNames = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]
      const pluginDeps = dependencyNames.filter(dep => dep.includes('dsh-') || dep.startsWith('@deepseek-ai/dsh-') || dep.startsWith('@linxin666/dsh-'))
      for (const dep of pluginDeps) {
        if (!providedBy.has(dep)) providedBy.set(dep, name)
        queue.push(dep)
      }
      rows.set(name, { ...fallback, description: typeof manifest.description === 'string' ? manifest.description : '', capabilities: Array.isArray(manifest.keywords) ? manifest.keywords.filter((value): value is string => typeof value === 'string') : [], dependencies: dependencyNames })
    } catch {
      rows.set(name, fallback)
    }
  }
  return [...rows.values()].map(row => {
    const owner = providedBy.get(row.name)
    return owner === undefined ? row : { ...row, providedBy: owner }
  })
}
