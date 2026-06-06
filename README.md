# personal-gmail-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes a personal Gmail (consumer Google account) inbox **and calendar** to MCP clients like Claude Desktop. Talks to the Gmail and Google Calendar APIs over HTTPS, uses a local **loopback OAuth** flow, and stores tokens in the **OS keyring**.

Sibling to [personal-outlook-mcp](https://github.com/jaingxyz/personal-outlook-mcp); same design (local stdio, keyring-backed tokens, you bring your own OAuth client), different provider. Tools are prefixed `gmail_*`.

> **Status: functional.** Auth (loopback OAuth + keyring token cache), 12 mail tools, and 7 calendar tools are in place and verified against a live account. Not yet published to npm — install from source for now (see below).

## Why keyring + bring-your-own-client

Every Gmail MCP server we surveyed stores OAuth tokens as a **plaintext JSON file** in your home directory. This one stores them in the OS keyring (macOS Keychain / Windows Credential Manager / Linux Secret Service) via [`@napi-rs/keyring`](https://github.com/Brooooooklyn/keyring-node), and runs entirely locally — your mail never passes through anyone else's servers.

## Google setup (required, ~5 minutes, free)

You must create your own Google Cloud OAuth client.

1. Go to https://console.cloud.google.com → create a project.
2. **APIs & Services → Library** → enable both **Gmail API** and **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Add your own Google account as a **test user**.
   - **Publish the app ("In production").** You can leave it **unverified** for personal use (you'll click through an "unverified app" warning at sign-in).
   - ⚠️ **This step matters:** an app left in **"Testing"** status issues refresh tokens that **expire after 7 days** — you'd have to re-auth every week. Publishing to production (even unverified) gives long-lived refresh tokens.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → application type **Desktop app**. Copy the **Client ID** and **Client secret**.
5. `cp .env.example .env` and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

The required scopes are requested at sign-in; you consent at the browser prompt:

| Scope                                     | Used for                                                     |
| ----------------------------------------- | ------------------------------------------------------------ |
| `https://mail.google.com/`                | full mailbox read/modify/send                                |
| `.../auth/calendar.events`                | event read/create/update/cancel/respond                      |
| `.../auth/calendar.calendarlist.readonly` | enumerating your calendars (`gmail_calendar_list_calendars`) |
| `.../auth/userinfo.email` + `openid`      | identifying the signed-in account                            |

> Changing the scope list invalidates the cached token — re-run `npm run whoami` to re-consent.

## First run (loopback auth)

```bash
npm install
npm run build
npm run whoami
```

`whoami` opens your browser to Google's consent page (the URL is also printed to **stderr** if the browser doesn't open). After you approve, a throwaway `127.0.0.1` listener captures the redirect, exchanges the code, and stores the token set in the OS keyring under service `personal-gmail-mcp`. It then prints your Gmail profile as JSON. Subsequent runs refresh silently.

To sign out (forget the cached token):

```bash
node -e "import('./dist/auth.js').then(m => m.signOut())"
```

## MCP client integration

Point your MCP client (Claude Desktop or similar) at the built server. Until
this is published to npm, use the **from-source** form with an absolute path to
`dist/index.js`:

```json
{
  "mcpServers": {
    "personal-gmail": {
      "command": "node",
      "args": ["/absolute/path/to/personal-gmail-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "<YOUR-CLIENT-ID>",
        "GOOGLE_CLIENT_SECRET": "<YOUR-CLIENT-SECRET>"
      }
    }
  }
}
```

> If your `node` is managed by a version manager (nvm, mise, asdf), use the
> **absolute path** to the node binary (e.g. `which node`) — MCP clients launch
> with a minimal `PATH` and won't resolve a bare `node`.

Once published to npm, the simpler `npx` form works:

```json
{
  "command": "npx",
  "args": ["-y", "@jaingxyz/personal-gmail-mcp"],
  "env": { "GOOGLE_CLIENT_ID": "...", "GOOGLE_CLIENT_SECRET": "..." }
}
```

Run `npm run whoami` from a terminal **once** to seed the keyring before
launching the client — the browser/consent step can't be surfaced from inside
the app (stderr is swallowed), so the MCP server only does silent refresh and
will report `Re-authentication required` if the cache is empty or stale.

## Tools

All tools are prefixed `gmail_*` (mail) or `gmail_calendar_*` (calendar) so a
multi-account setup can coexist.

| Tool                               | Purpose                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `gmail_list_labels`                | List labels (system + custom) with unread/total counts.                                |
| `gmail_list_recent`                | Newest-first messages in a label. Supports `unreadOnly`, cursor paging.                |
| `gmail_search`                     | Search with Gmail query syntax (`from:`, `subject:`, `has:attachment`, `newer_than:`). |
| `gmail_read`                       | Fetch one message with decoded body (text preferred, html fallback).                   |
| `gmail_mark_read`                  | Mark read/unread (toggles the `UNREAD` label).                                         |
| `gmail_modify_labels`              | Add/remove labels (remove `INBOX` to archive, add `STARRED`, etc.).                    |
| `gmail_delete`                     | Trash (recoverable) by default; `hardDelete=true` is permanent.                        |
| `gmail_untrash`                    | Restore a message from Trash.                                                          |
| `gmail_send`                       | Send a new email immediately.                                                          |
| `gmail_reply`                      | Reply in-thread by message id; `replyAll=true` for all recipients.                     |
| `gmail_create_draft`               | Create a draft without sending; returns a draftId.                                     |
| `gmail_send_draft`                 | Send a previously created draft.                                                       |
| `gmail_calendar_list_calendars`    | List calendars with editability.                                                       |
| `gmail_calendar_list_events`       | Events in a time range (recurring series expanded).                                    |
| `gmail_calendar_read_event`        | Full event details incl. attendees and recurrence.                                     |
| `gmail_calendar_create_event`      | Create an event; optional Google Meet link and invites.                                |
| `gmail_calendar_update_event`      | Update subject/time/location/description/attendees.                                    |
| `gmail_calendar_cancel_event`      | Delete an event; notifies attendees when you organize it.                              |
| `gmail_calendar_respond_to_invite` | accept / tentativelyAccept / decline an invite.                                        |

Calendar event times use `{ dateTime, timeZone }` where `dateTime` is local
form (no offset) and `timeZone` is an IANA name. Output times default to
`America/Los_Angeles`; override with `PERSONAL_GMAIL_TZ`.

## How it differs from the Outlook server

|                | Outlook (Graph)       | Gmail                                                            |
| -------------- | --------------------- | ---------------------------------------------------------------- |
| Auth flow      | MSAL device code      | Loopback / installed-app (Google forbids device code for Gmail)  |
| Mail container | Folders               | **Labels** (`INBOX`, `SENT`, `DRAFT`, `TRASH`, custom)           |
| Search         | Graph `$search` (KQL) | Gmail query syntax (`from: subject: has:attachment newer_than:`) |
| Send           | JSON message          | base64url **RFC-2822 MIME**                                      |
| Soft delete    | move to Deleted Items | `trash` / `untrash`                                              |
| Calendar       | same Graph API        | **separate** Google Calendar API + scope                         |

## License

AGPL-3.0-or-later. See [LICENSE](./LICENSE).

## Acknowledgements

Built with assistance from [Claude](https://www.anthropic.com/claude) (Anthropic). Architecture and final review remain the human author's responsibility.
