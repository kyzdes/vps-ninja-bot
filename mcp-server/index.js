#!/usr/bin/env node

/**
 * Dokploy Docs MCP Server
 *
 * Provides Dokploy documentation as MCP tools so that AI agents
 * can get accurate API reference and guides without web searching.
 *
 * Tools:
 *   - dokploy_api_reference: Full API endpoint reference
 *   - dokploy_guide: Get a specific guide (deploy, setup, auto-deploy, troubleshooting)
 *   - dokploy_search: Search docs by keyword
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "docs");

// Load documentation files
function loadDoc(filename) {
  const filepath = join(DOCS_DIR, filename);
  if (existsSync(filepath)) {
    return readFileSync(filepath, "utf-8");
  }
  return `Documentation file not found: ${filename}. Run "npm run build-docs" to fetch latest docs.`;
}

// Search across all docs
function searchDocs(query) {
  const files = [
    "api-reference.md",
    "deploy-guide.md",
    "setup-guide.md",
    "auto-deploy.md",
    "troubleshooting.md",
    "github-integration.md",
    "domains-ssl.md",
    "databases.md",
    "docker-compose.md",
  ];

  const queryLower = query.toLowerCase();
  const results = [];

  for (const file of files) {
    const content = loadDoc(file);
    if (content.includes("not found")) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        // Get surrounding context (5 lines before and after)
        const start = Math.max(0, i - 5);
        const end = Math.min(lines.length, i + 6);
        const context = lines.slice(start, end).join("\n");
        results.push({
          file,
          line: i + 1,
          context,
        });
        // Skip ahead to avoid duplicate contexts
        i = end;
      }
    }
  }

  return results.slice(0, 10); // Limit to 10 results
}

// Create server
const server = new Server(
  {
    name: "dokploy-docs",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "dokploy_api_reference",
      description:
        "Get Dokploy REST API reference for a specific category (projects, applications, databases, domains, deployments, compose, settings). Returns endpoint details with request/response formats.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              'API category: "all", "projects", "applications", "databases", "domains", "deployments", "compose", "settings", "auto-deploy"',
            enum: [
              "all",
              "projects",
              "applications",
              "databases",
              "domains",
              "deployments",
              "compose",
              "settings",
              "auto-deploy",
            ],
          },
        },
        required: ["category"],
      },
    },
    {
      name: "dokploy_guide",
      description:
        "Get a specific Dokploy guide. Available guides: deploy (deploying from GitHub), setup (VPS setup from scratch), auto-deploy (GitHub App integration), troubleshooting (common errors and fixes), domains-ssl (domain and certificate setup), databases (creating and managing DBs), docker-compose (compose deployments).",
      inputSchema: {
        type: "object",
        properties: {
          guide: {
            type: "string",
            description: "Guide name",
            enum: [
              "deploy",
              "setup",
              "auto-deploy",
              "troubleshooting",
              "domains-ssl",
              "databases",
              "docker-compose",
              "github-integration",
            ],
          },
        },
        required: ["guide"],
      },
    },
    {
      name: "dokploy_search",
      description:
        "Search across all Dokploy documentation by keyword. Returns matching sections with context.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (keyword or phrase)",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "dokploy_api_reference": {
      const category = args.category || "all";
      const content = loadDoc("api-reference.md");

      if (category === "all") {
        return { content: [{ type: "text", text: content }] };
      }

      // Extract specific section
      const sectionMap = {
        projects: "## Projects",
        applications: "## Applications",
        databases: "## Databases",
        domains: "## Domains",
        deployments: "## Deployments",
        compose: "## Docker Compose",
        settings: "## Settings",
        "auto-deploy": "## Auto-deploy",
      };

      const sectionHeader = sectionMap[category];
      if (!sectionHeader) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown category: ${category}. Available: ${Object.keys(sectionMap).join(", ")}`,
            },
          ],
        };
      }

      const startIdx = content.indexOf(sectionHeader);
      if (startIdx === -1) {
        return {
          content: [
            {
              type: "text",
              text: `Section "${category}" not found in API reference.`,
            },
          ],
        };
      }

      // Find next section of same level
      const afterHeader = content.substring(startIdx + sectionHeader.length);
      const nextSectionMatch = afterHeader.match(/\n## [^#]/);
      const endIdx = nextSectionMatch
        ? startIdx + sectionHeader.length + nextSectionMatch.index
        : content.length;

      const section = content.substring(startIdx, endIdx);
      return { content: [{ type: "text", text: section }] };
    }

    case "dokploy_guide": {
      const guideMap = {
        deploy: "deploy-guide.md",
        setup: "setup-guide.md",
        "auto-deploy": "auto-deploy.md",
        troubleshooting: "troubleshooting.md",
        "domains-ssl": "domains-ssl.md",
        databases: "databases.md",
        "docker-compose": "docker-compose.md",
        "github-integration": "github-integration.md",
      };

      const filename = guideMap[args.guide];
      if (!filename) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown guide: ${args.guide}. Available: ${Object.keys(guideMap).join(", ")}`,
            },
          ],
        };
      }

      const content = loadDoc(filename);
      return { content: [{ type: "text", text: content }] };
    }

    case "dokploy_search": {
      const results = searchDocs(args.query);
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No results found for "${args.query}".`,
            },
          ],
        };
      }

      const formatted = results
        .map(
          (r) =>
            `### ${r.file} (line ${r.line})\n\`\`\`\n${r.context}\n\`\`\``
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${results.length} result(s) for "${args.query}":\n\n${formatted}`,
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// List resources (docs as browsable resources)
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "dokploy://docs/api-reference",
      name: "Dokploy API Reference",
      description: "Complete REST API endpoint documentation",
      mimeType: "text/markdown",
    },
    {
      uri: "dokploy://docs/auto-deploy",
      name: "Auto-Deploy Guide",
      description: "GitHub App integration and auto-deploy setup",
      mimeType: "text/markdown",
    },
    {
      uri: "dokploy://docs/troubleshooting",
      name: "Troubleshooting Guide",
      description: "Common issues and solutions",
      mimeType: "text/markdown",
    },
  ],
}));

// Read resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const docMap = {
    "dokploy://docs/api-reference": "api-reference.md",
    "dokploy://docs/auto-deploy": "auto-deploy.md",
    "dokploy://docs/troubleshooting": "troubleshooting.md",
  };

  const filename = docMap[uri];
  if (!filename) {
    return {
      contents: [
        { uri, mimeType: "text/plain", text: `Unknown resource: ${uri}` },
      ],
    };
  }

  return {
    contents: [{ uri, mimeType: "text/markdown", text: loadDoc(filename) }],
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Dokploy Docs MCP server running on stdio");
}

main().catch(console.error);
