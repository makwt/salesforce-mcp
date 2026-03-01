import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl, getCurrentUser } from "../../lib/salesforce.js";

interface ResourceRequestRecord {
  Id: string;
  Name: string;
  pse__Status__c: string | null;
  FFX_Resource_Request_Type__c: string | null;
  pse__Resource_Role__c: string | null;
  pse__Request_Priority__c: string | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__SOW_Hours__c: number | null;
  pse__Percent_Allocated__c: number | null;
  pse__Requested_Bill_Rate__c: number | null;
  pse__Suggested_Bill_Rate_Number__c: number | null;
  Staffing_Risk__c: boolean;
  Utilization_Category__c: string | null;
  Reporting_Company__c: string | null;
  Line_of_Business__c: string | null;
  pse__Notes__c: string | null;
  Role_Notes__c: string | null;
  pse__Project__r: {
    Name: string;
    pse__Project_Manager__r: { Name: string } | null;
    Director__r: { Name: string } | null;
  } | null;
  pse__Opportunity__r: { Name: string } | null;
  pse__Resource__r: { Name: string } | null;
  pse__Staffer_Resource__r: { Name: string } | null;
  pse__Region__r: { Name: string } | null;
  pse__Group__r: { Name: string } | null;
}

const RR_FIELDS = `
  Id,
  Name,
  pse__Status__c,
  FFX_Resource_Request_Type__c,
  pse__Resource_Role__c,
  pse__Request_Priority__c,
  pse__Start_Date__c,
  pse__End_Date__c,
  pse__SOW_Hours__c,
  pse__Percent_Allocated__c,
  pse__Requested_Bill_Rate__c,
  pse__Suggested_Bill_Rate_Number__c,
  Staffing_Risk__c,
  Utilization_Category__c,
  Reporting_Company__c,
  Line_of_Business__c,
  pse__Notes__c,
  Role_Notes__c,
  pse__Project__r.Name,
  pse__Project__r.pse__Project_Manager__r.Name,
  pse__Project__r.Director__r.Name,
  pse__Opportunity__r.Name,
  pse__Resource__r.Name,
  pse__Staffer_Resource__r.Name,
  pse__Region__r.Name,
  pse__Group__r.Name
`.trim();

