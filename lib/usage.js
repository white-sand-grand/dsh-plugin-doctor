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
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';
const zstdDecompressAsync = promisify(zstdDecompress);
/**
 * Enumerate session log artifacts under a sessions root: one
 * `<cwd-slug>/session-<id>/session.jsonl.zstd` (or plain `.jsonl`) per session.
 * @param sessionsRoot - `$DSH_HOME/sessions` or a test fixture root.
 */
async function findArtifacts(sessionsRoot) {
    const artifacts = [];
    let slugs = [];
    try {
        slugs = (await readdir(sessionsRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    }
    catch {
        return artifacts;
    }
    for (const slug of slugs) {
        let sessionDirs = [];
        try {
            sessionDirs = (await readdir(join(sessionsRoot, slug), { withFileTypes: true }))
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name);
        }
        catch {
            continue;
        }
        for (const sessionDir of sessionDirs) {
            for (const [name, compressed] of [['session.jsonl.zstd', true], ['session.jsonl', false]]) {
                const path = join(sessionsRoot, slug, sessionDir, name);
                try {
                    const mtimeMs = (await stat(path)).mtimeMs;
                    artifacts.push({ path, compressed, mtimeMs });
                }
                catch {
                    // This suffix doesn't exist for the session; try the other one.
                }
            }
        }
    }
    return artifacts;
}
/**
 * Read one artifact's text: zstd-decompressed or plain UTF-8.
 * @param artifact - the artifact to read.
 * @returns decoded text lines.
 */
async function readArtifact(artifact) {
    if (!artifact.compressed)
        return readFile(artifact.path, 'utf8');
    return (await zstdDecompressAsync(await readFile(artifact.path))).toString('utf8');
}
/**
 * Aggregate `tool/call` events across every session log under the root.
 * @param sessionsRoot - `$DSH_HOME/sessions` or a test fixture root.
 */
export async function auditToolUsage(sessionsRoot) {
    const artifacts = await findArtifacts(sessionsRoot);
    if (artifacts.length === 0) {
        return { tools: [], sessionsScanned: 0, skipped: 0, note: 'no session logs found yet — usage data accumulates as you use DSH' };
    }
    const calls = new Map();
    let scanned = 0;
    let skipped = 0;
    for (const artifact of artifacts) {
        let text;
        try {
            text = await readArtifact(artifact);
        }
        catch {
            skipped++;
            continue;
        }
        scanned++;
        const seen = new Set();
        for (const line of text.split('\n')) {
            if (!line.includes('"tool/call"'))
                continue;
            try {
                const event = JSON.parse(line);
                if (event.type !== 'tool/call' || typeof event.name !== 'string')
                    continue;
                const entry = calls.get(event.name) ?? { count: 0, sessions: 0, lastMtime: 0 };
                entry.count++;
                entry.lastMtime = Math.max(entry.lastMtime, artifact.mtimeMs);
                if (!seen.has(event.name)) {
                    seen.add(event.name);
                    entry.sessions++;
                }
                calls.set(event.name, entry);
            }
            catch {
                // A malformed line inside an otherwise readable log doesn't invalidate
                // the rest of the audit.
            }
        }
    }
    const tools = [...calls.entries()]
        .map(([tool, entry]) => ({ tool, calls: entry.count, sessions: entry.sessions, lastUsed: new Date(entry.lastMtime).toISOString() }))
        .sort((x, y) => y.calls - x.calls || x.tool.localeCompare(y.tool));
    return { tools, sessionsScanned: scanned, skipped };
}
/**
 * Build a tool-name → package-name map for installed plugins that declare
 * their tools via the `dsh.tools` field in package.json. Plugins without the
 * declaration simply don't participate in attribution (their tools read as
 * unattributed, not as unused).
 * @param profileDir - the profile directory whose node_modules holds installs.
 * @param installed - installed plugin package names.
 */
export async function pluginToolMap(profileDir, installed) {
    const map = new Map();
    for (const name of installed) {
        try {
            const manifest = JSON.parse(await readFile(join(profileDir, 'node_modules', name, 'package.json'), 'utf8'));
            const tools = Array.isArray(manifest.dsh?.tools)
                ? manifest.dsh.tools.filter((tool) => typeof tool === 'string')
                : [];
            for (const tool of tools)
                map.set(tool, name);
        }
        catch {
            // Unreadable manifests leave that plugin's tools unattributed.
        }
    }
    return map;
}
