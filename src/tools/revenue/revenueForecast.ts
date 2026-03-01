import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll } from "../../lib/salesforce.js";

interface ForecastRecord {
  pse__Project__r: { Name: string } | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Estimated_Hours__c: number | null;
  Estimated_Revenue__c: number | null;
  Estimated_Cost__c: number | null;
  pse__Actual_Hours__c: number | null;
  pse__Actual_Billable_Amount__c: number | null;
  Actual_Costs__c: number | null;
  Revenue_Variance__c: number | null;
  Billable__c: boolean;
}

const FORECAST_FIELDS = `
  pse__Project__r.Name,
  pse__Start_Date__c,
  pse__End_Date__c,
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

function hrs(n: number): string {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
}

function delta(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${usd(n)}`;
}

export function registerRevenueForecastTool(server: McpServer) {
  server.tool(
    "get_revenue_forecast",
    "Returns a revenue forecast by month, showing estimated and actual revenue from PSA Est vs Actuals data. " +
      "Can be scoped to a single project or aggregated across multiple projects by director or project manager. " +
      "Uses monthly time period data from pse__Est_Vs_Actuals__c.",
    {
      project: z
        .string()
        .optional()
        .describe("Project name (partial match)"),
      director: z
        .string()
        .optional()
        .describe("Director name to scope by (partial match)"),
      pm: z
        .string()
        .optional()
        .describe("Project Manager name to scope by (partial match)"),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .describe("Start of forecast period"),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .describe("End of forecast period"),
      billable_only: z
        .boolean()
        .optional()
        .describe("When true (default), only includes billable records."),
    },
    async ({ project, director, pm, start_date, end_date, billable_only }) => {
      if (!project && !director && !pm) {
        return {
          content: [
            {
              type: "text",
              text: "At least one scope filter (project, director, or pm) is required.",
            },
          ],
          isError: true,
        };
      }

      const conditions: string[] = [
        "pse__Time_Period_Type__c = 'Month'",
        `pse__Start_Date__c >= ${start_date}`,
        `pse__End_Date__c <= ${end_date}`,
      ];

      if (project) conditions.push(`pse__Project__r.Name LIKE '%${project}%'`);
      if (director) conditions.push(`pse__Project__r.Director__r.Name LIKE '%${director}%'`);
      if (pm) conditions.push(`pse__Project__r.pse__Project_Manager__r.Name LIKE '%${pm}%'`);
      if (billable_only !== false) conditions.push("Billable__c = true");

      let records: ForecastRecord[];
      try {
        records = await soqlQueryAll<ForecastRecord>(`
          SELECT ${FORECAST_FIELDS}
          FROM pse__Est_Vs_Actuals__c
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY pse__Start_Date__c ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying revenue forecast: ${message}` }],
          isError: true,
        };
      }

      const scopeParts: string[] = [];
      if (project) scopeParts.push(`project: "${project}"`);
      if (director) scopeParts.push(`director: "${director}"`);
      if (pm) scopeParts.push(`pm: "${pm}"`);
      const scopeLabel = scopeParts.join(", ");

      const byMonth = new Map<
        string,
        {
          estHours: number;
          estRevenue: number;
          estCost: number;
          actHours: number;
          actRevenue: number;
          actCost: number;
          variance: number;
        }
      >();

      for (const r of records) {
        const monthKey = r.pse__Start_Date__c ? r.pse__Start_Date__c.slice(0, 7) : "";
        if (!monthKey) continue;

        const cur = byMonth.get(monthKey) ?? {
          estHours: 0,
          estRevenue: 0,
          estCost: 0,
          actHours: 0,
          actRevenue: 0,
          actCost: 0,
          variance: 0,
        };

        cur.estHours += r.pse__Estimated_Hours__c ?? 0;
        cur.estRevenue += r.Estimated_Revenue__c ?? 0;
        cur.estCost += r.Estimated_Cost__c ?? 0;
        cur.actHours += r.pse__Actual_Hours__c ?? 0;
        cur.actRevenue += r.pse__Actual_Billable_Amount__c ?? 0;
        cur.actCost += r.Actual_Costs__c ?? 0;
        cur.variance += r.Revenue_Variance__c ?? 0;

        byMonth.set(monthKey, cur);
      }

      const months = Array.from(byMonth.keys()).sort();
      const totals = {
        estHours: 0,
        estRevenue: 0,
        estCost: 0,
        actHours: 0,
        actRevenue: 0,
        actCost: 0,
        variance: 0,
      };

      const lines: string[] = [
        `Revenue Forecast (${start_date} → ${end_date})`,
        `Scope: ${scopeLabel}`,
        ``,
        `── Monthly Breakdown ──`,
        ``,
      ];

      for (const m of months) {
        const cur = byMonth.get(m)!;
        totals.estHours += cur.estHours;
        totals.estRevenue += cur.estRevenue;
        totals.estCost += cur.estCost;
        totals.actHours += cur.actHours;
        totals.actRevenue += cur.actRevenue;
        totals.actCost += cur.actCost;
        totals.variance += cur.variance;

        lines.push(
          `  ${m}:`,
          `    Est Hours:    ${hrs(cur.estHours)}    | Act Hours:    ${hrs(cur.actHours)}`,
          `    Est Revenue:  ${usd(cur.estRevenue)}    | Act Revenue:  ${usd(cur.actRevenue)}`,
          `    Est Cost:     ${usd(cur.estCost)}    | Act Cost:     ${usd(cur.actCost)}`,
          `    Variance:     ${delta(cur.variance)}`,
          ``
        );
      }

      lines.push(
        `── Totals ──`,
        ``,
        `  Est Hours:    ${hrs(totals.estHours)}    | Act Hours:    ${hrs(totals.actHours)}`,
        `  Est Revenue:  ${usd(totals.estRevenue)}    | Act Revenue:  ${usd(totals.actRevenue)}`,
        `  Est Cost:     ${usd(totals.estCost)}    | Act Cost:     ${usd(totals.actCost)}`,
        `  Variance:     ${delta(totals.variance)}`
      );

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
