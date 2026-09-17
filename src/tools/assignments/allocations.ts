import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";

interface AssignmentRecord {
  Id: string;
  Name: string;
  pse__Resource__r: {
    Name: string;
    Business_Title__c: string | null;
    Email: string | null;
    pse__Region__r: { Name: string } | null;
    pse__Practice__r: { Name: string } | null;
    pse__Group__r: { Name: string } | null;
    // Cost rate lives on the resource (Contact), not the assignment. Only
    // selected when include_financial_fields is true.
    pse__Default_Cost_Rate__c?: number | null;
  } | null;
  pse__Project__r: { Name: string } | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Status__c: string | null;
  pse__Percent_Allocated__c: number | null;
  Reporting_Company__c: string | null;
  Resource_Country__c: string | null;
  pse__Scheduled_Hours__c: number | null;
  // Financial fields — only present when include_financial_fields is true.
  pse__Is_Billable__c?: boolean;
  pse__Bill_Rate__c?: number | null;
  pse__Projected_Revenue__c?: number | null;
  pse__Time_Credited__c?: boolean;
}

// Base fields always selected.
const BASE_ASSIGNMENT_FIELDS = [
  "Id",
  "Name",
  "pse__Resource__r.Name",
  "pse__Resource__r.Business_Title__c",
  "pse__Resource__r.Email",
  "pse__Resource__r.pse__Region__r.Name",
  "pse__Resource__r.pse__Practice__r.Name",
  "pse__Resource__r.pse__Group__r.Name",
  "pse__Project__r.Name",
  "pse__Start_Date__c",
  "pse__End_Date__c",
  "pse__Status__c",
  "pse__Percent_Allocated__c",
  "Reporting_Company__c",
  "Resource_Country__c",
  "pse__Scheduled_Hours__c",
];

// Financial fields — appended only when include_financial_fields is true, so a
// single missing financial column can't break the whole query. Cost rate is
// read from the resource (Contact) via pse__Resource__r.pse__Default_Cost_Rate__c;
// pse__Cost_Rate__c does not exist on pse__Assignment__c.
const FINANCIAL_ASSIGNMENT_FIELDS = [
  "pse__Is_Billable__c",
  "pse__Time_Credited__c",
  "pse__Bill_Rate__c",
  "pse__Resource__r.pse__Default_Cost_Rate__c",
  "pse__Projected_Revenue__c",
];

