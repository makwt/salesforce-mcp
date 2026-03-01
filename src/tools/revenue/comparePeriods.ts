import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll } from "../../lib/salesforce.js";

interface PeriodRecord {
  pse__Project__r: {
    Name: string;
    pse__Account__r: { Name: string } | null;
    Director__r: { Name: string } | null;
    pse__Project_Manager__r: { Name: string } | null;
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

const PERIOD_FIELDS = `
  pse__Project__r.Name,
  pse__Project__r.pse__Account__r.Name,
  pse__Project__r.Director__r.Name,
  pse__Project__r.pse__Project_Manager__r.Name,
  pse__Estimated_Hours__c,
  Estimated_Revenue__c,
  Estimated_Cost__c,
  pse__Actual_Hours__c,
  pse__Actual_Billable_Amount__c,
  Actual_Costs__c,
  Revenue_Variance__c,
  Billable__c
`.trim();

interface PeriodTotals {
  estHours: number;
  estRevenue: number;
  estCost: number;
  actHours: number;
  actRevenue: number;
  actCost: number;
  variance: number;
}

function emptyTotals(): PeriodTotals {
  return { estHours: 0, estRevenue: 0, estCost: 0, actHours: 0, actRevenue: 0, actCost: 0, variance: 0 };
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function pctChange(a: number, b: number): string {
  if (a === 0) return b === 0 ? "—" : "+∞%";
  const pct = ((b - a) / Math.abs(a)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function delta(n: number): string {
  return `${n >= 0 ? "+" : ""}${usd(n)}`;
}

/** Returns [start, end] for a calendar quarter (0-indexed: Q0=Jan, Q1=Apr, ...) */
function quarterBounds(year: number, quarter: 0 | 1 | 2 | 3): [string, string] {
  const startMonth = quarter * 3;
  const endMonth = startMonth + 2;
  const startDate = new Date(year, startMonth, 1);
  const endDate = new Date(year, endMonth + 1, 0); // last day of endMonth
  return [
    startDate.toISOString().slice(0, 10),
    endDate.toISOString().slice(0, 10),
  ];
}

function currentAndPreviousQuarterBounds(): {
  labelA: string;
  startA: string;
  endA: string;
  labelB: string;
  startB: string;
  endB: string;
} {
  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.floor(now.getMonth() / 3) as 0 | 1 | 2 | 3;

  const [startA, endA] = quarterBounds(year, quarter);
  const labelA = `Q${quarter + 1} ${year}`;

  let prevQuarter: 0 | 1 | 2 | 3;
  let prevYear: number;
  if (quarter === 0) {
    prevQuarter = 3;
    prevYear = year - 1;
  } else {
    prevQuarter = (quarter - 1) as 0 | 1 | 2 | 3;
    prevYear = year;
  }

  const [startB, endB] = quarterBounds(prevYear, prevQuarter);
  const labelB = `Q${prevQuarter + 1} ${prevYear}`;

  return { labelA, startA, endA, labelB, startB, endB };
}

function currentAndPreviousMonthBounds(): {
  labelA: string;
  startA: string;
  endA: string;
  labelB: string;
  startB: string;
  endB: string;
} {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const startA = new Date(year, month, 1).toISOString().slice(0, 10);
  const endA = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  const labelA = new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const startB = new Date(prevYear, prevMonth, 1).toISOString().slice(0, 10);
  const endB = new Date(prevYear, prevMonth + 1, 0).toISOString().slice(0, 10);
  const labelB = new Date(prevYear, prevMonth, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return { labelA, startA, endA, labelB, startB, endB };
}

interface FetchFilters {
  director?: string;
  project?: string;
  client?: string;
  service_line?: string;
  reporting_company?: string;
  billableOnly: boolean;
}

async function fetchTotals(
  start: string,
  end: string,
  filters: FetchFilters
): Promise<PeriodTotals> {
  const conditions: string[] = [
    "pse__Time_Period_Type__c = 'Month'",
    `pse__Start_Date__c >= ${start}`,
    `pse__End_Date__c <= ${end}`,
  ];
  if (filters.director) conditions.push(`pse__Project__r.Director__r.Name LIKE '%${filters.director}%'`);
  if (filters.project) conditions.push(`pse__Project__r.Name LIKE '%${filters.project}%'`);
  if (filters.client) conditions.push(`pse__Project__r.pse__Account__r.Name LIKE '%${filters.client}%'`);
  if (filters.service_line) conditions.push(`pse__Project__r.pse__Group__r.Name LIKE '%${filters.service_line}%'`);
  if (filters.reporting_company) conditions.push(`pse__Project__r.pse__Practice__r.Name LIKE '%${filters.reporting_company}%'`);
  if (filters.billableOnly) conditions.push("Billable__c = true");

  const records = await soqlQueryAll<PeriodRecord>(`
    SELECT ${PERIOD_FIELDS}
    FROM pse__Est_Vs_Actuals__c
    WHERE ${conditions.join("\n      AND ")}
  `);

  const totals = emptyTotals();
  for (const r of records) {
    totals.estHours += r.pse__Estimated_Hours__c ?? 0;
    totals.estRevenue += r.Estimated_Revenue__c ?? 0;
    totals.estCost += r.Estimated_Cost__c ?? 0;
    totals.actHours += r.pse__Actual_Hours__c ?? 0;
    totals.actRevenue += r.pse__Actual_Billable_Amount__c ?? 0;
    totals.actCost += r.Actual_Costs__c ?? 0;
    totals.variance += r.Revenue_Variance__c ?? 0;
  }
  return totals;
}

export function registerComparePeriodsTool(server: McpServer) {
  server.tool(
    "compare_periods",
    "Compares two date ranges side by side — designed for quarter-over-quarter comparisons but works for any period. " +
      "Use period='quarter' to automatically compare the current quarter vs the previous one (no date math required). " +
      "Use period='month' to compare the current month vs the previous month. " +
      "Or provide explicit date ranges with start_date_a/end_date_a and start_date_b/end_date_b. " +
      "Period A is considered 'current'; Period B is considered 'previous'. " +
      "Returns hours, revenue, cost, and variance for each period, plus delta and % change. " +
      "Scope with any combination of: director, project manager, specific project, client (account), service line, or reporting company.",
    {
      period: z
        .enum(["quarter", "month"])
        .optional()
        .describe("Shorthand period selector: 'quarter' = current vs previous calendar quarter, 'month' = current vs previous month."),
      start_date_a: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .optional()
        .describe("Start of Period A (current/newer period). Required if 'period' is not provided."),
      end_date_a: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .optional()
        .describe("End of Period A. Required if 'period' is not provided."),
      start_date_b: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .optional()
        .describe("Start of Period B (previous/older period). Required if 'period' is not provided."),
      end_date_b: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .optional()
        .describe("End of Period B. Required if 'period' is not provided."),
      director: z
        .string()
        .optional()
        .describe("Filter by director name (partial match)"),
      project: z
        .string()
        .optional()
        .describe("Filter by project name (partial match)"),
      client: z
        .string()
        .optional()
        .describe("Filter by client / account name (partial match, e.g. 'TELUS', 'Charter')"),
      service_line: z
        .string()
        .optional()
        .describe("Filter by service line / department (partial match, e.g. 'Engineering', 'Design')"),
      reporting_company: z
        .string()
        .optional()
        .describe("Filter by reporting company / practice (partial match, e.g. 'WillowTree', 'Poatek')"),
      billable_only: z
        .boolean()
        .optional()
        .describe("When true (default), only includes billable records."),
    },
    async ({
      period,
      start_date_a,
      end_date_a,
      start_date_b,
      end_date_b,
      director,
      project,
      client,
      service_line,
      reporting_company,
      billable_only,
    }) => {
      let labelA: string;
      let startA: string;
      let endA: string;
      let labelB: string;
      let startB: string;
      let endB: string;

      if (period === "quarter") {
        ({ labelA, startA, endA, labelB, startB, endB } = currentAndPreviousQuarterBounds());
      } else if (period === "month") {
        ({ labelA, startA, endA, labelB, startB, endB } = currentAndPreviousMonthBounds());
      } else if (start_date_a && end_date_a && start_date_b && end_date_b) {
        startA = start_date_a;
        endA = end_date_a;
        startB = start_date_b;
        endB = end_date_b;
        labelA = `${startA} → ${endA}`;
        labelB = `${startB} → ${endB}`;
      } else {
        return {
          content: [{
            type: "text",
            text: "Provide either 'period' (quarter or month) OR all four explicit date parameters (start_date_a, end_date_a, start_date_b, end_date_b).",
          }],
          isError: true,
        };
      }

      const filters: FetchFilters = {
        director, project, client, service_line, reporting_company,
        billableOnly: billable_only !== false,
      };

      let totalsA: PeriodTotals;
      let totalsB: PeriodTotals;
      try {
        [totalsA, totalsB] = await Promise.all([
          fetchTotals(startA, endA, filters),
          fetchTotals(startB, endB, filters),
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error comparing periods: ${message}` }],
          isError: true,
        };
      }

      const filterParts = [
        director && `director: "${director}"`,
        project && `project: "${project}"`,
        client && `client: "${client}"`,
        service_line && `service line: "${service_line}"`,
        reporting_company && `company: "${reporting_company}"`,
      ].filter(Boolean);

      const colW = 22;
      const pad = (s: string) => s.padStart(colW);

      const row = (label: string, a: string, b: string, d: string, pct: string) =>
        `${label.padEnd(20)}  ${pad(a)}  ${pad(b)}  ${pad(d)}  ${pct}`;

      const lines: string[] = [
        `Period Comparison`,
        filterParts.length ? `Filters: ${filterParts.join(", ")}` : "",
        ``,
        row("", labelA, labelB, "Delta (A − B)", "% Change"),
        row("", "─".repeat(colW), "─".repeat(colW), "─".repeat(colW), "─".repeat(8)),
        row("Actual Revenue",
          usd(totalsA.actRevenue),
          usd(totalsB.actRevenue),
          delta(totalsA.actRevenue - totalsB.actRevenue),
          pctChange(totalsB.actRevenue, totalsA.actRevenue)),
        row("Est Revenue",
          usd(totalsA.estRevenue),
          usd(totalsB.estRevenue),
          delta(totalsA.estRevenue - totalsB.estRevenue),
          pctChange(totalsB.estRevenue, totalsA.estRevenue)),
        row("Variance",
          delta(totalsA.variance),
          delta(totalsB.variance),
          delta(totalsA.variance - totalsB.variance),
          pctChange(totalsB.variance, totalsA.variance)),
        row("Actual Hours",
          `${totalsA.actHours.toFixed(1)}h`,
          `${totalsB.actHours.toFixed(1)}h`,
          `${(totalsA.actHours - totalsB.actHours >= 0 ? "+" : "")}${(totalsA.actHours - totalsB.actHours).toFixed(1)}h`,
          pctChange(totalsB.actHours, totalsA.actHours)),
        row("Est Hours",
          `${totalsA.estHours.toFixed(1)}h`,
          `${totalsB.estHours.toFixed(1)}h`,
          `${(totalsA.estHours - totalsB.estHours >= 0 ? "+" : "")}${(totalsA.estHours - totalsB.estHours).toFixed(1)}h`,
          pctChange(totalsB.estHours, totalsA.estHours)),
        row("Actual Cost",
          usd(totalsA.actCost),
          usd(totalsB.actCost),
          delta(totalsA.actCost - totalsB.actCost),
          pctChange(totalsB.actCost, totalsA.actCost)),
      ].filter(s => s !== "");

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
