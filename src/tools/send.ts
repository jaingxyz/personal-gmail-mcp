// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { z } from "zod";
import { gmailClient } from "../google.js";
import { buildRawMessage, header, type GmailMessage } from "./helpers.js";

const recipientList = z
  .array(z.string().email())
  .min(1)
  .describe("One or more email addresses.");
const optionalRecipientList = z.array(z.string().email()).default([]);
const bodyFormat = z
  .enum(["text", "html"])
  .default("text")
  .describe("Body content type: 'text' (plain) or 'html'.");

export const sendSchema = z.object({
  to: recipientList,
  cc: optionalRecipientList,
  bcc: optionalRecipientList,
  subject: z.string().default(""),
  body: z.string().default(""),
  bodyFormat,
});
export type SendInput = z.infer<typeof sendSchema>;

export async function send(input: SendInput): Promise<unknown> {
  const gmail = await gmailClient();
  const raw = buildRawMessage({
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: input.body,
    bodyFormat: input.bodyFormat,
  });
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
  return {
    ok: true,
    id: res.data.id,
    threadId: res.data.threadId,
    to: input.to,
    subject: input.subject,
  };
}

export const replySchema = z.object({
  messageId: z.string().min(1).describe("Id of the message being replied to."),
  body: z.string().min(1).describe("Reply body."),
  bodyFormat,
  replyAll: z
    .boolean()
    .default(false)
    .describe("If true, reply to all original recipients (To + Cc)."),
});
export type ReplyInput = z.infer<typeof replySchema>;

export async function reply(input: ReplyInput): Promise<unknown> {
  const gmail = await gmailClient();
  // Fetch the original to derive recipients + threading headers.
  const orig = (
    await gmail.users.messages.get({
      userId: "me",
      id: input.messageId,
      format: "metadata",
      metadataHeaders: [
        "From",
        "To",
        "Cc",
        "Subject",
        "Message-ID",
        "References",
      ],
    })
  ).data as GmailMessage;

  const from = header(orig, "From");
  const to = from ? [extractEmail(from)] : [];
  const cc: string[] = [];
  if (input.replyAll) {
    for (const raw of [header(orig, "To"), header(orig, "Cc")]) {
      for (const addr of splitAddresses(raw)) {
        const email = extractEmail(addr);
        if (email && email !== to[0]) cc.push(email);
      }
    }
  }

  const origSubject = header(orig, "Subject") ?? "";
  const subject = /^re:/i.test(origSubject)
    ? origSubject
    : `Re: ${origSubject}`;
  const origMsgId = header(orig, "Message-ID");
  const origRefs = header(orig, "References");

  const raw = buildRawMessage({
    to,
    cc,
    subject,
    body: input.body,
    bodyFormat: input.bodyFormat,
    inReplyTo: origMsgId,
    references: [origRefs, origMsgId].filter(Boolean).join(" ") || undefined,
  });

  const res = await gmail.users.messages.send({
    userId: "me",
    // threadId keeps the reply in the same conversation.
    requestBody: { raw, threadId: orig.threadId ?? undefined },
  });
  return {
    ok: true,
    id: res.data.id,
    threadId: res.data.threadId,
    repliedTo: input.messageId,
    replyAll: input.replyAll,
  };
}

export const createDraftSchema = z.object({
  to: recipientList,
  cc: optionalRecipientList,
  bcc: optionalRecipientList,
  subject: z.string().default(""),
  body: z.string().default(""),
  bodyFormat,
});
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export async function createDraft(input: CreateDraftInput): Promise<unknown> {
  const gmail = await gmailClient();
  const raw = buildRawMessage({
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: input.body,
    bodyFormat: input.bodyFormat,
  });
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });
  return { ok: true, draftId: res.data.id, subject: input.subject };
}

export const sendDraftSchema = z.object({
  draftId: z.string().min(1).describe("Id of an existing draft."),
});
export type SendDraftInput = z.infer<typeof sendDraftSchema>;

export async function sendDraft(input: SendDraftInput): Promise<unknown> {
  const gmail = await gmailClient();
  const res = await gmail.users.drafts.send({
    userId: "me",
    requestBody: { id: input.draftId },
  });
  return {
    ok: true,
    draftId: input.draftId,
    id: res.data.id,
    threadId: res.data.threadId,
  };
}

// "Display Name <a@b.com>" -> "a@b.com"; bare "a@b.com" -> "a@b.com".
export function extractEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
}

// Split a header value on commas that separate addresses (naive but adequate
// for reply-all recipient gathering; quoted display names rarely contain commas
// in practice and a stray cc is harmless).
export function splitAddresses(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
