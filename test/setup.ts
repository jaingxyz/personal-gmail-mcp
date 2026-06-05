// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz

// Tests import src/config indirectly through tool modules. config.ts requires
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET at module-load time. In CI there is
// no .env, so set placeholders before any source file is imported.
if (!process.env.GOOGLE_CLIENT_ID)
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
if (!process.env.GOOGLE_CLIENT_SECRET)
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
