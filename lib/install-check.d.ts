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
    readonly ref: string;
    readonly repo?: string;
    readonly packageJson?: unknown;
    readonly patchText?: string;
    readonly error?: string;
}
/** One conflict found while comparing install candidates. */
export interface InstallConflict {
    readonly kind: 'package' | 'tool' | 'patch-id' | 'patch-name' | 'peer-dependency' | 'inspection';
    readonly severity: 'block' | 'warning';
    readonly refs: readonly string[];
    readonly detail: string;
}
/** Complete preflight result rendered by the install guard tool. */
export interface InstallCheckReport {
    readonly safeToInstall: boolean;
    readonly conflicts: readonly InstallConflict[];
    readonly inspected: readonly string[];
    readonly uninspected: readonly string[];
    readonly report: string;
}
/**
 * Compare inspected repositories and return only actionable conflicts.
 * @param inspections - repository metadata fetched from the supplied refs.
 */
export declare function analyzeInstallConflicts(inspections: readonly InstallInspection[]): InstallCheckReport;
