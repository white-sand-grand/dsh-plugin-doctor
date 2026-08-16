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
