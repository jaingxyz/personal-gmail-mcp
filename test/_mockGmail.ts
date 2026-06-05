// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { vi } from "vitest";

// A hand-rolled stand-in for the googleapis gmail_v1.Gmail client. Each method
// records its call args and returns a queued response shaped as { data }.
export interface MockGmail {
  client: {
    users: {
      getProfile: ReturnType<typeof vi.fn>;
      labels: { list: ReturnType<typeof vi.fn> };
      messages: {
        list: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
        modify: ReturnType<typeof vi.fn>;
        trash: ReturnType<typeof vi.fn>;
        untrash: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
      };
      drafts: {
        create: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
      };
    };
    calendarList: { list: ReturnType<typeof vi.fn> };
    events: {
      list: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      patch: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };
  calls: Record<string, unknown[]>;
}

export function makeMockGmail(): MockGmail {
  const calls: Record<string, unknown[]> = {};
  const rec =
    (name: string, impl: (args: unknown) => unknown) => (args: unknown) => {
      (calls[name] ??= []).push(args);
      return Promise.resolve({ data: impl(args) });
    };

  // Default behaviors; individual tests override via the returned vi.fn().
  const client = {
    users: {
      getProfile: vi.fn(
        rec("getProfile", () => ({
          emailAddress: "me@gmail.com",
          messagesTotal: 100,
          threadsTotal: 80,
        })),
      ),
      labels: {
        list: vi.fn(rec("labels.list", () => ({ labels: [] }))),
      },
      messages: {
        list: vi.fn(rec("messages.list", () => ({ messages: [] }))),
        get: vi.fn(rec("messages.get", () => ({}))),
        modify: vi.fn(rec("messages.modify", () => ({ labelIds: [] }))),
        trash: vi.fn(rec("messages.trash", () => ({}))),
        untrash: vi.fn(rec("messages.untrash", () => ({}))),
        delete: vi.fn(rec("messages.delete", () => ({}))),
        send: vi.fn(
          rec("messages.send", () => ({ id: "sent1", threadId: "t1" })),
        ),
      },
      drafts: {
        create: vi.fn(rec("drafts.create", () => ({ id: "draft1" }))),
        send: vi.fn(
          rec("drafts.send", () => ({ id: "sent1", threadId: "t1" })),
        ),
      },
    },
    // Calendar API surface (calendarClient() returns this same object).
    calendarList: {
      list: vi.fn(rec("calendarList.list", () => ({ items: [] }))),
    },
    events: {
      list: vi.fn(rec("events.list", () => ({ items: [] }))),
      get: vi.fn(rec("events.get", () => ({}))),
      insert: vi.fn(rec("events.insert", () => ({ id: "evt1" }))),
      patch: vi.fn(rec("events.patch", () => ({ id: "evt1" }))),
      delete: vi.fn(rec("events.delete", () => ({}))),
    },
  };

  return { client, calls };
}
