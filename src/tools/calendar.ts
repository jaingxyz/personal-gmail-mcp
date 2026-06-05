// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { z } from "zod";
import type { calendar_v3 } from "googleapis";
import { calendarClient } from "../google.js";
import { config } from "../config.js";

// Google Calendar event times: { dateTime, timeZone } where dateTime is
// RFC-3339 local form (no offset) when timeZone is supplied, OR { date } for
// all-day. We mirror the Outlook tool's input shape; a separate timeZone field
// keeps callers from having to bake offsets into the string.
const dateTimeWithTz = z.object({
  dateTime: z
    .string()
    .min(1)
    .describe(
      "Local date-time, no offset, e.g. '2026-05-20T15:00:00'. The timeZone field controls interpretation.",
    ),
  timeZone: z
    .string()
    .min(1)
    .describe("IANA timezone, e.g. 'America/Los_Angeles' or 'UTC'."),
});

const attendeeSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  optional: z
    .boolean()
    .default(false)
    .describe("If true, the attendee is marked optional."),
});
type AttendeeInput = z.infer<typeof attendeeSchema>;

function toGoogleAttendees(
  attendees: AttendeeInput[],
): calendar_v3.Schema$EventAttendee[] {
  return attendees.map((a) => ({
    email: a.email,
    displayName: a.name,
    optional: a.optional,
  }));
}

type GEvent = calendar_v3.Schema$Event;

function formatPerson(
  p: { email?: string | null; displayName?: string | null } | undefined | null,
): string | null {
  if (!p) return null;
  if (p.displayName && p.email) return `${p.displayName} <${p.email}>`;
  return p.email ?? p.displayName ?? null;
}

export function summarizeEvent(e: GEvent): Record<string, unknown> {
  const attendees = e.attendees ?? [];
  const self = attendees.find((a) => a.self);
  return {
    id: e.id,
    subject: e.summary ?? null,
    start: e.start, // { dateTime, timeZone } or { date }
    end: e.end,
    isAllDay: !!e.start?.date,
    location: e.location ?? null,
    organizer: formatPerson(e.organizer),
    attendees: attendees.map((a) => ({
      email: formatPerson(a),
      optional: a.optional ?? false,
      responseStatus: a.responseStatus, // needsAction|declined|tentative|accepted
    })),
    status: e.status, // confirmed | tentative | cancelled
    myResponse: self?.responseStatus ?? null,
    // Google: recurringEventId present => this is an instance of a series.
    recurringEventId: e.recurringEventId ?? null,
    htmlLink: e.htmlLink,
    preview: (e.description ?? "").slice(0, 200) || null,
  };
}

// ---------- list_calendars ----------

export const listCalendarsSchema = z.object({});
export type ListCalendarsInput = z.infer<typeof listCalendarsSchema>;

export async function listCalendars(
  _input: ListCalendarsInput,
): Promise<unknown> {
  const cal = await calendarClient();
  const res = await cal.calendarList.list();
  return {
    calendars: (res.data.items ?? []).map((c) => ({
      id: c.id,
      name: c.summary,
      isDefault: !!c.primary,
      // owner/writer/reader/freeBusyReader — editable if owner or writer.
      canEdit: c.accessRole === "owner" || c.accessRole === "writer",
      accessRole: c.accessRole,
    })),
  };
}

// ---------- list_events ----------

export const listEventsSchema = z.object({
  start: z
    .string()
    .min(1)
    .describe(
      "Inclusive window start, RFC-3339, e.g. '2026-05-20T00:00:00Z' or with offset.",
    ),
  end: z
    .string()
    .min(1)
    .describe("Exclusive window end. Same format as start."),
  calendarId: z
    .string()
    .default("primary")
    .describe("Calendar id. Defaults to the primary calendar."),
  limit: z.number().int().min(1).max(200).default(50),
});
export type ListEventsInput = z.infer<typeof listEventsSchema>;

export async function listEvents(input: ListEventsInput): Promise<unknown> {
  const cal = await calendarClient();
  // singleEvents + orderBy=startTime expands recurring series into individual
  // instances ordered by time (the "what's on my calendar" question).
  const res = await cal.events.list({
    calendarId: input.calendarId,
    timeMin: input.start,
    timeMax: input.end,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: input.limit,
    timeZone: config.defaultTimeZone,
  });
  return {
    timeZone: config.defaultTimeZone,
    events: (res.data.items ?? []).map(summarizeEvent),
    nextCursor: res.data.nextPageToken ?? null,
  };
}

// ---------- read_event ----------

export const readEventSchema = z.object({
  eventId: z.string().min(1),
  calendarId: z.string().default("primary"),
});
export type ReadEventInput = z.infer<typeof readEventSchema>;

export async function readEvent(input: ReadEventInput): Promise<unknown> {
  const cal = await calendarClient();
  const res = await cal.events.get({
    calendarId: input.calendarId,
    eventId: input.eventId,
    timeZone: config.defaultTimeZone,
  });
  const e = res.data;
  return {
    ...summarizeEvent(e),
    body: { contentType: "text", content: e.description ?? "" },
    recurrence: e.recurrence ?? null,
  };
}

// ---------- create_event ----------

