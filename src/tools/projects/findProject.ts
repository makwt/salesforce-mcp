import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";

interface ProjectSummaryRecord {
  Id: string;
  Name: string;
  pse__Project_ID__c: string | null;
  pse__Stage__c: string | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Account__r: { Name: string } | null;
  pse__Project_Manager__r: { Name: string } | null;
  Director__r: { Name: string } | null;
  pse__Group__r: { Name: string } | null;
  pse__Practice__r: { Name: string } | null;
  pse__Is_Billable__c: boolean;
  pse__Bookings__c: number | null;
  Total_Estimated_Revenue__c: number | null;
  Project_Underrun__c: number | null;
}

const currency = (v: number | null) =>
  v != null
    ? `USD ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

const FIELDS = `
  Id,
  Name,
  pse__Project_ID__c,
  pse__Stage__c,
  pse__Start_Date__c,
  pse__End_Date__c,
  pse__Account__r.Name,
  pse__Project_Manager__r.Name,
  Director__r.Name,
  pse__Group__r.Name,
  pse__Practice__r.Name,
  pse__Is_Billable__c,
  pse__Bookings__c,
  Total_Estimated_Revenue__c,
  Project_Underrun__c
`.trim();

export function registerFindProjectTool(server: McpServer) {
  server.tool(
    "find_project",
    "Searches for Salesforce projects by name (partial match). " +
      "Active projects (end date on or after today, stage not Completed or Cancelled) are always returned first, followed by inactive/historical ones. " +
      "Use this to look up the exact project name before calling other tools that require it " +
      "(e.g. get_est_vs_actuals, get_variance_breakdown, list_milestones, list_billing_events, get_revenue_forecast). " +
      "Returns: project name, ID, stage, dates, account, project manager, director, service line, reporting company, and a Salesforce URL. " +
      "Use include_inactive=true to also search completed and cancelled projects.",
    {
      name: z.string().describe("Project name to search for (partial match, case-insensitive)"),
      include_inactive: z
        .boolean()
        .optional()
        .describe("Include completed and cancelled projects in results (default: false — active only)"),
    },
    async ({ name, include_inactive = false }) => {
      const baseCondition = `Name LIKE '%${name}%'`;

      const activeConditions = [
        baseCondition,
        "pse__End_Date__c >= TODAY",
        "pse__Stage__c NOT IN ('Completed', 'Cancelled')",
      ];

      let activeProjects: ProjectSummaryRecord[];
      try {
        activeProjects = await soqlQueryAll<ProjectSummaryRecord>(`
          SELECT ${FIELDS}
          FROM pse__Proj__c
          WHERE ${activeConditions.join(" AND ")}
          ORDER BY Name ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error searching projects: ${message}` }],
          isError: true,
        };
      }

      let inactiveProjects: ProjectSummaryRecord[] = [];
      if (include_inactive) {
        try {
          const activeIds = activeProjects.map((p) => `'${p.Id}'`).join(", ");
          const inactiveConditions = [
            baseCondition,
            ...(activeIds.length > 0 ? [`Id NOT IN (${activeIds})`] : []),
          ];
          inactiveProjects = await soqlQueryAll<ProjectSummaryRecord>(`
            SELECT ${FIELDS}
            FROM pse__Proj__c
            WHERE ${inactiveConditions.join(" AND ")}
            ORDER BY pse__End_Date__c DESC, Name ASC
          `);
        } catch {
          // Non-fatal — show active results even if inactive query fails
        }
      }

      const total = activeProjects.length + inactiveProjects.length;
      if (total === 0) {
        return {
          content: [{ type: "text", text: `No projects found matching "${name}".` }],
        };
      }

      const instanceUrl = await getInstanceUrl();

      function formatRow(p: ProjectSummaryRecord, label?: string): string[] {
        const url = `${instanceUrl}/${p.Id}`;
        return [
          `• ${p.Name}${label ? ` [${label}]` : ""} (${p.pse__Project_ID__c ?? "—"})`,
          `  Stage:    ${p.pse__Stage__c ?? "—"}  |  Dates: ${p.pse__Start_Date__c ?? "—"} → ${p.pse__End_Date__c ?? "—"}`,
          `  Account:  ${p.pse__Account__r?.Name ?? "—"}`,
          `  PM:       ${p.pse__Project_Manager__r?.Name ?? "—"}  |  Director: ${p.Director__r?.Name ?? "—"}`,
          `  Service Line: ${p.pse__Group__r?.Name ?? "—"}  |  Company: ${p.pse__Practice__r?.Name ?? "—"}`,
          `  Billable: ${p.pse__Is_Billable__c ? "Yes" : "No"}`,
          `  Bookings: ${currency(p.pse__Bookings__c)}  |  Est Revenue: ${currency(p.Total_Estimated_Revenue__c)}  |  Underrun: ${currency(p.Project_Underrun__c)}`,
          `  URL: ${url}`,
          ``,
        ];
      }

      const lines: string[] = [`Found ${total} project(s) matching "${name}":\n`];

      if (activeProjects.length > 0) {
        lines.push(`── Active (${activeProjects.length}) ──\n`);
        for (const p of activeProjects) lines.push(...formatRow(p));
      }

      if (inactiveProjects.length > 0) {
        lines.push(`── Inactive / Historical (${inactiveProjects.length}) ──\n`);
        for (const p of inactiveProjects) lines.push(...formatRow(p, p.pse__Stage__c ?? "Inactive"));
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
