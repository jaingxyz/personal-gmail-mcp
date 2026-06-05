// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { describe, it, expect } from "vitest";
import {
  header,
  summarizeMessage,
  hasAttachments,
  extractBody,
  buildRawMessage,
  encodeHeaderValue,
  truncate,
} from "../src/tools/helpers.js";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("header", () => {
  it("looks up case-insensitively", () => {
    const msg = {
      payload: { headers: [{ name: "From", value: "a@b.com" }] },
    };
    expect(header(msg, "from")).toBe("a@b.com");
    expect(header(msg, "FROM")).toBe("a@b.com");
    expect(header(msg, "Missing")).toBeUndefined();
  });
});

describe("summarizeMessage", () => {
  it("flattens headers, labels, and unread state", () => {
    const out = summarizeMessage({
      id: "m1",
      threadId: "t1",
      snippet: "hi there",
      labelIds: ["INBOX", "UNREAD"],
      payload: {
        headers: [
          { name: "From", value: "A <a@b.com>" },
          { name: "Subject", value: "Hello" },
        ],
      },
    });
    expect(out.id).toBe("m1");
    expect(out.from).toBe("A <a@b.com>");
    expect(out.subject).toBe("Hello");
    expect(out.unread).toBe(true);
    expect(out.snippet).toBe("hi there");
  });
});

describe("hasAttachments", () => {
  it("detects a filename anywhere in the part tree", () => {
    expect(
      hasAttachments({
        payload: {
          parts: [
            { mimeType: "text/plain" },
            { filename: "invoice.pdf", mimeType: "application/pdf" },
          ],
        },
      }),
    ).toBe(true);
  });
  it("is false when no part has a filename", () => {
    expect(
      hasAttachments({ payload: { parts: [{ mimeType: "text/plain" }] } }),
    ).toBe(false);
  });
});

describe("extractBody", () => {
  it("prefers text/plain", () => {
    const out = extractBody({
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64url("plain text") } },
          { mimeType: "text/html", body: { data: b64url("<p>html</p>") } },
        ],
      },
    });
    expect(out).toEqual({ contentType: "text", content: "plain text" });
  });
  it("falls back to html when no plain part", () => {
    const out = extractBody({
      payload: {
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/html", body: { data: b64url("<p>x</p>") } }],
      },
    });
    expect(out).toEqual({ contentType: "html", content: "<p>x</p>" });
  });
  it("reads a single-part body off the payload", () => {
    const out = extractBody({
      payload: { mimeType: "text/plain", body: { data: b64url("solo") } },
    });
    expect(out.content).toBe("solo");
  });
});

describe("buildRawMessage", () => {
  it("produces decodable base64url MIME with headers and base64 body", () => {
    const raw = buildRawMessage({
      to: ["a@b.com"],
      cc: ["c@d.com"],
      subject: "Hi",
      body: "Hello world",
      bodyFormat: "text",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: a@b.com");
    expect(decoded).toContain("Cc: c@d.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
    // Body is base64-encoded in the MIME.
    expect(decoded).toContain(Buffer.from("Hello world").toString("base64"));
  });
  it("sets threading headers and html content type when asked", () => {
    const raw = buildRawMessage({
      to: ["a@b.com"],
      body: "<b>x</b>",
      bodyFormat: "html",
      inReplyTo: "<orig@mail>",
      references: "<root@mail> <orig@mail>",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("In-Reply-To: <orig@mail>");
    expect(decoded).toContain("References: <root@mail> <orig@mail>");
    expect(decoded).toContain("Content-Type: text/html");
  });
});

describe("encodeHeaderValue", () => {
  it("leaves ASCII untouched", () => {
    expect(encodeHeaderValue("Plain Subject")).toBe("Plain Subject");
  });
  it("RFC-2047 encodes non-ASCII", () => {
    const out = encodeHeaderValue("Café ☕");
    expect(out.startsWith("=?UTF-8?B?")).toBe(true);
    // round-trip the base64 payload
    const b64 = out.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, "");
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe("Café ☕");
  });
});

describe("truncate", () => {
  it("returns input unchanged under the cap and with max=0", () => {
    expect(truncate("short", 10)).toEqual({ text: "short", truncated: false });
    expect(truncate("anything", 0)).toEqual({
      text: "anything",
      truncated: false,
    });
  });
  it("cuts and marks when over the cap", () => {
    expect(truncate("xxxxxxxxxx", 4)).toEqual({
      text: "xxxx\n…[truncated]",
      truncated: true,
    });
  });
  it("does not split a surrogate pair at the boundary", () => {
    const out = truncate("ab\u{1F600}cd", 3);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe("ab\n…[truncated]");
    expect(out.text).not.toContain("�");
  });
});
