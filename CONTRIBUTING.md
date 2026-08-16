# Contributing

Thanks for considering a contribution.

- **Compatibility target:** DSH v0.1.x developer preview. If a DSH release changes a consumed seam (`dsh-tools`, `dsh-settings`, `dsh-credentials`, `dsh-web`), prefer presence checks and graceful degradation over hard pins; note the adaptation in code where it is non-obvious.
- **No hardcoded secrets or tunables:** every deployment-varying value is a validated `Config` field; tokens go through credential references, never literals in files.
- **Fail soft, report loudly:** external API failures degrade (cache → registry snapshot) and are surfaced in tool output; they must never throw into the DSH host.
- **Tests:** pure logic (similarity, spec rendering, recommendation branching) gets unit tests with no network; GitHub-client behavior is tested against stubbed fetches. Run `pnpm test` before submitting.
- **Style:** ESM everywhere, strict TypeScript, `.ts` relative imports, one trailing newline per file.
- **License:** contributions land under the repository's MIT license.

Open an issue describing the behavior gap before large changes.
