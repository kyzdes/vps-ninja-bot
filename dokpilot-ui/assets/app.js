/* Dokpilot UI — shared shell engine.
   Each screen ships <div class="layout" data-page="X"> + a hand-written <main>.
   This file injects the persistent sidebar + topbar, runs the Simple/Advanced
   mode, the ⌘K command palette, the inline-Claude popovers, and per-page
   interactions. Prototype only — no real network calls; data is mocked.
*/
(() => {
"use strict";

/* ─── tiny dom helpers ──────────────────────────────────────────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; n.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return n;
};

/* ─── self-test instrumentation (Epic 0) ─────────────────────────────
   Deterministic page-state probe for autonomous browser testing.
   window.__DOK_PROBE__() (defined near the export) returns a structured
   snapshot so claude-in-chrome can assert against it instead of brittle
   querySelector scraping. We feed it two ring buffers populated below. */
const _probe = { apiErrors: [], toasts: [] };
const _ring = (arr, item, cap = 25) => { arr.push(item); if (arr.length > cap) arr.shift(); };

/* ─── icon set (Lucide-aligned, 24-grid) ────────────────────────────── */
const ICONS = {
  home:"<path d='M3 11l9-8 9 8'/><path d='M5 10v10h14V10'/>",
  apps:"<rect x='3' y='3' width='7' height='7' rx='1.5'/><rect x='14' y='3' width='7' height='7' rx='1.5'/><rect x='3' y='14' width='7' height='7' rx='1.5'/><rect x='14' y='14' width='7' height='7' rx='1.5'/>",
  deploy:"<path d='M12 4l4 4-4 4'/><path d='M4 12h12'/><path d='M4 20l4-4-4-4'/>",
  activity:"<polyline points='22 12 18 12 15 21 9 3 6 12 2 12'/>",
  globe:"<circle cx='12' cy='12' r='9'/><path d='M3 12h18'/><path d='M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18'/>",
  server:"<rect x='3' y='4' width='18' height='7' rx='1.5'/><rect x='3' y='13' width='18' height='7' rx='1.5'/><circle cx='6.5' cy='7.5' r='.7' fill='currentColor'/><circle cx='6.5' cy='16.5' r='.7' fill='currentColor'/>",
  database:"<ellipse cx='12' cy='5' rx='8' ry='3'/><path d='M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5'/><path d='M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'/>",
  spark:"<path d='M12 3v4M12 17v4M3 12h4M17 12h4'/><path d='M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4z'/>",
  settings:"<circle cx='12' cy='12' r='3'/><path d='M19.4 13.5a1.7 1.7 0 0 0 .3 1.9 2 2 0 1 1-2.3 3.1 1.7 1.7 0 0 0-2.8 1.1 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.8-1.1 2 2 0 1 1-2.3-3.1 1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1 2 2 0 1 1 0-3 1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9 2 2 0 1 1 2.3-3.1 1.7 1.7 0 0 0 2.8-1.1 2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.8 1.1 2 2 0 1 1 2.3 3.1 1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1 2 2 0 1 1 0 3 1.7 1.7 0 0 0-1.5 1z'/>",
  search:"<circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.5' y2='16.5'/>",
  plus:"<line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/>",
  chevron:"<polyline points='9 6 15 12 9 18'/>",
  chevdown:"<polyline points='6 9 12 15 18 9'/>",
  ext:"<path d='M15 3h6v6'/><path d='M10 14 21 3'/><path d='M18 13v8H3V6h8'/>",
  copy:"<rect x='9' y='9' width='11' height='11' rx='1.5'/><path d='M5 15V5a1 1 0 0 1 1-1h10'/>",
  lock:"<rect x='5' y='11' width='14' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>",
  key:"<circle cx='7' cy='14' r='4'/><path d='m11 12 9-9 3 3-3 3 2 2-2 2-2-2-2 2'/>",
  refresh:"<path d='M21 12a9 9 0 1 1-3-6.7L21 8'/><path d='M21 3v5h-5'/>",
  play:"<polygon points='6 4 20 12 6 20 6 4'/>",
  pause:"<rect x='6' y='4' width='4' height='16'/><rect x='14' y='4' width='4' height='16'/>",
  restart:"<path d='M3 12a9 9 0 1 0 2.6-6.4'/><path d='M3 4v4h4'/>",
  check:"<polyline points='20 6 9 17 4 12'/>",
  x:"<line x1='6' y1='6' x2='18' y2='18'/><line x1='18' y1='6' x2='6' y2='18'/>",
  warn:"<path d='M12 3 2 21h20L12 3z'/><line x1='12' y1='10' x2='12' y2='15'/><line x1='12' y1='18' x2='12' y2='18.5'/>",
  branch:"<line x1='6' y1='3' x2='6' y2='15'/><circle cx='18' cy='6' r='3'/><circle cx='6' cy='18' r='3'/><path d='M18 9a9 9 0 0 1-9 9'/>",
  cpu:"<rect x='5' y='5' width='14' height='14' rx='2'/><rect x='9' y='9' width='6' height='6'/><path d='M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3'/>",
  ram:"<rect x='3' y='7' width='18' height='10' rx='2'/><path d='M7 7v10M17 7v10'/>",
  disk:"<circle cx='12' cy='12' r='9'/><circle cx='12' cy='12' r='2.5'/>",
  link:"<path d='M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1'/><path d='M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1'/>",
  shield:"<path d='M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z'/>",
  trash:"<path d='M4 7h16'/><path d='M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'/><path d='M6 7l1 13h10l1-13'/>",
  terminal:"<polyline points='4 7 9 12 4 17'/><line x1='12' y1='17' x2='19' y2='17'/>",
  clock:"<circle cx='12' cy='12' r='9'/><polyline points='12 7 12 12 15 14'/>",
  send:"<path d='M22 2 11 13'/><path d='M22 2 15 22l-4-9-9-4 20-7z'/>",
  user:"<circle cx='12' cy='8' r='4'/><path d='M5 21a7 7 0 0 1 14 0'/>",
  panel:"<rect x='3' y='4' width='18' height='16' rx='2'/><line x1='9' y1='4' x2='9' y2='20'/>",
  filter:"<polygon points='3 4 21 4 14 12 14 19 10 21 10 12 3 4'/>",
  archive:"<rect x='3' y='4' width='18' height='4' rx='1'/><path d='M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8'/><line x1='10' y1='12' x2='14' y2='12'/>",
  bell:"<path d='M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9'/><path d='M13.7 21a2 2 0 0 1-3.4 0'/>",
  rocket:"<path d='M5 13c-1.5 1.3-2 5-2 5s3.7-.5 5-2'/><path d='M14 4c3 0 6 3 6 6 0 4-5 8-9 10-1.5-1-3-2.5-4-4 2-4 6-9 7-12z'/><circle cx='14.5' cy='9.5' r='1.6'/>",
};
const icon = (name, size = 16) =>
  el("span", { class: "icon", "aria-hidden": "true",
    html:`<svg viewBox='0 0 24 24' width='${size}' height='${size}' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'>${ICONS[name]||""}</svg>` });

/* ─── status helpers ────────────────────────────────────────────────── */
const KIND = {
  running:"success", healthy:"success", success:"success", done:"success", live:"success", connected:"success",
  building:"info", active:"info", deploying:"info",
  error:"danger", failed:"danger", down:"danger",
  stopped:"muted", pending:"muted", paused:"muted",
  "awaiting-answers":"warning", asking:"warning", warn:"warning",
};
const PRO_LABEL = {
  running:"running", healthy:"healthy", success:"success", building:"building", error:"error",
  stopped:"stopped", "awaiting-answers":"awaiting answers", live:"running", paused:"paused", deploying:"deploying",
};
const SIMPLE_LABEL = {
  running:"Live", healthy:"Online", success:"Done", building:"Building…", error:"Needs attention",
  stopped:"Off", "awaiting-answers":"Needs you", live:"Live", paused:"Paused", deploying:"Deploying…",
};
const badge = (status) => {
  const k = KIND[status] || "muted";
  return el("span", { class:`badge badge-${k}` },
    el("span", { class:`dot dot-${k}` + (k==="info"||k==="warning"?" dot-pulse":"") }),
    el("span", { class:"lbl", "data-adv":"" }, PRO_LABEL[status] || status),
    el("span", { class:"lbl", "data-simple":"" }, SIMPLE_LABEL[status] || status),
  );
};

/* ─── MOCK DATA (mirrors the shipped dashboard seed, extended) ──────── */
const DATA = window.DOKPILOT_DATA = {
  meta:{ version:"v4.0.0", port:52114, token:"a8f0…c4d1" },
  servers:[
    { id:"main", name:"main", ip:"77.90.43.8", ssh:"root", dokploy:"v0.29.5", status:"healthy", region:"Frankfurt · Hetzner",
      secret:"keychain", is_default:true, cpu:34, ram:62, disk:48, ram_gb:"5.0 / 8 GB", disk_gb:"96 / 200 GB", uptime:"23d 4h", apps:["app_001","app_002","app_003"] },
    { id:"edge", name:"edge", ip:"185.22.64.10", ssh:"root", dokploy:"v0.28.4", status:"healthy", region:"Helsinki · Hetzner",
      secret:"keychain", is_default:false, cpu:71, ram:58, disk:33, ram_gb:"2.3 / 4 GB", disk_gb:"26 / 80 GB", uptime:"8d 19h", apps:["app_004","app_005"] },
  ],
  apps:{
    app_001:{ id:"app_001", name:"kyzdes-portfolio", domain:"kyzdes.com", server:"main", stack:"Next.js 15", status:"running", last:"4h ago", builds:1,
      env:["NEXT_PUBLIC_API_URL","NEXT_PUBLIC_SENTRY_DSN","NODE_ENV","NEXTAUTH_SECRET","NEXTAUTH_URL","STRIPE_PUBLIC_KEY"], db:null, autodeploy:true },
    app_002:{ id:"app_002", name:"freezer-backend", domain:"api.freezer.app", server:"main", stack:"Node + Express", status:"running", last:"14h ago", builds:0,
      env:["DATABASE_URL","JWT_SECRET","PORT","REDIS_URL","SMTP_HOST","SMTP_USER","SMTP_PASS","NODE_ENV"], db:"freezer-pg", autodeploy:true },
    app_003:{ id:"app_003", name:"dokpilot-landing", domain:"dokpilot.dev", server:"main", stack:"Astro 4", status:"building", last:"54m ago", builds:3,
      env:["PUBLIC_PLAUSIBLE_DOMAIN","NODE_ENV"], db:null, autodeploy:true },
    app_004:{ id:"app_004", name:"logbook-api", domain:"logs.kyzdes.dev", server:"edge", stack:"FastAPI · Python 3.12", status:"running", last:"2d ago", builds:0,
      env:["DATABASE_URL","SECRET_KEY","ALLOWED_HOSTS","SENTRY_DSN"], db:"logbook-pg", autodeploy:false },
    app_005:{ id:"app_005", name:"metrics-collector", domain:null, server:"edge", stack:"Docker compose", status:"error", last:"9h ago", builds:4,
      env:["PROMETHEUS_URL","GRAFANA_TOKEN","INFLUX_TOKEN"], db:null, autodeploy:false,
      error:"Container exited (code 1): prometheus.yml scrape_config missing 'job_name'." },
  },
  deploys:{
    app_001:[ {sha:"a1f4c3e",branch:"main",status:"success",rel:"2m ago",dur:"47s",msg:"feat: switch hero copy to neon-green"},
              {sha:"7e9b218",branch:"main",status:"success",rel:"22h ago",dur:"49s",msg:"chore: bump dependencies"},
              {sha:"ff882a4",branch:"feat/blog",status:"error",rel:"5d ago",dur:"13s",msg:"feat(blog): MDX pipeline"} ],
    app_003:[ {sha:"88b4197",branch:"main",status:"building",rel:"5m ago",dur:"…",msg:"wip: dashboard section + brand swap"},
              {sha:"2a07ff1",branch:"main",status:"success",rel:"1d ago",dur:"38s",msg:"feat: evolution timeline v4 entry"} ],
    app_005:[ {sha:"cc4ab90",branch:"main",status:"error",rel:"9h ago",dur:"6s",msg:"fix: prometheus scrape config"} ],
  },
  activity:[
    {app:"kyzdes-portfolio",server:"main",status:"success",rel:"2m ago",dur:"47s"},
    {app:"dokpilot-landing",server:"main",status:"building",rel:"5m ago",dur:"…"},
    {app:"logbook-api",server:"edge",status:"success",rel:"1h ago",dur:"1m 12s"},
    {app:"metrics-collector",server:"edge",status:"error",rel:"9h ago",dur:"6s"},
    {app:"freezer-backend",server:"main",status:"success",rel:"14h ago",dur:"52s"},
  ],
  domains:[
    {host:"kyzdes.com",app:"kyzdes-portfolio",zone:"kyzdes.com",ssl:"active",proxied:true,ssl_exp:"82d",record:"A → 77.90.43.8"},
    {host:"api.freezer.app",app:"freezer-backend",zone:"freezer.app",ssl:"active",proxied:false,ssl_exp:"61d",record:"A → 77.90.43.8"},
    {host:"dokpilot.dev",app:"dokpilot-landing",zone:"dokpilot.dev",ssl:"issuing",proxied:true,ssl_exp:"—",record:"A → 77.90.43.8"},
    {host:"logs.kyzdes.dev",app:"logbook-api",zone:"kyzdes.dev",ssl:"active",proxied:true,ssl_exp:"44d",record:"A → 185.22.64.10"},
  ],
  databases:[
    {id:"freezer-pg",name:"freezer-pg",engine:"PostgreSQL 16",server:"main",status:"running",size:"312 MB",app:"freezer-backend",conns:"4 / 100"},
    {id:"logbook-pg",name:"logbook-pg",engine:"PostgreSQL 15",server:"edge",status:"running",size:"1.8 GB",app:"logbook-api",conns:"11 / 100"},
    {id:"freezer-redis",name:"freezer-redis",engine:"Redis 7",server:"main",status:"running",size:"42 MB",app:"freezer-backend",conns:"2 / 50"},
  ],
  job:{ id:"job_a1b2c3", repo:"github.com/kyzdes/notes-app", branch:"main", server:"main", domain:"notes.kyzdes.dev",
    stack:"Next.js 15 · pnpm · Node 20",
    log:[
      {t:"12:34:02",kind:"info",text:"Cloning github.com/kyzdes/notes-app (branch: main)…"},
      {t:"12:34:05",kind:"ok",text:"Cloned (4.2s · 18 objects · 612 KB)"},
      {t:"12:34:06",kind:"info",text:"Detecting stack…"},
      {t:"12:34:07",kind:"ok",text:"Next.js 15 detected (App Router, server actions)"},
      {t:"12:34:07",kind:"ok",text:"Node 20.x (from .nvmrc)"},
      {t:"12:34:08",kind:"warn",text:"3 required env vars missing — pausing for input"},
    ],
    questions:[
      {id:"q1",label:"NEXT_PUBLIC_API_URL",type:"text",ph:"https://api.notes.kyzdes.dev",hint:"Build-time public API endpoint"},
      {id:"q2",label:"Database",type:"select",opts:["postgres 16 (recommended)","sqlite (file-based)","no database"]},
      {id:"q3",label:"Auto-deploy on push",type:"select",opts:["yes — install GitHub App","no — manual deploys only"]},
    ],
  },
};

/* ─── navigation model ──────────────────────────────────────────────── */
const NAV = [
  { group:null, items:[
    { id:"onboarding", href:"onboarding.html", icon:"rocket", adv:"First deploy", simple:"Get started" },
    { id:"overview", href:"index.html", icon:"home",     adv:"Overview",  simple:"Home" },
    { id:"projects", href:"projects.html", icon:"apps",   adv:"Projects",  simple:"My apps" },
    { id:"deploy",   href:"deploy.html", icon:"deploy",   adv:"Deploy",    simple:"Deploy", dot:true },
    { id:"history",  href:"history.html", icon:"clock",   adv:"History",   simple:"Past deploys" },
    { id:"logs",     href:"logs.html", icon:"activity",   adv:"Logs & builds", simple:"Activity" },
    { id:"domains",  href:"domains.html", icon:"globe",   adv:"Domains & DNS", simple:"Domains" },
  ]},
  { group:"Infrastructure", adv:true, items:[
    { id:"servers",  href:"servers.html", icon:"server",  adv:"Servers",  simple:"Servers", admin:true },
    { id:"databases",href:"databases.html", icon:"database", adv:"Databases", simple:"Databases", admin:true },
    { id:"backups",  href:"backups.html", icon:"archive", adv:"Backups", simple:"Backups", admin:true },
    { id:"notifications", href:"notifications.html", icon:"bell", adv:"Notifications", simple:"Alerts", admin:true },
  ]},
  { group:null, items:[
    { id:"assistant",href:"assistant.html", icon:"spark", adv:"Claude console", simple:"Ask Claude" },
  ]},
];
const PAGE_META = {
  onboarding:{ crumb:"dokpilot / get started", adv:"First deploy", simple:"Get started" },
  overview:{ crumb:"dokpilot", adv:"Overview", simple:"Home", lead:{adv:"Everything running across your servers, at a glance.", simple:"Welcome back. Here's what's live and what needs you."} },
  projects:{ crumb:"dokpilot / projects", adv:"Projects", simple:"My apps" },
  deploy:{ crumb:"dokpilot / deploy", adv:"Deploy", simple:"Deploy something" },
  history:{ crumb:"dokpilot / history", adv:"Deploy history", simple:"Past deploys" },
  logs:{ crumb:"dokpilot / logs", adv:"Logs & builds", simple:"Activity" },
  domains:{ crumb:"dokpilot / domains", adv:"Domains & DNS", simple:"Domains" },
  servers:{ crumb:"dokpilot / servers", adv:"Servers", simple:"Servers" },
  databases:{ crumb:"dokpilot / databases", adv:"Databases", simple:"Databases" },
  backups:{ crumb:"dokpilot / backups", adv:"Backups & restore", simple:"Backups" },
  notifications:{ crumb:"dokpilot / notifications", adv:"Notifications", simple:"Alerts" },
  assistant:{ crumb:"dokpilot / assistant", adv:"Claude console", simple:"Ask Claude" },
  settings:{ crumb:"dokpilot / settings", adv:"Settings", simple:"Settings" },
};

/* ─── mode ──────────────────────────────────────────────────────────── */
const getMode = () => localStorage.getItem("dokpilot:mode") || "simple";
const setMode = (m) => {
  localStorage.setItem("dokpilot:mode", m);
  document.documentElement.dataset.mode = m;
  $$(".mode-opt").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
};
document.documentElement.dataset.mode = getMode();
document.documentElement.dataset.sidebar = localStorage.getItem("dokpilot:sidebar") || "expanded";

/* ─── sidebar ───────────────────────────────────────────────────────── */
function buildSidebar(page) {
  const nav = el("nav", { class:"sb-nav" });
  NAV.forEach(sec => {
    if (sec.group) nav.append(el("div", { class:"nav-group-label", "data-adv": sec.adv ? "" : null }, sec.group));
    sec.items.forEach(it => {
      const a = el("a", { class:"nav-item" + (it.id === page ? " active" : ""), href: it.href, "data-adv": it.admin ? "" : null, title: it.adv },
        icon(it.icon, 17),
        el("span", { class:"nav-label" },
          el("span", { "data-adv":"" }, it.adv),
          el("span", { "data-simple":"" }, it.simple)),
        it.dot ? el("span", { class:"nav-badge dot-only", title:"1 deploy in flight" }) : null,
      );
      nav.append(a);
    });
  });
  return el("aside", { class:"sidebar" },
    el("div", { class:"sb-brand" },
      el("button", { class:"sb-glyph", title:"Toggle sidebar", onclick: toggleSidebar }, "d"),
      el("span", { class:"sb-word" }, "dokpilot"),
      el("span", { class:"sb-ver" }, DATA.meta.version),
    ),
    nav,
    el("div", { class:"sb-foot" },
      el("a", { class:"nav-item" + (page === "settings" ? " active" : ""), href:"settings.html", title:"Settings" },
        icon("settings", 17),
        el("span", { class:"nav-label" }, "Settings")),
    ),
  );
}
function toggleSidebar() {
  const cur = document.documentElement.dataset.sidebar === "collapsed" ? "expanded" : "collapsed";
  document.documentElement.dataset.sidebar = cur;
  localStorage.setItem("dokpilot:sidebar", cur);
}

/* ─── topbar ────────────────────────────────────────────────────────── */
function buildTopbar(page) {
  const m = PAGE_META[page] || { crumb:"dokpilot", adv:page, simple:page };
  return el("header", { class:"topbar" },
    el("div", { class:"topbar-title" },
      el("span", { class:"topbar-crumb" }, m.crumb),
      el("h1", { class:"topbar-h" },
        el("span", { "data-adv":"" }, m.adv),
        el("span", { "data-simple":"" }, m.simple)),
    ),
    el("button", { class:"cmdk", onclick: openPalette, "aria-label":"Search or ask Claude" },
      icon("search", 14),
      el("span", null, "Search or ask Claude…"),
      el("span", { class:"cmdk-hint" }, "⌘K"),
    ),
    el("div", { class:"topbar-right" },
      modeToggle(),
      el("span", { class:"meta-chip hide-sm", title:"Local listen address", "data-adv":"" }, icon("lock", 11), "127.0.0.1:" + DATA.meta.port),
      el("button", { class:"icon-btn", title:"Refresh", onclick:()=>toast("Inventory refreshed", "refresh") }, icon("refresh", 16)),
    ),
  );
}
function modeToggle() {
  const mk = (mode, ic, txt, sub) => el("button", { class:"mode-opt", "data-mode":mode, "aria-pressed":String(getMode()===mode),
    title:sub, onclick:()=>{ setMode(mode); toast(mode==="simple"?"Simple mode — essentials only":"Advanced mode — full control", mode==="simple"?"home":"settings"); } },
    icon(ic, 13), el("span", { class:"mode-txt" }, txt));
  return el("div", { class:"mode-toggle", role:"group", "aria-label":"Interface mode" },
    mk("simple","home","Simple","Fewer controls, plain language — great for quick deploys"),
    mk("advanced","settings","Advanced","Full operator density — servers, DNS records, raw env, SSH"),
  );
}

/* ─── command palette ───────────────────────────────────────────────── */
function openPalette() {
  if ($(".cmdk-overlay")) return;
  const commands = [
    { sec:"Go to", items:[
      {icon:"home",label:"Overview",act:()=>go("index.html")},
      {icon:"apps",label:"Projects",act:()=>go("projects.html")},
      {icon:"deploy",label:"Deploy a new app",act:()=>go("deploy.html")},
      {icon:"globe",label:"Domains & DNS",act:()=>go("domains.html")},
      {icon:"server",label:"Servers",act:()=>go("servers.html")},
    ]},
    { sec:"Ask Claude", ai:true, items:[
      {icon:"spark",label:"Why did metrics-collector fail?",ai:true,act:()=>{closePalette();go("assistant.html?q=metrics-collector");}},
      {icon:"spark",label:"Deploy github.com/… to a server",ai:true,act:()=>{closePalette();go("deploy.html");}},
      {icon:"spark",label:"Open the Claude console",ai:true,act:()=>go("assistant.html")},
    ]},
  ];
  const list = el("div", { class:"cmdk-list" });
  const renderList = (q="") => {
    list.innerHTML = "";
    commands.forEach(grp => {
      const matched = grp.items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()));
      if (!matched.length) return;
      list.append(el("div", { class:"cmdk-sec" }, grp.sec));
      matched.forEach(i => list.append(el("button", { class:"cmdk-row" + (i.ai?" ai":""), onclick:i.act },
        icon(i.icon, 15), el("span", null, i.label), i.ai ? el("span", { class:"kbd" }, "↵ ask") : el("span", { class:"kbd" }, "↵"))));
    });
    if (!list.children.length) list.append(el("div", { class:"cmdk-row", style:{color:"var(--muted)"} }, "No matches — try the Claude console."));
  };
  renderList();
  const input = el("input", { class:"cmdk-input", placeholder:"Search screens, or type a question for Claude…", autofocus:"true",
    oninput:(e)=>renderList(e.target.value) });
  const ov = el("div", { class:"cmdk-overlay", onclick:(e)=>{ if(e.target===ov) closePalette(); } },
    el("div", { class:"cmdk-panel" },
      el("div", { class:"cmdk-input-row" }, icon("search", 17), input),
      list,
    ));
  document.body.append(ov);
  input.focus();
}
function closePalette(){ $(".cmdk-overlay")?.remove(); }
const go = (href) => { location.href = href; };

