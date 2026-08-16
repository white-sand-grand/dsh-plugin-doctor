/**
 * Plugin Spec generation for the "community has nothing suitable" branch: a
 * Markdown specification the user can hand to a plugin developer (or an agent)
 * to build the missing plugin. Pseudocode follows the real DSH plugin model
 * (Cordis `apply(ctx, config)` + `defineTool`), not the lifecycle-hook sketch
 * in the original feature request.
 *
 * @module dsh-plugin-doctor/spec
 */
/**
 * Suggest a package name for the missing plugin from the user intent.
 * Derives the most prominent hyphen-joinable tokens, else falls back to a
 * generic stem, always under the `dsh-plugin-` prefix used by the community
 * topic.
 * @param intent - natural-language requirement.
 */
function suggestPluginName(intent) {
    const words = intent.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
        .filter(word => word.length > 1 && !['i', 'need', 'want', 'a', 'an', 'the', 'plugin', 'that', 'can', 'for', 'dsh'].includes(word));
    const stem = words.slice(0, 3).join('-');
    return `dsh-plugin-${stem.length > 0 ? stem : 'custom'}`;
}
/**
 * Derive plausible capability tags from the intent's salient words.
 * @param intent - natural-language requirement.
 */
function suggestCapabilities(intent) {
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
/**
 * Suggest a package name for the plugin consolidating a redundancy cluster:
 * the intent-derived name, kept distinct from every member's own name.
 * @param intent - the requirement that surfaced the cluster.
 * @param members - cluster member plugins.
 */
function suggestIntegrationName(intent, members) {
    const base = suggestPluginName(intent);
    const taken = new Set(members.map(member => member.name));
    return taken.has(base) ? `${base}-unified` : base;
}
/**
 * Render the integration spec: the design for a new plugin consolidating a
 * redundancy cluster, absorbing every member's unique capabilities. Generated
 * only after the user explicitly chose this route.
 * @param intent - the requirement that surfaced the cluster.
 * @param members - the redundant plugins to consolidate.
 */
export function renderIntegrationSpec(intent, members) {
    const name = suggestIntegrationName(intent, members);
    const allCapabilities = [...new Set(members.flatMap(member => member.capabilities))];
    const allDependencies = [...new Set(members.flatMap(member => member.dependencies))];
    const memberRows = members.map(member => `- \`${member.name}\` — ⭐ ${member.stars} · updated ${member.updatedAt || 'unknown'} · unique: ${member.capabilities.filter(capability => !members.some(other => other !== member && other.capabilities.includes(capability))).join(', ') || '(none)'}`);
    return [
        '## Integration Spec: consolidate into one plugin',
        '',
        `You chose to replace the redundant cluster below with one purpose-built plugin serving **${intent.trim()}**.`,
        '',
        '### Members being consolidated',
        '',
        ...memberRows,
        '',
        '### Name',
        '',
        `\`${name}\` — derived from the intent, distinct from every member's name.`,
        '',
        '### Capabilities (union of member capabilities)',
        '',
        ...(allCapabilities.length > 0 ? allCapabilities.map(capability => `- \`${capability}\``) : ['- `(derive from the members above)`']),
        '',
        '### Dependencies (union of member dependencies)',
        '',
        ...(allDependencies.length > 0 ? allDependencies.map(dependency => `- \`${dependency}\``) : ['- `- none beyond the tool peers below`']),
        '- `@deepseek-ai/cordis` (peer)',
        '- `@deepseek-ai/dsh-tools` (peer, for `defineTool`)',
        '',
        '### Core logic (pseudocode, real DSH plugin model)',
        '',
        '```ts',
        "import { defineTool } from '@deepseek-ai/dsh-tools'",
        '',
        `export const name = '${name.replace(/^dsh-plugin-/, '')}'`,
        "export const inject = ['tools']",
        'export const Config = z.object({ /* validated, no hardcoded tunables */ })',
        '',
        'export function apply(ctx, config) {',
        '  ctx.tools.register(defineTool({',
        `    name: '${allCapabilities[0] ?? 'run'}',`,
        `    description: 'Consolidates: ${members.map(member => member.name).join(', ')}',`,
        '    parameters: { /* JSON-schema-shaped parameter spec */ },',
        '    output: { schema: { /* ... */ }, render: (_args, value) => [{ type: \'text\', text: String(value) }] },',
        '    async execute(args, exec) {',
        '    // honor exec.signal; never block the host on unbounded work',
        '    // implement each member\'s unique capability as one coherent tool',
        '    },',
        "    presentCall: args => ({ card: 'generic', title: '...', kind: 'other', rawInput: args }),",
        '  }))',
        '}',
        '```',
        '',
        '### Differentiation from each member',
        '',
        ...members.map(member => `- vs \`${member.name}\`: also covers ${allCapabilities.filter(capability => !member.capabilities.includes(capability)).join(', ') || 'the same scope, but maintained as one plugin'}`),
        '',
        'Ship it with `license: "MIT"`, add the `dsh-plugin` GitHub topic, mount with',
        `\`dsh plugin --profile web add github:<your-username>/${name}\`,`,
        'then remove every member you installed (commands in the recommendation report).',
    ].join('\n');
}
