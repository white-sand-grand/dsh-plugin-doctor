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
/** Per-tool usage aggregate. */
export interface ToolUsage {
    readonly tool: string;
    readonly calls: number;
    /** Number of distinct session logs containing a call to this tool. */
    readonly sessions: number;
    /** ISO-8601 mtime of the newest log containing a call (approximation). */
    readonly lastUsed: string;
}
/** Full audit outcome. */
export interface UsageAudit {
    readonly tools: readonly ToolUsage[];
    readonly sessionsScanned: number;
    /** Session artifacts skipped because they were unreadable or torn. */
    readonly skipped: number;
    /** Set when the sessions root is absent — no data yet, not an error. */
    readonly note?: string;
}
/**
 * Aggregate `tool/call` events across every session log under the root.
 * @param sessionsRoot - `$DSH_HOME/sessions` or a test fixture root.
 */
export declare function auditToolUsage(sessionsRoot: string): Promise<UsageAudit>;
/**
 * Build a tool-name → package-name map for installed plugins that declare
 * their tools via the `dsh.tools` field in package.json. Plugins without the
 * declaration simply don't participate in attribution (their tools read as
 * unattributed, not as unused).
 * @param profileDir - the profile directory whose node_modules holds installs.
 * @param installed - installed plugin package names.
 */
export declare function pluginToolMap(profileDir: string, installed: readonly string[]): Promise<Map<string, string>>;