/* ─── toast ─────────────────────────────────────────────────────────── */
let toastWrap;
function toast(msg, ic = "check", err = false) {
  _ring(_probe.toasts, { msg: String(msg), err: !!err, t: Date.now() });
  if (!toastWrap) { toastWrap = el("div", { class:"toast-wrap" }); document.body.append(toastWrap); }
  const t = el("div", { class:"toast" + (err?" err":"") }, icon(err?"warn":ic, 16), el("span", null, msg));
  toastWrap.append(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(()=>t.remove(), 300); }, 2600);
}

/* ─── copy buttons ──────────────────────────────────────────────────── */
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-copy]");
  if (!c) return;
  navigator.clipboard?.writeText(c.dataset.copy).catch(()=>{});
  toast("Copied to clipboard", "copy");
});

/* ─── keyboard ──────────────────────────────────────────────────────── */
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $(".cmdk-overlay") ? closePalette() : openPalette(); }
  if (e.key === "Escape") { closePalette(); $(".overlay")?.remove(); if (openPop){ openPop.remove(); openPop=null; } }
});

/* ─── API client + adapter ──────────────────────────────────────────── */
/* When the dashboard is served by /dokpilot ui (via mcp-server/ui-server),
   /api/* is live. We boot-fetch the read-only endpoints and overwrite the
   MOCK_DATA fields. If any endpoint returns non-2xx or the server isn't
   reachable, the MOCK_DATA stays — UI keeps rendering, just with the
   prototype seed. This is the G-015 progressive-enhancement contract. */
