import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runReport } from "../../lib/reports.js";

const REPORT_ID = "00OTS000002uFXt2AM";

// Only these three aggregate columns are relevant from the report
// FORMULA2 = Adjusted Utilization Target, FORMULA3 = Billable Utilization, FORMULA4 = Adjusted Utilization
const WANTED_COLS = new Set(["FORMULA2", "FORMULA3", "FORMULA4"]);

export function registerMyDeliveryMetricsTool(server: McpServer) {
  server.tool(
    "get_my_delivery_metrics",
    "Returns YOUR OWN YTD delivery metrics: Billable Utilization %, Adjusted Utilization %, and Adjusted Utilization Target %. " +
      "Scoped to the currently authenticated user only. " +
      "To see these same metrics for every member of your team, use get_my_team_delivery_metrics instead.",
    {},
    async () => {
      let result: Awaited<ReturnType<typeof runReport>>;
      try {
        result = await runReport(REPORT_ID, false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error running delivery metrics report: ${message}` }],
          isError: true,
        };
      }

      const grandTotal = result.factMap["T!T"];
      if (!grandTotal) {
        return {
          content: [{ type: "text", text: "No data found in delivery metrics report." }],
        };
      }

      const metrics = result.aggregateColumns
        .map((col, i) => ({ col, label: result.aggregateLabels[col] ?? col, cell: grandTotal.aggregates[i] }))
        .filter(({ col }) => WANTED_COLS.has(col))
        .map(({ label, cell }) => `  ${label}: ${cell?.label ?? "—"}`);

      const lines = ["My YTD Delivery Metrics:", "", ...metrics];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