function escapeLike(value: string): string {
  return value.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function registerAllocationsTool(server: McpServer) {
  server.tool(
    "list_allocations",
    "Lists active Salesforce PSA assignments (allocations) — who is currently assigned to which project. " +
      "By default returns assignments active today (started on or before today, ending on or after today) with status Tentative or Scheduled, " +
      "scoped to WillowTree family companies (WillowTree, Poatek, GM2). " +
      "Use reporting_companies to filter by one or more specific companies (partial match each), or set all_companies=true to remove the scope restriction and return everyone across all companies. " +
      "Use resource_names to look up one or more people's allocations (partial match each). " +
      "Use email to filter by the resource's email — accepts a domain (e.g. 'telusdigital.com') or a full address (e.g. 'lucas.medeiros@telusdigital.com'). " +
      "Use other filters to narrow by project, service line, region, country, title, or resource_role. " +
      "Set include_future=true to also include upcoming assignments that haven't started yet. " +
      "Returns per allocation: resource name, email, and title, project, start/end dates, allocation %, scheduled hours, status, reporting company, region, country, and a Salesforce URL. " +
      "Financial fields (billable flag, time-credited flag, bill rate, cost rate, projected revenue) are excluded by default — set include_financial_fields=true to include them. " +
      "Results are ordered by resource name, then start date.",
    {
      resource_names: z
        .array(z.string())
        .optional()
        .describe("Filter by one or more resource (person) names (partial match each, e.g. ['Victoria Jardim', 'Lucas']). Use this to look up specific people's current allocations."),
      project: z
        .string()
        .optional()
        .describe("Filter by project name (partial match)"),
      reporting_companies: z
        .array(z.string())
        .optional()
        .describe("Filter by one or more reporting companies (partial match each, e.g. ['WillowTree', 'TELUS']). Overrides the default WillowTree/GM2 scope."),
      all_companies: z
        .boolean()
        .optional()
        .describe("When true, removes the default company scope and returns allocations across all companies. Overrides reporting_companies."),
      service_line: z
        .string()
        .optional()
        .describe("Filter by resource's service line / group (partial match, e.g. 'Product Delivery')"),
      region: z
        .string()
        .optional()
        .describe("Filter by resource's region (partial match)"),
      country: z
        .string()
        .optional()
        .describe("Filter by resource's country (partial match, e.g. 'Brazil')"),
      title: z
        .string()
        .optional()
        .describe("Filter by resource's job title / Business_Title__c (partial match, e.g. 'Senior Director'). Use resource_role for discipline-specific roles."),
      resource_role: z
        .string()
        .optional()
        .describe("Filter by resource's PSA resource role (partial match, e.g. 'Android Engineer', 'iOS Engineer', 'Backend Engineer'). This is the primary field for discipline-specific roles."),
      status: z
        .array(z.enum(["Tentative", "Scheduled", "Closed"]))
        .optional()
        .describe("Filter by assignment status. Defaults to ['Tentative', 'Scheduled']."),
      include_future: z
        .boolean()
        .optional()
        .describe(
          "When true, includes assignments that haven't started yet (removes the start date <= today filter). Default false."
        ),
      email: z
        .string()
        .optional()
        .describe("Filter by the resource's email (partial match, e.g. 'telusdigital.com' for a domain or 'lucas.medeiros@telusdigital.com' for a specific address)."),
      include_financial_fields: z
        .boolean()
        .optional()
        .describe("When true, includes financial fields in the output: billable flag, time-credited flag, bill rate, cost rate, and projected revenue. Default false."),
    },
    async ({ resource_names, project, reporting_companies, all_companies, service_line, region, country, title, resource_role, status, include_future, email, include_financial_fields }) => {
      const activeStatuses = status && status.length > 0 ? status : ["Tentative", "Scheduled"];
      const statusList = activeStatuses.map((s) => `'${s}'`).join(", ");

      const conditions: string[] = [
        `pse__Status__c IN (${statusList})`,
        `pse__End_Date__c >= TODAY`,
        `Is_Resource_Active__c = true`,
        `pse__Exclude_From_Utilization__c = false`,
      ];

      if (!include_future) {
        conditions.push(`pse__Start_Date__c <= TODAY`);
      }

      if (resource_names && resource_names.length > 0) {
        const clauses = resource_names.map((n) => {
          const words = n.trim().split(/\s+/);
          if (words.length === 1) return `pse__Resource__r.Name LIKE '%${escapeLike(n)}%'`;
          return words.map((w) => `pse__Resource__r.Name LIKE '%${escapeLike(w)}%'`).join(" AND ");
        });
        const combined = clauses.map((c) => (clauses.length > 1 ? `(${c})` : c)).join(" OR ");
        conditions.push(resource_names.length === 1 ? combined : `(${combined})`);
      }
      if (project) conditions.push(`pse__Project__r.Name LIKE '%${escapeLike(project)}%'`);

      if (!all_companies) {
        if (reporting_companies && reporting_companies.length > 0) {
          const clauses = reporting_companies.map((c) => `Reporting_Company__c LIKE '%${escapeLike(c)}%'`).join(" OR ");
          conditions.push(`(${clauses})`);
        } else {
          conditions.push(`Reporting_Company__c IN ('WillowTree', 'Poatek', 'GM2')`);
        }
      }

      if (service_line) conditions.push(`pse__Resource__r.pse__Group__r.Name LIKE '%${escapeLike(service_line)}%'`);
      if (region) conditions.push(`pse__Resource__r.pse__Region__r.Name LIKE '%${escapeLike(region)}%'`);
      if (country) conditions.push(`Resource_Country__c LIKE '%${escapeLike(country)}%'`);
      if (title) conditions.push(`pse__Resource__r.Business_Title__c LIKE '%${escapeLike(title)}%'`);
      if (resource_role) conditions.push(`pse__Resource__r.pse__Resource_Role__c LIKE '%${escapeLike(resource_role)}%'`);
      if (email) conditions.push(`pse__Resource__r.Email LIKE '%${escapeLike(email)}%'`);

      const selectedFields = (
        include_financial_fields
          ? [...BASE_ASSIGNMENT_FIELDS, ...FINANCIAL_ASSIGNMENT_FIELDS]
          : BASE_ASSIGNMENT_FIELDS
      ).join(",\n          ");

      let records: AssignmentRecord[];
      try {
        records = await soqlQueryAll<AssignmentRecord>(`
          SELECT ${selectedFields}
          FROM pse__Assignment__c
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY pse__Resource__r.Name ASC, pse__Start_Date__c ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying allocations: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No allocations found matching the given filters." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`Found ${records.length} allocation(s):\n`];

      for (const r of records) {
        const resourceName = r.pse__Resource__r?.Name ?? "—";
        const title = r.pse__Resource__r?.Business_Title__c ?? "—";
        const projectName = r.pse__Project__r?.Name ?? "—";
        const regionName = r.pse__Resource__r?.pse__Region__r?.Name ?? "—";
        const practice = r.pse__Resource__r?.pse__Practice__r?.Name ?? "—";
        const countryVal = r.Resource_Country__c ?? "—";
        const url = `${instanceUrl}/${r.Id}`;

        const fmt = (n: number | null | undefined, prefix = "") =>
          n != null ? `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

        const serviceLine = r.pse__Resource__r?.pse__Group__r?.Name ?? "—";

        const email = r.pse__Resource__r?.Email ?? "—";

        lines.push(
          `• ${resourceName} — ${title}`,
          `  Email:              ${email}`,
          `  Service Line:       ${serviceLine}`,
          `  Project:            ${projectName}`,
          `  Dates:              ${r.pse__Start_Date__c ?? "—"} → ${r.pse__End_Date__c ?? "—"}`,
          `  Allocation:         ${r.pse__Percent_Allocated__c != null ? `${r.pse__Percent_Allocated__c}%` : "—"}`,
          `  Scheduled Hours:    ${fmt(r.pse__Scheduled_Hours__c)}`,
          ...(include_financial_fields ? [
            `  Billable:           ${r.pse__Is_Billable__c ? "Yes" : "No"}`,
            `  Time Credited:      ${r.pse__Time_Credited__c ? "Yes" : "No"}`,
            `  Bill Rate:          ${fmt(r.pse__Bill_Rate__c, "$")}`,
            `  Cost Rate:          ${fmt(r.pse__Resource__r?.pse__Default_Cost_Rate__c, "$")}`,
            `  Projected Revenue:  ${fmt(r.pse__Projected_Revenue__c, "$")}`,
          ] : []),
          `  Status:             ${r.pse__Status__c ?? "—"}`,
          `  Reporting Company:  ${r.Reporting_Company__c ?? practice}`,
          `  Region:             ${regionName}`,
          `  Country:            ${countryVal}`,
          `  URL: ${url}`,
          ``
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
