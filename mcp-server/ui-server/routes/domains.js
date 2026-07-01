"use strict";
const { json } = require("../lib/http");
const csrf = require("../lib/csrf");
const { listServerNames, dokploy, cloudflareList, readConfig, allSettledMap } = require("../lib/exec");

function readBody(req, max = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on("data", (c) => { len += c.length; if (len > max) { reject(Object.assign(new Error("body too large"), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { const b = Buffer.concat(chunks).toString("utf8"); if (!b) return resolve(null); try { resolve(JSON.parse(b)); } catch (e) { reject(Object.assign(new Error("invalid json"), { code: 400 })); } });
    req.on("error", reject);
  });
}

function unwrapList(r) {
  if (Array.isArray(r)) return r;
  if (r?.result?.data) return r.result.data;
  return [];
}

/**
 * Naive zone extraction: last two labels, with .co.uk-style fallback
 * to last three when the second-to-last label is ≤3 chars (per KI-006).
 */
function zoneOf(host) {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  if (parts[parts.length - 2].length <= 3 && parts.length >= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

/**
 * Validate a DNS hostname before it is forwarded to Cloudflare or Dokploy.
 * Rules: a non-empty string ≤253 chars, made of dot-separated LDH labels
 * (letters/digits/hyphen, 1–63 chars each, no leading/trailing hyphen) with
 * at least two labels, and NO scheme, port, path, or whitespace. This rejects
 * URLs (http://…), `host:port`, `host/path`, and injection-y input before it
 * can reach an external API.
 */
function isValidHost(host) {
  if (typeof host !== "string") return false;
  if (host.length === 0 || host.length > 253) return false;
  if (/[\s\/\\:]/.test(host)) return false; // no whitespace, path, backslash, scheme/port colon
  const labels = host.split(".");
  if (labels.length < 2) return false;      // require host.tld at minimum
  const labelRe = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  return labels.every((l) => labelRe.test(l));
}

/**
 * GET /api/domains
 *   Returns every domain across all configured servers + their CF
 *   record state. Two-stage fetch:
 *     1. Walk project.all per server → identify apps that have domains
 *        (we get app IDs from environments[].applications/compose).
 *     2. For each app, call application.one (or compose.one) to get
 *        the domain array. This is the expensive part — N parallel
 *        calls. Acceptable because the Domains page is opened on
 *        demand, not on every dashboard load.
 *     3. Group hosts by zone and fetch CF DNS records per zone.
 *     4. Cross-reference: each domain gets its CF record (or null).
 */
async function listDomains(req, res) {
  const names = listServerNames();
  if (names.length === 0) return json(res, 200, { domains: [], empty: true });

  // Step 1: discover all (server, kind, app-id) tuples
  const projectsByServer = await allSettledMap(names, async (name) => {
    const r = await dokploy(name, "GET", "project.all");
    if (r.__error) return { error: r };
    return { projects: unwrapList(r) };
  });

  const appTuples = []; // {server, kind, id, app_name, project_name}
  for (const name of names) {
    const r = projectsByServer[name];
    if (r.error) continue;
    for (const proj of (r.projects || [])) {
      for (const env of (proj.environments || [])) {
        for (const a of (env.applications || [])) {
          appTuples.push({ server: name, kind: "application", id: a.applicationId, app_name: a.name, project_name: proj.name });
        }
        for (const c of (env.compose || [])) {
          appTuples.push({ server: name, kind: "compose", id: c.composeId, app_name: c.name, project_name: proj.name });
        }
      }
    }
  }

  // Step 2: fetch detail per app to read domains[]
  // Dokploy convention: ID goes in query string, not body (per reference).
  const details = await allSettledMap(appTuples.map((t, i) => String(i)), async (idx) => {
    const t = appTuples[Number(idx)];
    const endpoint = t.kind === "application"
      ? `application.one?applicationId=${encodeURIComponent(t.id)}`
      : `compose.one?composeId=${encodeURIComponent(t.id)}`;
    const r = await dokploy(t.server, "GET", endpoint);
    if (r.__error) return { error: r };
    const data = r.result?.data || r;
    return { domains: data.domains || [], tuple: t };
  });

  // Flatten domains
  const allDomains = [];
  for (const idx of Object.keys(details)) {
    const r = details[idx];
    if (r.error || !r.domains) continue;
    for (const d of r.domains) {
      allDomains.push({
        host: d.host,
        domain_id: d.domainId,
        app: r.tuple.app_name,
        app_id: r.tuple.id,
        app_kind: r.tuple.kind,
        server: r.tuple.server,
        project: r.tuple.project_name,
        port: d.port,
        https: d.https,
        certificate_type: d.certificateType,
        ssl: d.certificateType === "letsencrypt" ? "active" : "missing",
      });
    }
  }

  // Step 3: discover unique zones and fetch CF DNS
  const zones = [...new Set(allDomains.map((d) => zoneOf(d.host)))];
  const zoneRecords = await allSettledMap(zones, async (zone) => {
    const r = await cloudflareList(zone);
    if (r.__error) return { error: r };
    // exec.js's cloudflareList parses the script's newline-delimited JSON
    // into { records: [{name, content, type, proxied, ...}] }
    const records = r.records || [];
    const byName = {};
    for (const rec of records) byName[rec.name] = rec;
    return { byName };
  });

  // Step 4: enrich
  const enriched = allDomains.map((d) => {
    const zone = zoneOf(d.host);
    const rec = zoneRecords[zone]?.byName?.[d.host];
    if (!rec) return { ...d, zone, record: null, proxied: null };
    return {
      ...d,
      zone,
      record: `${rec.type} → ${rec.content}`,
      proxied: !!rec.proxied,
      record_id: rec.id,
      record_ttl: rec.ttl,
    };
  });

  json(res, 200, { domains: enriched, zone_count: zones.length });
}

/** POST /api/domains/:id/update  Body: { server, host?, port?, https?, path?, certificate_type? } */
async function updateDomain(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  if (body.host != null && !isValidHost(body.host)) return json(res, 400, { error: "invalid-host" });
  const payload = { domainId: params.id };
  if (body.host != null) payload.host = body.host;
  if (body.port != null) payload.port = Number(body.port);
  if (body.https != null) payload.https = !!body.https;
  if (body.path != null) payload.path = body.path;
  if (body.certificate_type) payload.certificateType = body.certificate_type;
  const r = await dokploy(server, "POST", "domain.update", payload);
  if (r && r.__error) return json(res, 502, { error: "update-failed", ...r });
  json(res, 200, { updated: params.id, response: r });
}

/** DELETE /api/domains/:id?server=<name> */
async function deleteDomain(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  const server = req.query?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  const r = await dokploy(server, "POST", "domain.delete", { domainId: params.id });
  if (r && r.__error) return json(res, 502, { error: "delete-failed", ...r });
  json(res, 200, { deleted: params.id });
}

/** POST /api/domains/validate  Body: { server, host } — does DNS point at the server? */
async function validateDomain(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server;
  const host = body?.host;
  if (!server || !host) return json(res, 400, { error: "missing-fields", required: ["server", "host"] });
  if (!isValidHost(host)) return json(res, 400, { error: "invalid-host" });
  const cfg = readConfig({ maskSecrets: false });
  const serverIp = cfg.servers?.[server]?.host;
  if (!serverIp) return json(res, 400, { error: "unknown-server" });
  const r = await dokploy(server, "POST", "domain.validateDomain", { domain: host, serverIp });
  if (r && r.__error) return json(res, 200, { ok: false, server_ip: serverIp, error: (r.stderr || "validation failed").slice(0, 300) });
  json(res, 200, { ok: true, server_ip: serverIp, response: r });
}

/** POST /api/domains/generate  Body: { server, app_name } — quick traefik.me subdomain */
async function generateDomain(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  const cfg = readConfig({ maskSecrets: false });
  const serverId = cfg.servers?.[server]?.dokploy_server_id || undefined; // local host = undefined
  const payload = { appName: body?.app_name || "app" };
  if (serverId) payload.serverId = serverId;
  const r = await dokploy(server, "POST", "domain.generateDomain", payload);
  if (r && r.__error) return json(res, 502, { error: "generate-failed", ...r });
  json(res, 200, { domain: r });
}

module.exports = {
  "GET /api/domains": listDomains,
  "POST /api/domains/:id/update": updateDomain,
  "DELETE /api/domains/:id": deleteDomain,
  "POST /api/domains/validate": validateDomain,
  "POST /api/domains/generate": generateDomain,
};
