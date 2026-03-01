# Salesforce MCP Server

An MCP (Model Context Protocol) server that exposes Salesforce PSA data through structured tools. Designed for use with AI assistants (Cursor, Claude, etc.) to answer operational questions for General Managers, Directors, Project Managers, Engineering Managers, and Individual Contributors.

## Prerequisites

- Node.js >= 18
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) installed and available on your PATH

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your Salesforce credentials:

```
SALESFORCE_INSTANCE_URL=https://willowtree.my.salesforce.com
```

## Build & Run

```bash
npm run build     # compile TypeScript
npm start         # run the MCP server (stdio transport)
npm run dev       # watch mode for development
```

## Authentication

On the first tool call, the server authenticates via the Salesforce CLI:

1. It runs `sf org login web`, which opens your browser to the Salesforce SSO login page.
2. You log in through the browser and authorize access.
3. The CLI stores the session locally, and the server retrieves the access token via `sf org display`.
4. The token is cached in memory for subsequent calls — no repeated logins within the same session.

If your session expires, use the `reconnect` tool to re-authenticate without restarting the server.

## MCP Client Configuration

### Cursor

Add to `.cursor/mcp.json` in your project (or global settings):

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

### Claude Desktop

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

### Claude Code

Add via the CLI:

```bash
claude mcp add salesforce node /path/to/salesforce-mcp/dist/index.js
```

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
| `search_records_by_name` | Cross-object SOSL search by name/keyword — returns IDs and URLs |
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
