# Salesforce MCP

An MCP server exposing WillowTree's Salesforce data — projects, revenue, people, timecards, skills, and assignments — as tools for Claude, Cursor, and other AI assistants.

## What This Is

This is a TypeScript MCP server that bridges Salesforce PSA (Professional Services Automation) and your AI assistant. Query your org's project pipeline, revenue forecasts, bench resources, team utilization, billing, and more via natural language. Authentication via Salesforce CLI SSO; no hardcoded tokens. Idempotent tool design — tools query Salesforce read-only (except `approve_timecards` and `upsert_skill` which write scoped updates). Ships with an interactive setup script (`setup.sh`) for rapid onboarding across Cursor, Claude Code, and Claude Desktop.

## Tech Stack

- **Language:** TypeScript (ES2022, strict mode)
- **Runtime:** Node.js >= 18 (stdio transport for MCP)
- **Build:** `tsc` (TypeScript compiler)
- **SDK:** `@modelcontextprotocol/sdk` v1.5.0
- **Auth:** Salesforce CLI (`sf` command-line tool) + native SSO login flow
- **Deps:** Minimal — MCP SDK, dotenv, Zod (validation), Nivo + Recharts (unused visualizations, legacy)

## Folder Structure

- `src/index.ts` — Entry point (stdio transport, dotenv loader)
- `src/server.ts` — MCP tool registration (40+ tools across 11 categories)
- `src/lib/salesforce.ts` — Salesforce API client (SOQL/SOSL/REST, token caching, auth flow)
- `src/lib/reports.ts` — Analytics Reports runner (wrapper for Salesforce Reports)
- `src/lib/projects.ts` — Shared project formatting utilities
- `src/tools/` — Tool implementations organized by domain:
  - `accounts/` — Client/account lookups
  - `assignments/` — Resource allocation queries
  - `contacts/` — People, headcount, bench, direct reports, skills, auth (whoami)
  - `delivery/` — Timecard submission/approval rates, utilization metrics
  - `opportunities/` — Sales pipeline
  - `projects/` — Project search, portfolio, milestones, billing
  - `resource-requests/` — Staffing requests
  - `revenue/` — Forecasts, by-client, Est vs Actuals, variance analysis
  - `skills/` — Skill lookups, ratings
  - `time-off/` — PTO requests
  - `timecards/` — Missing timecards, pending approvals, approval workflow
  - `util/` — Low-level utilities (SOQL, SOSL, object schema, reconnect)
- `dist/` — Compiled JavaScript output
- `setup.sh` — Interactive setup for Cursor / Claude Code / Claude Desktop (macOS/Windows-compatible)
- `.env.example` / `.env` — Config (SALESFORCE_INSTANCE_URL only)
- `package.json` / `tsconfig.json` — Standard Node/TS project files
- `README.md` — User-facing setup + tool reference

## Tools Exposed (40+)

**Contacts:** `whoami`, `get_contact`, `find_contacts`, `get_headcount`, `list_bench_resources`, `list_direct_reports`

**Projects:** `find_project`, `list_my_projects`, `list_all_projects`, `get_portfolio_summary`, `list_milestones`, `list_client_project_history`

**Revenue:** `get_revenue_forecast`, `get_revenue_by_client`, `compare_periods`, `get_est_vs_actuals`, `get_variance_breakdown`, `list_billing_events`

**Skills:** `find_resources_by_skill`, `get_resource_skills`, `upsert_skill`

**Delivery:** `get_my_delivery_metrics`, `get_my_team_delivery_metrics`

**Timecards:** `list_my_missing_timecards`, `list_my_missing_approvals`, `list_all_missing_timecards`, `list_all_missing_approvals`, `approve_timecards`

**Other:** `list_allocations`, `list_resource_requests`, `list_opportunities`, `get_account_details`, `get_time_offs`, `search_records_by_name`, `run_soql_query`, `run_sosl_search`, `get_object_fields`, `reconnect`

## Setup

See [`README.md`](README.md) "Getting Started" for end-user setup. Developers: `npm install`, `npm run build`, `npm start` or `npm run dev` (watch mode). Config: copy `.env.example` to `.env` and set `SALESFORCE_INSTANCE_URL` (optional; defaults to WillowTree org).

## Authentication

On first tool call, the server invokes `sf org login web`, which opens the Salesforce SSO page in your browser. You authenticate once; the token is cached in memory for the session's lifetime. Subsequent calls reuse the cached token. When your session expires, call the `reconnect` tool to refresh.

## Conventions

- **Read-only by default.** Most tools query Salesforce; only `approve_timecards` (scoped write) and `upsert_skill` (scoped write) mutate state.
- **Scoped write mutations.** Approval and skill-rating writes are narrowly scoped: approve only timecards you own (via `Actual Approver` field); upsert only skills you have permission to edit.
- **Salesforce CLI as auth provider.** No hardcoded tokens in `.env` or code. `sf` CLI manages the SSO flow and token storage locally.
- **Zod validation.** Tool input/output schemas are validated at registration.
- **Stateless between calls.** Each tool call is independent; server holds no session state (except in-memory token cache).

## Security

- **No hardcoded credentials.** Salesforce access token is obtained via `sf org login web` SSO on first call; `.env` contains only the instance URL (optional).
- **Token caching is session-scoped.** Cached token lives in memory; process exit clears it. Long-running servers should implement token refresh.
- **SOQL/SOSL are user-controlled queries.** `run_soql_query` and `run_sosl_search` allow arbitrary queries; assume untrusted input and lean on Salesforce's own FLS/CRUD permissions to gate data visibility.
- **Write mutations are scoped.** `approve_timecards` checks that the caller is the `Actual Approver`; `upsert_skill` assumes Salesforce FLS gates the write.
- **Salesforce API enforces permissions.** The server is a stateless proxy; Salesforce enforces field-level security (FLS), object-level security (OLS), and record ownership rules server-side.

## Status (as of 2026-05-16)

- ✅ Core tools live — 40+ tools across 11 categories; all read-only except `approve_timecards`, `upsert_skill`
- ✅ Authentication — SSO via Salesforce CLI; in-memory token cache; `reconnect` tool for session refresh
- ✅ Interactive setup (`setup.sh`) — Detects Node.js + `sf` CLI, auto-builds, configures Cursor/Claude Code/Claude Desktop
- ✅ SOQL/SOSL escape hatches — Advanced users can run raw queries via `run_soql_query` and `run_sosl_search`
- ✅ User-facing README — Getting Started guide, tool reference, troubleshooting
- 🟡 Visualization libraries in deps (Nivo, Recharts) — present but unused; candidates for removal if charting not planned

## Key Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `SALESFORCE_INSTANCE_URL` | Salesforce org URL | `https://willowtree.my.salesforce.com` |

## Salesforce Objects Queried

Contact, User, Account, Opportunity, pse__Proj__c, pse__Assignment__c, pse__Resource_Request__c, pse__Est_Vs_Actuals__c, pse__Timecard_Header__c, pse__Milestone__c, pse__Billing_Event__c, pse__Skill__c, pse__Skill_Certification_Rating__c, pse__Time_Off_Request__c.

## Build & Deploy

```bash
npm run build     # Compile TypeScript → dist/
npm start         # Run the MCP server (stdio transport)
npm run dev       # Watch mode for development
bash setup.sh     # Interactive setup for client configuration
```

Configure your AI client to invoke `node /path/to/dist/index.js`. `setup.sh` automates this for Cursor, Claude Code, and Claude Desktop.