async function api(path, opts = {}) {
  try {
    const headers = { ...(opts.headers || {}) };
    // The ui-server injects window.__DOKPILOT_TOKEN__ via inline <script>
    // when it serves any .html. Cookie auth also works (when present),
    // but bearer is bulletproof across browsers / automation contexts.
    const tok = window.__DOKPILOT_TOKEN__;
    if (tok && !headers["Authorization"]) headers["Authorization"] = "Bearer " + tok;
    const res = await fetch(path, { credentials: "include", ...opts, headers });
    if (!res.ok) {
      _ring(_probe.apiErrors, { path, status: res.status, t: Date.now() });
      // Try to surface the server's JSON error body for diagnostics
      try {
        const body = await res.json();
        return { __error: true, status: res.status, ...body };
      } catch {
        return { __error: true, status: res.status };
      }
    }
    return await res.json();
  } catch (e) {
    _ring(_probe.apiErrors, { path, status: 0, message: String(e?.message || e), t: Date.now() });
    return { __error: true, message: String(e?.message || e) };
  }
}

/** POST helper that auto-includes X-CSRF header. Returns the API
 *  response (or {__error:true, status} on failure). When the dashboard
 *  is in MOCK mode (no token), returns {__error:true, mock:true} so
 *  callers can fall back to MOCK behavior. */
