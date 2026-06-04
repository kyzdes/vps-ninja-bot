"use strict";
const { json } = require("../lib/http");
const csrf = require("../lib/csrf");
const {
  dokploy, cloudflareCreate, readConfig, listServerNames,
} = require("../lib/exec");

/** Read JSON body with a 64KB cap. */
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (c) => {
      length += c.length;
      if (length > max) {
        reject(Object.assign(new Error("body too large"), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const buf = Buffer.concat(chunks).toString("utf8");
      if (!buf) return resolve(null);
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(Object.assign(new Error("invalid json: " + e.message), { code: 400 })); }
    });
    req.on("error", reject);
  });
}

const ENGINE_FIELD = {
  postgres: { idField: "postgresId", createEndpoint: "postgres.create", deployEndpoint: "postgres.deploy", defaultImage: "postgres:16-alpine" },
  mysql:    { idField: "mysqlId",    createEndpoint: "mysql.create",    deployEndpoint: "mysql.deploy",    defaultImage: "mysql:8.0" },
  mariadb:  { idField: "mariadbId",  createEndpoint: "mariadb.create",  deployEndpoint: "mariadb.deploy",  defaultImage: "mariadb:11" },
  mongo:    { idField: "mongoId",    createEndpoint: "mongo.create",    deployEndpoint: "mongo.deploy",    defaultImage: "mongo:7" },
  redis:    { idField: "redisId",    createEndpoint: "redis.create",    deployEndpoint: "redis.deploy",    defaultImage: "redis:7-alpine" },
};

/**
 * POST /api/domains
 *   Body: { host, app_id, app_kind?, server, port?, https?, certificate_type? }
 *   1. Dokploy `domain.create` (binds host → app on the proxy)
 *   2. cloudflare-dns.sh create (A record → server IP, --no-proxy
 *      because Let's Encrypt HTTP-01 needs direct origin access)
 *
 *   Returns { domain, dns_record, dokploy_response }
 */
async function createDomain(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body) return json(res, 400, { error: "missing-body" });

  const { host, app_id, app_kind = "application", server, port = 80, https = true } = body;
  if (!host || !app_id || !server) {
    return json(res, 400, { error: "missing-fields", required: ["host", "app_id", "server"] });
  }

  const cfg = readConfig({ maskSecrets: false });
  if (cfg.__error || !cfg.servers?.[server]) return json(res, 400, { error: "unknown-server" });
  const serverIp = cfg.servers[server].host;

  // Pick the right Dokploy endpoint based on app kind
  const idKey = app_kind === "compose" ? "composeId" : "applicationId";
  const payload = {
    [idKey]: app_id,
    host,
    port: Number(port) || 80,
    https: !!https,
    certificateType: "letsencrypt",
    path: "/",
  };

  const dokploy_resp = await dokploy(server, "POST", "domain.create", payload);
  if (dokploy_resp.__error) return json(res, 502, { error: "dokploy-failed", ...dokploy_resp });

  // Cloudflare A record
  const cf = await cloudflareCreate(host, serverIp);
  if (cf.__error) {
    // Don't roll back the Dokploy domain — user can retry CF manually
    return json(res, 207, {
      partial: true,
      dokploy: dokploy_resp,
      cloudflare: { __error: true, ...cf },
      note: "Dokploy domain created but CF DNS failed. Add the A record manually.",
    });
  }

  json(res, 201, {
    domain: { host, app_id, server, port, https, certificate_type: "letsencrypt" },
    dns_record: cf.record,
    dokploy: dokploy_resp,
  });
}

/**
 * POST /api/apps/:id/redeploy   Body: { server, kind? }
 * POST /api/apps/:id/restart    Body: { server, kind? }
 * POST /api/apps/:id/stop       Body: { server, kind? }
 */
function makeAppAction(action) {
  return async function (req, res, ctx, params) {
    if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, e.code || 400, { error: e.message }); }
    const server = body?.server || req.query?.server;
    const kind = body?.kind || "application";
    if (!server) return json(res, 400, { error: "missing-server" });

    const endpoints = {
      application: {
        redeploy:      "application.redeploy",
        restart:       "application.start",
        stop:          "application.stop",
        reload:        "application.reload",          // KYZ-104 graceful restart
        "kill-build":  "application.killBuild",       // KYZ-102 queue aborts
        "cancel-deploy": "application.cancelDeployment",
        "clean-queue": "application.cleanQueues",
        "delete":      "application.delete",          // H3 (v4.3)
      },
      compose: {
        redeploy:      "compose.redeploy",            // KYZ-104 (was compose.deploy)
        deploy:        "compose.deploy",
        restart:       "compose.start",
        stop:          "compose.stop",
        "kill-build":  "compose.killBuild",
        "cancel-deploy": "compose.cancelDeployment",
        "clean-queue": "compose.cleanQueues",
        "delete":      "compose.delete",
      },
    };
    const ep = endpoints[kind]?.[action];
    if (!ep) return json(res, 400, { error: "unknown-action-or-kind", action, kind });

    const idField = kind === "application" ? "applicationId" : "composeId";
    // delete is destructive: the script refuses it without DOKPILOT_CONFIRM_DESTROY.
    // The dashboard's Remove action is already user-confirmed in the UI, so set it.
    const opts = action === "delete" ? { env: { DOKPILOT_CONFIRM_DESTROY: "1" } } : {};
    const r = await dokploy(server, "POST", ep, { [idField]: params.id }, opts);
    if (r.__error) return json(res, 502, { error: "dokploy-failed", ...r });
    json(res, 200, { action, app_id: params.id, kind, server, response: r });
  };
}

