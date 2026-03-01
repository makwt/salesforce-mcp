# Allocation Tools Design

**Date:** 2026-02-25  
**Status:** Approved

## Background

The MCP server exposes Salesforce PSA data to AI assistants. The existing tools cover projects, resource requests, direct reports, and timecards. This design adds allocation/assignment visibility — answering questions like:

- Who from WillowTree is allocated to project X?
- Who from Product Delivery is on the bench?
- Who from Design is becoming available soon?
- Which Backend Engineers from Brazil are available?

In PSA, allocations live in `pse__Assignment__c`, which links a Contact (resource) to a `pse__Proj__c` (project) with start/end dates, % allocation, and a status.

## Data Model

### `pse__Assignment__c`

Key fields used:

| Field | Type | Purpose |
|---|---|---|
| `pse__Resource__c` | Lookup(Contact) | The allocated person |
| `pse__Project__r.Name` | Relationship | Project name |
| `pse__Start_Date__c` | Formula(Date) | Assignment start |
| `pse__End_Date__c` | Formula(Date) | Assignment end |
| `pse__Status__c` | Picklist | Tentative, Scheduled, Closed |
| `pse__Percent_Allocated__c` | Number | % allocation |
| `pse__Is_Billable__c` | Checkbox | Billable flag |
| `Reporting_Company__c` | Formula(Text) | Resource's reporting company (e.g. WillowTree) |
| `Resource_Country__c` | Formula(Text) | Resource's country (e.g. Brazil) |
| `pse__Resource__r.pse__Region__r.Name` | Relationship | Resource's region |
| `pse__Resource__r.pse__Practice__r.Name` | Relationship | Resource's practice/reporting company |
| `pse__Resource__r.Business_Title__c` | Text | Resource's role/title |

Active statuses in this org: `Tentative`, `Scheduled`.

### `Contact` (resource side)

Key fields used for bench/availability queries:

| Field | Type | Purpose |
|---|---|---|
| `pse__Is_Resource__c` | Checkbox | Marks this contact as a PSA resource |
| `pse__Is_Resource_Active__c` | Checkbox | Active resource flag |
| `pse__Region__c` | Lookup(Region) | Resource's region |
| `pse__Practice__c` | Lookup(TDS Company) | Resource's reporting company |
| `pse__Group__c` | Lookup(Cost Center Group) | Resource's cost center / service line |
| `Country__c` | Formula(Text) | Resource's country |
| `Business_Title__c` | Text | Resource's role/title |

## Tools

### Tool 1: `list_allocations`

**Purpose:** Lists current (or future) active assignments. Answers "who is allocated to what?"

**Object:** `pse__Assignment__c`

**Default filter:** `pse__Start_Date__c <= TODAY AND pse__End_Date__c >= TODAY AND pse__Status__c IN ('Tentative', 'Scheduled')`

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `project` | string (optional) | Partial match on project name |
| `reporting_company` | string (optional) | Partial match on `Reporting_Company__c` |
| `service_line` | string (optional) | Partial match on resource's group/service line |
| `region` | string (optional) | Partial match on resource's region |
| `country` | string (optional) | Partial match on `Resource_Country__c` |
| `role` | string (optional) | Partial match on resource's `Business_Title__c` |
| `status` | string[] (optional) | Override status filter; defaults to `['Tentative', 'Scheduled']` |
| `include_future` | boolean (optional) | If true, drop the `pse__Start_Date__c <= TODAY` condition to include upcoming assignments |

**Output per record:** resource name, business title, project, assignment dates, % allocation, billable, region, country, reporting company, Salesforce URL.

**Ordering:** by resource name ASC, then start date ASC.

---

### Tool 2: `list_bench_resources`

**Purpose:** Lists active resources with no current assignment (bench) or whose assignments end soon (rolling off). Answers "who is available?"

**Object:** `Contact` (with subquery against `pse__Assignment__c`)

**Base filter always applied:** `pse__Is_Resource__c = true AND pse__Is_Resource_Active__c = true`

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `reporting_company` | string (optional) | Partial match on `pse__Practice__r.Name` |
| `service_line` | string (optional) | Partial match on `pse__Group__r.Name` |
| `region` | string (optional) | Partial match on `pse__Region__r.Name` |
| `country` | string (optional) | Partial match on `Country__c` |
| `role` | string (optional) | Partial match on `Business_Title__c` |
| `available_within_days` | number (optional) | When omitted: fully bench (no active assignments). When provided (e.g. 30): resources whose last assignment ends within that many days |

**Query strategy — bench (no `available_within_days`):**

```sql
SELECT ... FROM Contact
WHERE pse__Is_Resource__c = true
  AND pse__Is_Resource_Active__c = true
  AND Id NOT IN (
    SELECT pse__Resource__c FROM pse__Assignment__c
    WHERE pse__End_Date__c >= TODAY
      AND pse__Status__c IN ('Tentative', 'Scheduled')
  )
  AND [org filters]
```

**Query strategy — rolling off (`available_within_days = N`):**

```sql
-- Has at least one active assignment today...
SELECT ... FROM Contact
WHERE pse__Is_Resource__c = true
  AND pse__Is_Resource_Active__c = true
  AND Id IN (
    SELECT pse__Resource__c FROM pse__Assignment__c
    WHERE pse__End_Date__c >= TODAY
      AND pse__Status__c IN ('Tentative', 'Scheduled')
  )
  -- ...but none that extends beyond the N-day window
  AND Id NOT IN (
    SELECT pse__Resource__c FROM pse__Assignment__c
    WHERE pse__End_Date__c > N_DAYS_FROM_NOW
      AND pse__Status__c IN ('Tentative', 'Scheduled')
  )
  AND [org filters]
```

The `N_DAYS_FROM_NOW` date is computed in TypeScript as `new Date(Date.now() + N * 86400000)` formatted as `YYYY-MM-DD`.

**Output per record:** name, business title, region, country, reporting company, service line. For rolling-off mode, also include the last assignment's end date (fetched as a second query).

**Ordering:** by name ASC.

## File Structure

```
src/
  tools/
    allocations.ts          ← list_allocations tool
    benchResources.ts       ← list_bench_resources tool
  server.ts                 ← register both new tools
```

## Implementation Notes

- Both tools use the existing `soqlQueryAll` for paginated results and `getInstanceUrl` for SF URLs — consistent with all other tools.
- SOQL `NOT IN (subquery)` has a 50,000 record limit on the subquery result. If the org ever hits that, the query will fail — acceptable tradeoff for now.
- The `available_within_days` rolling-off output includes a second query to fetch each resource's latest assignment end date for display purposes. This is a separate `SELECT MAX(pse__End_Date__c)` grouped by resource, issued once after the Contact query.
- No new lib files needed; both tools are self-contained following the pattern of `resourceRequests.ts`.