export const createEventSchema = z.object({
  subject: z.string().min(1),
  start: dateTimeWithTz,
  end: dateTimeWithTz,
  attendees: z.array(attendeeSchema).default([]),
  location: z.string().optional(),
  body: z.string().optional(),
  isOnlineMeeting: z
    .boolean()
    .default(false)
    .describe("If true, attaches a Google Meet conference link."),
  calendarId: z.string().default("primary"),
  sendUpdates: z
    .enum(["all", "externalOnly", "none"])
    .default("all")
    .describe("Whether to send invites/notifications to attendees."),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export async function createEvent(input: CreateEventInput): Promise<unknown> {
  const cal = await calendarClient();
  const requestBody: calendar_v3.Schema$Event = {
    summary: input.subject,
    start: input.start,
    end: input.end,
    attendees: toGoogleAttendees(input.attendees),
  };
  if (input.location) requestBody.location = input.location;
  if (input.body) requestBody.description = input.body;
  if (input.isOnlineMeeting) {
    requestBody.conferenceData = {
      createRequest: {
        // requestId must be unique per create; derive from subject + start.
        requestId: `meet-${Buffer.from(input.subject + input.start.dateTime)
          .toString("base64url")
          .slice(0, 32)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const res = await cal.events.insert({
    calendarId: input.calendarId,
    requestBody,
    sendUpdates: input.sendUpdates,
    conferenceDataVersion: input.isOnlineMeeting ? 1 : 0,
  });
  return summarizeEvent(res.data);
}

// ---------- update_event ----------

export const updateEventSchema = z.object({
  eventId: z.string().min(1),
  calendarId: z.string().default("primary"),
  subject: z.string().optional(),
  start: dateTimeWithTz.optional(),
  end: dateTimeWithTz.optional(),
  attendees: z.array(attendeeSchema).optional(),
  location: z.string().optional(),
  body: z.string().optional(),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all"),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export async function updateEvent(input: UpdateEventInput): Promise<unknown> {
  const cal = await calendarClient();
  const patch: calendar_v3.Schema$Event = {};
  if (input.subject !== undefined) patch.summary = input.subject;
  if (input.start !== undefined) patch.start = input.start;
  if (input.end !== undefined) patch.end = input.end;
  if (input.attendees !== undefined) {
    patch.attendees = toGoogleAttendees(input.attendees);
  }
  if (input.location !== undefined) patch.location = input.location;
  if (input.body !== undefined) patch.description = input.body;

  const changed = Object.keys(patch);
  if (changed.length === 0) {
    return { ok: true, eventId: input.eventId, changed: [] };
  }

  // events.patch does a partial update. Unlike Graph, Google handles single
  // recurring instances fine (an instance has its own id), so we don't refuse.
  const res = await cal.events.patch({
    calendarId: input.calendarId,
    eventId: input.eventId,
    requestBody: patch,
    sendUpdates: input.sendUpdates,
  });
  return {
    ok: true,
    eventId: input.eventId,
    changed,
    event: summarizeEvent(res.data),
  };
}

// ---------- cancel_event ----------

export const cancelEventSchema = z.object({
  eventId: z.string().min(1),
  calendarId: z.string().default("primary"),
  sendUpdates: z
    .enum(["all", "externalOnly", "none"])
    .default("all")
    .describe(
      "Whether to notify attendees of the cancellation. Use 'all' for meetings; 'none' for solo events.",
    ),
});
export type CancelEventInput = z.infer<typeof cancelEventSchema>;

export async function cancelEvent(input: CancelEventInput): Promise<unknown> {
  const cal = await calendarClient();
  // Google has no separate cancel vs delete: deleting an event you organize
  // sends cancellations to attendees when sendUpdates=all.
  await cal.events.delete({
    calendarId: input.calendarId,
    eventId: input.eventId,
    sendUpdates: input.sendUpdates,
  });
  return { ok: true, eventId: input.eventId, sendUpdates: input.sendUpdates };
}

// ---------- respond_to_invite ----------

const RESPONSE_MAP: Record<string, string> = {
  accept: "accepted",
  tentativelyAccept: "tentative",
  decline: "declined",
};

export const respondSchema = z.object({
  eventId: z.string().min(1),
  calendarId: z.string().default("primary"),
  response: z.enum(["accept", "tentativelyAccept", "decline"]),
  comment: z.string().optional(),
  sendResponse: z
    .boolean()
    .default(true)
    .describe("Whether to notify the organizer of your response."),
});
export type RespondInput = z.infer<typeof respondSchema>;

export async function respondToInvite(input: RespondInput): Promise<unknown> {
  const cal = await calendarClient();
  // Google has no /accept endpoint: you patch your own attendee entry's
  // responseStatus. Fetch the event, find the self attendee, update it.
  const current = await cal.events.get({
    calendarId: input.calendarId,
    eventId: input.eventId,
  });
  const attendees = current.data.attendees ?? [];
  const self = attendees.find((a) => a.self);
  if (!self) {
    throw new Error(
      `You are not an attendee of event ${input.eventId}, so there is nothing to respond to.`,
    );
  }
  self.responseStatus = RESPONSE_MAP[input.response];
  if (input.comment) self.comment = input.comment;

  await cal.events.patch({
    calendarId: input.calendarId,
    eventId: input.eventId,
    requestBody: { attendees },
    sendUpdates: input.sendResponse ? "all" : "none",
  });
  return {
    ok: true,
    eventId: input.eventId,
    response: RESPONSE_MAP[input.response],
  };
}
