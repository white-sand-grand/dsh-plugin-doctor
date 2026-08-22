/**
 * Official release sync: compares the locally installed DSH version with the
 * latest published release of the official harness repository and, when the
 * local install is older, reports which installed plugins the new release may
 * duplicate or conflict with. Every failure degrades into a note — never a
 * thrown error — and every finding is advisory.
 *
 * @module dsh-plugin-doctor/official-sync
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchJson } from "./http.js";
import { resolveDshHome } from "./inventory.js";
/** The official harness repository whose releases anchor the comparison. */
export const OFFICIAL_REPO = 'deepseek-ai/deepseek-harness';
/** Process-lifetime cache lifetime for the releases listing, in minutes. */
export const RELEASES_TTL_MINUTES = 30;
/** Release-notes characters rendered before truncation. */
export const RELEASE_BODY_CHARS = 2000;
/** Maximum findings rendered across all kinds. */
export const SYNC_FINDINGS_CAP = 10;
/** Maximum finding bullets in the install-guard advisory. */
export const SYNC_ADVISORY_BULLETS = 5;
/**
 * Parse a version string, tolerating the official tag (`dsh-v0.1.1-rc.2`),
 * release-name (`v0.1.1-rc.2`), CLI-output, and manifest spellings.
 * @param raw - raw version text; anything unparseable yields `undefined`.
 */
export function parseVersion(raw) {
    if (raw === undefined || raw === null)
        return undefined;
    const trimmed = raw.trim().replace(/^dsh-v/i, '').replace(/^v/i, '');
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(trimmed);
    if (match === null)
        return undefined;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] === undefined ? [] : match[4].split('.'),
    };
}
/**
 * Compare two versions per semver precedence: numeric fields first, then a
 * release outranks its prereleases, then prerelease identifiers pairwise
 * (numeric below alphanumeric, numeric identifiers compared numerically).
 * @param a - left-hand version.
 * @param b - right-hand version.
 * @returns negative when `a` ranks below `b`, zero when equal, positive otherwise.
 */
export function compareVersions(a, b) {
    for (const [x, y] of [[a.major, b.major], [a.minor, b.minor], [a.patch, b.patch]]) {
        if (x !== y)
            return x < y ? -1 : 1;
    }
    if (a.prerelease.length === 0 || b.prerelease.length === 0) {
        return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
    }
    const shared = Math.min(a.prerelease.length, b.prerelease.length);
    for (let index = 0; index < shared; index++) {
        const order = comparePrereleaseIdentifier(a.prerelease[index], b.prerelease[index]);
        if (order !== 0)
            return order;
    }
    return a.prerelease.length < b.prerelease.length ? -1 : a.prerelease.length > b.prerelease.length ? 1 : 0;
}
function comparePrereleaseIdentifier(a, b) {
    const numA = /^\d+$/.test(a) ? Number(a) : undefined;
    const numB = /^\d+$/.test(b) ? Number(b) : undefined;
    if (numA !== undefined && numB !== undefined)
        return numA < numB ? -1 : numA > numB ? 1 : 0;
    if (numA !== undefined)
        return -1;
    if (numB !== undefined)
        return 1;
    return a < b ? -1 : a > b ? 1 : 0;
}
/** Normalized rendering used in reports (`0.1.1-rc.2`). */
export function formatVersion(version) {
    return `${version.major}.${version.minor}.${version.patch}${version.prerelease.length > 0 ? `-${version.prerelease.join('.')}` : ''}`;
}
const WILDCARD_PARTS = new Set(['x', 'X', '*']);
/**
 * Whether a dependency range excludes the candidate version. Supports the
 * operators the ecosystem actually declares — `<`, `<=`, `>`, `>=`, `^`, `~`,
 * exact versions, wildcard partials (`1.x`), and `||` alternatives. An
 * exclusive cap (`<M.m.p`) additionally rejects prereleases of that exact
 * tuple. Deliberately omitted: node-semver's general prerelease gate, which
 * would reject every rc candidate against ranges like `>=0.1.0-rc.2 <0.2.0`
 * and flag this all-prerelease ecosystem on every release; the cap rule keeps
 * the one case where that leniency clearly misleads. Ranges outside the
 * supported subset (git URLs, `workspace:*`, hyphen ranges) yield `undefined`;
 * callers count them as skipped instead of guessing.
 * @param range - npm-style range string.
 * @param candidate - the candidate version to test.
 */
