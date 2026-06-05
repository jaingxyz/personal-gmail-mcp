// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
// Shared helpers for the Gmail tool layer: header parsing, message
// summarizing, and RFC-2822 MIME construction for send/draft.
import type { gmail_v1 } from "googleapis";

export type GmailMessage = gmail_v1.Schema$Message;

/** Case-insensitive lookup of a header value from a Gmail message payload. */
export function header(msg: GmailMessage, name: string): string | undefined {
  const headers = msg.payload?.headers ?? [];
  const lower = name.toLowerCase();
  return (
    headers.find((h) => (h.name ?? "").toLowerCase() === lower)?.value ??
    undefined
  );
}

/**
 * Flatten a message into a compact summary for list/search results. Pulls the
 * common headers and the snippet; does not walk the body (use readMessage for
 * that).
 */
export function summarizeMessage(msg: GmailMessage): Record<string, unknown> {
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: header(msg, "From") ?? null,
    to: header(msg, "To") ?? null,
    subject: header(msg, "Subject") ?? null,
    date: header(msg, "Date") ?? null,
    snippet: msg.snippet ?? null,
    labelIds: msg.labelIds ?? [],
    unread: (msg.labelIds ?? []).includes("UNREAD"),
    hasAttachments: hasAttachments(msg),
  };
}

/** True if any part of the message carries a filename (i.e. an attachment). */
export function hasAttachments(msg: GmailMessage): boolean {
  const walk = (part?: gmail_v1.Schema$MessagePart): boolean => {
    if (!part) return false;
    if (part.filename && part.filename.length > 0) return true;
    return (part.parts ?? []).some(walk);
  };
  return walk(msg.payload);
}

/**
 * Extract the best-effort body text from a message payload. Prefers text/plain;
 * falls back to text/html (caller may strip). Walks multipart trees.
 */
export function extractBody(msg: GmailMessage): {
  contentType: string;
  content: string;
} {
  const decode = (data?: string | null): string =>
    data ? Buffer.from(data, "base64url").toString("utf8") : "";

  let plain: string | undefined;
  let html: string | undefined;

  const walk = (part?: gmail_v1.Schema$MessagePart): void => {
    if (!part) return;
    const mime = part.mimeType ?? "";
    if (mime === "text/plain" && plain === undefined) {
      plain = decode(part.body?.data);
    } else if (mime === "text/html" && html === undefined) {
      html = decode(part.body?.data);
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(msg.payload);

  if (plain !== undefined && plain.length > 0) {
    return { contentType: "text", content: plain };
  }
  if (html !== undefined && html.length > 0) {
    return { contentType: "html", content: html };
  }
  // Single-part message: body sits directly on the payload.
  return { contentType: "text", content: decode(msg.payload?.body?.data) };
}

/**
 * Build an RFC-2822 message and return it base64url-encoded for
 * users.messages.send / drafts.create. Gmail wants the raw MIME, not JSON.
 * `threadHeaders` lets replies set In-Reply-To / References.
 */
export function buildRawMessage(opts: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  bodyFormat?: "text" | "html";
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];
  lines.push(`To: ${opts.to.join(", ")}`);
  if (opts.cc?.length) lines.push(`Cc: ${opts.cc.join(", ")}`);
  if (opts.bcc?.length) lines.push(`Bcc: ${opts.bcc.join(", ")}`);
  // Encode the subject as RFC-2047 if it has non-ASCII chars.
  lines.push(`Subject: ${encodeHeaderValue(opts.subject ?? "")}`);
  lines.push("MIME-Version: 1.0");
  // inReplyTo/references are derived from a FETCHED message's headers, not
  // from email-validated input, so strip CR/LF to prevent header injection
  // (a crafted Message-ID could otherwise smuggle "\r\nBcc: ...").
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${stripCrlf(opts.inReplyTo)}`);
  if (opts.references) lines.push(`References: ${stripCrlf(opts.references)}`);
  const contentType = opts.bodyFormat === "html" ? "text/html" : "text/plain";
  lines.push(`Content-Type: ${contentType}; charset="UTF-8"`);
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  // Body as base64 so arbitrary UTF-8 survives the 7-bit transport.
  lines.push(Buffer.from(opts.body, "utf8").toString("base64"));

  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/** Remove CR/LF so a value can't inject extra MIME headers. */
export function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/**
 * RFC-2047 encode a header value. CR/LF are stripped first so they can't
 * smuggle additional headers (the plain-ASCII branch would otherwise pass
 * them straight through, since the test below treats them as ASCII).
 */
export function encodeHeaderValue(value: string): string {
  const safe = stripCrlf(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

/** Truncate text to a max length, appending a marker when cut. */
export function truncate(
  text: string,
  max: number,
): { text: string; truncated: boolean } {
  if (max === 0 || text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max);
  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut = cut.slice(0, -1);
  return { text: cut + "\n…[truncated]", truncated: true };
}
