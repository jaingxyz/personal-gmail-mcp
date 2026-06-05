// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import { getMe } from "./google.js";
import {
  listLabels,
  listLabelsSchema,
  listRecent,
  listRecentSchema,
  read,
  readSchema,
  search,
  searchSchema,
} from "./tools/read.js";
import {
  deleteMessage,
  deleteSchema,
  markRead,
  markReadSchema,
  modifyLabels,
  modifyLabelsSchema,
  untrash,
  untrashSchema,
} from "./tools/mutate.js";
import {
  createDraft,
  createDraftSchema,
  reply,
  replySchema,
  send,
  sendSchema,
  sendDraft,
  sendDraftSchema,
} from "./tools/send.js";
import {
  cancelEvent,
  cancelEventSchema,
  createEvent,
  createEventSchema,
  listCalendars,
  listCalendarsSchema,
  listEvents,
  listEventsSchema,
  readEvent,
  readEventSchema,
  respondSchema,
  respondToInvite,
  updateEvent,
  updateEventSchema,
} from "./tools/calendar.js";

const PAGINATION_NOTE =
  "Returns up to `limit` (max 100) plus a `nextCursor`; pass it back as `cursor` to page through more.";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "personal-gmail-mcp",
    version: config.version,
  });

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

  server.registerTool(
    "gmail_list_labels",
    {
      title: "List labels",
      description:
        "List the mailbox's labels (system labels like INBOX/SENT/TRASH and custom labels) with id, name, type, and unread/total counts.",
      inputSchema: listLabelsSchema.shape,
    },
    async (args) => toolResult(await listLabels(args)),
  );

  server.registerTool(
    "gmail_list_recent",
    {
      title: "Recent messages in a label",
      description: `List the most recent messages carrying a label, newest first. Defaults to INBOX. Supports unreadOnly. ${PAGINATION_NOTE}`,
      inputSchema: listRecentSchema.shape,
    },
    async (args) => toolResult(await listRecent(args)),
  );

  server.registerTool(
    "gmail_search",
    {
      title: "Search mail",
      description: `Search messages with Gmail query syntax (from:, subject:, has:attachment, newer_than:7d, is:unread, etc.). ${PAGINATION_NOTE}`,
      inputSchema: searchSchema.shape,
    },
    async (args) => toolResult(await search(args)),
  );

  server.registerTool(
    "gmail_read",
    {
      title: "Read message",
      description:
        "Fetch a single message by id, including its decoded body (text preferred, html fallback) and threading headers.",
      inputSchema: readSchema.shape,
    },
    async (args) => toolResult(await read(args)),
  );

  server.registerTool(
    "gmail_mark_read",
    {
      title: "Mark message read/unread",
      description:
        "Mark a message read (remove UNREAD) or unread (add UNREAD). Pass isRead=false to mark unread.",
      inputSchema: markReadSchema.shape,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (args) => toolResult(await markRead(args)),
  );

  server.registerTool(
    "gmail_modify_labels",
    {
      title: "Add/remove labels",
      description:
        "Add or remove labels on a message. Removing INBOX archives the message; adding STARRED stars it. Use gmail_list_labels for ids.",
      inputSchema: modifyLabelsSchema.shape,
      annotations: { destructiveHint: false },
    },
    async (args) => toolResult(await modifyLabels(args)),
  );

  server.registerTool(
    "gmail_delete",
    {
      title: "Delete message",
      description:
        "Delete a message. By default moves to Trash (recoverable). Pass hardDelete=true to permanently delete — not recoverable.",
      inputSchema: deleteSchema.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => toolResult(await deleteMessage(args)),
  );

  server.registerTool(
    "gmail_untrash",
    {
      title: "Restore from Trash",
      description: "Restore a message from Trash back to the mailbox.",
      inputSchema: untrashSchema.shape,
      annotations: { destructiveHint: false },
    },
    async (args) => toolResult(await untrash(args)),
  );

  server.registerTool(
    "gmail_send",
    {
      title: "Send email",
      description:
        "Send a new email immediately. Saved to Sent. Use gmail_create_draft to review before sending.",
      inputSchema: sendSchema.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => toolResult(await send(args)),
  );

  server.registerTool(
    "gmail_reply",
    {
      title: "Reply to message",
      description:
        "Reply to a message by id, keeping it in the same thread. Sends immediately. replyAll=true to include all original recipients.",
      inputSchema: replySchema.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => toolResult(await reply(args)),
  );

  server.registerTool(
    "gmail_create_draft",
    {
      title: "Create draft",
      description:
        "Create a draft without sending. Returns a draftId for gmail_send_draft.",
      inputSchema: createDraftSchema.shape,
    },
    async (args) => toolResult(await createDraft(args)),
  );

  server.registerTool(
    "gmail_send_draft",
    {
      title: "Send draft",
      description: "Send a previously created draft by id.",
      inputSchema: sendDraftSchema.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => toolResult(await sendDraft(args)),
  );

  // ---------- Calendar ----------

  server.registerTool(
    "gmail_calendar_list_calendars",
    {
      title: "List calendars",
      description:
        "List the user's calendars (primary + subscribed) with id, name, default flag, and whether they're editable.",
      inputSchema: listCalendarsSchema.shape,
    },
    async (args) => toolResult(await listCalendars(args)),
  );

  server.registerTool(
    "gmail_calendar_list_events",
    {
      title: "List events in range",
      description:
        "List events in a time range. Recurring series are expanded into individual instances, ordered by start time. Defaults to the primary calendar.",
      inputSchema: listEventsSchema.shape,
    },
    async (args) => toolResult(await listEvents(args)),
  );

  server.registerTool(
    "gmail_calendar_read_event",
    {
      title: "Read event",
      description:
        "Read full details of a single event including description, attendees, and recurrence.",
      inputSchema: readEventSchema.shape,
    },
    async (args) => toolResult(await readEvent(args)),
  );

  server.registerTool(
    "gmail_calendar_create_event",
    {
      title: "Create event",
      description:
        "Create an event. Times use {dateTime, timeZone} where dateTime is local-form (no offset) and timeZone is an IANA name. If attendees are provided, invites are sent. isOnlineMeeting attaches a Google Meet link.",
      inputSchema: createEventSchema.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => toolResult(await createEvent(args)),
  );

  server.registerTool(
    "gmail_calendar_update_event",
    {
      title: "Update event",
      description:
        "Update an event's subject, time, location, description, or attendees. Works on single instances of a recurring series (each instance has its own id).",
      inputSchema: updateEventSchema.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => toolResult(await updateEvent(args)),
  );

  server.registerTool(
    "gmail_calendar_cancel_event",
    {
      title: "Cancel/delete event",
      description:
        "Delete an event. If you organize it and sendUpdates=all (default), attendees receive a cancellation. Use sendUpdates=none for solo events.",
      inputSchema: cancelEventSchema.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => toolResult(await cancelEvent(args)),
  );

  server.registerTool(
    "gmail_calendar_respond_to_invite",
    {
      title: "Respond to invite",
      description:
        "Respond to a meeting invite as accept, tentativelyAccept, or decline. Optionally include a comment and choose whether to notify the organizer.",
      inputSchema: respondSchema.shape,
      annotations: { destructiveHint: true },
    },
    async (args) => toolResult(await respondToInvite(args)),
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
