import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";

interface OpportunityRecord {
  Id: string;
  Name: string;
  StageName: string | null;
  Amount: number | null;
  CloseDate: string | null;
  Owner: { Name: string } | null;
  Account: { Name: string } | null;
  Probability: number | null;
  ForecastCategory: string | null;
  Line_of_Business__c: string | null;
  Type: string | null;
}

const OPPORTUNITY_FIELDS = `
  Id,
  Name,
  StageName,
  Amount,
  CloseDate,
  Owner.Name,
  Account.Name,
  Probability,
  ForecastCategory,
  Line_of_Business__c,
  Type
`.trim();

const CLOSED_STAGES = [
  "Closed Won",
  "Closed Lost",
  "Closed",
  "Closed Cancelled",
  "Closed Canceled",
  "Opps Gone Cold",
  "COVID-19 Hold",
];

export function registerOpportunitiesTool(server: McpServer) {
  server.tool(
    "list_opportunities",
    "Lists Salesforce Opportunities (sales pipeline). By default excludes closed opportunities (Closed Won, Closed Lost, Closed, Closed Cancelled, Closed Canceled, Opps Gone Cold). " +
      "Set include_closed=true to include all stages. Filter by stage, account, owner, amount range, close date range, line of business, or forecast category. " +
      "Results are ordered by amount descending.",
    {
      stage: z.string().optional().describe("Filter by stage name (partial match)"),
      account: z.string().optional().describe("Filter by account name (partial match)"),
      owner: z.string().optional().describe("Filter by owner name (partial match)"),
      line_of_business: z.string().optional().describe("Filter by line of business (partial match)"),
      forecast_category: z.string().optional().describe("Filter by forecast category (partial match)"),
      min_amount: z.number().optional().describe("Minimum opportunity amount"),
      max_amount: z.number().optional().describe("Maximum opportunity amount"),
      close_date_from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Close date from (YYYY-MM-DD)"),
      close_date_to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Close date to (YYYY-MM-DD)"),
      include_closed: z
        .boolean()
        .optional()
        .describe("Include closed opportunities (default: false)"),
    },
    async ({
      stage,
      account,
      owner,
      line_of_business,
      forecast_category,
      min_amount,
      max_amount,
      close_date_from,
      close_date_to,
      include_closed,
    }) => {
      const conditions: string[] = [];

      if (!include_closed) {
        const vals = CLOSED_STAGES.map((s) => `'${s}'`).join(", ");
        conditions.push(`StageName NOT IN (${vals})`);
      }

      if (stage) conditions.push(`StageName LIKE '%${stage}%'`);
      if (account) conditions.push(`Account.Name LIKE '%${account}%'`);
      if (owner) conditions.push(`Owner.Name LIKE '%${owner}%'`);
      if (line_of_business) conditions.push(`Line_of_Business__c LIKE '%${line_of_business}%'`);
      if (forecast_category) conditions.push(`ForecastCategory LIKE '%${forecast_category}%'`);
      if (min_amount !== undefined) conditions.push(`Amount >= ${min_amount}`);
      if (max_amount !== undefined) conditions.push(`Amount <= ${max_amount}`);
      if (close_date_from) conditions.push(`CloseDate >= ${close_date_from}`);
      if (close_date_to) conditions.push(`CloseDate <= ${close_date_to}`);

      const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "Id != null";

      let records: OpportunityRecord[];
      try {
        records = await soqlQueryAll<OpportunityRecord>(`
          SELECT ${OPPORTUNITY_FIELDS}
          FROM Opportunity
          WHERE ${whereClause}
          ORDER BY Amount DESC NULLS LAST
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying opportunities: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No opportunities found matching the given filters." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`Found ${records.length} opportunity(ies):\n`];

      for (const r of records) {
        const amountStr =
          r.Amount != null
            ? r.Amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
            : "—";
        const probStr = r.Probability != null ? `${r.Probability}%` : "—";
        const url = `${instanceUrl}/${r.Id}`;

        lines.push(
          `• ${r.Name}`,
          `  Stage:             ${r.StageName ?? "—"}`,
          `  Account:           ${r.Account?.Name ?? "—"}`,
          `  Owner:             ${r.Owner?.Name ?? "—"}`,
          `  Amount:            ${amountStr}`,
          `  Close Date:        ${r.CloseDate ?? "—"}`,
          `  Probability:       ${probStr}`,
          `  Forecast Category: ${r.ForecastCategory ?? "—"}`,
          `  Line of Business:  ${r.Line_of_Business__c ?? "—"}`,
          `  Type:              ${r.Type ?? "—"}`,
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
