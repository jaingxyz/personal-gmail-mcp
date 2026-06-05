# personal-gmail-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes a personal Gmail (consumer Google account) inbox **and calendar** to MCP clients like Claude Desktop. Talks to the Gmail and Google Calendar APIs over HTTPS, uses a local **loopback OAuth** flow, and stores tokens in the **OS keyring**.

Sibling to [personal-outlook-mcp](https://github.com/jaingxyz/personal-outlook-mcp); same design (local stdio, keyring-backed tokens, you bring your own OAuth client), different provider. Tools are prefixed `gmail_*`.

> **Status: functional.** Auth (loopback OAuth + keyring token cache), 12 mail tools (list/search/read/labels/mark-read/modify-labels/trash/send/reply/draft), and 7 calendar tools (list calendars, list/read/create/update/cancel events, respond to invite) are in place and verified against a live account.

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

The required scopes (`https://mail.google.com/`, `calendar.events`, `userinfo.email`) are requested at sign-in; you consent at the browser prompt.

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

## Claude Desktop integration

```json
{
  "mcpServers": {
    "personal-gmail": {
      "command": "npx",
      "args": ["-y", "@jaingxyz/personal-gmail-mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "<YOUR-CLIENT-ID>",
        "GOOGLE_CLIENT_SECRET": "<YOUR-CLIENT-SECRET>"
      }
    }
  }
}
```

Run `npm run whoami` from a terminal **once** to seed the keyring before launching Claude Desktop — the browser/consent step can't be surfaced from inside the app (stderr is swallowed), so the MCP server only does silent refresh and will report `Re-authentication required` if the cache is empty or stale.

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
