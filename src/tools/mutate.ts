// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { z } from "zod";
import { gmailClient } from "../google.js";

export const markReadSchema = z.object({
  messageId: z.string().min(1),
  isRead: z
    .boolean()
    .default(true)
    .describe("true to mark read (remove UNREAD), false to mark unread."),
});
export type MarkReadInput = z.infer<typeof markReadSchema>;

export async function markRead(input: MarkReadInput): Promise<unknown> {
  const gmail = await gmailClient();
  // Read state in Gmail is the presence/absence of the UNREAD label.
  await gmail.users.messages.modify({
    userId: "me",
    id: input.messageId,
    requestBody: input.isRead
      ? { removeLabelIds: ["UNREAD"] }
      : { addLabelIds: ["UNREAD"] },
  });
  return { ok: true, messageId: input.messageId, isRead: input.isRead };
}

export const modifyLabelsSchema = z.object({
  messageId: z.string().min(1),
  addLabelIds: z
    .array(z.string())
    .default([])
    .describe("Label ids to add (e.g. a custom label id, or STARRED)."),
  removeLabelIds: z
    .array(z.string())
    .default([])
    .describe(
      "Label ids to remove. Removing INBOX archives the message; adding INBOX un-archives.",
    ),
});
export type ModifyLabelsInput = z.infer<typeof modifyLabelsSchema>;

export async function modifyLabels(input: ModifyLabelsInput): Promise<unknown> {
  const gmail = await gmailClient();
  const res = await gmail.users.messages.modify({
    userId: "me",
    id: input.messageId,
    requestBody: {
      addLabelIds: input.addLabelIds,
      removeLabelIds: input.removeLabelIds,
    },
  });
  return {
    ok: true,
    messageId: input.messageId,
    labelIds: res.data.labelIds ?? [],
  };
}

export const deleteSchema = z.object({
  messageId: z.string().min(1),
  hardDelete: z
    .boolean()
    .default(false)
    .describe(
      "false (default): move to Trash (recoverable, auto-purged after ~30 days). true: permanently delete now — not recoverable.",
    ),
});
export type DeleteInput = z.infer<typeof deleteSchema>;

export async function deleteMessage(input: DeleteInput): Promise<unknown> {
  const gmail = await gmailClient();
  if (input.hardDelete) {
    await gmail.users.messages.delete({ userId: "me", id: input.messageId });
    return { ok: true, messageId: input.messageId, mode: "hard" };
  }
  await gmail.users.messages.trash({ userId: "me", id: input.messageId });
  return { ok: true, messageId: input.messageId, mode: "soft" };
}

export const untrashSchema = z.object({
  messageId: z.string().min(1),
});
export type UntrashInput = z.infer<typeof untrashSchema>;

export async function untrash(input: UntrashInput): Promise<unknown> {
  const gmail = await gmailClient();
  await gmail.users.messages.untrash({ userId: "me", id: input.messageId });
  return { ok: true, messageId: input.messageId };
}
