# Salesforce MCP Server

Ask questions about WillowTree's Salesforce data — projects, revenue, people, timecards, and more — directly inside your AI assistant (Cursor, Claude, etc.), using plain English.

> **First time here? Jump straight to [Getting Started](#getting-started) below.**

---

## Getting Started

No technical experience needed. One command does everything for you.

### Step 1 — Download this project

If you received this as a zip file, unzip it somewhere easy to find (e.g. your Desktop or Documents folder).

If you have Git, you can also clone it:

```bash
git clone <repo-url>
cd salesforce-mcp
```

### Step 2 — Open Terminal

- **Mac:** Press `Command + Space`, type `Terminal`, and hit Enter.
- **Windows:** Press `Windows + R`, type `cmd`, and hit Enter.

Navigate to the project folder. For example, if you unzipped it to your Desktop:

```bash
cd ~/Desktop/salesforce-mcp
```

### Step 3 — Run the setup script

```bash
bash setup.sh
```

The script will:

1. Check that everything it needs is installed (and tell you exactly what to do if something is missing).
2. Install the project and build it automatically.
3. Ask which AI client you use — **Cursor**, **Claude Code**, or **Claude Desktop / Cowork** — and configure it for you.
4. Optionally log you in to Salesforce right away.

That's it. You're done.

---

### What can I ask after setup?

Open your AI assistant and try questions like:

- *"What projects am I currently on?"*
- *"Show me the revenue forecast for this quarter."*
- *"Who are the bench resources available right now?"*
- *"What are my missing timecards this week?"*
- *"List all open resource requests for my team."*

### My session expired / I need to log in again

Re-authenticate at a terminal (one command):

```bash
sf org login web --instance-url https://willowtree.my.salesforce.com --alias willowtree
```

Then tell your AI assistant **"reconnect"** — it will pick up the new session without restarting the client.

### Tool call hangs / never returns a result

The MCP server must not open a browser — it runs over stdio and any browser launch will silently block. If tool calls hang, you are likely on an older version of this repo. Fix:

```bash
cd ~/Desktop/salesforce-mcp
git pull
npm run build
```

Then restart your AI client. The server now reads your existing `sf` CLI session instead of launching a browser.

### Claude Code picks the wrong Salesforce tool (e.g. "TDX Salesforce" or "WT Salesforce Sandbox")

Claude Code has access to several Salesforce-related MCP connectors. If it reaches for a cloud connector instead of the local one, be explicit in your prompt:

> *"Use the local salesforce MCP — list my projects."*

Or name the tool directly: *"call list_my_projects"*. The local tools are things like `list_my_projects`, `whoami`, `get_revenue_forecast`, etc. The TDX and Sandbox connectors require separate OAuth setup and are unrelated to this server.

### Need to re-run setup?

`bash setup.sh` is safe to run as many times as you like.

---

## For Developers

<details>
<summary>Manual setup and configuration details</summary>

### Prerequisites

- Node.js >= 18
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) installed and available on your PATH

### Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your Salesforce credentials:

```
SALESFORCE_INSTANCE_URL=https://willowtree.my.salesforce.com
```

### Build & Run

```bash
npm run build     # compile TypeScript
npm start         # run the MCP server (stdio transport)
npm run dev       # watch mode for development
```

### Authentication

The MCP server reads its access token from the `sf` CLI's existing session — it never opens a browser. The browser-based SSO login happens **once at install time**, when `setup.sh` runs `sf org login web` interactively in your terminal. After that:

1. The MCP server calls `sf org display --target-org willowtree --verbose --json` to read the cached access token.
2. The token is cached in memory for the lifetime of the MCP process — no repeated CLI calls within the session.
3. When the Salesforce session eventually expires (12 hours to several days, depending on org policy), re-authenticate at a shell:

   ```bash
   sf org login web --instance-url https://willowtree.my.salesforce.com --alias willowtree
   ```

   Then call the `reconnect` tool (or restart your AI client) to drop the in-memory cache.

