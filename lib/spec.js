/**
 * Plugin Spec generation for the "community has nothing suitable" branch: a
 * Markdown specification the user can hand to a plugin developer (or an agent)
 * to build the missing plugin. Pseudocode follows the real DSH plugin model
 * (Cordis `apply(ctx, config)` + `defineTool`), not the lifecycle-hook sketch
 * in the original feature request.
 *
 * @module dsh-plugin-recommender/spec
 */
/**
 * Suggest a package name for the missing plugin from the user intent.
 * Derives the most prominent hyphen-joinable tokens, else falls back to a
 * generic stem, always under the `dsh-plugin-` prefix used by the community
 * topic.
 * @param intent - natural-language requirement.
 */
export function suggestPluginName(intent) {
    const words = intent.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
        .filter(word => word.length > 1 && !['i', 'need', 'want', 'a', 'an', 'the', 'plugin', 'that', 'can', 'for', 'dsh'].includes(word));
    const stem = words.slice(0, 3).join('-');
    return `dsh-plugin-${stem.length > 0 ? stem : 'custom'}`;
}
/**
 * Derive plausible capability tags from the intent's salient words.
 * @param intent - natural-language requirement.
 */
export function suggestCapabilities(intent) {
    const words = intent.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(word => word.length > 2);
    return [...new Set(words)].slice(0, 5);
}
/**
 * Render the full Plugin Spec as Markdown.
 * @param intent - the user requirement the spec answers.
 * @param comparedAgainst - community plugins already considered and rejected, cited for differentiation.
 */
export function renderPluginSpec(intent, comparedAgainst) {
    const name = suggestPluginName(intent);
    const capabilities = suggestCapabilities(intent);
    const known = comparedAgainst.length === 0
        ? '_No community plugins matched this intent, so no overlap analysis applies._'
        : comparedAgainst.slice(0, 5).map(plugin => `- \`${plugin.name}\` — ${plugin.description || '(no description)'}`).join('\n');
    return [
        '## Plugin Spec: build it yourself',
        '',
        `No community plugin matched **${intent.trim()}**. The community came back empty, so the recommendation is to develop a new plugin. Suggested specification:`,
        '',
        `### Name`,
        '',
        `\`${name}\` — follows the \`dsh-plugin-*\` naming convention of the \`dsh-plugin\` GitHub topic.`,
        '',
        '### Capabilities',
        '',
        ...(capabilities.length > 0 ? capabilities.map(capability => `- \`${capability}\``) : ['- `(to be derived from the requirement)`']),
        '',
        '### Dependencies',
        '',
        '- `@deepseek-ai/cordis` (peer)',
        '- `@deepseek-ai/dsh-tools` (peer, for `defineTool`)',
        '- add Service Definition peers only for capabilities you inject (e.g. `dsh-web`, `dsh-settings`)',
        '',
        '### Core logic (pseudocode, real DSH plugin model)',
        '',
        '```ts',
        "import { defineTool } from '@deepseek-ai/dsh-tools'",
        '',
        "export const name = '" + name.replace(/^dsh-plugin-/, '') + "'",
        "export const inject = ['tools']",
        'export const Config = z.object({ /* validated, no hardcoded tunables */ })',
        '',
        'export function apply(ctx, config) {',
        '  ctx.tools.register(defineTool({',
        `    name: '${capabilities[0] ?? 'run'}',`,
        `    description: '${intent.trim().replace(/'/g, "\\'")}',`,
        '    parameters: { /* JSON-schema-shaped parameter spec */ },',
        '    output: { schema: { /* ... */ }, render: (_args, value) => [{ type: \'text\', text: String(value) }] },',
        '    async execute(args, exec) {',
        '      // honor exec.signal; never block the host on unbounded work',
        `      // implement: ${intent.trim()}`,
        '    },',
        "    presentCall: args => ({ card: 'generic', title: '...', kind: 'other', rawInput: args }),",
        '  }))',
        '}',
        '```',
        '',
        '### Differentiation from existing community plugins',
        '',
        known,
        '',
        'Ship it with `license: "MIT"`, add the `dsh-plugin` GitHub topic, and mount with',
        '`dsh plugin --profile web add github:<your-username>/' + name + '`.',
    ].join('\n');
}
