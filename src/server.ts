// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import { getMe } from "./google.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "personal-gmail-mcp",
    version: config.version,
  });

  // Phase 1: identity probe only. Mail + calendar tools land in later phases,
  // all prefixed gmail_* / gmail_calendar_* to mirror the Outlook server.
  server.registerTool(
    "gmail_whoami",
    {
      title: "Signed-in Gmail account",
      description:
        "Return the signed-in Google account's Gmail profile (email address, message/thread totals).",
      inputSchema: z.object({}).shape,
    },
    async () => toolResult(await getMe()),
  );

  return server;
}

function toolResult(payload: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}
