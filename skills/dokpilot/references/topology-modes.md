# Topology modes — single / independent / cluster

dokpilot supports three ways to organize Dokploy across servers. The active mode is recorded in
`config/servers.json` → `"mode"`. **Detect it on every multi-server operation and behave accordingly.**

When the user is setting up, adding a 2nd+ server, or asking how to scale / balance load —
**proactively present these three modes and recommend one** based on their goal (see decision guide below).
Don't silently assume a mode.

---

## The three modes

### 1. `single` — one server, one panel  (default / simplest)
- One VPS running Dokploy; everything deploys there.
- **Placement:** trivial — only one target.
- **Pick when:** starting out, a single box, low volume, simplicity over everything.
- **Config:** one entry in `servers`, no `nodes`, `mode: "single"`.

### 2. `independent` — multiple parallel panels (each server runs its OWN Dokploy)
- N servers, each with its own Dokploy panel (own `dokploy_url` + `dokploy_api_key`). Managed separately.
- **Placement:** choose which **server / panel** by purpose (prod vs staging vs experiments, region, client).
- **Strengths:** strong isolation — blast radius is per-server; one panel down ≠ others affected; clean
  prod/staging/client separation; independent upgrades; different owners or regions.
- **Costs:** N admin UIs, N credential sets, no single pane of glass, no cross-server load balancing.
- **Pick when:** isolation matters (separate environments / clients / regions), or you explicitly don't
  want a shared control plane to be a single point of failure.
- **Config:** multiple entries in `servers`, each with its own url+key; `mode: "independent"`.

### 3. `cluster` — one panel, multiple nodes (Dokploy Remote Servers)   ← the user's current setup
- One Dokploy control plane manages multiple nodes. Deploy from ONE panel; pick the node via `serverId`
  in the API body (`null` = panel host, a node's `server_id` = remote).
- **Placement:** the RAM-aware node-placement policy in `references/server-placement.md` (co-location first).
- **Strengths:** single admin UI / one pane of glass; rebalance load across boxes from one place; one
  credential set; simplest day-to-day ops.
- **Costs:** the control-plane host is a single point of *management* failure (if the panel host dies you
  lose the UI/API — but apps already deployed on each node keep running); nodes must be reachable by the
  panel over SSH. A Docker registry is needed only for true Swarm replica scheduling, NOT for Remote
  Servers (each node builds locally).
- **Pick when:** one owner wants unified management + load balancing across a few boxes with minimal ops.
- **Config:** one `servers` entry (the panel) with a `nodes` map; `mode: "cluster"`.

---

## How to recommend (decision guide)

Ask the user's primary goal, then map:

| User's goal | Recommend |
|-------------|-----------|
| "just one box / keep it simple" | **single** |
| "hard isolation, separate prod & staging / clients / regions, no shared SPOF" | **independent** |
| "one admin panel + balance load across my boxes" (single owner scaling one workload) | **cluster** (sensible default when scaling past one box) |

Modes can be **mixed** (e.g., two independent panels, one of which is itself a cluster) — but present the
three as the primary mental model. Always state the trade-off in one line when recommending.

---

## Switching modes

- **single → cluster:** add the 2nd box as a Remote Server under the existing panel (provision node,
  register via `server.create` + run setup, add to `nodes`). Proven A+B procedure & runbook:
  `~/dokploy-migration-2026-06-03/REPORT.md`.
- **single / cluster → independent:** stand up a separate Dokploy on the other box; add it as its own
  `servers` entry with its own url+key. (This is exactly what the user's two boxes were BEFORE consolidation.)
- **independent → cluster:** retire the secondary panel, join its box as a node under the primary —
  tear down the standalone Dokploy first (it holds 80/443/3000 and will conflict with the remote Traefik).

---

## Per-mode deploy behavior (what the agent does on "deploy X")

| Mode | Choose target by | How the target is set |
|------|------------------|-----------------------|
| `single` | n/a (only one) | the default server |
| `independent` | which **panel** (purpose / isolation) — ask if ambiguous | pick `servers.<name>` (its own url + key) |
| `cluster` | which **node** (RAM headroom + co-location → `server-placement.md`) | `serverId` in the API body on the one panel |