export function rangeExcludes(range, candidate) {
    const trimmed = range.trim();
    if (trimmed.length === 0 || trimmed === '*' || trimmed === 'x')
        return false;
    let sawEmptyClause = false;
    for (const clauseText of trimmed.split('||')) {
        const tokens = clauseText.trim().split(/\s+/).filter(token => token.length > 0);
        if (tokens.length === 0) {
            // An empty disjunction branch matches everything, as in npm.
            sawEmptyClause = true;
            continue;
        }
        let clauseSatisfied = true;
        for (const token of tokens) {
            const satisfied = tokenSatisfies(token, candidate);
            if (satisfied === undefined)
                return undefined;
            if (!satisfied)
                clauseSatisfied = false;
        }
        if (clauseSatisfied)
            return false;
    }
    return sawEmptyClause ? false : true;
}
function tokenSatisfies(token, candidate) {
    const match = /^(<=|>=|<|>|~|\^)?\s*(.+)$/.exec(token);
    if (match === null)
        return undefined;
    const op = match[1] ?? '';
    const spec = match[2].trim();
    if (op === '^' || op === '~') {
        const bound = parseVersion(spec.replace(/[xX*]/g, '0'));
        if (bound === undefined)
            return undefined;
        if (compareVersions(candidate, bound) < 0)
            return false;
        if (op === '~')
            return candidate.major === bound.major && candidate.minor === bound.minor;
        // Caret fixes the leftmost non-zero component (semver's ^0.x rules).
        if (bound.major > 0)
            return candidate.major === bound.major;
        if (bound.minor > 0)
            return candidate.minor === bound.minor;
        return candidate.patch === bound.patch;
    }
    if (op === '<' || op === '<=' || op === '>' || op === '>=') {
        const bound = parseVersion(spec.replace(/[xX*]/g, '0'));
        if (bound === undefined)
            return undefined;
        // `<M.m.p` caps the whole M.m.p line: a prerelease of that exact tuple
        // (e.g. 0.2.0-rc.1 under <0.2.0) is excluded even though it orders below.
        if (op === '<' && candidate.prerelease.length > 0 && bound.prerelease.length === 0
            && candidate.major === bound.major && candidate.minor === bound.minor && candidate.patch === bound.patch) {
            return false;
        }
        const order = compareVersions(candidate, bound);
        return op === '<' ? order < 0 : op === '<=' ? order <= 0 : order > 0;
    }
    const parts = spec.split('.');
    if (parts.some(part => WILDCARD_PARTS.has(part))) {
        // Wildcard partials (`1.x`, `1.2.*`) carry no prerelease; pad to a triple.
        const normalized = parts.map(part => (WILDCARD_PARTS.has(part) ? '0' : part));
        if (!normalized.every(part => /^\d+$/.test(part)))
            return undefined;
        while (normalized.length < 3)
            normalized.push('0');
        const bound = parseVersion(normalized.join('.'));
        if (bound === undefined)
            return undefined;
        const precision = parts.findIndex(part => WILDCARD_PARTS.has(part));
        return precision === 1 ? candidate.major === bound.major : candidate.major === bound.major && candidate.minor === bound.minor;
    }
    const bound = parseVersion(spec);
    if (bound === undefined)
        return undefined;
    return compareVersions(candidate, bound) === 0;
}
/**
 * Pick the release to compare against: the first non-draft entry of the
 * listing (GitHub orders newest first). All-prerelease repositories have no
 * `/releases/latest`, so the list endpoint is authoritative.
 * @param payload - decoded `/releases` response body.
 * @returns the picked release, or a human-readable cause when none qualifies.
 */
export function pickLatestRelease(payload) {
    const cause = 'no published release found in the official repository';
    if (!Array.isArray(payload))
        return { cause };
    for (const item of payload) {
        if (item === null || typeof item !== 'object')
            continue;
        const entry = item;
        if (typeof entry.tag_name !== 'string' || entry.draft === true)
            continue;
        return {
            release: {
                tag: entry.tag_name,
                name: typeof entry.name === 'string' ? entry.name : entry.tag_name,
                version: parseVersion(entry.tag_name),
                body: typeof entry.body === 'string' ? entry.body : '',
                url: typeof entry.html_url === 'string' ? entry.html_url : `https://github.com/${OFFICIAL_REPO}/releases`,
                publishedAt: typeof entry.published_at === 'string' ? entry.published_at : '',
            },
        };
    }
    return { cause };
}
/**
 * Cached client for the official releases listing, mirroring the community
 * source's degradation posture: fresh-TTL hits skip the network entirely and
 * any failure serves the previous release with an explanatory note.
 */