/**
 * POST /api/databases
 *   Body: { engine, name, server, project_id?, env_id?, docker_image?, deploy?:true }
 *   Creates the database via <engine>.create; if deploy:true, also
 *   calls <engine>.deploy to spin up the container.
 */
async function createDatabase(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body) return json(res, 400, { error: "missing-body" });

  const { engine, name, server, project_id, env_id, docker_image } = body;
  const deploy = body.deploy !== false; // default true
  if (!engine || !name || !server) {
    return json(res, 400, { error: "missing-fields", required: ["engine", "name", "server"] });
  }
  const cfg = ENGINE_FIELD[engine];
  if (!cfg) return json(res, 400, { error: "unknown-engine", supported: Object.keys(ENGINE_FIELD) });

  // The exact create payload shape varies per engine in Dokploy.
  // Universal fields: name, environmentId, dockerImage, externalPort (auto).
  const payload = {
    name,
    description: `Created via Dokpilot dashboard at ${new Date().toISOString()}`,
    dockerImage: docker_image || cfg.defaultImage,
    environmentId: env_id,
    projectId: project_id,
  };

  const createResp = await dokploy(server, "POST", cfg.createEndpoint, payload);
  if (createResp.__error) return json(res, 502, { error: "create-failed", ...createResp });

  // Extract the new DB id
  const data = createResp.result?.data || createResp;
  const newId = data[cfg.idField] || data.id;
  if (!newId) return json(res, 502, { error: "create-returned-no-id", response: createResp });

  if (!deploy) return json(res, 201, { id: newId, engine, name, response: createResp });

  // Deploy the container
  const deployResp = await dokploy(server, "POST", cfg.deployEndpoint, { [cfg.idField]: newId });
  if (deployResp.__error) {
    return json(res, 207, {
      partial: true,
      created: { id: newId, engine, name },
      deploy: { __error: true, ...deployResp },
      note: "DB created in Dokploy but deploy failed. Retry from the Dokploy UI.",
    });
  }

  json(res, 201, { id: newId, engine, name, deployed: true });
}

/**
 * POST /api/apps/:id/reload   Body: { server, kind? }
 * Graceful restart (KYZ-104). Dokploy v0.29+ requires appName too — we fetch
 * application.one first (KYZ-240, mirrors KI-012/G-016 family). Compose paths
 * use compose.reload which only needs composeId.
 */
async function reloadApp(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server || req.query?.server;
  const kind = body?.kind || "application";
  if (!server) return json(res, 400, { error: "missing-server" });

  if (kind === "compose") {
    const r = await dokploy(server, "POST", "compose.reload", { composeId: params.id });
    if (r.__error) return json(res, 502, { error: "dokploy-failed", ...r });
    return json(res, 200, { action: "reload", app_id: params.id, kind, server, response: r });
  }

  const app = await dokploy(server, "GET", `application.one?applicationId=${encodeURIComponent(params.id)}`);
  if (app.__error) return json(res, 502, { error: "lookup-failed", ...app });
  const appName = app.appName;
  if (!appName) return json(res, 502, { error: "no-appName", note: "application.one returned no appName" });

  const r = await dokploy(server, "POST", "application.reload", { applicationId: params.id, appName });
  if (r.__error) return json(res, 502, { error: "dokploy-failed", ...r });
  json(res, 200, { action: "reload", app_id: params.id, kind, server, response: r });
}

/**
 * POST /api/projects/:id/delete   Body: { server }
 * Removes a Dokploy project (and its apps). H3 (v4.3) — closes the
 * cleanup gap (previously only doable via the CLI).
 */
async function deleteProject(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server || req.query?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  // project.remove is the highest-blast-radius delete; the script refuses it
  // without DOKPILOT_CONFIRM_DESTROY. This route is reached only via the UI's
  // strong-confirm Remove, so authorize it here.
  const r = await dokploy(server, "POST", "project.remove", { projectId: params.id }, { env: { DOKPILOT_CONFIRM_DESTROY: "1" } });
  if (r.__error) return json(res, 502, { error: "dokploy-failed", ...r });
  json(res, 200, { deleted: params.id, server });
}

module.exports = {
  "POST /api/domains":               createDomain,
  "POST /api/apps/:id/redeploy":     makeAppAction("redeploy"),
  "POST /api/apps/:id/restart":      makeAppAction("restart"),
  "POST /api/apps/:id/stop":         makeAppAction("stop"),
  "POST /api/apps/:id/reload":       reloadApp,                        // KYZ-104 (needs appName, KYZ-240)
  "POST /api/apps/:id/kill-build":   makeAppAction("kill-build"),      // KYZ-102
  "POST /api/apps/:id/cancel-deploy":makeAppAction("cancel-deploy"),   // KYZ-102
  "POST /api/apps/:id/clean-queue":  makeAppAction("clean-queue"),     // KYZ-102
  "POST /api/apps/:id/delete":       makeAppAction("delete"),          // H3
  "POST /api/projects/:id/delete":   deleteProject,                    // H3
  "POST /api/databases":             createDatabase,
};
