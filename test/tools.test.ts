// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeMockGmail } from "./_mockGmail.js";

const mock = makeMockGmail();

// Both client factories hand back the same mock; getMe is unused here.
vi.mock("../src/google.js", () => ({
  gmailClient: () => Promise.resolve(mock.client),
  calendarClient: () => Promise.resolve(mock.client),
  getMe: vi.fn(),
}));

beforeEach(() => {
  for (const k of Object.keys(mock.calls)) delete mock.calls[k];
  vi.clearAllMocks();
});

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("read tools", () => {
  it("listRecent lists a label and maps nextCursor", async () => {
    const { listRecent } = await import("../src/tools/read.js");
    mock.client.users.messages.list.mockResolvedValueOnce({
      data: { messages: [{ id: "m1" }], nextPageToken: "PAGE2" },
    });
    mock.client.users.messages.get.mockResolvedValueOnce({
      data: {
        id: "m1",
        threadId: "t1",
        labelIds: ["INBOX", "UNREAD"],
        snippet: "hi",
        payload: { headers: [{ name: "Subject", value: "S" }] },
      },
    });
    const out = (await listRecent({
      label: "INBOX",
      limit: 25,
      unreadOnly: true,
    })) as {
      messages: { subject: string; unread: boolean }[];
      nextCursor: string;
    };

    // unreadOnly adds the UNREAD label filter.
    expect(mock.client.users.messages.list).toHaveBeenCalledWith(
      expect.objectContaining({
        labelIds: ["INBOX", "UNREAD"],
        maxResults: 25,
      }),
    );
    expect(out.nextCursor).toBe("PAGE2");
    expect(out.messages[0].subject).toBe("S");
    expect(out.messages[0].unread).toBe(true);
  });

  it("search passes the Gmail query and returns null cursor when absent", async () => {
    const { search } = await import("../src/tools/read.js");
    mock.client.users.messages.list.mockResolvedValueOnce({
      data: { messages: [] },
    });
    const out = (await search({ query: "from:a@b.com", limit: 10 })) as {
      nextCursor: string | null;
    };
    expect(mock.client.users.messages.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: "from:a@b.com" }),
    );
    expect(out.nextCursor).toBeNull();
  });

  it("read decodes the body and truncates", async () => {
    const { read } = await import("../src/tools/read.js");
    mock.client.users.messages.get.mockResolvedValueOnce({
      data: {
        id: "m1",
        threadId: "t1",
        labelIds: ["INBOX"],
        payload: {
          mimeType: "text/plain",
          headers: [{ name: "Subject", value: "S" }],
          body: { data: b64url("hello world body") },
        },
      },
    });
    const out = (await read({ messageId: "m1", maxBodyChars: 5 })) as {
      body: { content: string; truncated: boolean; contentType: string };
    };
    expect(out.body.contentType).toBe("text");
    expect(out.body.truncated).toBe(true);
    expect(out.body.content).toBe("hello\n…[truncated]");
  });
});

describe("mutate tools", () => {
  it("markRead removes UNREAD; mark unread adds it", async () => {
    const { markRead } = await import("../src/tools/mutate.js");
    await markRead({ messageId: "m1", isRead: true });
    expect(mock.client.users.messages.modify).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "m1",
        requestBody: { removeLabelIds: ["UNREAD"] },
      }),
    );
    await markRead({ messageId: "m1", isRead: false });
    expect(mock.client.users.messages.modify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestBody: { addLabelIds: ["UNREAD"] },
      }),
    );
  });

  it("delete soft-trashes by default, hard-deletes when asked", async () => {
    const { deleteMessage } = await import("../src/tools/mutate.js");
    const soft = (await deleteMessage({
      messageId: "m1",
      hardDelete: false,
    })) as { mode: string };
    expect(soft.mode).toBe("soft");
    expect(mock.client.users.messages.trash).toHaveBeenCalled();
    expect(mock.client.users.messages.delete).not.toHaveBeenCalled();

    const hard = (await deleteMessage({
      messageId: "m1",
      hardDelete: true,
    })) as { mode: string };
    expect(hard.mode).toBe("hard");
    expect(mock.client.users.messages.delete).toHaveBeenCalled();
  });

  it("modifyLabels passes add/remove through", async () => {
    const { modifyLabels } = await import("../src/tools/mutate.js");
    await modifyLabels({
      messageId: "m1",
      addLabelIds: ["STARRED"],
      removeLabelIds: ["INBOX"],
    });
    expect(mock.client.users.messages.modify).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { addLabelIds: ["STARRED"], removeLabelIds: ["INBOX"] },
      }),
    );
  });
});

describe("send tools", () => {
  it("send builds a raw message and posts it", async () => {
    const { send } = await import("../src/tools/send.js");
    const out = (await send({
      to: ["a@b.com"],
      cc: [],
      bcc: [],
      subject: "Hi",
      body: "Body",
      bodyFormat: "text",
    })) as { ok: boolean; id: string };
    expect(out.ok).toBe(true);
    const arg = mock.client.users.messages.send.mock.calls[0][0] as {
      requestBody: { raw: string };
    };
    const decoded = Buffer.from(arg.requestBody.raw, "base64url").toString(
      "utf8",
    );
    expect(decoded).toContain("To: a@b.com");
    expect(decoded).toContain("Subject: Hi");
  });

  it("reply derives recipient + threading and stays in-thread", async () => {
    const { reply } = await import("../src/tools/send.js");
    mock.client.users.messages.get.mockResolvedValueOnce({
      data: {
        id: "orig",
        threadId: "thread9",
        payload: {
          headers: [
            { name: "From", value: "Alice <alice@x.com>" },
            { name: "To", value: "me@gmail.com, bob@x.com" },
            { name: "Subject", value: "Question" },
            { name: "Message-ID", value: "<orig@mail>" },
          ],
        },
      },
    });
    await reply({
      messageId: "orig",
      body: "My answer",
      bodyFormat: "text",
      replyAll: true,
    });
    const arg = mock.client.users.messages.send.mock.calls[0][0] as {
      requestBody: { raw: string; threadId: string };
    };
    expect(arg.requestBody.threadId).toBe("thread9");
    const decoded = Buffer.from(arg.requestBody.raw, "base64url").toString(
      "utf8",
    );
    expect(decoded).toContain("To: alice@x.com");
    expect(decoded).toContain("Subject: Re: Question");
    expect(decoded).toContain("In-Reply-To: <orig@mail>");
    // reply-all pulls the other To recipient into Cc
    expect(decoded).toContain("bob@x.com");
  });

  it("createDraft then sendDraft", async () => {
    const { createDraft, sendDraft } = await import("../src/tools/send.js");
    const d = (await createDraft({
      to: ["a@b.com"],
      cc: [],
      bcc: [],
      subject: "D",
      body: "draft body",
      bodyFormat: "text",
    })) as { draftId: string };
    expect(d.draftId).toBe("draft1");
    const s = (await sendDraft({ draftId: "draft1" })) as { ok: boolean };
    expect(s.ok).toBe(true);
    expect(mock.client.users.drafts.send).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { id: "draft1" } }),
    );
  });
});
