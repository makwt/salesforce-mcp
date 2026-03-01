import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runReport, collectGroupedRows } from "../../lib/reports.js";

const REPORT_ID = "00OTS000003P1VR2A0";

// Groupings: Director > Actual Approver > Project
const GROUPING_LABELS = ["Director", "Actual Approver", "Project"];

export function registerMissingApprovalsTools(server: McpServer) {
  server.tool(
    "list_my_missing_approvals",
    "Lists submitted timecards pending approval on YOUR projects for this month — scoped to projects where you are the Project Manager, Director, Revenue Accountant, or actual approver. " +
      "An entry appears when a timecard has been submitted but not yet approved and the approval deadline is within the next 3 days. " +
      "Grouped by Director > Actual Approver > Project. " +
      "Returns per entry: timecard ID, resource, week dates, billable flag, estimated revenue, and utilization category. " +
      "For an org-wide view across all projects regardless of your role, use list_all_missing_approvals instead.",
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
              text: "No pending timecard approvals found on your projects for this month.",
            },
          ],
        };
      }

      const lines: string[] = [
        `Found ${rows.length} pending timecard approval(s) on your projects this month:\n`,
      ];

      let lastProject = "";
      let lastApprover = "";

      for (const row of rows) {
        const [director, approver, project] = row.groups;
        const c = row.cells;

        if (approver !== lastApprover || project !== lastProject) {
          lines.push(`\n── ${project}`);
          lines.push(`   Director: ${director} | Approver: ${approver}`);
          lines.push(
            `   PM: ${c["Project: Project Manager"] ?? "—"} | Secondary Approver: ${c["Project: Secondary Approver"] ?? "—"} | Service Line: ${c["Project: Service Line"] ?? "—"}`
          );
          lastApprover = approver;
          lastProject = project;
        }

        lines.push(
          `   • Timecard: ${c["Timecard: Timecard Id"] ?? "—"} | Resource: ${c["Resource"] ?? "—"}`,
          `     Week: ${c["Start Date"] ?? "—"} → ${c["End Date"] ?? "—"} | Billable: ${c["Billable"] ?? "—"} | Est. Revenue: ${c["Estimated Timecard Revenue"] ?? "—"}`,
          `     Utilization: ${c["Utilization Category"] ?? "—"}`
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
