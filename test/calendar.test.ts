// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeMockGmail } from "./_mockGmail.js";

const mock = makeMockGmail();

vi.mock("../src/google.js", () => ({
  gmailClient: () => Promise.resolve(mock.client),
  calendarClient: () => Promise.resolve(mock.client),
  getMe: vi.fn(),
}));

beforeEach(() => {
  for (const k of Object.keys(mock.calls)) delete mock.calls[k];
  vi.clearAllMocks();
});

describe("calendar list/read", () => {
  it("listCalendars maps editability from accessRole", async () => {
    const { listCalendars } = await import("../src/tools/calendar.js");
    mock.client.calendarList.list.mockResolvedValueOnce({
      data: {
        items: [
          { id: "primary", summary: "Me", primary: true, accessRole: "owner" },
          { id: "ro", summary: "Holidays", accessRole: "reader" },
        ],
      },
    });
    const out = (await listCalendars({})) as {
      calendars: { id: string; isDefault: boolean; canEdit: boolean }[];
    };
    expect(out.calendars[0]).toMatchObject({ isDefault: true, canEdit: true });
    expect(out.calendars[1]).toMatchObject({
      isDefault: false,
      canEdit: false,
    });
  });

  it("listEvents expands recurring series and orders by start", async () => {
    const { listEvents } = await import("../src/tools/calendar.js");
    mock.client.events.list.mockResolvedValueOnce({
      data: { items: [{ id: "e1", summary: "Standup" }], nextPageToken: "P2" },
    });
    const out = (await listEvents({
      start: "2026-05-20T00:00:00Z",
      end: "2026-05-27T00:00:00Z",
      calendarId: "primary",
      limit: 50,
    })) as { events: { subject: string }[]; nextCursor: string };
    expect(mock.client.events.list).toHaveBeenCalledWith(
      expect.objectContaining({ singleEvents: true, orderBy: "startTime" }),
    );
    expect(out.events[0].subject).toBe("Standup");
    expect(out.nextCursor).toBe("P2");
  });

  it("readEvent flatts all-day detection and self response", async () => {
    const { readEvent } = await import("../src/tools/calendar.js");
    mock.client.events.get.mockResolvedValueOnce({
      data: {
        id: "e1",
        summary: "Trip",
        start: { date: "2026-07-01" },
        end: { date: "2026-07-05" },
        attendees: [
          { email: "me@x.com", self: true, responseStatus: "accepted" },
        ],
        description: "vacation",
      },
    });
    const out = (await readEvent({ eventId: "e1", calendarId: "primary" })) as {
      isAllDay: boolean;
      myResponse: string;
      body: { content: string };
    };
    expect(out.isAllDay).toBe(true);
    expect(out.myResponse).toBe("accepted");
    expect(out.body.content).toBe("vacation");
  });
});

describe("calendar create/update/cancel", () => {
  it("createEvent maps subject->summary and sends attendees", async () => {
    const { createEvent } = await import("../src/tools/calendar.js");
    await createEvent({
      subject: "Sync",
      start: {
        dateTime: "2026-05-20T15:00:00",
        timeZone: "America/Los_Angeles",
      },
      end: { dateTime: "2026-05-20T15:30:00", timeZone: "America/Los_Angeles" },
      attendees: [{ email: "a@b.com", optional: false }],
      isOnlineMeeting: false,
      calendarId: "primary",
      sendUpdates: "all",
    });
    const arg = mock.client.events.insert.mock.calls[0][0] as {
      requestBody: { summary: string; attendees: { email: string }[] };
      sendUpdates: string;
    };
    expect(arg.requestBody.summary).toBe("Sync");
    expect(arg.requestBody.attendees[0].email).toBe("a@b.com");
    expect(arg.sendUpdates).toBe("all");
  });

  it("createEvent attaches a Meet conference when online", async () => {
    const { createEvent } = await import("../src/tools/calendar.js");
    await createEvent({
      subject: "Call",
      start: { dateTime: "2026-05-20T15:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-05-20T15:30:00", timeZone: "UTC" },
      attendees: [],
      isOnlineMeeting: true,
      calendarId: "primary",
      sendUpdates: "none",
    });
    const arg = mock.client.events.insert.mock.calls[0][0] as {
      conferenceDataVersion: number;
      requestBody: { conferenceData?: unknown };
    };
    expect(arg.conferenceDataVersion).toBe(1);
    expect(arg.requestBody.conferenceData).toBeDefined();
  });

  it("updateEvent patches only provided fields", async () => {
    const { updateEvent } = await import("../src/tools/calendar.js");
    const out = (await updateEvent({
      eventId: "e1",
      calendarId: "primary",
      subject: "Renamed",
      sendUpdates: "none",
    })) as { changed: string[] };
    expect(out.changed).toEqual(["summary"]);
    const arg = mock.client.events.patch.mock.calls[0][0] as {
      requestBody: { summary: string };
    };
    expect(arg.requestBody.summary).toBe("Renamed");
  });

  it("updateEvent with no fields is a no-op (no API call)", async () => {
    const { updateEvent } = await import("../src/tools/calendar.js");
    const out = (await updateEvent({
      eventId: "e1",
      calendarId: "primary",
      sendUpdates: "all",
    })) as { changed: string[] };
    expect(out.changed).toEqual([]);
    expect(mock.client.events.patch).not.toHaveBeenCalled();
  });

  it("cancelEvent deletes with sendUpdates", async () => {
    const { cancelEvent } = await import("../src/tools/calendar.js");
    await cancelEvent({
      eventId: "e1",
      calendarId: "primary",
      sendUpdates: "all",
    });
    expect(mock.client.events.delete).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e1", sendUpdates: "all" }),
    );
  });
});

describe("respond_to_invite", () => {
  it("patches the self attendee's responseStatus", async () => {
    const { respondToInvite } = await import("../src/tools/calendar.js");
    mock.client.events.get.mockResolvedValueOnce({
      data: {
        id: "e1",
        attendees: [
          { email: "org@x.com", responseStatus: "accepted" },
          { email: "me@x.com", self: true, responseStatus: "needsAction" },
        ],
      },
    });
    const out = (await respondToInvite({
      eventId: "e1",
      calendarId: "primary",
      response: "accept",
      sendResponse: true,
    })) as { response: string };
    expect(out.response).toBe("accepted");
    const arg = mock.client.events.patch.mock.calls[0][0] as {
      requestBody: { attendees: { self?: boolean; responseStatus: string }[] };
      sendUpdates: string;
    };
    const self = arg.requestBody.attendees.find((a) => a.self);
    expect(self?.responseStatus).toBe("accepted");
    expect(arg.sendUpdates).toBe("all");
  });

  it("throws when the user is not an attendee", async () => {
    const { respondToInvite } = await import("../src/tools/calendar.js");
    mock.client.events.get.mockResolvedValueOnce({
      data: { id: "e1", attendees: [{ email: "other@x.com" }] },
    });
    await expect(
      respondToInvite({
        eventId: "e1",
        calendarId: "primary",
        response: "decline",
        sendResponse: false,
      }),
    ).rejects.toThrow(/not an attendee/);
  });
});
