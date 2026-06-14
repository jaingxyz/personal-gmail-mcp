# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## 0.1.2

- **Fixed:** `.env` is now resolved from the project root (`dist/../.env`)
  instead of one level too high, so credentials load when an MCP client
  launches the server from a different working directory (e.g. Claude Desktop),
  not only when started from the repo root.
- **Added:** MCPB bundle pipeline and Smithery manifest for local/stdio
  publishing; status badges in the README.

## 0.1.1

- Validate the automated release pipeline (tag → GitHub Actions → npm publish
  with OIDC provenance). No functional changes to the server.

## 0.1.0

Initial release. A local stdio MCP server for a personal Gmail (consumer Google
account) inbox and calendar.

- **Auth:** loopback (installed-app) OAuth; tokens stored in the OS keyring via
  `@napi-rs/keyring`, never on disk.
- **Mail (12 tools):** list labels, list recent, search (Gmail query syntax),
  read, mark read/unread, modify labels, delete (trash/hard), untrash, send,
  reply (in-thread), create draft, send draft.
- **Calendar (7 tools):** list calendars, list events, read event, create event
  (with optional Google Meet link), update event, cancel event, respond to
  invite.