async function postAction(path, body, extraHeaders = {}) {
  if (!window.__DOKPILOT_TOKEN__) return { __error: true, mock: true };
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF": window.__DOKPILOT_TOKEN__, ...extraHeaders },
    body: JSON.stringify(body || {}),
  });
}

const niceTime = (iso) => {
  if (!iso) return "—";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  if (diff < 60_000)      return Math.round(diff / 1_000) + "s ago";
  if (diff < 3_600_000)   return Math.round(diff / 60_000) + "m ago";
  if (diff < 86_400_000)  return Math.round(diff / 3_600_000) + "h ago";
  return Math.round(diff / 86_400_000) + "d ago";
};

function adaptServers(apiServers) {
  return apiServers.map((s) => ({
    id: s.id, name: s.name, ip: s.ip,
    ssh: s.ssh_user, dokploy: s.dokploy_version || "—",
    status: s.status === "healthy" ? "healthy" : (s.status || "unknown"),
    region: "—",                  // future: /api/servers/:name/stats may include
    secret: s.secret,
    is_default: !!s.is_default,
    // Metrics — populated by lazy /api/servers/:name/stats fetch (M2 wires this)
    cpu: null, ram: null, disk: null,
    ram_gb: "—", disk_gb: "—",
    uptime: "—",
    project_count: s.project_count,
    app_count:     s.app_count,
    compose_count: s.compose_count,
    database_count: s.database_count,
    apps: [],
    error: s.error || null,
  }));
}