> **Why no browser launch inside the MCP?** The server communicates over stdio. Spawning `sf org login web` from inside the server pipes-stdout to nowhere, the browser flow can't complete, and the MCP hangs. That's why the initial login is split out into `setup.sh`.

### Running against a second org

One server process talks to exactly one org. To query a second Salesforce org, run a
**second instance of this same build** with two env vars set — no code fork, no second
checkout.

| Variable | Purpose | Default |
|---|---|---|
| `SF_TARGET_ORG` | Which `sf` CLI alias to read the session from | `willowtree` |
| `SF_TOOLSET` | `full` (all tools) or `generic` (org-agnostic tools only) | `full` |

**Step 1 — authenticate the second org once, at a terminal:**

```bash
sf org login web --instance-url https://<your-org>.my.salesforce.com --alias <alias>
```

**Step 2 — register a second MCP server** pointing at the same `dist/index.js`:

```bash
claude mcp add salesforce-<alias> -s user -e SF_TARGET_ORG=<alias> -e SF_TOOLSET=generic -- node /path/to/salesforce-mcp/dist/index.js
```

Set `SF_TOOLSET=generic` for **any org without the Salesforce PSA managed package**.
Most tools here query `pse__*` objects and would only return `INVALID_TYPE` errors
against a non-PSA org. Generic mode exposes the five tools that work anywhere:
`whoami`, `run_soql_query`, `run_sosl_search`, `get_object_fields`, `reconnect`.

**Notes**

- The instance URL is read from the `sf` CLI for the named alias, never from env.
  `SALESFORCE_INSTANCE_URL` is honoured **only on the default org** — `.env` pins it
  to WillowTree, and dotenv would otherwise leak that value into the second instance
  and 401 every call.
- `whoami` reports the target org alias and org ID, so you can always confirm which
  org a tool call hit. It no longer requires a linked Contact record, which a user
  in a non-PSA org typically won't have.
- Each instance caches its own token. `reconnect` clears only its own.

### MCP Client Configuration

#### Cursor

Add to `~/.cursor/mcp.json` (global, works in every project):

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["/path/to/salesforce-mcp/dist/index.js"]
    }
  }
}
```

#### Claude Desktop / Cowork

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["/path/to/salesforce-mcp/dist/index.js"]
    }
  }
}
```

#### Claude Code

```bash
claude mcp add salesforce -- node /path/to/salesforce-mcp/dist/index.js
```

</details>

## Tools

### Contacts (`contacts/`)

| Tool | Description |
|------|-------------|
| `whoami` | Returns the authenticated user's identity and Contact ID |
| `get_contact` | Looks up a single contact by name or email |
| `find_contacts` | Searches contacts with filters (name, role, service line, region, etc.) |
| `get_headcount` | Headcount breakdown grouped by service line, company, region, role, or title |
| `list_bench_resources` | People on the bench or rolling off soon, with optional skill filter |
| `list_direct_reports` | Lists direct reports for a given manager |

### Projects (`projects/`)

| Tool | Description |
|------|-------------|
| `find_project` | Searches projects by name |
| `list_my_projects` | Projects where the current user is PM or Director |
| `list_all_projects` | All active projects with filters |
| `get_portfolio_summary` | Aggregated portfolio metrics |
| `list_milestones` | Project milestones and billing milestones |
| `list_client_project_history` | All projects for a given client/account |

### Revenue (`revenue/`)

| Tool | Description |
|------|-------------|
| `get_revenue_forecast` | Revenue forecast by month from Est vs Actuals |
| `get_revenue_by_client` | Revenue aggregated by client for a date range |
| `compare_periods` | Side-by-side comparison of two periods (quarter-over-quarter, month-over-month, or custom) |
| `get_est_vs_actuals` | Raw Est vs Actuals data for a project |
| `get_variance_breakdown` | Revenue variance breakdown |
| `list_billing_events` | Billing events for a project |

