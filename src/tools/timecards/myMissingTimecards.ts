import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runReport, collectGroupedRows } from "../../lib/reports.js";

const REPORT_ID = "00OTS000003P10n2AC";

// Groupings: Director > Project Manager > Project Name
const GROUPING_LABELS = ["Director", "Project Manager", "Project"];

export function registerMissingTimecardsTools(server: McpServer) {
  server.tool(
    "list_my_missing_timecards",
    "Lists assignments with missing timecards on YOUR projects for this month — scoped to projects where you are the Project Manager, Director, Revenue Accountant, or have full visibility. " +
      "An entry appears when a resource has estimated hours but has not submitted a timecard and the variance has not been accepted. " +
      "Grouped by Director > Project Manager > Project. " +
      "Returns per entry: resource name, assignment, dates, estimated hours, billable flag, utilization category, estimated revenue, variance accepted status, and comments. " +
      "For an org-wide view across all projects regardless of your role, use list_all_missing_timecards instead.",
    {},
    async () => {
      let result;
      try {
        result = await runReport(REPORT_ID);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error running report: ${message}` }],
          isError: true,
        };
      }

      const rows = collectGroupedRows(result, GROUPING_LABELS);

      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No missing timecards found on your projects for this month.",
            },
          ],
        };
      }

      const lines: string[] = [
        `Found ${rows.length} missing timecard(s) on your projects this month:\n`,
      ];

      let lastProject = "";
      let lastPM = "";

      for (const row of rows) {
        const [director, pm, project] = row.groups;
        const c = row.cells;

        if (pm !== lastPM || project !== lastProject) {
          lines.push(`\n── ${project}`);
          lines.push(`   Director: ${director} | PM: ${pm}`);
          lines.push(
            `   Service Line: ${c["Project: Service Line"] ?? "—"} | Secondary Approver: ${c["Project: Secondary Approver"] ?? "—"}`
          );
          lastPM = pm;
          lastProject = project;
        }

        lines.push(
          `   • Resource: ${c["Resource"] ?? "—"} | Assignment: ${c["Assignment"] ?? "—"}`,
          `     Dates: ${c["Start Date"] ?? "—"} → ${c["End Date"] ?? "—"} | Est. Hours: ${c["Estimated Hours"] ?? "—"} | Billable: ${c["Billable"] ?? "—"}`,
          `     Utilization: ${c["Utilization Category"] ?? "—"} | Est. Revenue: ${c["Estimated Timecard Revenue"] ?? "—"}`,
          `     Variance Accepted: ${c["Variance Accepted"] ?? "—"} | Comments: ${c["Variance Comments"] ?? "—"}`
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
