<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## apps/web rules (extends the root AGENTS.md)

- Route handlers and server actions validate input with schemas from `packages/contracts`; never trust request bodies.
- Business logic belongs in `packages/domain`; `apps/web/server/` only adapts HTTP/session to domain services.
- WhatsApp webhooks (`app/api/webhooks/whatsapp/`, `app/webhooks/meta/`) must verify signatures before parsing; keep replay/idempotency behaviour.
- Never import server-only code or env secrets into client components (`"use client"` files).
- Verify UI changes with the matching Playwright suite, e.g. `npm run test:release:web` or `npm run test:phase-a:web`.
