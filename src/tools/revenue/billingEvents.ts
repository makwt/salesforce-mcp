import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";

interface BillingEventRecord {
  Id: string;
  Name: string;
  pse__Project__r: { Name: string } | null;
  pse__Summary_Amount__c: number | null;
  pse__Status__c: string | null;
  pse__Date__c: string | null;
  pse__Invoice_Date__c: string | null;
  pse__Invoice_Number__c: string | null;
  pse__Is_Released__c: boolean;
  Revenue_Category__c: string | null;
  CurrencyIsoCode: string | null;
}

const BILLING_EVENT_FIELDS = `
  Id,
  Name,
  pse__Project__r.Name,
  pse__Summary_Amount__c,
  pse__Status__c,
  pse__Date__c,
  pse__Invoice_Date__c,
  pse__Invoice_Number__c,
  pse__Is_Released__c,
  Revenue_Category__c,
  CurrencyIsoCode
`.trim();

export function registerBillingEventsTool(server: McpServer) {
  server.tool(
    "list_billing_events",
    "Lists billing events for a project. Billing events track invoicing activity — amounts billed, status, and dates. " +
      "Filter by project name, status, or date range.",
    {
      project: z.string().describe("Project name (partial match)"),
      status: z.string().optional().describe("Filter by status (partial match)"),
      date_from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Date from (YYYY-MM-DD)"),
      date_to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Date to (YYYY-MM-DD)"),
    },
    async ({ project, status, date_from, date_to }) => {
      const conditions: string[] = [`pse__Project__r.Name LIKE '%${project}%'`];
      if (status) conditions.push(`pse__Status__c LIKE '%${status}%'`);
      if (date_from) conditions.push(`pse__Date__c >= '${date_from}'`);
      if (date_to) conditions.push(`pse__Date__c <= '${date_to}'`);

      let records: BillingEventRecord[];
      try {
        records = await soqlQueryAll<BillingEventRecord>(`
          SELECT ${BILLING_EVENT_FIELDS}
          FROM pse__Billing_Event__c
          WHERE ${conditions.join(" AND ")}
          ORDER BY pse__Date__c DESC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying billing events: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No billing events found matching the given filters." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`Found ${records.length} billing event(s):\n`];

      for (const r of records) {
        const projectName = r.pse__Project__r?.Name ?? "—";
        const amount =
          r.pse__Summary_Amount__c != null
            ? r.pse__Summary_Amount__c.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : "—";
        const amountLine =
          r.pse__Summary_Amount__c != null ? `${r.CurrencyIsoCode ?? ""} ${amount}`.trim() : "—";
        const url = `${instanceUrl}/${r.Id}`;

        lines.push(
          `• ${r.Name}`,
          `  Project:        ${projectName}`,
          `  Amount:         ${amountLine}`,
          `  Status:         ${r.pse__Status__c ?? "—"}`,
          `  Released:       ${r.pse__Is_Released__c ? "Yes" : "No"}`,
          `  Date:           ${r.pse__Date__c ?? "—"}`,
          `  Invoice Date:   ${r.pse__Invoice_Date__c ?? "—"}`,
          `  Invoice Number: ${r.pse__Invoice_Number__c ?? "—"}`,
          `  Category:       ${r.Revenue_Category__c ?? "—"}`,
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
