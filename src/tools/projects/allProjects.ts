import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";
import { ProjectRecord, PROJECT_FIELDS, formatProject } from "../../lib/projects.js";

export function registerAllProjectsTool(server: McpServer) {
  server.tool(
    "list_all_projects",
    "Lists ALL active Salesforce projects company-wide — end date on or after today, stage not Completed or Cancelled. " +
      "All filter parameters are optional (partial match). " +
      "Returns per project: name, project ID, stage, dates, account, opportunity, service line, reporting company, region, line of business, project manager, director, approvers, contract type, financials (bookings, revenue, margin, underrun, ECR), and a Salesforce URL. " +
      "To search by project name keyword, use find_project instead. " +
      "Results are ordered alphabetically by project name.",
    {
      project_manager: z.string().optional().describe("Filter by Project Manager name (partial match)"),
      director: z.string().optional().describe("Filter by Director name (partial match)"),
      reporting_company: z.string().optional().describe("Filter by Reporting Company / Practice name (partial match)"),
      service_line: z.string().optional().describe("Filter by Service Line / Group name (partial match)"),
      account: z.string().optional().describe("Filter by Account name (partial match)"),
      line_of_business: z.string().optional().describe("Filter by Line of Business (partial match)"),
      region: z.string().optional().describe("Filter by Region name (partial match)"),
      contract_type: z.string().optional().describe("Filter by Contract Type (partial match)"),
      billable: z.boolean().optional().describe("Filter by billable status (true = billable only, false = non-billable only)"),
    },
    async ({ project_manager, director, reporting_company, service_line, account, line_of_business, region, contract_type, billable }) => {
      const conditions: string[] = [
        "pse__End_Date__c >= TODAY",
        "pse__Stage__c NOT IN ('Completed', 'Cancelled')",
      ];

      if (project_manager) conditions.push(`pse__Project_Manager__r.Name LIKE '%${project_manager}%'`);
      if (director) conditions.push(`Director__r.Name LIKE '%${director}%'`);
      if (reporting_company) conditions.push(`pse__Practice__r.Name LIKE '%${reporting_company}%'`);
      if (service_line) conditions.push(`pse__Group__r.Name LIKE '%${service_line}%'`);
      if (account) conditions.push(`pse__Account__r.Name LIKE '%${account}%'`);
      if (line_of_business) conditions.push(`Line_of_Business__c LIKE '%${line_of_business}%'`);
      if (region) conditions.push(`pse__Region__r.Name LIKE '%${region}%'`);
      if (contract_type) conditions.push(`Contract_Type__c LIKE '%${contract_type}%'`);
      if (billable !== undefined) conditions.push(`pse__Is_Billable__c = ${billable}`);

      let projects: ProjectRecord[];
      try {
        projects = await soqlQueryAll<ProjectRecord>(`
          SELECT ${PROJECT_FIELDS}
          FROM pse__Proj__c
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY Name ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying projects: ${message}` }],
          isError: true,
        };
      }

      if (projects.length === 0) {
        return {
          content: [{ type: "text", text: "No active projects found matching the given filters." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`Found ${projects.length} active project(s):\n`];

      for (const p of projects) {
        lines.push(...formatProject(p, instanceUrl));
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
