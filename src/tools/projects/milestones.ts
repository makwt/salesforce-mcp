import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";

interface MilestoneRecord {
  Id: string;
  Name: string;
  pse__Project__r: { Name: string } | null;
  pse__Milestone_Amount__c: number | null;
  pse__Status__c: string | null;
  pse__Target_Date__c: string | null;
  pse__Actual_Date__c: string | null;
  pse__Description__c: string | null;
  CurrencyIsoCode: string | null;
}

const MILESTONE_FIELDS = `
  Id,
  Name,
  pse__Project__r.Name,
  pse__Milestone_Amount__c,
  pse__Status__c,
  pse__Target_Date__c,
  pse__Actual_Date__c,
  pse__Description__c,
  CurrencyIsoCode
`.trim();

export function registerMilestonesTool(server: McpServer) {
  server.tool(
    "list_milestones",
    "Lists billing milestones for a project. Milestones represent scheduled billing events with amounts and due dates. " +
      "Filter by project name, status, or date range.",
    {
      project: z.string().describe("Project name (partial match)"),
      status: z.string().optional().describe("Filter by status (partial match)"),
      date_from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Target date from (YYYY-MM-DD)"),
      date_to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Target date to (YYYY-MM-DD)"),
    },
    async ({ project, status, date_from, date_to }) => {
      const conditions: string[] = [`pse__Project__r.Name LIKE '%${project}%'`];
      if (status) conditions.push(`pse__Status__c LIKE '%${status}%'`);
      if (date_from) conditions.push(`pse__Target_Date__c >= '${date_from}'`);
      if (date_to) conditions.push(`pse__Target_Date__c <= '${date_to}'`);

      let records: MilestoneRecord[];
      try {
        records = await soqlQueryAll<MilestoneRecord>(`
          SELECT ${MILESTONE_FIELDS}
          FROM pse__Milestone__c
          WHERE ${conditions.join(" AND ")}
          ORDER BY pse__Target_Date__c ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying milestones: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No milestones found matching the given filters." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`Found ${records.length} milestone(s):\n`];

      for (const r of records) {
        const projectName = r.pse__Project__r?.Name ?? "—";
        const amount =
          r.pse__Milestone_Amount__c != null
            ? r.pse__Milestone_Amount__c.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : "—";
        const amountLine =
          r.pse__Milestone_Amount__c != null
            ? `${r.CurrencyIsoCode ?? ""} ${amount}`.trim()
            : "—";
        const url = `${instanceUrl}/${r.Id}`;

        lines.push(
          `• ${r.Name}`,
          `  Project:     ${projectName}`,
          `  Amount:      ${amountLine}`,
          `  Status:      ${r.pse__Status__c ?? "—"}`,
          `  Target Date: ${r.pse__Target_Date__c ?? "—"}`,
          `  Actual Date: ${r.pse__Actual_Date__c ?? "—"}`,
          `  Description: ${r.pse__Description__c ?? "—"}`,
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
