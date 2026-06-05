// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { z } from "zod";
import { gmailClient } from "../google.js";
import {
  summarizeMessage,
  extractBody,
  header,
  hasAttachments,
  truncate,
  type GmailMessage,
} from "./helpers.js";

const DEFAULT_MAX_BODY_CHARS = 20000;

export const listLabelsSchema = z.object({});
export type ListLabelsInput = z.infer<typeof listLabelsSchema>;

export async function listLabels(_input: ListLabelsInput): Promise<unknown> {
  const gmail = await gmailClient();
  const res = await gmail.users.labels.list({ userId: "me" });
  return {
    labels: (res.data.labels ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type, // "system" | "user"
      messagesUnread: l.messagesUnread,
      messagesTotal: l.messagesTotal,
    })),
  };
}

export const listRecentSchema = z.object({
  label: z
    .string()
    .default("INBOX")
    .describe(
      "Label id to list. System labels: INBOX, SENT, DRAFT, TRASH, SPAM, STARRED, IMPORTANT, UNREAD. Custom labels use their id (from gmail_list_labels).",
    ),
  limit: z.number().int().min(1).max(100).default(25),
  unreadOnly: z.boolean().default(false),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque pagination token from a previous call's nextCursor. When set, returns the next page.",
    ),
});
export type ListRecentInput = z.infer<typeof listRecentSchema>;

export async function listRecent(input: ListRecentInput): Promise<unknown> {
  const gmail = await gmailClient();
  const labelIds = [input.label];
  if (input.unreadOnly) labelIds.push("UNREAD");

  const list = await gmail.users.messages.list({
    userId: "me",
    labelIds,
    maxResults: input.limit,
    pageToken: input.cursor,
  });
  return hydrate(gmail, list.data.messages, list.data.nextPageToken);
}

export const searchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Gmail search query. Supports Gmail operators: from:, to:, subject:, has:attachment, newer_than:7d, label:, is:unread, etc.",
    ),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z
    .string()
    .optional()
    .describe("Opaque pagination token from a previous call's nextCursor."),
});
export type SearchInput = z.infer<typeof searchSchema>;

export async function search(input: SearchInput): Promise<unknown> {
  const gmail = await gmailClient();
  const list = await gmail.users.messages.list({
    userId: "me",
    q: input.query,
    maxResults: input.limit,
    pageToken: input.cursor,
  });
  return hydrate(gmail, list.data.messages, list.data.nextPageToken);
}

// messages.list returns only {id, threadId} stubs. Fetch metadata for each so
// the caller gets useful summaries (from/subject/date/snippet) in one round.
async function hydrate(
  gmail: Awaited<ReturnType<typeof gmailClient>>,
  stubs: { id?: string | null }[] | undefined,
  nextPageToken: string | null | undefined,
): Promise<unknown> {
  const ids = (stubs ?? []).map((m) => m.id).filter((id): id is string => !!id);
  const full = await Promise.all(
    ids.map((id) =>
      gmail.users.messages
        .get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        })
        .then((r) => r.data as GmailMessage),
    ),
  );
  return {
    messages: full.map(summarizeMessage),
    nextCursor: nextPageToken ?? null,
  };
}

export const readSchema = z.object({
  messageId: z.string().min(1),
  maxBodyChars: z
    .number()
    .int()
    .min(0)
    .max(1000000)
    .default(DEFAULT_MAX_BODY_CHARS)
    .describe(
      "Truncate the body to this many characters (a marker is appended when truncated). 0 disables the cap. Defaults to 20000.",
    ),
});
export type ReadInput = z.infer<typeof readSchema>;

export async function read(input: ReadInput): Promise<unknown> {
  const gmail = await gmailClient();
  const res = await gmail.users.messages.get({
    userId: "me",
    id: input.messageId,
    format: "full",
  });
  const msg = res.data as GmailMessage;
  const body = extractBody(msg);
  const { text: content, truncated } = truncate(
    body.content,
    input.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS,
  );

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: header(msg, "From") ?? null,
    to: header(msg, "To") ?? null,
    cc: header(msg, "Cc") ?? null,
    subject: header(msg, "Subject") ?? null,
    date: header(msg, "Date") ?? null,
    labelIds: msg.labelIds ?? [],
    unread: (msg.labelIds ?? []).includes("UNREAD"),
    hasAttachments: hasAttachments(msg),
    messageIdHeader: header(msg, "Message-ID") ?? null,
    references: header(msg, "References") ?? null,
    body: { contentType: body.contentType, content, truncated },
  };
}