function adaptApps(apiApps) {
  const map = {};
  for (const a of apiApps) {
    map[a.id] = {
      id: a.id, name: a.name,
      domain: a.domain,
      server: a.server,
      stack: a.stack || "auto-detect",
      status: a.status,
      last: niceTime(a.last_deploy),
      last_iso: a.last_deploy,
      builds: 0,
      env: [],          // detail fetch fills this in
      db: null,
      autodeploy: !!a.autodeploy,
      kind: a.kind,
      project_id: a.project_id,
      project_name: a.project_name,
    };
  }
  return map;
}

function adaptJob(apiJob) {
  // Match the OD page's expected shape: repo, branch, server, domain, stack,
  // log[], questions[], id. Real /api/jobs/:id returns most of this already.
  return {
    id: apiJob.id,
    repo: apiJob.repo || "",
    branch: apiJob.branch || "main",
    server: apiJob.server || "",
    domain: apiJob.domain || "",
    stack: apiJob.detected_stack || apiJob.stack || "auto-detect",
    log: apiJob.log || [],
    questions: (apiJob.questions || []).map(q => ({
      id: q.id, label: q.label, type: q.type,
      ph: q.placeholder, opts: q.options, hint: q.hint,
      answer: q.answer,
    })),
    status: apiJob.status,
  };
}

