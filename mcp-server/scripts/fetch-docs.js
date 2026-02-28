#!/usr/bin/env node

/**
 * Fetch latest Dokploy documentation from Context7.
 *
 * This script pulls docs from the Context7 API (which indexes docs.dokploy.com)
 * and saves them as local markdown files for the MCP server.
 *
 * Usage: node scripts/fetch-docs.js
 *
 * Run this periodically (e.g., when Dokploy releases a new version) to
 * keep the embedded docs up to date.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "..", "docs");

// Ensure docs directory exists
mkdirSync(DOCS_DIR, { recursive: true });

const CONTEXT7_API = "https://api.context7.com/v1";
const LIBRARY_ID = "/dokploy/website";

async function queryContext7(query, maxTokens = 8000) {
  const url = `${CONTEXT7_API}/query`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      libraryId: LIBRARY_ID,
      query,
      maxTokens,
    }),
  });

  if (!response.ok) {
    console.error(`Context7 API error: ${response.status} ${response.statusText}`);
    return null;
  }

  return await response.json();
}

async function fetchAndSave(query, filename, description) {
  console.log(`Fetching: ${description}...`);
  const result = await queryContext7(query);

  if (result && result.content) {
    writeFileSync(join(DOCS_DIR, filename), result.content, "utf-8");
    console.log(`  Saved: docs/${filename}`);
  } else {
    console.error(`  Failed to fetch: ${description}`);
  }
}

async function main() {
  console.log("Fetching Dokploy documentation from Context7...\n");

  const queries = [
    {
      query: "Dokploy REST API endpoints application create deploy update project create environment all methods request response format",
      filename: "api-reference.md",
      description: "API Reference",
    },
    {
      query: "Deploy application from GitHub repository step by step create project application environment build deploy",
      filename: "deploy-guide.md",
      description: "Deploy Guide",
    },
    {
      query: "Install Dokploy on VPS server setup Docker Traefik firewall initial configuration",
      filename: "setup-guide.md",
      description: "Setup Guide",
    },
    {
      query: "GitHub App auto-deploy autodeploy push branch automatic deployment configuration",
      filename: "auto-deploy.md",
      description: "Auto-Deploy Guide",
    },
    {
      query: "Troubleshooting SSL Let's Encrypt certificate build errors deployment failures common issues",
      filename: "troubleshooting.md",
      description: "Troubleshooting Guide",
    },
    {
      query: "GitHub integration private repositories GitHub App installation configuration git providers",
      filename: "github-integration.md",
      description: "GitHub Integration Guide",
    },
    {
      query: "Domain configuration SSL certificate HTTPS Let's Encrypt Traefik custom domain setup",
      filename: "domains-ssl.md",
      description: "Domains & SSL Guide",
    },
    {
      query: "PostgreSQL MySQL MongoDB Redis database create deploy connection string internal external",
      filename: "databases.md",
      description: "Databases Guide",
    },
    {
      query: "Docker Compose deployment compose create update deploy raw YAML multi-container",
      filename: "docker-compose.md",
      description: "Docker Compose Guide",
    },
  ];

  for (const q of queries) {
    await fetchAndSave(q.query, q.filename, q.description);
    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\nDone! Documentation saved to docs/");
  console.log("Note: If any files failed, the MCP server will fall back to the skill's built-in references.");
}

main().catch(console.error);
