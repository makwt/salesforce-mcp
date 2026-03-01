import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";
import {
  ProjectRecord,
  PROJECT_FIELDS,
  currency,
  percent,
  bool,
} from "../../lib/projects.js";

export function registerClientProjectHistoryTool(server: McpServer) {
  server.tool(
    "list_client_project_history",
    "Lists all projects (including completed and cancelled) linked to a specific client account. " +
      "Provides a historical view of the relationship with a client — past engagements, financials, and key people involved. " +
      "By default includes all project stages. Set active_only=true to only show active projects.",
    {
      account: z
        .string()
        .describe("Client/account name (partial match)"),
      active_only: z
        .boolean()
        .optional()
        .describe(
          "When true, only show active projects (end date >= today, stage not Completed/Cancelled). Default false."
        ),
    },
    async ({ account, active_only }) => {
      const conditions: string[] = [
        `pse__Account__r.Name LIKE '%${account}%'`,
      ];
      if (active_only) {
        conditions.push("pse__End_Date__c >= TODAY");
        conditions.push("pse__Stage__c NOT IN ('Completed', 'Cancelled')");
      }

      let records: ProjectRecord[];
      try {
        records = await soqlQueryAll<ProjectRecord>(`
          SELECT ${PROJECT_FIELDS}
          FROM pse__Proj__c
          WHERE ${conditions.join(" AND ")}
          ORDER BY pse__End_Date__c DESC NULLS LAST
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Error querying client project history: ${message}`,
            },
          ],
          isError: true,
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [
        `Client Project History — ${account} (${records.length} projects)\n`,
      ];

      for (const p of records) {
        lines.push(
          `• ${p.Name} (${p.pse__Project_ID__c ?? p.Id})`,
          `  Account: ${p.pse__Account__r?.Name ?? "—"} | Stage: ${p.pse__Stage__c ?? "—"}`,
          `  Dates: ${p.pse__Start_Date__c ?? "—"} → ${p.pse__End_Date__c ?? "—"}`,
          `  PM: ${p.pse__Project_Manager__r?.Name ?? "—"} | Director: ${p.Director__r?.Name ?? "—"}`,
          `  Bookings: ${currency(p.pse__Bookings__c)} | Est Revenue: ${currency(p.Total_Estimated_Revenue__c)} | Underrun: ${currency(p.Project_Underrun__c)}`,
          `  Margin at Completion: ${percent(p.Project_Margin_Percent_at_Completion__c)} | On Budget: ${bool(p.Is_Project_on_Budget__c)}`,
          `  URL: ${instanceUrl}/${p.Id}`,
          ``
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