### Assignments (`assignments/`)

| Tool | Description |
|------|-------------|
| `list_allocations` | Resource allocations with filters |

### Resource Requests (`resource-requests/`)

| Tool | Description |
|------|-------------|
| `list_resource_requests` | Open resource requests with `my_requests` auto-scope for PMs/Directors |

### Opportunities (`opportunities/`)

| Tool | Description |
|------|-------------|
| `list_opportunities` | Sales opportunities with filters |

### Accounts (`accounts/`)

| Tool | Description |
|------|-------------|
| `get_account_details` | Detailed account/client information |

### Skills (`skills/`)

| Tool | Description |
|------|-------------|
| `find_resources_by_skill` | Find people who have a specific skill |
| `get_resource_skills` | All skills for a person, team, or manager's direct reports |
| `upsert_skill` | Add or update a skill rating for one or more people |

### Delivery Metrics (`delivery/`)

| Tool | Description |
|------|-------------|
| `get_my_delivery_metrics` | Personal timecard and utilization metrics |
| `get_my_team_delivery_metrics` | Team-level submission, approval, and utilization metrics with underutilization filtering |

### Timecards (`timecards/`)

| Tool | Description |
|------|-------------|
| `list_my_missing_timecards` | Missing timecards for the current user |
| `list_my_missing_approvals` | Pending timecard approvals for the current user |
| `list_all_missing_timecards` | All missing timecards (team view) |
| `list_all_missing_approvals` | All pending approvals (team view) |
| `approve_timecards` | Approve pending timecards |

### Time Off (`time-off/`)

| Tool | Description |
|------|-------------|
| `get_time_offs` | Time-off requests with filters |

### Utilities (`util/`)

| Tool | Description |
|------|-------------|
| `search_records_by_name` | Full-text search across Projects, Accounts, Contacts, Opportunities, and Resource Requests by name or keyword — returns IDs and URLs |
| `run_sosl_search` | Executes a raw SOSL search across any object types — use when `search_records_by_name` doesn't cover what you need |
| `get_object_fields` | Lists all field names, labels, and types for any Salesforce object — useful before writing ad-hoc SOQL queries |
| `run_soql_query` | Raw SOQL query execution (last resort for ad-hoc queries) |
| `reconnect` | Re-authenticates the Salesforce connection |

## Project Structure

```
src/
├── index.ts                 # Entry point (stdio transport)
├── server.ts                # Tool registration
├── lib/
│   ├── salesforce.ts        # Salesforce API client (SOQL, REST, auth)
│   ├── reports.ts           # Salesforce Analytics Reports runner
│   └── projects.ts          # Shared project formatting
└── tools/
    ├── accounts/
    ├── assignments/
    ├── contacts/
    ├── delivery/
    ├── opportunities/
    ├── projects/
    ├── resource-requests/
    ├── revenue/
    ├── skills/
    ├── time-off/
    ├── timecards/
    └── util/
```

## Salesforce Objects Used

| Object | Purpose |
|--------|---------|
| `Contact` | People / PSA resources |
| `User` | Salesforce users (managers, auth) |
| `Account` | Clients |
| `Opportunity` | Sales pipeline |
| `pse__Proj__c` | PSA Projects |
| `pse__Assignment__c` | Resource allocations |
| `pse__Resource_Request__c` | Staffing requests |
| `pse__Est_Vs_Actuals__c` | Revenue and cost tracking |
| `pse__Timecard_Header__c` | Timecards |
| `pse__Milestone__c` | Project milestones |
| `pse__Billing_Event__c` | Billing events |
| `pse__Skill__c` | Skill/certification definitions |
| `pse__Skill_Certification_Rating__c` | Person-to-skill ratings |
| `pse__Time_Off_Request__c` | Time-off requests |
