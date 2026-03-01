import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll } from "../../lib/salesforce.js";
import {
  ProjectRecord,
  PROJECT_FIELDS,
  currency,
  percent,
  bool,
} from "../../lib/projects.js";

export function registerPortfolioSummaryTool(server: McpServer) {
  server.tool(
    "get_portfolio_summary",
    "Aggregates financial metrics across a set of active projects. " +
      "Provides totals for bookings, estimated revenue, underrun, and margin, plus a per-project breakdown. " +
      "Filter by director, project manager, account, service line, reporting company, region, or line of business. " +
      "Only includes active projects (end date >= today, stage not Completed/Cancelled).",
    {
      director: z
        .string()
        .optional()
        .describe("Filter by director name (partial match)"),
      pm: z
        .string()
        .optional()
        .describe("Filter by project manager name (partial match)"),
      account: z
        .string()
        .optional()
        .describe("Filter by account name (partial match)"),
      service_line: z
        .string()
        .optional()
        .describe("Filter by service line / group (partial match)"),
      reporting_company: z
        .string()
        .optional()
        .describe("Filter by reporting company / practice (partial match)"),
      region: z
        .string()
        .optional()
        .describe("Filter by region (partial match)"),
      line_of_business: z
        .string()
        .optional()
        .describe("Filter by line of business (partial match)"),
      billable_only: z
        .boolean()
        .optional()
        .describe("When true, only include billable projects"),
    },
    async ({
      director,
      pm,
      account,
      service_line,
      reporting_company,
      region,
      line_of_business,
      billable_only,
    }) => {
      const conditions: string[] = [
        "pse__End_Date__c >= TODAY",
        "pse__Stage__c NOT IN ('Completed', 'Cancelled')",
      ];

      if (director) conditions.push(`Director__r.Name LIKE '%${director}%'`);
      if (pm) conditions.push(`pse__Project_Manager__r.Name LIKE '%${pm}%'`);
      if (account) conditions.push(`pse__Account__r.Name LIKE '%${account}%'`);
      if (service_line) conditions.push(`pse__Group__r.Name LIKE '%${service_line}%'`);
      if (reporting_company)
        conditions.push(`pse__Practice__r.Name LIKE '%${reporting_company}%'`);
      if (region) conditions.push(`pse__Region__r.Name LIKE '%${region}%'`);
      if (line_of_business)
        conditions.push(`Line_of_Business__c LIKE '%${line_of_business}%'`);
      if (billable_only === true) conditions.push("pse__Is_Billable__c = true");

      let records: ProjectRecord[];
      try {
        records = await soqlQueryAll<ProjectRecord>(`
          SELECT ${PROJECT_FIELDS}
          FROM pse__Proj__c
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY Name ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying portfolio: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No active projects found matching the given filters.",
            },
          ],
        };
      }

      const totalBookings = records.reduce(
        (sum, p) => sum + (p.pse__Bookings__c ?? 0),
        0
      );
      const totalRevenue = records.reduce(
        (sum, p) => sum + (p.Total_Estimated_Revenue__c ?? 0),
        0
      );
      const totalUnderrun = records.reduce(
        (sum, p) => sum + (p.Project_Underrun__c ?? 0),
        0
      );

      const marginToDateValues = records
        .map((p) => p.Project_Margin_to_Date_Percent__c)
        .filter((v): v is number => v != null);
      const avgMarginToDate =
        marginToDateValues.length > 0
          ? marginToDateValues.reduce((a, b) => a + b, 0) / marginToDateValues.length
          : null;

      const marginAtCompletionValues = records
        .map((p) => p.Project_Margin_Percent_at_Completion__c)
        .filter((v): v is number => v != null);
      const avgMarginAtCompletion =
        marginAtCompletionValues.length > 0
          ? marginAtCompletionValues.reduce((a, b) => a + b, 0) /
            marginAtCompletionValues.length
          : null;

      const onBudget = records.filter((p) => p.Is_Project_on_Budget__c === true).length;
      const offBudget = records.filter((p) => p.Is_Project_on_Budget__c === false).length;

      const lines: string[] = [
        `Portfolio Summary — ${records.length} active projects`,
        ``,
        `── Aggregated Financials ──`,
        `  Total Bookings:                  ${currency(totalBookings)}`,
        `  Total Estimated Revenue:         ${currency(totalRevenue)}`,
        `  Total Underrun:                  ${currency(totalUnderrun)}`,
        `  Avg Margin to Date:              ${percent(avgMarginToDate)}`,
        `  Avg Margin at Completion:        ${percent(avgMarginAtCompletion)}`,
        `  Projects On Budget:              ${onBudget} of ${records.length}`,
        ``,
        `── Per-Project Breakdown ──`,
      ];

      for (const p of records) {
        const accountName = p.pse__Account__r?.Name ?? "—";
        const pmName = p.pse__Project_Manager__r?.Name ?? "—";
        const directorName = p.Director__r?.Name ?? "—";

        lines.push(
          ``,
          `  • ${p.Name} (${p.pse__Project_ID__c ?? "—"})`,
          `    Account: ${accountName} | PM: ${pmName} | Director: ${directorName}`,
          `    Bookings: ${currency(p.pse__Bookings__c)} | Est Revenue: ${currency(p.Total_Estimated_Revenue__c)} | Underrun: ${currency(p.Project_Underrun__c)}`,
          `    Margin to Date: ${percent(p.Project_Margin_to_Date_Percent__c)} | Margin at Completion: ${percent(p.Project_Margin_Percent_at_Completion__c)} | On Budget: ${bool(p.Is_Project_on_Budget__c)}`
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
