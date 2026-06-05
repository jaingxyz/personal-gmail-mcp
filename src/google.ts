// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { google } from "googleapis";
import type { gmail_v1, calendar_v3 } from "googleapis";
import { getAuthClient, type GetClientOptions } from "./auth.js";

export async function gmailClient(
  opts?: GetClientOptions,
): Promise<gmail_v1.Gmail> {
  const auth = await getAuthClient(opts);
  return google.gmail({ version: "v1", auth });
}

export async function calendarClient(
  opts?: GetClientOptions,
): Promise<calendar_v3.Calendar> {
  const auth = await getAuthClient(opts);
  return google.calendar({ version: "v3", auth });
}

/**
 * Smoke-test identity probe: returns the signed-in account's Gmail profile
 * (email address, total messages/threads, history id).
 */
export async function getMe(opts?: GetClientOptions): Promise<{
  emailAddress?: string | null;
  messagesTotal?: number | null;
  threadsTotal?: number | null;
  historyId?: string | null;
}> {
  const gmail = await gmailClient(opts);
  const res = await gmail.users.getProfile({ userId: "me" });
  return {
    emailAddress: res.data.emailAddress,
    messagesTotal: res.data.messagesTotal,
    threadsTotal: res.data.threadsTotal,
    historyId: res.data.historyId,
  };
}
