// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { getMe } from "../google.js";

async function main(): Promise<void> {
  // Force the interactive loopback flow if the keyring is empty or the refresh
  // token is stale. Subsequent runs (and the MCP server) reuse the cached token.
  const me = await getMe({ interactive: true });
  // Intentionally writes to stdout: this is a CLI script, not the MCP server.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(me, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
