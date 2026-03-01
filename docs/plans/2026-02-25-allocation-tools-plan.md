# Allocation Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two MCP tools — `list_allocations` and `list_bench_resources` — to query PSA assignment data from Salesforce.

**Architecture:** Two self-contained tool files following the existing pattern (see `src/tools/resourceRequests.ts`). Both use `soqlQueryAll` and `getInstanceUrl` from `src/lib/salesforce.ts`. Both registered in `src/server.ts`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, Salesforce PSA SOQL

---

### Task 1: Create src/tools/allocations.ts

**Files:**
- Create: `src/tools/allocations.ts`

Implement `registerAllocationsTool(server: McpServer)` that registers the `list_allocations` tool.

**SOQL object:** `pse__Assignment__c`

**Fields to select:**
```
Id, Name,
pse__Resource__r.Name,
pse__Resource__r.Business_Title__c,
pse__Resource__r.pse__Region__r.Name,
pse__Resource__r.pse__Practice__r.Name,
pse__Project__r.Name,
pse__Start_Date__c,
pse__End_Date__c,
pse__Status__c,
pse__Percent_Allocated__c,
pse__Is_Billable__c,
Reporting_Company__c,
Resource_Country__c
```

**Default WHERE clause:**
```sql
pse__Start_Date__c <= TODAY
AND pse__End_Date__c >= TODAY
AND pse__Status__c IN ('Tentative', 'Scheduled')
```

**Parameters (all optional):**
- `project`: string → `pse__Project__r.Name LIKE '%X%'`
- `reporting_company`: string → `Reporting_Company__c LIKE '%X%'`
- `service_line`: string → `pse__Resource__r.pse__Group__r.Name LIKE '%X%'` (also add `pse__Resource__r.pse__Group__r.Name` to SELECT)
- `region`: string → `pse__Resource__r.pse__Region__r.Name LIKE '%X%'`
- `country`: string → `Resource_Country__c LIKE '%X%'`
- `role`: string → `pse__Resource__r.Business_Title__c LIKE '%X%'`
- `status`: `z.array(z.enum(['Tentative','Scheduled','Closed']))` → overrides default status IN clause
- `include_future`: boolean → when true, drop `pse__Start_Date__c <= TODAY` condition

**Output per record (one bullet block):**
```
• <ResourceName> — <BusinessTitle>
  Project:            <ProjectName>
  Dates:              <Start> → <End>
  Allocation:         <Percent>%
  Billable:           Yes/No
  Reporting Company:  <ReportingCompany>
  Region:             <Region>
  Country:            <Country>
  URL: <instanceUrl>/<Id>
```

**Order:** `pse__Resource__r.Name ASC, pse__Start_Date__c ASC`

---

### Task 2: Create src/tools/benchResources.ts

**Files:**
- Create: `src/tools/benchResources.ts`

Implement `registerBenchResourcesTool(server: McpServer)` that registers the `list_bench_resources` tool.

**SOQL object:** `Contact`

**Fields to select:**
```
Id, Name,
Business_Title__c,
pse__Region__r.Name,
pse__Practice__r.Name,
Country__c,
pse__Group__r.Name
```

**Base WHERE always applied:**
```sql
pse__Is_Resource__c = true
AND pse__Is_Resource_Active__c = true
```

**Parameters (all optional):**
- `reporting_company`: string → `pse__Practice__r.Name LIKE '%X%'`
- `service_line`: string → `pse__Group__r.Name LIKE '%X%'`
- `region`: string → `pse__Region__r.Name LIKE '%X%'`
- `country`: string → `Country__c LIKE '%X%'`
- `role`: string → `Business_Title__c LIKE '%X%'`
- `available_within_days`: number → switches mode (see below)

**Mode: bench (no `available_within_days`):**
```sql
AND Id NOT IN (
  SELECT pse__Resource__c FROM pse__Assignment__c
  WHERE pse__End_Date__c >= TODAY
    AND pse__Status__c IN ('Tentative', 'Scheduled')
)
```

**Mode: rolling off (`available_within_days = N`):**
Compute cutoff date in TS: `new Date(Date.now() + N * 86_400_000).toISOString().slice(0, 10)`
```sql
AND Id IN (
  SELECT pse__Resource__c FROM pse__Assignment__c
  WHERE pse__End_Date__c >= TODAY
    AND pse__Status__c IN ('Tentative', 'Scheduled')
)
AND Id NOT IN (
  SELECT pse__Resource__c FROM pse__Assignment__c
  WHERE pse__End_Date__c > '<cutoffDate>'
    AND pse__Status__c IN ('Tentative', 'Scheduled')
)
```

**Output per record:**
```
• <Name> — <BusinessTitle>
  Reporting Company:  <Practice>
  Service Line:       <Group>
  Region:             <Region>
  Country:            <Country>
  URL: <instanceUrl>/<Id>
```

For rolling-off mode, add a header note: `"People rolling off within <N> days"`
For bench mode, add a header note: `"People currently on the bench (no active assignment)"`

**Order:** `Name ASC`

---

### Task 3: Register tools in src/server.ts

**Files:**
- Modify: `src/server.ts`

Add two imports and two registration calls following the existing pattern:
```typescript
import { registerAllocationsTool } from "./tools/allocations.js";
import { registerBenchResourcesTool } from "./tools/benchResources.js";
// ...
registerAllocationsTool(server);
registerBenchResourcesTool(server);
```

---

### Task 4: Build

Run `npm run build` and fix any TypeScript errors.

Expected: zero errors, new `.js` files appear in `dist/tools/`.