function synthActivity(apiApps) {
  return apiApps
    .filter((a) => a.last_deploy)
    .sort((x, y) => new Date(y.last_deploy) - new Date(x.last_deploy))
    .slice(0, 8)
    .map((a) => ({
      app: a.name,
      server: a.server,
      status: a.status === "running" ? "success" : a.status,
      rel: niceTime(a.last_deploy),
      dur: "—",
    }));
}

/* Boot strategy:
   - Health check first — if 401/404, stay on MOCK_DATA forever.
   - AWAIT the fast endpoints (servers ~700ms, apps ~600ms) so the
     dashboard's hero view (inventory + activity) renders with real
     data without flicker.
   - Fire-and-forget the slow ones (domains 5s+ N+1, databases 2s
     N+1). When they resolve, patch DATA and dispatch a
     `dokpilot:data-updated` event so the active page can rerender
     just the affected widgets without a full reload.
*/
async function bootData() {
  // Clean ?t= from URL bar on first load so the bearer token doesn't
  // linger in browser history. The token is already captured into
  // window.__DOKPILOT_TOKEN__ by the server-injected <script>.
  if (window.__DOKPILOT_TOKEN__ && location.search.includes("t=")) {
    try {
      const u = new URL(location.href);
      u.searchParams.delete("t");
      const clean = u.pathname + (u.search === "?" ? "" : u.search) + u.hash;
      history.replaceState(null, "", clean);
    } catch {}
  }

  const h = await api("/api/health");
  if (h.__error) {
    if (window.console) console.info("[dokpilot] /api/health not reachable — staying on MOCK_DATA");
    return false;
  }

  // Fast: await
  const [servers, apps] = await Promise.all([
    api("/api/servers"),
    api("/api/apps"),
  ]);

  if (!servers.__error && Array.isArray(servers.servers)) {
    DATA.servers = adaptServers(servers.servers);
  }
  if (!apps.__error && Array.isArray(apps.apps)) {
    DATA.apps = adaptApps(apps.apps);
    DATA.activity = synthActivity(apps.apps);

    // Populate DATA.servers[i].apps[] with app IDs belonging to each server.
    // projects.html iterates `s.apps.map(id => DATA.apps[id])`, so we need
    // the IDs grouped per server.
    if (Array.isArray(DATA.servers)) {
      for (const s of DATA.servers) {
        s.apps = apps.apps.filter((a) => a.server === s.id).map((a) => a.id);
      }
    }
    // (v4.3 H5) Removed the legacy app_001..app_005 MOCK-id alias hack: pages
    // now read live data directly (projects iterates server app-ids; index's
    // "needs attention" filters real error/stopped apps), so the aliases were
    // dead weight.
  }

  Object.assign(window.Dok || (window.Dok = {}), { api, live: true });
  document.documentElement.dataset.dataSource = "live";

  // Replace MOCK meta (port/token/version) with the real launch values so
  // settings.html + the topbar chip show the actual listen address.
  if (!h.__error) {
    DATA.meta = DATA.meta || {};
    if (h.port) DATA.meta.port = h.port;
    if (h.version) DATA.meta.version = h.version;
    // token preview: first 4 + last 4 of the real token (never the full value
    // beyond what's already in window.__DOKPILOT_TOKEN__)
    const tok = window.__DOKPILOT_TOKEN__;
    if (tok && tok.length > 10) DATA.meta.token = tok.slice(0, 4) + "…" + tok.slice(-4);
  }

  // Live in-flight job — replace MOCK DATA.job with the latest real
  // non-terminal job, or clear it if none. The OD pageInit on index.html
  // / overview reads DATA.job to render the "Deploy in flight" card;
  // when we're live we don't want a stale MOCK seed flashing in there.
  const jobsP = api("/api/jobs").then((r) => {
    if (r.__error || !Array.isArray(r.jobs)) return;
    const active = r.jobs.find(j => j.status && j.status !== "done" && j.status !== "error");
    if (active) {
      // Hydrate the full job state so the card has questions/log too
      api(`/api/jobs/${active.id}`).then((full) => {
        if (!full.__error && full.job) {
          DATA.job = adaptJob(full.job);
          document.dispatchEvent(new CustomEvent("dokpilot:data-updated", { detail: { kind: "job" } }));
        }
      });
    } else {
      // No in-flight job → blank out the MOCK seed so the index "in-flight" card
      // renders empty (pageInit guards against undefined fields).
      DATA.job = { id: null, repo: "", branch: "", server: "", domain: "", stack: "", log: [], questions: [] };
      DATA.__no_inflight = true;
    }
  });

  // Page-aware blocking: if the user is on a page whose primary content
  // is the slow data, await it so pageInit renders with real values
  // first-paint. Otherwise fire-and-forget and emit data-updated event.
  const page = document.querySelector(".layout")?.dataset?.page;
  // For overview/index page, await jobsP so the in-flight card renders right
  if (page === "overview") await jobsP;
  const domainsP = api("/api/domains").then((r) => {
    if (!r.__error && Array.isArray(r.domains)) {
      DATA.domains = r.domains;
      document.dispatchEvent(new CustomEvent("dokpilot:data-updated", { detail: { kind: "domains" } }));
    }
  });
  const dbsP = api("/api/databases").then((r) => {
    if (!r.__error && Array.isArray(r.databases)) {
      DATA.databases = r.databases;
      document.dispatchEvent(new CustomEvent("dokpilot:data-updated", { detail: { kind: "databases" } }));
    }
  });
  if (page === "domains")    await domainsP;
  if (page === "databases")  await dbsP;

  return true;
}

