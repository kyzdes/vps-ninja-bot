# Server placement — which node to deploy to (A vs B)

The Dokploy panel (`https://dokploy.moone.dev`) is a **single control plane managing multiple nodes**.
When deploying a NEW app/stack, you must decide WHICH node it runs on and set `serverId` accordingly.
This guide is the placement policy. Apply it whenever the user says "deploy X" without naming a node,
and surface a recommendation with a one-line reason ("recommending B because …").

## The targets

Read them from `config/servers.json` → `servers.main.nodes` (authoritative). As of 2026-06-03:

| Node | IP | `serverId` in API body | Role |
|------|----|------------------------|------|
| **A** | 77.90.43.8 | `null` (omit / local) | Dokploy control-plane (the panel) + ~16 light web apps / landings / bots |
| **B** | 77.90.6.169 | `mZHUfILci8j_Wd2byDXT8` | Heavy LLM compute (litellm / open-webui / cliproxy) + RustDesk relay |

> Roles drift over time — **re-check live metrics, don't trust this table blindly.** And note: B is NOT
> empty (it carries the LLM stack ~3 GiB). Internal hostnames are inverted (A reports `Experiments`,
> B reports `Production`) — always key off IP / serverId, never the hostname.

## The constraint

**RAM is the binding resource. CPU is idle on both** (4 cores each, load < 0.3). So placement is a
memory-headroom decision, not a CPU one.

## Decision algorithm

1. **Check live free RAM on both nodes** — never trust stale numbers, the balance is dynamic:
   ```bash
   bash scripts/ssh-exec.sh main 'free -h'                 # node A (panel host)
   bash scripts/ssh-exec.sh <B-ssh> 'free -h'              # node B  — see note below
   ```
   B is reachable over SSH with the same key (`config/servers.json`, host `77.90.6.169`). If B isn't a
   separate `servers.*` entry, SSH to it directly: `ssh -o StrictHostKeyChecking=accept-new root@77.90.6.169 'free -h'`.
   You can also read per-container memory via `docker stats --no-stream` on each node.

2. **Co-location wins.** If X belongs to / talks to an existing stack (shared internal network or DB),
   put it on the **same node as that stack**. A and B are separate Docker Swarms — overlay networks do
   NOT span nodes, so a split stack cannot reach itself internally.

3. **By size + headroom:**
   - **Light** (< ~512 MiB: landing, static site, small bot, small API) → **A** (the light-app host).
   - **Heavy** (> ~1 GiB: LLM/ML, large DB, memory-hungry service) → the node with **more free RAM right
     now**, leaving **≥ 1.5 GiB free** after deploy. For an independent heavy workload prefer **B** (its
     role), but if B's free RAM < (X's need + 1.5 GiB) → use **A**.

4. **Invariant — never induce swap.** After the deploy the target must keep ≥ ~1.5 GiB free (on A,
   prefer ≥ 2 GiB since it runs the control plane). If neither node fits, **do not deploy silently** —
   tell the user (bigger box / move something off / scale out).

## How to actually target a node

The node is selected by the `serverId` field in the Dokploy API body — NOT by a separate panel/api_key.

- **Deploy/move a Dokploy application or compose** → include `serverId` in the create/update body, then redeploy:
  ```bash
  # A (local): omit serverId or send null.  B (remote): send its serverId.
  bash scripts/dokploy-api.sh main POST application.update \
    '{"applicationId":"<id>","serverId":"mZHUfILci8j_Wd2byDXT8"}'
  bash scripts/dokploy-api.sh main POST application.redeploy '{"applicationId":"<id>"}'
  ```
  (List remote nodes any time: `bash scripts/dokploy-api.sh main GET server.all`.)

- **A raw docker-compose stack that is NOT a Dokploy app** (e.g. `/opt/llm-gateway`): there is no
  `serverId` — you move it at the compose level (copy dir + volumes + traefik dynamic files, flip DNS).
  See the migration runbook at `~/dokploy-migration-2026-06-03/REPORT.md` for the proven procedure.

## Worked examples

| User asks | Recommend | Why |
|-----------|-----------|-----|
| "deploy this landing page" | **A** | light → light-app host, ~4 GiB headroom |
| "add a companion bot for open-webui" | **B** | co-location with the LLM stack (internal network) |
| "deploy a new ~2 GiB ML service" | check `free -h`; if B is tight → **A** | heavy + invariant: keep ≥1.5 GiB free, no swap |
