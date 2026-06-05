// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../.env"),
    resolve(process.cwd(), ".env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    return;
  }
}

loadDotEnv();

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../package.json"),
    resolve(here, "../../package.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const pkg = JSON.parse(readFileSync(path, "utf8")) as {
        version?: string;
      };
      if (pkg.version) return pkg.version;
    } catch {
      // Malformed package.json — try the next candidate.
    }
  }
  return "0.0.0";
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in (see README "Google setup").`,
    );
  }
  return v;
}

export const config = {
  version: readVersion(),
  clientId: required("GOOGLE_CLIENT_ID"),
  clientSecret: required("GOOGLE_CLIENT_SECRET"),
  // Loopback redirect. Port 0 = OS picks a free port at auth time; the chosen
  // port is appended before the redirect is registered with Google. A Desktop
  // OAuth client accepts any http://127.0.0.1 / http://localhost port, so we
  // don't have to pre-register a fixed one.
  redirectHost: process.env.GOOGLE_REDIRECT_HOST || "127.0.0.1",
  // Delegated scopes. mail.google.com gives full mailbox (read/modify/send);
  // calendar.events covers event CRUD on a known calendar (incl. "primary");
  // calendar.calendarlist.readonly is needed to ENUMERATE calendars
  // (calendarList.list) — calendar.events alone returns 403 there.
  // mail.google.com and the calendar scopes are "restricted" — the OAuth app
  // must be published (not in Testing) for long-lived refresh tokens.
  // NOTE: changing this list invalidates the cached token; re-run `whoami`.
  scopes: [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
  ],
  defaultTimeZone: process.env.PERSONAL_GMAIL_TZ || "America/Los_Angeles",
  keychainService: "personal-gmail-mcp",
  keychainAccount: "oauth-token",
};
