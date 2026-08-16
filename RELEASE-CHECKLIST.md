# Release checklist

Confirm every item before publishing a version.

- [ ] `package.json` declares `"license": "MIT"`, matching [LICENSE](LICENSE).
- [ ] `pnpm run build && pnpm test && node verify-boot.mjs` all pass on a clean checkout in one environment (Windows or WSL — see README Development note).
- [ ] No secret is hardcoded: token only via `githubTokenEnv` credential reference (default `DSH_PLUGIN_DOCTOR_GITHUB_TOKEN`) or the `role('secret')` literal field; grep the diff for token-like strings.
- [ ] Every external API failure path degrades (GitHub → stale cache → registry snapshot) and is reported in tool output; no error thrown into the DSH host (`tests/degradation.spec.ts` covers all three).
- [ ] Peer ranges still cover the newest published DSH (`@deepseek-ai/dsh-tools`, `dsh-settings`, `dsh-credentials`, `cordis`); `verify-boot.mjs` ran against that version.
- [ ] README states "Compatible with DSH v0.1.x (developer preview)" and the Web-UI settings-card limitation.
- [ ] Repository carries the `dsh-plugin` GitHub topic so the plugin is discoverable by this tool itself.
- [ ] `cordis.patch.yml` defaults match the documented table in README.
- [ ] Tag a semver version; breaking config or output changes bump at least the minor.
