// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { exec } from "node:child_process";
import { AsyncEntry } from "@napi-rs/keyring";
import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import { config } from "./config.js";

const keyringEntry = new AsyncEntry(
  config.keychainService,
  config.keychainAccount,
);

// Persist the OAuth token set (access + refresh + expiry) in the OS keyring.
// Same principle as the Outlook server: tokens never touch disk in plaintext.
async function loadCredentials(): Promise<Credentials | null> {
  const data = await keyringEntry.getPassword();
  if (!data) return null;
  try {
    return JSON.parse(data) as Credentials;
  } catch {
    return null;
  }
}

async function saveCredentials(creds: Credentials): Promise<void> {
  // Merge: a refresh response often omits refresh_token, so don't clobber it.
  const existing = (await loadCredentials()) ?? {};
  const merged = { ...existing, ...creds };
  if (!merged.refresh_token && existing.refresh_token) {
    merged.refresh_token = existing.refresh_token;
  }
  await keyringEntry.setPassword(JSON.stringify(merged));
}

export class ReauthRequiredError extends Error {
  constructor(reason: string) {
    super(
      `Re-authentication required: ${reason}. Run \`npm run whoami\` from a terminal to refresh the token cache, then retry.`,
    );
    this.name = "ReauthRequiredError";
  }
}

export interface GetClientOptions {
  /**
   * If true, fall back to the interactive loopback browser flow when no valid
   * cached token exists. Use only from terminal-attached scripts (whoami).
   * MCP tool calls run under Claude Desktop where the browser/stderr aren't
   * usable for a prompt — those pass the default (false) and surface
   * ReauthRequiredError instead of hanging.
   */
  interactive?: boolean;
}

function makeClient(redirectUri?: string): OAuth2Client {
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    redirectUri,
  );
}

/**
 * Returns an authorized OAuth2 client. Silent path: load cached credentials;
 * the googleapis client auto-refreshes using the refresh_token when the access
 * token is expired, and we persist the refreshed token via the tokens event.
 */
export async function getAuthClient(
  opts: GetClientOptions = {},
): Promise<OAuth2Client> {
  const creds = await loadCredentials();

  if (creds?.refresh_token) {
    const client = makeClient();
    client.setCredentials(creds);
    client.on("tokens", (tokens) => {
      void saveCredentials(tokens);
    });
    // Proactively ensure we have a live access token; this triggers a refresh
    // if needed and throws if the refresh token is revoked/expired.
    try {
      await client.getAccessToken();
      return client;
    } catch (err) {
      if (!opts.interactive) {
        throw new ReauthRequiredError(silentFailureReason(err));
      }
      // fall through to interactive
    }
  } else if (!opts.interactive) {
    throw new ReauthRequiredError("no cached refresh token");
  }

  return runLoopbackFlow();
}

/**
 * Interactive loopback (installed-app) OAuth flow. Google does NOT support
 * device-code for Gmail, so we spin up a throwaway localhost listener, open
 * the consent page in the browser, and capture the redirected auth code.
 */
async function runLoopbackFlow(): Promise<OAuth2Client> {
  return new Promise<OAuth2Client>((resolvePromise, reject) => {
    const state = randomBytes(16).toString("hex");

    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "", `http://${config.redirectHost}`);
        if (!url.pathname.startsWith("/oauth2callback")) {
          res.writeHead(404).end();
          return;
        }
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          finish(res, `Authorization failed: ${error}`);
          cleanup();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (returnedState !== state) {
          finish(res, "State mismatch — aborting.");
          cleanup();
          reject(new Error("OAuth state mismatch (possible CSRF)"));
          return;
        }
        if (!code) {
          finish(res, "No authorization code received.");
          cleanup();
          reject(new Error("No authorization code in callback"));
          return;
        }

        const port = (server.address() as AddressInfo).port;
        const redirectUri = `http://${config.redirectHost}:${port}/oauth2callback`;
        const client = makeClient(redirectUri);
        client
          .getToken(code)
          .then(async ({ tokens }) => {
            if (!tokens.refresh_token) {
              // Without offline access we'd re-auth hourly. prompt=consent
              // below forces a refresh token to be issued.
              console.error(
                "[auth] warning: no refresh_token returned; you may need to revoke the app's access and retry.",
              );
            }
            client.setCredentials(tokens);
            client.on("tokens", (t) => void saveCredentials(t));
            await saveCredentials(tokens);
            finish(
              res,
              "Authentication complete. You can close this tab and return to the terminal.",
            );
            cleanup();
            resolvePromise(client);
          })
          .catch((err) => {
            finish(res, "Token exchange failed.");
            cleanup();
            reject(err);
          });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    function cleanup(): void {
      server.close();
    }
    function finish(
      res: import("node:http").ServerResponse,
      message: string,
    ): void {
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(`<!doctype html><meta charset="utf-8"><p>${message}</p>`);
    }

    // Bind to an ephemeral port on the loopback interface, then build the auth
    // URL with the now-known port.
    server.listen(0, config.redirectHost, () => {
      const port = (server.address() as AddressInfo).port;
      const redirectUri = `http://${config.redirectHost}:${port}/oauth2callback`;
      const client = makeClient(redirectUri);
      const authUrl = client.generateAuthUrl({
        access_type: "offline", // gets us a refresh_token
        prompt: "consent", // force refresh_token issuance even on re-auth
        scope: config.scopes,
        state,
      });
      // CLI script context: print to stderr so the MCP stdout stream is never
      // corrupted if this is ever reached from the server.
      console.error("\nOpen this URL to authorize personal-gmail-mcp:\n");
      console.error(authUrl + "\n");
      openBrowser(authUrl);
    });

    server.on("error", reject);
  });
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "start"
        : "xdg-open";
  // Best-effort; if it fails the user can copy the URL printed to stderr.
  exec(`${cmd} "${url}"`, () => {});
}

function silentFailureReason(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: string; response?: { data?: unknown } };
    if (e.message?.includes("invalid_grant")) {
      return "refresh token expired or revoked (Google test-mode tokens expire after 7 days — publish the OAuth app)";
    }
    if (e.message) return e.message.slice(0, 200);
  }
  return "silent token refresh failed";
}

export async function signOut(): Promise<void> {
  try {
    await keyringEntry.deletePassword();
  } catch {
    // Already signed out.
  }
}
