/**
 * Static preflight checks for installing several DSH plugin repositories.
 * The checks are deliberately conservative: duplicate registry names, tool
 * names, Cordis patch ids/names, and incompatible peer major versions can
 * make profile composition fail before the agent gets a useful error.
 *
 * @module dsh-plugin-doctor/install-check
 */

/** Repository files fetched for one install reference. */
export interface InstallInspection {
  readonly ref: string
  readonly repo?: string
  readonly packageJson?: unknown
  readonly patchText?: string
  readonly error?: string
}

/** One conflict found while comparing install candidates. */
export interface InstallConflict {
  readonly kind: 'package' | 'tool' | 'patch-id' | 'patch-name' | 'peer-dependency' | 'inspection'
  readonly severity: 'block' | 'warning'
  readonly refs: readonly string[]
  readonly detail: string
}

/** Complete preflight result rendered by the install guard tool. */
export interface InstallCheckReport {
  readonly safeToInstall: boolean
  readonly conflicts: readonly InstallConflict[]
  readonly inspected: readonly string[]
  readonly uninspected: readonly string[]
  readonly report: string
}

interface Manifest {
  readonly name?: unknown
  readonly dsh?: { readonly tools?: unknown }
  readonly dependencies?: Record<string, unknown>
  readonly peerDependencies?: Record<string, unknown>
  readonly devDependencies?: Record<string, unknown>
}

interface PatchFields {
  readonly ids: readonly string[]
  readonly names: readonly string[]
}

/**
 * Compare inspected repositories and return only actionable conflicts.
 * @param inspections - repository metadata fetched from the supplied refs.
 */
export function analyzeInstallConflicts(inspections: readonly InstallInspection[]): InstallCheckReport {
  const conflicts: InstallConflict[] = []
  const inspected: string[] = []
  const uninspected: string[] = []
  const packageOwners = new Map<string, string[]>()
  const toolOwners = new Map<string, string[]>()
  const patchIdOwners = new Map<string, string[]>()
  const patchNameOwners = new Map<string, string[]>()
  const peerVersions = new Map<string, { ref: string; range: string }[]>()

  for (const inspection of inspections) {
    if (inspection.error !== undefined || inspection.packageJson === undefined) {
      uninspected.push(inspection.ref)
      conflicts.push({
        kind: 'inspection',
        severity: 'block',
        refs: [inspection.ref],
        detail: `${inspection.ref} could not be inspected${inspection.error === undefined ? '' : `: ${inspection.error}`}`,
      })
      continue
    }
    inspected.push(inspection.ref)
    const manifest = asManifest(inspection.packageJson)
    const packageName = typeof manifest.name === 'string' ? manifest.name : undefined
    if (packageName !== undefined) addOwner(packageOwners, packageName, inspection.ref)
    const tools = Array.isArray(manifest.dsh?.tools) ? manifest.dsh.tools.filter((tool): tool is string => typeof tool === 'string') : []
    for (const tool of tools) addOwner(toolOwners, tool, inspection.ref)
    const fields = parsePatchFields(inspection.patchText ?? '')
    for (const id of fields.ids) addOwner(patchIdOwners, id, inspection.ref)
    for (const name of fields.names) addOwner(patchNameOwners, name, inspection.ref)
    for (const [dependency, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (typeof range === 'string') {
        const versions = peerVersions.get(dependency) ?? []
        versions.push({ ref: inspection.ref, range })
        peerVersions.set(dependency, versions)
      }
    }
  }

  addDuplicateConflicts(conflicts, packageOwners, 'package', name => `both candidates resolve to package \`${name}\`; profile package identity is ambiguous`)
  addDuplicateConflicts(conflicts, toolOwners, 'tool', name => `both candidates register tool \`${name}\`; duplicate tool registration can abort tool loading`)
  addDuplicateConflicts(conflicts, patchIdOwners, 'patch-id', name => `both candidates insert Cordis row id \`${name}\`; patch composition can fail or override a plugin`)
  addDuplicateConflicts(conflicts, patchNameOwners, 'patch-name', name => `both candidates declare Cordis plugin name \`${name}\`; loader ownership is ambiguous`)

  for (const [dependency, versions] of peerVersions) {
    const majors = new Set(versions.map(entry => majorVersion(entry.range)).filter((major): major is number => major !== undefined))
    if (majors.size > 1) {
      conflicts.push({
        kind: 'peer-dependency',
        severity: 'block',
        refs: versions.map(entry => entry.ref),
        detail: `peer dependency \`${dependency}\` requires incompatible major versions (${versions.map(entry => `${entry.ref}: ${entry.range}`).join('; ')})`,
      })
    } else if (new Set(versions.map(entry => entry.range)).size > 1) {
      conflicts.push({
        kind: 'peer-dependency',
        severity: 'warning',
        refs: versions.map(entry => entry.ref),
        detail: `peer dependency \`${dependency}\` has different declared ranges (${versions.map(entry => `${entry.ref}: ${entry.range}`).join('; ')})`,
      })
    }
  }

  const blocking = conflicts.filter(conflict => conflict.severity === 'block')
  const safeToInstall = blocking.length === 0
  const lines = [
    safeToInstall ? 'Install preflight passed: no blocking cross-plugin conflicts found.' : 'INSTALL BLOCKED: resolve the conflicts below before installing these plugins.',
    '',
    `Inspected: ${inspected.length}/${inspections.length}`,
  ]
  if (conflicts.length > 0) {
    lines.push('', ...conflicts.map(conflict => `- [${conflict.severity.toUpperCase()}] ${conflict.detail} (${conflict.refs.join(', ')})`))
  }
  if (safeToInstall && inspections.length > 1) lines.push('', 'The candidates may be installed together after reviewing any warnings above.')
  return { safeToInstall, conflicts, inspected, uninspected, report: lines.join('\n') }
}

function asManifest(value: unknown): Manifest {
  return value !== null && typeof value === 'object' ? value as Manifest : {}
}

function addOwner(map: Map<string, string[]>, key: string, ref: string): void {
  const owners = map.get(key) ?? []
  if (!owners.includes(ref)) owners.push(ref)
  map.set(key, owners)
}

function addDuplicateConflicts(
  conflicts: InstallConflict[],
  owners: Map<string, string[]>,
  kind: InstallConflict['kind'],
  detail: (name: string) => string,
): void {
  for (const [name, refs] of owners) {
    if (refs.length > 1) conflicts.push({ kind, severity: 'block', refs, detail: detail(name) })
  }
}

function parsePatchFields(text: string): PatchFields {
  const ids: string[] = []
  const names: string[] = []
  let rowNameIndent: number | undefined
  for (const line of text.split(/\r?\n/)) {
    const idMatch = /^(\s*)-\s+id:\s*["']?([^"'\s#]+)["']?\s*$/.exec(line)
    if (idMatch !== null) {
      ids.push(idMatch[2]!)
      rowNameIndent = idMatch[1]!.length + 2
      continue
    }
    const nameMatch = /^(\s*)name:\s*["']?([^"'\s#]+)["']?\s*$/.exec(line)
    if (nameMatch !== null && nameMatch[1]!.length === rowNameIndent) names.push(nameMatch[2]!)
    if (line.trim().length > 0 && line.length - line.trimStart().length < (rowNameIndent ?? 0)) rowNameIndent = undefined
  }
  return { ids: [...new Set(ids)], names: [...new Set(names)] }
}

function majorVersion(range: string): number | undefined {
  const match = /(?:^|[~^=<>\s])v?(\d+)/.exec(range)
  return match === null ? undefined : Number(match[1])
}
