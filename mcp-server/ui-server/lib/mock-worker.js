#!/usr/bin/env node
/* Mock deploy-job worker — walks a job file through its lifecycle for
   demo purposes (when there's no live Claude to actually deploy).
   Real worker is `/dokpilot deploy --job <id>` invoked from Claude
   Code; this stub lets the UI flow render without Claude running.

   Usage:
     node mock-worker.js <job-id>

   Behavior:
     1. status → analyzing-stack, append log lines simulating stack
        detection (clone, detect framework)
     2. status → awaiting-answers, populate 3 typical questions
        (env URL, database choice, auto-deploy)
     3. poll job file until all required answers are present
     4. status → deploying, simulate build log lines (every 800ms)
     5. status → wait-dns, simulate DNS provisioning
     6. status → finalizing, status → done with synthetic result
        (app_id, url) so the UI can render a success card.

   The mock NEVER actually deploys anything — it only writes to the
   job file. All "log lines" are fabricated for demo purposes.
*/
"use strict";

const path = require("node:path");
const { readJob, writeJob } = require("./jobs");

const id = process.argv[2];
if (!id) { console.error("usage: mock-worker.js <job-id>"); process.exit(2); }

// DOKPILOT_MOCK_FAST shrinks every sleep (hermetic tests / CI — T33). The lifecycle
// and state transitions are identical; only the wall-clock delays collapse.
const SLEEP_SCALE = process.env.DOKPILOT_MOCK_FAST ? 0.02 : 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Math.round(ms * SLEEP_SCALE))));

function ts() { return new Date().toTimeString().slice(0, 8); }

function appendLog(job, kind, text) {
  job.log = job.log || [];
  job.log.push({ t: ts(), kind, text });
}

function setStep(job, stepId, status) {
  const s = job.steps?.find((x) => x.id === stepId);
  if (s) s.status = status;
}

