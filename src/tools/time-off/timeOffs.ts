import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";

interface TimeOffRecord {
  Id: string;
  Name: string;
  pse__Resource__r: {
    Name: string;
    Business_Title__c: string | null;
    pse__Resource_Role__c: string | null;
    pse__Region__r: { Name: string } | null;
    pse__Practice__r: { Name: string } | null;
    pse__Group__r: { Name: string } | null;
  } | null;
  pse__Project__r: { Name: string } | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Status__c: string | null;
  pse__Scheduled_Hours__c: number | null;
  pse__Percent_Allocated__c: number | null;
  Reporting_Company__c: string | null;
  Resource_Country__c: string | null;
}

const TIME_OFF_FIELDS = `
  Id,
  Name,
  pse__Resource__r.Name,
  pse__Resource__r.Business_Title__c,
  pse__Resource__r.pse__Resource_Role__c,
  pse__Resource__r.pse__Region__r.Name,
  pse__Resource__r.pse__Practice__r.Name,
  pse__Resource__r.pse__Group__r.Name,
  pse__Project__r.Name,
  pse__Start_Date__c,
  pse__End_Date__c,
  pse__Status__c,
  pse__Scheduled_Hours__c,
  pse__Percent_Allocated__c,
  Reporting_Company__c,
  Resource_Country__c
`.trim();

