# Contributing to Dokpilot

Thanks for your interest. Dokpilot is a **solo-maintained**, single-user local
tool. Contributions are welcome, but please read the expectations below first —
they keep the project small, safe, and consistent.

## Support model

- **Issues only.** Use [GitHub Issues](https://github.com/kyzdes/dokpilot/issues)
  for bugs, stack-support requests, and questions.
- **No SLA.** Issues and PRs are triaged as time allows; there is no guaranteed
  response time.
- **No Discord / chat / roadmap voting.** There is no community server and no
  public roadmap-voting process. Please don't ask where to "vote" on features —
  file an issue describing the concrete problem instead.
- **Security issues go to [SECURITY.md](SECURITY.md)**, not the public issue
  tracker as a normal bug. Follow the responsible-disclosure steps there.

## Ground rules for pull requests

Dokpilot has a couple of hard architectural constraints. PRs that violate them
will be asked to change before review:

- **Core scripts stay Bash (D-002).** The deploy/setup/API/DNS/SSH scripts
  under `skills/dokpilot/scripts/` are intentionally POSIX-ish shell for
  determinism, a trivial CI, and minimal dependencies. Do **not** rewrite core
  scripts in Node/TypeScript without a strong, discussed reason.
- **The ui-server is zero-dependency.** `mcp-server/ui-server/` runs on the
  **Node 20 standard library only** — no `npm install`, no `package.json`
  dependencies, no build step. Do not add runtime deps to the dashboard
  backend. New code must use `node:*` stdlib modules.
- **Keep the trust boundary intact.** Don't widen what a deploy worker can do:
  Phase A stays read-only (no `Write`/`Bash`/`bypassPermissions`, no repo
  `--add-dir`), Phase B consumes the validated manifest only and never re-reads
  the target repo, and the ui-server bearer token is **never** threaded into a
  worker environment. See [SECURITY.md](SECURITY.md) for the full model.

## Never commit secrets or local config

- **Never commit `config/servers.json`** (or `skills/dokpilot/config/servers.json`).
  It holds live credentials or `{_secret}` references and is gitignored. The
  tracked template is `config/servers.json.example`.
- **Never commit `context-map-*/` folders.** They are agent project-memory and
  may contain private operational notes; they are gitignored on purpose. If you
  see one staged, unstage it and verify `.gitignore` still carries the rule —
  do **not** add its contents to the repo.
- **Secrets hygiene.** Don't paste API keys, tokens, passwords, server IPs, or
  private hostnames into commits, issues, PRs, tests, or docs. Use the RFC-5737
  documentation ranges (`203.0.113.x`, `198.51.100.x`) and `example.com` for
  examples. Scrub logs before attaching them.

## Local checks before you push

```bash
# shell syntax + lint
bash -n scripts/*.sh skills/dokpilot/scripts/*.sh mcp-server/ui-server/launch.sh
shellcheck -S warning scripts/*.sh skills/dokpilot/scripts/*.sh

# ui-server boots + routes answer (CI mode, no live server needed)
node mcp-server/ui-server/smoke.js --ci

# clean-machine install smoke (Mode B)
bash scripts/clean-machine-smoke.sh
```

The GitHub Actions `validate` workflow runs a superset of these (plugin.json
validity, mirror parity of `AGENTS.md`/`GEMINI.md` with `SKILL.md`, shellcheck,
and the boot smoke). Keep it green.

## Style

- Match the surrounding code. Small, focused PRs review faster than large ones.
- Update the relevant `references/*.md` when you change behavior a user or the
  model relies on.