async function run() {
  let job = readJob(id);
  if (!job) { console.error("job not found:", id); process.exit(2); }

  // Stage 0: pending → analyzing-repo (Phase A — read-only clone + manifest)
  job.status = "analyzing-repo";
  job.worker = { pid: process.pid, started_at: new Date().toISOString(), host: "mock" };
  setStep(job, "analyze", "active");
  appendLog(job, "info", `Analyzing ${job.repo} (branch: ${job.branch}) — read-only clone…`);
  writeJob(job);
  await sleep(700);

  job = readJob(id);
  // Synthetic validated manifest (a real deploy gets this from Phase A).
  job.manifest = { manifest_schema_version: 1, stack: "unknown", port: null, build_type: "nixpacks", env_keys_needed: [], db_needs: [] };
  job.manifest_validation = { ok: true, flags: [], errors: [] };
  job.cost_phase_a = 0.0021;
  appendLog(job, "ok", "Manifest: stack analyzed (mock)");
  setStep(job, "analyze", "done");
  writeJob(job);
  await sleep(300);

  // Stage 1: analyzing-repo → analyzing-stack
  job = readJob(id);
  job.status = "analyzing-stack";
  setStep(job, "detect", "active");
  appendLog(job, "info", `Cloning ${job.repo} (branch: ${job.branch})…`);
  writeJob(job);
  await sleep(900);

  job = readJob(id);
  appendLog(job, "ok", "Cloned (1.4s · 32 objects)");
  appendLog(job, "info", "Detecting stack…");
  writeJob(job);
  await sleep(700);

  // Heuristic guess based on repo name (for demo flavor)
  const stack = job.repo.toLowerCase().includes("astro")     ? "Astro 4"
              : job.repo.toLowerCase().includes("next")      ? "Next.js 15 · pnpm · Node 20"
              : job.repo.toLowerCase().includes("fast")      ? "FastAPI · Python 3.12"
              : "Node 20 (auto-detected)";

  job = readJob(id);
  appendLog(job, "ok", `Stack: ${stack}`);
  setStep(job, "detect", "done");
  writeJob(job);
  await sleep(400);

  // Stage 2: awaiting-answers — populate questions, wait for user
  job = readJob(id);
  job.status = "awaiting-answers";
  setStep(job, "questions", "active");
  job.questions = [
    {
      id: "q_api_url",
      label: stack.startsWith("Next") ? "NEXT_PUBLIC_API_URL" : "Public API endpoint",
      type: "text",
      placeholder: `https://api.${job.domain || job.repo.split("/").pop() + ".dev"}`,
      hint: "Build-time public API endpoint",
      required: true,
      answer: null,
    },
    {
      id: "q_db",
      label: "Database",
      type: "select",
      options: ["postgres 16 (recommended)", "sqlite (file-based)", "no database"],
      required: true,
      answer: null,
    },
    {
      id: "q_autodeploy",
      label: "Auto-deploy on push",
      type: "select",
      options: ["yes — install GitHub App", "no — manual deploys only"],
      required: true,
      answer: null,
    },
  ];
  appendLog(job, "warn", `${job.questions.length} required env vars missing — pausing for input`);
  appendLog(job, "info", "Awaiting answers via dashboard…");
  writeJob(job);

  // Poll until all required questions are answered
  while (true) {
    await sleep(700);
    job = readJob(id);
    const pending = (job.questions || []).filter((q) => q.required && (q.answer == null || q.answer === ""));
    if (pending.length === 0) break;
  }

  // Stage 3: deploying
  job = readJob(id);
  job.status = "deploying";
  setStep(job, "questions", "done");
  setStep(job, "deploy", "active");
  appendLog(job, "info", "All answers received. Starting build…");
  writeJob(job);
  await sleep(600);

  const buildLines = [
    ["info", "$ pnpm install --frozen-lockfile"],
    ["ok",   "Lockfile resolved · 412 packages"],
    ["info", "$ pnpm build"],
    ["info", "[builder] starting…"],
    ["info", "[builder] type-checking…"],
    ["ok",   "[builder] compiled in 14.2s"],
    ["info", "$ docker build -t " + job.repo.split("/").pop() + ":latest ."],
    ["info", "=> [internal] load build definition"],
    ["info", "=> [internal] load .dockerignore"],
    ["info", "=> [stage 0] FROM node:20-alpine"],
    ["info", "=> [stage 1] COPY . ."],
    ["info", "=> exporting layers"],
    ["ok",   "Image built · pushed to local registry"],
  ];
  for (const [kind, text] of buildLines) {
    await sleep(450);
    job = readJob(id);
    appendLog(job, kind, text);
    writeJob(job);
  }

  // Stage 4: wait-dns
  job = readJob(id);
  job.status = "wait-dns";
  setStep(job, "deploy", "done");
  setStep(job, "dns", "active");
  appendLog(job, "info", "Provisioning DNS A record + TLS certificate…");
  writeJob(job);
  await sleep(1100);

  const targetDomain = job.domain || (job.repo.split("/").pop() + ".example.com");
  job = readJob(id);
  appendLog(job, "ok", `DNS A record → 203.0.113.10 created (Cloudflare, no-proxy)`);
  appendLog(job, "ok", `Let's Encrypt cert issued for ${targetDomain}`);
  writeJob(job);
  await sleep(500);

  // Stage 5: finalizing → done
  job = readJob(id);
  job.status = "finalizing";
  setStep(job, "dns", "done");
  setStep(job, "finalize", "active");
  appendLog(job, "info", "Starting container, waiting for health check…");
  writeJob(job);
  await sleep(800);

  job = readJob(id);
  appendLog(job, "ok", "Container healthy");
  setStep(job, "finalize", "done");
  // Synthetic cost so the UI / e2e can exercise the cost-capture path without a
  // live Claude run. A real deploy gets this from the stream-json `result` message.
  job.cost_usd = 0.0123;
  job.status = "done";
  job.result = {
    app_id: "mock_" + Math.random().toString(36).slice(2, 9),
    url: `https://${targetDomain}`,
    server: job.server,
    deployed_at: new Date().toISOString(),
  };
  appendLog(job, "ok", `🎉 Live at https://${targetDomain}`);
  writeJob(job);
}

run().catch((err) => {
  console.error("[mock-worker] error:", err);
  const job = readJob(id);
  if (job) {
    job.status = "error";
    job.error = String(err.message || err);
    appendLog(job, "error", "Worker crashed: " + (err.message || err));
    writeJob(job);
  }
  process.exit(1);
});
