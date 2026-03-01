import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runReport, ReportResult } from "../../lib/reports.js";

const SUBMISSION_REPORT_ID  = "00OTS000003V9QH2A0";
const APPROVAL_REPORT_ID    = "00OTS000003V9TV2A0";
const UTILIZATION_REPORT_ID = "00OTS000002qg5F2AQ";

interface TimecardReportConfig {
  idxRate: number;
  idxCount: number;
}

// Aggregate indices for timecard reports
const SUBMISSION: TimecardReportConfig = { idxRate: 3, idxCount: 4 }; // FORMULA2, RowCount
const APPROVAL:   TimecardReportConfig = { idxRate: 4, idxCount: 5 }; // FORMULA1, RowCount

// Aggregate indices for utilization report (00OTS000002qg5F2AQ)
const UTIL_IDX = {
  ptoHrs:       5,  // s!Utilization_Forecast__c.Leave_Hours__c  — Sum of PTO Hours
  billableHrs:  0,  // s!Utilization_Forecast__c.Total_Billable_Hours__c
  creditedHrs: 10,  // FORMULA5 — Sum of Total Credited Hours
  capacityHrs:  6,  // FORMULA1 — Sum of Capacity Hours
  billableUtil: 8,  // FORMULA3 — Billable Utilization
  adjUtil:      9,  // FORMULA4 — Adjusted Utilization
  adjTarget:    7,  // FORMULA2 — Adjusted Utilization Target
};

function formatTimecardSection(title: string, result: ReportResult, cfg: TimecardReportConfig): string[] {
  const lines: string[] = [
    `── ${title} (${result.groupingsDown.length} person(s)) ──`,
    ``,
    `${"Name".padEnd(50)} ${"Records".padStart(7)}  On-Time Rate`,
    `${"─".repeat(50)} ${"─".repeat(7)}  ${"─".repeat(12)}`,
  ];

  for (const g of result.groupingsDown) {
    const aggs = result.factMap[`${g.key}!T`]?.aggregates ?? [];
    lines.push(
      `${g.label.padEnd(50)} ${(aggs[cfg.idxCount]?.label ?? "—").padStart(7)}  ${aggs[cfg.idxRate]?.label ?? "—"}`
    );
  }

  const tt = result.factMap["T!T"]?.aggregates ?? [];
  if (tt.length) {
    lines.push(
      `${"─".repeat(50)} ${"─".repeat(7)}  ${"─".repeat(12)}`,
      `${"TOTAL".padEnd(50)} ${(tt[cfg.idxCount]?.label ?? "—").padStart(7)}  ${tt[cfg.idxRate]?.label ?? "—"}`
    );
  }

  return lines;
}

/** Parses a percentage label like "75.00%" to a number (75.0), or NaN if unparseable. */
function parseUtilPct(label: string | undefined): number {
  if (!label) return NaN;
  return parseFloat(label.replace("%", "").trim());
}

function formatUtilizationSection(result: ReportResult, underutilized_only?: boolean): string[] {
  const c = UTIL_IDX;
  const COL = { name: 44, hrs: 8, pct: 9, gap: 7 };

  // When underutilized_only is set, filter to people whose adjUtil is below their own
  // individual adjTarget (both read from the report), then sort by the gap descending
  // so the most underutilized appear first.
  let groupings = result.groupingsDown;
  if (underutilized_only) {
    groupings = groupings.filter(g => {
      const a = result.factMap[`${g.key}!T`]?.aggregates ?? [];
      const util   = parseUtilPct(a[c.adjUtil]?.label);
      const target = parseUtilPct(a[c.adjTarget]?.label);
      // Include if either value is unparseable (unknown) or util is strictly below target
      return isNaN(util) || isNaN(target) || util < target;
    });
    groupings = [...groupings].sort((ga, gb) => {
      const aAggs = result.factMap[`${ga.key}!T`]?.aggregates ?? [];
      const bAggs = result.factMap[`${gb.key}!T`]?.aggregates ?? [];
      const gapA = parseUtilPct(aAggs[c.adjTarget]?.label) - parseUtilPct(aAggs[c.adjUtil]?.label);
      const gapB = parseUtilPct(bAggs[c.adjTarget]?.label) - parseUtilPct(bAggs[c.adjUtil]?.label);
      return (isNaN(gapB) ? 0 : gapB) - (isNaN(gapA) ? 0 : gapA); // biggest gap first
    });
  }

  const sectionLabel = underutilized_only
    ? ` — ${groupings.length} of ${result.groupingsDown.length} below individual target`
    : ` (${result.groupingsDown.length} person(s))`;

  // In underutilized_only mode, add a Gap column so the shortfall is immediately visible
  const showGap = !!underutilized_only;

  const header =
    `${"Name".padEnd(COL.name)} ${"PTO h".padStart(COL.hrs)} ${"Bill h".padStart(COL.hrs)} ${"Cred h".padStart(COL.hrs)} ${"Cap h".padStart(COL.hrs)} ${"Bill%".padStart(COL.pct)} ${"Adj%".padStart(COL.pct)} ${"Target%".padStart(COL.pct)}` +
    (showGap ? ` ${"Gap".padStart(COL.gap)}` : "");
  const divider =
    `${"─".repeat(COL.name)} ${"─".repeat(COL.hrs)} ${"─".repeat(COL.hrs)} ${"─".repeat(COL.hrs)} ${"─".repeat(COL.hrs)} ${"─".repeat(COL.pct)} ${"─".repeat(COL.pct)} ${"─".repeat(COL.pct)}` +
    (showGap ? ` ${"─".repeat(COL.gap)}` : "");

  const lines: string[] = [
    `── YTD Adjusted Utilization${sectionLabel} ──`,
    ``,
    header,
    divider,
  ];

  for (const g of groupings) {
    const a = result.factMap[`${g.key}!T`]?.aggregates ?? [];
    const util   = parseUtilPct(a[c.adjUtil]?.label);
    const target = parseUtilPct(a[c.adjTarget]?.label);
    const gap    = !isNaN(util) && !isNaN(target) ? target - util : NaN;
    const gapStr = isNaN(gap) ? "—" : `${gap > 0 ? "-" : ""}${Math.abs(gap).toFixed(1)}%`;

    lines.push(
      `${g.label.padEnd(COL.name)} ` +
      `${(a[c.ptoHrs]?.label      ?? "—").padStart(COL.hrs)} ` +
      `${(a[c.billableHrs]?.label ?? "—").padStart(COL.hrs)} ` +
      `${(a[c.creditedHrs]?.label ?? "—").padStart(COL.hrs)} ` +
      `${(a[c.capacityHrs]?.label ?? "—").padStart(COL.hrs)} ` +
      `${(a[c.billableUtil]?.label ?? "—").padStart(COL.pct)} ` +
      `${(a[c.adjUtil]?.label      ?? "—").padStart(COL.pct)} ` +
      `${(a[c.adjTarget]?.label    ?? "—").padStart(COL.pct)}` +
      (showGap ? ` ${gapStr.padStart(COL.gap)}` : "")
    );
  }

  if (!underutilized_only) {
    const tt = result.factMap["T!T"]?.aggregates ?? [];
    if (tt.length) {
      lines.push(
        divider,
        `${"TOTAL".padEnd(COL.name)} ` +
        `${(tt[c.ptoHrs]?.label      ?? "—").padStart(COL.hrs)} ` +
        `${(tt[c.billableHrs]?.label ?? "—").padStart(COL.hrs)} ` +
        `${(tt[c.creditedHrs]?.label ?? "—").padStart(COL.hrs)} ` +
        `${(tt[c.capacityHrs]?.label ?? "—").padStart(COL.hrs)} ` +
        `${(tt[c.billableUtil]?.label ?? "—").padStart(COL.pct)} ` +
        `${(tt[c.adjUtil]?.label      ?? "—").padStart(COL.pct)} ` +
        `${(tt[c.adjTarget]?.label    ?? "—").padStart(COL.pct)}`
      );
    }
  }

  return lines;
}

