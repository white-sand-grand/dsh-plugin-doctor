/**
 * Local installed-plugin inventory: reads a profile's `package.json`
 * (`dsh.profile.bundles`) under `$DSH_HOME/profiles/<name>`, mirroring the
 * DSH home precedence (`$DSH_HOME` override, then `~/.dsh`). A missing or
 * unreadable profile yields an empty list plus a note — never a thrown error.
 *
 * @module dsh-plugin-recommender/inventory
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** Environment variable overriding the DSH home. */
const DSH_HOME_ENV = 'DSH_HOME';
/**
 * Resolve the DSH home the same way the harness does: `$DSH_HOME` (non-empty)
 * wins over `~/.dsh`.
 * @param env - environment mapping to read from.
 */
export function resolveDshHome(env = process.env) {
    const override = env[DSH_HOME_ENV];
    return override !== undefined && override.trim().length > 0 ? override : join(homedir(), '.dsh');
}
/**
 * Read one profile's installed plugin list from disk.
 * @param profile - profile name under the DSH home, e.g. `web`.
 * @param env - environment mapping for home resolution (tests inject here).
 */
export async function readInventory(profile, env = process.env) {
    const manifestPath = join(resolveDshHome(env), 'profiles', profile, 'package.json');
    try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const bundles = Array.isArray(manifest.dsh?.profile?.bundles)
            ? manifest.dsh.profile.bundles.filter((entry) => typeof entry === 'string')
            : [];
        const dependencies = manifest.dependencies === undefined ? [] : Object.keys(manifest.dependencies);
        // Bundles are the plugin-shaped entries; other dependencies are libraries.
        return { names: bundles.length > 0 ? bundles : dependencies };
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT')
            return { names: [], note: `profile '${profile}' has no package.json yet (no third-party plugins installed)` };
        return { names: [], note: `could not read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}` };
    }
}
/**
 * Project inventory names into {@link CommunityPlugin} rows so they share the
 * similarity vocabulary with community candidates. Text fields derive from the
 * package name; capability tags stay empty unless the caller supplies them.
 * @param names - installed plugin names.
 */
export function toPluginRows(names) {
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
        source: 'cache',
    }));
}
