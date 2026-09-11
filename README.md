# PrintQ

QR-based print ordering for Xerox/photocopy shops. This is a working
foundation, not a finished, deployed product — read "What's not done"
before showing this to a shop owner.

## What actually works right now

Run it yourself:

```bash
npm install
npm test           # 26 passing tests on the logic that matters most
npm run dev         # http://localhost:3000
```

- **Pricing engine** (`src/lib/pricing.ts`) — server-authoritative,
  never trusts a client-submitted total. Handles A4/A3, B&W/colour,
  copies, duplex discount, shop minimum order. Tested against the
  spec's own worked example (12 pages × 2 copies, B&W, A4 → ₹24).
- **Page-range parser** (`src/lib/pageRange.ts`) — validates "1-5",
  "3,5,7", "2-8,10,12-14" against the real page count, rejects
  garbage and out-of-range input.
- **Print job state machine** (`src/lib/jobState.ts`) — this is the
  piece that stops a network retry from causing a double print. Once
  a job reaches `PRINT_ATTEMPTED`, there is no automatic path back to
  `QUEUED`; a shop owner has to put it in `HELD` and re-queue it
  deliberately. Enforced by explicit transition tables, not by
  convention.
- **Token formatting** (`src/lib/token.ts`) — formats `A001`…`A999`,
  `B001`… The atomic *increment* lives in Postgres
  (`get_next_token()` in `db/schema.sql`), using
  `INSERT ... ON CONFLICT DO UPDATE`, because generating the next
  number in application code races under concurrent orders.
- **`/api/price`** — the only place a price is computed for a real
  order. Recalculates from scratch server-side from shop pricing +
  validated page range; ignores anything the client claims.
- **Full page set**: marketing home, how it works, for shops,
  pricing, privacy, terms, contact; the customer flow at
  `/p/[shopId]` (upload → options → live price → UPI intent → token
  screen); a shop dashboard mock at `/dashboard`. All built, typed,
  and pass `next build`.
- **Database schema** (`db/schema.sql`) — every table from the spec
  (shops, pricing, orders, order_files, payments, print_jobs,
  print_attempts, printers, print_agents, queue_entries, licences,
  audit_logs), with Row Level Security policies for tenant isolation
  and the atomic token function.
- **Windows print agent** (`agent/printq_agent.py`) — real structure:
  heartbeat, job claim, LibreOffice conversion, SumatraPDF silent
  print, and the same "report PRINT_ATTEMPTED before touching the
  printer" ordering that makes the state machine's guarantee actually
  hold on the agent side, not just the server side.

## What's not done (and why)

I built this in a sandboxed environment with no persistent database,
no payment gateway account, no Windows machine, and no physical
printer. Concretely, that means:

- **No live Supabase project.** The schema is written and RLS
  policies are in place, but nothing is deployed. `npm run dev` uses
  in-memory mock data for the dashboard and a fixed dev pricing
  config for `/api/price`.
- **Payment is simulated only.** The customer flow shows a real UPI
  intent link and a "[Dev mode] Simulate payment confirmed" button —
  there's no Razorpay/Cashfree webhook wired up. That integration
  needs a real gateway account (per shop, per the architecture) and
  cannot be built or tested without one.
- **The Windows agent has never run against a real printer.** The
  code is structurally correct (win32print, SumatraPDF CLI, the
  attempt-before-send ordering) but the exact SumatraPDF
  `-print-settings` string can vary by version and printer driver —
  test it against your actual shop printer before trusting it.
- **File upload/conversion isn't wired to real storage.** The
  customer flow uses a placeholder page count instead of an actual
  uploaded-file inspection step. Direct-to-R2/Supabase-Storage signed
  uploads are designed for in the schema/env vars but not implemented
  in the UI yet.
- **Auth, admin panel, and licence enforcement are not built.** These
  are real, non-trivial pieces (Supabase Auth, an admin-only route
  guard, a licence-expiry cron) that weren't a good use of remaining
  time versus getting the core price/queue/print-safety logic right
  and genuinely tested.
- **Fonts**: the app is configured for Archivo / IBM Plex Sans / IBM
  Plex Mono via `next/font/google`. This sandbox can't reach
  `fonts.googleapis.com` to verify the production build fetches them
  — `npm run build` will do this correctly with normal internet
  access; I confirmed the rest of the build (routing, types, all
  pages) is clean with the font import temporarily removed.

## Suggested next steps, in order

1. Create the Supabase project, run `db/schema.sql`, wire up
   Supabase Auth for shop owner accounts.
2. Replace the mock data in `/dashboard` and `/api/price` with real
   queries.
3. Wire direct-to-storage upload + a real page-count/PDF-conversion
   step (this can run server-side for PDFs; DOC/PPT conversion is
   designed to happen on the shop's PC via the agent, per the spec,
   to avoid an expensive conversion server).
4. Pick one payment gateway (Razorpay is the more common choice for
   Indian small merchants) and implement the per-shop connected
   account + webhook.
5. Install and test the agent on one real shop PC with one real
   printer before onboarding any shop.

## Project layout

```
src/lib/           pricing, page-range, token, job-state logic + tests
src/app/           marketing site, customer flow, dashboard, /api/price
db/schema.sql       full multi-tenant Postgres schema + RLS
agent/              Windows print agent (Python)
.env.example        every required variable, documented
```