export function registerMyTeamDeliveryMetricsTool(server: McpServer) {
  server.tool(
    "get_my_team_delivery_metrics",
    "Returns delivery metrics for YOUR TEAM (the people who report to you), from up to three Salesforce reports run in parallel. " +
      "To see only your own personal metrics, use get_my_delivery_metrics instead. " +
      "IMPORTANT: this tool is slow — all enabled reports run concurrently so total time equals the slowest one. " +
      "Submission and approval take ~10s each. Utilization takes ~30-75s (Salesforce-side computation). " +
      "Disable any section you don't need to save time. " +
      "(1) 'include_submission' — per-resource timecard submission rate: record count and on-time submission %. " +
      "(2) 'include_approval' — per-approver timecard approval rate: record count and on-time approval %. " +
      "(3) 'include_utilization' — per-resource YTD adjusted utilization: PTO hours, billable hours, credited hours, capacity hours, billable utilization %, adjusted utilization %, and target %.",
    {
      include_submission: z.boolean().optional().describe("Include timecard submission performance (default: true)"),
      include_approval:   z.boolean().optional().describe("Include timecard approval performance (default: true)"),
      include_utilization: z.boolean().optional().describe("Include YTD adjusted utilization — slow (~30s) (default: true)"),
      underutilized_only: z
        .boolean()
        .optional()
        .describe(
          "When true, the utilization section shows only people whose YTD adjusted utilization is below their own individual target (as reported by Salesforce). " +
            "Results are sorted by the shortfall gap, largest first. A 'Gap' column is added showing how many percentage points each person is below their target. " +
            "Ignored when include_utilization is false."
        ),
    },
    async ({ include_submission = true, include_approval = true, include_utilization = true, underutilized_only }) => {
      if (!include_submission && !include_approval && !include_utilization) {
        return {
          content: [{ type: "text", text: "Nothing to load — enable at least one section." }],
        };
      }

      const [submissionResult, approvalResult, utilizationResult] = await Promise.allSettled([
        include_submission  ? runReport(SUBMISSION_REPORT_ID, false)  : Promise.reject("skipped"),
        include_approval    ? runReport(APPROVAL_REPORT_ID, false)    : Promise.reject("skipped"),
        include_utilization ? runReport(UTILIZATION_REPORT_ID, false) : Promise.reject("skipped"),
      ]);

      const lines: string[] = ["My Team's Delivery Metrics\n"];

      if (include_submission) {
        lines.push(
          ...(submissionResult.status === "fulfilled"
            ? formatTimecardSection("Submission Performance", submissionResult.value, SUBMISSION)
            : [`── Submission Performance ──`, `Error: ${submissionResult.reason}`]),
          ``
        );
      }

      if (include_approval) {
        lines.push(
          ...(approvalResult.status === "fulfilled"
            ? formatTimecardSection("Approval Performance", approvalResult.value, APPROVAL)
            : [`── Approval Performance ──`, `Error: ${approvalResult.reason}`]),
          ``
        );
      }

      if (include_utilization) {
        lines.push(
          ...(utilizationResult.status === "fulfilled"
            ? formatUtilizationSection(utilizationResult.value, underutilized_only)
            : [`── YTD Adjusted Utilization ──`, `Error: ${utilizationResult.reason}`]),
          ``
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