export class OfficialReleaseSource {
    deps;
    ttlMinutes;
    cache;
    /**
     * @param deps - ambient web capability / token holders.
     * @param ttlMinutes - cache lifetime in minutes.
     */
    constructor(deps, ttlMinutes = RELEASES_TTL_MINUTES) {
        this.deps = deps;
        this.ttlMinutes = ttlMinutes;
    }
    /**
     * Fetch (or serve cached) latest official release data. Never throws.
     * @param signal - cancellation signal from the tool execution.
     */
    async latest(signal) {
        if (this.cache !== undefined && Date.now() - this.cache.fetchedAt < this.ttlMinutes * 60_000) {
            return { release: this.cache.release };
        }
        try {
            const payload = await fetchJson(this.deps, `https://api.github.com/repos/${OFFICIAL_REPO}/releases?per_page=20`, signal);
            const picked = pickLatestRelease(payload);
            if (picked.release === undefined)
                return this.fail(picked.cause);
            this.cache = { fetchedAt: Date.now(), release: picked.release };
            return { release: picked.release };
        }
        catch (error) {
            return this.fail(error instanceof Error ? error.message : String(error));
        }
    }
    fail(cause) {
        // Rate-limit responses get remediation context; other causes speak for themselves.
        const annotated = /\b(?:403|429)\b|rate.?limit/i.test(cause) ? `${cause} — rate limit` : cause;
        const note = `Official release check unavailable (${annotated})`;
        if (this.cache !== undefined)
            return { release: this.cache.release, degraded: `${note}; serving cached release data` };
        return { degraded: note };
    }
}
/**
 * Detect the local DSH version: CLI probe first (runtime truth), then the
 * profile's installed `@deepseek-ai/dsh` manifest. When both fail, returns a
 * combined explanatory note — never throws.
 * @param profile - profile whose node_modules tree holds the harness manifest.
 * @param probe - CLI probe implementation; `undefined` skips the CLI step.
 * @param env - environment mapping for home resolution (tests inject here).
 */
export async function detectLocalVersion(profile, probe, env = process.env) {
    const cliResult = probe === undefined ? undefined : cliVersion(probe);
    if (cliResult?.version !== undefined)
        return cliResult;
    const manifestResult = await manifestVersion(profile, env);
    if (manifestResult.version !== undefined)
        return manifestResult;
    const causes = [cliResult?.note, manifestResult.note].filter((note) => note !== undefined);
    return { note: `local DSH version unknown${causes.length > 0 ? ` (${causes.join('; ')})` : ''}` };
}
function cliVersion(probe) {
    const result = probe();
    if (!result.ok)
        return { note: `dsh --version could not be read (${result.detail ?? 'no output'})` };
    const version = parseVersion(result.output);
    if (version === undefined)
        return { note: `dsh --version could not be read (unrecognized output '${(result.output ?? '').slice(0, 40)}')` };
    return { raw: result.output, version, source: 'cli' };
}
async function manifestVersion(profile, env) {
    const manifestPath = join(resolveDshHome(env), 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
    try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (typeof manifest.version === 'string') {
            const version = parseVersion(manifest.version);
            if (version !== undefined)
                return { raw: manifest.version, version, source: 'manifest' };
        }
    }
    catch {
        // Absent or unreadable manifest falls through to the unknown-version note.
    }
    return { note: `no @deepseek-ai/dsh version found under profile '${profile}'` };
}
/**
 * Flag installed packages whose peer range on the DSH core packages excludes
 * the official release version. Cordis peers are not checked: the cordis
 * version is not derivable from the release tag.
 * @param peers - installed peer-dependency rows.
 * @param release - the official release to test against.
 */
export function analyzePeerConflicts(peers, release) {
    const findings = [];
    if (release.version === undefined)
        return findings;
    let skipped = 0;
    for (const row of peers) {
        if (row.peer !== '@deepseek-ai/dsh' && !row.peer.startsWith('@deepseek-ai/dsh-'))
            continue;
        const excludes = rangeExcludes(row.range, release.version);
        if (excludes === undefined) {
            skipped += 1;
            continue;
        }
        if (excludes) {
            findings.push({
                kind: 'peer-exclusion',
                severity: 'warning',
                refs: [row.pkg],
                detail: `peer dependency \`${row.peer}\` (${row.range}) of \`${row.pkg}\` excludes the official ${release.tag} version ${formatVersion(release.version)}`,
            });
        }
    }
    if (skipped > 0) {
        findings.push({
            kind: 'peer-exclusion',
            severity: 'info',
            refs: [],
            detail: `${skipped} peer range${skipped === 1 ? '' : 's'} could not be interpreted and ${skipped === 1 ? 'was' : 'were'} skipped`,
        });
    }
    return findings;
}
/**
 * Flag declared tools whose names appear verbatim (identifier-bounded) in the
 * release notes — the harness may now ship a native tool under the same name.
 * @param toolOwners - declared tool name to owning package map.
 * @param release - the official release whose notes are scanned.
 */
