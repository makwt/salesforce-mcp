import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll } from "../../lib/salesforce.js";

interface EstVsActualsRecord {
  pse__Resource__r: { Name: string } | null;
  pse__Project__r: { Name: string } | null;
  Resource_Role__c: string | null;
  Resource_Workday_ID__c: string | null;
  Resource_Country__c: string | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Scheduled_Bill_Rate__c: number | null;
  pse__Estimated_Hours__c: number | null;
  Estimated_Revenue__c: number | null;
  Estimated_Cost__c: number | null;
  pse__Actual_Hours__c: number | null;
  pse__Actual_Billable_Amount__c: number | null;
  pse__Actual_Average_Bill_Rate__c: number | null;
  Actual_Costs__c: number | null;
  Revenue_Variance__c: number | null;
  Billable__c: boolean;
  pse__Timecards_Submitted__c: boolean;
}

const EVA_FIELDS = `
  pse__Resource__r.Name,
  pse__Project__r.Name,
  Resource_Role__c,
  Resource_Workday_ID__c,
  Resource_Country__c,
  pse__Start_Date__c,
  pse__End_Date__c,
  pse__Scheduled_Bill_Rate__c,
  pse__Estimated_Hours__c,
  Estimated_Revenue__c,
  Estimated_Cost__c,
  pse__Actual_Hours__c,
  pse__Actual_Billable_Amount__c,
  pse__Actual_Average_Bill_Rate__c,
  Actual_Costs__c,
  Revenue_Variance__c,
  Billable__c,
  pse__Timecards_Submitted__c
`.trim();

function usd(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function hrs(n: number | null): string {
  return n != null ? `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h` : "—";
}

function delta(n: number | null, format: (v: number | null) => string): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${format(n)}`;
}

function resourceName(fullName: string): string {
  return fullName.replace(/\s*\(\d+\)\s*$/, "").trim();
}

export function registerEstVsActualsTool(server: McpServer) {
  server.tool(
    "get_est_vs_actuals",
    "Returns estimated vs actual hours, revenue, and cost per resource for a given project and date range. " +
      "Each record represents one person's monthly period. Includes per-person breakdown and summary totals by country. " +
      "Uses the pse__Est_Vs_Actuals__c object (monthly time period type). " +
      "Requires a project name and a date range (start_date / end_date in YYYY-MM-DD format).",
    {
      project: z
        .string()
        .describe("Project name to filter by (partial match)"),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .describe("Start of the period (YYYY-MM-DD)"),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .describe("End of the period (YYYY-MM-DD)"),
      billable_only: z
        .boolean()
        .optional()
        .describe("When true (default), only includes billable records. Set to false to include all."),
    },
    async ({ project, start_date, end_date, billable_only = true }) => {
      const conditions: string[] = [
        `pse__Project__r.Name LIKE '%${project}%'`,
        `pse__Start_Date__c >= ${start_date}`,
        `pse__End_Date__c <= ${end_date}`,
        `pse__Time_Period_Type__c = 'Month'`,
      ];

      if (billable_only) {
        conditions.push(`Billable__c = true`);
      }

      let records: EstVsActualsRecord[];
      try {
        records = await soqlQueryAll<EstVsActualsRecord>(`
          SELECT ${EVA_FIELDS}
          FROM pse__Est_Vs_Actuals__c
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY pse__Resource__r.Name ASC, pse__Start_Date__c ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying Est vs Actuals: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No Est vs Actuals records found for the given filters." }],
        };
      }

      const projectName = records[0].pse__Project__r?.Name ?? project;

      // Aggregate per person across all months
      const byPerson = new Map<string, { name: string; estHours: number; actHours: number; estRev: number; actRev: number }>();
      let totalEstHours = 0, totalActHours = 0, totalEstRev = 0, totalActRev = 0;

      for (const r of records) {
        const fullName = r.pse__Resource__r?.Name ?? "—";
        const name = fullName === "—" ? "—" : resourceName(fullName);
        const key = fullName;

        const estHours = r.pse__Estimated_Hours__c ?? 0;
        const actHours = r.pse__Actual_Hours__c ?? 0;
        const estRev = r.Estimated_Revenue__c ?? 0;
        const actRev = r.pse__Actual_Billable_Amount__c ?? 0;

        totalEstHours += estHours;
        totalActHours += actHours;
        totalEstRev += estRev;
        totalActRev += actRev;

        const p = byPerson.get(key) ?? { name, estHours: 0, actHours: 0, estRev: 0, actRev: 0 };
        p.estHours += estHours;
        p.actHours += actHours;
        p.estRev += estRev;
        p.actRev += actRev;
        byPerson.set(key, p);
      }

      const lines: string[] = [
        `Est vs Actuals — ${projectName}  (${start_date} → ${end_date})\n`,
      ];

      for (const p of byPerson.values()) {
        const dHours = p.actHours - p.estHours;
        const dRev = p.actRev - p.estRev;
        lines.push(
          `• ${p.name}`,
          `  Hours:    ${hrs(p.estHours)} EST  →  ${hrs(p.actHours)} ACT  (${delta(dHours, hrs)})`,
          `  Revenue:  ${usd(p.estRev)} EST  →  ${usd(p.actRev)} ACT  (${delta(dRev, usd)})`,
          ``
        );
      }

      const totalDHours = totalActHours - totalEstHours;
      const totalDRev = totalActRev - totalEstRev;

      lines.push(
        `TOTAL`,
        `  Hours:    ${hrs(totalEstHours)} EST  →  ${hrs(totalActHours)} ACT  (${delta(totalDHours, hrs)})`,
        `  Revenue:  ${usd(totalEstRev)} EST  →  ${usd(totalActRev)} ACT  (${delta(totalDRev, usd)})`
      );

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
