import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll } from "../../lib/salesforce.js";

interface VarianceBreakdownRecord {
  pse__Resource__r: { Name: string } | null;
  pse__Project__r: { Name: string } | null;
  Resource_Role__c: string | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Scheduled_Bill_Rate__c: number | null;
  pse__Estimated_Hours__c: number | null;
  Estimated_Revenue__c: number | null;
  pse__Actual_Hours__c: number | null;
  pse__Actual_Billable_Amount__c: number | null;
  pse__Actual_Average_Bill_Rate__c: number | null;
  Revenue_Variance__c: number | null;
  Billable__c: boolean;
}

const FIELDS = `
  pse__Resource__r.Name,
  pse__Project__r.Name,
  Resource_Role__c,
  pse__Start_Date__c,
  pse__End_Date__c,
  pse__Scheduled_Bill_Rate__c,
  pse__Estimated_Hours__c,
  Estimated_Revenue__c,
  pse__Actual_Hours__c,
  pse__Actual_Billable_Amount__c,
  pse__Actual_Average_Bill_Rate__c,
  Revenue_Variance__c,
  Billable__c
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

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 0);
  return d.toISOString().slice(0, 10);
}

export function registerVarianceBreakdownTool(server: McpServer) {
  server.tool(
    "get_variance_breakdown",
    "Explains why a monthly revenue variance occurred by analyzing weekly (SplitWeek) Est vs Actuals data. " +
      "When a PM or Director is asked 'you had a $20k variance this month, what happened?', this tool breaks it down by person and week. " +
      "It identifies which people and which weeks drove the variance, decomposes each into hours vs rate components, " +
      "and detects structural changes (people added/removed, allocation changes) between consecutive weeks.",
    {
      project: z.string().describe("Project name to filter by (partial match)"),
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/, "Must be YYYY-MM")
        .describe("The month to analyze (YYYY-MM)"),
      billable_only: z
        .boolean()
        .optional()
        .describe("When true (default), only includes billable records. Set to false to include all."),
    },
    async ({ project, month, billable_only = true }) => {
      const firstDay = `${month}-01`;
      const lastDay = lastDayOfMonth(month);

      const conditions: string[] = [
        `pse__Project__r.Name LIKE '%${project}%'`,
        `pse__Time_Period_Type__c = 'SplitWeek'`,
        `pse__Start_Date__c >= ${firstDay}`,
        `pse__Start_Date__c <= ${lastDay}`,
      ];

      if (billable_only) {
        conditions.push(`Billable__c = true`);
      }

      let records: VarianceBreakdownRecord[];
      try {
        records = await soqlQueryAll<VarianceBreakdownRecord>(`
          SELECT ${FIELDS}
          FROM pse__Est_Vs_Actuals__c
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY pse__Start_Date__c ASC, pse__Resource__r.Name ASC
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

      const byWeek = new Map<string, VarianceBreakdownRecord[]>();
      for (const r of records) {
        const weekKey = r.pse__Start_Date__c ?? "";
        const list = byWeek.get(weekKey) ?? [];
        list.push(r);
        byWeek.set(weekKey, list);
      }

      const weeks = Array.from(byWeek.keys()).sort();

      type PersonWeek = {
        estHours: number;
        actHours: number;
        schedRate: number;
        actualRate: number;
        totalVariance: number;
        hoursVariance: number;
        hoursVarianceRevenue: number;
        rateVariance: number;
      };

      const byPersonByWeek = new Map<string, Map<string, PersonWeek>>();
      const personTotalVariance = new Map<string, number>();

      for (const weekKey of weeks) {
        const weekRecords = byWeek.get(weekKey) ?? [];
        for (const r of weekRecords) {
          const fullName = r.pse__Resource__r?.Name ?? "—";
          const name = fullName === "—" ? "—" : resourceName(fullName);
          const estHours = r.pse__Estimated_Hours__c ?? 0;
          const actHours = r.pse__Actual_Hours__c ?? 0;
          const schedRate = r.pse__Scheduled_Bill_Rate__c ?? 0;
          const actualRate = r.pse__Actual_Average_Bill_Rate__c ?? 0;
          const totalVariance = r.Revenue_Variance__c ?? 0;

          const hoursVariance = actHours - estHours;
          const hoursVarianceRevenue = hoursVariance * schedRate;
          const rateVariance = (actualRate - schedRate) * actHours;

          const pw: PersonWeek = {
            estHours,
            actHours,
            schedRate,
            actualRate,
            totalVariance,
            hoursVariance,
            hoursVarianceRevenue,
            rateVariance,
          };

          let personWeeks = byPersonByWeek.get(fullName);
          if (!personWeeks) {
            personWeeks = new Map();
            byPersonByWeek.set(fullName, personWeeks);
          }
          personWeeks.set(weekKey, pw);

          const total = personTotalVariance.get(fullName) ?? 0;
          personTotalVariance.set(fullName, total + totalVariance);
        }
      }

      const totalMonthlyVariance = Array.from(personTotalVariance.values()).reduce((a, b) => a + b, 0);

      const peopleSorted = Array.from(personTotalVariance.entries())
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([fullName]) => fullName);

      const structuralChanges: string[] = [];
      for (let i = 1; i < weeks.length; i++) {
        const prevWeek = weeks[i - 1];
        const currWeek = weeks[i];
        const prevNames = new Set((byWeek.get(prevWeek) ?? []).map((r) => r.pse__Resource__r?.Name ?? ""));
        const currNames = new Set((byWeek.get(currWeek) ?? []).map((r) => r.pse__Resource__r?.Name ?? ""));
        const prevEstByPerson = new Map<string, number>();
        for (const r of byWeek.get(prevWeek) ?? []) {
          const name = r.pse__Resource__r?.Name ?? "";
          prevEstByPerson.set(name, r.pse__Estimated_Hours__c ?? 0);
        }
        const currEstByPerson = new Map<string, number>();
        const currRateByPerson = new Map<string, number>();
        for (const r of byWeek.get(currWeek) ?? []) {
          const name = r.pse__Resource__r?.Name ?? "";
          currEstByPerson.set(name, r.pse__Estimated_Hours__c ?? 0);
          currRateByPerson.set(name, r.pse__Scheduled_Bill_Rate__c ?? 0);
        }

        const changes: string[] = [];
        for (const name of currNames) {
          if (!prevNames.has(name)) {
            const est = currEstByPerson.get(name) ?? 0;
            const rate = currRateByPerson.get(name) ?? 0;
            const displayName = name === "—" ? "—" : resourceName(name);
            changes.push(`- ${displayName} ADDED (est ${hrs(est)}, rate ${usd(rate)}/hr)`);
          }
        }
        for (const name of prevNames) {
          if (!currNames.has(name)) {
            const est = prevEstByPerson.get(name) ?? 0;
            const displayName = name === "—" ? "—" : resourceName(name);
            changes.push(`- ${displayName} REMOVED (was est ${hrs(est)})`);
          }
        }
        for (const name of currNames) {
          if (prevNames.has(name)) {
            const oldEst = prevEstByPerson.get(name) ?? 0;
            const newEst = currEstByPerson.get(name) ?? 0;
            if (Math.abs(oldEst - newEst) > 0.01) {
              const displayName = name === "—" ? "—" : resourceName(name);
              changes.push(`- ${displayName} allocation changed: ${hrs(oldEst)} → ${hrs(newEst)} EST`);
            }
          }
        }
        if (changes.length > 0) {
          structuralChanges.push(`  Week of ${currWeek}:`);
          structuralChanges.push(...changes);
        }
      }

      const lines: string[] = [
        `Variance Breakdown — ${projectName} (${month})`,
        `Total Monthly Revenue Variance: ${delta(totalMonthlyVariance, usd)}\n`,
        `── Top Contributors ──\n`,
      ];

      for (const fullName of peopleSorted) {
        const name = fullName === "—" ? "—" : resourceName(fullName);
        const role = (() => {
          const rec = records.find((r) => r.pse__Resource__r?.Name === fullName);
          return rec?.Resource_Role__c ?? "—";
        })();
        const totalVar = personTotalVariance.get(fullName) ?? 0;
        lines.push(`  • ${name} (${role}): ${delta(totalVar, usd)} total variance`);

        const personWeeks = byPersonByWeek.get(fullName);
        if (personWeeks) {
          for (const weekKey of weeks) {
            const pw = personWeeks.get(weekKey);
            if (!pw) continue;
            lines.push(`    Week of ${weekKey}: ${delta(pw.totalVariance, usd)}`);
            lines.push(
              `      Hours: ${hrs(pw.estHours)} EST → ${hrs(pw.actHours)} ACT (${delta(pw.hoursVariance, hrs)} → ${delta(pw.hoursVarianceRevenue, usd)} from hours)`
            );
            lines.push(
              `      Rate: ${usd(pw.schedRate)}/hr → ${usd(pw.actualRate)}/hr (${delta(pw.rateVariance, usd)} from rate)`
            );
          }
        }
        lines.push("");
      }

      if (structuralChanges.length > 0) {
        lines.push(`── Structural Changes ──\n`);
        lines.push(...structuralChanges);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
