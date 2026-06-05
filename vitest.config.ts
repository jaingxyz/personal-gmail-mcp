// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 jaingxyz
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      // Excluded (same rationale as the Outlook server):
      //  - index.ts: trivial stdio bootstrap.
      //  - scripts/: CLI tooling, not MCP runtime.
      //  - config.ts: env/.env loading; coverage depends on .env presence.
      //  - auth.ts: OAuth/keyring side effects, exercised manually via whoami.
      //  - google.ts: thin client factory singleton.
      //  - server.ts: Zod -> registerTool wiring, covered by integration.
      exclude: [
        "src/index.ts",
        "src/scripts/**",
        "src/config.ts",
        "src/auth.ts",
        "src/google.ts",
        "src/server.ts",
      ],
      thresholds: {
        lines: 75,
        statements: 75,
        functions: 70,
        branches: 55,
      },
    },
  },
});