export function registerTimeOffsTool(server: McpServer) {
  server.tool(
    "get_time_offs",
    "Lists upcoming time-off (PTO) assignments — assignments on internal projects whose name contains 'Time Off' (e.g. 'TELUS Digital - Time Off', 'Transactel - Time Off'). " +
      "By default returns time-offs ending on or after today with status Tentative or Scheduled. " +
      "Use resource_name to look up a specific person's time-offs. " +
      "Use account to find time-offs for all resources currently allocated to a given client/account (e.g. 'Solidcore'). " +
      "Use project to filter by the specific time-off project name (partial match). " +
      "Use resource_role to filter by discipline/role (e.g. 'Android Engineer'). " +
      "Use start_date_from / start_date_to or end_date_from / end_date_to to scope by date range. " +
      "Use include_past=true to also include time-offs that have already ended. " +
      "Returns per record: resource name, title, role, time-off project, dates, status, scheduled hours, allocation %, reporting company, region, country, and a Salesforce URL. " +
      "Results are ordered by start date, then resource name.",
    {
      resource_name: z
        .string()
        .optional()
        .describe("Filter by resource (person) name (partial match, e.g. 'Victoria' or 'Victoria Jardim')."),
      account: z
        .string()
        .optional()
        .describe("Filter to only show time-offs for resources currently allocated to this client/account (partial match, e.g. 'Solidcore'). Useful for knowing who on a client team has upcoming PTO."),
      project: z
        .string()
        .optional()
        .describe("Filter by time-off project name (partial match, e.g. 'WillowTree PTO')."),
      resource_role: z
        .string()
        .optional()
        .describe("Filter by resource's PSA resource role (partial match, e.g. 'Android Engineer', 'Backend Engineer')."),
      title: z
        .string()
        .optional()
        .describe("Filter by resource's job title (partial match, e.g. 'Senior Director')."),
      region: z
        .string()
        .optional()
        .describe("Filter by resource's region (partial match)."),
      country: z
        .string()
        .optional()
        .describe("Filter by resource's country (partial match, e.g. 'Brazil')."),
      service_line: z
        .string()
        .optional()
        .describe("Filter by resource's service line / group (partial match, e.g. 'Product Delivery')."),
      status: z
        .array(z.enum(["Tentative", "Scheduled", "Closed"]))
        .optional()
        .describe("Filter by assignment status. Defaults to ['Tentative', 'Scheduled']."),
      start_date_from: z
        .string()
        .optional()
        .describe("Filter records whose start date is on or after this date (YYYY-MM-DD)."),
      start_date_to: z
        .string()
        .optional()
        .describe("Filter records whose start date is on or before this date (YYYY-MM-DD)."),
      end_date_from: z
        .string()
        .optional()
        .describe("Filter records whose end date is on or after this date (YYYY-MM-DD)."),
      end_date_to: z
        .string()
        .optional()
        .describe("Filter records whose end date is on or before this date (YYYY-MM-DD)."),
      include_past: z
        .boolean()
        .optional()
        .describe("When true, includes time-offs that have already ended. Default false."),
    },
    async ({
      resource_name,
      account,
      project,
      resource_role,
      title,
      region,
      country,
      service_line,
      status,
      start_date_from,
      start_date_to,
      end_date_from,
      end_date_to,
      include_past,
    }) => {
      const activeStatuses = status && status.length > 0 ? status : ["Tentative", "Scheduled"];
      const statusList = activeStatuses.map((s) => `'${s}'`).join(", ");

      const conditions: string[] = [
        `pse__Project__r.Name LIKE '%Time Off%'`,
        `pse__Status__c IN (${statusList})`,
      ];

      if (!include_past) {
        conditions.push(`pse__End_Date__c >= TODAY`);
      }

      if (resource_name) conditions.push(`pse__Resource__r.Name LIKE '%${resource_name}%'`);
      if (project) conditions.push(`pse__Project__r.Name LIKE '%${project}%'`);
      if (resource_role) conditions.push(`pse__Resource__r.pse__Resource_Role__c LIKE '%${resource_role}%'`);
      if (title) conditions.push(`pse__Resource__r.Business_Title__c LIKE '%${title}%'`);
      if (region) conditions.push(`pse__Resource__r.pse__Region__r.Name LIKE '%${region}%'`);
      if (country) conditions.push(`Resource_Country__c LIKE '%${country}%'`);
      if (service_line) conditions.push(`pse__Resource__r.pse__Group__r.Name LIKE '%${service_line}%'`);
      if (start_date_from) conditions.push(`pse__Start_Date__c >= ${start_date_from}`);
      if (start_date_to) conditions.push(`pse__Start_Date__c <= ${start_date_to}`);
      if (end_date_from) conditions.push(`pse__End_Date__c >= ${end_date_from}`);
      if (end_date_to) conditions.push(`pse__End_Date__c <= ${end_date_to}`);

      // account filter: cross-object LIKE on a nested relationship isn't supported in SOQL subqueries,
      // so we resolve the resource IDs in a separate query first.
      if (account) {
        let resourceIds: string[];
        try {
          const allocations = await soqlQueryAll<{ pse__Resource__c: string }>(`
            SELECT pse__Resource__c
            FROM pse__Assignment__c
            WHERE pse__Project__r.pse__Account__r.Name LIKE '%${account}%'
              AND pse__Status__c IN ('Tentative', 'Scheduled')
              AND pse__End_Date__c >= TODAY
              AND pse__Exclude_From_Utilization__c = false
          `);
          resourceIds = [...new Set(allocations.map((a) => a.pse__Resource__c))];
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error resolving resources for account "${account}": ${message}` }],
            isError: true,
          };
        }

        if (resourceIds.length === 0) {
          return {
            content: [{ type: "text", text: `No active allocations found for account matching "${account}".` }],
          };
        }

        const idList = resourceIds.map((id) => `'${id}'`).join(", ");
        conditions.push(`pse__Resource__c IN (${idList})`);
      }

      let records: TimeOffRecord[];
      try {
        records = await soqlQueryAll<TimeOffRecord>(`
          SELECT ${TIME_OFF_FIELDS}
          FROM pse__Assignment__c
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY pse__Start_Date__c ASC, pse__Resource__r.Name ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying time-offs: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No time-off records found matching the given filters." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`Found ${records.length} time-off record(s):\n`];

      for (const r of records) {
        const resourceName = r.pse__Resource__r?.Name ?? "—";
        const resourceTitle = r.pse__Resource__r?.Business_Title__c ?? "—";
        const role = r.pse__Resource__r?.pse__Resource_Role__c ?? "—";
        const regionName = r.pse__Resource__r?.pse__Region__r?.Name ?? "—";
        const serviceLine = r.pse__Resource__r?.pse__Group__r?.Name ?? "—";
        const practice = r.pse__Resource__r?.pse__Practice__r?.Name ?? "—";
        const projectName = r.pse__Project__r?.Name ?? "—";
        const countryVal = r.Resource_Country__c ?? "—";
        const url = `${instanceUrl}/${r.Id}`;

        lines.push(
          `• ${resourceName} — ${resourceTitle}`,
          `  Role:               ${role}`,
          `  Service Line:       ${serviceLine}`,
          `  Time-Off Project:   ${projectName}`,
          `  Dates:              ${r.pse__Start_Date__c ?? "—"} → ${r.pse__End_Date__c ?? "—"}`,
          `  Status:             ${r.pse__Status__c ?? "—"}`,
          `  Scheduled Hours:    ${r.pse__Scheduled_Hours__c != null ? r.pse__Scheduled_Hours__c : "—"}`,
          `  Allocation:         ${r.pse__Percent_Allocated__c != null ? `${r.pse__Percent_Allocated__c}%` : "—"}`,
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
