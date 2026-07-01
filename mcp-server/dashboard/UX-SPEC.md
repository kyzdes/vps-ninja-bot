# UX Spec — Dokpilot Companion Dashboard

Generated 2026-05-24. Skill: Dokpilot v4.0.0. Owner: single-user operator (macOS).

> Inferred from internal planning notes (Phase D).

---

## §1 Product Framing

**Product.** Dokpilot Companion Dashboard — a local-only web UI that mirrors and steers a CLI skill that deploys GitHub repos to VPS servers running Dokploy.

**Audience.** A single developer operator. Power user. Knows the CLI flow but wants a faster visual scan and a less-typing wizard for the common "deploy this repo to that server" case. Runs on macOS.

**JTBD.** (i) Glance at "what's running where" without typing four CLI commands; (ii) deploy a repo to a server with as few keystrokes as paste→pick→submit; (iii) watch a live deploy without tailing logs in a terminal.

**Platform.** Localhost desktop web app at `http://127.0.0.1:<port>`. Launched by `/dokpilot ui`. macOS browser (Safari/Chrome/Arc). No mobile.

**Existing context.** keys-keeper plugin as visual reference — dark surfaces, mono-typed technical content, accent for state, no enterprise SaaS chrome. Brand tokens: dark base (#0a0a0a–#111), neon-green primary (~#39ff14), monospace heading + body.

**Archetype.** `internal-tool` / single-tenant dashboard. Density-leaning, not marketing-leaning.

---

## §2 Functional Scope

**Must-have (v1):**
1. Server inventory — list all Dokploy servers from `config/servers.json`, each with health badge, Dokploy version, IP, default-server marker.
2. App inventory — per server: list apps deployed via Dokpilot with name, domain, last deploy time, current status (running / building / error / stopped).
3. App detail — env var keys (no values), recent deployments (≤10), most recent deploy log tail (SSE-streamed).
4. Deploy wizard — paste GitHub URL → pick server → submit → watch live progress with five lifecycle states.
5. Wizard Q&A — wizard surfaces clarifying questions in-UI (e.g. "Need NEXT_PUBLIC_API_URL"); user answers via inline form; skill resumes.
6. Final state — wizard reaches `done` with clickable live URL, or `error` with the failing step + log excerpt.
7. Secret-source visibility — small badge on each server row indicating Keychain vs file (no values shown).

**Nice-to-have:**
1. Re-run / redeploy quick action on an app card (Phase E may defer this — observation-only stays the safe default; if added, requires CSRF token).
2. "Open in Dokploy" link from each app (deep-link to Dokploy UI at `dokploy_url`).
3. Theme toggle (dark default; light is the fallback).
4. Connection-lost banner when SSE drops; auto-reconnect.

**Explicitly out of scope (v1):**
- Server add/remove/edit (CLI-only — `/dokpilot config server add`).
- Secret rotation / Keychain write actions (CLI-only).
- Domain CRUD beyond the wizard's create-on-deploy path.
- Multi-user / auth UX — single user, single token issued per launch.
- Mobile / responsive — desktop-only.

---

## §3 User Flows

**F1. Glance.**
Launch `/dokpilot ui` in terminal → browser opens to dashboard → see all servers + apps in one screen → done. Hover an app row to preview last deploy timestamp; click to drill in.

**F2. Drill into app.**
Click app card → app detail opens (panel or modal) → env keys, recent deploys table, log tail. Click a deploy row → that deploy's full log streams. ESC / × closes back to inventory.

**F3. Deploy wizard (happy path).**
Wizard tab → paste `github.com/owner/repo` → pick server from dropdown → optional domain field → Submit. Job created, status `pending` → progress timeline appears with five steps (Detecting stack / Awaiting answers / Deploying / DNS + SSL / Done). Stack detected → if questions surfaced, inline Q&A form appears with one field per missing input → Submit answers → continues → `done` reveals live URL with copy button and "Open" link.

**F4. Deploy wizard (error path).**
Same start. Any step fails → step turns red, log excerpt collapsed-by-default expands below it, "Retry from this step" button appears (Phase E may stub this; minimum is "view full log" link). User reads, fixes upstream (e.g. fixes env value in source repo), re-runs wizard.

---

## §4 Screen Inventory

| ID | Screen | Purpose |
|----|--------|---------|
| S1 | Dashboard home | Server + app inventory at a glance |
| S2 | App detail | Env keys, deploys, logs for one app (overlay or right-pane on top of S1) |
| S3 | Deploy wizard | Multi-step form + live progress for a new deploy |
| S4 | Empty state | First-time view when `config/servers.json` has zero servers |
| S5 | Connection lost | Banner / interstitial when SSE drops |

---

## §5 Per-Screen Briefs

### S1 · Dashboard home

- **Information hierarchy.** Top: app header (logo + version). Center: server cards stacked vertically, each containing a header (name, IP, version, status badge) and a table of its apps. Right rail (collapsible): "New deploy" CTA + recent activity feed.
- **Key elements.** Server card (`card`), app row (`row`), status badge (`badge`), secret-source badge (`pill`), recent-activity feed (`list`), New-deploy primary button.
- **States.** Loading → server cards skeleton-shimmer (no spinner; subtle pulse). Empty → S4. Error per-server → server card shows red badge + "Cannot reach Dokploy at {url}" inline.
- **Position-4.** Narrative role: data. Audience distance: 1m laptop. Visual temperature: cold (operator surface). Capacity check: fits 3-4 servers × 8 apps comfortably; beyond that, scroll within server card.

### S2 · App detail

- **Information hierarchy.** Top: app name, domain, primary status badge, "Open" button (external link). Tabs: Env / Deploys / Logs (default: Deploys). Body: tab content. Bottom: secondary actions (placeholder — "Redeploy via CLI" hint).
- **Key elements.** Tab strip (`tabs`), env-keys list (`list` with masked-value pill), deploys table (`table`), log viewer (`pre` with monospace, SSE-tail badge).
- **States.** Loading → tab content skeleton. Empty (no deploys yet) → "No deployments yet. Run `/dokpilot deploy <github-url>` to ship your first build." Error → red banner with retry button.
- **Position-4.** Narrative role: data. Audience distance: 1m laptop. Visual temperature: cold. Capacity check: env list paginates above 30 keys; log viewer is scroll-locked unless user scrolls up.

### S3 · Deploy wizard

- **Information hierarchy.** Top: step indicator (5 nodes connected by line, current step highlighted, completed steps green, pending steps muted). Body: per-step UI (form on step 1; live log + Q&A form on later steps). Bottom: secondary "Cancel" + primary "Submit / Next" if active.
- **Key elements.** Step indicator (`stepper`), form fields (`input`, `select`, `textarea` for env), inline Q&A form generated from job state, live log pane, success/error final card with copy-URL button.
- **States (CRITICAL — design each):**
  - `step-empty` (step 1): form with repo URL + server dropdown + optional domain. Submit disabled until URL + server picked.
  - `step-in-progress`: spinner-less progress strip on the active step; log tail streams below; cancel disabled mid-deploy.
  - `step-asking-question`: yellow `asking` badge on active step; Q&A form rendered inline (one field per question) with focused first field; ARIA live-region announces each new question.
  - `step-error`: red badge on failing step; collapsed log excerpt expands with red left-border; "View full log" link opens log pane focused on the error timestamp.
  - `step-done`: green confetti-free final card; live URL chip + copy + open; small "Run another" link to reset wizard.
- **Position-4.** Narrative role: transition (process). Audience distance: 1m laptop. Visual temperature: focused (slightly warmer than dashboard — green accent in motion).

### S4 · Empty state (first run)

- **Information hierarchy.** Centered card: title "No servers configured", one-paragraph explainer, code snippet showing the CLI command to add one (`/dokpilot config server add main 1.2.3.4`), copy button.
- **Key elements.** Card, codeblock, copy button.
- **States.** Single state. Once a server exists in `config/servers.json` (poll the API every 5s while on this screen), auto-transition to S1.
- **Position-4.** Narrative role: hero (only screen, full-bleed). Audience distance: 1m laptop. Visual temperature: calm.

### S5 · Connection lost

- **Information hierarchy.** Sticky top banner; rest of UI remains visible but greyed slightly. Banner: "Connection to dashboard server lost — retrying in 3s…". Auto-reconnect with exponential backoff; show countdown.
- **Key elements.** Banner (`alert`), countdown text, "Retry now" link.
- **States.** Single state until reconnected, then animates out.
- **Position-4.** Narrative role: transition. Audience distance: 1m laptop. Visual temperature: cold (alert; not panic).

---

## §6 Constraints & Context

- **Platform.** Desktop only — Chrome / Safari / Arc / Firefox latest. macOS primary.
- **No build step.** Single static `index.html` + `app.js` + `styles.css`. Tailwind via Play CDN allowed; no other JS deps.
- **Realtime.** SSE for log tail (`/api/deployments/:id/logs/stream`) and job progress (`/api/jobs/:id/stream`). `EventSource` reconnects natively; UI must surface stale state via S5.
- **Security.** Bearer token in URL query at launch; cookie-set on first GET; CSRF token required on every POST. No CORS. Strict Origin/Referer check. The dashboard does NOT show secret values — only presence + source.
- **Performance.** Server cards should render <100ms after API response; log viewer must throttle SSE rendering to 20fps to avoid scroll jank.
- **A11y.** Wizard form fields keyboard-navigable in Tab order; status badges have `aria-label`; SSE-streamed log lines wrapped in `aria-live="polite"`; color is never the sole carrier of state (always paired with text label or icon).
- **Per-breakpoint feature parity.** Single breakpoint: desktop ≥1024px. Below 1024 → show a "Resize to ≥1024" notice; no mobile/tablet adaptations in v1.

---

## §7 Design Context (for huashu-design)

- **Design system reference.** keys-keeper admin canvas at `~/.claude/plugins/cache/claude-skills/keys-keeper/0.4.0/keys-keeper-admin-canvas.html`. Mirror its: dark base + elevated surfaces, monospace for technical strings, Inter for narrative copy, status-color tokens (success/danger/warning/info), card-row-pill component vocabulary, sidebar pattern, JetBrains Mono ss01 / cv02 / cv11 feature flags.
- **Brand tokens to adapt.** Replace keys-keeper terracotta accent (`#d97550`) with Dokpilot **neon-green** primary. Suggested: `--accent: #39ff14` (or a slightly desaturated variant `#4ade80`-ish if pure neon vibrates too hard on log text). Keep all other token shapes identical (`--accent-soft`, `--accent-line` aligned to the green).
- **Type scale.** Inter 13px base (narrative), JetBrains Mono 12.5px for any path/command/log/IP/version. Headings: Inter 16px / 18px / 24px. No bigger.
- **Density.** Compact-to-comfortable rows (6–10px vertical padding). Server cards ~120px tall when empty, expand with app rows.
- **Iconography.** Lucide or Phosphor SVGs inlined (no icon font); simple outlined glyphs. Status indicator: dot + label, not just dot.
- **Motion.** Subtle. SSE log lines: no animation, just instant append. Step indicator: 200ms ease-out transition between active steps. Hover: 100ms background tint. Connection-lost banner: 300ms slide-down.

---

## §8 Hand-off to huashu-design

### §8.1 Delivery format
`hi-fi-static` — only 5 screens, one primary flow (wizard), no anonymous↔authed transitions, no branching variants worth canvasing. Output is a single static `index.html` + `styles.css` that becomes the actual dashboard frontend (no canvas wrapper).

### §8.2 Density type
**Dense / data-driven.** Operator dashboard, not consumer app. Keys-keeper-level density.

### §8.3 Position-4 per screen

| ID | Narrative | Distance | Temperature | Capacity |
|----|-----------|----------|-------------|----------|
| S1 | data | 1m laptop | cold | fits 3-4 servers × 8 apps then scroll |
| S2 | data | 1m laptop | cold | env paginates >30 keys; log scroll-lock-on-bottom |
| S3 | transition | 1m laptop | focused (warmer) | step indicator stays visible; log pane scrolls |
| S4 | hero (single-screen) | 1m laptop | calm | centered; ~480px wide max |
| S5 | transition | 1m laptop | cold | sticky banner; non-blocking |

### §8.4 Variation dimensions (locked at v1, but document so future iterations can dial them)

1. **DIM 1 — INVENTORY LAYOUT:** stacked-cards (locked v1) | table-flat | board.
2. **DIM 2 — WIZARD PROGRESS:** horizontal stepper (locked v1) | vertical stepper | percent bar.
3. **DIM 3 — LOG VIEWER:** inline-collapsible (locked v1) | side-panel | full-screen-modal.
4. **DIM 4 — ACCENT:** neon-green (locked v1) | terminal-green | amber.

### §8.5 Tweaks worth exposing

- `[scope: global]` Theme: dark (default) | light
- `[scope: global]` Accent tone: neon (default) | soft
- `[scope: global]` Density: compact | comfortable (default) | spacious
- `[scope: S1]` Show secret-source badge: on (default) | off
- `[scope: S1]` Recent-activity feed: visible (default) | collapsed
- `[scope: S2]` Default tab: Deploys (default) | Env | Logs
- `[scope: S3]` Step indicator orientation: horizontal (default) | vertical
- `[scope: S3]` Auto-scroll log to bottom: on (default) | off
- `[scope: S3]` Final-card style: minimal | celebratory (small)

### §8.6 Brand asset checklist
- [ ] Logo provided (pending — Phase G produces it)
- [x] Color palette defined (neon-green + dark)
- [x] Type scale defined (Inter + JetBrains Mono)
- [ ] Iconography pack chosen (recommend Lucide)
- [ ] Favicon (pending — Phase G)

### §8.7 Canvas construction hint
N/A — `hi-fi-static`. Produce `mcp-server/dashboard/public/index.html` and `mcp-server/dashboard/public/styles.css` as the final artifact, not a canvas explorer. Use stub data in `app.js` (a `MOCK_DATA` object with 2 servers, 5 apps, 1 in-flight deploy job in `asking-question` state) so the prototype renders standalone before the backend (Phase E) is wired.

### §8.8 Lock-in prompt template
N/A for `hi-fi-static`. If we ever switch to `cjm-canvas` in a future iteration, the prompt would read:

```
Lock these design choices into the UX spec at mcp-server/dashboard/UX-SPEC.md:

Global:
- §8.4 DIM 4 ACCENT: <selected>
- Theme: <selected>
- Density: <selected>

Screen S1 · Dashboard home:
- Show secret-source badge: <selected>
- Recent-activity feed: <selected>
```

---

## §9 Open Questions & Assumptions

### §9.1 Assumptions made (mark for huashu)
- Wizard is **observation + interactive Q&A**, NOT generic write CRUD. Per-app "Redeploy" button is deferred to v1.1.
- Single-user. No user switcher, no profile menu.
- macOS-only secret-source badge — Linux/Windows show "file" always.
- Wizard runs ONE deploy job at a time per dashboard session; concurrent deploys are blocked at the API layer with a clear error.

### §9.2 Resolved during this spec (would have asked in Phase 3)
- Auth strategy: bearer-token-in-URL + CSRF on POST (per Phase E plan, not a user-facing decision).
- Onboarding: S4 single-card empty state; no tour.
- Monetization: N/A (skill is private).
- Notifications: in-app only (event feed); no system notifications in v1.

### §9.3 Truly open (need user input in a follow-up session)
1. Should the wizard ALSO offer recent-repos autocomplete (from `~/.claude/skills/dokpilot/.history`)? Default = no, paste-only.
2. Should the dashboard auto-launch on first `/dokpilot deploy` call (companion mode), or only when explicitly invoked via `/dokpilot ui`? Default = explicit only.
3. Light theme — actually needed v1, or skip? Default = include because keys-keeper has it.

### §9.4 Product risks
- **R1 — Wizard Q&A latency.** If Claude takes 30+ seconds to answer the next clarifying question, the wizard UI looks stuck. **Mitigation:** show a thinking indicator on the active step with elapsed-time counter; never hide the most recent log line.
- **R2 — SSE through corporate proxy.** Not relevant for localhost, but if user ever tunnels via Cloudflare Tunnel for remote view, SSE breaks without `X-Accel-Buffering: no`. **Mitigation:** document loudly in dashboard README "DO NOT EXPOSE REMOTELY".
- **R3 — Token leak via shoulder-surf.** Bearer token in URL is visible in browser history. **Mitigation:** rotate per launch; document; recommend Arc / Safari private windows for screen-sharing.
- **R4 — Stale `config/servers.json`.** If user edits the JSON in another terminal while dashboard runs, the API returns stale-cached data. **Mitigation:** dashboard re-reads the file on every request to `/api/servers`; no caching beyond the request.
- **R5 — Log viewer memory growth.** A 30-minute deploy can stream 50k+ lines; keeping all in DOM kills the tab. **Mitigation:** virtualized log viewer; keep last 5k lines in memory + "View full log file" link to download.

### §9.5 Considered alternatives (and why not chosen)
- **Standalone wizard (no companion mode).** Rejected: would duplicate Claude's logic in JS. User wants Claude to stay the executor.
- **WebSocket-based realtime.** Rejected: SSE covers one-way streaming; WebSockets add framing complexity for no benefit.
- **Bun / Deno / Go single binary.** Rejected in Phase E plan: adds install dependency; Node stdlib is already required by mcp-server.

---

## Hand-off

```
Read this UX spec at mcp-server/dashboard/UX-SPEC.md. Produce a hi-fi-static deliverable: a single static index.html + styles.css under mcp-server/dashboard/public/ that renders S1, S2, S3, S4, S5 with the MOCK_DATA seed described in §8.7. Density type: dense/data-driven. Honor §8.3 per-screen position-4 answers. Use the keys-keeper visual vocabulary referenced in §7 (browser-frame chrome NOT required — this is the actual dashboard, not a canvas explorer; ship a real frontend). Accent: neon-green (#39ff14-leaning); replace keys-keeper's terracotta tokens. No build step. Vanilla JS only. Tailwind via Play CDN OK.
```

Round-trip: huashu produces the static prototype with MOCK_DATA; Phase E wires the real backend; no canvas iteration needed for v1.