export function analyzeToolTakeovers(toolOwners, release) {
    const findings = [];
    if (release.body.length === 0)
        return findings;
    for (const [tool, owner] of toolOwners) {
        if (tool.length < 3)
            continue;
        if (!new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(tool)}(?![A-Za-z0-9_])`).test(release.body))
            continue;
        findings.push({
            kind: 'tool-takeover',
            severity: 'warning',
            refs: [owner],
            detail: `declared tool \`${tool}\` of \`${owner}\` appears in the official ${release.tag} release notes — the harness may ship a native tool with this name`,
        });
    }
    return findings;
}
/**
 * Flag installed plugins whose name/description/capabilities vocabulary
 * overlaps the release notes: at least two distinct shared keywords, or one
 * keyword of five-plus characters. ASCII-only by design, matching the
 * similarity core's tokenizer.
 * @param installed - installed plugin rows with metadata.
 * @param release - the official release whose notes are scanned.
 */
export function analyzeCapabilityOverlaps(installed, release) {
    const bodyTokens = new Set(noteTokens(release.body));
    const qualified = [];
    for (const plugin of installed) {
        const shared = [...new Set(noteTokens(`${plugin.name} ${plugin.description} ${plugin.capabilities.join(' ')}`))]
            .filter(token => bodyTokens.has(token));
        if (shared.length >= 2 || shared.some(token => token.length >= 5))
            qualified.push({ plugin, shared });
    }
    qualified.sort((a, b) => b.shared.length - a.shared.length);
    return qualified.map(({ plugin, shared }) => ({
        kind: 'capability-overlap',
        severity: 'info',
        refs: [plugin.name],
        detail: `\`${plugin.name}\` shares ${shared.length} keyword${shared.length === 1 ? '' : 's'} with the official ${release.tag} notes (${shared.slice(0, 6).join(', ')}) — the release may cover capability the plugin already provides`,
    }));
}
const OVERLAP_STOPWORDS = new Set([
    'the', 'and', 'for', 'plugin', 'need', 'want', 'with', 'dsh',
    'deepseek', 'harness', 'release', 'version', 'improve', 'improved', 'fix',
    'fixed', 'fixes', 'update', 'updated', 'change', 'changes', 'support',
    'added', 'plugins',
]);
function noteTokens(input) {
    return [...new Set(input.toLowerCase().split(/[^a-z0-9+#-]+/).flatMap(token => token.split('-')).filter(token => token.length > 2 && !OVERLAP_STOPWORDS.has(token)))];
}
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const SOURCE_LABELS = {
    cli: 'the `dsh --version` CLI',
    manifest: 'the installed package manifest',
};
function originLabel(raw, source) {
    const text = raw ?? 'unknown version';
    return `${text}${source === undefined ? '' : ` (from ${SOURCE_LABELS[source]})`}`;
}
/**
 * Build the sync result up to the status decision; behind-results get their
 * findings and full report filled in by {@link appendBehindContent}.
 * @param local - detected local version.
 * @param fetched - fetched (or cached) official release data.
 */
export function assembleSyncStatus(local, fetched) {
    if (fetched.release === undefined) {
        const causes = [local.note, fetched.degraded].filter((cause) => cause !== undefined);
        return {
            status: 'unknown',
            findings: [],
            report: ['### Official sync', '', 'The official release check could not complete.', ...causes.map(cause => `> ${cause}`)].join('\n'),
            ...(fetched.degraded === undefined ? {} : { note: fetched.degraded }),
        };
    }
    const release = fetched.release;
    const identity = {
        latestTag: release.tag,
        ...(release.version === undefined ? {} : { latestVersion: formatVersion(release.version) }),
        publishedAt: release.publishedAt,
        releaseUrl: release.url,
        ...(local.raw === undefined ? {} : { localRaw: local.raw }),
        ...(local.source === undefined ? {} : { localSource: local.source }),
    };
    if (release.version === undefined) {
        return {
            status: 'unknown',
            findings: [],
            ...identity,
            report: `### Official sync\n\nThe official release check could not compare versions.\n> the official release tag '${release.tag}' is not a comparable version`,
            ...(fetched.degraded === undefined ? {} : { note: fetched.degraded }),
        };
    }
    if (local.version === undefined) {
        return {
            status: 'unknown',
            findings: [],
            ...identity,
            report: `### Official sync\n\nThe official release check could not compare versions.\n> ${local.note}`,
            ...(fetched.degraded === undefined ? {} : { note: fetched.degraded }),
        };
    }
    const order = compareVersions(local.version, release.version);
    if (order === 0) {
        return {
            status: 'up-to-date',
            findings: [],
            ...identity,
            report: `### Official sync\n\nLocal DSH **${originLabel(local.raw, local.source)}** matches the latest official release (\`${release.tag}\`).`,
        };
    }
    if (order > 0) {
        return {
            status: 'ahead',
            findings: [],
            ...identity,
            report: `### Official sync\n\nLocal DSH **${originLabel(local.raw, local.source)}** is newer than the latest official release (\`${release.tag}\`); you appear to be running a local or pre-release build.`,
        };
    }
    // Behind: findings and the full report arrive via appendBehindContent.
    return { status: 'behind', findings: [], report: '', ...identity };
}
/**
 * Fill a behind-status result with the three finding kinds and render the
 * full report. Findings are capped across all kinds after per-kind ordering
 * (peer exclusions, then takeovers, then overlaps).
 * @param result - the behind-status result from {@link assembleSyncStatus}.
 * @param input - release body plus installed-plugin data the analyzers consume.
 */
export function appendBehindContent(result, input) {
    const release = {
        tag: result.latestTag ?? '',
        name: result.latestTag ?? '',
        version: result.latestVersion === undefined ? undefined : parseVersion(result.latestVersion),
        body: input.releaseBody,
        url: result.releaseUrl ?? '',
        publishedAt: result.publishedAt ?? '',
    };
    const findings = [
        ...analyzePeerConflicts(input.peers, release),
        ...analyzeToolTakeovers(input.toolOwners, release),
        ...analyzeCapabilityOverlaps(input.installedRows, release),
    ].slice(0, SYNC_FINDINGS_CAP);
    const publishedSuffix = release.publishedAt.length === 0 ? '' : `, published ${release.publishedAt.slice(0, 10)}`;
    const lines = [
        '### Official sync: local DSH is behind',
        '',
        `Local DSH **${originLabel(result.localRaw, result.localSource)}** · profile \`${input.profile}\` · latest official **${result.latestVersion ?? result.latestTag}** (\`${release.tag}\`${publishedSuffix}).`,
        '',
        `See the release at ${release.url}`,
    ];
    if (input.inventoryNote !== undefined)
        lines.push('', `> Local inventory: ${input.inventoryNote}`);
    lines.push('', '**Official changes in this release**', '', release.body.trim().length === 0 ? '(no release notes provided).' : truncateBody(release.body));
    lines.push('', '**Installed plugins potentially duplicated or conflicting**', '');
    lines.push(findings.length === 0
        ? 'No installed plugin declares peer ranges, tool names, or capabilities conflicting with this release.'
        : findings.map(finding => `- [${finding.severity.toUpperCase()}] ${finding.detail}`).join('\n'));
    if (result.note !== undefined)
        lines.push('', `> ${result.note}`);
    return {
        ...result,
        findings: findings.map(finding => ({ ...finding, refs: [...finding.refs] })),
        ...(input.releaseBody.trim().length === 0 ? {} : { releaseNotes: truncateBody(input.releaseBody) }),
        report: lines.join('\n'),
    };
}
function truncateBody(body) {
    const trimmed = body.trim();
    return trimmed.length > RELEASE_BODY_CHARS ? `${trimmed.slice(0, RELEASE_BODY_CHARS)}\n\n… (truncated)` : trimmed;
}
/**
 * Render the install-guard advisory: empty unless the sync concluded the
 * local install is behind. Deliberately silent on unknown/failed checks —
 * those surface through `plugin_official_sync`, keeping guard reports clean.
 * @param sync - the sync result, or `undefined` when the advisory path failed.
 */
export function renderSyncAdvisory(sync) {
    if (sync === undefined || sync.status !== 'behind')
        return '';
    const bullets = sync.findings.slice(0, SYNC_ADVISORY_BULLETS).map(finding => `- [${finding.kind}] ${finding.detail}`);
    return [
        '',
        '### Official update advisory',
        '',
        `Your local DSH is behind ${sync.latestTag}. Advisory only — the install verdict above is unchanged.`,
        ...(bullets.length > 0 ? bullets : ['- No specific duplicate-or-conflict findings against installed plugins.']),
        ...(sync.releaseUrl === undefined ? [] : [`See ${sync.releaseUrl}`]),
    ].join('\n');
}