/* ─── live log streaming (Epic 2) ────────────────────────────────────
   Opens an EventSource against /api/deploys/:id/log/stream and invokes
   onLine(lineObj) for each `log` event. Returns { close() } so the
   caller can tear down on selection change. If we don't yet know the
   deployId, the helper queries /api/apps/:id/deploys to find the most
   recent one with a logPath, then connects.

   Robustness:
     - Auto-reconnect handled natively by EventSource for transient
       network blips (within the same server process).
     - If the response status was 404 (no deploys yet), the SSE
       reports `error` once and stops — caller may show empty state.
*/
async function startLogStream({ appId, server, deployId }, callbacks = {}) {
  if (!window.__DOKPILOT_TOKEN__) return { close(){} };          // mock mode
  const cb = { onMeta: () => {}, onLine: () => {}, onDone: () => {}, onError: () => {}, ...callbacks };

  // If we have no deployId, fetch the latest deploy id for this app
  if (!deployId) {
    const dl = await api(`/api/apps/${encodeURIComponent(appId)}/deploys?server=${encodeURIComponent(server)}`);
    if (dl.__error || !Array.isArray(dl.deploys) || dl.deploys.length === 0) {
      cb.onError({ reason: "no-deploys" });
      return { close(){} };
    }
    const recent = dl.deploys.find((d) => d.log_path) || dl.deploys[0];
    deployId = recent.id;
  }

  // EventSource doesn't support custom headers — we have to pass the
  // bearer token via query string. The server already accepts ?t=… as
  // a valid token source.
  const url = `/api/deploys/${encodeURIComponent(deployId)}/log/stream`
    + `?server=${encodeURIComponent(server)}`
    + `&appId=${encodeURIComponent(appId)}`
    + `&t=${encodeURIComponent(window.__DOKPILOT_TOKEN__)}`;

  const es = new EventSource(url, { withCredentials: true });
  es.addEventListener("meta",  (e) => { try { cb.onMeta(JSON.parse(e.data)); } catch {} });
  es.addEventListener("log",   (e) => { try { cb.onLine(JSON.parse(e.data)); } catch {} });
  es.addEventListener("done",  (e) => { try { cb.onDone(JSON.parse(e.data)); } catch {} es.close(); });
  es.addEventListener("error", (e) => { cb.onError({ readyState: es.readyState }); });
  es.addEventListener("close", () => { es.close(); });

  return { close() { try { es.close(); } catch {} } };
}

