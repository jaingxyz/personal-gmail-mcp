#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz

// Build TWO manifest.json variants:
//
//   bundle/manifest.json
//     "Slim" form: tools[] entries are { name, description } only. The
//     @anthropic-ai/mcpb packer's validator rejects extra fields like
//     inputSchema, so this is what we feed to `mcpb pack`.
//
//   bundle/manifest.full.json
//     Full form: tools[] entries include inputSchema (and annotations).
//     Smithery's deploy validator REQUIRES inputSchema on every tool. We
//     swap this in over the slim manifest after packing, before uploading.
//
// The pack-then-swap dance is needed because MCPB and Smithery's ServerCard
// schemas disagree: MCPB explicitly keeps tool entries minimal and discovers
// schemas at runtime via tools/list; Smithery indexes them statically.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const template = JSON.parse(
  readFileSync(resolve(here, "manifest.json"), "utf8"),
);

const fullToolsJson = execFileSync(
  process.execPath,
  [resolve(here, "generate-tools-array.mjs")],
  { encoding: "utf8" },
);
const fullTools = JSON.parse(fullToolsJson);

const slimTools = fullTools.map((t) => ({
  name: t.name,
  description: t.description ?? "",
}));

writeFileSync(
  resolve(repoRoot, "bundle", "manifest.json"),
  JSON.stringify({ ...template, tools: slimTools }, null, 2) + "\n",
);

writeFileSync(
  resolve(repoRoot, "bundle", "manifest.full.json"),
  JSON.stringify({ ...template, tools: fullTools }, null, 2) + "\n",
);

console.error(
  `[manifest-gen] wrote bundle/manifest.json (slim, ${slimTools.length} tools) and bundle/manifest.full.json (with inputSchemas)`,
);
