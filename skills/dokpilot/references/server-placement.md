# Server placement — which node to deploy to (cluster mode)

In `cluster` mode the Dokploy panel is a **single control plane managing multiple nodes**.
When deploying a NEW app/stack, you must decide WHICH node it runs on and set `serverId` accordingly.
This guide is the placement policy. Apply it whenever the user says "deploy X" without naming a node,
and surface a recommendation with a one-line reason ("recommending the compute node because …").

## The targets

**Read the nodes from `config/servers.json` → `servers.<panel>.nodes` (authoritative) — never hardcode
them.** A fresh single-server config has no `nodes` map at all; in that case there is one node and
placement is a no-op. When the panel *does* manage extra nodes, each entry looks like this (placeholder
values shown — your real config carries the actual IPs and serverIds):

| Node | IP (from config) | `serverId` in API body | Role (from config `role`) |
|------|------------------|------------------------|---------------------------|
| **A** | `203.0.113.10` | `null` (omit / local) | control-plane (the panel) + light web apps |
| **B** | `203.0.113.11` | `<remote-serverId>` | heavy compute / offload node |

> Roles drift over time — **re-check live metrics, don't trust the config table blindly.** A node is
> rarely empty (an "offload" node may already carry a large stack), and internal hostnames can be
> misleading — **always key off IP / serverId from the config, never the hostname.**

## The constraint

**RAM is usually the binding resource. CPU is often idle** (compare live load — cores are frequently
underused). So placement is typically a memory-headroom decision, not a CPU one.

## Decision algorithm

1. **Check live free RAM on both nodes** — never trust stale numbers, the balance is dynamic:
   ```bash
   bash scripts/ssh-exec.sh main 'free -h'                 # node A (panel host)
   bash scripts/ssh-exec.sh <B-ssh> 'free -h'              # node B  — see note below
   ```
   B is reachable over SSH with the same key (see `config/servers.json`). If B isn't a
   separate `servers.*` entry, SSH to it directly at its configured IP:
   `ssh -o StrictHostKeyChecking=accept-new root@<node-B-ip> 'free -h'`.
   You can also read per-container memory via `docker stats --no-stream` on each node.

2. **Co-location wins.** If X belongs to / talks to an existing stack (shared internal network or DB),
   put it on the **same node as that stack**. Separate nodes are separate Docker Swarms — overlay networks do
   NOT span nodes, so a split stack cannot reach itself internally.

3. **By size + headroom:**
   - **Light** (< ~512 MiB: landing, static site, small bot, small API) → the **light-app host** (the
     control-plane node).
   - **Heavy** (> ~1 GiB: LLM/ML, large DB, memory-hungry service) → the node with **more free RAM right
     now**, leaving **≥ 1.5 GiB free** after deploy. For an independent heavy workload prefer the
     **dedicated compute node** (its role), but if that node's free RAM < (X's need + 1.5 GiB) → use the
     control-plane node instead.

4. **Invariant — never induce swap.** After the deploy the target must keep ≥ ~1.5 GiB free (on the
   control-plane node, prefer ≥ 2 GiB since it also runs the panel). If neither node fits, **do not deploy
   silently** — tell the user (bigger box / move something off / scale out).

## How to actually target a node

The node is selected by the `serverId` field in the Dokploy API body — NOT by a separate panel/api_key.

- **Deploy/move a Dokploy application or compose** → include `serverId` in the create/update body, then redeploy:
  ```bash
  # control-plane node (local): omit serverId or send null.
  # remote node: send its serverId (read it from config or `server.all`).
  bash scripts/dokploy-api.sh main POST application.update \
    '{"applicationId":"<id>","serverId":"<remote-serverId>"}'
  bash scripts/dokploy-api.sh main POST application.redeploy '{"applicationId":"<id>"}'
  ```
  (List remote nodes any time: `bash scripts/dokploy-api.sh main GET server.all`.)

- **A raw docker-compose stack that is NOT a Dokploy app** (e.g. a hand-rolled stack under `/opt`): there
  is no `serverId` — you move it at the compose level (copy dir + volumes + traefik dynamic files, flip
  DNS). Follow your own migration runbook for the exact procedure.

## Worked examples

| User asks | Recommend | Why |
|-----------|-----------|-----|
| "deploy this landing page" | **light-app host** | light → light-app host, ample headroom |
| "add a companion service for my existing stack" | **the node that stack runs on** | co-location (shared internal network) |
| "deploy a new ~2 GiB ML service" | check `free -h`; if the compute node is tight → **control-plane node** | heavy + invariant: keep ≥1.5 GiB free, no swap |