export function registerResourceRequestsTool(server: McpServer) {
  server.tool(
    "list_resource_requests",
    "Lists Salesforce PSA resource requests with optional filters. " +
      "By default returns all open requests (excludes Assigned and Cancelled) with an end date on or after today. " +
      "Use filters to narrow by status, role, project, director, reporting company, service line, region, or staffing risk. " +
      "Returns per request: role, status, priority, type, dates, hours, allocation %, bill rates, staffing risk flag, project, opportunity, PM, director, reporting company, service line, region, line of business, utilization category, suggested and staffed resource, notes, and a Salesforce URL. " +
      "Results are ordered by start date, then project name.",
    {
      status: z
        .array(
          z.enum([
            "Ready to Staff",
            "Hiring",
            "Contracting",
            "Hold",
            "Hold - Ready to Assign",
            "Assigned",
            "Cancelled",
          ])
        )
        .optional()
        .describe(
          "Filter by one or more statuses. Defaults to all open statuses (excludes Assigned and Cancelled)."
        ),
      role: z
        .string()
        .optional()
        .describe("Filter by resource role (partial match, e.g. 'Engineer', 'Product Lead')"),
      project: z
        .string()
        .optional()
        .describe("Filter by project name (partial match)"),
      director: z
        .string()
        .optional()
        .describe("Filter by director name (partial match)"),
      reporting_company: z
        .string()
        .optional()
        .describe("Filter by reporting company (partial match, e.g. 'WillowTree')"),
      service_line: z
        .string()
        .optional()
        .describe("Filter by service line / group (partial match, e.g. 'Product Delivery')"),
      region: z
        .string()
        .optional()
        .describe("Filter by region (partial match)"),
      staffing_risk: z
        .boolean()
        .optional()
        .describe("Filter by staffing risk flag (true = at-risk requests only)"),
      my_requests: z
        .boolean()
        .optional()
        .describe(
          "When true, scopes results to resource requests on projects where you are the Project Manager or Director. " +
            "Useful for PMs and Directors to see only their own open staffing needs."
        ),
    },
    async ({
      status,
      role,
      project,
      director,
      reporting_company,
      service_line,
      region,
      staffing_risk,
      my_requests,
    }) => {
      const conditions: string[] = [];

      // Status
      if (status && status.length > 0) {
        const vals = status.map((s) => `'${s}'`).join(", ");
        conditions.push(`pse__Status__c IN (${vals})`);
      } else {
        conditions.push(`pse__Status__c NOT IN ('Assigned', 'Cancelled')`);
      }

      conditions.push(`pse__End_Date__c >= TODAY`);

      // String filters
      if (role) conditions.push(`pse__Resource_Role__c LIKE '%${role}%'`);
      if (project) conditions.push(`pse__Project__r.Name LIKE '%${project}%'`);
      if (director) conditions.push(`pse__Project__r.Director__r.Name LIKE '%${director}%'`);
      if (reporting_company) conditions.push(`Reporting_Company__c LIKE '%${reporting_company}%'`);
      if (service_line) conditions.push(`pse__Group__r.Name LIKE '%${service_line}%'`);
      if (region) conditions.push(`pse__Region__r.Name LIKE '%${region}%'`);
      if (staffing_risk !== undefined) conditions.push(`Staffing_Risk__c = ${staffing_risk}`);

      if (my_requests) {
        try {
          const user = await getCurrentUser();
          conditions.push(
            `(pse__Project__r.pse__Project_Manager__c = '${user.contactId}' OR pse__Project__r.Director__c = '${user.userId}')`
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error resolving current user for my_requests: ${message}` }],
            isError: true,
          };
        }
      }

      let records: ResourceRequestRecord[];
      try {
        records = await soqlQueryAll<ResourceRequestRecord>(`
          SELECT ${RR_FIELDS}
          FROM pse__Resource_Request__c
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY pse__Start_Date__c ASC, pse__Project__r.Name ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying resource requests: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No resource requests found matching the given filters." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`Found ${records.length} resource request(s):\n`];

      for (const r of records) {
        const project = r.pse__Project__r?.Name ?? "—";
        const pm = r.pse__Project__r?.pse__Project_Manager__r?.Name ?? "—";
        const director = r.pse__Project__r?.Director__r?.Name ?? "—";
        const suggestedResource = r.pse__Resource__r?.Name ?? "—";
        const staffedResource = r.pse__Staffer_Resource__r?.Name ?? "—";
        const url = `${instanceUrl}/${r.Id}`;

        lines.push(
          `• ${r.Name} — ${r.pse__Resource_Role__c ?? "No Role"}`,
          `  Status:               ${r.pse__Status__c ?? "—"}`,
          `  Priority:             ${r.pse__Request_Priority__c ?? "—"}`,
          `  Type:                 ${r.FFX_Resource_Request_Type__c ?? "—"}`,
          `  Dates:                ${r.pse__Start_Date__c ?? "—"} → ${r.pse__End_Date__c ?? "—"}`,
          `  Hours / Allocation:   ${r.pse__SOW_Hours__c ?? "—"} hrs @ ${r.pse__Percent_Allocated__c ?? "—"}%`,
          `  Requested Bill Rate:  ${r.pse__Requested_Bill_Rate__c != null ? `USD ${r.pse__Requested_Bill_Rate__c}/hr` : "—"}`,
          `  Suggested Bill Rate:  ${r.pse__Suggested_Bill_Rate_Number__c != null ? `USD ${r.pse__Suggested_Bill_Rate_Number__c}/hr` : "—"}`,
          `  Staffing Risk:        ${r.Staffing_Risk__c ? "Yes ⚠️" : "No"}`,
          ``,
          `  — Project / Opportunity —`,
          `  Project:            ${project}`,
          `  Opportunity:        ${r.pse__Opportunity__r?.Name ?? "—"}`,
          `  Project Manager:    ${pm}`,
          `  Director:           ${director}`,
          ``,
          `  — Org —`,
          `  Reporting Company:  ${r.Reporting_Company__c ?? "—"}`,
          `  Service Line:       ${r.pse__Group__r?.Name ?? "—"}`,
          `  Region:             ${r.pse__Region__r?.Name ?? "—"}`,
          `  Line of Business:   ${r.Line_of_Business__c ?? "—"}`,
          `  Utilization:        ${r.Utilization_Category__c ?? "—"}`,
          ``,
          `  — Resource —`,
          `  Suggested Resource: ${suggestedResource}`,
          `  Staffed Resource:   ${staffedResource}`,
          ...(r.pse__Notes__c ? [`  Notes:              ${r.pse__Notes__c}`] : []),
          ...(r.Role_Notes__c ? [`  Role Notes:         ${r.Role_Notes__c}`] : []),
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