/* ─── self-test probe (Epic 0) ──────────────────────────────────────
   Returns a deterministic snapshot of the current page state. Used by
   the autonomous browser-test loop (claude-in-chrome) to assert that a
   page rendered live (not MOCK), has the expected action buttons, and
   logged no API errors. Pure read — no side effects. */
window.__DOK_PROBE__ = function () {
  const layout = document.querySelector(".layout");
  const content = document.querySelector(".content") || document.body;
  const countOf = (x) => Array.isArray(x) ? x.length
    : (x && typeof x === "object" ? Object.keys(x).length : 0);
  const labels = $$("button, .btn, a.nav-item", content)
    .map(b => (b.getAttribute("aria-label") || b.textContent || "").trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const overlay = document.querySelector(".overlay, .cmdk-overlay, .modal");
  return {
    page: layout?.dataset?.page || null,
    live: !!(window.Dok && window.Dok.live),
    dataSource: document.documentElement.dataset.dataSource || "mock",
    error: _probe.apiErrors.length > 0,
    counts: {
      servers:   countOf(DATA.servers),
      apps:      countOf(DATA.apps),
      domains:   countOf(DATA.domains),
      databases: countOf(DATA.databases),
      deploys:   countOf(DATA.deploys),
    },
    actions: Array.from(new Set(labels)).slice(0, 50),
    openModal: overlay ? (overlay.className || "modal") : null,
    apiErrors: _probe.apiErrors.slice(-10),
    toasts: _probe.toasts.slice(-5),
  };
};

/* ─── expose for per-page scripts ───────────────────────────────────── */
window.Dok = { $, $$, el, icon, badge, toast, DATA, go, openPalette, api, postAction, startLogStream, live: false };

/* Skeleton placeholders shown while bootData() is in flight, tailored to the
   slot shape: the glance strip keeps its cells, inline chips get a small bar,
   everything else gets a few shimmer rows. */
function injectSkeleton(n) {
  if (n.classList.contains("glance-strip")) {
    for (let i = 0; i < 4; i++) {
      n.append(el("div", { class: "glance skel-glance" },
        el("div", { class: "skel-line", style: { width: "42%", height: "18px" } }),
        el("div", { class: "skel-line skel-sm", style: { width: "62%", marginTop: "6px" } })));
      if (i < 3) n.append(el("div", { class: "glance-sep" }));
    }
    return;
  }
  // Small inline slots (listen address, token chip, version) — one short bar.
  if (n.tagName === "SPAN" || n.classList.contains("meta-chip") || n.classList.contains("codeblock")) {
    n.append(el("span", { class: "skel-line", style: { width: "84px", height: "12px", display: "inline-block" } }));
    return;
  }
  // Default: a few shimmer rows for list / card content areas.
  const wrap = el("div", { class: "skel", "aria-hidden": "true" });
  for (let i = 0; i < 3; i++) wrap.append(el("div", { class: "skel-row" },
    el("div", { class: "skel-line", style: { width: (56 - i * 9) + "%" } }),
    el("div", { class: "skel-line skel-sm", style: { width: "16%", marginLeft: "auto" } })));
  n.append(wrap);
}

/* ─── boot: mount shell, fetch live data, then run page hook ────────── */
document.addEventListener("DOMContentLoaded", async () => {
  const layout = $(".layout");
  if (!layout) return;
  const page = layout.dataset.page;
  // Pages ship a STATIC sidebar + topbar so the layout renders correctly even
  // with JS disabled (e.g. preview panes). When JS runs, swap that static
  // shell for the fully-interactive one — strip first to avoid duplicates.
  layout.querySelectorAll(":scope > .sidebar[data-static]").forEach(n => n.remove());
  const content = layout.querySelector(".content");
  content.querySelectorAll(":scope > .topbar[data-static]").forEach(n => n.remove());
  layout.prepend(buildSidebar(page));
  content.prepend(buildTopbar(page));
  setMode(getMode());
  // Page bodies ship PRE-RENDERED content (so the no-JS preview shows real
  // data). Empty those slots now so the page hook below rebuilds them
  // interactively instead of duplicating what's already there.
  layout.querySelectorAll("[data-fallback], [data-lead-slot]").forEach(n => { n.innerHTML = ""; });
  // While bootData() fetches (slow on a cold/loaded server), show a calm
  // loading state — a slim top progress bar + per-slot skeletons — instead of
  // blank cards. Both are torn down right before pageInit rebuilds the slots.
  const bootBar = el("div", { class: "boot-bar", role: "progressbar", "aria-label": "Loading" });
  document.body.append(bootBar);
  const skelSlots = Array.from(layout.querySelectorAll("[data-fallback]"));
  skelSlots.forEach(injectSkeleton);
  // page lead (optional)
  const meta = PAGE_META[page];
  const leadSlot = $("[data-lead-slot]");
  if (leadSlot && meta?.lead) {
    leadSlot.append(
      el("span", { "data-adv":"" }, meta.lead.adv),
      el("span", { "data-simple":"" }, meta.lead.simple));
  }
  // Boot live data (replaces MOCK_DATA fields when /api/* is reachable).
  // Per-page scripts read DATA after this, so they get real data when live.
  await bootData();
  // Tear down the loading state, then let the page hook fill the real content
  // (list consumers append into now-empty slots, so the skeletons must go).
  bootBar.remove();
  skelSlots.forEach(n => { n.innerHTML = ""; });
  if (typeof window.pageInit === "function") window.pageInit({ $, $$, el, icon, badge, toast, DATA, go });
});
})();
