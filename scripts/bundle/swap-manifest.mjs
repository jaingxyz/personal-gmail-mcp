#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz

// After `mcpb pack` produces personal-gmail-mcp.mcpb with the slim manifest
// (required by the packer's validator), open the zip and overwrite
// manifest.json with bundle/manifest.full.json (which includes the full
// inputSchemas required by Smithery's deploy validator). Re-zip in place.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const mcpbPath = resolve(repoRoot, "personal-gmail-mcp.mcpb");
const fullManifestPath = resolve(repoRoot, "bundle", "manifest.full.json");

const work = mkdtempSync(join(tmpdir(), "mcpb-swap-"));
try {
  // Extract.
  execFileSync("unzip", ["-q", mcpbPath, "-d", work]);

  // Overwrite manifest.json with the full version.
  const fullManifest = readFileSync(fullManifestPath, "utf8");
  writeFileSync(join(work, "manifest.json"), fullManifest);

  // Re-zip into the same .mcpb path. Use `zip -r` and recreate the archive
  // (rm first because zip APPENDS to existing archives — no --overwrite flag).
  rmSync(mcpbPath);
  execFileSync(
    "zip",
    [
      "-r",
      "-q",
      "-X", // strip extra file attributes for reproducible builds
      mcpbPath,
      ".",
    ],
    { cwd: work },
  );

  console.error(`[swap-manifest] swapped slim -> full manifest in ${mcpbPath}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
