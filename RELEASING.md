# Releasing Dokpilot

The version **single source of truth** is `.claude-plugin/plugin.json` → `.version`.
Every other echo (gemini-extension.json, README badge, `/api/health`, the dashboard
`.sb-ver` chips + settings `#ver`, the mock `meta.version`) is kept in sync by
`scripts/bump-version.sh` and asserted by `scripts/check-version-sync.sh`. CI
(`.github/workflows/validate.yml`) fails the build on any drift.

## Cut a release

1. Land all the work on the release branch; `cd mcp-server/ui-server && npm test` is green
   (unit + e2e + smoke).
2. `bash scripts/bump-version.sh X.Y.Z` — sets the version at every echo site, re-syncs the
   `AGENTS.md` / `GEMINI.md` mirrors of `SKILL.md`, and verifies. Commit it.
3. Write the `## vX.Y.Z — <date>` section at the top of `CHANGELOG.md` — claim **only** what
   actually merged (no "Done" for anything unverified).
4. Open a PR; CI must be green: version-sync, mirror parity, `node --check`, shellcheck,
   inline-script parse, and the test suite.
5. **Tag only on an explicit human "go", after CI is green on the default branch:**

   ```sh
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

   Never tag or push a tag autonomously.

## Before flipping public (launch gate)

- Run **one live end-to-end two-phase deploy** on a throwaway repo + throwaway server
  (confirm Phase A emits a parseable manifest, Phase B never re-reads the repo, flagged
  commands surface in the gate, and `cost_usd` = Phase A + Phase B). See KI-024.
- Resolve the open product decisions: public repo name (`dokpilot` vs `dokpilot-skill`),
  the cross-repo `marketplace.json` entry (enables install Mode A), GitHub Sponsors,
  `benchmarks/*` (accept / regenerate / gitignore), and the `STATE_DIR` move.
- `bash scripts/clean-machine-smoke.sh` green on a throwaway HOME.
