/**
 * Local installed-plugin inventory: reads a profile's `package.json`
 * (`dsh.profile.bundles`) under `$DSH_HOME/profiles/<name>`, mirroring the
 * DSH home precedence (`$DSH_HOME` override, then `~/.dsh`). A missing or
 * unreadable profile yields an empty list plus a note — never a thrown error.
 *
 * @module dsh-plugin-doctor/inventory
 */
import type { CommunityPlugin } from './types.ts';
/**
 * Resolve the DSH home the same way the harness does: `$DSH_HOME` (non-empty)
 * wins over `~/.dsh`.
 * @param env - environment mapping to read from.
 */
export declare function resolveDshHome(env?: Record<string, string | undefined>): string;
/** Result of reading the local inventory. */
export interface Inventory {
    /** Installed bundle/package names; empty when nothing is installed or the profile is absent. */
    readonly names: readonly string[];
    /** Explanation when the list could not be read; `undefined` on success. */
    readonly note?: string;
}
/**
 * Read one profile's installed plugin list from disk.
 * @param profile - profile name under the DSH home, e.g. `web`.
 * @param env - environment mapping for home resolution (tests inject here).
 */
export declare function readInventory(profile: string, env?: Record<string, string | undefined>): Promise<Inventory>;
/**
 * Project inventory names into {@link CommunityPlugin} rows so they share the
 * similarity vocabulary with community candidates. Text fields derive from the
 * package name; capability tags stay empty unless the caller supplies them.
 * @param names - installed plugin names.
 */
export declare function toPluginRows(names: readonly string[]): CommunityPlugin[];
/**
 * Read installed package metadata for relation-graph labels and similarity.
 * Missing manifests fall back to the name-only inventory row.
 * @param profile - profile whose node_modules tree owns the packages.
 * @param names - installed bundle/package names.
 */
export declare function readPluginRows(profile: string, names: readonly string[], env?: Record<string, string | undefined>): Promise<CommunityPlugin[]>;
/** One installed package's peer-dependency range for one dependency. */
export interface PeerDependencyRow {
    readonly pkg: string;
    readonly peer: string;
    readonly range: string;
}
/**
 * Read every installed package's `peerDependencies` ranges — the values the
 * row readers discard. Unreadable manifests contribute nothing.
 * @param profile - profile whose node_modules tree owns the packages.
 * @param names - installed bundle/package names.
 * @param env - environment mapping for home resolution (tests inject here).
 */
export declare function readPeerDependencies(profile: string, names: readonly string[], env?: Record<string, string | undefined>): Promise<PeerDependencyRow[]>;
/** Read top-level installs and DSH plugin-shaped dependencies from aggregates. */
export declare function readRecommendRows(profile: string, names: readonly string[], env?: Record<string, string | undefined>): Promise<CommunityPlugin[]>;
