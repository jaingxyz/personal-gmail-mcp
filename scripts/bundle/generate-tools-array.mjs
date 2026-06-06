#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz

// Spawn the compiled MCP server, send tools/list, and emit the JSON array of
// tools (with full inputSchemas) that Smithery's ServerCard.tools schema
// expects. Used by the bundle build to produce a complete manifest.json.
//
// Usage: node scripts/bundle/generate-tools-array.mjs
// Reads:  dist/index.js (must be built first)
// Writes: stdout (a JSON array of tool objects)

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, "..", "..", "dist", "index.js");

const child = spawn(process.execPath, [distEntry], {
  env: {
    ...process.env,
    // Placeholders — config.ts requires these set, but we never make a Google
    // call so the values don't have to be valid.
    GOOGLE_CLIENT_ID: "schema-only",
    GOOGLE_CLIENT_SECRET: "schema-only",
  },
  stdio: ["pipe", "pipe", "inherit"],
});

const messages = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "manifest-gen", version: "0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
];

for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");

let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
});

await new Promise((r) => setTimeout(r, 1500));
child.stdin.end();
child.kill();

const responses = buf
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const list = responses.find((r) => r.id === 2);
if (!list?.result?.tools) {
  console.error("[manifest-gen] never received tools/list result");
  process.exit(1);
}

const cleaned = list.result.tools.map((t) => {
  const schema = { ...(t.inputSchema || {}) };
  // Smithery's nested inputSchema validator rejects $schema and unknown keys
  // at the root. Keep only {type, properties, required}.
  delete schema.$schema;
  delete schema.additionalProperties;

  const out = {
    name: t.name,
    description: t.description ?? "",
    inputSchema: schema,
  };
  if (t.annotations && Object.keys(t.annotations).length > 0) {
    out.annotations = t.annotations;
  }
  return out;
});

process.stdout.write(JSON.stringify(cleaned, null, 2) + "\n");
