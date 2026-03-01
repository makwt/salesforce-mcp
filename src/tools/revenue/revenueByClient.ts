import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll } from "../../lib/salesforce.js";

interface ClientRevenueRecord {
  pse__Project__r: {
    Name: string;
    pse__Account__r: { Name: string } | null;
  } | null;
  pse__Estimated_Hours__c: number | null;
  Estimated_Revenue__c: number | null;
  Estimated_Cost__c: number | null;
  pse__Actual_Hours__c: number | null;
  pse__Actual_Billable_Amount__c: number | null;
  Actual_Costs__c: number | null;
  Revenue_Variance__c: number | null;
  Billable__c: boolean;
}

const FIELDS = `
  pse__Project__r.Name,
  pse__Project__r.pse__Account__r.Name,
  pse__Estimated_Hours__c,
  Estimated_Revenue__c,
  Estimated_Cost__c,
  pse__Actual_Hours__c,
  pse__Actual_Billable_Amount__c,
  Actual_Costs__c,
  Revenue_Variance__c,
  Billable__c
`.trim();

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function delta(n: number): string {
  return `${n >= 0 ? "+" : ""}${usd(n)}`;
}

interface ClientTotals {
  estHours: number;
  estRevenue: number;
  estCost: number;
  actHours: number;
  actRevenue: number;
  actCost: number;
  variance: number;
}

function emptyTotals(): ClientTotals {
  return { estHours: 0, estRevenue: 0, estCost: 0, actHours: 0, actRevenue: 0, actCost: 0, variance: 0 };
}

export function registerRevenueByClientTool(server: McpServer) {
  server.tool(
    "get_revenue_by_client",
    "Returns revenue aggregated by client (Account) for a given date range, using Est vs Actuals data. " +
      "Shows estimated revenue, actual revenue, and variance per client, sorted by actual revenue descending. " +
      "Use start_date and end_date to define the period (e.g. the current year). " +
      "Scope with any combination of: director, project manager, specific project, service line, or reporting company. " +
      "Use min_revenue to suppress small clients from the output.",
    {
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .describe("Start of the period (e.g. '2025-01-01')"),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .describe("End of the period (e.g. '2025-12-31')"),
      director: z
        .string()
        .optional()
        .describe("Filter by director name (partial match)"),
      pm: z
        .string()
        .optional()
        .describe("Filter by project manager name (partial match)"),
      reporting_company: z
        .string()
        .optional()
        .describe("Filter by reporting company / practice (partial match, e.g. 'WillowTree', 'Poatek')"),
      project: z
        .string()
        .optional()
        .describe("Filter by project name (partial match)"),
      service_line: z
        .string()
        .optional()
        .describe("Filter by service line / department on the project (partial match, e.g. 'Engineering', 'Design')"),
      billable_only: z
        .boolean()
        .optional()
        .describe("When true (default), only includes billable records."),
      min_revenue: z
        .number()
        .optional()
        .describe("Minimum actual revenue threshold — clients below this amount are excluded from output."),
    },
    async ({ start_date, end_date, director, pm, reporting_company, project, service_line, billable_only, min_revenue }) => {
      const conditions: string[] = [
        "pse__Time_Period_Type__c = 'Month'",
        `pse__Start_Date__c >= ${start_date}`,
        `pse__End_Date__c <= ${end_date}`,
      ];

      if (director) conditions.push(`pse__Project__r.Director__r.Name LIKE '%${director}%'`);
      if (pm) conditions.push(`pse__Project__r.pse__Project_Manager__r.Name LIKE '%${pm}%'`);
      if (reporting_company) conditions.push(`pse__Project__r.pse__Practice__r.Name LIKE '%${reporting_company}%'`);
      if (project) conditions.push(`pse__Project__r.Name LIKE '%${project}%'`);
      if (service_line) conditions.push(`pse__Project__r.pse__Group__r.Name LIKE '%${service_line}%'`);
      if (billable_only !== false) conditions.push("Billable__c = true");

      let records: ClientRevenueRecord[];
      try {
        records = await soqlQueryAll<ClientRevenueRecord>(`
          SELECT ${FIELDS}
          FROM pse__Est_Vs_Actuals__c
          WHERE ${conditions.join("\n            AND ")}
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying revenue by client: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: `No data found for the period ${start_date} → ${end_date}.` }],
        };
      }

      // Aggregate by client account
      const byClient = new Map<string, ClientTotals>();
      for (const r of records) {
        const client = r.pse__Project__r?.pse__Account__r?.Name ?? "(No Account)";
        const cur = byClient.get(client) ?? emptyTotals();
        cur.estHours += r.pse__Estimated_Hours__c ?? 0;
        cur.estRevenue += r.Estimated_Revenue__c ?? 0;
        cur.estCost += r.Estimated_Cost__c ?? 0;
        cur.actHours += r.pse__Actual_Hours__c ?? 0;
        cur.actRevenue += r.pse__Actual_Billable_Amount__c ?? 0;
        cur.actCost += r.Actual_Costs__c ?? 0;
        cur.variance += r.Revenue_Variance__c ?? 0;
        byClient.set(client, cur);
      }

      // Filter by min_revenue and sort by actual revenue desc
      let clients = Array.from(byClient.entries());
      if (min_revenue != null) {
        clients = clients.filter(([, t]) => t.actRevenue >= min_revenue);
      }
      clients.sort((a, b) => b[1].actRevenue - a[1].actRevenue);

      const grand = emptyTotals();
      for (const [, t] of clients) {
        grand.estHours += t.estHours;
        grand.estRevenue += t.estRevenue;
        grand.actHours += t.actHours;
        grand.actRevenue += t.actRevenue;
        grand.variance += t.variance;
      }

      const filterParts = [
        director && `director: "${director}"`,
        pm && `pm: "${pm}"`,
        reporting_company && `company: "${reporting_company}"`,
        project && `project: "${project}"`,
        service_line && `service line: "${service_line}"`,
        min_revenue != null && `min revenue: ${usd(min_revenue)}`,
      ].filter(Boolean);

      const lines: string[] = [
        `Revenue by Client — ${start_date} → ${end_date}`,
        filterParts.length ? `Filters: ${filterParts.join(", ")}` : "",
        `${clients.length} client(s)`,
        ``,
      ].filter(s => s !== "");

      for (const [client, t] of clients) {
        lines.push(
          `• ${client}`,
          `  Est Revenue:  ${usd(t.estRevenue)}   Act Revenue:  ${usd(t.actRevenue)}   Variance: ${delta(t.variance)}`,
          `  Est Hours:    ${t.estHours.toFixed(1)}h          Act Hours:    ${t.actHours.toFixed(1)}h`,
          ``
        );
      }

      lines.push(
        `── Grand Total ──`,
        `  Est Revenue:  ${usd(grand.estRevenue)}   Act Revenue:  ${usd(grand.actRevenue)}   Variance: ${delta(grand.variance)}`,
        `  Est Hours:    ${grand.estHours.toFixed(1)}h          Act Hours:    ${grand.actHours.toFixed(1)}h`,
      );

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
